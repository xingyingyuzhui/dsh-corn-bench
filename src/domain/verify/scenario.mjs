// @ts-check

import { VerifyRequestError } from './errors.mjs'
import { formatComparableScalar, scalarProblem, UNAVAILABLE_REASONS } from './observation.mjs'

export const DEFAULT_SCENARIO_TIMEOUT_MS = 60000
export const DEFAULT_STABLE_DURATION_MS = 1000

/**
 * The timeout a run actually gets: caller override, then scenario, then default.
 *
 * @param {any} scenario
 * @param {unknown} [override]
 * @returns {number}
 */
export function effectiveTimeoutMs(scenario, override) {
  return Number(override) || Number(scenario?.timeoutMs) || DEFAULT_SCENARIO_TIMEOUT_MS
}

/**
 * `durationMs` of a stable-for-duration assertion; `null` when explicitly invalid.
 *
 * @param {any} spec
 * @returns {number | null}
 */
export function stableDurationMs(spec) {
  if (spec?.durationMs === undefined) return DEFAULT_STABLE_DURATION_MS
  const ms = spec.durationMs
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : null
}

/**
 * Same alias priority as `createScenario`: `value` when not undefined, else `expected`.
 *
 * @param {any} spec
 * @returns {{ field: 'value' | 'expected', baseline: unknown } | null}
 */
export function resolveChangedBaseline(spec) {
  if (!spec || typeof spec !== 'object') return null
  if (spec.value !== undefined) return { field: 'value', baseline: spec.value }
  if (spec.expected !== undefined) return { field: 'expected', baseline: spec.expected }
  return null
}

/**
 * Reject stable windows that cannot fit the run's total budget, before anything
 * is registered or sampled. Shortening the window would let it "pass" on less
 * evidence than requested.
 *
 * @param {any} scenario
 * @param {number} timeoutMs
 */
export function assertScenarioBudget(scenario, timeoutMs) {
  const assertions = Array.isArray(scenario?.assertions) ? scenario.assertions : []
  for (const spec of assertions) {
    if (!spec || spec.type !== 'stable-for-duration') continue
    const durationMs = stableDurationMs(spec)
    if (durationMs !== null && durationMs <= timeoutMs) continue
    throw new VerifyRequestError(
      'INVALID_FIELD',
      durationMs === null
        ? 'stable-for-duration 的 durationMs 必须是有限正数'
        : `stable-for-duration 的 durationMs (${durationMs}ms) 超过验证总超时 (${timeoutMs}ms)`,
      {
        field: 'durationMs',
        reason: 'INVALID_VALUE',
        durationMs: spec.durationMs,
        timeoutMs,
        ...(spec.id ? { assertionId: spec.id } : {}),
      },
    )
  }
}

/**
 * Reject `changed` assertions whose baseline is not a comparable scalar, before
 * a run is registered or sampled. Missing baseline stays a runtime
 * BASELINE_MISSING; non-finite numbers/spellings are INVALID_FIELD.
 *
 * @param {any} scenario
 */
export function assertChangedBaselines(scenario) {
  const assertions = Array.isArray(scenario?.assertions) ? scenario.assertions : []
  for (const spec of assertions) {
    if (!spec || spec.type !== 'changed') continue
    const resolved = resolveChangedBaseline(spec)
    if (!resolved) continue
    const { field, baseline } = resolved
    if (baseline === null) continue
    const problem = scalarProblem(baseline)
    if (!problem || problem.reason !== UNAVAILABLE_REASONS.INVALID_SAMPLE) continue
    throw new VerifyRequestError(
      'INVALID_FIELD',
      `changed 的初值 (${formatComparableScalar(baseline)}) 不是有效可比较标量`,
      {
        field,
        reason: 'INVALID_VALUE',
        ...(spec.id ? { assertionId: spec.id } : {}),
      },
    )
  }
}

export const VALID_ASSERTION_TYPES = new Set([
  'debug.expression',
  'modbus.point',
  'no.exception',
  'no.alarm',
  'range',
  'changed',
  'stable-for-duration',
])

/**
 * Validates a Scenario specification.
 * Throws descriptive Error if invalid.
 *
 * @param {any} scenario
 * @returns {asserts scenario is import('../../types/verify.d.ts').ScenarioSpec}
 */
export function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object') {
    throw new Error('场景配置必须是一个非空对象')
  }

  if (!scenario.id || typeof scenario.id !== 'string') {
    throw new Error('场景配置缺少有效的 id 字段')
  }

  if (!scenario.name || typeof scenario.name !== 'string') {
    throw new Error('场景配置缺少有效的 name 字段')
  }

  if (!Array.isArray(scenario.assertions) || scenario.assertions.length === 0) {
    throw new Error('场景配置必须包含至少一项断言 (assertions)')
  }

  for (let i = 0; i < scenario.assertions.length; i++) {
    const a = scenario.assertions[i]
    if (!a || typeof a !== 'object') {
      throw new Error(`第 ${i + 1} 项断言不是有效对象`)
    }
    if (!a.type || !VALID_ASSERTION_TYPES.has(a.type)) {
      throw new Error(`第 ${i + 1} 项断言包含未知或未支持的类型: ${a.type}`)
    }
    const expr = a.expr || a.expression || a.source?.expr || a.source?.expression
    if (a.type === 'debug.expression' && (!expr || typeof expr !== 'string')) {
      throw new Error(`第 ${i + 1} 项 debug.expression 断言缺少 expr 表达式`)
    }
    const pointId = a.pointId || a.source?.pointId
    if (a.type === 'modbus.point' && (!pointId || typeof pointId !== 'string')) {
      throw new Error(`第 ${i + 1} 项 modbus.point 断言缺少 pointId 字段`)
    }
  }
}

/**
 * Creates and normalizes a scenario object.
 *
 * @param {import('../../types/verify.d.ts').ScenarioSpec} spec
 * @returns {import('../../types/verify.d.ts').ScenarioSpec}
 */
export function createScenario(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('场景配置必须是一个非空对象')
  }
  const id = spec.id || `scenario_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const normalizedSpec = { ...spec, id }
  validateScenario(normalizedSpec)
  return {
    id,
    name: normalizedSpec.name,
    description: normalizedSpec.description || '',
    timeoutMs:
      typeof normalizedSpec.timeoutMs === 'number' ? normalizedSpec.timeoutMs : DEFAULT_SCENARIO_TIMEOUT_MS,
    assertions: normalizedSpec.assertions.map((a, index) => {
      const expr = a.expr || a.expression || a.source?.expr || a.source?.expression
      const pointId = a.pointId || a.source?.pointId
      const op = a.op || a.operator || '=='
      const value = a.value !== undefined ? a.value : a.expected
      return {
        ...a,
        id: a.id || `assert_${index + 1}_${Math.random().toString(36).slice(2, 6)}`,
        expr,
        pointId,
        op,
        value,
      }
    }),
    targetSpec: spec.targetSpec || {},
    setup: spec.setup || {},
  }
}
