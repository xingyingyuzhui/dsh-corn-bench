import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  detectPresetTrack,
  dshPackageRootFromExecPath,
  dshPackageRootFromResources,
  dshSearchPaths,
  readInstalledDshVersion,
} from '../../src/infrastructure/harness/dsh-contract.mjs'

/**
 * @param {string[]} packages `@deepseek-ai/*` package names to materialize
 * @returns {Promise<string>} resolution root (its `node_modules` holds the packages)
 */
async function fixtureRoot(packages) {
  const root = await mkdtemp(join(tmpdir(), 'dvb-track-'))
  for (const name of packages) {
    const dir = join(root, 'node_modules', '@deepseek-ai', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, main: 'index.js' }))
    await writeFile(join(dir, 'index.js'), '')
  }
  return root
}

test('detectPresetTrack distinguishes declarative, legacy, and unknown installs', async () => {
  const declarative = await fixtureRoot(['dsh-agent-preset-registry'])
  const legacy = await fixtureRoot(['dsh-agent-presets'])
  const both = await fixtureRoot(['dsh-agent-preset-registry', 'dsh-agent-presets'])
  const unknown = await mkdtemp(join(tmpdir(), 'dvb-track-'))
  try {
    assert.equal(detectPresetTrack([declarative]), 'declarative')
    assert.equal(detectPresetTrack([legacy]), 'legacy')
    assert.equal(detectPresetTrack([both]), 'legacy')
    assert.equal(detectPresetTrack([unknown]), 'unknown')
  } finally {
    await rm(declarative, { recursive: true, force: true })
    await rm(legacy, { recursive: true, force: true })
    await rm(both, { recursive: true, force: true })
    await rm(unknown, { recursive: true, force: true })
  }
})

test('dsh search paths follow the running Node prefix, including Windows', () => {
  assert.ok(dshSearchPaths().includes(dshPackageRootFromExecPath()))
  assert.equal(
    dshPackageRootFromExecPath('/opt/homebrew/Cellar/node@24/24.18.0/bin/node', 'linux'),
    '/opt/homebrew/Cellar/node@24/24.18.0/lib/node_modules/@deepseek-ai/dsh',
  )
  assert.equal(
    dshPackageRootFromExecPath('C:\\Program Files\\nodejs\\node.exe', 'win32'),
    'C:\\Program Files\\nodejs\\node_modules\\@deepseek-ai\\dsh',
  )
})

test('dshPackageRootFromResources points at the app packaging, and empty input is inert', () => {
  assert.equal(
    dshPackageRootFromResources('/Applications/DeepSeek Harness.app/Contents/Resources'),
    '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh',
  )
  // Outside Electron there is no resourcesPath; the helper must not invent one.
  assert.equal(dshPackageRootFromResources(undefined), '')
  assert.equal(dshPackageRootFromResources(''), '')
})

test('under Electron the app copy of DSH outranks the exec-path guess', async () => {
  // Regression: process.execPath is the application binary under Electron, so the
  // exec-path derivation pointed at `<app>/Contents/lib/node_modules/...`, which the
  // packaging never creates. Resolution then fell through to an unrelated prefix
  // install, and readInstalledDshVersion() reported the wrong DSH with a false
  // "please upgrade the plugin" drift warning.
  const app = await mkdtemp(join(tmpdir(), 'dvb-electron-'))
  const resources = join(app, 'Contents', 'Resources')
  const shipped = join(resources, 'app.asar', 'dsh')
  await mkdir(join(shipped, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
  await writeFile(
    join(shipped, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-rc.2' }),
  )
  const previous = process.resourcesPath
  try {
    Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true, writable: true })
    const paths = dshSearchPaths()
    assert.ok(
      paths.indexOf(dshPackageRootFromResources(resources)) < paths.indexOf(dshPackageRootFromExecPath()),
      'the app copy must be searched before the exec-path derivation',
    )
    assert.equal(readInstalledDshVersion(), '0.2.1-rc.2')
  } finally {
    Object.defineProperty(process, 'resourcesPath', { value: previous, configurable: true, writable: true })
    await rm(app, { recursive: true, force: true })
  }
})
