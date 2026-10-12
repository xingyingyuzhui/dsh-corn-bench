import assert from 'node:assert/strict'
import { test } from 'node:test'
import { modbusRead } from '../../bench-modbus.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { resolveEffectiveSampleTarget } from '../../src/domain/modbus/effective-sample-target.mjs'
import { prepareConfigPersistence } from '../../src/domain/modbus/prepare-config-persistence.mjs'
import { sampleFingerprintOf } from '../../src/domain/modbus/point-sample-identity.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'

const point = (id, connectionId, deviceId, address = 0) => ({
  id,
  connectionId,
  deviceId,
  function: 3,
  address,
  scale: 1,
  offset: 0,
})
const device = (id, connectionId, unitId) => ({ id, connectionId, unitId })
const conn = (id, host, port, sim = false) => ({
  id,
  conn: { mode: 'tcp', host, tcpPort: port, sim },
})

test('two sessions with the same device id stamp their own units', () => {
  const modbus = {
    share: { enabled: true, connections: false, points: false, visualization: false },
    connections: [],
    devices: [],
    points: [],
    sessionConfigs: {
      A: {
        connections: [conn('c1', '10.0.0.1', 502)],
        devices: [device('d1', 'c1', 1)],
        points: [point('pa', 'c1', 'd1')],
      },
      B: {
        connections: [conn('c2', '10.0.0.2', 503)],
        devices: [device('d1', 'c2', 2)],
        points: [point('pb', 'c2', 'd1')],
      },
    },
  }
  const a = resolveEffectiveSampleTarget(modbus, 'pa')
  const b = resolveEffectiveSampleTarget(modbus, 'pb')
  assert.equal(a.kind, 'unique')
  assert.equal(b.kind, 'unique')
  if (a.kind !== 'unique' || b.kind !== 'unique') return
  assert.equal(a.device.unitId, 1)
  assert.equal(b.device.unitId, 2)
  assert.equal(a.ownerSessionId, 'A')
  const tuple = JSON.parse(
    sampleFingerprintOf({
      layer: a.layer,
      ownerSessionId: a.ownerSessionId,
      point: a.point,
      connection: a.connection,
      device: a.device,
    }),
  )
  assert.equal(tuple[6], 1)
  assert.deepEqual(tuple[5], ['tcp', '10.0.0.1', 502, false])
})

test('a third owner of the same point id stays ambiguous', () => {
  const owners = ['A', 'B', 'C']
  const sessionConfigs = Object.fromEntries(
    owners.map((sid) => [
      sid,
      {
        connections: [conn('c1', '10.0.0.1', 502)],
        devices: [device('d1', 'c1', 1)],
        points: [point('p1', 'c1', 'd1')],
      },
    ]),
  )
  const target = resolveEffectiveSampleTarget(
    {
      share: { enabled: true, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs,
    },
    'p1',
  )
  assert.equal(target.kind, 'ambiguous')
  if (target.kind === 'ambiguous') assert.equal(target.identities.length, 3)
})

test('leaving ambiguity mints a new generation and does not trust the old value', () => {
  const session = (sid) => ({
    connections: [conn('c1', '10.0.0.1', 502, true)],
    devices: [device('d1', 'c1', 1)],
    points: [point('p1', 'c1', 'd1')],
  })
  const base = {
    share: { enabled: true, connections: false, points: false, visualization: false },
    connections: [],
    devices: [],
    points: [],
    values: [],
    sampleIdentitySchemaVersion: 2,
  }
  const onlyA = { ...base, sessionConfigs: { A: session('A') } }
  const prepared = prepareConfigPersistence({ modbus: base }, { modbus: onlyA })
  const gen1 = prepared.workspace.modbus.sampleGenerations.p1
  assert.ok(gen1)
  const both = {
    ...prepared.workspace.modbus,
    sessionConfigs: { A: session('A'), B: session('B') },
  }
  const ambiguous = prepareConfigPersistence(prepared.workspace, { modbus: both })
  assert.equal(ambiguous.workspace.modbus.sampleGenerations.p1, undefined)
  const restored = prepareConfigPersistence(ambiguous.workspace, {
    modbus: { ...both, sessionConfigs: { A: session('A') } },
  })
  const gen2 = restored.workspace.modbus.sampleGenerations.p1
  assert.notEqual(gen2, gen1)
  assert.notEqual(gen2, undefined)
})

test('a private read asks transport for that session unit and stamps the same tuple', async (t) => {
  const bench = await createBench(t, { prefix: 'sample-unit-' })
  saveWorkspace(bench.home, bench.cwd, {
    modbus: {
      version: 3,
      share: { enabled: true, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      privateClaimSessionId: 'A',
      sessionConfigs: {
        A: {
          connections: [conn('c1', '10.0.0.1', 502)],
          devices: [device('d1', 'c1', 1)],
          points: [point('pa', 'c1', 'd1')],
        },
        B: {
          connections: [conn('c2', '10.0.0.2', 503)],
          devices: [device('d1', 'c2', 2)],
          points: [point('pb', 'c2', 'd1')],
        },
      },
    },
  })
  /** @type {any[]} */
  const seen = []
  const ran = await modbusRead(
    bench.home,
    bench.cwd,
    { sessionId: 'A', pointId: 'pa', connectionId: 'c1', deviceId: 'd1', source: 'user' },
    {
      sessionId: 'A',
      transport: {
        read: async (/** @type {any} */ req) => {
          seen.push(req)
          return { ok: true, data: [4] }
        },
      },
    },
  )
  assert.equal(ran.ok, true, JSON.stringify(ran))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].unitId, 1)
  const row = loadWorkspace(bench.home, bench.cwd).modbus.values.find((/** @type {any} */ item) => item.pointId === 'pa')
  const tuple = JSON.parse(row.sampleIdentity.fingerprint)
  assert.equal(tuple[0], 'private')
  assert.equal(tuple[1], 'A')
  assert.equal(tuple[6], seen[0].unitId)
  assert.equal(tuple[5][1], seen[0].endpoint.host)
  assert.equal(tuple[5][2], seen[0].endpoint.tcpPort)
  assert.equal(tuple[5][3], seen[0].endpoint.sim)
})
