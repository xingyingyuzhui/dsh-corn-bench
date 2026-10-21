// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import { executeDebugCommand } from '../../src/application/debug/debug-command-service.mjs'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { DEBUG_ERRORS } from '../../src/domain/debug/errors.mjs'
import { createDebugWorkspace } from '../helpers/debug-workspace.mjs'

test('debug-command-ownership: starting session requires sessionId and handles target lease conflict', async (t) => {
  const ws_test = createDebugWorkspace(t)
  const ws_test2 = createDebugWorkspace(t)
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      async start() {},
      async stop() {},
    }),
  })

  // 1. Missing sessionId
  const resNoSession = await executeDebugCommand(
    {
      action: 'debug.start',
      cwd: ws_test.cwd,
      sessionId: '',
    },
    { debugRuntime: runtime },
  )

  assert.equal(resNoSession.ok, false)
  assert.equal(resNoSession.errorCode, DEBUG_ERRORS.NOT_OWNER)

  // 2. Start valid session
  const resOk = await executeDebugCommand(
    {
      action: 'debug.start',
      cwd: ws_test.cwd,
      sessionId: 'sess_alice',
      payload: {
        targetSpec: { target: 'stm32f4x', probeSerial: 'STLINK_V2_001' },
      },
    },
    { debugRuntime: runtime },
  )

  assert.equal(resOk.ok, true)
  assert.ok(resOk.debugSessionId)

  // 3. Second session on same target fails with LEASE_BUSY
  const resConflict = await executeDebugCommand(
    {
      action: 'debug.start',
      cwd: ws_test2.cwd,
      sessionId: 'sess_bob',
      payload: {
        targetSpec: { target: 'stm32f4x', probeSerial: 'STLINK_V2_001' },
      },
    },
    { debugRuntime: runtime },
  )

  assert.equal(resConflict.ok, false)
  assert.equal(resConflict.errorCode, DEBUG_ERRORS.TARGET_BUSY)

  // 4. Alice stops her session
  const resStop = await executeDebugCommand(
    {
      action: 'debug.stop',
      cwd: ws_test.cwd,
      sessionId: 'sess_alice',
      debugSessionId: resOk.debugSessionId,
    },
    { debugRuntime: runtime },
  )
  assert.equal(resStop.ok, true)

  // 5. Now Bob can acquire the target
  const resBobOk = await executeDebugCommand(
    {
      action: 'debug.start',
      cwd: ws_test2.cwd,
      sessionId: 'sess_bob',
      payload: {
        targetSpec: { target: 'stm32f4x', probeSerial: 'STLINK_V2_001' },
      },
    },
    { debugRuntime: runtime },
  )
  assert.equal(resBobOk.ok, true)
})

test('debug-command-ownership: foreign session cannot control anothers debug session', async (t) => {
  const ws_owner = createDebugWorkspace(t)
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      async start() {},
      async stop() {},
      async pause() {},
    }),
  })

  const startRes = await executeDebugCommand(
    {
      action: 'debug.start',
      cwd: ws_owner.cwd,
      sessionId: 'sess_owner',
    },
    { debugRuntime: runtime },
  )
  assert.equal(startRes.ok, true)
  const debugSessionId = startRes.debugSessionId

  // Foreign session attempts to pause
  const foreignRes = await executeDebugCommand(
    {
      action: 'debug.pause',
      cwd: ws_owner.cwd,
      sessionId: 'sess_intruder',
      debugSessionId,
    },
    { debugRuntime: runtime },
  )

  assert.equal(foreignRes.ok, false)
  assert.equal(foreignRes.errorCode, DEBUG_ERRORS.NOT_OWNER)
})

test('debug-command-ownership: commands against non-existent session return NOT_FOUND or alreadyStopped', async () => {
  const runtime = createDebugRuntime()

  // stop with no session returns alreadyStopped: true
  const stopRes = await executeDebugCommand(
    {
      action: 'debug.stop',
      sessionId: 'sess_none',
    },
    { debugRuntime: runtime },
  )
  assert.equal(stopRes.ok, true)
  assert.equal(stopRes.alreadyStopped, true)

  // run without session returns NOT_FOUND
  const runRes = await executeDebugCommand(
    {
      action: 'debug.run',
      sessionId: 'sess_none',
    },
    { debugRuntime: runtime },
  )
  assert.equal(runRes.ok, false)
  assert.equal(runRes.errorCode, DEBUG_ERRORS.NOT_FOUND)
})
