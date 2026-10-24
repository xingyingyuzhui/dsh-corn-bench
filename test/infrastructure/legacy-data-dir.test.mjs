import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LEGACY_DATA_DIR } from '../../src/shared/legacy-names.mjs'
import { _resetLegacyDataDirCheck, migrateLegacyDataDir } from '../../src/infrastructure/store/legacy-data-dir.mjs'

function home(t) {
  const dir = mkdtempSync(join(tmpdir(), 'corn-legacy-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  _resetLegacyDataDirCheck()
  return dir
}

test('the old data directory moves to corn-bench with its contents', (t) => {
  const h = home(t)
  mkdirSync(join(h, LEGACY_DATA_DIR, 'workspaces'), { recursive: true })
  writeFileSync(join(h, LEGACY_DATA_DIR, 'bindings.json'), '{"uv4":"C:/Keil/UV4.exe"}')
  const out = migrateLegacyDataDir(h)
  assert.equal(out.migrated, true)
  assert.equal(existsSync(join(h, LEGACY_DATA_DIR)), false)
  assert.equal(readFileSync(join(h, 'corn-bench', 'bindings.json'), 'utf8'), '{"uv4":"C:/Keil/UV4.exe"}')
  assert.equal(existsSync(join(h, 'corn-bench', 'workspaces')), true)
})

test('an existing corn-bench directory is never overwritten', (t) => {
  const h = home(t)
  mkdirSync(join(h, LEGACY_DATA_DIR), { recursive: true })
  mkdirSync(join(h, 'corn-bench'), { recursive: true })
  writeFileSync(join(h, 'corn-bench', 'bindings.json'), 'new')
  assert.equal(migrateLegacyDataDir(h).migrated, false)
  assert.equal(readFileSync(join(h, 'corn-bench', 'bindings.json'), 'utf8'), 'new')
  assert.equal(existsSync(join(h, LEGACY_DATA_DIR)), true)
})

test('a fresh home and a repeat call do nothing', (t) => {
  const h = home(t)
  assert.equal(migrateLegacyDataDir(h).migrated, false)
  mkdirSync(join(h, LEGACY_DATA_DIR))
  // Already checked for this home in this process.
  assert.equal(migrateLegacyDataDir(h).migrated, false)
  assert.equal(migrateLegacyDataDir('').migrated, false)
})
