// @ts-check

/**
 * Reasons an assertion could not be judged. None of them say the device failed
 * the expectation; they say the run had no trustworthy data to compare.
 */
export const UNAVAILABLE_REASONS = Object.freeze({
  DATA_MISSING: 'DATA_MISSING',
  STALE_VALUE: 'STALE_VALUE',
  BAD_QUALITY: 'BAD_QUALITY',
  INVALID_SAMPLE: 'INVALID_SAMPLE',
  INSUFFICIENT_SAMPLES: 'INSUFFICIENT_SAMPLES',
  TARGET_UNAVAILABLE: 'TARGET_UNAVAILABLE',
  AMBIGUOUS_OWNER: 'AMBIGUOUS_OWNER',
  READ_FAILED: 'READ_FAILED',
  BASELINE_MISSING: 'BASELINE_MISSING',
  NO_ALARM_SOURCE: 'NO_ALARM_SOURCE',
  NO_DEBUG_SESSION: 'NO_DEBUG_SESSION',
})

/** @type {Record<string, string>} */
const DEFAULT_MESSAGES = {
  DATA_MISSING: '当前无可用采样',
  STALE_VALUE: '采样已过旧',
  BAD_QUALITY: '采样质量不可信',
  INVALID_SAMPLE: '采样不是有效数值',
  INSUFFICIENT_SAMPLES: '有效采样不足',
  TARGET_UNAVAILABLE: '目标不可用',
  AMBIGUOUS_OWNER: '目标归属不唯一',
  READ_FAILED: '读取失败',
  BASELINE_MISSING: '缺少变化判断的初值',
  NO_ALARM_SOURCE: '没有可判定的告警来源',
  NO_DEBUG_SESSION: '未关联活跃调试会话',
}

/**
 * @typedef {{ availability: 'unavailable', reason: string, message: string } & Record<string, any>} UnavailableObservation
 */

/**
 * @param {string} reason
 * @param {string} [message]
 * @param {Record<string, any>} [extra]
 * @returns {UnavailableObservation}
 */
export function unavailable(reason, message, extra = {}) {
  return { ...extra, availability: 'unavailable', reason, message: message || DEFAULT_MESSAGES[reason] || reason }
}

/**
 * @param {unknown} value
 * @returns {value is UnavailableObservation}
 */
export function isUnavailable(value) {
  return Boolean(value && typeof value === 'object' && /** @type {any} */ (value).availability === 'unavailable')
}

/** Trimmed case-insensitive spellings that must not be compared as scalars. */
const NONFINITE_SPELLINGS = new Set(['nan', 'infinity', '+infinity', '-infinity'])

/**
 * Safe text for logs/messages. Avoids `JSON.stringify(NaN) → null` rewriting the reason.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function formatComparableScalar(value) {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN'
    if (value === Number.POSITIVE_INFINITY) return 'Infinity'
    if (value === Number.NEGATIVE_INFINITY) return '-Infinity'
  }
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * A comparable scalar: present, finite when numeric, and not a non-finite spelling
 * string (`NaN` / `Infinity` / `±Infinity`, trim + case-insensitive). `0` and
 * `false` and ordinary strings stay valid.
 *
 * @param {unknown} value
 * @returns {UnavailableObservation | null}
 */
export function scalarProblem(value) {
  if (value === undefined || value === null) return unavailable(UNAVAILABLE_REASONS.DATA_MISSING)
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return unavailable(UNAVAILABLE_REASONS.INVALID_SAMPLE)
  }
  if (typeof value === 'string' && NONFINITE_SPELLINGS.has(value.trim().toLowerCase())) {
    return unavailable(UNAVAILABLE_REASONS.INVALID_SAMPLE)
  }
  return null
}

/**
 * A numeric sample for range/stable checks. Blank values are checked before
 * `Number()` so `null` never becomes `0`.
 *
 * @param {unknown} value
 * @returns {{ ok: true, num: number } | { ok: false, problem: UnavailableObservation }}
 */
export function numericSample(value) {
  if (value === undefined || value === null || value === '') {
    return { ok: false, problem: unavailable(UNAVAILABLE_REASONS.DATA_MISSING) }
  }
  const num = typeof value === 'boolean' ? Number.NaN : Number(value)
  if (!Number.isFinite(num)) return { ok: false, problem: unavailable(UNAVAILABLE_REASONS.INVALID_SAMPLE) }
  return { ok: true, num }
}
