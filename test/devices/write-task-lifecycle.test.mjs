import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { modbusWrite } from '../../bench-actions.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { hasRunning } from '../../src/domain/modbus/journal-model.mjs'
import { workspaceDir } from '../../src/infrastructure/persistence/workspace-migration.mjs'
import { workspaceKey } from '../../src/infrastructure/store/workspace-store.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'

test('sim write identity save failure closes the write task and keeps simulation', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-save-fail-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      share: { enabled: true, connections: true, points: true, visualization: false },
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0)],
      sessionConfigs: { s1: { connections: [], devices: [], points: [] } },
      values: [],
    },
  })
  // write-file-atomic resolves the target with fs.realpathSync before renaming,
  // so compare against the resolved path: on macOS $TMPDIR is /var/... while
  // realpath returns /private/var/....
  const configPath = join(fs.realpathSync(workspaceDir(home, workspaceKey(cwd))), 'config.json')
  // Fail only the atomic rename onto config.json (write-file-atomic resolves
  // fs.renameSync at call time), the same on macOS, Linux and Windows.
  const realRename = fs.renameSync
  const renameMock = t.mock.method(fs, 'renameSync', (from, to) => {
    if (String(to) === configPath) throw Object.assign(new Error(`EPERM: rename '${to}'`), { code: 'EPERM' })
    return realRename(from, to)
  })
  const failed = await modbusWrite(home, cwd, {
    source: 'user',
    function: 3,
    address: 0,
    values: [7],
    connectionId: 'c1',
    deviceId: 'd1',
  })
  renameMock.mock.restore()
  assert.equal(failed.ok, false, failed.error)
  assert.equal(failed.errorCode, 'WORKSPACE_WRITE_FAILED')
  assert.equal(loadWorkspace(home, cwd).modbus.connections[0].conn.sim, true)
  assert.equal(hasRunning(loadWorkspace(home, cwd), 'write'), false, 'failed identity save must not leave a running write task')

  const again = await modbusWrite(
    home,
    cwd,
    {
      source: 'user',
      sessionId: 's1',
      function: 3,
      address: 0,
      values: [7],
      connectionId: 'c1',
      deviceId: 'd1',
    },
    { sessionId: 's1' },
  )
  assert.equal(again.ok, true, again.error)
  assert.equal(hasRunning(loadWorkspace(home, cwd), 'write'), false)
})

test('a throwing transport closes the write task', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-throw-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      connections: [connection('c1', 'tcp', '', { host: '127.0.0.1', sim: false })],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0)],
      values: [],
    },
  })
  await assert.rejects(
    () =>
      modbusWrite(
        home,
        cwd,
        {
          source: 'user',
          function: 3,
          address: 0,
          values: [1],
          connectionId: 'c1',
          deviceId: 'd1',
        },
        {
          transport: {
            write: async () => {
              throw new Error('bus down')
            },
          },
        },
      ),
    /bus down/,
  )
  assert.equal(hasRunning(loadWorkspace(home, cwd), 'write'), false, 'a thrown write must not leave a running task')
})
