// @ts-check
/**
 * Session-scoped point resolution for verify reads. Uses the same layered
 * identity rules as points get/list and never writes to disk.
 */
import { isScopePartitioned, normalizeScopeSessionId } from '../../domain/modbus/config-scope.mjs'
import { decodeValue } from '../../domain/modbus/point-math.mjs'
import {
  normalizeSampleIdentity,
  sampleFingerprintOf,
} from '../../domain/modbus/point-sample-identity.mjs'
import { buildEffectivePointIndex } from '../../domain/modbus/prepare-config-persistence.mjs'
import { stampForEntry } from '../../domain/modbus/sample-generation.mjs'
import { unavailable, UNAVAILABLE_REASONS } from '../../domain/verify/observation.mjs'
import { normalizeCwd } from '../../shared/path-normalize.mjs'
import { pointRuntimeVisible } from '../modbus/agent-runtime-visibility.mjs'
import { resolveEffectivePointIdentity } from '../modbus/poll-runtime-identity.mjs'
import { claimWorkspaceSync, modbusForSession } from '../modbus/workspace-session-view.mjs'

/**
 * @typedef {import('../../domain/verify/observation.mjs').UnavailableObservation} UnavailableObservation
 * @typedef {{ sid: string, layered: any, pack: any, values: any }} SessionView
 * @typedef {{
 *   ok: true,
 *   point: any,
 *   view: SessionView,
 *   fingerprint: string,
 *   generation: string,
 *   record: any | null,
 *   latestRecord: any | null,
 * }} ResolvedPoint
 * @typedef {{
 *   value: any,
 *   rawValue: any,
 *   timestamp: number,
 *   quality: 'good' | 'stale' | 'error',
 *   source: string,
 *   freshnessMs?: number,
 *   fingerprint?: string,
 *   generation?: string,
 * }} PointReading
 */

/**
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
 * @param {SessionView} view
 * @param {any} point
 * @param {string} layer
 * @param {string} ownerSessionId
 * @param {string} generation
 */
function currentStamp(view, point, layer, ownerSessionId, generation) {
  const index = buildEffectivePointIndex(view.layered)
  const entry = index.get(String(point.id))
  // Prefer the effective-index entry for fingerprint so cold-start (no gen yet)
  // and post-init stamps agree — pack projection can normalize scale/offset
  // differently from the layered row buildEffectivePointIndex sees.
  if (entry) {
    if (generation) {
      const stamp = stampForEntry(entry, generation)
      if (stamp) return stamp
    }
    return {
      fingerprint: sampleFingerprintOf({
        layer: entry.layer,
        ownerSessionId: entry.ownerSessionId,
        point: entry.point,
        connection: entry.connection,
        device: entry.device,
      }),
      generation: generation || '',
    }
  }
  const device = (view.pack?.devices || []).find((/** @type {any} */ d) => d?.id === point.deviceId)
  const connection = (view.pack?.connections || []).find(
    (/** @type {any} */ c) => c?.id === (point.connectionId || point.connId),
  )
  return {
    fingerprint: sampleFingerprintOf({
      layer,
      ownerSessionId,
      point,
      connection,
      device,
    }),
    generation: generation || '',
  }
}

/**
 * @param {any[]} values
 * @param {any} point
 */
function matchingRecords(values, point) {
  const pid = String(point?.id || '')
  const conn = String(point?.connectionId || point?.connId || '')
  const dev = String(point?.deviceId || '')
  return (Array.isArray(values) ? values : []).filter((/** @type {any} */ r) => {
    if (!r || String(r.pointId || r.key || '') !== pid) return false
    const rc = String(r.connectionId || r.connId || '')
    const rd = String(r.deviceId || '')
    return (!rc || rc === conn) && (!rd || rd === dev)
  })
}

/**
 * @param {any[]} records
 * @returns {any | null}
 */
function latestByTimestamp(records) {
  if (!records.length) return null
  return [...records].sort((a, b) => {
    const ta = Number(a?.at) || 0
    const tb = Number(b?.at) || 0
    if (tb !== ta) return tb - ta
    const fa = a?.ok === false ? 1 : 0
    const fb = b?.ok === false ? 1 : 0
    return fb - fa
  })[0]
}

/**
 * @param {any} workspace
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

  const identity = resolveEffectivePointIdentity(view.layered, pid)
  if (identity.kind === 'ambiguous') return unavailable(UNAVAILABLE_REASONS.AMBIGUOUS_OWNER)
  const layer = identity.identities[0]?.layer || ''
  const ownerSessionId = identity.identities[0]?.sessionId || ''
  const generation = String(view.layered?.sampleGenerations?.[pid] || '')
  const stamp = currentStamp(view, point, layer, ownerSessionId, generation)

  const records = matchingRecords(view.values, point)
  const latest = latestByTimestamp(records)
  /** @type {any | null} */
  let trusted = null
  if (latest && latest.ok !== false && generation) {
    const got = normalizeSampleIdentity(latest.sampleIdentity)
    if (got && got.generation === generation && got.fingerprint === stamp.fingerprint) {
      trusted = latest
    }
  }

  return {
    ok: true,
    point,
    view,
    fingerprint: stamp.fingerprint,
    generation,
    record: trusted,
    latestRecord: latest,
  }
}

/**
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
  const stamp = normalizeSampleIdentity(rec.sampleIdentity)
  return {
    value,
    rawValue: raw !== null ? raw : value,
    timestamp: Number.isFinite(at) && at > 0 ? at : 0,
    quality: rec.ok === false ? 'error' : 'good',
    source,
    ...(stamp ? { fingerprint: stamp.fingerprint, generation: stamp.generation } : {}),
  }
}

/**
 * A reading that may stand in for live data: trusted quality, own timestamp,
 * stamped provenance and a value.
 *
 * @param {PointReading | null | undefined} reading
 * @returns {reading is PointReading}
 */
export function usableReading(reading) {
  return Boolean(
    reading &&
      reading.quality === 'good' &&
      reading.timestamp > 0 &&
      reading.value != null &&
      reading.fingerprint &&
      reading.generation,
  )
}
