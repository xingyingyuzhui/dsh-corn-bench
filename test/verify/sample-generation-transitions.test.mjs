import assert from 'node:assert/strict'
import test from 'node:test'
import { claimLegacyPrivate } from '../../src/application/modbus/config-scope-service.mjs'
import { resolveEffectiveSampleTarget } from '../../src/domain/modbus/effective-sample-target.mjs'
import { ensureSampleGenerations, prepareConfigPersistence } from '../../src/domain/modbus/prepare-config-persistence.mjs'

const point = (id, address = 0, connectionId = 'c1', deviceId = 'd1') => ({
  id,
  connectionId,
  deviceId,
  function: 3,
  address,
  scale: 1,
  offset: 0,
  name: id,
})
const device = (id, connectionId, unitId) => ({ id, connectionId, unitId })
const conn = (id, host, sim = false) => ({ id, conn: { mode: 'tcp', host, tcpPort: 502, sim } })

/**
 * @param {Record<string, any>} sessionConfigs
 * @param {Record<string, any>} [extra]
 */
function layered(sessionConfigs, extra = {}) {
  return {
    modbus: {
      version: 3,
      configVersion: 1,
      share: { enabled: true, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      values: [],
      sampleIdentitySchemaVersion: 2,
      sessionConfigs,
      ...extra,
    },
  }
}

const session = (pid, address = 0, unitId = 1) => ({
  connections: [conn('c1', '10.0.0.1')],
  devices: [device('d1', 'c1', unitId)],
  points: [point(pid, address)],
})

test('unique, ambiguous, and restored unique never reuse the previous token', () => {
  const first = prepareConfigPersistence(
    layered({}),
    layered({ A: session('p1') }),
  )
  const gen1 = first.workspace.modbus.sampleGenerations.p1
  assert.equal(typeof gen1, 'string')
  const oldValue = {
    pointId: 'p1',
    value: 77,
    ok: true,
    at: 10,
    sampleIdentity: { fingerprint: 'old', generation: gen1 },
  }
  const withValue = {
    ...first.workspace,
    modbus: { ...first.workspace.modbus, values: [oldValue] },
  }
  const ambiguous = prepareConfigPersistence(
    withValue,
    layered({ A: session('p1'), B: session('p1') }, { values: [oldValue] }),
  )
  assert.equal(ambiguous.workspace.modbus.sampleGenerations.p1, undefined)
  assert.equal(ambiguous.workspace.modbus.values.length, 1)
  assert.equal(ambiguous.workspace.modbus.values[0].sampleIdentity.generation, gen1)

  const restored = prepareConfigPersistence(
    ambiguous.workspace,
    layered({ A: session('p1') }, { values: ambiguous.workspace.modbus.values }),
  )
  assert.notEqual(restored.workspace.modbus.sampleGenerations.p1, gen1)
  assert.equal(restored.workspace.modbus.values[0].sampleIdentity.generation, gen1)
})

test('delete then recreate allocates a new token', () => {
  const created = prepareConfigPersistence(layered({}), layered({ A: session('p1') }))
  const gen1 = created.workspace.modbus.sampleGenerations.p1
  const removed = prepareConfigPersistence(created.workspace, layered({ A: { ...session('p1'), points: [] } }))
  assert.equal(removed.workspace.modbus.sampleGenerations.p1, undefined)
  const again = prepareConfigPersistence(removed.workspace, layered({ A: session('p1') }))
  assert.notEqual(again.workspace.modbus.sampleGenerations.p1, gen1)
})

test('owner A to B to A mints a token on every transfer', () => {
  const a = prepareConfigPersistence(layered({}), layered({ A: session('p1', 0, 1) }))
  const genA = a.workspace.modbus.sampleGenerations.p1
  const b = prepareConfigPersistence(a.workspace, layered({ B: session('p1', 0, 2) }))
  const genB = b.workspace.modbus.sampleGenerations.p1
  assert.notEqual(genB, genA)
  const back = prepareConfigPersistence(b.workspace, layered({ A: session('p1', 0, 1) }))
  assert.notEqual(back.workspace.modbus.sampleGenerations.p1, genA)
  assert.notEqual(back.workspace.modbus.sampleGenerations.p1, genB)
})

test('shared and private are different identities', () => {
  const sharedMb = {
    version: 3,
    configVersion: 1,
    share: { enabled: true, connections: true, points: true, visualization: false },
    connections: [conn('c1', '10.0.0.1')],
    devices: [device('d1', 'c1', 1)],
    points: [point('p1')],
    values: [],
    sampleIdentitySchemaVersion: 2,
    sessionConfigs: {},
  }
  const shared = prepareConfigPersistence({ modbus: { ...sharedMb, points: [] } }, { modbus: sharedMb })
  const genShared = shared.workspace.modbus.sampleGenerations.p1
  const target = resolveEffectiveSampleTarget(shared.workspace.modbus, 'p1')
  assert.equal(target.kind, 'unique')
  if (target.kind === 'unique') assert.equal(target.ownerSessionId, '')
  const madePrivate = prepareConfigPersistence(shared.workspace, {
    modbus: {
      ...sharedMb,
      share: { enabled: true, connections: true, points: false, visualization: false },
      points: [],
      sessionConfigs: { A: { connections: [], devices: [], points: [point('p1')] } },
    },
  })
  assert.notEqual(madePrivate.workspace.modbus.sampleGenerations.p1, genShared)
})

test('session bind does not mint or rotate tokens', () => {
  const current = {
    modbus: {
      version: 3,
      configVersion: 4,
      connections: [conn('c1', '10.0.0.1', true)],
      devices: [device('d1', 'c1', 1)],
      points: [point('p1')],
      values: [{ pointId: 'p1', value: 3, ok: true, at: 5, sampleIdentity: { fingerprint: 'f', generation: 'keep' } }],
      sampleGenerations: { p1: 'keep' },
    },
  }
  const claimed = claimLegacyPrivate(current.modbus, 'sess-a')
  assert.equal(claimed.claimed, true)
  const prepared = prepareConfigPersistence(current, { modbus: claimed.modbus })
  assert.equal(prepared.workspace.modbus.sampleGenerations.p1, 'keep')
  assert.equal(prepared.workspace.modbus.sampleIdentitySchemaVersion, undefined)
  assert.equal(prepared.workspace.modbus.configVersion, current.modbus.configVersion)
  assert.equal(prepared.workspace.modbus.values[0].sampleIdentity.generation, 'keep')
})

test('schema v2 migration rotates once and leaves the old value stamp', () => {
  const current = {
    modbus: {
      version: 3,
      configVersion: 8,
      connections: [conn('c1', '10.0.0.1', true)],
      devices: [device('d1', 'c1', 1)],
      points: [point('p1'), point('p2', 1)],
      values: [{ pointId: 'p1', value: 77, ok: true, at: 5, sampleIdentity: { fingerprint: 'old', generation: 'old-1' } }],
      sampleGenerations: { p1: 'old-1', p2: 'old-2' },
    },
  }
  const ensured = ensureSampleGenerations(current)
  assert.equal(ensured.workspace.modbus.sampleIdentitySchemaVersion, 2)
  assert.notEqual(ensured.workspace.modbus.sampleGenerations.p1, 'old-1')
  assert.notEqual(ensured.workspace.modbus.sampleGenerations.p2, 'old-2')
  const prepared = prepareConfigPersistence(current, ensured.workspace)
  assert.equal(prepared.workspace.modbus.sampleGenerations.p1, ensured.workspace.modbus.sampleGenerations.p1)
  assert.equal(prepared.workspace.modbus.sampleGenerations.p2, ensured.workspace.modbus.sampleGenerations.p2)
  assert.equal(prepared.workspace.modbus.sampleIdentitySchemaVersion, 2)
  assert.equal(prepared.workspace.modbus.configVersion, 8)
  assert.equal(prepared.workspace.modbus.values[0].value, 77)
  assert.equal(prepared.workspace.modbus.values[0].sampleIdentity.generation, 'old-1')
})

test('ambiguous resolution does not depend on owner insertion order', () => {
  const orders = [
    ['A', 'B', 'C', 'D'],
    ['D', 'C', 'B', 'A'],
    ['B', 'D', 'A', 'C'],
  ]
  for (const owners of orders) {
    const sessionConfigs = Object.fromEntries(owners.map((sid) => [sid, session('p1')]))
    const target = resolveEffectiveSampleTarget(layered(sessionConfigs).modbus, 'p1')
    assert.equal(target.kind, 'ambiguous', owners.join(','))
    if (target.kind === 'ambiguous') assert.equal(target.identities.length, 4)
  }
})
