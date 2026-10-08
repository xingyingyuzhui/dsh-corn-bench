// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { createVerifyCommandService } from '../../src/application/verify/verify-command-service.mjs'
import { createVerifyRpcHandler } from '../../src/interfaces/rpc/verify-rpc-handler.mjs'
import { createRouter } from '../helpers/rpc-factory.mjs'

const CWD = '/ws/run-scope'
const OTHER_CWD = '/ws/run-scope-other'

/**
 * Fake verify service whose runs finish only when released, and which
 * deliberately keeps running for a while after abort.
 */
function gatedVerifyService() {
  /** @type {Map<string, () => void>} */
  const gates = new Map()
  let calls = 0
  return {
    gates,
    get calls() {
      return calls
    },
    /** @param {any} opts */
    async runVerification(opts) {
      calls++
      await new Promise((resolve) => gates.set(opts.verificationRunId, () => resolve(undefined)))
      return {
        verificationRunId: opts.verificationRunId,
        scenarioId: opts.scenario.id,
        scenarioName: opts.scenario.name,
        status: opts.signal.aborted ? 'cancelled' : 'pass',
        passedCount: 1,
        failedCount: 0,
        unverifiableCount: 0,
        totalCount: 1,
        assertions: [],
      }
    },
  }
}

/** @param {string} id */
const scenario = (id) => ({ id, name: id, assertions: [{ type: /** @type {const} */ ('no.alarm') }] })

const tick = () => new Promise((resolve) => setImmediate(resolve))

/** @param {any} workspace */
const loaderOf = (workspace) => () => workspace
const unpartitioned = { modbus: { points: [] } }
const partitionedWs = { modbus: { points: [], sessionConfigs: { 'sess-a': { points: [] } } } }

/**
 * @param {() => any} fn
 * @param {string} code
 */
function rejects(fn, code) {
  assert.throws(fn, (/** @type {any} */ err) => err.code === code)
}

test('another session cannot see or cancel a run by its runId', async () => {
  const svc = gatedVerifyService()
  const cmd = createVerifyCommandService({ verifyService: svc, workspaceLoader: loaderOf(partitionedWs) })
  const running = cmd.execute({ workspaceCwd: CWD, ownerSessionId: 'sess-a', scenario: scenario('s1'), verificationRunId: 'vr_a' })
  await tick()

  const b = { workspaceCwd: CWD, ownerSessionId: 'sess-b', verificationRunId: 'vr_a' }
  rejects(() => cmd.status(b), 'TARGET_MISMATCH')
  rejects(() => cmd.cancel(b), 'TARGET_MISMATCH')
  rejects(() => cmd.status({ ...b, ownerSessionId: 'sess-a', workspaceCwd: OTHER_CWD }), 'TARGET_MISMATCH')
  rejects(() => cmd.status({ workspaceCwd: CWD, ownerSessionId: 'sess-b', scenarioId: 's1' }), 'TARGET_MISMATCH')

  const owner = { workspaceCwd: CWD, ownerSessionId: 'sess-a', verificationRunId: 'vr_a' }
  assert.equal(cmd.status(owner).running, true)
  svc.gates.get('vr_a')?.()
  const result = await running
  assert.equal(result.status, 'pass', 'the foreign cancel did not abort the owner run')
  assert.equal(cmd.status(owner).result?.verificationRunId, 'vr_a')
  assert.equal(cmd.status({ workspaceCwd: CWD, ownerSessionId: 'sess-a', scenarioId: 's1' }).result?.verificationRunId, 'vr_a')
})

test('missing, expired and foreign runs share one error and message', async () => {
  let t = 1_000
  const svc = gatedVerifyService()
  const cmd = createVerifyCommandService({ verifyService: svc, runRegistry: { now: () => t, completedTtlMs: 100 } })
  const p = cmd.execute({ workspaceCwd: CWD, ownerSessionId: 'sess-a', scenario: scenario('s1'), verificationRunId: 'vr_a' })
  await tick()
  svc.gates.get('vr_a')?.()
  await p

  /** @param {any} q */
  const errOf = (q) => {
    try {
      cmd.status(q)
    } catch (err) {
      return /** @type {any} */ (err)
    }
    assert.fail('expected rejection')
  }
  const foreign = errOf({ workspaceCwd: CWD, ownerSessionId: 'sess-b', verificationRunId: 'vr_a' })
  const missing = errOf({ workspaceCwd: CWD, ownerSessionId: 'sess-a', verificationRunId: 'vr_none' })
  t += 100
  const expired = errOf({ workspaceCwd: CWD, ownerSessionId: 'sess-a', verificationRunId: 'vr_a' })
  for (const e of [foreign, missing, expired]) {
    assert.equal(e.code, 'TARGET_MISMATCH')
    assert.equal(e.message, foreign.message)
  }
  assert.deepEqual(cmd.registrySizes(), { active: 0, completed: 0, latestIndex: 0 })
})

test('anonymous runs stay with anonymous callers of the same cwd', async () => {
  const svc = gatedVerifyService()
  const cmd = createVerifyCommandService({ verifyService: svc, workspaceLoader: loaderOf(unpartitioned) })
  const p = cmd.execute({ workspaceCwd: CWD, ownerSessionId: '', scenario: scenario('s1'), verificationRunId: 'vr_anon' })
  await tick()
  svc.gates.get('vr_anon')?.()
  await p

  assert.equal(cmd.status({ workspaceCwd: CWD, ownerSessionId: '', verificationRunId: 'vr_anon' }).result?.status, 'pass')
  assert.equal(cmd.status({ workspaceCwd: `${CWD}/`, verificationRunId: 'vr_anon' }).result?.status, 'pass')
  rejects(() => cmd.status({ workspaceCwd: CWD, ownerSessionId: 'sess-a', verificationRunId: 'vr_anon' }), 'TARGET_MISMATCH')
  rejects(() => cmd.status({ workspaceCwd: CWD, ownerSessionId: 'anon', verificationRunId: 'vr_anon' }), 'TARGET_MISMATCH')
  rejects(() => cmd.status({ workspaceCwd: OTHER_CWD, ownerSessionId: '', verificationRunId: 'vr_anon' }), 'TARGET_MISMATCH')
})

test('a partitioned workspace closes run, status and cancel to anonymous callers', async () => {
  let ws = unpartitioned
  const svc = gatedVerifyService()
  const cmd = createVerifyCommandService({ verifyService: svc, workspaceLoader: () => ws })
  const p = cmd.execute({ workspaceCwd: CWD, ownerSessionId: '', scenario: scenario('s1'), verificationRunId: 'vr_anon' })
  await tick()
  svc.gates.get('vr_anon')?.()
  await p
  ws = partitionedWs

  const anon = { workspaceCwd: CWD, ownerSessionId: '', verificationRunId: 'vr_anon' }
  rejects(() => cmd.status(anon), 'SESSION_REQUIRED')
  rejects(() => cmd.cancel(anon), 'SESSION_REQUIRED')
  await assert.rejects(
    cmd.execute({ workspaceCwd: CWD, ownerSessionId: '', scenario: scenario('s2') }),
    (/** @type {any} */ err) => err.code === 'SESSION_REQUIRED',
  )
  assert.equal(svc.calls, 1, 'rejected run never reached the verify service')
})

test('cancel only aborts: the runId stays reserved until the run unwinds', async () => {
  const svc = gatedVerifyService()
  const cmd = createVerifyCommandService({ verifyService: svc })
  const owner = { workspaceCwd: CWD, ownerSessionId: 'sess-a', verificationRunId: 'vr_a' }
  const p = cmd.execute({ ...owner, scenario: scenario('s1') })
  await tick()

  assert.deepEqual(cmd.cancel(owner), { cancelled: true })
  assert.equal(cmd.status(owner).running, true, 'still unwinding')
  await assert.rejects(
    cmd.execute({ ...owner, scenario: scenario('s1') }),
    (/** @type {any} */ err) => err.code === 'CONFLICT' && err.details.reason === 'RUN_ID_REUSE',
  )
  svc.gates.get('vr_a')?.()
  assert.equal((await p).status, 'cancelled')
  assert.equal(cmd.status(owner).running, false)
  assert.deepEqual(cmd.cancel(owner), { cancelled: false })
})

test('reusing a retained external runId conflicts and keeps the original record', async () => {
  const svc = gatedVerifyService()
  const cmd = createVerifyCommandService({ verifyService: svc })
  const owner = { workspaceCwd: CWD, ownerSessionId: 'sess-a', verificationRunId: 'vr_a' }
  const p = cmd.execute({ ...owner, scenario: scenario('first') })
  await tick()
  svc.gates.get('vr_a')?.()
  await p

  for (const sid of ['sess-a', 'sess-b']) {
    await assert.rejects(
      cmd.execute({ ...owner, ownerSessionId: sid, scenario: scenario('second') }),
      (/** @type {any} */ err) => err.code === 'CONFLICT' && err.details.reason === 'RUN_ID_REUSE',
    )
  }
  assert.equal(svc.calls, 1)
  assert.equal(cmd.status(owner).result?.scenarioId, 'first')
})

test('completed results are bounded by unique run count and clean their scenario index', async () => {
  const svc = gatedVerifyService()
  const cmd = createVerifyCommandService({ verifyService: svc, runRegistry: { maxCompleted: 3 } })
  for (let i = 0; i < 5; i++) {
    const p = cmd.execute({ workspaceCwd: CWD, ownerSessionId: 'sess-a', scenario: scenario(`s${i}`), verificationRunId: `vr_${i}` })
    await tick()
    svc.gates.get(`vr_${i}`)?.()
    await p
  }
  assert.deepEqual(cmd.registrySizes(), { active: 0, completed: 3, latestIndex: 3 })
  const owner = { workspaceCwd: CWD, ownerSessionId: 'sess-a' }
  rejects(() => cmd.status({ ...owner, verificationRunId: 'vr_0' }), 'TARGET_MISMATCH')
  rejects(() => cmd.status({ ...owner, scenarioId: 's1' }), 'TARGET_MISMATCH')
  assert.equal(cmd.status({ ...owner, scenarioId: 's4' }).result?.verificationRunId, 'vr_4')
})

test('the external abort listener is removed when the run finishes', async () => {
  const svc = gatedVerifyService()
  const cmd = createVerifyCommandService({ verifyService: svc })
  const outer = new AbortController()
  let live = 0
  const add = outer.signal.addEventListener.bind(outer.signal)
  const remove = outer.signal.removeEventListener.bind(outer.signal)
  outer.signal.addEventListener = (/** @type {any[]} */ ...args) => {
    live++
    return add(.../** @type {[any, any, any]} */ (args))
  }
  outer.signal.removeEventListener = (/** @type {any[]} */ ...args) => {
    live--
    return remove(.../** @type {[any, any, any]} */ (args))
  }
  const p = cmd.execute({ workspaceCwd: CWD, ownerSessionId: 'sess-a', scenario: scenario('s1'), verificationRunId: 'vr_a', signal: outer.signal })
  await tick()
  assert.equal(live, 1)
  svc.gates.get('vr_a')?.()
  await p
  assert.equal(live, 0)
})

test('RPC router: page scope comes from cwd/sessionId; foreign pages get TARGET_MISMATCH', async () => {
  const svc = gatedVerifyService()
  const verifyCommandService = createVerifyCommandService({ verifyService: svc })
  const router = createRouter('/test/home', { verifyCommandService })
  const running = router.dispatch('verify/run', { cwd: CWD, sessionId: 'sess-a', verificationRunId: 'vr_a', scenario: scenario('s1') })
  await tick()

  const foreign = /** @type {any} */ (await router.dispatch('verify/cancel', { cwd: CWD, sessionId: 'sess-b', runId: 'vr_a' }))
  assert.equal(foreign.ok, false)
  assert.equal(foreign.errorCode, 'TARGET_MISMATCH')
  const peek = /** @type {any} */ (await router.dispatch('verify/status', { cwd: CWD, sessionId: 'sess-b', scenarioId: 's1' }))
  assert.equal(peek.errorCode, 'TARGET_MISMATCH')
  assert.equal('running' in peek, false)

  svc.gates.get('vr_a')?.()
  assert.equal((/** @type {any} */ (await running)).result.status, 'pass')

  const dup = /** @type {any} */ (
    await createVerifyRpcHandler({ verifyCommandService })['verify/run']({
      cwd: CWD,
      sessionId: 'sess-a',
      verificationRunId: 'vr_a',
      scenario: scenario('s1'),
    })
  )
  assert.equal(dup.errorCode, 'CONFLICT')
  assert.equal(dup.details.reason, 'RUN_ID_REUSE')
  const noCwd = /** @type {any} */ (await router.dispatch('verify/status', { sessionId: 'sess-a', runId: 'vr_a' }))
  assert.equal(noCwd.errorCode, 'INVALID_FIELD')
})
