// @ts-check
/** Corn dark styling follows DSH's own theme (body[data-ds-dark-theme]), not the OS. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { checkDark } from '../../src/ui/monitor/visualization/hooks/viz-chart-options.mjs'
import { CSS } from '../../src/ui/styles/index.mjs'

/** @param {{ dshSource?: string, dshDark?: boolean, osDark: boolean }} env @param {() => void} fn */
function withTheme(env, fn) {
  const g = /** @type {any} */ (globalThis)
  const saved = { document: g.document, window: g.window }
  const attrs = (/** @type {Record<string, boolean>} */ on) => ({ hasAttribute: (/** @type {string} */ n) => !!on[n] })
  g.document = {
    documentElement: attrs({ 'data-ds-theme-source': !!env.dshSource }),
    body: attrs({ 'data-ds-dark-theme': !!env.dshDark }),
  }
  g.window = { matchMedia: () => ({ matches: env.osDark }) }
  try {
    fn()
  } finally {
    g.document = saved.document
    g.window = saved.window
  }
}

test('charts read DSH dark/light even when the OS says otherwise', () => {
  withTheme({ dshSource: 'light', dshDark: false, osDark: true }, () => assert.equal(checkDark(), false))
  withTheme({ dshSource: 'dark', dshDark: true, osDark: false }, () => assert.equal(checkDark(), true))
})

test('outside DSH the OS scheme is the fallback', () => {
  withTheme({ osDark: true }, () => assert.equal(checkDark(), true))
  withTheme({ osDark: false }, () => assert.equal(checkDark(), false))
})

test('no stylesheet keys off the OS colour scheme', () => {
  assert.equal(/prefers-color-scheme/.test(CSS), false)
  assert.match(CSS, /\[data-ds-dark-theme\] \.dvb-project\{/)
  assert.match(CSS, /\[data-ds-dark-theme\] \.dvb-setting-switch\{/)
})
