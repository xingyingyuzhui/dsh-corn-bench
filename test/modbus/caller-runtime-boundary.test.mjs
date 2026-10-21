import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionWorkspaceView } from '../../src/interfaces/rpc/vision-rpc-workspace.mjs'
import { flatWorkspace, liveValue, stampWorkspace, vpoint } from '../verify/verify-fixtures.mjs'
import { createBench, connection } from '../helpers/workspace-factory.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'

test('caller RPC snapshot must hide another sessions runtime values', () => {
  const ws = stampWorkspace({
    modbus: {
      version: 3,
      share: { enabled: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        a: {
          connections: [connection('c1', 'tcp', '', { sim: true })],
          devices: [{ id: 'd1', connectionId: 'c1', unitId: 1 }],
          points: [vpoint('pA')],
        },
        b: {
          connections: [connection('c2', 'tcp', '', { sim: true })],
          devices: [{ id: 'd2', connectionId: 'c2', unitId: 2 }],
          points: [vpoint('pB', { connectionId: 'c2', deviceId: 'd2' })],
        },
      },
      values: [liveValue('pA', 1), liveValue('pB', 8888, { connectionId: 'c2', deviceId: 'd2' })],
    },
  })
  const view = sessionWorkspaceView(ws, 'a', '/tmp/review-ws')
  assert.deepEqual(
    view.modbus.points.map((p) => p.id),
    ['pA'],
  )
  assert.equal(
    view.modbus.values.some((v) => v.pointId === 'pB'),
    false,
    JSON.stringify(view.modbus.values),
  )
})

test('points get cannot present a previous address stamped value as current available data', async (t) => {
  const b = await createBench(t, { prefix: 'review-all-value-' })
  saveWorkspace(
    b.home,
    b.cwd,
    stampWorkspace(flatWorkspace({ points: [vpoint('p1', { scale: 1, offset: 0 })], values: [liveValue('p1', 77)] }), {
      sessionId: 'a',
    }),
  )
  const before = loadWorkspace(b.home, b.cwd)
  const update = await runVisionBench(
    b.home,
    {
      action: 'points',
      op: 'update',
      expectedConfigVersion: before.modbus.configVersion,
      points: [{ id: 'p1', address: 5 }],
    },
    b.cwd,
    { source: 'agent', sessionId: 'a' },
  )
  assert.equal(update.ok, true, update.error)
  const after = loadWorkspace(b.home, b.cwd)
  assert.notEqual(after.modbus.sampleGenerations.p1, before.modbus.sampleGenerations.p1)
  const query = await runVisionBench(b.home, { action: 'points', op: 'get', ids: ['p1'] }, b.cwd, {
    source: 'agent',
    sessionId: 'a',
  })
  assert.equal(query.ok, true, query.error)
  assert.equal(query.points[0].valueStatus, 'unavailable', JSON.stringify(query.points[0]))
})

test('name-only changes keep a sample, geometry changes hide it, and a fresh capture restores it', async (t) => {
  const b = await createBench(t, { prefix: 'query-sample-boundary-' })
  saveWorkspace(
    b.home,
    b.cwd,
    stampWorkspace(flatWorkspace({ points: [vpoint('p1', { scale: 1, offset: 0 })], values: [liveValue('p1', 77)] }), {
      sessionId: 'a',
    }),
  )
  const query = (op = 'get') =>
    runVisionBench(b.home, { action: 'points', op, ...(op === 'get' ? { ids: ['p1'] } : {}) }, b.cwd, {
      source: 'agent',
      sessionId: 'a',
    })
  const update = (patch) =>
    runVisionBench(
      b.home,
      {
        action: 'points',
        op: 'update',
        expectedConfigVersion: loadWorkspace(b.home, b.cwd).modbus.configVersion,
        points: [{ id: 'p1', ...patch }],
      },
      b.cwd,
      { source: 'agent', sessionId: 'a' },
    )
  assert.equal((await query()).points[0].valueStatus, 'available')
  assert.equal((await update({ name: 'Renamed' })).ok, true)
  assert.equal((await query('list')).points[0].value, 77)
  assert.equal((await update({ scale: 2 })).ok, true)
  for (const op of ['get', 'list']) {
    const result = await query(op)
    assert.equal(result.points[0].valueStatus, 'unavailable')
    assert.equal(result.points[0].value, null)
  }
  const ws = loadWorkspace(b.home, b.cwd)
  ws.modbus.values = [liveValue('p1', 154)]
  saveWorkspace(b.home, b.cwd, stampWorkspace(ws))
  assert.equal((await query()).points[0].value, 154)
})
