// @ts-check
/**
 * Stable-for-duration window: only real advancing samples prove coverage.
 * Wall-clock waiting and repeated cache hits of the same record do not.
 */
import { unavailable, UNAVAILABLE_REASONS } from './observation.mjs'

/**
 * @typedef {{ value: any, timestamp: number, identity?: string, generation?: string }} StableSample
 * @typedef {import('./observation.mjs').UnavailableObservation} UnavailableObservation
 */

/**
 * @param {{
 *   startedAt: number,
 *   durationMs: number,
 * }} opts
 */
export function createStableWindow(opts) {
  const startedAt = Number(opts.startedAt)
  const durationMs = Number(opts.durationMs)
  /** @type {StableSample[]} */
  const accepted = []
  /** @type {string | null} */
  let identity = null
  /** @type {string | null} */
  let generation = null
  /** @type {number | null} */
  let firstAt = null
  /** @type {number | null} */
  let requiredEndAt = null

  /**
   * @param {StableSample | UnavailableObservation} sample
   * @returns {{ status: 'wait' | 'continue' | 'done' | 'unavailable', unavailable?: UnavailableObservation, values?: any[] }}
   */
  function accept(sample) {
    if (sample && /** @type {any} */ (sample).availability === 'unavailable') {
      const u = /** @type {UnavailableObservation} */ (sample)
      // Before the first in-window sample, DATA_MISSING means keep waiting.
      if (firstAt == null && u.reason === UNAVAILABLE_REASONS.DATA_MISSING) {
        return { status: 'wait' }
      }
      return { status: 'unavailable', unavailable: u }
    }
    const s = /** @type {StableSample} */ (sample)
    const ts = Number(s.timestamp)
    if (!Number.isFinite(ts) || ts <= 0) {
      return {
        status: 'unavailable',
        unavailable: unavailable(UNAVAILABLE_REASONS.DATA_MISSING, '采样缺少记录时间'),
      }
    }
    // History before this assertion started cannot prove this window.
    if (ts < startedAt) return { status: 'wait' }

    const id = s.identity == null ? '' : String(s.identity)
    const gen = s.generation == null ? '' : String(s.generation)
    if (firstAt == null) {
      firstAt = ts
      requiredEndAt = ts + durationMs
      identity = id
      generation = gen
      accepted.push(s)
      return { status: 'continue' }
    }
    if (id !== identity || gen !== generation) {
      return {
        status: 'unavailable',
        unavailable: unavailable(
          UNAVAILABLE_REASONS.STALE_VALUE,
          '采样配置已改变，无法证明同一窗口稳定',
        ),
      }
    }
    const prev = accepted[accepted.length - 1]
    if (ts === prev.timestamp) {
      if (!Object.is(s.value, prev.value)) {
        return {
          status: 'unavailable',
          unavailable: unavailable(UNAVAILABLE_REASONS.INVALID_SAMPLE, '同一采样时间出现矛盾值'),
        }
      }
      // Same record checked again — not a new sample.
      return { status: 'continue' }
    }
    if (ts < prev.timestamp) {
      return {
        status: 'unavailable',
        unavailable: unavailable(UNAVAILABLE_REASONS.INVALID_SAMPLE, '采样时间倒退，不能作为覆盖证据'),
      }
    }
    accepted.push(s)
    return { status: 'continue' }
  }

  /**
   * @param {number} now
   * @returns {{ ok: true, values: any[], sampleCount: number, coveredMs: number, requiredDurationMs: number } | UnavailableObservation}
   */
  function finish(now) {
    if (firstAt == null) {
      return unavailable(
        UNAVAILABLE_REASONS.INSUFFICIENT_SAMPLES,
        `采样不足 (在 ${durationMs}ms 内未获得本轮有效采样)`,
      )
    }
    const end = Number(now)
    if (!Number.isFinite(end) || (requiredEndAt != null && end < requiredEndAt)) {
      // Caller should keep waiting; if forced to finish early treat as insufficient.
      return unavailable(
        UNAVAILABLE_REASONS.INSUFFICIENT_SAMPLES,
        `采样不足 (稳定窗口尚未结束)`,
      )
    }
    if (accepted.length < 2) {
      return unavailable(
        UNAVAILABLE_REASONS.INSUFFICIENT_SAMPLES,
        `采样不足 (有效采样数 ${accepted.length} < 2)`,
      )
    }
    const lastAt = accepted[accepted.length - 1].timestamp
    const coveredMs = lastAt - /** @type {number} */ (firstAt)
    if (coveredMs < durationMs) {
      return unavailable(
        UNAVAILABLE_REASONS.INSUFFICIENT_SAMPLES,
        `采样不足 (有效覆盖 ${coveredMs}ms < 要求 ${durationMs}ms)`,
      )
    }
    return {
      ok: true,
      values: accepted.map((s) => s.value),
      sampleCount: accepted.length,
      coveredMs,
      requiredDurationMs: durationMs,
    }
  }

  return {
    accept,
    finish,
    /** @returns {number | null} */
    get requiredEndAt() {
      return requiredEndAt
    },
    /** @returns {number} */
    get sampleCount() {
      return accepted.length
    },
  }
}
