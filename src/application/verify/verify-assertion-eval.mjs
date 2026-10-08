// @ts-check

import { unavailable, UNAVAILABLE_REASONS } from '../../domain/verify/observation.mjs'
import { countSessionAlarms } from './verify-alarm-scope.mjs'
import { evaluateDebugExpression, readTelemetryPoint, sampleStableDuration } from './verify-sampling.mjs'

/**
 * Resolve the actual value for one assertion spec (sampling + domain reads).
 * Returns either the value to compare or an unavailable observation carrying
 * the reason; domain `evaluateAssertion` turns the latter into `unverifiable`.
 * Only timeout/cancellation and unexpected internal faults throw.
 *
 * @param {import('./verify-sampling.mjs').VerifySampleContext & {
 *   workspaceLoader?: (cwd: string) => any,
 * }} ctx
 * @param {any} spec
 * @returns {Promise<any>}
 */
export async function resolveAssertionActual(ctx, spec) {
  const { debugRuntime, debugSessionId, ownerSessionId, workspaceCwd, workspaceLoader, checkDeadline } = ctx
  const expr = spec.expr || spec.expression || spec.source?.expr || spec.source?.expression
  const pointId = spec.pointId || spec.source?.pointId
  const maxAgeMs = typeof spec.maxAgeMs === 'number' ? spec.maxAgeMs : undefined
  const hasDebug = Boolean(debugRuntime && debugSessionId)

  /** Current value of the assertion's expression or point, as value-or-unavailable. */
  const sampleOnce = async () => {
    if (expr && hasDebug) {
      const observed = await evaluateDebugExpression(ctx, expr)
      checkDeadline()
      return observed.availability === 'available' ? observed.value : observed
    }
    if (pointId && spec.type !== 'debug.expression') {
      const observed = await readTelemetryPoint(ctx, pointId, { maxAgeMs })
      checkDeadline()
      return observed.availability === 'available' ? observed.reading.value : observed
    }
    if (expr) return unavailable(UNAVAILABLE_REASONS.NO_DEBUG_SESSION)
    return unavailable(UNAVAILABLE_REASONS.DATA_MISSING)
  }

  switch (spec.type) {
    case 'debug.expression':
    case 'modbus.point':
    case 'range':
      return sampleOnce()

    case 'changed': {
      if (spec.value === undefined || spec.value === null) return unavailable(UNAVAILABLE_REASONS.BASELINE_MISSING)
      return { initial: spec.value, current: await sampleOnce() }
    }

    case 'no.exception': {
      if (!hasDebug) return unavailable(UNAVAILABLE_REASONS.NO_DEBUG_SESSION, '未关联活跃调试会话，无法确认异常状态')
      let evData
      try {
        evData = debugRuntime.getEvents({ debugSessionId, ownerSessionId }, 0, 500)
      } catch (err) {
        return unavailable(UNAVAILABLE_REASONS.READ_FAILED, err instanceof Error ? err.message : String(err))
      }
      const events = evData?.events || []
      return events.some(
        (/** @type {any} */ e) =>
          e.type === 'debug.exception' || (e.type === 'debug.paused' && e.payload?.reason === 'exception'),
      )
    }

    case 'no.alarm':
      return countSessionAlarms(workspaceLoader?.(workspaceCwd), ownerSessionId, pointId)

    case 'stable-for-duration':
      return sampleStableDuration(ctx, spec)

    default:
      return undefined
  }
}
