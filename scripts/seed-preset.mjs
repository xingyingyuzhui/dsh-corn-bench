#!/usr/bin/env node
import { seedCornBenchPreset } from '../bench-preset.mjs'
import { detectPresetTrack } from '../src/infrastructure/harness/dsh-contract.mjs'
import { defaultDshHome } from '../src/infrastructure/store/dsh-home.mjs'

const track = detectPresetTrack()
if (track === 'declarative') {
  console.log('[dsh-corn-bench] DSH 0.1.7+ 由 Host 声明注册 Corn模式，无需 seed')
  process.exit(0)
}
if (track === 'unknown') {
  console.error(
    '[dsh-corn-bench] 无法判断 DSH 预设轨道：未找到 @deepseek-ai/dsh-agent-preset-registry 或 @deepseek-ai/dsh-agent-presets',
  )
  process.exit(1)
}

const home = defaultDshHome()
const out = await seedCornBenchPreset(null, home)
if (!out || out.ok === false) {
  console.error('[dsh-corn-bench] Corn预设未更新:', (out && out.error) || 'overlay failed')
  if (out && out.rebuildHelp) console.error(out.rebuildHelp)
  process.exit(1)
}
console.log('[dsh-corn-bench] Corn预设', out.unchanged ? '已是最新' : '已写入', out.dir || '')
