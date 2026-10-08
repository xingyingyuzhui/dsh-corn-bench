// @ts-check

import {
  formatComparableScalar,
  isUnavailable,
  numericSample,
  scalarProblem,
  unavailable,
  UNAVAILABLE_REASONS,
} from './observation.mjs'

/**
 * @typedef {import('../../types/verify.d.ts').AssertionResult} AssertionResult
 * @typedef {import('../../types/verify.d.ts').AssertionSpec} AssertionSpec
 * @typedef {import('./observation.mjs').UnavailableObservation} UnavailableObservation
 * @typedef {Omit<AssertionResult, 'id' | 'type' | 'timestamp' | 'outcome'>} Judgement
 */

/**
 * Compares actual and expected values using the specified operator.
 * Performs numeric coercion when both operands are valid finite numbers.
 *
 * @param {any} actual
 * @param {import('../../types/verify.d.ts').AssertionOperator | string} op
 * @param {any} expected
 * @returns {boolean}
 */
export function evaluateOperator(actual, op, expected) {
  const numActual = Number(actual)
  const numExpected = Number(expected)
  const numeric =
    actual !== null &&
    actual !== '' &&
    expected !== null &&
    expected !== '' &&
    Number.isFinite(numActual) &&
    Number.isFinite(numExpected)

  const a = numeric ? numActual : actual
  const e = numeric ? numExpected : expected

  switch (op) {
    case '==':
      return a === e || String(a) === String(e)
    case '!=':
      return a !== e && String(a) !== String(e)
    case '>':
      return a > e
    case '>=':
      return a >= e
    case '<':
      return a < e
    case '<=':
      return a <= e
    case 'in':
      if (Array.isArray(expected)) {
        return expected.includes(a) || expected.includes(actual)
      }
      return false
    case 'matches':
      try {
        const re = new RegExp(String(expected))
        return re.test(String(actual))
      } catch {
        return false
      }
    default:
      return a === e || String(a) === String(e)
  }
}

/**
 * Evaluates a single assertion spec against collected data. Data availability is
 * checked first: missing, stale or invalid samples yield `outcome: 'unverifiable'`
 * (still `pass: false`) instead of being compared as if they were real values.
 *
 * @param {AssertionSpec} spec
 * @param {any} actualValue
 * @returns {AssertionResult}
 */
export function evaluateAssertion(spec, actualValue) {
  const id = spec.id || `${spec.type}_${Math.random().toString(36).slice(2, 7)}`
  const timestamp = Date.now()
  const upfront = isUnavailable(actualValue) ? actualValue : legacyProblem(spec, actualValue)
  const judged = upfront || judge(spec, actualValue)
  if (isUnavailable(judged)) {
    return {
      id,
      type: spec.type,
      pass: false,
      outcome: 'unverifiable',
      reason: judged.reason,
      actual: null,
      expected: expectedOf(spec),
      ...(spec.op ? { op: spec.op } : {}),
      message: `${targetName(spec)} 无法验证: ${judged.message}`,
      timestamp,
    }
  }
  return { id, type: spec.type, ...judged, outcome: judged.pass ? 'pass' : 'fail', timestamp }
}

/**
 * Older samplers report "no source" as `{ error, message }`; treat those as
 * unverifiable rather than as a failed comparison.
 *
 * @param {AssertionSpec} spec
 * @param {any} actual
 * @returns {UnavailableObservation | null}
 */
function legacyProblem(spec, actual) {
  if (spec.type !== 'no.exception' && spec.type !== 'no.alarm') return null
  if (actual && typeof actual === 'object' && !Array.isArray(actual) && actual.error) {
    return unavailable(String(actual.error), actual.message)
  }
  if (actual === undefined || actual === null) return unavailable(UNAVAILABLE_REASONS.DATA_MISSING)
  return null
}

/** @param {AssertionSpec} spec */
function targetName(spec) {
  if (spec.description) return spec.description
  if (spec.type === 'no.exception') return '调试会话'
  if (spec.type === 'no.alarm') return spec.pointId ? `点位 [${spec.pointId}]` : '本会话'
  if (spec.type === 'debug.expression') return `Debug 表达式 [${spec.expr || ''}]`
  if (spec.type === 'modbus.point') return `Modbus 点位 [${spec.pointId || ''}]`
  return spec.expr ? `表达式 [${spec.expr}]` : `点位 [${spec.pointId || ''}]`
}

/** @param {AssertionSpec} spec */
function expectedOf(spec) {
  switch (spec.type) {
    case 'no.exception':
      return 'none'
    case 'no.alarm':
      return 0
    case 'range':
      return `[${spec.min ?? '-inf'}, ${spec.max ?? '+inf'}]`
    case 'changed':
      return `changed (from ${formatComparableScalar(spec.value)})`
    default:
      return spec.value
  }
}

/**
 * @param {AssertionSpec} spec
 * @param {any} actual
 * @returns {Judgement | UnavailableObservation}
 */
function judge(spec, actual) {
  switch (spec.type) {
    case 'debug.expression':
    case 'modbus.point':
      return judgeComparison(spec, actual)
    case 'no.exception':
      return judgeNoException(actual)
    case 'no.alarm':
      return judgeNoAlarm(spec, actual)
    case 'range':
      return judgeRange(spec, actual)
    case 'changed':
      return judgeChanged(spec, actual)
    case 'stable-for-duration':
      return judgeStable(spec, actual)
    default:
      return {
        pass: false,
        actual,
        expected: spec.value,
        message: `不支持的断言类型: ${spec.type}`,
      }
  }
}

/**
 * @param {AssertionSpec} spec
 * @param {any} actual
 * @returns {Judgement | UnavailableObservation}
 */
function judgeComparison(spec, actual) {
  const op = spec.op || '=='
  let value = actual
  if (spec.type === 'modbus.point' && actual && typeof actual === 'object') {
    if (actual.quality === 'stale') {
      return unavailable(
        UNAVAILABLE_REASONS.STALE_VALUE,
        `数据已过旧 (采集延时 ${actual.freshnessMs || 0}ms > 允许最大延时 ${spec.maxAgeMs ?? 'unknown'}ms)`,
      )
    }
    value = actual.value !== undefined ? actual.value : actual.rawValue
  }
  const problem = scalarProblem(value)
  if (problem) return problem
  const pass = evaluateOperator(value, op, spec.value)
  const desc = targetName(spec)
  const actualText = formatComparableScalar(value)
  const expectedText = formatComparableScalar(spec.value)
  return {
    pass,
    actual: value,
    expected: spec.value,
    op,
    message: pass
      ? `${desc} 断言通过 (${actualText} ${op} ${expectedText})`
      : `${desc} 断言失败: 实际值 ${actualText} 不满足 ${op} ${expectedText}`,
  }
}

/**
 * @param {any} actual
 * @returns {Judgement}
 */
function judgeNoException(actual) {
  let hasException = false
  if (typeof actual === 'boolean') {
    hasException = actual
  } else if (Array.isArray(actual)) {
    hasException = actual.length > 0
  } else if (actual && typeof actual === 'object') {
    hasException = Boolean(actual.hasException || actual.exception)
  }
  return {
    pass: !hasException,
    actual: hasException ? (Array.isArray(actual) ? actual : 'exception-detected') : 'none',
    expected: 'none',
    message: hasException ? '检测到异常/硬件故障停机' : '无未捕获异常/故障停机',
  }
}

/**
 * @param {AssertionSpec} spec
 * @param {any} actual
 * @returns {Judgement | UnavailableObservation}
 */
function judgeNoAlarm(spec, actual) {
  let activeAlarms = null
  if (typeof actual === 'number') {
    activeAlarms = actual
  } else if (Array.isArray(actual)) {
    activeAlarms = actual.length
  } else if (actual && typeof actual === 'object') {
    if (typeof actual.activeCount === 'number') activeAlarms = actual.activeCount
    else if (Array.isArray(actual.alarms)) activeAlarms = actual.alarms.length
  }
  if (activeAlarms === null || !Number.isFinite(activeAlarms)) return unavailable(UNAVAILABLE_REASONS.DATA_MISSING)
  const pass = activeAlarms === 0
  const desc = targetName(spec)
  return {
    pass,
    actual: activeAlarms,
    expected: 0,
    op: '==',
    message: pass ? `${desc} 无活跃告警` : `${desc} 存在 ${activeAlarms} 项活跃告警`,
  }
}

/**
 * @param {AssertionSpec} spec
 * @param {any} actual
 * @returns {Judgement | UnavailableObservation}
 */
function judgeRange(spec, actual) {
  const sample = numericSample(actual)
  if (!sample.ok) return sample.problem
  const num = sample.num
  const min = spec.min != null ? Number(spec.min) : Number.NEGATIVE_INFINITY
  const max = spec.max != null ? Number(spec.max) : Number.POSITIVE_INFINITY
  const pass = num >= min && num <= max
  const name = targetName(spec)
  return {
    pass,
    actual,
    expected: `[${min}, ${max}]`,
    message: pass ? `${name} 数值 ${num} 在期望区间 [${min}, ${max}] 内` : `${name} 数值 ${num} 超出期望区间 [${min}, ${max}]`,
  }
}

/**
 * @param {AssertionSpec} spec
 * @param {any} actual
 * @returns {Judgement | UnavailableObservation}
 */
function judgeChanged(spec, actual) {
  const name = targetName(spec)
  if (typeof actual === 'boolean') {
    return {
      pass: actual,
      actual,
      expected: 'changed',
      message: actual ? `${name} 发生状态变化` : `${name} 未发生预期变化`,
    }
  }
  if (!actual || typeof actual !== 'object' || !('initial' in actual) || !('current' in actual)) {
    return unavailable(UNAVAILABLE_REASONS.DATA_MISSING)
  }
  const initial = actual.initial
  if (initial === undefined || initial === null) return unavailable(UNAVAILABLE_REASONS.BASELINE_MISSING)
  const baselineProblem = scalarProblem(initial)
  if (baselineProblem) return baselineProblem
  if (isUnavailable(actual.current)) return actual.current
  const problem = scalarProblem(actual.current)
  if (problem) return problem
  const current = actual.current
  // Compare raw scalars; do not coerce via String/Number before difference.
  const pass = evaluateOperator(current, '!=', initial)
  const fromText = formatComparableScalar(initial)
  const toText = formatComparableScalar(current)
  return {
    pass,
    actual: current,
    expected: `changed (from ${fromText})`,
    message: pass ? `${name} 发生状态变化 (${fromText} -> ${toText})` : `${name} 未发生预期变化 (仍为 ${fromText})`,
  }
}

/**
 * Every sample must be usable: one bad sample makes the whole window
 * unverifiable instead of being dropped from the statistics.
 *
 * @param {AssertionSpec} spec
 * @param {any} actual
 * @returns {Judgement | UnavailableObservation}
 */
function judgeStable(spec, actual) {
  const tolerance = spec.tolerance != null ? Number(spec.tolerance) : null
  const minBound = spec.min != null ? Number(spec.min) : null
  const maxBound = spec.max != null ? Number(spec.max) : null
  const name = targetName(spec)
  let expectedDesc = ''
  if (tolerance != null) expectedDesc += `波动 <= ${tolerance} `
  if (minBound != null) expectedDesc += `>= ${minBound} `
  if (maxBound != null) expectedDesc += `<= ${maxBound} `
  const expected = expectedDesc.trim() || '保持稳定'

  if (actual && typeof actual === 'object' && !Array.isArray(actual) && 'maxDelta' in actual) {
    const sampleCount = Number(actual.sampleCount)
    if (actual.sampleCount !== undefined && !(sampleCount >= 2)) {
      return unavailable(UNAVAILABLE_REASONS.INSUFFICIENT_SAMPLES, `采样不足 (有效采样数 ${sampleCount || 0} < 2)，无法判定稳定性`)
    }
    const delta = numericSample(actual.maxDelta)
    if (!delta.ok) return delta.problem
    const pass = tolerance == null || delta.num <= tolerance
    return {
      pass,
      actual: { maxDelta: delta.num, sampleCount: actual.sampleCount },
      expected,
      op: '<=',
      message: pass ? `${name} 在持续期间保持稳定 (波动 ${delta.num})` : `${name} 在持续期间波动过大 (波动 ${delta.num} > 容差 ${tolerance})`,
    }
  }
  if (!Array.isArray(actual)) return unavailable(UNAVAILABLE_REASONS.DATA_MISSING)

  /** @type {number[]} */
  const nums = []
  for (const raw of actual) {
    if (isUnavailable(raw)) return raw
    const sample = numericSample(raw)
    if (!sample.ok) return sample.problem
    nums.push(sample.num)
  }
  if (nums.length < 2) {
    return unavailable(UNAVAILABLE_REASONS.INSUFFICIENT_SAMPLES, `采样不足 (有效采样数 ${nums.length} < 2)，无法判定稳定性`)
  }
  const minSample = Math.min(...nums)
  const maxSample = Math.max(...nums)
  const maxDelta = maxSample - minSample
  const toleranceOk = tolerance == null || maxDelta <= tolerance
  const boundsOk = (minBound == null || minSample >= minBound) && (maxBound == null || maxSample <= maxBound)
  const pass = toleranceOk && boundsOk
  let message = `${name} 在持续期间保持稳定 (${nums.length} 采样, 范围 [${minSample}, ${maxSample}], 波动 ${maxDelta})`
  if (!boundsOk) {
    message = `${name} 在持续期间数值超出限定范围 [${minBound ?? '-inf'}, ${maxBound ?? '+inf'}] (实际采样范围 [${minSample}, ${maxSample}])`
  } else if (!toleranceOk) {
    message = `${name} 在持续期间波动过大 (波动 ${maxDelta} > 容差 ${tolerance})`
  }
  return {
    pass,
    actual: { min: minSample, max: maxSample, maxDelta, sampleCount: nums.length },
    expected,
    op: '<=',
    message,
  }
}
