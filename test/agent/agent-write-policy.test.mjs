// @ts-check
/**
 * Settings → Corn "Agent point writes require approval" policy, and the
 * Agent command bridge's source binding that the approval gate depends on.
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import test from 'node:test'
import { listPendingWrites } from '../../bench-actions.mjs'
import { executeHostCommand } from '../../src/application/commands/host-command-service.mjs'
import { ERROR_CODES } from '../../src/domain/modbus/errors.mjs'
import {
  agentPolicyPath,
  loadAgentPolicy,
  saveAgentPolicy,
} from '../../src/infrastructure/store/agent-policy-store.mjs'
import { loadBindings, saveBindings, storeDir } from '../../src/infrastructure/store/bindings-store.mjs'
import { handleCommand } from '../../src/interfaces/http/corn-command-routes.mjs'
import { handleSettingsEndpoint } from '../../src/interfaces/rpc/corn-rpc-settings.mjs'
import { createBench, pointSeries } from '../helpers/workspace-factory.mjs'

/** @param {import('node:test').TestContext} t */
async function simBench(t) {
  const bench = await createBench(t, { prefix: 'dvb-agent-policy-' })
  bench.save({ modbus: { conn: { sim: true }, points: pointSeries('保持', 4) } })
  return bench
}

/** @param {{ home: string, cwd: string }} bench @param {Record<string, unknown>} [extra] */
const agentWrite = (bench, extra = {}) =>
  executeHostCommand({
    home: bench.home,
    cwd: bench.cwd,
    sessionId: 's1',
    source: 'agent',
    action: 'write',
    payload: { action: 'write', function: 3, address: 1, values: [42] },
    ...extra,
  })

test('agent policy defaults to approval and fails safe on a malformed file', async (t) => {
  const { home } = await createBench(t, { prefix: 'dvb-agent-policy-file-' })
  assert.deepEqual(loadAgentPolicy(home), { agentWriteApproval: true })
  assert.deepEqual(loadAgentPolicy(undefined), { agentWriteApproval: true })
  mkdirSync(storeDir(home), { recursive: true })
  writeFileSync(agentPolicyPath(home), '{ not json')
  assert.equal(loadAgentPolicy(home).agentWriteApproval, true)
  writeFileSync(agentPolicyPath(home), JSON.stringify({ agentWriteApproval: 'no' }))
  assert.equal(loadAgentPolicy(home).agentWriteApproval, true, 'only an explicit false disables approval')
  saveAgentPolicy(home, { agentWriteApproval: false })
  assert.equal(loadAgentPolicy(home).agentWriteApproval, false)
})

test('agent write waits for approval by default', async (t) => {
  const bench = await simBench(t)
  const ran = await agentWrite(bench)
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, ERROR_CODES.APPROVAL_PENDING)
  assert.equal(listPendingWrites(bench.cwd, 's1').length, 1)
})

test('with approval turned off the agent write executes and is marked in the result', async (t) => {
  const bench = await simBench(t)
  saveAgentPolicy(bench.home, { agentWriteApproval: false })
  const ran = await agentWrite(bench)
  assert.equal(ran.ok, true, ran.error)
  assert.equal(ran.approval, 'policy-disabled')
  assert.deepEqual(ran.readback, [42])
  assert.equal(listPendingWrites(bench.cwd, 's1').length, 0)
})

test('user writes never carry the policy marker', async (t) => {
  const bench = await simBench(t)
  saveAgentPolicy(bench.home, { agentWriteApproval: false })
  const ran = await agentWrite(bench, { source: 'user' })
  assert.equal(ran.ok, true, ran.error)
  assert.equal(ran.approval, undefined)
})

test('status tells the agent whether writes need approval', async (t) => {
  const bench = await simBench(t)
  const status = () =>
    executeHostCommand({ home: bench.home, cwd: bench.cwd, sessionId: 's1', source: 'agent', action: 'status', payload: { action: 'status' } })
  assert.equal((await status()).agentWriteApproval, 'required')
  saveAgentPolicy(bench.home, { agentWriteApproval: false })
  assert.equal((await status()).agentWriteApproval, 'disabled')
})

test('saving only the policy keeps tool bindings and share untouched', async (t) => {
  const { home } = await createBench(t, { prefix: 'dvb-agent-policy-settings-' })
  assert.equal(saveBindings(home, { uv4: '/opt/keil/UV4', openocd: '/opt/openocd/bin/openocd' }).ok, true)
  const saved = await handleSettingsEndpoint(home, 'bindings/save', { agentPolicy: { agentWriteApproval: false } })
  assert.equal(saved.ok, true)
  assert.equal(saved.agentPolicy.agentWriteApproval, false)
  assert.equal(loadBindings(home).openocd, '/opt/openocd/bin/openocd')
  assert.equal(loadBindings(home).uv4, '/opt/keil/UV4')
  const view = await handleSettingsEndpoint(home, 'bindings/get', {})
  assert.equal(view.agentPolicy.agentWriteApproval, false)
})

test('the agent command bridge binds source to agent whatever the body claims', async (t) => {
  const bench = await simBench(t)
  const body = {
    cwd: bench.cwd,
    sessionId: 's1',
    source: 'user',
    action: 'write',
    payload: { action: 'write', source: 'user', function: 3, address: 1, values: [42] },
  }
  const ran = await handleCommand(bench.home, {}, async () => body, {})
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, ERROR_CODES.APPROVAL_PENDING)
  assert.equal(listPendingWrites(bench.cwd, 's1').length, 1)
})

test('an executed agent write returns its outcome, not workspace values or sample fingerprints', async (t) => {
  const { projectAgentResult } = await import('../../src/application/commands/agent-result-projection.mjs')
  const bench = await simBench(t)
  saveAgentPolicy(bench.home, { agentWriteApproval: false })
  const ran = await agentWrite(bench)
  assert.equal(ran.ok, true, ran.error)
  const projected = projectAgentResult({ action: 'write' }, ran)
  assert.deepEqual(projected.readback, [42])
  assert.equal(projected.approval, 'policy-disabled')
  for (const key of ['values', 'framesLog', 'frames', 'workspace', 'pointValues']) assert.equal(key in projected, false, key)
  assert.equal(JSON.stringify(projected).includes('sampleIdentity'), false)
  assert.equal(typeof projected.frameCount, 'number')
})

test('status reports a session-private simulated link as connected', async (t) => {
  const { device, hrPoint, rtuSim } = await import('../hmi/multi-conn-fixtures.mjs')
  const bench = await createBench(t, { prefix: 'dvb-status-sim-private-' })
  bench.save({
    modbus: {
      version: 3,
      share: { enabled: false, connections: false, points: false, visualization: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        s1: {
          connections: [rtuSim('c1', 'COM3')],
          devices: [device('d1', 'c1', 1)],
          points: [hrPoint('p1', 'c1', 'd1', 0)],
          pollingByConnection: { c1: { enabled: true, intervalMs: 1000 } },
        },
      },
      pollingByConnection: { c1: { enabled: true, intervalMs: 1000 } },
      values: [],
    },
  })
  const status = await executeHostCommand({ home: bench.home, cwd: bench.cwd, sessionId: 's1', source: 'agent', action: 'status', payload: { action: 'status' } })
  assert.equal(status.ok, true, status.error)
  const state = status.modbus.connectionStates.find((/** @type {any} */ c) => c.connectionId === 'c1')
  assert.ok(state, JSON.stringify(status.modbus.connectionStates))
  assert.equal(state.simulated, true)
  assert.equal(state.status, 'connected')
})
