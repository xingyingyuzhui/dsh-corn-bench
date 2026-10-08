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
 * @typedef {(scope: ResolvedScope, target: ResolvedPoint, signal?: AbortSignal) => Promise<PointReading | UnavailableObservation | null>} DirectRead
 * @typedef {{ tryConsume: (key: string) => boolean }} DirectReadBudget
 */

const NO_SCOPE = '读取缺少可证明的会话作用域'

/**
 * @param {{
 *   workspaceLoader?: ((cwd: string) => any) | null,
 *   directRead?: DirectRead | null,
 *   liveCache?: Map<string, PointReading>,
 *   boundScope?: { cwd: string, sessionId?: string } | null,
   *   directReadBudget?: DirectReadBudget | null,
   * }} [deps]
   */
export function createScopedPointReader(deps = {}) {
  // Note: per-call options.directReadBudget overrides deps for verify run-local budgets.
  const workspaceLoader = deps.workspaceLoader || null
  const directRead = deps.directRead || null
  const liveCache = deps.liveCache || new Map()
  const budget = deps.directReadBudget || null
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
   * @returns {ResolvedPoint | UnavailableObservation}
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
      return {
        ok: true,
        point: { id: pointId },
        fingerprint: 'bound',
        generation: 'bound',
        record: null,
        latestRecord: null,
        view: /** @type {any} */ ({ sid: bound.sid, layered: null, pack: { points: [{ id: pointId }] }, values: [] }),
      }
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
   * Stamp a successful direct-read with the current target identity.
   * Quality/timestamp are checked before stamp attachment (producer may not
   * have stamped yet when the adapter maps the row).
   *
   * @param {PointReading | UnavailableObservation | null | undefined} direct
   * @param {ResolvedPoint} target
   * @param {string} key
   * @param {number} maxAgeMs
   * @param {'READ_FAILED' | 'DATA_MISSING'} emptyReason
   */
  function finalizeDirect(direct, target, key, maxAgeMs, emptyReason) {
    if (!direct) {
      return unavailable(
        emptyReason === 'DATA_MISSING' ? UNAVAILABLE_REASONS.DATA_MISSING : UNAVAILABLE_REASONS.READ_FAILED,
      )
    }
    if (isUnavailable(direct)) return direct
    if (direct.quality !== 'good' || !(direct.timestamp > 0) || direct.value == null) {
      return unavailable(UNAVAILABLE_REASONS.READ_FAILED, '读取结果没有有效采样')
    }
    const reading = {
      ...direct,
      fingerprint: target.fingerprint,
      generation: target.generation,
    }
    store(key, reading)
    return withFreshness(reading, maxAgeMs)
  }

  /**
   * @param {ReadScope} scopeIn
   * @param {string} pointId
   * @param {{ maxAgeMs?: number, signal?: AbortSignal, allowDirectRead?: boolean, directReadBudget?: DirectReadBudget | null }} [options]
   * @returns {Promise<PointReading | UnavailableObservation>}
   */
  async function readPoint(scopeIn, pointId, options = {}) {
    const scope = scopeOf(scopeIn)
    if (!scope) return unavailable(UNAVAILABLE_REASONS.TARGET_UNAVAILABLE, NO_SCOPE)
    const located = locate(scope, String(pointId || '').trim())
    if (isUnavailable(located)) return located
    /** @type {ResolvedPoint} */
    const target = located
    /** @type {ResolvedScope} */
    const resolvedScope = scope
    const maxAgeMs =
      typeof options.maxAgeMs === 'number' && Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : Number.POSITIVE_INFINITY
    const allowDirect = options.allowDirectRead !== false
    const activeBudget = options.directReadBudget || budget
    const key = scopeKey(resolvedScope.cwd, resolvedScope.sid, target.point.id)
    const budgetKey = JSON.stringify([normalizeCwd(resolvedScope.cwd), resolvedScope.sid, target.point.id, target.generation || ''])

    const cachedRaw = liveCache.get(key)
    const cached =
      cachedRaw &&
      cachedRaw.fingerprint === target.fingerprint &&
      cachedRaw.generation === target.generation &&
      usableReading(cachedRaw)
        ? cachedRaw
        : null

    const pollTrusted = readingFromRecord(target.record, target.point, 'poll-cache')
    const pollUsable = usableReading(pollTrusted) ? pollTrusted : null
    const latest = readingFromRecord(target.latestRecord, target.point, 'poll-cache')
    const latestIsBad = Boolean(latest && latest.quality === 'error' && latest.timestamp > 0)

    // Newest trustworthy sample among cache and stamped poll.
    /** @type {PointReading | null} */
    let best = null
    if (cached && pollUsable) best = cached.timestamp >= pollUsable.timestamp ? cached : pollUsable
    else best = cached || pollUsable

    /**
     * @param {'READ_FAILED' | 'DATA_MISSING'} emptyReason
     */
    async function tryDirect(emptyReason) {
      if (!(allowDirect && directRead && (!activeBudget || activeBudget.tryConsume(budgetKey)))) {
        return null
      }
      const direct = await directRead(resolvedScope, target, options.signal)
      // Re-resolve after I/O — revoke/rebind must not keep a stale stamp.
      const fresh = locate(resolvedScope, String(pointId || '').trim())
      if (isUnavailable(fresh)) return fresh
      // Cold-start: mutating read may initialize missing generations during I/O.
      // Empty→token with the same fingerprint is not a geometry/owner change.
      const coldStartInit =
        !target.generation && Boolean(fresh.generation) && fresh.fingerprint === target.fingerprint
      if (
        fresh.fingerprint !== target.fingerprint ||
        (!coldStartInit && fresh.generation !== target.generation)
      ) {
        return unavailable(UNAVAILABLE_REASONS.STALE_VALUE, '采样配置已改变，无法接纳补读结果')
      }
      return finalizeDirect(direct, fresh, key, maxAgeMs, emptyReason)
    }

    // A newer failed poll blocks falling back to an older good.
    if (latestIsBad && latest && (!best || latest.timestamp >= best.timestamp)) {
      const recovered = await tryDirect('READ_FAILED')
      if (recovered) return recovered
      return unavailable(UNAVAILABLE_REASONS.BAD_QUALITY, latest.value == null ? '最新采样失败' : '采样质量为 error')
    }

    if (best) {
      if (best === pollUsable) {
        liveCache.set(key, {
          ...pollUsable,
          fingerprint: target.fingerprint,
          generation: target.generation,
        })
      }
      return withFreshness(best, maxAgeMs)
    }

    {
      const recovered = await tryDirect('DATA_MISSING')
      if (recovered) return recovered
    }

    if (latest && latest.quality === 'error') {
      return unavailable(UNAVAILABLE_REASONS.BAD_QUALITY, '最新采样失败')
    }
    return unavailable(UNAVAILABLE_REASONS.DATA_MISSING)
  }

  /**
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
    // Controlled publish is a real "now" event — stamp with the current identity.
    store(scopeKey(scope.cwd, scope.sid, target.point.id), {
      ...reading,
      fingerprint: target.fingerprint || reading.fingerprint || 'bound',
      generation: target.generation || reading.generation || 'bound',
    })
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

/**
 * Per-verify-run direct-read budget: at most one supplementary read per
 * [cwd,sid,pointId,generation].
 * @returns {DirectReadBudget}
 */
export function createDirectReadBudget() {
  /** @type {Set<string>} */
  const used = new Set()
  return {
    tryConsume(key) {
      if (used.has(key)) return false
      used.add(key)
      return true
    },
  }
}
