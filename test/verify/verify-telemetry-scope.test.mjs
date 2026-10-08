// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { modbusRead } from '../../bench-modbus.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { createVerifyTelemetryAdapter } from '../../src/application/verify/verify-telemetry-adapter.mjs'
import { createTelemetryReader } from '../../src/application/verify/telemetry-reader.mjs'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'
import { A, B, point, rawDiskBytes, twoSessionBench } from '../agent/evidence-scope-fixtures.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'
import { flatWorkspace, liveValue, stampWorkspace, vpoint } from './verify-fixtures.mjs'

/**
 * Production adapter over the real workspace store and read-service, with a
 * spy recording every read-service call.
 *
 * @param {string} home
 * @param {((home: string, cwd: string, body: any, opts?: any) => Promise<any>)} [readFn]
 */
function realAdapter(home, readFn = modbusRead) {
  /** @type {any[]} */
  const calls = []
  const adapter = createVerifyTelemetryAdapter({
    getHome: () => home,
    workspaceLoader: (cwd) => loadWorkspace(home, cwd),
    modbusReadFn: (h, cwd, body, opts) => {
      calls.push({ cwd, body, opts })
      return readFn(h, cwd, body, opts)
    },
  })
  return { adapter, calls }
}

/** @param {any} r */
const reasonOf = (r) => r?.reason

test('verify telemetry: a session cannot read another session private point; no read-service call', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const { adapter, calls } = realAdapter(home)
  const r = await adapter.readPoint({ cwd, sessionId: A }, 'pb')
  assert.equal(reasonOf(r), 'TARGET_UNAVAILABLE')
  assert.equal(calls.length, 0)
})

test('verify telemetry: anonymous caller on a partitioned workspace is rejected before any I/O', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const before = rawDiskBytes(home, cwd)
  const { adapter, calls } = realAdapter(home)
  const r = await adapter.readPoint({ cwd }, 'pa')
  assert.equal(reasonOf(r), 'TARGET_UNAVAILABLE')
  assert.equal(calls.length, 0)
  assert.deepEqual(rawDiskBytes(home, cwd), before)
})

test('verify telemetry: scoped supplementary read goes through the real read-service and binds its values row', async (t) => {
  const { home, cwd } = await twoSessionBench(t)
  const { adapter, calls } = realAdapter(home)
  const r = /** @type {any} */ (await adapter.readPoint({ cwd, sessionId: A, source: 'agent' }, 'pa'))
  assert.equal(r.availability, undefined, r.message)
  assert.equal(r.source, 'direct-read')
  assert.equal(calls.length, 1)
  assert.deepEqual(
    { pointId: calls[0].body.pointId, connectionId: calls[0].body.connectionId, deviceId: calls[0].body.deviceId },
    { pointId: 'pa', connectionId: 'c-a', deviceId: 'd-a' },
  )
  assert.equal(calls[0].body.sessionId, A)
  assert.equal(calls[0].opts.sessionId, A)
  const row = loadWorkspace(home, cwd).modbus.values.find((/** @type {any} */ v) => v.pointId === 'pa')
  assert.ok(row, 'normal read trace commits the runtime value')
  assert.equal(r.value, row.value)
  assert.equal(r.timestamp, row.at)
})

test('verify telemetry: same private point id in two sessions yields no value to either session', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-verify-dup-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 2,
      share: { enabled: false, connections: false, points: false },
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        [A]: {
          connections: [connection('c-a', 'tcp', '', { sim: true })],
          devices: [{ id: 'd-a', connectionId: 'c-a', name: 'DA', unitId: 1 }],
          points: [point('px', 'c-a', 'd-a')],
        },
        [B]: {
          connections: [connection('c-b', 'tcp', '', { sim: true })],
          devices: [{ id: 'd-b', connectionId: 'c-b', name: 'DB', unitId: 1 }],
          points: [point('px', 'c-b', 'd-b')],
        },
      },
      values: [liveValue('px', 777, { connectionId: 'c-b', deviceId: 'd-b' })],
    },
  })
  const { adapter, calls } = realAdapter(home)
  for (const sid of [A, B]) {
    const r = /** @type {any} */ (await adapter.readPoint({ cwd, sessionId: sid }, 'px'))
    assert.equal(r.reason, 'AMBIGUOUS_OWNER', 'runtime value of a duplicated private id cannot be attributed')
    assert.equal(r.value, undefined)
  }
  assert.equal(calls.length, 0)
})

test('verify telemetry: published samples are keyed by cwd + session + point', async () => {
  const ws = stampWorkspace(flatWorkspace({ points: [vpoint('p1')] }), { sessionId: 's' })
  const reader = createTelemetryReader({
    workspaceLoader: () => ws,
  })
  assert.equal(reader.publishPointValue({ cwd: '/w1', sessionId: 's' }, 'p1', 7), true)
  assert.equal(reasonOf(await reader.readPoint({ cwd: '/w2', sessionId: 's' }, 'p1')), 'DATA_MISSING')
  assert.equal(/** @type {any} */ (await reader.readPoint({ cwd: '/w1', sessionId: 's' }, 'p1')).value, 7)
})

test('verify telemetry: positional or scope-less reads never fall back to a bare reader', async () => {
  const reader = createTelemetryReader({
    workspaceLoader: () => flatWorkspace({ points: [vpoint('p1')], values: [liveValue('p1', 3)] }),
  })
  assert.equal(reasonOf(await reader.readPoint(/** @type {any} */ ('p1'), 'p1')), 'TARGET_UNAVAILABLE')
  assert.equal(reader.publishPointValue(/** @type {any} */ ('p1'), 'p1', 9), false)

  /** @type {any[]} */
  const seen = []
  const verifyService = createVerifyService({
    telemetryReader: {
      readPoint: async (/** @type {any[]} */ ...args) => {
        seen.push(args)
        return null
      },
    },
  })
  const result = await verifyService.runVerification({
    scenario: { id: 's', name: 's', assertions: [{ type: 'modbus.point', pointId: 'p1', op: '==', value: 3 }] },
    workspaceCwd: '/w1',
    ownerSessionId: 'sess-1',
  })
  assert.equal(result.status, 'error')
  assert.equal(result.assertions[0].reason, 'DATA_MISSING')
  assert.equal(seen.length, 1, 'scoped miss is not retried through a bare reader')
  assert.deepEqual(seen[0][0], { cwd: '/w1', sessionId: 'sess-1', source: 'user' })
})

test('verify telemetry: shared point is readable; revoke, delete and rebind invalidate the cache', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-verify-share-' })
  const { home, cwd } = bench
  const base = {
    version: 3,
    configVersion: 2,
    share: { enabled: true, connections: true, points: true },
    connections: [connection('c-s', 'tcp', '', { sim: true })],
    devices: [{ id: 'd-s', connectionId: 'c-s', name: 'DS', unitId: 1 }],
    points: [point('ps', 'c-s', 'd-s')],
    sessionConfigs: { [A]: { connections: [], devices: [], points: [] }, [B]: { connections: [], devices: [], points: [] } },
  }
  saveWorkspace(home, cwd, stampWorkspace({ modbus: base }))
  const { adapter, calls } = realAdapter(home)
  const scopeB = { cwd, sessionId: B }
  adapter.publishPointValue(scopeB, 'ps', 41)
  assert.equal(/** @type {any} */ (await adapter.readPoint(scopeB, 'ps')).value, 41)

  saveWorkspace(home, cwd, stampWorkspace({ modbus: { ...base, points: [{ ...point('ps', 'c-s', 'd-s'), address: 5 }] } }))
  const rebound = /** @type {any} */ (await adapter.readPoint(scopeB, 'ps'))
  assert.notEqual(rebound.value, 41, 'rebound point does not reuse the old cached sample')
  assert.equal(calls.length, 1)

  saveWorkspace(home, cwd, stampWorkspace({ modbus: { ...base, share: { enabled: false, connections: false, points: false } } }))
  assert.equal(reasonOf(await adapter.readPoint(scopeB, 'ps')), 'TARGET_UNAVAILABLE')

  saveWorkspace(home, cwd, stampWorkspace({ modbus: { ...base, points: [] } }))
  assert.equal(reasonOf(await adapter.readPoint(scopeB, 'ps')), 'TARGET_UNAVAILABLE')
  assert.equal(calls.length, 1)
})

/**
 * Adapter over an in-memory workspace with a scripted read-service response.
 *
 * @param {(body: any, opts: any) => any} respond
 */
function scriptedAdapter(respond) {
  /** @type {any[]} */
  const calls = []
  const adapter = createVerifyTelemetryAdapter({
    workspaceLoader: () => flatWorkspace({ points: [vpoint('p1')] }),
    modbusReadFn: async (_h, _cwd, body, opts) => {
      calls.push({ body, opts })
      return respond(body, opts)
    },
  })
  return { adapter, calls }
}

const scope = { cwd: '/w', sessionId: 's' }

test('verify telemetry: falsy values 0 and false are real samples', async () => {
  for (const v of [0, false]) {
    const { adapter } = scriptedAdapter(() => ({ ok: true, values: [liveValue('p1', v)] }))
    const r = /** @type {any} */ (await adapter.readPoint(scope, 'p1'))
    assert.equal(r.availability, undefined, r.message)
    assert.equal(r.value, v)
  }
})

test('verify telemetry: missing, duplicate, mismatched or pre-existing rows are READ_FAILED', async () => {
  const old = { ...liveValue('p1', 5), at: Date.now() - 60_000 }
  /** @type {Array<[string, any[]]>} */
  const cases = [
    ['missing', [liveValue('other', 1)]],
    ['duplicate', [liveValue('p1', 1), liveValue('p1', 2)]],
    ['mismatched provenance', [liveValue('p1', 1, { connectionId: 'c9' })]],
    ['not refreshed by this read', [old]],
  ]
  for (const [label, values] of cases) {
    const { adapter } = scriptedAdapter(() => ({ ok: true, values }))
    assert.equal(reasonOf(await adapter.readPoint(scope, 'p1')), 'READ_FAILED', label)
  }
})

test('verify telemetry: busy or failed read-service is READ_FAILED without retry or old-value masking', async () => {
  const { adapter, calls } = scriptedAdapter(() => ({ ok: false, errorCode: 'BUSY', error: 'read busy' }))
  const r = /** @type {any} */ (await adapter.readPoint(scope, 'p1'))
  assert.equal(r.reason, 'READ_FAILED')
  assert.equal(r.readErrorCode, 'BUSY')
  assert.equal(calls.length, 1)

  const bad = { ...liveValue('p1', 12), ok: false }
  const masked = createVerifyTelemetryAdapter({
    workspaceLoader: () => flatWorkspace({ points: [vpoint('p1')], values: [bad] }),
    modbusReadFn: async () => ({ ok: false, error: 'boom' }),
  })
  assert.equal(reasonOf(await masked.readPoint(scope, 'p1')), 'READ_FAILED')
})

test('verify telemetry: read-service gets the verify signal; abort is cancellation, not READ_FAILED', async () => {
  const ac = new AbortController()
  const { adapter, calls } = scriptedAdapter(() => {
    ac.abort()
    return { ok: false, cancelled: true }
  })
  await assert.rejects(adapter.readPoint(scope, 'p1', { signal: ac.signal }), { name: 'AbortError' })
  assert.equal(calls[0].opts.signal, ac.signal)
})

test('verify telemetry: a static config value alone is unverifiable', async () => {
  const verifyService = createVerifyService({
    workspaceLoader: () => flatWorkspace({ points: [vpoint('p1', { value: 3, rawValue: 3 })] }),
  })
  const result = await verifyService.runVerification({
    scenario: { id: 's', name: 's', assertions: [{ type: 'modbus.point', pointId: 'p1', op: '==', value: 3 }] },
    workspaceCwd: '/w',
    ownerSessionId: 's',
  })
  assert.equal(result.status, 'error')
  assert.equal(result.assertions[0].outcome, 'unverifiable')
  assert.equal(result.assertions[0].reason, 'DATA_MISSING')
})
