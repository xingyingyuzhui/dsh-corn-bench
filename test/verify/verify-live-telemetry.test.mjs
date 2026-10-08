import assert from 'node:assert/strict'
import test from 'node:test'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'
import { createVerifyTelemetryAdapter } from '../../src/application/verify/verify-telemetry-adapter.mjs'
import { flatWorkspace, liveValue, stampWorkspace, vpoint } from './verify-fixtures.mjs'

test('verify-telemetry-adapter: strictly rejects static workspace points[].value as live data', async () => {
  const adapter = createVerifyTelemetryAdapter({
    // static point default, NOT live; no poll has produced a value record
    workspaceLoader: () => flatWorkspace({ points: [vpoint('p_static', { value: 99.9, rawValue: 99.9 })] }),
  })

  const reading = /** @type {any} */ (await adapter.readPoint({ cwd: '/test/cwd' }, 'p_static'))
  assert.equal(reading.availability, 'unavailable')
  assert.equal(reading.reason, 'DATA_MISSING')
})

test('verify-telemetry-adapter: reads from active poll-cache and evaluates maxAgeMs freshness', async () => {
  const adapter = createVerifyTelemetryAdapter({
    workspaceLoader: () =>
      stampWorkspace(
        flatWorkspace({
          points: [vpoint('p_live_fresh'), vpoint('p_live_old', { address: 1 })],
          values: [liveValue('p_live_fresh', 12.5, { ageMs: 100 }), liveValue('p_live_old', 40.0, { ageMs: 5000 })],
        }),
      ),
  })

  // Fresh point with maxAgeMs = 1000 -> quality: good
  const fresh = await adapter.readPoint({ cwd: '/test/cwd' }, 'p_live_fresh', { maxAgeMs: 1000 })
  assert.ok(fresh)
  assert.equal(fresh.value, 12.5)
  assert.equal(fresh.source, 'poll-cache')
  assert.equal(fresh.quality, 'good')

  // Old point with maxAgeMs = 1000 -> quality: stale
  const stale = await adapter.readPoint({ cwd: '/test/cwd' }, 'p_live_old', { maxAgeMs: 1000 })
  assert.ok(stale)
  assert.equal(stale.value, 40.0)
  assert.equal(stale.quality, 'stale')
  assert.ok(stale.freshnessMs >= 5000)
})

test('verify-service: stale telemetry beyond maxAgeMs is unverifiable, not a pass', async () => {
  const adapter = createVerifyTelemetryAdapter({
    workspaceLoader: () =>
      stampWorkspace(
        flatWorkspace({ points: [vpoint('temp_c')], values: [liveValue('temp_c', 25.0, { ageMs: 10_000 })] }),
        { sessionId: 'sess-1' },
      ),
  })

  const verifyService = createVerifyService({
    telemetryReader: adapter,
  })

  const result = await verifyService.runVerification({
    scenario: {
      name: 'Stale Check Scenario',
      assertions: [
        {
          type: /** @type {const} */ ('modbus.point'),
          pointId: 'temp_c',
          maxAgeMs: 2000, // require data fresher than 2s
          operator: '==',
          expected: 25.0,
        },
      ],
    },
    workspaceCwd: '/test/cwd',
    ownerSessionId: 'sess-1',
  })

  assert.equal(result.status, 'error')
  assert.equal(result.failedCount, 1)
  assert.equal(result.unverifiableCount, 1)
  assert.equal(result.assertions[0].reason, 'STALE_VALUE')
})
