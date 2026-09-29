// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { appendEvidence, loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { projectAgentResult } from '../../src/application/commands/agent-result-projection.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { A, B, idsOf, rawDiskBytes, twoSessionBench } from './evidence-scope-fixtures.mjs'

const HIDDEN = '记录不存在、已过期或当前会话不可见'

/** @param {string} id @param {string} sid @param {number} at */
const event = (id, sid, at) => ({ id, at, kind: 'read', source: 'agent', sessionId: sid, taskId: '', ok: true, summary: '' })
/** @param {string} id @param {string} sid @param {number} at */
const build = (id, sid, at) => ({ id, type: 'build', status: 'ok', sessionId: sid, startedAt: at, endedAt: at, progress: 0 })

test('same id across owners: each session cites and appends its own row', async (t) => {
  const { home, cwd } = await twoSessionBench(t, {
    timeline: [event('dup-log', B, 40), event('dup-log', A, 35)],
    tasks: [build('dup-build', B, 9), build('dup-build', A, 8)],
  })
  const listed = await runVisionBench(home, { action: 'evidence' }, cwd, { source: 'agent', sessionId: A })
  assert.deepEqual(idsOf(listed.evidence).filter((id) => !id.startsWith('point:')), ['build:dup-build', 'log:dup-log'])
  const ownRefs = listed.evidence.filter((/** @type {any} */ r) => r.kind !== 'point')
  const appended = await appendEvidence(home, cwd, ownRefs, A)
  assert.equal(appended.ok, true, appended.error)
  const bOk = await appendEvidence(home, cwd, [{ kind: 'log', id: 'dup-log' }], B)
  assert.equal(bOk.errorCode, 'SESSION_MISMATCH')
})

test('duplicate id within one owner is neither generated nor appendable', async (t) => {
  const { home, cwd } = await twoSessionBench(t, {
    timeline: [event('twin', A, 40), event('twin', A, 39), event('b-only', B, 30)],
    tasks: [build('twin-build', A, 9), build('twin-build', A, 8)],
  })
  const listed = await runVisionBench(home, { action: 'evidence' }, cwd, { source: 'agent', sessionId: A })
  assert.deepEqual(idsOf(listed.evidence), ['point:pa'])

  const before = rawDiskBytes(home, cwd)
  for (const ev of [{ kind: 'log', id: 'twin' }, { kind: 'build', id: 'twin-build' }]) {
    const r = await appendEvidence(home, cwd, [ev], A)
    assert.equal(r.errorCode, 'TARGET_MISMATCH')
    assert.equal(r.error, HIDDEN)
    assert.equal(r.details?.reason, 'AMBIGUOUS_ID')
    assert.equal(JSON.stringify(r).includes(B), false)
  }
  const missing = await appendEvidence(home, cwd, [{ kind: 'log', id: 'b-only' }], A)
  assert.equal(missing.error, HIDDEN)
  assert.equal(missing.details, undefined)
  assert.deepEqual(rawDiskBytes(home, cwd), before)

  const host = await runVisionBench(home, { action: 'evidence', evidence: [{ kind: 'log', id: 'twin' }] }, cwd, { source: 'agent', sessionId: A })
  const agent = projectAgentResult({ action: 'evidence' }, host)
  assert.equal(agent.errorCode, 'TARGET_MISMATCH')
  assert.equal(agent.error, HIDDEN)
  assert.equal(agent.details?.reason, 'AMBIGUOUS_ID')
  assert.ok(agent.commandId)
})

test('stored rows re-verify with the same identity key', async (t) => {
  const { home, cwd } = await twoSessionBench(t, {
    timeline: [event('dup-log', B, 40), event('dup-log', A, 35), event('twin', A, 30), event('twin', A, 29)],
    focus: {
      sessionId: A,
      request: { connectionId: 'c-a', deviceId: 'd-a', pointId: 'pa', kind: 'point', at: 1, version: 5 },
      evidence: [
        { kind: 'log', id: 'dup-log', sessionId: A },
        { kind: 'log', id: 'twin', sessionId: A },
      ],
    },
  })
  const status = await runVisionBench(home, { action: 'status' }, cwd, { source: 'user', sessionId: A })
  assert.deepEqual(status.focus.evidence.map((/** @type {any} */ r) => r.id), ['dup-log'])
  assert.equal(status.focus.evidenceHiddenCount, 1)
  assert.equal(loadWorkspace(home, cwd).focus.evidence.length, 2)
})

test('a failing second row writes nothing', async (t) => {
  const { home, cwd } = await twoSessionBench(t, { timeline: [event('ok-log', A, 40), event('twin', A, 39), event('twin', A, 38)] })
  const before = rawDiskBytes(home, cwd)
  const r = await appendEvidence(home, cwd, [{ kind: 'log', id: 'ok-log' }, { kind: 'log', id: 'twin' }], A)
  assert.equal(r.details?.reason, 'AMBIGUOUS_ID')
  assert.deepEqual(rawDiskBytes(home, cwd), before)
  void saveWorkspace
})
