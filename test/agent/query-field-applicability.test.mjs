// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { saveWorkspace } from '../../bench-store.mjs'
import { visionBenchTool } from '../../bench-tool.mjs'
import { executeVisionCommand } from '../../src/application/commands/vision-command-service.mjs'
import { registerVisionHost, unregisterVisionHost } from '../../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher } from '../../src/interfaces/http/vision-command-routes.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

/**
 * @param {import('node:test').TestContext} t
 * @param {string} home
 * @param {string} cwd
 * @param {string} sessionId
 */
function agentExec(t, home, cwd, sessionId) {
  unregisterVisionHost()
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  t.after(() => {
    stop()
    unregisterVisionHost()
  })
  const tool = visionBenchTool(home)
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

  const host = await executeVisionCommand({
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

  const evidenceId = await run({ action: 'evidence', id: 'e1' })
  assert.equal(evidenceId.details.field, 'id')
  assert.ok(evidenceId.commandId)

  const timelineKind = await run({ action: 'timeline.list', kind: 'read' })
  assert.equal(timelineKind.ok, false)
  assert.equal(timelineKind.details.field, 'kind')
  assert.ok(timelineKind.commandId)

  const timelineOk = await run({ action: 'timeline.list' })
  assert.equal(timelineOk.ok, true, timelineOk.error)
  assert.equal(timelineOk.returned, 1)
})
