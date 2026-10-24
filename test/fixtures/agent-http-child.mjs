import { dispatchCornCommand, unregisterCornHost } from '../../src/infrastructure/host/corn-host-client.mjs'

unregisterCornHost()

const origin = String(process.env.CORN_BENCH_HOST_ORIGIN || '').trim()
if (!origin) {
  process.stdout.write(JSON.stringify({ ok: false, errorCode: 'HOST_UNAVAILABLE', error: 'Host 地址缺失' }))
  process.exit(1)
}

let command = {}
try {
  command = JSON.parse(process.env.CORN_BENCH_CHILD_COMMAND || '{}')
} catch {
  process.stdout.write(JSON.stringify({ ok: false, errorCode: 'HOST_INVALID_RESPONSE', error: '子进程命令不是 JSON' }))
  process.exit(1)
}

const result = await dispatchCornCommand({
  ...command,
  requireHost: true,
})

process.stdout.write(
  JSON.stringify({
    result,
    pid: process.pid,
    cwd: command.cwd || '',
    sessionId: command.sessionId || '',
    source: command.source || '',
    origin,
  }),
)
process.exit(result && result.ok === true ? 0 : 1)
