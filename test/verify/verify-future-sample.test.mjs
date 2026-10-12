import assert from 'node:assert/strict'
import { test } from 'node:test'
import { observeReading } from '../../src/application/verify/verify-observation.mjs'
import { createStableWindow } from '../../src/domain/verify/stable-window.mjs'

const reading = (timestamp) => ({
  value: 10,
  rawValue: 10,
  timestamp,
  quality: 'good',
  provenance: 'poll',
  fingerprint: 'fp',
  generation: 'g1',
})

test('a future timestamp is INVALID_SAMPLE in observation and the stable window', () => {
  const observed = observeReading(reading(2000), { now: 1080 })
  assert.equal(observed.availability, 'unavailable')
  if (observed.availability === 'unavailable') assert.equal(observed.reason, 'INVALID_SAMPLE')

  const window = createStableWindow({ startedAt: 1000, durationMs: 80 })
  const step = window.accept({
    value: 10,
    timestamp: 2000,
    identity: 'fp',
    generation: 'g1',
    observedAt: 1080,
  })
  assert.equal(step.status, 'unavailable')
  assert.equal(step.unavailable?.reason, 'INVALID_SAMPLE')
})
