// @ts-check

import { unavailable, UNAVAILABLE_REASONS } from '../../domain/verify/observation.mjs'
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
      return countActiveAlarms(workspaceLoader?.(workspaceCwd), pointId)

    case 'stable-for-duration':
      return sampleStableDuration(ctx, spec)

    default:
      return undefined
  }
}

/**
 * @param {any} ws
 * @param {string | undefined} pointId
 */
function countActiveAlarms(ws, pointId) {
  const modbus = ws?.modbus || ws
  const points = Array.isArray(modbus?.points) ? modbus.points : []
  const alarmState =
    (modbus && typeof modbus === 'object' && modbus.alarmState) || (ws && typeof ws === 'object' && ws.alarmState) || {}
  const legacyAlarms = (ws && Array.isArray(ws.alarms) ? ws.alarms : []).concat(
    modbus && Array.isArray(modbus.alarms) ? modbus.alarms : [],
  )
  const hasAlarmSource = Boolean(
    ws && (points.length > 0 || Object.keys(alarmState).length > 0 || legacyAlarms.length > 0),
  )
  if (!hasAlarmSource) return unavailable(UNAVAILABLE_REASONS.NO_ALARM_SOURCE, '工作区无有效点位或告警源')
  /** @param {any} a */
  const activeState = (a) => a && (a.condition === 'active' || a.status === 'active' || a === true)
  /** @param {any} a */
  const activeLegacy = (a) => a && (a.active || a.condition === 'active')

  if (pointId) {
    const pointExists =
      points.some((/** @type {any} */ p) => p && p.id === pointId) ||
      alarmState[pointId] !== undefined ||
      legacyAlarms.some((/** @type {any} */ a) => a && (a.pointId === pointId || a.id === pointId))
    if (!pointExists && points.length > 0) {
      return unavailable(UNAVAILABLE_REASONS.TARGET_UNAVAILABLE, `点位 [${pointId}] 不存在或未配置告警源`)
    }
    const isActive =
      activeState(alarmState[pointId]) ||
      legacyAlarms.some((/** @type {any} */ a) => (a.pointId === pointId || a.id === pointId) && activeLegacy(a))
    return isActive ? 1 : 0
  }
  return Object.values(alarmState).filter(activeState).length + legacyAlarms.filter(activeLegacy).length
}
