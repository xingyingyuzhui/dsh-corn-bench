// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { appendEvidence, loadWorkspace } from '../../bench-store.mjs'
import { createCornRpcRouter } from '../../src/interfaces/rpc/corn-rpc-router.mjs'
import { runCornBench } from '../helpers/run-corn-bench.mjs'
import { A, twoSessionBench } from './evidence-scope-fixtures.mjs'

/** Rows stamped with A's id that A can no longer prove: forged owner, foreign target, evicted target. */
const historyFocus = {
  focus: {
    sessionId: A,
    request: { connectionId: 'c-a', deviceId: 'd-a', pointId: 'pa', kind: 'point', at: 1, version: 5 },
    evidence: [
      { kind: 'log', id: 'a-event', sessionId: A },
      { kind: 'log', id: 'b-event', sessionId: A },
      { kind: 'point', id: 'pb', connectionId: 'c-b', deviceId: 'd-b', sessionId: A },
      { kind: 'point', id: 'gone', connectionId: 'c-a', deviceId: 'd-a', sessionId: A },
    ],
  },
}

/** @param {any[]} rows */
const ids = (rows) => rows.map((r) => r.id)

test('append success result hides unverifiable history like status; disk keeps the rows', async (t) => {
  const { home, cwd } = await twoSessionBench(t, historyFocus)
  const res = await appendEvidence(home, cwd, [{ kind: 'build', id: 'a-build' }], A)
  assert.equal(res.ok, true, res.error)
  assert.deepEqual(ids(res.evidence), ['a-event', 'a-build'])

  const stored = loadWorkspace(home, cwd).focus.evidence
  assert.deepEqual(ids(stored), ['a-event', 'b-event', 'pb', 'gone', 'a-build'])

  const status = await runCornBench(home, { action: 'status' }, cwd, { source: 'user', sessionId: A })
  assert.deepEqual(ids(status.focus.evidence), ids(res.evidence))
})

test('UI RPC evidence append returns the same projection as the service', async (t) => {
  const { home, cwd } = await twoSessionBench(t, historyFocus)
  const router = createCornRpcRouter({ getHome: () => home })
  const res = /** @type {any} */ (
    await router.dispatch('evidence', { cwd, sessionId: A, evidence: [{ kind: 'log', id: 'a-event' }] })
  )
  assert.equal(res.ok, true, res.error)
  assert.deepEqual(ids(res.evidence), ['a-event', 'a-event'])
})

test('an invalid new row still rejects the whole batch with history untouched', async (t) => {
  const { home, cwd } = await twoSessionBench(t, historyFocus)
  const res = await appendEvidence(home, cwd, [{ kind: 'build', id: 'a-build' }, { kind: 'log', id: 'b-event' }], A)
  assert.equal(res.ok, false)
  assert.equal(res.errorCode, 'TARGET_MISMATCH')
  assert.deepEqual(ids(loadWorkspace(home, cwd).focus.evidence), ['a-event', 'b-event', 'pb', 'gone'])
})
