// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { appendEvidence, loadWorkspace } from '../../bench-store.mjs'
import { projectAgentResult } from '../../src/application/commands/agent-result-projection.mjs'
import { requestFocus } from '../../src/application/modbus/focus-service.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { A, B, rawDiskBytes, twoSessionBench } from './evidence-scope-fixtures.mjs'

const target = { connectionId: 'c-a', deviceId: 'd-a', pointId: 'pa' }
const logA = { kind: 'log', id: 'a-event' }

test('body.sessionId/source never override the explicit origin', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const ran = await requestFocus(home, cwd, { target, sessionId: B, source: 'agent' }, { source: 'user', sessionId: A })
  assert.equal(ran.ok, true, ran.error)
  const focus = loadWorkspace(home, cwd).focus
  assert.equal(focus.sessionId, A)
  assert.equal(focus.request.by, 'user')
})

test('omitting origin on a partitioned workspace is SESSION_REQUIRED even with body sid', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const before = rawDiskBytes(home, cwd)
  const ran = await requestFocus(home, cwd, { target, sessionId: A, source: 'agent' })
  assert.equal(ran.errorCode, 'SESSION_REQUIRED')
  assert.deepEqual(rawDiskBytes(home, cwd), before)
})

test('focus evidence must be an array of at most 20 rows, all validated', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const origin = { source: 'user', sessionId: A }
  const before = rawDiskBytes(home, cwd)
  for (const evidence of [null, { kind: 'log', id: 'a-event' }, 'a-event']) {
    const ran = await requestFocus(home, cwd, { target, evidence }, origin)
    assert.equal(ran.errorCode, 'INVALID_FIELD', JSON.stringify(evidence))
  }
  const twentyOne = [...Array.from({ length: 20 }, () => logA), { kind: 'log', id: 'b-event' }]
  const over = await requestFocus(home, cwd, { target, evidence: twentyOne }, origin)
  assert.equal(over.errorCode, 'INVALID_FIELD')
  assert.equal(over.details?.maxItems, 20)
  const lastBad = [...Array.from({ length: 19 }, () => logA), { kind: 'log', id: 'b-event' }]
  const bad = await requestFocus(home, cwd, { target, evidence: lastBad }, origin)
  assert.equal(bad.errorCode, 'TARGET_MISMATCH')
  assert.deepEqual(rawDiskBytes(home, cwd), before)

  const ok = await requestFocus(home, cwd, { target, evidence: Array.from({ length: 20 }, () => logA) }, origin)
  assert.equal(ok.ok, true, ok.error)
  assert.equal(loadWorkspace(home, cwd).focus.evidence.length, 20)
  const none = await requestFocus(home, cwd, { target }, origin)
  assert.equal(none.ok, true, none.error)
})

test('Agent focus errors keep commandId and errorCode through the projection', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const host = await runVisionBench(
    home,
    { action: 'focus', ...target, evidence: Array.from({ length: 21 }, () => logA) },
    cwd,
    { source: 'agent', sessionId: A },
  )
  const agent = projectAgentResult({ action: 'focus' }, host)
  assert.equal(agent.errorCode, 'INVALID_FIELD')
  assert.equal(agent.details?.maxItems, 20)
  assert.ok(agent.commandId)
})

test('concurrent focus and append for the same session both land', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const [f, a] = await Promise.all([
    requestFocus(home, cwd, { target }, { source: 'user', sessionId: A }),
    appendEvidence(home, cwd, [logA], A),
  ])
  assert.equal(f.ok, true, f.error)
  assert.equal(a.ok, true, a.error)
  assert.equal(loadWorkspace(home, cwd).focus.sessionId, A)
})
