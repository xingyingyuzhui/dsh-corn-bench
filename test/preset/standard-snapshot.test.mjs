import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STANDARD_PRESET_SNAPSHOT_CONTRACT,
  buildStandardPresetChildren,
} from '../../src/infrastructure/harness/standard-preset-snapshot.mjs'
import {
  STANDARD_PRESET_SNAPSHOT_CONTRACT as LEGACY_CONTRACT,
  buildStandardPresetChildren as buildLegacyChildren,
} from '../../src/infrastructure/harness/standard-preset-snapshot-0.1.7.mjs'

test('snapshot tracks the pinned DSH contract', () => {
  assert.equal(STANDARD_PRESET_SNAPSHOT_CONTRACT, '0.2.1-rc.2')
  assert.equal(LEGACY_CONTRACT, '0.1.7-alpha.2')
})

test('snapshot carries the full shipped standard child list in order', () => {
  const ids = buildStandardPresetChildren({ platform: 'linux' }).map((row) => row.id)
  assert.deepEqual(ids, [
    'persona',
    'agent-instructions',
    'time-context',
    'tool-bash',
    'tool-pwsh',
    'tool-fs',
    'tool-fs-search',
    'tool-jobs',
    'tool-schedule',
    'skill-filesystem',
    'tool-skill',
    'command-goal',
    'tool-goal',
    'planning',
    'compaction',
    'delegation',
    'tool-ask-user',
    'tool-todo',
    'tool-web',
    'present',
    'tool-plugin-manager',
    'tool-plugin-market',
  ])
})

test('the frozen 0.1.7 snapshot keeps its own child list', () => {
  const ids = buildLegacyChildren({ platform: 'linux' }).map((row) => row.id)
  assert.equal(ids.includes('time-context'), false)
  assert.equal(ids.includes('tool-schedule'), false)
  assert.equal(ids.at(-1), 'tool-plugin-manager')
})

test('snapshot never carries the Vision tool row', () => {
  const rows = buildStandardPresetChildren({ platform: 'linux' })
  assert.ok(!rows.some((row) => row.id === 'vision-bench-tools'))
  assert.ok(!rows.some((row) => row.name === 'dsh-vision-bench/agent'))
})

test('snapshot keeps always-off providers disabled', () => {
  const rows = buildStandardPresetChildren({ platform: 'linux' })
  const delegation = /** @type {{ config: any[] }} */ (rows.find((row) => row.id === 'delegation'))
  assert.deepEqual(delegation.config.filter((row) => row.disabled === true), [])
  const off = rows.filter((row) => row.disabled === true).map((row) => row.id)
  assert.deepEqual(off.sort(), ['tool-plugin-manager', 'tool-plugin-market', 'tool-pwsh'])
  assert.equal(buildStandardPresetChildren({ platform: 'win32' }).find((row) => row.id === 'tool-bash')?.disabled, true)
})
