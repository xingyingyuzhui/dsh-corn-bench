// @ts-check
/**
 * S1: stable-for-duration requires advancing in-window samples — a frozen
 * historic observation must not prove coverage.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { UNAVAILABLE_REASONS } from '../../src/domain/verify/observation.mjs'
import { createStableWindow } from '../../src/domain/verify/stable-window.mjs'
import { sampleStableDuration } from '../../src/application/verify/verify-sampling.mjs'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'
import { createVerifyTelemetryAdapter } from '../../src/application/verify/verify-telemetry-adapter.mjs'
import { buildEffectivePointIndex } from '../../src/domain/modbus/prepare-config-persistence.mjs'
import { stampForEntry } from '../../src/domain/modbus/sample-generation.mjs'
import { flatWorkspace, liveValue, stampWorkspace, vpoint } from './verify-fixtures.mjs'

const scope = { cwd: '/tmp/verify-stable-window', sessionId: 'a' }

test('createStableWindow: history before startedAt and single stamp cannot finish', () => {
  const window = createStableWindow({ startedAt: 1_000, durationMs: 100 })
  assert.equal(window.accept({ value: 10, timestamp: 900, identity: 'fp', generation: 'g1' }).status, 'wait')
  assert.equal(window.accept({ value: 10, timestamp: 1_050, identity: 'fp', generation: 'g1' }).status, 'continue')
  // Same timestamp recheck is not a new sample.
  assert.equal(window.accept({ value: 10, timestamp: 1_050, identity: 'fp', generation: 'g1' }).status, 'continue')
  assert.equal(window.sampleCount, 1)
  const early = window.finish(1_200)
  assert.equal(/** @type {any} */ (early).reason, UNAVAILABLE_REASONS.INSUFFICIENT_SAMPLES)
})

test('createStableWindow: two advancing stamps covering duration succeed', () => {
  const window = createStableWindow({ startedAt: 1_000, durationMs: 80 })
  assert.equal(window.accept({ value: 10, timestamp: 1_010, identity: 'fp', generation: 'g1' }).status, 'continue')
  assert.equal(window.accept({ value: 10, timestamp: 1_100, identity: 'fp', generation: 'g1' }).status, 'continue')
  const done = window.finish(1_100)
  assert.equal(/** @type {any} */ (done).ok, true)
  assert.equal(/** @type {any} */ (done).sampleCount, 2)
  assert.equal(/** @type {any} */ (done).coveredMs, 90)
})

test('createStableWindow: identity/generation change mid-window is STALE_VALUE', () => {
  const window = createStableWindow({ startedAt: 1_000, durationMs: 80 })
  window.accept({ value: 10, timestamp: 1_010, identity: 'fp', generation: 'g1' })
  const step = window.accept({ value: 10, timestamp: 1_050, identity: 'fp', generation: 'g2' })
  assert.equal(step.status, 'unavailable')
  assert.equal(step.unavailable?.reason, UNAVAILABLE_REASONS.STALE_VALUE)
})

test('one frozen stamped poll-cache observation must not prove a stable window', async () => {
  const ws = stampWorkspace(
    flatWorkspace({
      points: [vpoint('p1')],
      values: [liveValue('p1', 10, { ageMs: 0 })],
    }),
    { sessionId: 'a' },
  )
  const res = await createVerifyService({ workspaceLoader: () => ws }).runVerification({
    workspaceCwd: scope.cwd,
    ownerSessionId: 'a',
    scenario: {
      id: 'stable',
      name: 'stable',
      timeoutMs: 1000,
      assertions: [
        {
          type: 'stable-for-duration',
          pointId: 'p1',
          durationMs: 80,
          sampleIntervalMs: 20,
          tolerance: 0,
        },
      ],
    },
  })
  assert.equal(res.status, 'error')
  assert.equal(res.errorCode, 'VERIFY_UNVERIFIABLE')
  assert.equal(res.assertions[0].outcome, 'unverifiable')
  assert.equal(res.assertions[0].reason, UNAVAILABLE_REASONS.INSUFFICIENT_SAMPLES)
  const uniqueAt = new Set(res.telemetrySamples.map((s) => s.timestamp))
  assert.ok(uniqueAt.size < 2, `expected <2 unique timestamps, got ${uniqueAt.size}`)
})

test('sampleStableDuration: advancing published stamps pass with injected clock', async () => {
  const ws = stampWorkspace(flatWorkspace({ points: [vpoint('p1')], values: [] }), { sessionId: 'a' })
  const reader = createVerifyTelemetryAdapter({ workspaceLoader: () => ws })
  const readScope = { cwd: scope.cwd, sessionId: 'a', source: 'user' }
  const entry = buildEffectivePointIndex(ws.modbus).get('p1')
  const stamp = entry ? stampForEntry(entry, ws.modbus.sampleGenerations.p1) : null
  assert.ok(stamp)
  /** @type {number} */
  let now = 5_000
  let lastPublished = 0
  const telemetryReader = {
    readPoint: async () => {
      // Emit a new stamp whenever the injected clock advances enough.
      if (!lastPublished || now - lastPublished >= 40) {
        lastPublished = now
        reader.publishPointValue(readScope, 'p1', {
          value: 10,
          rawValue: 10,
          timestamp: now,
          quality: 'good',
          source: 'published',
          fingerprint: stamp.fingerprint,
          generation: stamp.generation,
        })
      }
      return reader.readPoint(readScope, 'p1', { allowDirectRead: false })
    },
  }
  /** @type {any[]} */
  const telemetrySamples = []
  const values = await sampleStableDuration(
    {
      ownerSessionId: 'a',
      workspaceCwd: scope.cwd,
      telemetryReader,
      combinedSignal: new AbortController().signal,
      timeoutMs: 5_000,
      remainingMs: () => 5_000,
      checkDeadline: () => {},
      telemetrySamples,
      now: () => now,
      delay: async (ms) => {
        now += Math.max(0, Number(ms) || 0)
      },
    },
    { pointId: 'p1', durationMs: 80, sampleIntervalMs: 20, tolerance: 0 },
  )
  assert.ok(Array.isArray(values), JSON.stringify(values))
  assert.ok(values.length >= 2)
  assert.ok(values.every((v) => v === 10))
})

/**
 * Drives sampleStableDuration with a poller whose capture time trails the
 * injected clock by `lagMs`, publishing only while `publishing()` holds.
 * @param {{ lagMs: number, publishing?: (now: number) => boolean }} opts
 */
async function sampleLagging({ lagMs, publishing = () => true }) {
  const ws = stampWorkspace(flatWorkspace({ points: [vpoint('p1')], values: [] }), { sessionId: 'a' })
  const reader = createVerifyTelemetryAdapter({ workspaceLoader: () => ws })
  const readScope = { cwd: scope.cwd, sessionId: 'a', source: 'user' }
  const entry = buildEffectivePointIndex(ws.modbus).get('p1')
  const stamp = entry ? stampForEntry(entry, ws.modbus.sampleGenerations.p1) : null
  assert.ok(stamp)
  let now = 5_000
  const telemetryReader = {
    readPoint: async () => {
      if (publishing(now)) {
        reader.publishPointValue(readScope, 'p1', {
          value: 10,
          rawValue: 10,
          timestamp: now - lagMs,
          quality: 'good',
          source: 'published',
          fingerprint: stamp.fingerprint,
          generation: stamp.generation,
        })
      }
      return reader.readPoint(readScope, 'p1', { allowDirectRead: false })
    },
  }
  return sampleStableDuration(
    {
      ownerSessionId: 'a',
      workspaceCwd: scope.cwd,
      telemetryReader,
      combinedSignal: new AbortController().signal,
      timeoutMs: 5_000,
      remainingMs: () => 5_000,
      checkDeadline: () => {},
      telemetrySamples: [],
      now: () => now,
      delay: async (ms) => {
        now += Math.max(0, Number(ms) || 0)
      },
    },
    { pointId: 'p1', durationMs: 80, sampleIntervalMs: 20, tolerance: 0 },
  )
}

test('sampleStableDuration: capture time 1 ms behind the clock still covers the window', async () => {
  // The clock reaches the window end while the newest reading is 1 ms short;
  // the window must wait for the next reading instead of reporting 79 < 80 ms.
  const values = await sampleLagging({ lagMs: 1 })
  assert.ok(Array.isArray(values), JSON.stringify(values))
  assert.ok(values.every((v) => v === 10))
})

test('sampleStableDuration: a source that stalls before the window end is insufficient, not a timeout', async () => {
  const result = await sampleLagging({ lagMs: 1, publishing: (now) => now < 5_060 })
  assert.equal(/** @type {any} */ (result).availability, 'unavailable')
  assert.equal(/** @type {any} */ (result).reason, UNAVAILABLE_REASONS.INSUFFICIENT_SAMPLES)
})
