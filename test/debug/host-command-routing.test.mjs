// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import { executeHostCommand } from '../../src/application/commands/host-command-service.mjs'
import { createDebugRuntime, setSharedDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import {
  dispatchHostCommand,
  dispatchCornCommand,
  dispatchCornDebugCommand,
  registerCornHost,
  unregisterCornHost,
} from '../../src/infrastructure/host/corn-host-client.mjs'
import { createCornCommandDispatcher, handleCommand } from '../../src/interfaces/http/corn-command-routes.mjs'

test('host-command-routing: routes debug.* to debug command service and others to corn command service', async () => {
  const mockRuntime = createDebugRuntime()
  setSharedDebugRuntime(mockRuntime)

  try {
    // 1. debug.* routes to executeDebugCommand
    const debugRes = await executeHostCommand({
      action: 'debug.status',
      cwd: '/workspace/test',
      sessionId: 'sess_1',
    })

    assert.equal(debugRes.ok, true)
    assert.equal(debugRes.action, 'debug.status')
    assert.equal(debugRes.active, false)

    // 2. non-debug action routes to executeCornCommand (e.g. system.ping)
    const cornRes = await executeHostCommand({
      action: 'system.ping',
      sessionId: 'sess_1',
    })

    assert.equal(cornRes.ok, true)
    assert.equal(cornRes.action, 'system.ping')
    assert.equal(cornRes.data?.service, 'dsh-corn-bench')
  } finally {
    setSharedDebugRuntime(null)
  }
})

test('host-command-routing: HTTP handleCommand routes both corn and debug actions via executeHostCommand', async () => {
  const mockRuntime = createDebugRuntime()
  setSharedDebugRuntime(mockRuntime)

  try {
    const mockReq = {}
    const readBodyAndTouchSession = async () => ({
      action: 'debug.status',
      sessionId: 'sess_http_1',
      cwd: '/workspace/app',
    })

    const res = await handleCommand('/tmp/dsh-home', mockReq, readBodyAndTouchSession)
    assert.equal(res.ok, true)
    assert.equal(res.action, 'debug.status')
    assert.equal(res.active, false)

    const readPingBody = async () => ({
      action: 'system.ping',
      sessionId: 'sess_http_2',
    })

    const pingRes = await handleCommand('/tmp/dsh-home', mockReq, readPingBody)
    assert.equal(pingRes.ok, true)
    assert.equal(pingRes.action, 'system.ping')
  } finally {
    setSharedDebugRuntime(null)
  }
})

test('host-command-routing: dispatcher dispatches both corn and debug commands', async () => {
  const mockRuntime = createDebugRuntime()
  setSharedDebugRuntime(mockRuntime)

  try {
    const dispatcher = createCornCommandDispatcher('/tmp/dsh-home')
    const unregister = registerCornHost(dispatcher)

    try {
      // dispatchCornCommand for regular corn action
      const pingRes = await dispatchCornCommand({
        action: 'system.ping',
        sessionId: 'sess_disp_1',
      })
      assert.equal(pingRes.ok, true)
      assert.equal(pingRes.action, 'system.ping')

      // dispatchCornDebugCommand auto-prefixes debug.
      const debugRes = await dispatchCornDebugCommand({
        action: 'status',
        sessionId: 'sess_disp_2',
        cwd: '/workspace/embedded',
      })
      assert.equal(debugRes.ok, true)
      assert.equal(debugRes.action, 'debug.status')
    } finally {
      unregister()
    }
  } finally {
    setSharedDebugRuntime(null)
  }
})
