import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { mutateConfig } from '../../src/application/config/config-mutation-service.mjs'
import { sessionWorkspaceView } from '../../src/interfaces/rpc/vision-rpc-workspace.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'
import { createRouter } from '../helpers/rpc-factory.mjs'
import { liveValue, stampWorkspace, vpoint } from '../verify/verify-fixtures.mjs'

function layered() {
  const cfg = (sid) => ({
    connections: [connection(`c${sid}`, 'tcp', '', { sim: true })],
    devices: [{ id: `d${sid}`, connectionId: `c${sid}`, unitId: 1 }],
    points: [vpoint(`p${sid}`, { connectionId: `c${sid}`, deviceId: `d${sid}`, scale: 1, offset: 0 })],
  })
  return stampWorkspace({
    modbus: {
      version: 3,
      configVersion: 1,
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: { a: cfg('a'), b: cfg('b') },
      share: { enabled: false },
      values: [
        liveValue('pa', 11, { connectionId: 'ca', deviceId: 'da' }),
        liveValue('pb', 8888, { connectionId: 'cb', deviceId: 'db' }),
      ],
      pollingByConnection: { ca: { enabled: false }, cb: { enabled: false } },
      framesByConnection: { ca: [{ at: 1, hex: 'AA' }], cb: [{ at: 2, hex: 'BB' }] },
      trend: { pa: [[1, 11]], pb: [[2, 8888]] },
      alarmState: { pa: { pointId: 'pa', active: true }, pb: { pointId: 'pb', active: true } },
    },
    tasks: [
      { id: 'task-a', sessionId: 'a' },
      { id: 'task-b', sessionId: 'b' },
    ],
    timeline: [
      { id: 'event-a', sessionId: 'a' },
      { id: 'event-b', sessionId: 'b' },
    ],
    manualRequests: [
      { id: 'request-a', sessionId: 'a' },
      { id: 'request-b', sessionId: 'b' },
    ],
    log: [{ summary: 'unattributed-secret' }],
    focus: { sessionId: 'b', request: { kind: 'point', pointId: 'pb', connectionId: 'cb', deviceId: 'db' }, evidence: [{ kind: 'log', id: 'event-b' }] },
  })
}

function assertA(view) {
  assert.deepEqual(
    view.modbus.points.map((p) => p.id),
    ['pa'],
  )
  assert.deepEqual(
    view.modbus.values.map((p) => p.pointId),
    ['pa'],
  )
  for (const key of ['pollingByConnection', 'framesByConnection'])
    assert.deepEqual(Object.keys(view.modbus[key]), ['ca'])
  for (const key of ['alarmState', 'trend']) assert.deepEqual(Object.keys(view.modbus[key]), ['pa'])
  for (const key of ['tasks', 'timeline', 'manualRequests']) assert.ok(view[key].every((row) => row.sessionId === 'a'))
  assert.equal(view.focus.request, null)
  assert.deepEqual(view.focus.evidence, [])
  const json = JSON.stringify(view)
  for (const hidden of [
    '8888',
    'task-b',
    'event-b',
    'request-b',
    'unattributed-secret',
    'sampleIdentity',
    'sampleGenerations',
    'sessionConfigs',
  ])
    assert.equal(json.includes(hidden), false, hidden)
}

test('projection scopes every runtime map and journal without changing the layered source', () => {
  const ws = layered()
  const before = JSON.stringify(ws)
  assertA(sessionWorkspaceView(ws, 'a'))
  const anon = sessionWorkspaceView(ws, '')
  assert.equal(anon.modbus.values.length, 0)
  assert.equal(anon.tasks.length, 0)
  assert.equal(JSON.stringify(ws), before)
})

test('workspace/get, state, workspace/save and config responses share the same runtime boundary', async (t) => {
  const bench = await createBench(t, { prefix: 'caller-runtime-' })
  saveWorkspace(bench.home, bench.cwd, layered())
  const { dispatch } = createRouter(bench.home)
  for (const endpoint of ['workspace/get', 'state']) {
    const res = await dispatch(endpoint, { cwd: bench.cwd, sessionId: 'a' })
    assert.equal(res.ok, true, res.error)
    assertA(res.workspace)
    assert.equal(JSON.stringify(res.journal).includes('event-b'), false)
  }
  const saved = await dispatch('workspace/save', {
    cwd: bench.cwd,
    sessionId: 'a',
    modbus: { activeConnectionId: 'ca' },
  })
  assert.equal(saved.ok, true, saved.error)
  assertA(saved.workspace)
  const current = loadWorkspace(bench.home, bench.cwd)
  const updated = await mutateConfig({
    home: bench.home,
    cwd: bench.cwd,
    sessionId: 'a',
    expectedConfigVersion: current.modbus.configVersion,
    operation: 'connection.update',
    target: { connectionId: 'ca' },
    value: { name: 'Renamed' },
  })
  assert.equal(updated.ok, true, updated.error)
  assertA(updated.workspace)
  assert.equal(
    loadWorkspace(bench.home, bench.cwd).modbus.values.some((row) => row.pointId === 'pb'),
    true,
  )
})

test('shared runtime is visible, but private journals stay with their owner', () => {
  const ws = layered()
  ws.modbus.share = { enabled: true, connections: true, points: true }
  ws.modbus.connections = ws.modbus.sessionConfigs.a.connections
  ws.modbus.devices = ws.modbus.sessionConfigs.a.devices
  ws.modbus.points = ws.modbus.sessionConfigs.a.points
  ws.modbus.framesByConnection.ca.push({ at: 3, hex: 'FOREIGN-FRAME', sessionId: 'a' })
  const published = stampWorkspace(ws)
  const view = sessionWorkspaceView(published, 'b')
  assert.deepEqual(
    view.modbus.values.map((row) => row.pointId),
    ['pa'],
  )
  assert.ok(view.tasks.every((row) => row.sessionId === 'b'))
  assert.deepEqual(Object.keys(view.modbus.trend), ['pa'])
  assert.equal(JSON.stringify(view.modbus.framesByConnection).includes('FOREIGN-FRAME'), false)
})

test('duplicate private point/connection ids cannot unlock raw runtime rows', () => {
  const ws = layered()
  ws.modbus.sessionConfigs.b = structuredClone(ws.modbus.sessionConfigs.a)
  const view = sessionWorkspaceView(ws, 'a')
  assert.equal(view.modbus.values.length, 0)
  assert.deepEqual(view.modbus.trend, {})
  assert.deepEqual(view.modbus.alarmState, {})
  assert.deepEqual(view.modbus.framesByConnection, {})
})
