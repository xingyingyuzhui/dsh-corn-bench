// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugSessionRegistry } from '../../src/application/debug/debug-session-registry.mjs'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'

const A = 'sess-a'
const B = 'sess-b'
const CWD = '/proj'

/** @param {string} id @param {string} sid */
const event = (id, sid) => ({ id, at: 1, kind: 'read', source: 'agent', sessionId: sid, taskId: '', ok: true, summary: '' })
/** @param {string} id @param {string} sid */
const build = (id, sid) => ({ id, type: 'build', status: 'ok', sessionId: sid, startedAt: 1, endedAt: 2 })

const workspace = {
  modbus: {
    version: 3,
    share: { enabled: false, connections: false, points: false },
    privateClaimSessionId: A,
    connections: [],
    devices: [],
    points: [],
    sessionConfigs: { [A]: { connections: [], devices: [], points: [] }, [B]: { connections: [], devices: [], points: [] } },
  },
  timeline: [event('log-a', A), event('log-b', B), event('log-legacy', '')],
  tasks: [build('build-a', A), build('build-b', B)],
}

const candidates = () => [
  { kind: 'build', id: 'build-a' },
  { kind: 'build', id: 'build-b' },
  { kind: 'log', id: 'log-a' },
  { kind: 'log', id: 'log-b' },
  { kind: 'log', id: 'log-legacy' },
  { kind: 'debug_snapshot', id: 'snap-b', snapshotId: 'snap-b', debugSessionId: 'dbg-b' },
  { kind: 'mystery', id: 'x' },
]

/**
 * @param {{ runtime?: any, loader?: any, owner?: string, debugSessionId?: string }} opts
 */
async function run(opts) {
  const service = createVerifyService({
    debugRuntime: opts.runtime || null,
    workspaceLoader: opts.loader === undefined ? () => workspace : opts.loader,
    evidenceBuilder: candidates,
  })
  return service.runVerification({
    scenario: { id: 'scn', name: 'scn', assertions: [{ type: 'no.exception' }] },
    workspaceCwd: CWD,
    ownerSessionId: opts.owner || A,
    ...(opts.debugSessionId ? { debugSessionId: opts.debugSessionId } : {}),
  })
}

/** @param {any} result */
const keys = (result) => result.evidence.map((/** @type {any} */ e) => `${e.kind}:${e.id}`).sort()

test('builder candidates are kept only when they resolve for the owner', async () => {
  const result = await run({})
  assert.equal(result.totalCount, 1)
  assert.deepEqual(keys(result), ['build:build-a', 'log:log-a'])
})

test('an unloadable workspace drops every builder candidate but keeps assertions', async () => {
  const result = await run({ loader: () => null })
  assert.equal(result.totalCount, 1)
  assert.deepEqual(result.evidence, [])
})

/** @param {string} owner @param {string} cwd */
function registryWith(owner, cwd) {
  const registry = createDebugSessionRegistry()
  registry.sessions.set('dbg-1', {
    debugSessionId: 'dbg-1',
    ownerSessionId: owner,
    workspaceCwd: cwd,
    state: 'stopped',
    breakpoints: new Map(),
    watchpoints: new Map(),
    snapshots: [],
  })
  return {
    ...registry,
    state: () => ({ debugSessionId: 'dbg-1', ownerSessionId: owner, workspaceCwd: cwd }),
    command: async (/** @type {any} */ _scope, /** @type {any} */ cmd) => {
      if (cmd.type !== 'snapshot') return {}
      const snap = { id: 'snap-verify', reason: cmd.reason, createdAt: 1 }
      registry.sessions.get('dbg-1').snapshots.push(snap)
      return { snapshot: snap }
    },
    getEvents: () => ({ events: [] }),
  }
}

test('verify snapshot is kept only when the owned resolver confirms owner and cwd', async () => {
  const ok = await run({ runtime: registryWith(A, CWD), debugSessionId: 'dbg-1' })
  const snap = ok.evidence.find((/** @type {any} */ e) => e.kind === 'debug_snapshot')
  assert.equal(snap?.id, 'snap-verify')
  assert.equal(snap?.debugSessionId, 'dbg-1')

  const otherCwd = await run({ runtime: registryWith(A, '/elsewhere'), debugSessionId: 'dbg-1' })
  assert.equal(otherCwd.evidence.some((/** @type {any} */ e) => e.kind === 'debug_snapshot'), false)
  const otherOwner = await run({ runtime: registryWith(B, CWD), debugSessionId: 'dbg-1', owner: A })
  assert.equal(otherOwner.evidence.some((/** @type {any} */ e) => e.kind === 'debug_snapshot'), false)
})

test('a runtime without the owned resolver never yields snapshot evidence', async () => {
  const runtime = {
    state: () => ({ debugSessionId: 'dbg-1', ownerSessionId: A, workspaceCwd: CWD }),
    command: async (/** @type {any} */ _s, /** @type {any} */ cmd) => (cmd.type === 'snapshot' ? { snapshot: { id: 'snap-x', reason: 'r' } } : {}),
    getEvents: () => ({ events: [] }),
  }
  const result = await run({ runtime, debugSessionId: 'dbg-1' })
  assert.equal(result.evidence.some((/** @type {any} */ e) => e.kind === 'debug_snapshot'), false)
})
