// @ts-check
/**
 * Session authorization for evidence references (pure; no disk I/O).
 *
 * Config refs follow the caller's projected modbus view. Journal refs (build/log)
 * require a structured owner: a caller with a session sees only its own rows,
 * an anonymous caller sees only unattributed legacy rows. Debug snapshots need an
 * owner + workspace match through the injected debug resolver.
 */
import { isScopePartitioned } from '../../domain/modbus/config-scope.mjs'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { resolveTarget } from '../../domain/modbus/target-resolver-service.mjs'
import {
  alarmVisibleToSession,
  pointRuntimeVisible,
  visibleUniqueConnectionIds,
} from './agent-runtime-visibility.mjs'

const CONFIG_KINDS = new Set(['point', 'frame', 'alarm', 'trend', 'visualization', 'connection', 'device'])
const JOURNAL_KINDS = new Set(['build', 'log'])
export const EVIDENCE_KINDS = new Set([...CONFIG_KINDS, ...JOURNAL_KINDS, 'debug_snapshot'])

const HIDDEN_ERROR = '记录不存在、已过期或当前会话不可见'

/**
 * @typedef {{
 *   latestOwnedSnapshotRef?: (scope: { ownerSessionId: string, workspaceCwd: string }) => any,
 *   resolveOwnedSnapshotRef?: (scope: { ownerSessionId: string, workspaceCwd: string, debugSessionId?: string, snapshotId: string }) => any,
 * }} DebugSnapshotResolver
 * @typedef {{
 *   workspace: any,
 *   pack: any,
 *   sessionId: string,
 *   cwd: string,
 *   debug?: DebugSnapshotResolver | null,
 * }} EvidenceScope
 */

/** @param {unknown} v */
const text = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

/**
 * Structured owner rule shared by timeline, tasks and focus rows.
 * @param {any} row
 * @param {string} sessionId
 */
export function ownedBy(row, sessionId) {
  const owner = text(row?.sessionId)
  const sid = text(sessionId)
  return sid ? owner === sid : !owner
}

/** @param {EvidenceScope} scope */
function hasSessionLayers(scope) {
  return Boolean(text(scope.sessionId))
}

/**
 * @param {any} ev
 * @returns {string}
 */
export function evidenceKindOf(ev) {
  const kind = text(ev?.kind)
  if (kind) return kind
  if (text(ev?.snapshotId)) return 'debug_snapshot'
  if (text(ev?.visualizationId)) return 'visualization'
  if (text(ev?.frameId)) return 'frame'
  if (text(ev?.alarmId)) return 'alarm'
  if (text(ev?.trendKey)) return 'trend'
  if (text(ev?.pointId)) return 'point'
  if (text(ev?.deviceId)) return 'device'
  if (text(ev?.connectionId || ev?.connId)) return 'connection'
  return ''
}

/**
 * @param {string} errorCode
 * @param {string} error
 * @param {Record<string, unknown>} [details]
 */
const deny = (errorCode, error, details) => ({
  ok: /** @type {const} */ (false),
  errorCode,
  error,
  ...(details ? { details } : {}),
})

const hidden = () => deny(ERROR_CODES.TARGET_MISMATCH, HIDDEN_ERROR)

/**
 * @param {any} focus
 * @returns {'owned' | 'foreign' | 'unowned-empty' | 'unowned-legacy'}
 *   An ownerless focus is empty only if it carries no request, prev, watch ids,
 *   evidence or badge; anything left over is legacy state of unknown owner.
 * @param {string} sessionId
 */
export function focusOwnership(focus, sessionId) {
  const f = focus && typeof focus === 'object' ? focus : {}
  const owner = text(f.sessionId)
  if (owner) return owner === text(sessionId) ? 'owned' : 'foreign'
  const empty =
    f.request == null &&
    f.prev == null &&
    !(Array.isArray(f.tempWatchIds) && f.tempWatchIds.length) &&
    !(Array.isArray(f.evidence) && f.evidence.length) &&
    f.badgeOnly !== true
  return empty ? 'unowned-empty' : 'unowned-legacy'
}

/**
 * Old anonymous callers on a never-partitioned workspace keep using ownerless state.
 * @param {EvidenceScope} scope
 */
export function anonymousLegacyCompat(scope) {
  return !text(scope.sessionId) && !isScopePartitioned(scope.workspace?.modbus)
}

/**
 * @param {EvidenceScope} scope
 * @param {any} ev
 * @param {string} kind
 */
function resolveConfigRef(scope, ev, kind) {
  const connectionId = text(ev.connectionId || ev.connId)
  const pointId = text(kind === 'point' ? ev.pointId || ev.id : ev.pointId)
  const frameId = text(kind === 'frame' ? ev.frameId || ev.id : ev.frameId)
  const alarmId = text(kind === 'alarm' ? ev.alarmId || ev.id : ev.alarmId)
  const trendKey = text(kind === 'trend' ? ev.trendKey || ev.id : ev.trendKey)
  const visualizationId = text(kind === 'visualization' ? ev.visualizationId || ev.id : ev.visualizationId)
  const deviceId = text(kind === 'device' ? ev.deviceId || ev.id : ev.deviceId)
  const connId = kind === 'connection' ? connectionId || text(ev.id) : connectionId
  const rt = resolveTarget(scope.pack, {
    connectionId: connId,
    deviceId,
    pointId,
    frameId,
    alarmId,
    trendKey,
    visualizationId,
  })
  if (!rt.ok) {
    return deny(
      rt.errorCode === 'VIZ_NOT_FOUND' ? 'VIZ_NOT_FOUND' : rt.errorCode || ERROR_CODES.TARGET_MISMATCH,
      rt.error || HIDDEN_ERROR,
    )
  }
  if (!hasSessionLayers(scope)) return { ok: /** @type {const} */ (true) }

  const layered = scope.workspace?.modbus
  const sid = text(scope.sessionId)
  if (pointId) {
    if (!pointRuntimeVisible(layered, sid, pointId).visible) return hidden()
  }
  if (kind === 'trend' && trendKey) {
    const trendPoint = trendKey.split(':')[2] || ''
    if (trendPoint && !pointRuntimeVisible(layered, sid, trendPoint).visible) return hidden()
  }
  if (kind === 'frame' || kind === 'connection') {
    const cid = text(rt.connection?.id || connId)
    const visible = visibleUniqueConnectionIds(layered, sid, scope.pack?.connections || [])
    if (!cid || !visible.has(cid)) return hidden()
  }
  if (kind === 'alarm' && alarmId) {
    const state = scope.pack?.alarmState && typeof scope.pack.alarmState === 'object' ? scope.pack.alarmState : {}
    const hit = state[alarmId]
    if (hit && !alarmVisibleToSession(layered, sid, scope.pack, alarmId, hit)) return hidden()
  }
  return { ok: /** @type {const} */ (true) }
}

/**
 * `log` rows live in the timeline, `build` rows in build tasks.
 * @param {any} workspace
 * @param {'build' | 'log'} kind
 */
function journalRows(workspace, kind) {
  if (kind === 'build') {
    return (Array.isArray(workspace?.tasks) ? workspace.tasks : []).filter((/** @type {any} */ t) => t && t.type === 'build')
  }
  return Array.isArray(workspace?.timeline) ? workspace.timeline : []
}

/**
 * Match on kind + id + owner in one pass. Another owner's row with the same id is a
 * different record; two rows for the same owner and id cannot be cited unambiguously.
 *
 * @param {any[]} rows rows of one kind
 * @param {{ id: string, sessionId: string }} key
 * @returns {{ status: 'found', row: any } | { status: 'missing' } | { status: 'ambiguous' }}
 */
export function findOwnedJournalRow(rows, key) {
  const id = text(key.id)
  /** @type {any[]} */
  const hits = []
  for (const r of rows) {
    if (r && text(r.id) === id && ownedBy(r, key.sessionId)) hits.push(r)
    if (hits.length > 1) return { status: 'ambiguous' }
  }
  return hits.length ? { status: 'found', row: hits[0] } : { status: 'missing' }
}

/**
 * @param {EvidenceScope} scope
 * @param {any} ev
 * @param {'build' | 'log'} kind
 */
function resolveJournalRef(scope, ev, kind) {
  const id = text(ev.id)
  if (!id) return deny(ERROR_CODES.TARGET_REQUIRED, '证据缺少 ID')
  const hit = findOwnedJournalRow(journalRows(scope.workspace, kind), { id, sessionId: scope.sessionId })
  if (hit.status === 'ambiguous') return deny(ERROR_CODES.TARGET_MISMATCH, HIDDEN_ERROR, { reason: 'AMBIGUOUS_ID' })
  if (hit.status !== 'found') return hidden()
  return { ok: /** @type {const} */ (true) }
}

/**
 * @param {EvidenceScope} scope
 * @param {any} ev
 */
function resolveSnapshotRef(scope, ev) {
  const sid = text(scope.sessionId)
  const snapshotId = text(ev.snapshotId || ev.id)
  if (!snapshotId) return deny(ERROR_CODES.TARGET_REQUIRED, '证据缺少 ID')
  if (!sid) return hidden()
  const resolver = scope.debug?.resolveOwnedSnapshotRef
  const ref =
    typeof resolver === 'function'
      ? resolver({
          ownerSessionId: sid,
          workspaceCwd: scope.cwd,
          debugSessionId: text(ev.debugSessionId) || undefined,
          snapshotId,
        })
      : null
  if (!ref) return hidden()
  return { ok: /** @type {const} */ (true), ref }
}

/**
 * Resolve one evidence reference against the caller's view.
 * `checkVersion` is off for historical rows (they may predate the current version).
 *
 * @param {EvidenceScope} scope
 * @param {any} ev
 * @param {{ checkVersion?: boolean }} [opts]
 * @returns {{ ok: true, kind: string, ref?: any } | { ok: false, errorCode: string, error: string, details?: Record<string, unknown> }}
 */
export function resolveEvidenceRef(scope, ev, opts = {}) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
    return deny(ERROR_CODES.INVALID_FIELD, 'evidence 每一项必须是对象')
  }
  const kind = evidenceKindOf(ev)
  if (!kind) return deny(ERROR_CODES.TARGET_REQUIRED, '证据缺少 ID')
  if (!EVIDENCE_KINDS.has(kind)) return deny(ERROR_CODES.INVALID_FIELD, `不支持的证据类型: ${kind.slice(0, 32)}`)
  const owner = text(ev.sessionId)
  if (owner && owner !== text(scope.sessionId)) return hidden()

  /** @type {any} */
  let resolved
  if (CONFIG_KINDS.has(kind)) resolved = resolveConfigRef(scope, ev, kind)
  else if (JOURNAL_KINDS.has(kind)) resolved = resolveJournalRef(scope, ev, /** @type {'build' | 'log'} */ (kind))
  else resolved = resolveSnapshotRef(scope, ev)
  if (!resolved.ok) return resolved

  if (opts.checkVersion !== false) {
    const evVer = Number(ev.version ?? ev.configVersion)
    const current = Number(scope.pack?.configVersion) || 1
    if (Number.isFinite(evVer) && evVer !== current) {
      return deny(ERROR_CODES.CONFIG_DRIFT, `版本漂移：证据基于 v${evVer} 当前 v${current}`)
    }
  }
  return { ok: true, kind, ...(resolved.ref ? { ref: resolved.ref } : {}) }
}

/**
 * Validate a whole batch; the first failure rejects everything.
 * Accepted rows carry the controlled caller session id.
 *
 * @param {EvidenceScope} scope
 * @param {any[]} list
 * @returns {{ ok: true, rows: any[] } | { ok: false, errorCode: string, error: string, details?: Record<string, unknown>, index: number }}
 */
export function resolveEvidenceBatch(scope, list) {
  const sid = text(scope.sessionId)
  /** @type {any[]} */
  const rows = []
  for (let i = 0; i < list.length; i += 1) {
    const ev = list[i]
    const r = resolveEvidenceRef(scope, ev)
    if (!r.ok) return { ...r, index: i }
    rows.push({ ...ev, kind: r.kind, ...(sid ? { sessionId: sid } : {}) })
  }
  return { ok: true, rows }
}

/**
 * Evidence refs a caller may cite right now.
 *
 * @param {EvidenceScope} scope
 * @returns {any[]}
 */
export function collectVisibleEvidenceRefs(scope) {
  const version = Number(scope.pack?.configVersion) || 1
  /** @type {any[]} */
  const refs = []
  for (const kind of /** @type {const} */ (['build', 'log'])) {
    const rows = journalRows(scope.workspace, kind)
    const latest = rows.find((/** @type {any} */ r) => r && ownedBy(r, scope.sessionId))
    // Only offer an id that the append path will accept for this caller.
    if (!latest || findOwnedJournalRow(rows, { id: latest.id, sessionId: scope.sessionId }).status !== 'found') continue
    refs.push({ kind, id: latest.id, at: kind === 'build' ? latest.endedAt || latest.startedAt : latest.at, version })
  }

  const sid = text(scope.sessionId)
  const latest = sid && typeof scope.debug?.latestOwnedSnapshotRef === 'function'
    ? scope.debug.latestOwnedSnapshotRef({ ownerSessionId: sid, workspaceCwd: scope.cwd })
    : null
  if (latest) refs.push({ ...latest, version })

  const layered = scope.workspace?.modbus
  const points = Array.isArray(scope.pack?.points) ? scope.pack.points : []
  for (const p of points) {
    if (refs.filter((r) => r.kind === 'point').length >= 5) break
    const pid = text(p?.id)
    if (!pid) continue
    if (sid && !pointRuntimeVisible(layered, sid, pid).visible) continue
    refs.push({ kind: 'point', id: pid, connectionId: p.connectionId, deviceId: p.deviceId, version })
  }
  return refs
}

/**
 * Focus as a given caller may see it. Another session's focus is empty;
 * each stored evidence row must still resolve for this caller.
 *
 * @param {any} workspace layered workspace
 * @param {EvidenceScope} scope
 */
export function projectVisibleFocus(workspace, scope) {
  const focus = workspace?.focus && typeof workspace.focus === 'object' ? workspace.focus : {}
  const empty = { sessionId: '', request: null, prev: null, tempWatchIds: [], badgeOnly: false, evidence: [] }
  const ownership = focusOwnership(focus, scope.sessionId)
  const visible = ownership === 'owned' || (ownership === 'unowned-legacy' && anonymousLegacyCompat(scope))
  if (!visible) return { ...empty, evidenceHiddenCount: 0 }
  const rows = Array.isArray(focus.evidence) ? focus.evidence : []
  /** @type {any[]} */
  const kept = []
  let hiddenCount = 0
  for (const row of rows) {
    if (row && resolveEvidenceRef(scope, row, { checkVersion: false }).ok) kept.push(row)
    else hiddenCount += 1
  }
  return {
    sessionId: text(focus.sessionId),
    request: focus.request || null,
    prev: focus.prev || null,
    tempWatchIds: Array.isArray(focus.tempWatchIds) ? focus.tempWatchIds : [],
    badgeOnly: focus.badgeOnly === true,
    evidence: kept,
    evidenceHiddenCount: hiddenCount,
  }
}
