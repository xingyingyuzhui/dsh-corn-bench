import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { projectRead } from '../../src/application/commands/agent-result-project-status-read.mjs'
import { mutateConfig } from '../../src/application/config/config-mutation-service.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { createRouter } from '../helpers/rpc-factory.mjs'
import { liveValue, stampWorkspace, vpoint } from '../verify/verify-fixtures.mjs'

test('caller views omit internal sample metadata and still persist it', async (t) => {
  const bench = await createBench(t, { prefix: 'sample-meta-' })
  const seeded = stampWorkspace({
    modbus: {
      version: 3,
      configVersion: 1,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502, sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [vpoint('p1', { scale: 1, offset: 0 })],
      values: [liveValue('p1', 7)],
    },
  })
  saveWorkspace(bench.home, bench.cwd, seeded)
  const token = seeded.modbus.sampleGenerations.p1
  const { dispatch } = createRouter(bench.home)

  const got = await dispatch('workspace/get', { cwd: bench.cwd })
  assert.equal(got.ok, true, got.error)
  assert.equal(got.workspace.modbus.sampleGenerations, undefined)
  assert.equal(got.workspace.modbus.sampleIdentitySchemaVersion, undefined)
  assert.equal(got.workspace.modbus.sessionConfigs, undefined)
  assert.equal(got.workspace.modbus.values[0].sampleIdentity, undefined)
  assert.equal(got.workspace.modbus.values[0].value, 7)

  const state = await dispatch('state', { cwd: bench.cwd })
  assert.equal(state.workspace.modbus.sampleGenerations, undefined)
  assert.equal(state.workspace.modbus.values[0].sampleIdentity, undefined)

  const rejected = await dispatch('workspace/save', {
    cwd: bench.cwd,
    modbus: { sampleGenerations: { p1: 'caller' } },
  })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.errorCode, 'INVALID_FIELD')
  assert.equal(rejected.details.reason, 'INTERNAL_FIELD')
  const rejectedSchema = await dispatch('workspace/save', {
    cwd: bench.cwd,
    modbus: { sampleIdentitySchemaVersion: 1 },
  })
  assert.equal(rejectedSchema.errorCode, 'INVALID_FIELD')

  const patched = await dispatch('workspace/save', {
    cwd: bench.cwd,
    modbus: { activeConnectionId: 'c1' },
  })
  assert.equal(patched.ok, true, patched.error)
  assert.equal(patched.workspace.modbus.sampleGenerations, undefined)
  const disk = loadWorkspace(bench.home, bench.cwd)
  assert.equal(disk.modbus.sampleGenerations.p1, token)
  assert.equal(disk.modbus.sampleIdentitySchemaVersion, 2)

  const mutated = await mutateConfig({
    home: bench.home,
    cwd: bench.cwd,
    expectedConfigVersion: disk.modbus.configVersion,
    operation: 'connection.update',
    target: { connectionId: 'c1' },
    value: { name: 'Renamed' },
  })
  assert.equal(mutated.ok, true, mutated.error)
  assert.equal(mutated.workspace.modbus.sampleGenerations, undefined)
  assert.equal(mutated.workspace.modbus.sampleIdentitySchemaVersion, undefined)
  assert.equal(loadWorkspace(bench.home, bench.cwd).modbus.sampleGenerations.p1, token)

  const projected = projectRead(
    { pointId: 'p1' },
    {
      ok: true,
      values: [
        {
          pointId: 'p1',
          connectionId: 'c1',
          deviceId: 'd1',
          value: 7,
          raw: 7,
          ok: true,
          at: 10,
          source: 'sim-write',
          simulated: true,
          sampleIdentity: { fingerprint: 'secret', generation: token },
        },
      ],
    },
  )
  assert.equal(projected.values[0].value, 7)
  assert.equal(projected.values[0].sampleIdentity, undefined)
  assert.equal(projected.values[0].source, undefined)
  assert.equal(projected.values[0].simulated, undefined)
})
