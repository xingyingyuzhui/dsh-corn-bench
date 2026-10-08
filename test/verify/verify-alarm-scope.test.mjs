// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { countSessionAlarms } from '../../src/application/verify/verify-alarm-scope.mjs'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'
import { A, B, point } from '../agent/evidence-scope-fixtures.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'
import { alarmPoint, flatWorkspace, vpoint } from './verify-fixtures.mjs'

/**
 * @param {(cwd: string) => any} workspaceLoader
 * @param {string} sessionId
 * @param {string} [pointId]
 */
async function noAlarm(workspaceLoader, sessionId, pointId) {
  const result = await createVerifyService({ workspaceLoader }).runVerification({
    scenario: { id: 'na', name: 'na', assertions: [{ type: 'no.alarm', ...(pointId ? { pointId } : {}) }] },
    workspaceCwd: '/w',
    ownerSessionId: sessionId,
  })
  const a = result.assertions[0]
  return { status: result.status, outcome: a.outcome, reason: a.reason, actual: a.actual }
}

/** @param {any} ws */
const fixed = (ws) => () => ws

const activeRow = (/** @type {Record<string, any>} */ extra) => ({ group: 'process', condition: 'active', ...extra })
const commRow = (/** @type {string} */ cid) => ({ id: `comm:${cid}`, group: 'comm', connectionId: cid, condition: 'active' })
const polled = (/** @type {Record<string, any>} */ extra = {}) => ({ enabled: true, lastAt: Date.now() - 100, lastOk: true, ...extra })

/** Partitioned two-session workspace with an alarm rule on each private point. */
async function alarmBench(/** @type {any} */ t, /** @type {Record<string, any>} */ runtime = {}) {
  const { home, cwd } = await createBench(t, { prefix: 'dvb-verify-alarm-' })
  const rule = { alarmEnabled: true, alarmMax: 100 }
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 2,
      share: { enabled: false, connections: false, points: false },
      privateClaimSessionId: A,
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        [A]: {
          connections: [connection('c-a', 'tcp', '', { sim: true })],
          devices: [{ id: 'd-a', connectionId: 'c-a', name: 'DA', unitId: 1 }],
          points: [{ ...point('pa', 'c-a', 'd-a'), ...rule }],
        },
        [B]: {
          connections: [connection('c-b', 'tcp', '', { sim: true })],
          devices: [{ id: 'd-b', connectionId: 'c-b', name: 'DB', unitId: 1 }],
          points: [{ ...point('pb', 'c-b', 'd-b'), ...rule }],
        },
      },
      ...runtime,
    },
  })
  return (/** @type {string} */ c) => loadWorkspace(home, c === '/w' ? cwd : c)
}

test('no.alarm: another session active alarm is not counted; own alarm is', async (t) => {
  const load = await alarmBench(t, { alarmState: { pb: activeRow({ id: 'pb', pointId: 'pb', connectionId: 'c-b' }) } })
  assert.deepEqual(await noAlarm(load, A), { status: 'pass', outcome: 'pass', reason: undefined, actual: 0 })
  const b = await noAlarm(load, B)
  assert.equal(b.status, 'fail')
  assert.equal(b.actual, 1)
})

test('no.alarm: explicit target of another session is TARGET_UNAVAILABLE', async (t) => {
  const load = await alarmBench(t, { alarmState: { pb: activeRow({ id: 'pb', pointId: 'pb', connectionId: 'c-b' }) } })
  const r = await noAlarm(load, A, 'pb')
  assert.equal(r.status, 'error')
  assert.equal(r.reason, 'TARGET_UNAVAILABLE')
})

test('no.alarm: unattributable legacy alarm rows neither count nor create a source', async () => {
  const r = await noAlarm(fixed(flatWorkspace({ points: [vpoint('p1')], alarms: [{ id: 'alm_1', active: true }] })), 's')
  assert.equal(r.status, 'error')
  assert.equal(r.reason, 'NO_ALARM_SOURCE')
})

test('no.alarm: attributable legacy alarm row counts once', async () => {
  const ws = flatWorkspace({
    points: [alarmPoint('p1')],
    alarms: [{ id: 'p1', pointId: 'p1', active: true }],
    alarmState: { p1: activeRow({ id: 'p1', pointId: 'p1' }) },
  })
  const r = await noAlarm(fixed(ws), 's')
  assert.equal(r.status, 'fail')
  assert.equal(r.actual, 1)
})

test('no.alarm: no rule, disabled rule or disabled device is not a source', async () => {
  /** @type {Array<[string, any]>} */
  const cases = [
    ['no rule', flatWorkspace({ points: [vpoint('p1')] })],
    ['rule switched off', flatWorkspace({ points: [alarmPoint('p1', { alarmEnabled: false })] })],
    ['device disabled', (() => {
      const ws = flatWorkspace({ points: [alarmPoint('p1')] })
      ws.modbus.devices[0] = { ...ws.modbus.devices[0], enabled: false }
      return ws
    })()],
  ]
  for (const [label, ws] of cases) {
    const r = await noAlarm(fixed(ws), 's')
    assert.equal(r.reason, 'NO_ALARM_SOURCE', label)
    const explicit = await noAlarm(fixed(ws), 's', 'p1')
    assert.equal(explicit.reason, 'NO_ALARM_SOURCE', `${label} (explicit)`)
  }
})

test('no.alarm: explicit point with a rule passes on no active alarm and fails on one', async () => {
  assert.equal((await noAlarm(fixed(flatWorkspace({ points: [alarmPoint('p1')] })), 's', 'p1')).status, 'pass')
  const ws = flatWorkspace({ points: [alarmPoint('p1')], alarmState: { p1: activeRow({ id: 'p1', pointId: 'p1' }) } })
  assert.equal((await noAlarm(fixed(ws), 's', 'p1')).status, 'fail')
})

test('no.alarm: comm source needs an enabled, polling connection with a real poll result', async () => {
  const pass = await noAlarm(fixed(flatWorkspace({ pollingByConnection: { c1: polled() } })), 's')
  assert.equal(pass.status, 'pass')

  /** @type {Array<[string, any]>} */
  const cases = [
    ['before first poll', { c1: polled({ lastAt: 0 }) }],
    ['polling stopped', { c1: polled({ enabled: false }) }],
    ['no explicit lastOk', { c1: polled({ lastOk: undefined }) }],
    ['no polling state', {}],
  ]
  for (const [label, pollingByConnection] of cases) {
    const r = await noAlarm(fixed(flatWorkspace({ pollingByConnection })), 's')
    assert.equal(r.reason, 'NO_ALARM_SOURCE', label)
  }

  const disabled = flatWorkspace({ pollingByConnection: { c1: polled() } })
  disabled.modbus.connections[0] = { ...disabled.modbus.connections[0], enabled: false }
  assert.equal((await noAlarm(fixed(disabled), 's')).reason, 'NO_ALARM_SOURCE', 'connection disabled')
})

test('no.alarm: an active comm alarm still fails after polling stops', async () => {
  const ws = flatWorkspace({ pollingByConnection: { c1: polled({ enabled: false }) }, alarmState: { 'comm:c1': commRow('c1') } })
  const r = await noAlarm(fixed(ws), 's')
  assert.equal(r.status, 'fail')
  assert.equal(r.actual, 1)
})

test('no.alarm: a foreign polling connection is not a source for the caller', async (t) => {
  const load = await alarmBench(t, { pollingByConnection: { 'c-b': polled() } })
  const ws = load('/w')
  for (const cfg of Object.values(ws.modbus.sessionConfigs)) /** @type {any} */ (cfg).points = []
  ws.modbus.points = []
  const r = await noAlarm(fixed(ws), A)
  assert.equal(r.reason, 'NO_ALARM_SOURCE')
})

test('no.alarm: an ambiguously owned polling connection cannot support a pass', async (t) => {
  const { home, cwd } = await createBench(t, { prefix: 'dvb-verify-alarm-amb-' })
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 2,
      share: { enabled: false, connections: false, points: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        [A]: { connections: [connection('cx', 'tcp', '', { sim: true })], devices: [], points: [] },
        [B]: { connections: [connection('cx', 'tcp', '', { sim: true })], devices: [], points: [] },
      },
      pollingByConnection: { cx: polled() },
    },
  })
  const r = await noAlarm(() => loadWorkspace(home, cwd), A)
  assert.equal(r.status, 'error')
  assert.equal(r.reason, 'AMBIGUOUS_OWNER')
})

/** Partitioned workspace where A owns alarmPoint p1 (migrated from top-level). */
function partitionedCallerOwnsP1(/** @type {any[]} */ alarms = []) {
  const ws = flatWorkspace({ points: [alarmPoint('p1')], alarms })
  ws.modbus.sessionConfigs = {
    a: { connections: ws.modbus.connections, devices: ws.modbus.devices, points: ws.modbus.points },
    b: { connections: [], devices: [], points: [] },
  }
  ws.modbus.connections = []
  ws.modbus.devices = []
  ws.modbus.points = []
  ws.modbus.share = { enabled: false, connections: false, points: false }
  return ws
}

test('no.alarm: a foreign attributed legacy alarm must not enter the callers count', () => {
  const ws = partitionedCallerOwnsP1([
    { id: 'old-b-alarm', pointId: 'p1', sessionId: 'b', active: true },
  ])
  assert.equal(countSessionAlarms(ws, 'a'), 0)
})

test('no.alarm: partitioned ownerless legacy is hidden; unpartitioned ownerless stays compatible', () => {
  const partitioned = partitionedCallerOwnsP1([{ id: 'p1', pointId: 'p1', active: true }])
  assert.equal(countSessionAlarms(partitioned, 'a'), 0)

  const flat = flatWorkspace({
    points: [alarmPoint('p1')],
    alarms: [{ id: 'p1', pointId: 'p1', active: true }],
  })
  assert.equal(countSessionAlarms(flat, 's'), 1)
})

test('no.alarm: explicit foreign owner does not degrade to ownerless on an unpartitioned workspace', () => {
  const ws = flatWorkspace({
    points: [alarmPoint('p1')],
    alarms: [{ id: 'p1', pointId: 'p1', sessionId: 'other', active: true }],
  })
  assert.equal(countSessionAlarms(ws, 's'), 0)
})

test('no.alarm: same-ID legacy rows with two owners — caller wins in both orders', () => {
  const foreignThenOwn = partitionedCallerOwnsP1([
    { id: 'p1', pointId: 'p1', sessionId: 'b', active: true },
    { id: 'p1', pointId: 'p1', sessionId: 'a', active: true },
  ])
  const ownThenForeign = partitionedCallerOwnsP1([
    { id: 'p1', pointId: 'p1', sessionId: 'a', active: true },
    { id: 'p1', pointId: 'p1', sessionId: 'b', active: true },
  ])
  assert.equal(countSessionAlarms(foreignThenOwn, 'a'), 1)
  assert.equal(countSessionAlarms(ownThenForeign, 'a'), 1)
})

test('no.alarm: conflicting sessionId and ownerSessionId are not attributable', () => {
  const ws = partitionedCallerOwnsP1([
    { id: 'p1', pointId: 'p1', sessionId: 'a', ownerSessionId: 'b', active: true },
  ])
  assert.equal(countSessionAlarms(ws, 'a'), 0)
})

test('no.alarm: current alarmState with explicit foreign owner is hidden; ownerless current still uses target rules', () => {
  const foreignCurrent = partitionedCallerOwnsP1()
  foreignCurrent.modbus.alarmState = {
    p1: activeRow({ id: 'p1', pointId: 'p1', sessionId: 'b' }),
  }
  assert.equal(countSessionAlarms(foreignCurrent, 'a'), 0)

  const ownerlessCurrent = partitionedCallerOwnsP1()
  ownerlessCurrent.modbus.alarmState = { p1: activeRow({ id: 'p1', pointId: 'p1' }) }
  assert.equal(countSessionAlarms(ownerlessCurrent, 'a'), 1)
})

test('no.alarm: only foreign legacy and no caller source is unverifiable', () => {
  const ws = partitionedCallerOwnsP1([
    { id: 'old-b-alarm', pointId: 'orphan', sessionId: 'b', active: true },
  ])
  for (const cfg of Object.values(ws.modbus.sessionConfigs)) /** @type {any} */ (cfg).points = []
  const r = countSessionAlarms(ws, 'a')
  assert.equal(typeof r, 'object')
  assert.equal(/** @type {any} */ (r).reason, 'NO_ALARM_SOURCE')
})

test('no.alarm: rules with no active alarm yield zero; session active still counts after poll stops', async () => {
  const zero = await noAlarm(fixed(flatWorkspace({ points: [alarmPoint('p1')] })), 's')
  assert.deepEqual(zero, { status: 'pass', outcome: 'pass', reason: undefined, actual: 0 })

  const ws = flatWorkspace({
    points: [alarmPoint('p1')],
    pollingByConnection: { c1: polled({ enabled: false }) },
    alarmState: { p1: activeRow({ id: 'p1', pointId: 'p1' }) },
  })
  const stopped = await noAlarm(fixed(ws), 's')
  assert.equal(stopped.status, 'fail')
  assert.equal(stopped.actual, 1)
})

test('no.alarm: diagnostics do not leak foreign owner or alarm ids', async () => {
  const ws = partitionedCallerOwnsP1([
    { id: 'old-b-alarm', pointId: 'orphan', sessionId: 'b', ownerSessionId: 'b', active: true },
  ])
  for (const cfg of Object.values(ws.modbus.sessionConfigs)) /** @type {any} */ (cfg).points = []
  const r = await noAlarm(fixed(ws), 'a')
  assert.equal(r.reason, 'NO_ALARM_SOURCE')
  const blob = JSON.stringify(r)
  assert.equal(blob.includes('old-b-alarm'), false)
  assert.equal(blob.includes('"b"'), false)
  assert.equal(blob.includes('ownerSessionId'), false)
})
