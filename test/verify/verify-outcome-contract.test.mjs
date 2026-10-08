// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { executeDebugCommand } from '../../src/application/debug/debug-command-service.mjs'
import { createVerifyCommandService } from '../../src/application/verify/verify-command-service.mjs'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'
import { evaluateAssertion } from '../../src/domain/verify/assertion.mjs'
import { createVerifyRpcHandler } from '../../src/interfaces/rpc/verify-rpc-handler.mjs'

const CWD = '/ws/outcome'
const SID = 'sess-outcome'

/**
 * Reader returning scripted readings per point; a function value is called per read.
 * @param {Record<string, any>} script
 */
function scriptedReader(script) {
  return {
    /** @param {any} _scope @param {string} pointId */
    async readPoint(_scope, pointId) {
      const entry = script[pointId]
      return typeof entry === 'function' ? entry() : entry ?? null
    },
  }
}

/** @param {any} value @param {number} [ageMs] */
const live = (value, ageMs = 0) => ({ value, rawValue: value, timestamp: Date.now() - ageMs, quality: 'good', source: 'poll-cache' })

/**
 * @param {any} reader
 * @param {any[]} assertions
 * @param {Record<string, any>} [extra]
 */
async function run(reader, assertions, extra = {}) {
  const service = createVerifyService({ telemetryReader: reader })
  return service.runVerification({
    scenario: { id: 'sc', name: 'outcome', assertions, ...(extra.scenario || {}) },
    workspaceCwd: CWD,
    ownerSessionId: SID,
    ...(extra.options || {}),
  })
}

test('changed with no current sample is unverifiable, never pass', async () => {
  const result = await run(scriptedReader({}), [{ id: 'a1', type: 'changed', pointId: 'p1', value: 10 }])
  const [a] = result.assertions
  assert.equal(a.pass, false)
  assert.equal(a.outcome, 'unverifiable')
  assert.equal(a.reason, 'DATA_MISSING')
  assert.equal(a.actual, null)
  assert.equal(result.status, 'error')
  assert.equal(result.errorCode, 'VERIFY_UNVERIFIABLE')
  assert.equal(result.unverifiableCount, 1)
  assert.equal(result.failedCount, 1)
  assert.equal(result.telemetrySamples.length, 0, 'no fake sample is recorded for missing data')
  assert.doesNotMatch(result.summary, /undefined/)
})

test('changed without a baseline is BASELINE_MISSING and does not read', async () => {
  let reads = 0
  const reader = scriptedReader({
    p1: () => {
      reads++
      return live(1)
    },
  })
  const result = await run(reader, [{ id: 'a1', type: 'changed', pointId: 'p1' }])
  assert.equal(result.assertions[0].reason, 'BASELINE_MISSING')
  assert.equal(result.status, 'error')
  assert.equal(reads, 0)
})

test('changed judges real values: 0→1 and false→true pass, same value fails', async () => {
  const pass01 = await run(scriptedReader({ p1: live(1) }), [{ type: 'changed', pointId: 'p1', value: 0 }])
  assert.equal(pass01.status, 'pass')
  assert.equal(pass01.assertions[0].outcome, 'pass')

  const passBool = await run(scriptedReader({ p1: live(true) }), [{ type: 'changed', pointId: 'p1', value: false }])
  assert.equal(passBool.status, 'pass')

  const same = await run(scriptedReader({ p1: live(10) }), [{ type: 'changed', pointId: 'p1', value: 10 }])
  assert.equal(same.status, 'fail')
  assert.equal(same.assertions[0].outcome, 'fail')
  assert.equal(same.unverifiableCount, 0)
  assert.equal(same.errorCode, undefined)
})

test('null, stale, bad-quality, timestamp-less and failed reads never pass', async () => {
  const cases = [
    { reading: live(null), reason: 'DATA_MISSING' },
    { reading: live(5, 10_000), reason: 'STALE_VALUE', maxAgeMs: 1000 },
    { reading: { ...live(5), quality: 'stale' }, reason: 'STALE_VALUE' },
    { reading: { ...live(5), quality: 'error' }, reason: 'BAD_QUALITY' },
    { reading: { value: 5, rawValue: 5 }, reason: 'DATA_MISSING' },
    {
      reading: () => {
        throw new Error('bus fault')
      },
      reason: 'READ_FAILED',
    },
  ]
  for (const c of cases) {
    for (const type of ['modbus.point', 'range', 'changed']) {
      const spec = { type, pointId: 'p1', op: '>=', value: 0, min: 0, max: 100, ...(c.maxAgeMs ? { maxAgeMs: c.maxAgeMs } : {}) }
      const result = await run(scriptedReader({ p1: c.reading }), [spec])
      assert.equal(result.assertions[0].pass, false, `${type} ${c.reason}`)
      assert.equal(result.assertions[0].outcome, 'unverifiable', `${type} ${c.reason}`)
      assert.equal(result.assertions[0].reason, c.reason, `${type} ${c.reason}`)
      assert.equal(result.status, 'error', `${type} ${c.reason}`)
    }
  }
})

test('zero and false are valid values', async () => {
  const zero = await run(scriptedReader({ p1: { value: 0, rawValue: 0, timestamp: Date.now(), quality: 'good' } }), [
    { type: 'modbus.point', pointId: 'p1', op: '==', value: 0 },
    { type: 'range', pointId: 'p1', min: 0, max: 0 },
  ])
  assert.equal(zero.status, 'pass')
  const off = await run(scriptedReader({ p1: live(false) }), [{ type: 'modbus.point', pointId: 'p1', op: '==', value: false }])
  assert.equal(off.status, 'pass')
})

test('mixed comparison failure and unverifiable is error, and the summary separates them', async () => {
  const result = await run(scriptedReader({ p1: live(1) }), [
    { id: 'cmp', type: 'modbus.point', pointId: 'p1', op: '==', value: 2 },
    { id: 'gap', type: 'modbus.point', pointId: 'missing', op: '==', value: 2 },
    { id: 'ok', type: 'modbus.point', pointId: 'p1', op: '==', value: 1 },
  ])
  assert.equal(result.status, 'error')
  assert.equal(result.errorCode, 'VERIFY_UNVERIFIABLE')
  assert.equal(result.passedCount, 1)
  assert.equal(result.failedCount, 2)
  assert.equal(result.unverifiableCount, 1)
  assert.match(result.summary, /比较失败: \[cmp\]/)
  assert.match(result.summary, /无法验证: \[gap:DATA_MISSING\]/)
})

test('timeout is not overridden by an earlier unverifiable assertion', async () => {
  const reader = scriptedReader({ slow: () => new Promise(() => {}) })
  const result = await run(reader, [
    { id: 'gap', type: 'modbus.point', pointId: 'missing', op: '==', value: 1 },
    { id: 'hang', type: 'modbus.point', pointId: 'slow', op: '==', value: 1 },
  ], { scenario: { timeoutMs: 120 } })
  assert.equal(result.status, 'timeout')
  assert.equal(result.assertions.length, 1)
  assert.equal(result.assertions[0].outcome, 'unverifiable')
})

test('an unexpected internal fault is error, not a missing sample', async () => {
  const service = createVerifyService({
    workspaceLoader: () => {
      throw new Error('loader bug')
    },
  })
  const result = await service.runVerification({
    scenario: { id: 'sc', name: 'fault', assertions: [{ type: 'no.alarm' }] },
    workspaceCwd: CWD,
    ownerSessionId: SID,
  })
  assert.equal(result.status, 'error')
  assert.equal(result.errorCode, undefined)
  assert.match(result.summary, /loader bug/)
})

test('stable-for-duration: one bad sample makes the window unverifiable instead of being dropped', () => {
  const spec = { type: /** @type {const} */ ('stable-for-duration'), pointId: 'p1', tolerance: 5 }
  for (const bad of [null, undefined, NaN, Infinity, '']) {
    const res = evaluateAssertion(spec, [10, bad, 11])
    assert.equal(res.outcome, 'unverifiable')
    assert.equal(res.pass, false)
  }
  assert.equal(evaluateAssertion(spec, [10]).reason, 'INSUFFICIENT_SAMPLES')
  assert.equal(evaluateAssertion(spec, [10, 11]).outcome, 'pass')
  assert.equal(evaluateAssertion({ ...spec, tolerance: 0.5 }, [10, 11]).outcome, 'fail')
})

test('stable-for-duration samples the full window and covers its end', async () => {
  const result = await run(scriptedReader({ p1: () => live(10) }), [
    { type: 'stable-for-duration', pointId: 'p1', durationMs: 120, sampleIntervalMs: 50, tolerance: 1 },
  ], { scenario: { timeoutMs: 2000 } })
  assert.equal(result.status, 'pass')
  const ts = result.telemetrySamples.map((s) => s.timestamp)
  assert.ok(ts[ts.length - 1] - ts[0] >= 120, `window covered: ${ts[ts.length - 1] - ts[0]}ms`)
})

test('stable-for-duration with a bad sample mid-window is unverifiable', async () => {
  let n = 0
  const nextSample = () => {
    n++
    return n === 2 ? null : live(10)
  }
  const result = await run(scriptedReader({ p1: nextSample }), [
    { type: 'stable-for-duration', pointId: 'p1', durationMs: 100, sampleIntervalMs: 20, tolerance: 1 },
  ])
  assert.equal(result.assertions[0].outcome, 'unverifiable')
  assert.equal(result.status, 'error')
})

test('stable window that no longer fits the remaining budget times out instead of shrinking', async () => {
  const result = await run(scriptedReader({ p1: () => live(10) }), [
    { type: 'stable-for-duration', pointId: 'p1', durationMs: 200, sampleIntervalMs: 20, tolerance: 1 },
  ], { scenario: { timeoutMs: 300, setup: { delayMs: 150 } } })
  assert.equal(result.status, 'timeout')
})

test('durationMs over the effective timeout is rejected before any run is registered', async () => {
  let calls = 0
  const verifyService = {
    async runVerification() {
      calls++
      throw new Error('must not run')
    },
  }
  const cmd = createVerifyCommandService({ verifyService })
  const rpc = createVerifyRpcHandler({ verifyCommandService: cmd })
  const scenario = {
    id: 'sc-long',
    name: 'long',
    timeoutMs: 5000,
    assertions: [{ id: 's1', type: 'stable-for-duration', pointId: 'p1', durationMs: 3000 }],
  }

  const overridden = await rpc['verify/run']({ cwd: CWD, sessionId: SID, scenario, timeoutMs: 1000 })
  assert.equal(overridden.ok, false)
  assert.equal(overridden.errorCode, 'INVALID_FIELD')
  assert.deepEqual(overridden.details, {
    field: 'durationMs',
    reason: 'INVALID_VALUE',
    durationMs: 3000,
    timeoutMs: 1000,
    assertionId: 's1',
  })

  const invalid = await rpc['verify/run']({
    cwd: CWD,
    sessionId: SID,
    scenario: { ...scenario, assertions: [{ type: 'stable-for-duration', pointId: 'p1', durationMs: 'x' }] },
  })
  assert.equal(invalid.errorCode, 'INVALID_FIELD')
  assert.equal(invalid.details.reason, 'INVALID_VALUE')
  assert.equal(calls, 0)
  assert.deepEqual(cmd.registrySizes(), { active: 0, completed: 0, latestIndex: 0 })
})

test('RPC ok means "a result came back"; the Agent envelope ok means status=pass', async () => {
  const unverifiable = await run(scriptedReader({}), [{ id: 'a1', type: 'modbus.point', pointId: 'p1', op: '==', value: 1 }])
  const verifyCommandService = { execute: async () => unverifiable }

  const rpc = createVerifyRpcHandler({ verifyCommandService: /** @type {any} */ (verifyCommandService) })
  const rpcRes = await rpc['verify/run']({ cwd: CWD, sessionId: SID, scenario: { name: 'x', assertions: [] } })
  assert.equal(rpcRes.ok, true)
  assert.equal(rpcRes.result.status, 'error')

  const agentRes = await executeDebugCommand(
    { action: 'verify', cwd: CWD, sessionId: SID, source: 'agent', payload: { scenario: { name: 'x', assertions: [] } } },
    { verifyCommandService, debugRuntime: /** @type {any} */ ({ findSession: () => null }) },
  )
  assert.equal(agentRes.ok, false)
  assert.equal(agentRes.status, 'error')
  assert.equal(agentRes.errorCode, 'VERIFY_UNVERIFIABLE')
  assert.equal(agentRes.failedCount, 1)
  assert.equal(agentRes.unverifiableCount, 1)
  assert.equal(agentRes.verifyResult.assertions[0].outcome, 'unverifiable')
  assert.equal(agentRes.verifyResult.assertions[0].reason, 'DATA_MISSING')
})
