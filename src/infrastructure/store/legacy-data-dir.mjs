// @ts-check
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { LEGACY_DATA_DIR } from '../../shared/legacy-names.mjs'

const checked = new Set()

/**
 * Move `$DSH_HOME/<legacy>` to `$DSH_HOME/corn-bench` once, so bindings,
 * workspaces, logs and the Agent policy survive the rename. A home that
 * already has corn-bench is left alone: the new tree wins and the old one
 * stays on disk untouched.
 *
 * @param {string} home
 * @returns {{ migrated: boolean, from?: string, to?: string, error?: string }}
 */
export function migrateLegacyDataDir(home) {
  if (!home || checked.has(home)) return { migrated: false }
  checked.add(home)
  const from = join(home, LEGACY_DATA_DIR)
  const to = join(home, 'corn-bench')
  if (!existsSync(from) || existsSync(to)) return { migrated: false }
  try {
    renameSync(from, to)
    return { migrated: true, from, to }
  } catch (e) {
    // Leave the old tree in place; the plugin starts on an empty corn-bench.
    checked.delete(home)
    return { migrated: false, from, to, error: String((e && /** @type {any} */ (e).message) || e) }
  }
}

/** Test hook: forget which homes were checked. */
export function _resetLegacyDataDirCheck() {
  checked.clear()
}
