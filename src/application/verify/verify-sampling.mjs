// @ts-check

import { isUnavailable, SAMPLE_STAMP_MESSAGES, unavailable, UNAVAILABLE_REASONS } from '../../domain/verify/observation.mjs'
import { DEFAULT_STABLE_DURATION_MS, stableDurationMs } from '../../domain/verify/scenario.mjs'
import { createStableWindow } from '../../domain/verify/stable-window.mjs'
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
 *   telemetrySamples: Array<{ pointId?: string, expr?: string, timestamp: number, value: any, checkOnly?: boolean }>,
 *   directReadBudget?: import('./scoped-point-reader.mjs').DirectReadBudget | null,
 *   now?: () => number,
 *   delay?: (ms: number, signal: AbortSignal) => Promise<void>,
 * }} VerifySampleContext
 */

/**
 * @param {VerifySampleContext} ctx
 * @param {string} pointId
 * @param {{ maxAgeMs?: number, allowDirectRead?: boolean, recordSample?: boolean }} [opts]
 * @returns {Promise<Observation>}
 */
export async function readTelemetryPoint(ctx, pointId, opts = {}) {
  const { telemetryReader, workspaceCwd, ownerSessionId, combinedSignal } = ctx
  if (!telemetryReader || typeof telemetryReader.readPoint !== 'function') {
    return unavailable(UNAVAILABLE_REASONS.DATA_MISSING, '没有可用的遥测读取器')
  }
  const scope = { cwd: workspaceCwd, sessionId: ownerSessionId, source: ctx.source || 'user' }
  const reading = await observeCall(
    () =>
      telemetryReader.readPoint(scope, pointId, {
        ...opts,
        signal: combinedSignal,
        allowDirectRead: opts.allowDirectRead,
        directReadBudget: ctx.directReadBudget,
      }),
    combinedSignal,
  )
  const observed = observeReading(reading, { maxAgeMs: opts.maxAgeMs, now: ctx.now?.() })
  if (observed.availability === 'available' && opts.recordSample !== false) {
    ctx.telemetrySamples.push({
      pointId,
      timestamp: observed.reading.timestamp,
      value: observed.reading.value,
      checkOnly: false,
    })
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
  const now = ctx.now || Date.now
  const res = await observeCall(
    () => debugRuntime.command({ debugSessionId, ownerSessionId }, { type: 'evaluate', expression: expr }),
    combinedSignal,
  )
  const observed = observeDebugValue(res)
  if (observed.availability === 'available') {
    ctx.telemetrySamples.push({ expr, timestamp: now(), value: observed.value })
  }
  return observed
}

/**
 * Sample a point or expression across the full requested window for
 * `stable-for-duration`. Point stable observes poll/publish progress only
 * (`allowDirectRead=false`); coverage is proven by advancing sample timestamps,
 * never by wall-clock alone or repeated cache hits of one historic record.
 *
 * @param {VerifySampleContext} ctx
 * @param {any} spec
 * @returns {Promise<any[] | UnavailableObservation>}
 */
export async function sampleStableDuration(ctx, spec) {
  const { debugRuntime, debugSessionId, combinedSignal, checkDeadline } = ctx
  const now = ctx.now || Date.now
  const delay = ctx.delay || abortableDelay
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
  const startedAt = now()
  const window = createStableWindow({ startedAt, durationMs: duration })
  // Wait for the first in-window sample at most `duration`, then for coverage.
  const firstDeadline = startedAt + duration

  for (;;) {
    checkDeadline()
    /** @type {any} */
    let observed
    if (expr && debugRuntime && debugSessionId) {
      observed = await evaluateDebugExpression(ctx, expr)
      if (observed.availability === 'available') {
        const step = window.accept({
          value: observed.value,
          timestamp: now(),
          identity: 'debug',
          generation: 'debug',
        })
        if (step.status === 'unavailable') return /** @type {UnavailableObservation} */ (step.unavailable)
      } else if (isUnavailable(observed)) {
        const step = window.accept(observed)
        if (step.status === 'unavailable') return /** @type {UnavailableObservation} */ (step.unavailable)
      }
    } else if (pointId) {
      observed = await readTelemetryPoint(ctx, pointId, { maxAgeMs, allowDirectRead: false, recordSample: false })
      if (observed.availability === 'available') {
        const reading = /** @type {any} */ (observed).reading
        if (!reading.fingerprint || !reading.generation) {
          return unavailable(UNAVAILABLE_REASONS.INVALID_SAMPLE, SAMPLE_STAMP_MESSAGES.MISSING)
        }
        const before = window.sampleCount
        const step = window.accept({
          value: reading.value,
          timestamp: reading.timestamp,
          identity: reading.fingerprint,
          generation: reading.generation,
          observedAt: now(),
        })
        if (step.status === 'unavailable') return /** @type {UnavailableObservation} */ (step.unavailable)
        if (step.status === 'continue') {
          ctx.telemetrySamples.push({
            pointId,
            timestamp: reading.timestamp,
            value: reading.value,
            checkOnly: window.sampleCount === before,
          })
        }
      } else if (isUnavailable(observed)) {
        const step = window.accept(observed)
        if (step.status === 'unavailable') return /** @type {UnavailableObservation} */ (step.unavailable)
      }
    } else if (expr) {
      return unavailable(UNAVAILABLE_REASONS.NO_DEBUG_SESSION)
    } else {
      return unavailable(UNAVAILABLE_REASONS.DATA_MISSING)
    }
    checkDeadline()

    const t = now()
    const requiredEnd = window.requiredEndAt
    if (requiredEnd != null) {
      // Polled readings carry their capture time, which trails the wall clock:
      // the clock can pass the window end while the newest sample sits 1 ms
      // short of it. Wait for a sample at or past the end (bounded by the
      // scenario deadline above) instead of failing an otherwise stable run.
      const lastAt = window.lastSampleAt
      const covered = lastAt != null && lastAt >= requiredEnd
      // A stalled source gets a few intervals of grace, then reports
      // INSUFFICIENT_SAMPLES as before rather than idling into a timeout.
      if (t >= requiredEnd && (covered || t >= requiredEnd + intervalMs * 3)) {
        const finished = window.finish(t)
        if ('availability' in finished) return finished
        return finished.values
      }
      const wait = t >= requiredEnd ? intervalMs : Math.min(intervalMs, requiredEnd - t)
      await delay(Math.max(0, wait), combinedSignal)
      continue
    }
    // Still waiting for the first in-window sample.
    if (t >= firstDeadline) {
      const finished = window.finish(t)
      if ('availability' in finished) return finished
      return finished.values
    }
    const wait = Math.min(intervalMs, firstDeadline - t)
    await delay(Math.max(0, wait), combinedSignal)
  }
}
