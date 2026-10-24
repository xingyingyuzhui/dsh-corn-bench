// @ts-check
import { LEGACY_STORAGE_PREFIX } from '../../shared/legacy-names.mjs'

const PREFIX = 'dsh-corn-bench:'

/**
 * Copy UI preferences saved under the old key prefix to the new one, then
 * drop the old keys. Keys that already exist under the new prefix win.
 *
 * @param {Storage | undefined | null} storage
 * @returns {number} keys moved
 */
export function migrateLegacyStorage(storage) {
  if (!storage || typeof storage.key !== 'function') return 0
  let moved = 0
  try {
    const old = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key && key.startsWith(LEGACY_STORAGE_PREFIX)) old.push(key)
    }
    for (const key of old) {
      const next = PREFIX + key.slice(LEGACY_STORAGE_PREFIX.length)
      const value = storage.getItem(key)
      if (storage.getItem(next) == null && value != null) {
        storage.setItem(next, value)
        moved++
      }
      storage.removeItem(key)
    }
  } catch {
    // Storage can throw (quota, privacy mode); preferences are optional.
  }
  return moved
}
