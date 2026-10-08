// @ts-check
/**
 * S2: a newer failed poll must not be masked by an older stamped good cache.
 * Ordinary assertions may take one supplementary read; budget is one per
 * [cwd,sid,pointId,generation]; failure stays READ_FAILED / unverifiable.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { UNAVAILABLE_REASONS } from '../../src/domain/verify/observation.mjs'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'
import { createVerifyTelemetryAdapter } from '../../src/application/verify/verify-telemetry-adapter.mjs'
import { createDirectReadBudget } from '../../src/application/verify/scoped-point-reader.mjs'
import { flatWorkspace, liveValue, stampWorkspace, vpoint } from './verify-fixtures.mjs'

const scope = { cwd: '/tmp/verify-poll-failure', sessionId: 'a', source: 'user' }

test('a newer failed poll cannot be hidden by an older successful cached observation', async () => {
  const ws = stampWorkspace(
    flatWorkspace({
      points: [vpoint('p1')],
      values: [liveValue('p1', 9, { ageMs: 1000 })],
    }),
    { sessionId: 'a' },
  )
  let reads = 0
  const reader = createVerifyTelemetryAdapter({
    workspaceLoader: () => ws,
    modbusReadFn: async () => {
      reads += 1
      return { ok: false, error: 'read failed' }
    },
  })

  // Seed live-cache from the stamped good poll row.
  const cached = /** @type {any} */ (await reader.readPoint(scope, 'p1', { allowDirectRead: false }))
  assert.equal(cached.value, 9)
  assert.equal(cached.source, 'poll-cache')

  // Newer failed poll lands in the workspace (still stamped for this generation).
  const gen = ws.modbus.sampleGenerations.p1
  const fp = ws.modbus.values[0].sampleIdentity.fingerprint
  ws.modbus.values = [
    liveValue('p1', null, {
      ok: false,
      ageMs: 0,
      sampleIdentity: { fingerprint: fp, generation: gen },
    }),
  ]

  const res = await createVerifyService({
    workspaceLoader: () => ws,
    telemetryReader: reader,
  }).runVerification({
    workspaceCwd: scope.cwd,
    ownerSessionId: 'a',
    scenario: {
      id: 'bad',
      name: 'bad',
      assertions: [{ type: 'modbus.point', pointId: 'p1', value: 9 }],
    },
  })

  assert.notEqual(res.status, 'pass', JSON.stringify({ actual: res.assertions[0], reads }))
  assert.equal(res.status, 'error')
  assert.equal(res.assertions[0].outcome, 'unverifiable')
  assert.ok(
    res.assertions[0].reason === UNAVAILABLE_REASONS.READ_FAILED ||
      res.assertions[0].reason === UNAVAILABLE_REASONS.BAD_QUALITY,
    res.assertions[0].reason,
  )
  assert.equal(reads, 1, 'exactly one supplementary read then stop')
})

test('same run does not spend a second supplementary read after the first failed', async () => {
  const stamped = stampWorkspace(
    flatWorkspace({
      points: [vpoint('p1')],
      values: [liveValue('p1', 1, { ageMs: 0 })],
    }),
    { sessionId: 'a' },
  )
  stamped.modbus.values = stamped.modbus.values.map((/** @type {any} */ v) => ({
    ...v,
    ok: false,
    value: null,
    raw: null,
  }))

  let reads = 0
  const budget = createDirectReadBudget()
  const reader = createVerifyTelemetryAdapter({
    workspaceLoader: () => stamped,
    directReadBudget: budget,
    modbusReadFn: async () => {
      reads += 1
      return { ok: false, error: 'still down' }
    },
  })

  const r1 = /** @type {any} */ (await reader.readPoint(scope, 'p1'))
  assert.equal(r1.reason, UNAVAILABLE_REASONS.READ_FAILED)
  assert.equal(reads, 1)

  const r2 = /** @type {any} */ (await reader.readPoint(scope, 'p1'))
  assert.ok(
    r2.reason === UNAVAILABLE_REASONS.BAD_QUALITY || r2.reason === UNAVAILABLE_REASONS.READ_FAILED,
    r2.reason,
  )
  assert.equal(reads, 1, 'budget blocks a second hardware read for the same generation')
})
