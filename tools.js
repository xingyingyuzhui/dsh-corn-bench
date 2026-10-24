import { CORN_GUIDANCE } from './bench-guidance.mjs'
import { cornBenchTool } from './bench-tool.mjs'
import { defaultDshHome } from './src/infrastructure/store/dsh-home.mjs'
import { migrateLegacyDataDir } from './src/infrastructure/store/legacy-data-dir.mjs'
import {
  getCornHost,
  CORN_HOST_CLIENT_INSTANCE_ID,
} from './src/infrastructure/host/corn-host-client.mjs'
import { cornDebugTool } from './src/interfaces/agent/corn-debug-tool.mjs'

/** Agent-plane loader. Dirty key must not equal the host plugin name. */
export const name = 'dsh-corn-bench-tools'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx) {
  const home = defaultDshHome()
  migrateLegacyDataDir(home)
  if (!ctx?.tools || typeof ctx.tools.register !== 'function') {
    throw new Error('dsh-corn-bench-tools: Agent requires ctx.tools.register')
  }
  if (!ctx.systemPrompt || typeof ctx.systemPrompt.section !== 'function') {
    throw new Error('dsh-corn-bench-tools: Agent requires ctx.systemPrompt.section')
  }
  console.info(
    JSON.stringify({
      event: 'corn.tools.start',
      fiber: name,
      pid: process.pid,
      hasHandle: Boolean(getCornHost()),
      clientInstanceId: CORN_HOST_CLIENT_INSTANCE_ID,
      at: Date.now(),
    }),
  )
  ctx.effect(() => ctx.tools.register(cornBenchTool(home)), 'corn-bench.tools.corn_bench')
  ctx.effect(() => ctx.tools.register(cornDebugTool(home)), 'corn-bench.tools.corn_debug')
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'corn-bench:guidance',
        order: 20,
        text: () => CORN_GUIDANCE,
      }),
    'corn-bench.guidance',
  )
}
