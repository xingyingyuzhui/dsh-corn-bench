import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { TargetLeaseManager } from '../../src/domain/debug/target-lease.mjs'

const spec = {
  debugSessionId: 'reserved',
  ownerSessionId: 'a',
  workspaceCwd: '/tmp/owned-ws',
  backend: 'fake',
  targetSpec: { probeSerial: 'probe-a' },
}

test('a pending start reserves its id before invoking an asynchronous backend factory', async (t) => {
  let finish
  let calls = 0
  const runtime = createDebugRuntime({
    backendFactory: async () => {
      calls++
      await new Promise((resolve) => {
        finish = resolve
      })
      return { async start() {}, async stop() {} }
    },
  })
  t.after(() => runtime.shutdown())
  const first = runtime.start(spec)
  await assert.rejects(runtime.start({ ...spec, ownerSessionId: 'b', targetSpec: { probeSerial: 'probe-b' } }), {
    code: 'DEBUG_COMMAND_REJECTED',
  })
  assert.equal(calls, 1)
  assert.equal(runtime.getLeaseManager().leases.size, 1)
  finish()
  assert.equal((await first).ownerSessionId, 'a')
})

for (const shutdown of [false, true]) {
  test(`late backend cannot revive a cancelled start (${shutdown ? 'shutdown' : 'stop'})`, async () => {
    let finish
    let starts = 0
    let stops = 0
    const runtime = createDebugRuntime({
      backendFactory: async () => {
        await new Promise((resolve) => {
          finish = resolve
        })
        return {
          async start() {
            starts++
          },
          async stop() {
            stops++
          },
        }
      },
    })
    const first = runtime.start(spec)
    const rejected = assert.rejects(first, { code: 'DEBUG_SESSION_STALE' })
    const stop = shutdown
      ? runtime.shutdown()
      : runtime.stop({ debugSessionId: spec.debugSessionId, ownerSessionId: 'a' })
    finish()
    await rejected
    await stop
    assert.equal(starts, 0)
    assert.equal(stops, 1)
    assert.equal(runtime.listSessions().length, 0)
    assert.equal(runtime.getLeaseManager().leases.size, 0)
  })
}

test('target leases cannot be reused by the same debug id under another owner or workspace', () => {
  const manager = new TargetLeaseManager()
  const ctx = { sessionId: 'd', ownerSessionId: 'a', workspaceCwd: '/tmp/a' }
  const target = { probeSerial: 'unique' }
  const lease = manager.acquireLease(target, ctx)
  assert.equal(manager.acquireLease(target, { ...ctx, workspaceCwd: '/tmp/a/' }), lease)
  for (const next of [
    { ...ctx, ownerSessionId: 'b' },
    { ...ctx, workspaceCwd: '/tmp/b' },
  ]) {
    assert.throws(() => manager.acquireLease(target, next), { code: 'DEBUG_TARGET_BUSY' })
  }
  assert.equal(manager.leases.size, 1)
})

test('shutdown rejects new starts while an existing backend is still stopping', async () => {
  let finish
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      async start() {},
      async stop() {
        await new Promise((resolve) => {
          finish = resolve
        })
      },
    }),
  })
  await runtime.start(spec)
  const shutdown = runtime.shutdown()
  await assert.rejects(runtime.start({ ...spec, debugSessionId: 'new', targetSpec: { probeSerial: 'probe-b' } }), {
    code: 'DEBUG_SESSION_STALE',
  })
  finish()
  await shutdown
  assert.equal(runtime.getLeaseManager().leases.size, 0)
})
