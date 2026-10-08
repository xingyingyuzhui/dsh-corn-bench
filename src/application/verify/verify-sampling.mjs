// @ts-check

import { isUnavailable, unavailable, UNAVAILABLE_REASONS } from '../../domain/verify/observation.mjs'
import { DEFAULT_STABLE_DURATION_MS, stableDurationMs } from '../../domain/verify/scenario.mjs'
import { abortableDelay } from './abort-signals.mjs'
import { observeCall, observeDebugValue, observeReading } from './verify-observation.mjs'

/**
 * @typedef {import('./verify-observation.mjs').Observation} Observation
 * @typedef {import('../../domain/verify/observation.mjs').UnavailableObservation} UnavailableObservation
 */

/**
 * @typedef {{
 *   debugRuntime?: any,
 *   debugSessionId?: string,
 *   ownerSessionId: string,
 *   workspaceCwd: string,
 *   source?: 'user' | 'agent',
 *   telemetryReader?: any,
 *   combinedSignal: AbortSignal,
 *   timeoutMs: number,
 *   remainingMs: () => number,
 *   checkDeadline: () => void,
 *   telemetrySamples: Array<{ pointId?: string, expr?: string, timestamp: number, value: any }>,
 * }} VerifySampleContext
 */

/**
 * @param {VerifySampleContext} ctx
 * @param {string} pointId
 * @param {{ maxAgeMs?: number }} [opts]
 * @returns {Promise<Observation>}
 */
export async function readTelemetryPoint(ctx, pointId, opts = {}) {
  const { telemetryReader, workspaceCwd, ownerSessionId, combinedSignal } = ctx
  if (!telemetryReader || typeof telemetryReader.readPoint !== 'function') {
    return unavailable(UNAVAILABLE_REASONS.DATA_MISSING, '没有可用的遥测读取器')
  }
  const scope = { cwd: workspaceCwd, sessionId: ownerSessionId, source: ctx.source || 'user' }
  const reading = await observeCall(
    () => telemetryReader.readPoint(scope, pointId, { ...opts, signal: combinedSignal }),
    combinedSignal,
  )
  const observed = observeReading(reading, { maxAgeMs: opts.maxAgeMs })
  if (observed.availability === 'available') {
    ctx.telemetrySamples.push({ pointId, timestamp: observed.reading.timestamp, value: observed.reading.value })
  }
  return observed
}

/**
 * @param {VerifySampleContext} ctx
 * @param {string} expr
 * @returns {Promise<{ availability: 'available', value: any } | UnavailableObservation>}
 */
export async function evaluateDebugExpression(ctx, expr) {
  const { debugRuntime, debugSessionId, ownerSessionId, combinedSignal } = ctx
  const res = await observeCall(
    () => debugRuntime.command({ debugSessionId, ownerSessionId }, { type: 'evaluate', expression: expr }),
    combinedSignal,
  )
  const observed = observeDebugValue(res)
  if (observed.availability === 'available') {
    ctx.telemetrySamples.push({ expr, timestamp: Date.now(), value: observed.value })
  }
  return observed
}

/**
 * Sample a point or expression across the full requested window for
 * `stable-for-duration`. The window is never shortened: if the run cannot fit
 * it any more the whole run times out, and the last sample lands on or after
 * the window's end. The first unusable sample ends sampling, since the window
 * can no longer be judged.
 *
 * @param {VerifySampleContext} ctx
 * @param {any} spec
 * @returns {Promise<any[] | UnavailableObservation>}
 */
export async function sampleStableDuration(ctx, spec) {
  const { debugRuntime, debugSessionId, combinedSignal, checkDeadline } = ctx
  const duration = stableDurationMs(spec) ?? DEFAULT_STABLE_DURATION_MS
  if (ctx.remainingMs() < duration) {
    const err = new Error('VERIFY_TIMEOUT')
    err.name = 'TimeoutError'
    throw err
  }
  const intervalMs =
    typeof spec.sampleIntervalMs === 'number'
      ? Math.max(10, spec.sampleIntervalMs)
      : duration >= 3000
        ? 1000
        : Math.max(20, Math.floor(duration / 4))

  const expr = spec.expr || spec.expression || spec.source?.expr || spec.source?.expression
  const pointId = spec.pointId || spec.source?.pointId
  const maxAgeMs = typeof spec.maxAgeMs === 'number' ? spec.maxAgeMs : undefined

  /** @type {any[]} */
  const samples = []
  const sampleStart = Date.now()
  for (;;) {
    checkDeadline()
    /** @type {any} */
    let sample
    if (expr && debugRuntime && debugSessionId) {
      const observed = await evaluateDebugExpression(ctx, expr)
      sample = observed.availability === 'available' ? observed.value : observed
    } else if (pointId) {
      const observed = await readTelemetryPoint(ctx, pointId, { maxAgeMs })
      sample = observed.availability === 'available' ? observed.reading.value : observed
    } else if (expr) {
      return unavailable(UNAVAILABLE_REASONS.NO_DEBUG_SESSION)
    } else {
      return unavailable(UNAVAILABLE_REASONS.DATA_MISSING)
    }
    checkDeadline()
    if (isUnavailable(sample)) return sample
    samples.push(sample)

    const elapsed = Date.now() - sampleStart
    if (elapsed >= duration) break
    await abortableDelay(Math.min(intervalMs, duration - elapsed), combinedSignal)
  }
  return samples
}
