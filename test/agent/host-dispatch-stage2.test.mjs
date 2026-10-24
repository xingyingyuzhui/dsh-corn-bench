import assert from 'node:assert/strict'
import test from 'node:test'
import { HOST_UNAVAILABLE } from '../../src/application/commands/command-contract.mjs'
import {
  describeHostBridge,
  dispatchCornCommand,
  getCornHostEpoch,
  hostOriginOf,
  registerCornHost,
  unregisterCornHost,
} from '../../src/infrastructure/host/corn-host-client.mjs'
import { cornBenchTool } from '../../bench-tool.mjs'

test('hostOriginOf never guesses 127.0.0.1:3080', () => {
  const prevCorn = process.env.CORN_BENCH_HOST_ORIGIN
  const prevWeb = process.env.DSH_WEB_ORIGIN
  delete process.env.CORN_BENCH_HOST_ORIGIN
  delete process.env.DSH_WEB_ORIGIN
  try {
    assert.equal(hostOriginOf(), '')
    assert.doesNotMatch(hostOriginOf(), /3080/)
  } finally {
    if (prevCorn == null) delete process.env.CORN_BENCH_HOST_ORIGIN
    else process.env.CORN_BENCH_HOST_ORIGIN = prevCorn
    if (prevWeb == null) delete process.env.DSH_WEB_ORIGIN
    else process.env.DSH_WEB_ORIGIN = prevWeb
  }
})

test('dispatch without Host handle does not run local executeHostCommand', async () => {
  unregisterCornHost()
  const prevCorn = process.env.CORN_BENCH_HOST_ORIGIN
  const prevWeb = process.env.DSH_WEB_ORIGIN
  delete process.env.CORN_BENCH_HOST_ORIGIN
  delete process.env.DSH_WEB_ORIGIN
  try {
    const ran = await dispatchCornCommand({
      action: 'status',
      cwd: '/tmp/proj',
      source: 'agent',
      home: '/tmp/should-not-write',
    })
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, HOST_UNAVAILABLE)
    assert.equal(describeHostBridge().transport, 'unavailable')
  } finally {
    if (prevCorn == null) delete process.env.CORN_BENCH_HOST_ORIGIN
    else process.env.CORN_BENCH_HOST_ORIGIN = prevCorn
    if (prevWeb == null) delete process.env.DSH_WEB_ORIGIN
    else process.env.DSH_WEB_ORIGIN = prevWeb
  }
})

test('requireHost without origin returns HOST_UNAVAILABLE (no localhost guess)', async () => {
  unregisterCornHost()
  const prevCorn = process.env.CORN_BENCH_HOST_ORIGIN
  const prevWeb = process.env.DSH_WEB_ORIGIN
  delete process.env.CORN_BENCH_HOST_ORIGIN
  delete process.env.DSH_WEB_ORIGIN
  try {
    const tool = cornBenchTool('/tmp')
    const ran = await tool.execute(
      { action: 'status' },
      { agent: { session: { header: { cwd: '/tmp/proj', id: 's1' } } } },
    )
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, HOST_UNAVAILABLE)
  } finally {
    if (prevCorn == null) delete process.env.CORN_BENCH_HOST_ORIGIN
    else process.env.CORN_BENCH_HOST_ORIGIN = prevCorn
    if (prevWeb == null) delete process.env.DSH_WEB_ORIGIN
    else process.env.DSH_WEB_ORIGIN = prevWeb
  }
})

test('registerCornHost epoch invalidates stale disposer', async () => {
  unregisterCornHost()
  const stopA = registerCornHost({
    dispatch() {
      return { ok: true, via: 'a' }
    },
  })
  const epochA = getCornHostEpoch()
  assert.ok(epochA)
  const stopB = registerCornHost({
    dispatch() {
      return { ok: true, via: 'b' }
    },
  })
  const epochB = getCornHostEpoch()
  assert.notEqual(epochA, epochB)
  stopA()
  assert.equal(getCornHostEpoch(), epochB, 'stale disposer must not clear newer registration')
  const ran = await dispatchCornCommand({ action: 'status', source: 'agent', requireHost: true })
  assert.equal(ran.via, 'b')
  stopB()
  assert.equal(getCornHostEpoch(), null)
})
