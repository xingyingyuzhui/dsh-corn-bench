import assert from 'node:assert/strict'
import test from 'node:test'
import { sampleStableDuration } from '../../src/application/verify/verify-sampling.mjs'
import { observeReading } from '../../src/application/verify/verify-observation.mjs'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'
import { SAMPLE_STAMP_MESSAGES, UNAVAILABLE_REASONS } from '../../src/domain/verify/observation.mjs'

/**
 * @param {number} step
 */
function reading(step) {
  return {
    value: 10,
    rawValue: 10,
    timestamp: Date.now(),
    quality: 'good',
    source: 'published',
    fingerprint: 'fp-window',
    generation: step < 2 ? 'g1' : 'g2',
  }
}

test('observeReading keeps fingerprint and generation', () => {
  const observed = observeReading(
    {
      value: 10,
      rawValue: 4,
      timestamp: 1_000,
      quality: 'good',
      source: 'poll-cache',
      fingerprint: 'fp-1',
      generation: 'gen-1',
    },
    { now: 1_080 },
  )
  assert.equal(observed.availability, 'available')
  if (observed.availability !== 'available') return
  assert.equal(observed.reading.fingerprint, 'fp-1')
  assert.equal(observed.reading.generation, 'gen-1')
  assert.equal(observed.reading.value, 10)
})

test('stable duration rejects a generation change and does not record it as evidence', async () => {
  let step = 0
  /** @type {any[]} */
  const telemetrySamples = []
  const result = await sampleStableDuration(
    {
      ownerSessionId: 'a',
      workspaceCwd: '/w',
      telemetryReader: {
        readPoint: async () => reading(++step),
      },
      combinedSignal: new AbortController().signal,
      timeoutMs: 5_000,
      remainingMs: () => 5_000,
      checkDeadline: () => {},
      telemetrySamples,
      delay: async () => {},
    },
    { pointId: 'p1', durationMs: 80, sampleIntervalMs: 20 },
  )
  assert.equal(result.reason, UNAVAILABLE_REASONS.STALE_VALUE)
  assert.equal(result.message.includes(SAMPLE_STAMP_MESSAGES.MISSING), false)
  assert.equal(telemetrySamples.length, 1)
  assert.equal(telemetrySamples[0].checkOnly, false)
})

test('verify service reports STALE_VALUE when identity changes inside the window', async () => {
  let step = 0
  const res = await createVerifyService({
    telemetryReader: {
      readPoint: async () => reading(++step),
    },
  }).runVerification({
    workspaceCwd: '/w',
    ownerSessionId: 'a',
    scenario: {
      id: 'stable-identity',
      name: 'stable-identity',
      timeoutMs: 1000,
      assertions: [{ type: 'stable-for-duration', pointId: 'p1', durationMs: 80, sampleIntervalMs: 20 }],
    },
  })
  assert.equal(res.assertions[0].reason, UNAVAILABLE_REASONS.STALE_VALUE)
  assert.equal(res.telemetrySamples.length, 1)
})
