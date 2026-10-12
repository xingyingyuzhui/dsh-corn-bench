// @ts-check

import {
  isUnavailable,
  SAMPLE_STAMP_MESSAGES,
  scalarProblem,
  unavailable,
  UNAVAILABLE_REASONS,
} from '../../domain/verify/observation.mjs'
import { isTimeoutOrAborted, withTimeoutSignal } from './verify-timeout.mjs'

/**
 * @typedef {import('../../domain/verify/observation.mjs').UnavailableObservation} UnavailableObservation
 * @typedef {{
 *   value: any,
 *   rawValue: any,
 *   timestamp: number,
 *   quality: string,
 *   provenance: string,
 *   fingerprint: string,
 *   generation: string,
 * }} ObservedReading
 * @typedef {{ availability: 'available', reading: ObservedReading } | UnavailableObservation} Observation
 */

const TRUSTED_QUALITIES = new Set(['good', 'unknown', 'ok', ''])

/**
 * Normalise whatever a telemetry reader returned into an explicit observation.
 * Validity never rests on the object being truthy: the value must be present,
 * the record must carry its own timestamp, and quality/age must be acceptable.
 *
 * @param {any} reading
 * @param {{ maxAgeMs?: number, now?: number }} [opts]
 * @returns {Observation}
 */
export function observeReading(reading, opts = {}) {
  if (isUnavailable(reading)) return reading
  if (reading && reading.availability === 'available') return observeReading(reading.reading, opts)
  if (!reading || typeof reading !== 'object') return unavailable(UNAVAILABLE_REASONS.DATA_MISSING)

  const quality = String(reading.quality ?? reading.status ?? '').toLowerCase()
  if (quality === 'stale') {
    return unavailable(UNAVAILABLE_REASONS.STALE_VALUE, `采样已过旧 (采集延时 ${reading.freshnessMs ?? '?'}ms)`)
  }
  if (!TRUSTED_QUALITIES.has(quality)) {
    return unavailable(UNAVAILABLE_REASONS.BAD_QUALITY, `采样质量为 ${quality}`)
  }

  const value = reading.value !== undefined ? reading.value : reading.rawValue
  const problem = scalarProblem(value)
  if (problem) return problem

  const timestamp = Number(reading.timestamp)
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return unavailable(UNAVAILABLE_REASONS.DATA_MISSING, '采样缺少记录时间')
  }
  const fingerprint = typeof reading.fingerprint === 'string' ? reading.fingerprint : ''
  const generation = typeof reading.generation === 'string' ? reading.generation : ''
  if (!fingerprint || !generation) {
    return unavailable(UNAVAILABLE_REASONS.INVALID_SAMPLE, SAMPLE_STAMP_MESSAGES.MISSING)
  }
  const now = opts.now ?? Date.now()
  if (timestamp > now) {
    return unavailable(UNAVAILABLE_REASONS.INVALID_SAMPLE, SAMPLE_STAMP_MESSAGES.FUTURE)
  }
  const maxAgeMs = opts.maxAgeMs
  if (typeof maxAgeMs === 'number' && Number.isFinite(maxAgeMs)) {
    const age = now - timestamp
    if (age > maxAgeMs) {
      return unavailable(UNAVAILABLE_REASONS.STALE_VALUE, `采样已过旧 (采集延时 ${age}ms > 允许最大延时 ${maxAgeMs}ms)`)
    }
  }
  return {
    availability: 'available',
    reading: {
      value,
      rawValue: reading.rawValue !== undefined ? reading.rawValue : value,
      timestamp,
      quality: quality || 'unknown',
      provenance: String(reading.provenance || reading.source || ''),
      fingerprint,
      generation,
    },
  }
}

/**
 * Debug evaluate responses: an explicit error or a missing value is not data.
 *
 * @param {any} res
 * @returns {{ availability: 'available', value: any } | UnavailableObservation}
 */
export function observeDebugValue(res) {
  if (isUnavailable(res)) return res
  if (res && (res.ok === false || res.error)) {
    return unavailable(UNAVAILABLE_REASONS.READ_FAILED, String(res.error || '调试表达式求值失败'))
  }
  const problem = scalarProblem(res?.value)
  if (problem) return problem
  return { availability: 'available', value: res.value }
}

/**
 * Run one I/O step under the run's signal. Timeout and cancellation propagate
 * unchanged; any other rejection becomes READ_FAILED for this sample only.
 *
 * @template T
 * @param {() => Promise<T> | T} fn
 * @param {AbortSignal} signal
 * @returns {Promise<T | UnavailableObservation>}
 */
export async function observeCall(fn, signal) {
  try {
    return await withTimeoutSignal(Promise.resolve().then(fn), signal)
  } catch (err) {
    const e = /** @type {any} */ (err)
    if (isTimeoutOrAborted(err, signal) || e?.name === 'AbortError' || e?.message === 'VERIFY_CANCELLED') throw err
    return unavailable(UNAVAILABLE_REASONS.READ_FAILED, e instanceof Error ? e.message : String(e))
  }
}
