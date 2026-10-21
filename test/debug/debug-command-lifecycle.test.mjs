// @ts-check
/** Owned debug session lifecycle and command idempotency. */

import assert from 'node:assert/strict'
import test from 'node:test'
import { executeDebugCommand } from '../../src/application/debug/debug-command-service.mjs'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { createDebugWorkspace } from '../helpers/debug-workspace.mjs'

test('debug-command-ownership: executes full lifecycle of actions (step, breakpoint, watchpoint, inspect, evaluate, snapshot, reset)', async (t) => {
  const ws_demo = createDebugWorkspace(t)
  let pausedCount = 0
  let continuedCount = 0
  let stepOverCount = 0

  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      async start() {},
      async stop() {},
      async pause() {
        pausedCount++
      },
      async continue() {
        continuedCount++
      },
      async step(type) {
        if (type === 'over') stepOverCount++
      },
      async evaluate(expr) {
        return `eval(${expr}) = 42`
      },
      async stack() {
        return [{ level: 0, function: 'main', file: 'main.c', line: 45 }]
      },
      async locals() {
        return [{ name: 'counter', value: '10', type: 'int' }]
      },
      async registers() {
        return [{ name: 'r0', value: '0x0000000a' }]
      },
      async resetHalt() {},
      async addBreakpoint() {},
      async removeBreakpoint() {},
      async addWatchpoint() {},
      async removeWatchpoint() {},
    }),
  })

  // 1. Start
  const startRes = await executeDebugCommand(
    {
      action: 'debug.start',
      cwd: ws_demo.cwd,
      sessionId: 'sess_demo',
    },
    { debugRuntime: runtime },
  )
  assert.equal(startRes.ok, true)
  const debugSessionId = startRes.debugSessionId

  const scope = { sessionId: 'sess_demo', debugSessionId, cwd: ws_demo.cwd }

  // 2. Status
  const statusRes = await executeDebugCommand({ action: 'debug.status', ...scope }, { debugRuntime: runtime })
  assert.equal(statusRes.ok, true)
  assert.equal(statusRes.active, true)
  assert.equal(statusRes.session.debugSessionId, debugSessionId)

  // 3. Pause
  const pauseRes = await executeDebugCommand({ action: 'debug.pause', ...scope }, { debugRuntime: runtime })
  assert.equal(pauseRes.ok, true)
  assert.equal(pauseRes.state, 'paused')
  assert.equal(pausedCount, 1)

  // 4. Step
  const stepRes = await executeDebugCommand(
    { action: 'debug.step', stepType: 'over', ...scope },
    { debugRuntime: runtime },
  )
  assert.equal(stepRes.ok, true)
  assert.equal(stepRes.state, 'paused')
  assert.equal(stepOverCount, 1)

  // 5. Run
  const runRes = await executeDebugCommand({ action: 'debug.run', ...scope }, { debugRuntime: runtime })
  assert.equal(runRes.ok, true)
  assert.equal(runRes.state, 'running')
  assert.equal(continuedCount, 1)

  // 6. Breakpoint add, list, remove
  const addBp = await executeDebugCommand(
    { action: 'debug.breakpoint', file: 'main.c', line: 55, ...scope },
    { debugRuntime: runtime },
  )
  assert.equal(addBp.ok, true)
  assert.ok(addBp.breakpoint.id)

  const listBp = await executeDebugCommand(
    { action: 'debug.breakpoint', op: 'list', ...scope },
    { debugRuntime: runtime },
  )
  assert.equal(listBp.ok, true)
  assert.equal(listBp.breakpoints.length, 1)

  const rmBp = await executeDebugCommand(
    { action: 'debug.breakpoint', op: 'remove', breakpointId: addBp.breakpoint.id, ...scope },
    { debugRuntime: runtime },
  )
  assert.equal(rmBp.ok, true)
  assert.equal(rmBp.removed, true)

  // 7. Watchpoint add, list, remove
  const addWp = await executeDebugCommand(
    { action: 'debug.watchpoint', expression: 'g_status', access: 'write', ...scope },
    { debugRuntime: runtime },
  )
  assert.equal(addWp.ok, true)
  assert.ok(addWp.watchpoint.id)

  const listWp = await executeDebugCommand(
    { action: 'debug.watchpoint', op: 'list', ...scope },
    { debugRuntime: runtime },
  )
  assert.equal(listWp.ok, true)
  assert.equal(listWp.watchpoints.length, 1)

  const rmWp = await executeDebugCommand(
    { action: 'debug.watchpoint', op: 'remove', watchpointId: addWp.watchpoint.id, ...scope },
    { debugRuntime: runtime },
  )
  assert.equal(rmWp.ok, true)
  assert.equal(rmWp.removed, true)

  // 8. Inspect
  const inspectRes = await executeDebugCommand({ action: 'debug.inspect', ...scope }, { debugRuntime: runtime })
  assert.equal(inspectRes.ok, true)
  assert.equal(inspectRes.stack.length, 1)
  assert.equal(inspectRes.variables.length, 1)
  assert.equal(inspectRes.registers.length, 1)

  // 9. Evaluate
  const evalRes = await executeDebugCommand(
    { action: 'debug.evaluate', expression: 'counter + 1', ...scope },
    { debugRuntime: runtime },
  )
  assert.equal(evalRes.ok, true)
  assert.equal(evalRes.value, 'eval(counter + 1) = 42')

  // 10. Snapshot
  const snapRes = await executeDebugCommand(
    { action: 'debug.snapshot', reason: 'checkpoint-before-write', ...scope },
    { debugRuntime: runtime },
  )
  assert.equal(snapRes.ok, true)
  assert.ok(snapRes.snapshot.id)
  assert.equal(snapRes.snapshot.reason, 'checkpoint-before-write')

  // 11. Reset
  const resetRes = await executeDebugCommand(
    { action: 'debug.reset', mode: 'halt', ...scope },
    { debugRuntime: runtime },
  )
  assert.equal(resetRes.ok, true)
  assert.equal(resetRes.state, 'paused')

  // 12. Stop
  const stopRes = await executeDebugCommand({ action: 'debug.stop', ...scope }, { debugRuntime: runtime })
  assert.equal(stopRes.ok, true)
})

test('debug-command-ownership: idempotency cache returns memoized result for duplicate commandId', async (t) => {
  const ws_idempotent = createDebugWorkspace(t)
  let executionCount = 0
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      async start() {
        executionCount++
      },
      async stop() {},
    }),
  })

  const cmdId = `idem_${Date.now()}`

  const res1 = await executeDebugCommand(
    {
      action: 'debug.start',
      cwd: ws_idempotent.cwd,
      sessionId: 'sess_idem',
      commandId: cmdId,
    },
    { debugRuntime: runtime },
  )

  assert.equal(res1.ok, true)
  assert.equal(executionCount, 1)

  // Second call with same commandId
  const res2 = await executeDebugCommand(
    {
      action: 'debug.start',
      cwd: ws_idempotent.cwd,
      sessionId: 'sess_idem',
      commandId: cmdId,
    },
    { debugRuntime: runtime },
  )

  assert.equal(res2.ok, true)
  assert.equal(res2.debugSessionId, res1.debugSessionId)
  assert.equal(executionCount, 1, 'underlying start must not be re-executed')
})
