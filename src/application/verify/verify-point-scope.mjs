// @ts-check
/**
 * Session-scoped point resolution for verify reads. Uses the same layered
 * identity rules as points get/list (in-memory legacy claim, effective identity,
 * provenance-checked value selection) and never writes to disk.
 */
import { isScopePartitioned, normalizeScopeSessionId } from '../../domain/modbus/config-scope.mjs'
import { decodeValue } from '../../domain/modbus/point-math.mjs'
import { unavailable, UNAVAILABLE_REASONS } from '../../domain/verify/observation.mjs'
import { normalizeCwd } from '../../shared/path-normalize.mjs'
import { pointRuntimeVisible } from '../modbus/agent-runtime-visibility.mjs'
import { resolveEffectivePointIdentity } from '../modbus/poll-runtime-identity.mjs'
import { selectPointQueryValue } from '../modbus/point-query-value.mjs'
import { claimWorkspaceSync, modbusForSession } from '../modbus/workspace-session-view.mjs'

/**
 * @typedef {import('../../domain/verify/observation.mjs').UnavailableObservation} UnavailableObservation
 * @typedef {{ sid: string, layered: any, pack: any, values: any }} SessionView
 * @typedef {{
 *   ok: true,
 *   point: any,
 *   view: SessionView,
 *   fingerprint: string,
 *   record: any | null,
 * }} ResolvedPoint
 * @typedef {{
 *   value: any,
 *   rawValue: any,
 *   timestamp: number,
 *   quality: 'good' | 'stale' | 'error',
 *   source: string,
 *   freshnessMs?: number,
 *   fingerprint?: string,
 * }} PointReading
 */

/**
 * The caller's view of one loaded layered workspace; null for an anonymous
 * caller of a partitioned workspace, who has no provable scope.
 *
 * @param {any} workspace
 * @param {string | undefined} sessionId
 * @returns {SessionView | null}
 */
export function sessionView(workspace, sessionId) {
  if (!workspace || typeof workspace !== 'object') return null
  const sid = normalizeScopeSessionId(sessionId)
  if (!sid && isScopePartitioned(workspace.modbus)) return null
  const viewSource = sid ? claimWorkspaceSync(workspace, sid).workspace : workspace
  return { sid, layered: viewSource.modbus, pack: modbusForSession(viewSource, sid), values: workspace.modbus?.values }
}

/**
 * @param {string} cwd
 * @param {string} sid
 * @param {string} pointId
 */
export const scopeKey = (cwd, sid, pointId) => JSON.stringify([normalizeCwd(cwd), sid, pointId])

/**
 * Identity and geometry of a resolved point: a cached reading is reused only
 * while this stays the same, so deleting, rebinding or un-sharing invalidates it.
 *
 * @param {any} view
 * @param {any} point
 * @param {string} layer
 */
function fingerprintOf(view, point, layer) {
  const device = (view.pack?.devices || []).find((/** @type {any} */ d) => d?.id === point.deviceId)
  return JSON.stringify([
    layer,
    point.id,
    point.connectionId || point.connId || '',
    point.deviceId || '',
    device?.unitId ?? null,
    point.function ?? null,
    point.address ?? null,
    point.dataType ?? point.type ?? null,
    point.scale ?? null,
    point.offset ?? null,
  ])
}

/**
 * Resolve a point the caller may read, rejecting invisible, foreign and
 * ambiguous targets before any cache or device access.
 *
 * @param {any} workspace layered workspace from one repository load
 * @param {string | undefined} sessionId
 * @param {string} pointId
 * @returns {ResolvedPoint | UnavailableObservation}
 */
export function resolveVerifyPoint(workspace, sessionId, pointId) {
  const pid = String(pointId || '').trim()
  const view = sessionView(workspace, sessionId)
  if (!view || !pid) return unavailable(UNAVAILABLE_REASONS.TARGET_UNAVAILABLE)
  const point = (view.pack?.points || []).find((/** @type {any} */ p) => p?.id === pid)
  const vis = pointRuntimeVisible(view.layered, view.sid, pid)
  if (vis.reason === 'ambiguous') return unavailable(UNAVAILABLE_REASONS.AMBIGUOUS_OWNER)
  if (!point || !vis.visible) return unavailable(UNAVAILABLE_REASONS.TARGET_UNAVAILABLE)
  const selected = selectPointQueryValue({ workspaceModbus: view.layered, point, values: view.values })
  if (selected.reason === 'ambiguous') return unavailable(UNAVAILABLE_REASONS.AMBIGUOUS_OWNER)
  const layer = resolveEffectivePointIdentity(view.layered, pid).identities[0]?.layer || ''
  return {
    ok: true,
    point,
    view,
    fingerprint: fingerprintOf(view, point, layer),
    record: selected.status === 'available' ? selected.record : null,
  }
}

/**
 * Map a stored or freshly read value record to a reading. The record's own
 * `at` is the timestamp; a missing one is left as 0 rather than invented.
 *
 * @param {any} rec
 * @param {any} point
 * @param {string} source
 * @returns {PointReading | null}
 */
export function readingFromRecord(rec, point, source) {
  if (!rec || typeof rec !== 'object') return null
  const at = Number(rec.at)
  const raw = rec.raw === undefined ? null : rec.raw
  const value = rec.value !== undefined && rec.value !== null ? rec.value : raw !== null ? decodeValue(point, raw) : null
  return {
    value,
    rawValue: raw !== null ? raw : value,
    timestamp: Number.isFinite(at) && at > 0 ? at : 0,
    quality: rec.ok === false ? 'error' : 'good',
    source,
  }
}

/**
 * A reading that may stand in for live data: trusted quality, own timestamp and a value.
 *
 * @param {PointReading | null | undefined} reading
 * @returns {reading is PointReading}
 */
export function usableReading(reading) {
  return Boolean(reading && reading.quality === 'good' && reading.timestamp > 0 && reading.value != null)
}
