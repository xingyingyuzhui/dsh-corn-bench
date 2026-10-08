// @ts-check
/**
 * S2: geometry / address updates invalidate prior runtime values via
 * sampleGenerations; old stamped values must not be reused.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { modbusRead } from '../../bench-modbus.mjs'
import { prepareConfigPersistence } from '../../src/domain/modbus/prepare-config-persistence.mjs'
import { createVerifyTelemetryAdapter } from '../../src/application/verify/verify-telemetry-adapter.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { flatWorkspace, liveValue, stampWorkspace, vpoint } from './verify-fixtures.mjs'

test('prepareConfigPersistence: address change clears value and bumps generation', () => {
  const current = stampWorkspace(
    flatWorkspace({
      points: [vpoint('p1', { address: 0 })],
      values: [liveValue('p1', 77)],
    }),
  )
  const prevGen = current.modbus.sampleGenerations.p1
  assert.ok(prevGen)
  assert.equal(current.modbus.values[0].value, 77)
  assert.ok(current.modbus.values[0].sampleIdentity)

  const candidate = {
    ...current,
    modbus: {
      ...current.modbus,
      points: [vpoint('p1', { address: 5 })],
      values: current.modbus.values,
    },
  }
  const prepared = prepareConfigPersistence(current, candidate)
  assert.notEqual(prepared.workspace.modbus.sampleGenerations.p1, prevGen)
  assert.deepEqual(prepared.changedPointIds, ['p1'])
  assert.equal(prepared.workspace.modbus.values.length, 0)
})

test('prepareConfigPersistence: name-only change keeps generation and value', () => {
  const current = stampWorkspace(
    flatWorkspace({
      points: [vpoint('p1', { name: 'A' })],
      values: [liveValue('p1', 12)],
    }),
  )
  const prevGen = current.modbus.sampleGenerations.p1
  const candidate = {
    ...current,
    modbus: {
      ...current.modbus,
      points: [vpoint('p1', { name: 'B' })],
      values: current.modbus.values,
    },
  }
  const prepared = prepareConfigPersistence(current, candidate)
  assert.equal(prepared.workspace.modbus.sampleGenerations.p1, prevGen)
  assert.deepEqual(prepared.changedPointIds, [])
  assert.equal(prepared.workspace.modbus.values[0].value, 12)
})

test('production address update must not reuse the previous address runtime value', async (t) => {
  const b = await createBench(t, { prefix: 'verify-rebind-' })
  const stamped = stampWorkspace({
    modbus: {
      version: 3,
      configVersion: 1,
      privateClaimSessionId: 'a',
      share: { enabled: false, connections: false, points: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        a: {
          connections: [connection('c1', 'tcp', '', { sim: true })],
          devices: [{ id: 'd1', connectionId: 'c1', name: 'D', unitId: 1 }],
          points: [vpoint('p1')],
        },
      },
      values: [liveValue('p1', 77)],
    },
  })
  saveWorkspace(b.home, b.cwd, stamped)

  let reads = 0
  const reader = createVerifyTelemetryAdapter({
    getHome: () => b.home,
    workspaceLoader: (cwd) => loadWorkspace(b.home, cwd),
    modbusReadFn: async (...args) => {
      reads += 1
      return modbusRead(...args)
    },
  })
  const s = { cwd: b.cwd, sessionId: 'a', source: 'agent' }

  const before = /** @type {any} */ (await reader.readPoint(s, 'p1', { allowDirectRead: false }))
  assert.equal(before.value, 77, JSON.stringify(before))
  assert.equal(before.source, 'poll-cache')

  const expectedConfigVersion = loadWorkspace(b.home, b.cwd).modbus.configVersion
  const update = await runVisionBench(
    b.home,
    { action: 'points', op: 'update', expectedConfigVersion, points: [{ id: 'p1', address: 5 }] },
    b.cwd,
    { source: 'agent', sessionId: 'a' },
  )
  assert.equal(update.ok, true, update.error)

  const afterWs = loadWorkspace(b.home, b.cwd)
  assert.equal(
    (afterWs.modbus.values || []).filter((/** @type {any} */ v) => v.pointId === 'p1').length,
    0,
    'geometry change must clear the runtime value slot',
  )
  assert.notEqual(afterWs.modbus.sampleGenerations?.p1, stamped.modbus.sampleGenerations.p1)

  const next = /** @type {any} */ (await reader.readPoint(s, 'p1'))
  assert.notEqual(next.value, 77, JSON.stringify({ address: 5, source: next.source, reads, next }))
  assert.ok(reads >= 1, 'supplementary read should hit the new address')
})
