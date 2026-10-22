// @ts-check
/** The Debug workbench reloads Target options for a saved project on mount. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { useDebugBuildActions } from '../../src/ui/debug/use-debug-build-actions.mjs'
import { flushEffects, mockReact, render, resetReactUnit } from '../helpers/react-unit.mjs'

test('a saved project loads its targets once on mount and keeps the saved target', async () => {
  resetReactUnit()
  /** @type {Array<[string, any]>} */
  const calls = []
  const post = async (/** @type {string} */ path, /** @type {any} */ body) => {
    calls.push([path, body])
    return { ok: true, result: { details: { targets: [{ name: 'Flash' }, { name: 'RAM' }] } } }
  }
  const workspace = { keil: { project: '/ws/MDK-ARM/demo.uvprojx', target: 'RAM' } }
  /** @type {any} */
  let hook = null
  let persisted = 0
  const Probe = () => {
    hook = useDebugBuildActions(mockReact, (k) => k, post, '/ws', 's1', {
      health: {},
      workspace,
      workspaceRef: { current: workspace },
      journal: {},
      setJournal: () => {},
      setKeil: () => {},
      persist: async () => { persisted++ },
    })
    return null
  }
  render(Probe)
  flushEffects()
  await new Promise((resolve) => setImmediate(resolve))
  render(Probe)
  flushEffects()
  const targetCalls = calls.filter(([path]) => path === '/dsh-vision-bench/keil/targets')
  assert.equal(targetCalls.length, 1)
  assert.equal(targetCalls[0][1].project, '/ws/MDK-ARM/demo.uvprojx')
  assert.deepEqual(hook.targets.map((/** @type {any} */ t) => t.name), ['Flash', 'RAM'])
  assert.equal(persisted, 0, 'a saved target is not replaced by the first one')
})
