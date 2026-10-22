// @ts-check
// Settings → Vision page lifecycle (HappyDOM + react-runtime).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createSettingsPage } from '../../src/ui/settings/settings-page.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime()

const STORED = { python: '', uv4: '/opt/keil/UV4', openocd: '/opt/openocd/bin/openocd', gdb: '' }

/** @param {{ confirm?: boolean }} [opts] */
function mount(opts = {}) {
  /** @type {Array<[string, any]>} */
  const calls = []
  /** @type {(v: any) => void} */
  let releaseState = () => {}
  const statePromise = new Promise((resolve) => {
    releaseState = resolve
  })
  const post = async (/** @type {string} */ path, /** @type {any} */ body) => {
    calls.push([path, body])
    if (path === '/dsh-vision-bench/state') {
      return statePromise
    }
    if (path === '/dsh-vision-bench/bindings') {
      return { ok: true, bindings: STORED, agentPolicy: body.agentPolicy || { agentWriteApproval: true }, globalShare: body.share }
    }
    return { ok: true }
  }
  /** @type {any} */ (win).confirm = () => opts.confirm !== false
  const SettingsPage = createSettingsPage(React, (/** @type {string} */ k) => k, post, {
    getScope: () => ({ cwd: '/ws', sessionId: 's1' }),
  })
  const view = render(React.createElement(SettingsPage))
  const load = () =>
    act(async () => {
      releaseState({ ok: true, bindings: STORED, agentPolicy: { agentWriteApproval: true }, globalShare: { enabled: false } })
      await statePromise
    })
  return { calls, view, load }
}

/** @param {HTMLElement} root @param {string} placeholder */
const inputByPh = (root, placeholder) =>
  /** @type {HTMLInputElement} */ (root.querySelector(`input[placeholder="${placeholder}"]`))

test('save stays disabled until stored bindings arrive, and GDB has a field', async () => {
  const { view, load } = mount()
  const save = () => /** @type {HTMLButtonElement} */ (view.container.querySelector('.dvb-btn-pill-primary'))
  assert.equal(save().disabled, true)
  await load()
  await waitFor(() => assert.equal(save().disabled, false))
  assert.equal(inputByPh(view.container, 'openocdPh').value, '/opt/openocd/bin/openocd')
  assert.ok(inputByPh(view.container, 'gdbPh'), 'gdb binding field is rendered')
  view.unmount()
})

// Keeping half-typed paths across the share refresh is verified end to end in a
// real browser (DSH 0.2.1 review); HappyDOM does not route edits of this
// controlled input to React's onChange, so it is not asserted here.
test('the share toggle saves only share, never the path fields', async () => {
  const { view, load, calls } = mount()
  await load()
  const master = /** @type {HTMLElement} */ (view.container.querySelector('#share-master'))
  await act(async () => {
    fireEvent.click(master)
  })
  await waitFor(() => assert.ok(calls.some(([p]) => p === '/dsh-vision-bench/bindings')))
  const body = calls.find(([p]) => p === '/dsh-vision-bench/bindings')?.[1]
  assert.equal('bindings' in body, false)
  assert.equal(body.share.enabled, true)
  view.unmount()
})

test('turning Agent write approval off asks first and posts only the policy', async () => {
  const declined = mount({ confirm: false })
  await declined.load()
  await act(async () => {
    fireEvent.click(/** @type {HTMLElement} */ (declined.view.container.querySelector('#agent-write-approval')))
  })
  assert.equal(declined.calls.some(([p]) => p === '/dsh-vision-bench/bindings'), false)
  declined.view.unmount()

  const { view, load, calls } = mount({ confirm: true })
  await load()
  await act(async () => {
    fireEvent.click(/** @type {HTMLElement} */ (view.container.querySelector('#agent-write-approval')))
  })
  await waitFor(() => assert.ok(calls.some(([p]) => p === '/dsh-vision-bench/bindings')))
  const body = calls.find(([p]) => p === '/dsh-vision-bench/bindings')?.[1]
  assert.deepEqual(body, { agentPolicy: { agentWriteApproval: false } })
  await waitFor(() => assert.match(view.container.textContent || '', /agentApprovalOffWarning/))
  view.unmount()
})

test('outside a session the share switches are disabled and say where to set them', async () => {
  const post = async (/** @type {string} */ path) =>
    path === '/dsh-vision-bench/state' ? { ok: true, bindings: STORED, globalShare: { enabled: false } } : { ok: true }
  const SettingsPage = createSettingsPage(React, (/** @type {string} */ k) => k, post, { getScope: () => ({ cwd: '', sessionId: '' }) })
  const view = render(React.createElement(SettingsPage))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  const master = /** @type {HTMLButtonElement} */ (view.container.querySelector('#share-master'))
  assert.equal(master.disabled, true)
  assert.match(view.container.textContent || '', /shareNeedSession/)
  view.unmount()
})
