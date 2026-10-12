import assert from 'node:assert/strict'
import test from 'node:test'
import { modbusWrite } from '../../bench-actions.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { mutateConfig } from '../../src/application/config/config-mutation-service.mjs'
import { createVerifyTelemetryAdapter } from '../../src/application/verify/verify-telemetry-adapter.mjs'
import { UNAVAILABLE_REASONS } from '../../src/domain/verify/observation.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'
import { liveValue, stampWorkspace, vpoint } from '../verify/verify-fixtures.mjs'

test('sim write stays simulated and does not restamp an unread sibling', async (t) => {
  const bench = await createBench(t, { prefix: 'sim-trust-' })
  const { home, cwd } = bench
  const seeded = stampWorkspace({
    modbus: {
      version: 3,
      configVersion: 1,
      connections: [connection('c1', 'tcp', '', { sim: true, host: '10.0.0.8', tcpPort: 502 })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D', unitId: 1 }],
      points: [vpoint('p1', { address: 0 }), vpoint('p2', { address: 1 })],
      values: [liveValue('p1', 1), liveValue('p2', 9)],
    },
  })
  saveWorkspace(home, cwd, seeded)
  const before = loadWorkspace(home, cwd)
  const siblingBefore = before.modbus.values.find((/** @type {any} */ row) => row.pointId === 'p2')
  const wrote = await modbusWrite(home, cwd, {
    source: 'user',
    function: 3,
    address: 0,
    values: [42],
    connectionId: 'c1',
    deviceId: 'd1',
  })
  assert.equal(wrote.ok, true, wrote.error)
  const after = loadWorkspace(home, cwd)
  assert.equal(after.modbus.connections[0].conn.sim, true)
  const written = after.modbus.values.find((/** @type {any} */ row) => row.pointId === 'p1')
  const sibling = after.modbus.values.find((/** @type {any} */ row) => row.pointId === 'p2')
  assert.equal(written.value, 42)
  assert.equal(written.source, 'sim-write')
  assert.equal(written.simulated, true)
  assert.equal(written.sampleIdentity.generation, after.modbus.sampleGenerations.p1)
  assert.equal(sibling.value, 9)
  assert.equal(sibling.sampleIdentity.generation, siblingBefore.sampleIdentity.generation)
  assert.equal(sibling.sampleIdentity.fingerprint, siblingBefore.sampleIdentity.fingerprint)
  assert.equal(sibling.source, undefined)

  const flipped = await mutateConfig({
    home,
    cwd,
    expectedConfigVersion: after.modbus.configVersion,
    operation: 'connection.update',
    target: { connectionId: 'c1' },
    value: { conn: { mode: 'tcp', host: '10.0.0.8', tcpPort: 502, sim: false } },
  })
  assert.equal(flipped.ok, true, flipped.error)
  const realWs = loadWorkspace(home, cwd)
  assert.equal(realWs.modbus.connections[0].conn.sim, false)
  assert.notEqual(realWs.modbus.sampleGenerations.p2, sibling.sampleIdentity.generation)
  const reader = createVerifyTelemetryAdapter({
    getHome: () => home,
    workspaceLoader: (room) => loadWorkspace(home, room),
    modbusReadFn: async () => {
      throw new Error('sim→real must not need a live read to reject the old sibling')
    },
  })
  const cached = await reader.readPoint({ cwd, sessionId: '' }, 'p2', { allowDirectRead: false })
  assert.equal(cached.reason, UNAVAILABLE_REASONS.DATA_MISSING)
  assert.notEqual(cached.value, 9)
})
