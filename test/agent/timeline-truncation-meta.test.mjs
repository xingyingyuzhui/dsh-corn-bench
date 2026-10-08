// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { saveWorkspace } from '../../bench-store.mjs'
import { visionBenchTool } from '../../bench-tool.mjs'
import { AGENT_TEXT_CAPS, utf8ByteLength } from '../../src/application/commands/agent-result-caps.mjs'
import { projectAgentResult } from '../../src/application/commands/agent-result-projection.mjs'
import { registerVisionHost, unregisterVisionHost } from '../../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher } from '../../src/interfaces/http/vision-command-routes.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

/**
 * @param {import('node:test').TestContext} t
 * @param {any[]} timeline
 */
async function toolRunner(t, timeline) {
  const bench = await createBench(t, { prefix: 'dvb-tl-meta-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 1,
      share: { enabled: false, connections: false, points: false },
      privateClaimSessionId: 'session-a',
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        'session-a': {
          connections: [connection('c1', 'tcp', '', { sim: true })],
          devices: [],
          points: [],
        },
      },
    },
    timeline,
  })
  unregisterVisionHost()
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  t.after(() => {
    stop()
    unregisterVisionHost()
  })
  const tool = visionBenchTool(home)
  const run = (/** @type {any} */ args) =>
    tool.execute(args, { agent: { session: { header: { cwd, id: 'session-a' } } } })
  return { home, cwd, run }
}

test('timeline events always expose summaryTruncated; normal paging is not budgetTruncated', async (t) => {
  const long = '警'.repeat(240)
  const short = 'ok-ok'
  const { home, cwd, run } = await toolRunner(t, [
    { id: 'e0', at: 2, kind: 'read', source: 'agent', sessionId: 'session-a', taskId: '', ok: true, summary: long },
    { id: 'e1', at: 1, kind: 'read', source: 'agent', sessionId: 'session-a', taskId: '', ok: true, summary: short },
  ])

  const page = await run({ action: 'timeline.list', limit: 1 })
  assert.equal(page.ok, true, page.error)
  assert.equal(page.returned, 1)
  assert.equal(page.events[0].id, 'e0')
  assert.equal(page.events[0].summary.length, 180)
  assert.equal(page.events[0].summaryTruncated, true)
  assert.equal(page.nextCursor, 'e0')
  assert.equal(page.truncated, true, 'legacy truncated still means more pages remain')
  assert.equal(page.budgetTruncated, false, 'limit paging alone is not a budget shrink')

  const host = await runVisionBench(home, { action: 'timeline.list', limit: 1 }, cwd, {
    source: 'agent',
    sessionId: 'session-a',
  })
  assert.equal(host.truncated, false)
  assert.equal(host.events[0].summaryTruncated, true)

  const last = await run({ action: 'timeline.list', limit: 2 })
  assert.equal(last.ok, true, last.error)
  assert.equal(last.nextCursor, null)
  assert.equal(last.budgetTruncated, false)
  assert.equal(last.events[0].summaryTruncated, true)
  assert.equal(last.events[1].summaryTruncated, false)
  assert.equal(last.events[1].summary, short)
})

test('budgetTruncated is true only when the Agent projection shrinks a Host page', async (t) => {
  const summary = '警'.repeat(180)
  const timeline = Array.from({ length: 50 }, (_, i) => ({
    id: `e${String(i).padStart(2, '0')}`,
    at: 50 - i,
    kind: 'alarm',
    source: 'agent',
    sessionId: 'session-a',
    taskId: 'task',
    ok: true,
    summary,
  }))
  const { home, cwd } = await toolRunner(t, timeline)
  const host = await runVisionBench(home, { action: 'timeline.list', limit: 50 }, cwd, {
    source: 'agent',
    sessionId: 'session-a',
  })
  assert.equal(host.ok, true, host.error)
  assert.equal(host.returned, 50)
  assert.equal(host.truncated, false)
  const agent = projectAgentResult({ action: 'timeline.list' }, host)
  assert.ok(agent.returned < 50)
  assert.equal(agent.budgetTruncated, true)
  assert.equal(agent.truncated, true)
  assert.equal(agent.nextCursor, agent.events[agent.events.length - 1].id)
  assert.ok(utf8ByteLength(agent) <= AGENT_TEXT_CAPS.listBytes)
})

test('RESULT_TOO_LARGE keeps returned=0 nextCursor=null and commandId', () => {
  // Bypass the 180-char Host summary clip: projection still refuses a single
  // event that alone exceeds the Agent list byte cap.
  const page = projectAgentResult(
    { action: 'timeline.list' },
    {
      ok: true,
      action: 'timeline.list',
      commandId: 'cmd-tl-meta',
      total: 1,
      returned: 1,
      nextCursor: null,
      truncated: false,
      events: [
        {
          id: 'huge',
          at: 1,
          kind: 'alarm',
          source: 'agent',
          sessionId: 's',
          taskId: '',
          ok: true,
          summary: '警'.repeat(20_000),
          summaryTruncated: true,
        },
      ],
    },
  )
  assert.equal(page.ok, false)
  assert.equal(page.errorCode, 'RESULT_TOO_LARGE')
  assert.equal(page.returned, 0)
  assert.equal(page.nextCursor, null)
  assert.equal(page.eventId, 'huge')
  assert.equal(page.commandId, 'cmd-tl-meta')
})
