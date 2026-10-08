// @ts-check

import { normalizeScopeSessionId } from '../../domain/modbus/config-scope.mjs'
import { isUnavailable, unavailable, UNAVAILABLE_REASONS } from '../../domain/verify/observation.mjs'
import { normalizeCwd } from '../../shared/path-normalize.mjs'
import { readingFromRecord, resolveVerifyPoint, scopeKey, usableReading } from './verify-point-scope.mjs'

/**
 * @typedef {import('./verify-point-scope.mjs').PointReading} PointReading
 * @typedef {import('./verify-point-scope.mjs').ResolvedPoint} ResolvedPoint
 * @typedef {import('../../domain/verify/observation.mjs').UnavailableObservation} UnavailableObservation
 * @typedef {{ cwd?: string, sessionId?: string, source?: string }} ReadScope
 * @typedef {{ cwd: string, sid: string, source: string }} ResolvedScope
 * @typedef {{ ok: true, point: any, fingerprint: string, record: any | null, view?: any }} ReadTarget
 * @typedef {(scope: ResolvedScope, target: ReadTarget, signal?: AbortSignal) => Promise<PointReading | UnavailableObservation | null>} DirectRead
 */

const NO_SCOPE = '读取缺少可证明的会话作用域'

/**
 * Point reader shared by the production telemetry adapter and the default
 * verify reader. Every call carries `{ cwd, sessionId }`; the point is resolved
 * against one workspace load before cache, poll value or device read, and
 * cached readings are reused only while the point's identity fingerprint holds.
 *
 * Without a workspace loader a reader may be bound to one explicit scope
 * (`boundScope`) for controlled sources; otherwise it has nothing to prove
 * visibility against and every read is unavailable.
 *
 * @param {{
 *   workspaceLoader?: ((cwd: string) => any) | null,
 *   directRead?: DirectRead | null,
 *   liveCache?: Map<string, PointReading>,
 *   boundScope?: { cwd: string, sessionId?: string } | null,
 * }} [deps]
 */
export function createScopedPointReader(deps = {}) {
  const workspaceLoader = deps.workspaceLoader || null
  const directRead = deps.directRead || null
  const liveCache = deps.liveCache || new Map()
  const bound = deps.boundScope
    ? { cwd: normalizeCwd(deps.boundScope.cwd), sid: normalizeScopeSessionId(deps.boundScope.sessionId) }
    : null
  /** @type {Map<string, Set<(reading: PointReading) => void>>} */
  const listeners = new Map()

  /**
   * @param {unknown} scope
   * @returns {ResolvedScope | null}
   */
  function scopeOf(scope) {
    if (!scope || typeof scope !== 'object') return null
    const s = /** @type {ReadScope} */ (scope)
    const cwd = String(s.cwd || '').trim()
    if (!cwd) return null
    return { cwd, sid: normalizeScopeSessionId(s.sessionId), source: s.source === 'agent' ? 'agent' : 'user' }
  }

  /**
   * @param {ResolvedScope} scope
   * @param {string} pointId
   * @returns {ReadTarget | UnavailableObservation}
   */
  function locate(scope, pointId) {
    if (workspaceLoader) {
      let workspace
      try {
        workspace = workspaceLoader(scope.cwd)
      } catch (err) {
        return unavailable(UNAVAILABLE_REASONS.READ_FAILED, err instanceof Error ? err.message : String(err))
      }
      return resolveVerifyPoint(workspace, scope.sid, pointId)
    }
    if (bound && pointId && normalizeCwd(scope.cwd) === bound.cwd && scope.sid === bound.sid) {
      return { ok: true, point: { id: pointId }, fingerprint: 'bound', record: null }
    }
    return unavailable(UNAVAILABLE_REASONS.TARGET_UNAVAILABLE)
  }

  /**
   * @param {string} key
   * @param {PointReading} reading
   */
  function store(key, reading) {
    liveCache.set(key, reading)
    for (const fn of listeners.get(key) || []) {
      try {
        fn(reading)
      } catch {}
    }
  }

  /**
   * @param {PointReading} reading
   * @param {number} maxAgeMs
   * @returns {PointReading}
   */
  function withFreshness(reading, maxAgeMs) {
    const freshnessMs = Math.max(0, Date.now() - reading.timestamp)
    return { ...reading, freshnessMs, quality: freshnessMs > maxAgeMs ? 'stale' : reading.quality }
  }

  /**
   * @param {ReadScope} scopeIn
   * @param {string} pointId
   * @param {{ maxAgeMs?: number, signal?: AbortSignal }} [options]
   * @returns {Promise<PointReading | UnavailableObservation>}
   */
  async function readPoint(scopeIn, pointId, options = {}) {
    const scope = scopeOf(scopeIn)
    if (!scope) return unavailable(UNAVAILABLE_REASONS.TARGET_UNAVAILABLE, NO_SCOPE)
    const target = locate(scope, String(pointId || '').trim())
    if (isUnavailable(target)) return target
    const maxAgeMs =
      typeof options.maxAgeMs === 'number' && Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : Number.POSITIVE_INFINITY
    const key = scopeKey(scope.cwd, scope.sid, target.point.id)

    const cachedRaw = liveCache.get(key)
    const cached = cachedRaw && cachedRaw.fingerprint === target.fingerprint && usableReading(cachedRaw) ? cachedRaw : null
    const poll = readingFromRecord(target.record, target.point, 'poll-cache')
    const pollUsable = usableReading(poll) ? poll : null
    const best = cached && pollUsable ? (cached.timestamp >= pollUsable.timestamp ? cached : pollUsable) : cached || pollUsable
    if (best) {
      if (best === pollUsable) liveCache.set(key, { ...pollUsable, fingerprint: target.fingerprint })
      return withFreshness(best, maxAgeMs)
    }

    if (directRead) {
      const direct = await directRead(scope, target, options.signal)
      if (!direct) return unavailable(UNAVAILABLE_REASONS.DATA_MISSING)
      if (isUnavailable(direct)) return direct
      if (!usableReading(direct)) return unavailable(UNAVAILABLE_REASONS.READ_FAILED, '读取结果没有有效采样')
      const reading = { ...direct, fingerprint: target.fingerprint }
      store(key, reading)
      return withFreshness(reading, maxAgeMs)
    }
    if (poll) return poll
    return unavailable(UNAVAILABLE_REASONS.DATA_MISSING)
  }

  /**
   * Publish a live sample for a point the scope can see. Returns false (and
   * stores nothing) when the scope cannot be proven.
   *
   * @param {ReadScope} scopeIn
   * @param {string} pointId
   * @param {any} valueOrReading
   * @returns {boolean}
   */
  function publishPointValue(scopeIn, pointId, valueOrReading) {
    const scope = scopeOf(scopeIn)
    if (!scope) return false
    const target = locate(scope, String(pointId || '').trim())
    if (isUnavailable(target)) return false
    /** @type {PointReading} */
    const reading =
      valueOrReading && typeof valueOrReading === 'object' && 'timestamp' in valueOrReading
        ? { quality: 'good', source: 'published', ...valueOrReading }
        : {
            value: valueOrReading,
            rawValue: valueOrReading,
            timestamp: Date.now(),
            source: 'published',
            quality: 'good',
          }
    store(scopeKey(scope.cwd, scope.sid, target.point.id), { ...reading, fingerprint: target.fingerprint })
    return true
  }

  /**
   * @param {ReadScope} scopeIn
   * @param {string} pointId
   * @param {(reading: PointReading) => void} listener
   * @returns {() => void}
   */
  function subscribePoint(scopeIn, pointId, listener) {
    const scope = scopeOf(scopeIn)
    if (!scope || !pointId || typeof listener !== 'function') return () => {}
    const key = scopeKey(scope.cwd, scope.sid, String(pointId))
    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }
    set.add(listener)
    return () => {
      const s = listeners.get(key)
      if (!s) return
      s.delete(listener)
      if (s.size === 0) listeners.delete(key)
    }
  }

  /**
   * @param {string[]} pointIds
   * @param {ReadScope} scope
   */
  async function readMultiple(pointIds, scope) {
    /** @type {Record<string, any>} */
    const results = {}
    await Promise.all(
      (pointIds || []).map(async (pid) => {
        const r = await readPoint(scope, pid)
        if (!isUnavailable(r) && r.quality === 'good') results[pid] = r.value
      }),
    )
    return results
  }

  return { readPoint, publishPointValue, subscribePoint, readMultiple }
}
