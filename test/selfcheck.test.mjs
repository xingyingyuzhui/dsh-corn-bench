import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runSelfCheck } from '../bench-check.mjs'
import { stopCornIoBroker } from '../bench-io-broker.mjs'
import { saveBindings } from '../bench-store.mjs'
import { executeCornCommand } from '../src/application/commands/corn-command-service.mjs'
import {
  pingCornHost,
  registerCornHost,
  unregisterCornHost,
} from '../src/infrastructure/host/corn-host-client.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function listen(handler) {
  const server = createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, origin: `http://127.0.0.1:${port}` })
    })
  })
}

async function withOrigin(origin, fn) {
  const prev = process.env.CORN_BENCH_HOST_ORIGIN
  process.env.CORN_BENCH_HOST_ORIGIN = origin
  unregisterCornHost()
  try {
    return await fn()
  } finally {
    if (prev == null) delete process.env.CORN_BENCH_HOST_ORIGIN
    else process.env.CORN_BENCH_HOST_ORIGIN = prev
    unregisterCornHost()
  }
}

test('runSelfCheck reports structured results without bindings', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-check-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    await withOrigin('http://127.0.0.1:1', async () => {
      const ran = await runSelfCheck(home, cwd)
      assert.equal(typeof ran.ok, 'boolean')
      assert.ok(Array.isArray(ran.checks))
      const names = ran.checks.map((item) => item.name)
      for (const key of [
        'bind-python',
        'bind-uv4',
        'bind-openocd',
        'bind-gdb',
        'corn-preset',
        'workspace',
        'serial-scan',
        'host-bridge',
      ]) {
        assert.ok(names.includes(key), 'missing check ' + key)
      }
      const workspace = ran.checks.find((item) => item.name === 'workspace')
      assert.equal(workspace.ok, true)
      const binds = ran.checks.filter((item) => item.name.startsWith('bind-'))
      assert.equal(
        binds.every((item) => item.ok === false),
        true,
      )
      assert.ok(ran.capabilities)
      assert.equal(ran.capabilities.keilProject.ready, false)
      assert.equal(typeof ran.requiredOk, 'boolean')
      const host = ran.checks.find((item) => item.name === 'host-bridge')
      assert.equal(host.ok, false)
      assert.equal(ran.hostBridge.available, false)
      assert.equal(ran.requiredOk, false)
      assert.equal(ran.ok, false)
    })
    await stopCornIoBroker('test')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('runSelfCheck probes a runnable interpreter', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-check-py-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveBindings(home, { python: process.execPath, uv4: '', openocd: '' })
    await withOrigin('http://127.0.0.1:1', async () => {
      const ran = await runSelfCheck(home, cwd)
      const runs = ran.checks.find((item) => item.name === 'python-runs')
      assert.equal(runs.ok, true)
      const io = ran.checks.find((item) => item.name === 'io-runtime')
      assert.equal(typeof io.ok, 'boolean')
      assert.ok(ran.capabilities)
      assert.equal(typeof ran.capabilities.modbusTcp.ready, 'boolean')
    })
    await stopCornIoBroker('test')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('openocdFlash.ready 不依赖 Python，且探测失败则为 false', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-check-ocd-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveBindings(home, { python: '', uv4: '', openocd: join(home, 'missing-openocd') })
    await withOrigin('http://127.0.0.1:1', async () => {
      const missing = await runSelfCheck(home, cwd)
      assert.equal(missing.capabilities.openocdFlash.ready, false)
      assert.match(missing.capabilities.openocdFlash.reason, /不存在/)
      assert.equal(missing.capabilities.keilProject.ready, false)

      saveBindings(home, { python: '', uv4: '', openocd: process.execPath })
      const nodeish = await runSelfCheck(home, cwd)
      assert.equal(nodeish.capabilities.openocdFlash.ready, false)
      assert.match(nodeish.capabilities.openocdFlash.reason, /不是 OpenOCD|探测失败|失败/)
      assert.equal(nodeish.capabilities.keilProject.ready, false)

      const identNonzero = await runSelfCheck(home, cwd, {
        runExecFile: async () => ({
          exitCode: 1,
          stdout: '',
          stderr: 'Open On-Chip Debugger 0.12.0\n',
          timedOut: false,
          cancelled: false,
        }),
      })
      assert.equal(identNonzero.capabilities.openocdFlash.ready, false)

      const ready = await runSelfCheck(home, cwd, {
        runExecFile: async () => ({
          exitCode: 0,
          stdout: '',
          stderr: 'Open On-Chip Debugger 0.12.0\n',
          timedOut: false,
          cancelled: false,
        }),
      })
      assert.equal(ready.capabilities.openocdFlash.ready, true)
      assert.equal(ready.capabilities.keilProject.ready, false)
      const failed = await runSelfCheck(home, cwd, {
        runExecFile: async () => {
          throw new Error('not executable')
        },
      })
      assert.equal(failed.capabilities.openocdFlash.ready, false)
      assert.match(failed.capabilities.openocdFlash.reason, /not executable|探测失败|失败/)
      const timed = await runSelfCheck(home, cwd, {
        runExecFile: async () => ({ exitCode: 1, timedOut: true, stdout: '', stderr: 'hang' }),
      })
      assert.equal(timed.capabilities.openocdFlash.ready, false)
      const echoish = await runSelfCheck(home, cwd, {
        runExecFile: async () => ({ exitCode: 0, stdout: 'hello', stderr: '', timedOut: false, cancelled: false }),
      })
      assert.equal(echoish.capabilities.openocdFlash.ready, false)
    })
    await stopCornIoBroker('test')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('in-process Host ping succeeds', async () => {
  const stop = registerCornHost({
    async dispatch(cmd) {
      assert.equal(cmd.action, 'system.ping')
      return executeCornCommand({ ...cmd, home: '/tmp' })
    },
  })
  try {
    const ping = await pingCornHost({ timeoutMs: 2000 })
    assert.equal(ping.ok, true)
    assert.equal(ping.available, true)
    assert.equal(ping.data.service, 'dsh-corn-bench')
    assert.equal(ping.data.transport, 'in-process')
    assert.equal(typeof ping.data.version, 'string')
    assert.equal(ping.data.pid, process.pid)
    assert.ok(ping.data.timestamp)
    assert.ok(ping.roundtripMs >= 0)
  } finally {
    stop()
  }
})

test('HTTP Host ping succeeds and records real roundtrip', async () => {
  const { server, origin } = await listen((req, res) => {
    if (req.method !== 'POST' || req.url !== '/dsh-corn-bench/command') {
      res.writeHead(404)
      res.end()
      return
    }
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          ok: true,
          action: 'system.ping',
          data: {
            service: 'dsh-corn-bench',
            version: '0.22.0',
            pid: 4242,
            timestamp: '2026-08-30T00:00:00.000Z',
          },
        }),
      )
    }, 60)
  })
  try {
    const ping = await withOrigin(origin, () => pingCornHost({ timeoutMs: 2000 }))
    assert.equal(ping.ok, true)
    assert.equal(ping.data.transport, 'http')
    assert.equal(ping.data.pid, 4242)
    assert.ok(ping.roundtripMs >= 40, `expected real latency, got ${ping.roundtripMs}`)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('Host ping maps refused / timeout / invalid JSON / 401 / 403', async () => {
  const refused = await withOrigin('http://127.0.0.1:1', () => pingCornHost({ timeoutMs: 500 }))
  assert.equal(refused.ok, false)
  assert.equal(refused.available, false)
  assert.equal(refused.errorCode, 'HOST_UNAVAILABLE')

  const slow = await listen(() => {})
  try {
    const timed = await withOrigin(slow.origin, () => pingCornHost({ timeoutMs: 80 }))
    assert.equal(timed.ok, false)
    assert.equal(timed.errorCode, 'HOST_TIMEOUT')
    assert.ok(timed.roundtripMs >= 50)
  } finally {
    await new Promise((r) => slow.server.close(r))
  }

  const badJson = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('not-json{')
  })
  try {
    const invalid = await withOrigin(badJson.origin, () => pingCornHost({ timeoutMs: 1000 }))
    assert.equal(invalid.ok, false)
    assert.equal(invalid.errorCode, 'HOST_INVALID_RESPONSE')
  } finally {
    await new Promise((r) => badJson.server.close(r))
  }

  const unauth = await listen((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'nope' }))
  })
  try {
    const ran = await withOrigin(unauth.origin, () => pingCornHost({ timeoutMs: 1000 }))
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, 'HOST_UNAUTHORIZED')
  } finally {
    await new Promise((r) => unauth.server.close(r))
  }

  const forbid = await listen((_req, res) => {
    res.writeHead(403, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'nope' }))
  })
  try {
    const ran = await withOrigin(forbid.origin, () => pingCornHost({ timeoutMs: 1000 }))
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, 'HOST_FORBIDDEN')
  } finally {
    await new Promise((r) => forbid.server.close(r))
  }
})

test('HTTP Host ping rejects an unrelated server that only returns ok:true', async () => {
  const unrelated = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
  try {
    const ran = await withOrigin(unrelated.origin, () => pingCornHost({ timeoutMs: 1000 }))
    assert.equal(ran.ok, false)
    assert.equal(ran.available, false)
    assert.equal(ran.errorCode, 'HOST_INVALID_RESPONSE')
  } finally {
    await new Promise((r) => unrelated.server.close(r))
  }
})

test('system.ping is side-effect free and self-check uses real availability', async () => {
  const src = readFileSync(join(root, 'src/application/commands/handlers/system-command-handler.mjs'), 'utf8')
  assert.doesNotMatch(src, /serialport|modbus-serial|CornIoBroker|notifyConnectionRelease|mutateConfig/)
  const checkSrc = readFileSync(join(root, 'src/application/system/self-check.mjs'), 'utf8')
  assert.doesNotMatch(checkSrc, /push\(\s*['"]host-bridge['"]\s*,\s*true/)
  assert.match(checkSrc, /pingCornHost/)

  const ping = await executeCornCommand({ action: 'system.ping', source: 'system', cwd: '' })
  assert.equal(ping.ok, true)
  assert.equal(ping.data.service, 'dsh-corn-bench')
  assert.equal(typeof ping.data.pid, 'number')
})
