import assert from 'node:assert/strict'
import test from 'node:test'
import { executeDebugCommand } from '../../src/application/debug/debug-command-service.mjs'
import { createVerifyCommandService } from '../../src/application/verify/verify-command-service.mjs'
import { createRouter } from '../helpers/rpc-factory.mjs'
import { alarmPoint, flatWorkspace } from './verify-fixtures.mjs'

test('host singleton: agent corn_debug verify and browser RPC share the same verifyCommandService instance', async () => {
  const mockWorkspace = flatWorkspace({ points: [alarmPoint('p1', { name: 'Pressure' })], alarmState: {} })
  const verifyCommandService = createVerifyCommandService({
    workspaceLoader: () => mockWorkspace,
  })

  // 1. Agent executes verification via executeDebugCommand
  const agentRes = await executeDebugCommand(
    {
      action: 'debug.verify',
      cwd: '/test/cwd',
      sessionId: 'sess-host',
      source: 'agent',
      payload: {
        scenario: {
          name: 'Agent Triggered Scenario',
          assertions: [{ type: 'no.alarm' }],
        },
      },
    },
    { verifyCommandService },
  )

  assert.ok(agentRes.ok)
  assert.ok(agentRes.verifyResult)
  const runId = agentRes.verifyResult.verificationRunId
  assert.ok(runId)

  // 2. Browser queries status via CornRpcRouter using the SAME verifyCommandService
  const router = createRouter('/test/home', { verifyCommandService })

  const statusRes = /** @type {any} */ (
    await router.dispatch('verify/status', {
      cwd: '/test/cwd',
      sessionId: 'sess-host',
      verificationRunId: runId,
    })
  )

  assert.ok(statusRes.ok)
  assert.equal(statusRes.running, false)
  // Browser can see the result created by the Agent because they share the same singleton!
  assert.equal(statusRes.result.verificationRunId, runId)
  assert.equal(statusRes.result.scenarioName, 'Agent Triggered Scenario')
})
