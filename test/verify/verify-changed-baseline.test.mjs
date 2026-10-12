// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { createVerifyCommandService } from '../../src/application/verify/verify-command-service.mjs'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'
import { evaluateAssertion } from '../../src/domain/verify/assertion.mjs'
import { VerifyRequestError } from '../../src/domain/verify/errors.mjs'
import { createVerifyRpcHandler } from '../../src/interfaces/rpc/verify-rpc-handler.mjs'

const CWD = '/ws/changed-baseline'
const SID = 'sess-baseline'

/** @param {any} value @param {number} [ageMs] */
const live = (value, ageMs = 0) => ({
  value,
  rawValue: value,
  timestamp: Date.now() - ageMs,
  quality: 'good',
  source: 'poll-cache',
  fingerprint: 'fp-baseline',
  generation: 'gen-baseline',
})

/**
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

/**
 * @param {any} reader
 * @param {any[]} assertions
 * @param {Record<string, any>} [extra]
 */
async function run(reader, assertions, extra = {}) {
  const service = createVerifyService({ telemetryReader: reader })
  return service.runVerification({
    scenario: { id: 'sc', name: 'baseline', assertions, ...(extra.scenario || {}) },
    workspaceCwd: CWD,
    ownerSessionId: SID,
    ...(extra.options || {}),
  })
}

const NONFINITE = [
  { label: 'Infinity', value: Infinity },
  { label: '-Infinity', value: -Infinity },
  { label: 'NaN', value: Number.NaN },
  { label: 'string NaN', value: 'NaN' },
  { label: 'string Infinity', value: 'Infinity' },
  { label: 'string +Infinity', value: '+Infinity' },
  { label: 'string -Infinity', value: '-Infinity' },
  { label: 'spaced infinity', value: '  infinity  ' },
]

test('non-finite changed baselines are rejected before register with 0 I/O and 0 runs', async () => {
  let calls = 0
  let reads = 0
  const verifyService = {
    async runVerification() {
      calls++
      throw new Error('must not run')
    },
  }
  const cmd = createVerifyCommandService({ verifyService })
  const rpc = createVerifyRpcHandler({ verifyCommandService: cmd })

  for (const bad of NONFINITE) {
    const res = await rpc['verify/run']({
      cwd: CWD,
      sessionId: SID,
      scenario: {
        id: 'sc-bad',
        name: 'bad-baseline',
        assertions: [{ id: 'a1', type: 'changed', pointId: 'p1', value: bad.value }],
      },
    })
    assert.equal(res.ok, false, bad.label)
    assert.equal(res.errorCode, 'INVALID_FIELD', bad.label)
    assert.equal(res.details?.field, 'value', bad.label)
    assert.equal(res.details?.reason, 'INVALID_VALUE', bad.label)
    assert.equal(res.details?.assertionId, 'a1', bad.label)
    assert.doesNotMatch(String(res.error || ''), /null/, `safe echo for ${bad.label}`)
  }

  assert.equal(calls, 0)
  assert.equal(reads, 0)
  assert.deepEqual(cmd.registrySizes(), { active: 0, completed: 0, latestIndex: 0 })
})

test('direct verifyService also rejects illegal baselines before sampling', async () => {
  let reads = 0
  const reader = scriptedReader({
    p1: () => {
      reads++
      return live(10)
    },
  })
  const service = createVerifyService({ telemetryReader: reader })
  await assert.rejects(
    () =>
      service.runVerification({
        scenario: {
          id: 'sc',
          name: 'svc',
          assertions: [{ id: 'a1', type: 'changed', pointId: 'p1', value: Infinity }],
        },
        workspaceCwd: CWD,
        ownerSessionId: SID,
      }),
    (err) => {
      assert.ok(err instanceof VerifyRequestError)
      assert.equal(err.code, 'INVALID_FIELD')
      assert.equal(err.details.field, 'value')
      assert.equal(err.details.reason, 'INVALID_VALUE')
      assert.equal(err.details.assertionId, 'a1')
      return true
    },
  )
  assert.equal(reads, 0)
})

test('expected alias is the reported field when value is absent', async () => {
  const cmd = createVerifyCommandService({
    verifyService: { async runVerification() { throw new Error('must not run') } },
  })
  const rpc = createVerifyRpcHandler({ verifyCommandService: cmd })
  const res = await rpc['verify/run']({
    cwd: CWD,
    sessionId: SID,
    scenario: {
      id: 'sc',
      name: 'alias',
      assertions: [{ id: 'a1', type: 'changed', pointId: 'p1', expected: 'NaN' }],
    },
  })
  assert.equal(res.ok, false)
  assert.equal(res.details.field, 'expected')
  assert.equal(res.details.reason, 'INVALID_VALUE')
})

test('domain evaluateAssertion with Infinity baseline is unverifiable/INVALID_SAMPLE, not pass', () => {
  const res = evaluateAssertion(
    { id: 'a1', type: 'changed', pointId: 'p1', value: Infinity },
    { initial: Infinity, current: 10 },
  )
  assert.equal(res.pass, false)
  assert.equal(res.outcome, 'unverifiable')
  assert.equal(res.reason, 'INVALID_SAMPLE')
  assert.equal(res.actual, null)
  assert.doesNotMatch(res.message, /from Infinity/)
  assert.doesNotMatch(res.message || '', /\bnull\b/)

  const nanRes = evaluateAssertion(
    { type: 'changed', pointId: 'p1', value: Number.NaN },
    { initial: Number.NaN, current: 10 },
  )
  assert.equal(nanRes.outcome, 'unverifiable')
  assert.equal(nanRes.reason, 'INVALID_SAMPLE')
  // JSON.stringify(NaN) === 'null' must not rewrite the reason text.
  assert.doesNotMatch(nanRes.message, /实际值 null|from null/)
  assert.match(nanRes.message, /INVALID_SAMPLE|不是有效数值|无法验证/)
})

test('0, false, and normal strings remain comparable; missing baseline and same value regress', async () => {
  const pass01 = await run(scriptedReader({ p1: live(1) }), [{ type: 'changed', pointId: 'p1', value: 0 }])
  assert.equal(pass01.status, 'pass')

  const passBool = await run(scriptedReader({ p1: live(true) }), [
    { type: 'changed', pointId: 'p1', value: false },
  ])
  assert.equal(passBool.status, 'pass')

  const passStr = await run(scriptedReader({ p1: live('running') }), [
    { type: 'changed', pointId: 'p1', value: 'idle' },
  ])
  assert.equal(passStr.status, 'pass')

  const viaExpected = await run(scriptedReader({ p1: live(2) }), [
    { type: 'changed', pointId: 'p1', expected: 1 },
  ])
  assert.equal(viaExpected.status, 'pass')
  assert.equal(viaExpected.assertions[0].expected, 'changed (from 1)')

  let reads = 0
  const missing = await run(
    scriptedReader({
      p1: () => {
        reads++
        return live(1)
      },
    }),
    [{ type: 'changed', pointId: 'p1' }],
  )
  assert.equal(missing.assertions[0].reason, 'BASELINE_MISSING')
  assert.equal(reads, 0)

  const same = await run(scriptedReader({ p1: live(10) }), [{ type: 'changed', pointId: 'p1', value: 10 }])
  assert.equal(same.status, 'fail')
  assert.equal(same.assertions[0].outcome, 'fail')
  assert.equal(same.unverifiableCount, 0)
})
