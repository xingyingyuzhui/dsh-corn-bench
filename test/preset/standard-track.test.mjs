// @ts-check
/** Standard snapshot selection by registry capability, and live drift detection. */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activateCornPresetDeclaration,
  buildCornPresetDefinition,
  getDeclarationState,
  registerCornPreset,
} from '../../src/infrastructure/harness/preset-declaration.mjs'
import {
  describeStandardDrift,
  documentNames,
  rowNames,
  selectStandardSnapshot,
  standardDrift,
} from '../../src/infrastructure/harness/standard-preset-track.mjs'

const legacyRegistry = { register: async () => () => {} }
const currentRegistry = { register: async () => () => {}, readDocument: async () => ({ content: '' }) }

test('a registry without readDocument (DSH 0.1.7) gets the frozen 0.1.7 rows', () => {
  assert.equal(selectStandardSnapshot(legacyRegistry).contract, '0.1.7-alpha.2')
  assert.equal(selectStandardSnapshot(currentRegistry).contract, '0.2.1-rc.2')
  assert.equal(selectStandardSnapshot(null).contract, '0.2.1-rc.2')
})

test('registration restates the rows of the detected track', async () => {
  /** @type {any[]} */
  const seen = []
  const capture = (/** @type {any} */ extra) => ({ ...extra, register: async (/** @type {any} */ d) => { seen.push(d); return () => {} } })
  const legacy = await registerCornPreset(capture({}), { platform: 'linux' })
  const current = await registerCornPreset(capture({ readDocument: async () => ({ content: '' }) }), { platform: 'linux' })
  assert.equal(legacy.snapshot, '0.1.7-alpha.2')
  assert.equal(current.snapshot, '0.2.1-rc.2')
  const ids = (/** @type {any} */ d) => d.plugins.map((/** @type {any} */ r) => r.id)
  assert.equal(ids(seen[0]).includes('time-context'), false)
  assert.equal(ids(seen[1]).includes('time-context'), true)
  assert.equal(ids(seen[1]).at(-1), 'corn-bench-tools')
})

test('documentNames reads plain and quoted names from entry-list YAML', () => {
  const names = documentNames("- id: a\n  name: '@deepseek-ai/dsh-a'\n- id: g\n  name: cordis:group\n  group: true\n  config:\n    - name: \"@x/b\"\n")
  assert.deepEqual([...names].sort(), ['@deepseek-ai/dsh-a', '@x/b', 'cordis:group'])
})

test('standardDrift reports names missing from and extra to the live standard', async () => {
  const rows = buildCornPresetDefinition({ platform: 'linux' }).plugins.filter((r) => r.id !== 'corn-bench-tools')
  const live = [...rowNames(rows)].filter((n) => n !== '@deepseek-ai/dsh-time-context').concat(['@x/new-tool'])
  const registry = { readDocument: async () => ({ content: live.map((n) => `- name: '${n}'`).join('\n') }) }
  const drift = await standardDrift(registry, rows)
  assert.equal(drift.checked, true)
  assert.deepEqual(drift.missing, ['@x/new-tool'])
  assert.deepEqual(drift.extra, ['@deepseek-ai/dsh-time-context'])
  assert.match(describeStandardDrift(drift), /缺少 standard 中的 @x\/new-tool；多出 standard 已移除的 @deepseek-ai\/dsh-time-context/)
})

test('standardDrift is unchecked, never thrown, on old or failing hosts', async () => {
  assert.deepEqual(await standardDrift(legacyRegistry, []), { checked: false, missing: [], extra: [] })
  const failing = { readDocument: async () => { throw new Error('agent-preset/not-found') } }
  assert.deepEqual(await standardDrift(failing, []), { checked: false, missing: [], extra: [] })
  assert.equal(describeStandardDrift({ missing: [], extra: [] }), '')
})

test('activation compares only standard rows, never the appended Corn tool row', async () => {
  const standardNames = [...rowNames(buildCornPresetDefinition({ platform: 'linux' }).plugins)].filter(
    (n) => n !== 'dsh-corn-bench/agent',
  )
  const registry = {
    register: async () => async () => {},
    list: async () => [{ id: 'corn-bench' }],
    readDocument: async () => ({ content: standardNames.map((n) => `- name: '${n}'`).join('\n') }),
  }
  const activation = await activateCornPresetDeclaration(registry, '/nonexistent-home', { platform: 'linux' })
  assert.equal(activation.via, 'agentPresets.register')
  assert.equal(getDeclarationState().snapshot, '0.2.1-rc.2')
  assert.equal(getDeclarationState().snapshotDrift, '')
})
