// @ts-check
/** A simulated slave keeps written coils and holding registers. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import {
  clearSimRegisterBank,
  forgetSimConnection,
  overlaySimRead,
  rememberSimWrite,
} from '../../src/infrastructure/modbus/sim-register-bank.mjs'
import { createModbusTransport, notifyConnectionRelease } from '../../src/infrastructure/modbus/modbus-transport.mjs'
import { createBench, pointSeries } from '../helpers/workspace-factory.mjs'

const at = { cwd: '/ws/a', connectionId: 'c1', unitId: 1 }

test.beforeEach(() => clearSimRegisterBank())

test('written holding registers and coils overlay the generated read', () => {
  rememberSimWrite({ ...at, functionCode: 16, address: 10, values: [42, 43] })
  rememberSimWrite({ ...at, functionCode: 5, address: 0, values: [7] })
  assert.deepEqual(overlaySimRead({ ...at, functionCode: 3, address: 9 }, [1, 2, 3, 4]), [1, 42, 43, 4])
  assert.deepEqual(overlaySimRead({ ...at, functionCode: 1, address: 0 }, [0, 0]), [1, 0], 'coils normalize to 0/1')
})

test('read-only tables, other units, workspaces and connections are untouched', () => {
  rememberSimWrite({ ...at, functionCode: 6, address: 10, values: [42] })
  assert.deepEqual(overlaySimRead({ ...at, functionCode: 4, address: 10 }, [5]), [5], 'input registers stay generated')
  assert.deepEqual(overlaySimRead({ ...at, unitId: 2, functionCode: 3, address: 10 }, [5]), [5])
  assert.deepEqual(overlaySimRead({ ...at, cwd: '/ws/b', functionCode: 3, address: 10 }, [5]), [5])
  assert.deepEqual(overlaySimRead({ ...at, connectionId: 'c2', functionCode: 3, address: 10 }, [5]), [5])
})

test('releasing a connection forgets its registers only', () => {
  rememberSimWrite({ ...at, functionCode: 6, address: 10, values: [42] })
  rememberSimWrite({ ...at, connectionId: 'c2', functionCode: 6, address: 10, values: [9] })
  forgetSimConnection('/ws/a', 'c1')
  assert.deepEqual(overlaySimRead({ ...at, functionCode: 3, address: 10 }, [5]), [5])
  assert.deepEqual(overlaySimRead({ ...at, connectionId: 'c2', functionCode: 3, address: 10 }, [5]), [9])
  notifyConnectionRelease('/ws/a', ['c2'], { transport: /** @type {any} */ ({ releaseConnection: async () => {} }) })
  assert.deepEqual(overlaySimRead({ ...at, connectionId: 'c2', functionCode: 3, address: 10 }, [5]), [5])
})

test('transport sim write is read back by the next sim read', async () => {
  const transport = createModbusTransport({ broker: /** @type {any} */ ({ health: async () => ({}) }) })
  const endpoint = { sim: true, mode: 'tcp' }
  await transport.write({ ...at, endpoint, functionCode: 6, address: 300, values: [4242] })
  const read = await transport.read({ ...at, endpoint, functionCode: 3, address: 300, count: 1 })
  assert.deepEqual(read.data, [4242])
})

test('an HMI sim write survives the following reads', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-sim-bank-' })
  bench.save({ modbus: { conn: { sim: true }, points: pointSeries('保持', 12) } })
  const wrote = await runVisionBench(bench.home, { action: 'write', function: 3, address: 10, values: [42] }, bench.cwd, { source: 'user', sessionId: '' })
  assert.equal(wrote.ok, true, wrote.error)
  for (let i = 0; i < 2; i++) {
    const read = await runVisionBench(bench.home, { action: 'read', function: 3, address: 10, count: 1 }, bench.cwd, { source: 'user', sessionId: '' })
    assert.equal(read.ok, true, read.error)
    assert.deepEqual(read.readings?.[0]?.raw, [42], JSON.stringify(read).slice(0, 300))
    await new Promise((resolve) => setTimeout(resolve, 1100)) // cross a generator tick
  }
})

test('a sim write logs one successful task, never a spurious 写入中断', async (t) => {
  const { loadWorkspace } = await import('../../bench-store.mjs')
  const bench = await createBench(t, { prefix: 'dvb-sim-log-' })
  bench.save({ modbus: { conn: { sim: true }, points: pointSeries('保持', 4) } })
  const wrote = await runVisionBench(bench.home, { action: 'write', function: 3, address: 1, values: [5] }, bench.cwd, { source: 'user', sessionId: '' })
  assert.equal(wrote.ok, true, wrote.error)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const ws = loadWorkspace(bench.home, bench.cwd)
  const text = JSON.stringify(ws.log || []) + JSON.stringify(ws.tasks || [])
  assert.equal(text.includes('写入中断'), false, text.slice(0, 400))
})
