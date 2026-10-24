import assert from 'node:assert/strict'
import test from 'node:test'
import { cornBenchTool } from '../../bench-tool.mjs'
import { HOST_UNAVAILABLE } from '../../src/application/commands/command-contract.mjs'
import { isLosslessJsonValue } from '../../src/application/commands/lossless-json.mjs'
import {
  dispatchCornCommand,
  registerCornHost,
  unregisterCornHost,
} from '../../src/infrastructure/host/corn-host-client.mjs'

test('agent execute requires host and returns HOST_UNAVAILABLE when missing', async () => {
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
    assert.equal(isLosslessJsonValue(ran), true)
  } finally {
    if (prevCorn == null) delete process.env.CORN_BENCH_HOST_ORIGIN
    else process.env.CORN_BENCH_HOST_ORIGIN = prevCorn
    if (prevWeb == null) delete process.env.DSH_WEB_ORIGIN
    else process.env.DSH_WEB_ORIGIN = prevWeb
  }
})

test('registered host receives agent commands', async () => {
  const calls = []
  const stop = registerCornHost({
    dispatch(cmd) {
      calls.push(cmd)
      return { ok: true, action: cmd.action, via: 'host' }
    },
  })
  try {
    const ran = await dispatchCornCommand({
      action: 'status',
      cwd: '/tmp/proj',
      source: 'agent',
      requireHost: true,
    })
    assert.equal(ran.ok, true)
    assert.equal(ran.via, 'host')
    assert.equal(calls.length, 1)
    assert.equal(isLosslessJsonValue(ran), true)
  } finally {
    stop()
  }
})
