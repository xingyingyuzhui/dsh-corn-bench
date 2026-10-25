// @ts-check
/**
 * The workbench build gate keys on the Keil UV4 binding only.
 *
 * Settings → Corn dropped the Python field when the Node UV4 runner replaced
 * `runtime/keil_build.py`, but the workbench still required `health.python` to
 * be ready. A UV4-bound workspace therefore read 「未绑定 Keil UV4」 with a
 * disabled 编译 button while Settings showed UV4 可用.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugProjectPanel } from '../../src/ui/debug/debug-project-panel.mjs'
import { useDebugBuildActions } from '../../src/ui/debug/use-debug-build-actions.mjs'
import {
  findAllByClass,
  findByClass,
  flushEffects,
  mockReact,
  render,
  resetReactUnit,
} from '../helpers/react-unit.mjs'

const t = (/** @type {string} */ key) => key
const post = async () => ({ ok: true })

/**
 * @param {any} health
 * @param {any} [workspace]
 */
function buildActions(health, workspace = { keil: { project: '/ws/MDK-ARM/demo.uvprojx', target: 'Target 1' } }) {
  resetReactUnit()
  /** @type {any} */
  let hook = null
  const Probe = () => {
    hook = useDebugBuildActions(mockReact, t, post, '/ws', 's1', {
      health,
      workspace,
      workspaceRef: { current: workspace },
      journal: {},
      setJournal: () => {},
      setKeil: () => {},
      persist: async () => undefined,
    })
    return null
  }
  render(Probe)
  flushEffects()
  return hook
}

test('a bound UV4 enables the build without any Python binding', () => {
  const hook = buildActions({
    python: { bound: false, exists: false },
    uv4: { bound: true, exists: true },
  })
  assert.equal(hook.uv4Ready, true)
  assert.equal(hook.buildBlock, '', 'no binding blocker once UV4 is ready')
  assert.equal('pythonReady' in hook, false, 'the Python gate is gone, not merely bypassed')
})

test('an unbound UV4 still reports the binding blocker', () => {
  const hook = buildActions({
    python: { bound: true, exists: true },
    uv4: { bound: false, exists: false },
  })
  assert.equal(hook.buildBlock, 'needBindingsBuild')
})

test('a missing project reports the project blocker, not the binding one', () => {
  const hook = buildActions(
    { python: { bound: false, exists: false }, uv4: { bound: true, exists: true } },
    { keil: { project: '', target: '' } },
  )
  assert.equal(hook.buildBlock, 'needProject')
})

test('the project panel enables 编译 for a UV4-bound workspace', () => {
  const Panel = createDebugProjectPanel(mockReact, t, (/** @type {any} */ props) => null)
  const props = {
    cwd: '/ws',
    workspace: { keil: { project: '/ws/MDK-ARM/demo.uvprojx', target: 'Target 1', artifact: 'hex' } },
    targets: [{ name: 'Target 1' }],
    busy: '',
    uv4Ready: true,
    buildBusy: false,
    buildLabel: 'build',
    buildBlock: '',
    lastResult: null,
    copied: false,
    openPicker: () => {},
    openProject: () => {},
    setKeil: () => {},
    persist: async () => undefined,
    build: () => {},
    copyForAgent: () => {},
  }
  const tree = render(Panel, props)
  const buildBtn = findByClass(tree, 'dvb-btn-primary')
  assert.equal(buildBtn.props.disabled, false)
  assert.equal(findAllByClass(tree, 'dvb-need').length, 0, 'no 「未绑定」 hint with a bound UV4')
})

test('the project panel disables 编译 and explains why when UV4 is unbound', () => {
  const Panel = createDebugProjectPanel(mockReact, t, (/** @type {any} */ props) => null)
  const tree = render(Panel, {
    cwd: '/ws',
    workspace: { keil: { project: '/ws/MDK-ARM/demo.uvprojx', target: 'Target 1', artifact: 'hex' } },
    targets: [{ name: 'Target 1' }],
    busy: '',
    uv4Ready: false,
    buildBusy: false,
    buildLabel: 'build',
    buildBlock: 'needBindingsBuild',
    lastResult: null,
    copied: false,
    openPicker: () => {},
    openProject: () => {},
    setKeil: () => {},
    persist: async () => undefined,
    build: () => {},
    copyForAgent: () => {},
  })
  const buildBtn = findByClass(tree, 'dvb-btn-primary')
  assert.equal(buildBtn.props.disabled, true)
  assert.equal(buildBtn.props.title, 'needBindingsBuild')
})
