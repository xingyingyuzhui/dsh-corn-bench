// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { saveWorkspace } from '../../bench-store.mjs'
import { cornBenchTool } from '../../bench-tool.mjs'
import { executeCornCommand } from '../../src/application/commands/corn-command-service.mjs'
import { registerCornHost, unregisterCornHost } from '../../src/infrastructure/host/corn-host-client.mjs'
import { validateAgentToolArgs } from '../../src/interfaces/agent/agent-tool-preflight.mjs'
import { createCornCommandDispatcher } from '../../src/interfaces/http/corn-command-routes.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

/**
 * @param {import('node:test').TestContext} t
 * @param {string} home
 * @param {string} cwd
 * @param {string} sessionId
 */
function agentExec(t, home, cwd, sessionId) {
  unregisterCornHost()
  const stop = registerCornHost(createCornCommandDispatcher(home))
  t.after(() => {
    stop()
    unregisterCornHost()
  })
  const tool = cornBenchTool(home)
  return (/** @type {any} */ args) =>
    tool.execute(args, { agent: { session: { header: { cwd, id: sessionId } } } })
}

/** @param {any} t */
async function pointsBench(t) {
  const bench = await createBench(t, { prefix: 'dvb-qf-app-' })
  const { home, cwd } = bench
  const points = Array.from({ length: 26 }, (_, i) => ({
    id: `p${String(i).padStart(2, '0')}`,
    name: `N${i}`,
    connectionId: 'c1',
    deviceId: 'd1',
    function: 3,
    address: i,
    type: 'uint16',
  }))
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 2,
      share: { enabled: false, connections: false, points: false },
      privateClaimSessionId: 'session-a',
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        'session-a': {
          connections: [connection('c1', 'tcp', '', { sim: true })],
          devices: [{ id: 'd1', connectionId: 'c1', name: 'D', unitId: 1 }],
          points,
        },
      },
    },
    timeline: [
      { id: 'e1', at: 2, kind: 'read', source: 'agent', sessionId: 'session-a', taskId: '', ok: true, summary: 'ok' },
    ],
  })
  return { home, cwd, run: agentExec(t, home, cwd, 'session-a') }
}

test('points list rejects kind and id before reading; get/focus/frames keep legal aliases', async (t) => {
  const { home, cwd, run } = await pointsBench(t)

  const withKind = await run({ action: 'points', op: 'list', kind: 'log', view: 'summary' })
  assert.equal(withKind.ok, false)
  assert.equal(withKind.errorCode, 'INVALID_FIELD')
  assert.equal(withKind.details.field, 'kind')
  assert.equal(withKind.details.reason, 'UNSUPPORTED_FIELD')
  assert.ok(withKind.commandId)
  assert.ok(withKind.details.supportedBy.includes('focus'))

  const withId = await run({ action: 'points', op: 'list', id: 'p00' })
  assert.equal(withId.ok, false)
  assert.equal(withId.details.field, 'id')
  assert.equal(withId.details.reason, 'UNSUPPORTED_FIELD')
  assert.ok(withId.commandId)

  const listed = await run({ action: 'points', op: 'list', view: 'summary' })
  assert.equal(listed.ok, true, listed.error)
  assert.equal(listed.total, 26)
  assert.equal(listed.returned, 20)

  const got = await run({ action: 'points', op: 'get', id: 'p00' })
  assert.equal(got.ok, true, got.error)
  assert.equal(got.points[0].id, 'p00')

  const focus = await run({
    action: 'focus',
    kind: 'point',
    connectionId: 'c1',
    deviceId: 'd1',
    pointId: 'p00',
  })
  assert.equal(focus.ok, true, focus.error)

  const frames = await run({ action: 'frames', connectionId: 'c1', id: 'no-such-frame' })
  assert.equal(frames.ok, false)
  assert.notEqual(frames.details?.field, 'id', 'frames id is a legal frameId alias, not UNSUPPORTED_FIELD')

  const host = await executeCornCommand({
    home,
    cwd,
    sessionId: 'session-a',
    source: 'agent',
    action: 'points',
    payload: { action: 'points', op: 'list', kind: 'log' },
  })
  assert.equal(host.ok, false)
  assert.equal(host.details.field, 'kind')
  assert.ok(host.commandId)
})

test('evidence top-level kind/id and timeline kind are rejected with the same contract', async (t) => {
  const { run } = await pointsBench(t)

  const evidenceKind = await run({ action: 'evidence', kind: 'log' })
  assert.equal(evidenceKind.ok, false)
  assert.equal(evidenceKind.errorCode, 'INVALID_FIELD')
  assert.equal(evidenceKind.details.field, 'kind')
  assert.equal(evidenceKind.details.reason, 'UNSUPPORTED_FIELD')
  assert.ok(evidenceKind.commandId)
  assert.match(evidenceKind.hint, /timeline\.list/)

  const evidenceId = await run({ action: 'evidence', id: 'e1' })
  assert.equal(evidenceId.details.field, 'id')
  assert.ok(evidenceId.commandId)

  const timelineKind = await run({ action: 'timeline.list', kind: 'read' })
  assert.equal(timelineKind.ok, false)
  assert.equal(timelineKind.details.field, 'kind')
  assert.ok(timelineKind.commandId)
  assert.match(timelineKind.hint, /focus/)
  assert.doesNotMatch(timelineKind.hint, /points list/)

  const timelineOk = await run({ action: 'timeline.list' })
  assert.equal(timelineOk.ok, true, timelineOk.error)
  assert.equal(timelineOk.returned, 1)
})

/**
 * @param {any} result
 * @param {string} field
 */
function assertFieldReject(result, field) {
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'INVALID_FIELD')
  assert.equal(result.details.field, field)
  assert.equal(result.details.reason, 'UNSUPPORTED_FIELD')
  assert.ok(result.details.supportedBy?.length)
}

test('status and trend reject kind/id on Host and preflight with commandId', async (t) => {
  const { home, cwd, run } = await pointsBench(t)

  for (const action of /** @type {const} */ (['status', 'trend'])) {
    const kindArgs =
      action === 'trend'
        ? { action, connectionId: 'c1', kind: 'point' }
        : { action, kind: 'point' }
    const idArgs =
      action === 'trend'
        ? { action, connectionId: 'c1', id: 'c1:d1:p00' }
        : { action, id: 'c1:d1:p00' }

    const preflightKind = validateAgentToolArgs(kindArgs, { pack: null })
    assertFieldReject(preflightKind, 'kind')
    assert.match(preflightKind.hint, /focus/)
    assert.match(preflightKind.hint, /evidence\[\]\.kind/)
    assert.doesNotMatch(preflightKind.hint, /points list/)
    assert.ok(preflightKind.details.supportedBy.includes('focus'))
    assert.ok(preflightKind.details.supportedBy.includes('evidence[].kind'))

    const preflightId = validateAgentToolArgs(idArgs, { pack: null })
    assertFieldReject(preflightId, 'id')
    assert.match(preflightId.hint, /points get\/remove\/update/)
    assert.doesNotMatch(preflightId.hint, /trendKey/)

    const toolKind = await run(kindArgs)
    assertFieldReject(toolKind, 'kind')
    assert.ok(toolKind.commandId)
    assert.equal(toolKind.errorCode, preflightKind.errorCode)
    assert.equal(toolKind.details.reason, preflightKind.details.reason)

    const toolId = await run(idArgs)
    assertFieldReject(toolId, 'id')
    assert.ok(toolId.commandId)
    assert.equal(toolId.errorCode, preflightId.errorCode)
    assert.equal(toolId.details.reason, preflightId.details.reason)

    const hostKind = await executeCornCommand({
      home,
      cwd,
      sessionId: 'session-a',
      source: 'agent',
      action,
      payload: kindArgs,
    })
    assertFieldReject(hostKind, 'kind')
    assert.ok(hostKind.commandId)
    assert.equal(hostKind.errorCode, preflightKind.errorCode)
    assert.equal(hostKind.details.reason, preflightKind.details.reason)

    const hostId = await executeCornCommand({
      home,
      cwd,
      sessionId: 'session-a',
      source: 'agent',
      action,
      payload: idArgs,
    })
    assertFieldReject(hostId, 'id')
    assert.ok(hostId.commandId)
    assert.equal(hostId.errorCode, preflightId.errorCode)
    assert.equal(hostId.details.reason, preflightId.details.reason)
  }

  const statusOk = await run({ action: 'status' })
  assert.equal(statusOk.ok, true, statusOk.error)
  assert.ok(statusOk.commandId)

  const uiStatusKind = await executeCornCommand({
    home,
    cwd,
    sessionId: 'session-a',
    source: 'ui',
    action: 'status',
    payload: { action: 'status', kind: 'point' },
  })
  assert.equal(uiStatusKind.ok, true, uiStatusKind.error)
})

test('trend keeps legal filters; id is not a trendKey alias', async (t) => {
  const { home, cwd, run } = await pointsBench(t)
  const now = Date.now()

  const byTrendKey = await run({
    action: 'trend',
    trendKey: 'c1:d1:p00',
    start: now - 60_000,
    end: now,
    limit: 5,
  })
  assert.equal(byTrendKey.ok, true, byTrendKey.error)
  assert.notEqual(byTrendKey.details?.field, 'id')

  const byPoint = await run({
    action: 'trend',
    connectionId: 'c1',
    deviceId: 'd1',
    pointId: 'p00',
    start: now - 60_000,
    end: now,
    limit: 5,
  })
  assert.equal(byPoint.ok, true, byPoint.error)

  const byPointIds = await run({
    action: 'trend',
    connectionId: 'c1',
    pointIds: ['p00', 'p01'],
    start: now - 60_000,
    end: now,
    limit: 5,
  })
  assert.equal(byPointIds.ok, true, byPointIds.error)

  const idAsKey = await run({
    action: 'trend',
    connectionId: 'c1',
    id: 'c1:d1:p00',
    start: now - 60_000,
    end: now,
  })
  assertFieldReject(idAsKey, 'id')
  assert.ok(idAsKey.commandId)

  const hostTrend = await executeCornCommand({
    home,
    cwd,
    sessionId: 'session-a',
    source: 'agent',
    action: 'trend',
    payload: { action: 'trend', trendKey: 'c1:d1:p00', start: now - 60_000, end: now, limit: 5 },
  })
  assert.equal(hostTrend.ok, true, hostTrend.error)

  const alarmId = await run({ action: 'alarm', connectionId: 'c1', id: 'not-an-alarm' })
  assertFieldReject(alarmId, 'id')
  assert.match(alarmId.hint, /alarmId/)
  assert.doesNotMatch(alarmId.hint, /points list/)
})
