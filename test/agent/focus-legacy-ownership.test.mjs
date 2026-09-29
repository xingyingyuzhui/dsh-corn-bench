// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { appendEvidence, loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { requestFocus } from '../../src/application/modbus/focus-service.mjs'
import { createVisionRpcRouter } from '../../src/interfaces/rpc/vision-rpc-router.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'
import { A, B, point, rawDiskBytes, twoSessionBench } from './evidence-scope-fixtures.mjs'

/** Ownerless focus left on disk by an older build, pointing at B's private point. */
const legacyFocus = {
  sessionId: '',
  request: { connectionId: 'c-b', deviceId: 'd-b', pointId: 'pb', kind: 'point', at: 5, version: 5 },
  prev: { connectionId: 'c-b', deviceId: 'd-b', pointId: 'pb-prev', kind: 'point', at: 4, version: 5 },
  tempWatchIds: ['pb'],
  badgeOnly: true,
  evidence: [{ kind: 'log', id: 'b-event' }],
}

/** @param {any} focus */
function assertEmptyFocus(focus) {
  assert.equal(focus.request, null)
  assert.equal(focus.prev, null)
  assert.deepEqual(focus.tempWatchIds, [])
  assert.deepEqual(focus.evidence, [])
  assert.equal(JSON.stringify(focus).includes('pb'), false)
}

test('ownerless legacy focus is hidden from every session at Host and RPC outputs', async (t) => {
  const { home, cwd } = await twoSessionBench(t, { focus: legacyFocus })
  const router = createVisionRpcRouter({ getHome: () => home })
  for (const sid of [A, B]) {
    const status = await runVisionBench(home, { action: 'status' }, cwd, { source: 'user', sessionId: sid })
    assertEmptyFocus(status.focus)
    const got = /** @type {any} */ (await router.dispatch('workspace/get', { cwd, sessionId: sid }))
    assertEmptyFocus(got.workspace.focus)
    const state = /** @type {any} */ (await router.snapshot(cwd, sid))
    assertEmptyFocus(state.workspace.focus)
  }
})

test('A cannot append onto an ownerless legacy focus; disk bytes unchanged', async (t) => {
  const { home, cwd } = await twoSessionBench(t, { focus: legacyFocus })
  const before = rawDiskBytes(home, cwd)
  const r = await appendEvidence(home, cwd, [{ kind: 'log', id: 'a-event' }], A)
  assert.equal(r.ok, false)
  assert.equal(r.errorCode, 'SESSION_MISMATCH')
  assert.equal(r.details?.reason, 'UNOWNED_LEGACY_FOCUS')
  assert.deepEqual(rawDiskBytes(home, cwd), before)
})

test('A may replace a legacy focus explicitly, without inheriting prev/tempWatch/evidence', async (t) => {
  const { home, cwd } = await twoSessionBench(t, { focus: legacyFocus })
  const first = await requestFocus(
    home,
    cwd,
    { target: { connectionId: 'c-a', deviceId: 'd-a', pointId: 'pa' }, evidence: [{ kind: 'log', id: 'a-event' }] },
    { source: 'user', sessionId: A },
  )
  assert.equal(first.ok, true, first.error)
  assert.equal(first.prev, null)
  let focus = loadWorkspace(home, cwd).focus
  assert.equal(focus.sessionId, A)
  assert.equal(focus.request.pointId, 'pa')
  assert.equal(focus.prev, null)
  assert.deepEqual(focus.tempWatchIds, [])
  assert.deepEqual(focus.evidence.map((/** @type {any} */ r) => r.id), ['a-event'])

  const second = await requestFocus(home, cwd, { target: { connectionId: 'c-a', deviceId: 'd-a', pointId: 'pa' } }, { source: 'user', sessionId: A })
  assert.equal(second.ok, true, second.error)
  assert.equal(second.prev?.pointId, 'pa')
  focus = loadWorkspace(home, cwd).focus
  assert.equal(focus.prev?.pointId, 'pa')
})

test('an empty ownerless focus is claimable by append', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const r = await appendEvidence(home, cwd, [{ kind: 'log', id: 'a-event' }], A)
  assert.equal(r.ok, true, r.error)
  assert.equal(loadWorkspace(home, cwd).focus.sessionId, A)
})

test('badgeOnly alone makes an ownerless focus legacy', async (t) => {
  const { home, cwd } = await twoSessionBench(t, {
    focus: { sessionId: '', request: null, prev: null, tempWatchIds: [], badgeOnly: true, evidence: [] },
  })
  const r = await appendEvidence(home, cwd, [{ kind: 'log', id: 'a-event' }], A)
  assert.equal(r.details?.reason, 'UNOWNED_LEGACY_FOCUS')
})

test('unpartitioned single session: sid view hides legacy focus, anonymous view keeps it', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-legacy-unpart-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D', unitId: 1 }],
      points: [point('p1', 'c1', 'd1')],
    },
    timeline: [{ id: 'legacy-event', at: 1, kind: 'read', source: 'user', sessionId: '', taskId: '', ok: true, summary: '' }],
    focus: {
      sessionId: '',
      request: { connectionId: 'c1', deviceId: 'd1', pointId: 'p1', kind: 'point', at: 5, version: 1 },
      prev: null,
      tempWatchIds: [],
      badgeOnly: false,
      evidence: [{ kind: 'log', id: 'legacy-event' }],
    },
  })
  const withSid = await runVisionBench(home, { action: 'status' }, cwd, { source: 'user', sessionId: A })
  assert.equal(withSid.focus.request, null)
  assert.deepEqual(withSid.focus.evidence, [])
  const anon = await runVisionBench(home, { action: 'status' }, cwd, { source: 'user', sessionId: '' })
  assert.equal(anon.focus.request?.pointId, 'p1')
  assert.deepEqual(anon.focus.evidence.map((/** @type {any} */ r) => r.id), ['legacy-event'])

  const sidAppend = await appendEvidence(home, cwd, [{ kind: 'point', id: 'p1', connectionId: 'c1', deviceId: 'd1' }], A)
  assert.equal(sidAppend.details?.reason, 'UNOWNED_LEGACY_FOCUS')
  const anonAppend = await appendEvidence(home, cwd, [{ kind: 'log', id: 'legacy-event' }], '')
  assert.equal(anonAppend.ok, true, anonAppend.error)
  assert.equal(loadWorkspace(home, cwd).focus.sessionId, '')

  const anonFocus = await requestFocus(home, cwd, { target: { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' } })
  assert.equal(anonFocus.ok, true, anonFocus.error)
  assert.equal(anonFocus.prev?.pointId, 'p1')
})
