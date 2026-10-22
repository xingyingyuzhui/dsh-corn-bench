// @ts-check
/** Agent write approvals lead both HMI views. */

import assert from 'node:assert/strict'
import test from 'node:test'
import { renderConnectionOverview } from '../../src/ui/hmi/connection-overview.mjs'
import { renderConnectionWorkspace } from '../../src/ui/hmi/connection-workspace.mjs'
import { el } from '../helpers/react-unit.mjs'

test('pending Agent write approvals sit at the top of both HMI views', () => {
  const pendingPanel = el('div', { 'data-panel': 'pending' })
  const ctx = {
    tabBar: el('div', { 'data-panel': 'tabs' }),
    connListPanel: el('div', { 'data-panel': 'conn-list' }),
    deviceCardsPanel: el('div', { 'data-panel': 'devices' }),
    pendingPanel,
    pending: [{ id: 'w1' }],
  }
  const order = (root) => root.children.filter((c) => c && c.props && c.props['data-panel']).map((c) => c.props['data-panel'])
  assert.deepEqual(order(renderConnectionOverview(el, (k) => k, ctx)), ['tabs', 'pending', 'conn-list'])
  assert.deepEqual(order(renderConnectionWorkspace(el, (k) => k, ctx)), ['tabs', 'pending', 'devices'])
})
