// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { saveWorkspace } from '../../bench-store.mjs'
import { visionBenchTool } from '../../bench-tool.mjs'
import { encodeListCursor, pagePointsList } from '../../src/application/modbus/points-list-page.mjs'
import { registerVisionHost, unregisterVisionHost } from '../../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher } from '../../src/interfaces/http/vision-command-routes.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

const SID = 'session-a'

/** @param {import('node:test').TestContext} t */
async function agentPoints(t) {
  const { home, cwd } = await createBench(t, { prefix: 'dvb-view-inherit-' })
  const points = Array.from({ length: 25 }, (_, i) => ({
    id: `p${String(i).padStart(2, '0')}`,
    name: `N${i}`,
    connectionId: i < 20 ? 'c1' : 'c2',
    deviceId: i < 20 ? 'd1' : 'd2',
    function: 3,
    address: i,
    type: 'uint16',
  }))
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 4,
      share: { enabled: false, connections: false, points: false },
      privateClaimSessionId: SID,
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        [SID]: {
          connections: [connection('c1', 'tcp', '', { sim: true }), connection('c2', 'tcp', '', { sim: true })],
          devices: [
            { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
            { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 2 },
          ],
          points,
        },
      },
    },
  })
  unregisterVisionHost()
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  t.after(() => {
    stop()
    unregisterVisionHost()
  })
  const tool = visionBenchTool(home)
  return (/** @type {any} */ args) =>
    tool.execute({ action: 'points', op: 'list', limit: 10, ...args }, { agent: { session: { header: { cwd, id: SID } } } })
}

test('points list: an omitted view inherits the cursor view across pages', async (t) => {
  const run = await agentPoints(t)
  const first = await run({ view: 'summary' })
  assert.equal(first.ok, true, first.error)
  assert.equal(first.view, 'summary')
  const second = await run({ cursor: first.nextCursor })
  assert.equal(second.ok, true, second.error)
  assert.equal(second.view, 'summary')
  assert.equal('raw' in second.points[0], false)
  const third = await run({ cursor: second.nextCursor })
  assert.equal(third.view, 'summary')
  const ids = [...first.points, ...second.points, ...third.points].map((/** @type {any} */ p) => p.id)
  assert.equal(new Set(ids).size, 25)
  assert.equal(third.nextCursor, null)
})

test('points list: no cursor defaults to full; a full cursor continues as full', async (t) => {
  const run = await agentPoints(t)
  const first = await run({})
  assert.equal(first.view, 'full')
  const next = await run({ cursor: first.nextCursor })
  assert.equal(next.ok, true, next.error)
  assert.equal(next.view, 'full')
})

test('points list: an explicit view must match the cursor; filters must stay the same', async (t) => {
  const run = await agentPoints(t)
  const first = await run({ view: 'summary' })
  assert.equal((await run({ cursor: first.nextCursor, view: 'summary' })).ok, true)
  const mismatch = await run({ cursor: first.nextCursor, view: 'full' })
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.errorCode, 'CURSOR_EXPIRED')

  const filtered = await run({ view: 'summary', connectionId: 'c1' })
  const refiltered = await run({ cursor: filtered.nextCursor, connectionId: 'c2' })
  assert.equal(refiltered.errorCode, 'CURSOR_EXPIRED')
  const unfiltered = await run({ cursor: filtered.nextCursor })
  assert.equal(unfiltered.errorCode, 'CURSOR_EXPIRED', 'filters are not inherited from the cursor')
})

const base = {
  points: [{ id: 'a', connectionId: 'c1', deviceId: 'd1' }, { id: 'b', connectionId: 'c1', deviceId: 'd1' }],
  configVersion: 1,
  sessionId: 's',
  connectionId: '',
  deviceId: '',
  limit: 1,
  isAgent: true,
}

test('points list: a cursor cannot carry an invalid view or retarget the session', () => {
  const forged = encodeListCursor({ ...base, view: 'raw-dump', last: ['c1', 'd1', 'a'] })
  assert.equal(pagePointsList({ ...base, cursor: forged }).ok, false)
  const other = encodeListCursor({ ...base, sessionId: 'other', view: 'summary', last: ['c1', 'd1', 'a'] })
  const r = /** @type {any} */ (pagePointsList({ ...base, cursor: other }))
  assert.equal(r.errorCode, 'CURSOR_EXPIRED')
  const legacy = encodeListCursor({ ...base, view: /** @type {any} */ (undefined), last: ['c1', 'd1', 'a'] })
  const cont = /** @type {any} */ (pagePointsList({ ...base, cursor: legacy }))
  assert.equal(cont.ok, true)
  assert.equal(cont.view, 'full')
  assert.deepEqual(cont.points.map((/** @type {any} */ p) => p.id), ['b'])
})
