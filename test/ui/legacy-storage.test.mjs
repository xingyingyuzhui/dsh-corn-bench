import assert from 'node:assert/strict'
import test from 'node:test'
import { migrateLegacyStorage } from '../../src/ui/common/legacy-storage.mjs'
import { LEGACY_STORAGE_PREFIX } from '../../src/shared/legacy-names.mjs'

function memoryStorage(entries) {
  const map = new Map(Object.entries(entries))
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  }
}

test('old preference keys move to the dsh-corn-bench prefix', () => {
  const s = memoryStorage({
    [LEGACY_STORAGE_PREFIX + 'preserve-nav:enabled']: 'true',
    [LEGACY_STORAGE_PREFIX + 'conn-col-widths']: '{"name":120}',
    unrelated: 'x',
  })
  assert.equal(migrateLegacyStorage(s), 2)
  assert.deepEqual(Object.fromEntries(s.map), {
    unrelated: 'x',
    'dsh-corn-bench:preserve-nav:enabled': 'true',
    'dsh-corn-bench:conn-col-widths': '{"name":120}',
  })
})

test('a value already saved under the new prefix wins', () => {
  const s = memoryStorage({
    [LEGACY_STORAGE_PREFIX + 'preserve-nav:enabled']: 'true',
    'dsh-corn-bench:preserve-nav:enabled': 'false',
  })
  assert.equal(migrateLegacyStorage(s), 0)
  assert.deepEqual(Object.fromEntries(s.map), { 'dsh-corn-bench:preserve-nav:enabled': 'false' })
})

test('missing or throwing storage is ignored', () => {
  assert.equal(migrateLegacyStorage(undefined), 0)
  const broken = {
    length: 1,
    key() {
      throw new Error('denied')
    },
  }
  assert.equal(migrateLegacyStorage(/** @type {any} */ (broken)), 0)
})
