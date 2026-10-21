import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { executeDebugCommand } from '../../src/application/debug/debug-command-service.mjs'

async function makeRuntime(t, methods = {}) {
  const calls = { evaluate: 0, stop: 0 }
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      async start() {},
      async stop() {
        calls.stop++
      },
      async evaluate() {
        calls.evaluate++
        return 42
      },
      ...methods,
    }),
  })
  t.after(() => runtime.shutdown())
  await runtime.start({
    debugSessionId: 'existing-debug',
    ownerSessionId: 'a',
    workspaceCwd: '/tmp/owned-ws',
    backend: 'fake',
    targetSpec: { probeSerial: 'probe-a', interfaceName: 'cmsis-dap' },
  })
  return { runtime, calls }
}

test('anonymous debug command cannot control an owned session by debugSessionId', async (t) => {
  const { runtime, calls } = await makeRuntime(t)
  const result = await executeDebugCommand(
    {
      action: 'debug.evaluate',
      cwd: '/tmp/owned-ws',
      source: 'agent',
      sessionId: '',
      commandId: 'review-anon-debug',
      payload: { debugSessionId: 'existing-debug', expression: 'secret' },
    },
    { debugRuntime: runtime },
  )
  assert.equal(result.ok, false, JSON.stringify({ result, backendCalls: calls.evaluate }))
  assert.equal(calls.evaluate, 0)
})

test('explicit debugSessionId must not override a cwd mismatch', async (t) => {
  const { runtime, calls } = await makeRuntime(t)
  const result = await executeDebugCommand(
    {
      action: 'debug.evaluate',
      cwd: '/tmp/foreign-ws',
      source: 'agent',
      sessionId: 'a',
      commandId: 'review-cwd-debug',
      payload: { debugSessionId: 'existing-debug', expression: 'secret' },
    },
    { debugRuntime: runtime },
  )
  assert.equal(result.ok, false, JSON.stringify({ result, backendCalls: calls.evaluate }))
  assert.equal(calls.evaluate, 0)
})

test('duplicate debugSessionId must not replace a live owner or leak the previous backend', async (t) => {
  const { runtime } = await makeRuntime(t)
  let rejected = false
  try {
    await runtime.start({
      debugSessionId: 'existing-debug',
      ownerSessionId: 'b',
      workspaceCwd: '/tmp/second-ws',
      backend: 'fake',
      targetSpec: { probeSerial: 'probe-b', interfaceName: 'cmsis-dap' },
    })
  } catch {
    rejected = true
  }
  assert.equal(
    rejected,
    true,
    JSON.stringify({ sessions: runtime.listSessions(), leases: runtime.getLeaseManager().leases.size }),
  )
  assert.equal(runtime.state({ debugSessionId: 'existing-debug', ownerSessionId: 'a' }).ownerSessionId, 'a')
})

test('failed breakpoint creation must not remain verified in authoritative state', async (t) => {
  const { runtime } = await makeRuntime(t, {
    async addBreakpoint() {
      throw new Error('backend rejected breakpoint')
    },
  })
  await assert.rejects(
    runtime.command(
      { debugSessionId: 'existing-debug', ownerSessionId: 'a' },
      { type: 'addBreakpoint', id: 'bp1', file: 'main.c', line: 12 },
    ),
  )
  const state = runtime.state({ debugSessionId: 'existing-debug', ownerSessionId: 'a' })
  assert.equal(state.breakpoints.length, 0, JSON.stringify(state.breakpoints))
})

test('all explicit-ID controls reject missing owner, foreign owner and wrong workspace without backend effects', async (t) => {
  const { runtime, calls } = await makeRuntime(t)
  const scopes = [
    { sessionId: '', cwd: '/tmp/owned-ws' },
    { sessionId: 'b', cwd: '/tmp/owned-ws' },
    { sessionId: 'a', cwd: '/tmp/foreign-ws' },
  ]
  let revocations = 0
  for (const [i, scope] of scopes.entries()) {
    for (const action of [
      'evaluate',
      'inspect',
      'snapshot',
      'breakpoint',
      'watchpoint',
      'run',
      'pause',
      'step',
      'reset',
      'stop',
    ]) {
      const result = await executeDebugCommand(
        {
          action: `debug.${action}`,
          ...scope,
          commandId: `deny-${i}-${action}`,
          payload: { debugSessionId: 'existing-debug', sessionId: 'a', expression: 'secret' },
        },
        {
          debugRuntime: runtime,
          approvalStore: {
            revokeControlLease() {
              revocations++
            },
          },
        },
      )
      assert.equal(result.ok, false, `${i}/${action}: ${JSON.stringify(result)}`)
    }
  }
  assert.equal(calls.evaluate, 0)
  assert.equal(calls.stop, 0)
  assert.equal(revocations, 0)
  assert.throws(() => runtime.state({ debugSessionId: 'existing-debug' }), { code: 'DEBUG_SESSION_NOT_OWNER' })
  assert.throws(() => runtime.getEvents({ debugSessionId: 'existing-debug' }), { code: 'DEBUG_SESSION_NOT_OWNER' })
  await assert.rejects(runtime.stop({ debugSessionId: 'existing-debug', ownerSessionId: '' }), {
    code: 'DEBUG_SESSION_NOT_OWNER',
  })
  const result = await executeDebugCommand(
    {
      action: 'debug.evaluate',
      sessionId: 'a',
      cwd: '/tmp/owned-ws',
      commandId: 'allowed-owner',
      payload: { debugSessionId: 'existing-debug', expression: 'counter' },
    },
    { debugRuntime: runtime },
  )
  assert.equal(result.ok, true)
  assert.equal(calls.evaluate, 1)
})

test('failed removals retain acknowledged breakpoints and watchpoints without success events', async (t) => {
  let reject = false
  const { runtime } = await makeRuntime(t, {
    async addBreakpoint() {},
    async addWatchpoint() {
      return { verified: false }
    },
    async removeBreakpoint() {
      if (reject) throw new Error('remove refused')
    },
    async removeWatchpoint() {
      if (reject) throw new Error('remove refused')
    },
  })
  const scope = { debugSessionId: 'existing-debug', ownerSessionId: 'a' }
  await runtime.command(scope, { type: 'addBreakpoint', id: 'bp1', file: 'main.c', line: 12 })
  await runtime.command(scope, { type: 'addWatchpoint', id: 'wp1', expression: 'x' })
  const before = runtime.getEvents(scope)
  reject = true
  for (const [type, id] of [
    ['removeBreakpoint', 'bp1'],
    ['removeWatchpoint', 'wp1'],
  ]) {
    await assert.rejects(runtime.command(scope, { type, id }), /remove refused/)
  }
  assert.equal(runtime.state(scope).breakpoints[0].id, 'bp1')
  assert.equal(runtime.state(scope).watchpoints[0].verified, false)
  assert.equal(runtime.getEvents(scope).nextCursor, before.nextCursor)
  reject = false
  await runtime.command(scope, { type: 'removeBreakpoint', id: 'bp1' })
  await runtime.command(scope, { type: 'removeWatchpoint', id: 'wp1' })
  assert.equal(runtime.state(scope).breakpoints.length, 0)
  assert.equal(runtime.state(scope).watchpoints.length, 0)
})

test('failed watchpoint creation does not appear in state or emit a created event', async (t) => {
  const { runtime } = await makeRuntime(t, {
    async addWatchpoint() {
      throw new Error('unsupported')
    },
  })
  const scope = { debugSessionId: 'existing-debug', ownerSessionId: 'a' }
  const cursor = runtime.getEvents(scope).nextCursor
  await assert.rejects(runtime.command(scope, { type: 'addWatchpoint', id: 'wp1', expression: 'x' }))
  assert.equal(runtime.state(scope).watchpoints.length, 0)
  assert.equal(runtime.getEvents(scope).nextCursor, cursor)
})
