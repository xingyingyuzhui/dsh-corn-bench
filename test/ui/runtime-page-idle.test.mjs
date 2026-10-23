// @ts-check
/** Runtime debug page without a debug session: one explanation, no empty panels. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act, render } from '@testing-library/react'
import React from 'react'
import { createRuntimePage } from '../../src/ui/debug/runtime/runtime-page.mjs'
import { useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime()

test('idle runtime page explains how to start instead of showing empty panels', async () => {
  const post = async () => ({ ok: true })
  const RuntimePage = createRuntimePage(React, (/** @type {string} */ k) => k, post)
  const view = render(React.createElement(RuntimePage, { sessionId: 's1', cwd: '/ws' }))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  assert.ok(view.container.querySelector('.dvb-debug-idle'), 'idle explanation is shown')
  assert.equal(view.container.querySelector('.dvb-debug-grid'), null, 'stack/breakpoint/variable panels are hidden')
  assert.match(view.container.textContent || '', /dbgStart/, 'the toolbar start button stays')
  view.unmount()
})
