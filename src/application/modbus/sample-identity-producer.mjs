// @ts-check
/**
 * Producer-side sampleIdentity: persist missing generations (config, no
 * configVersion bump), then stamp a read/write plan from disk state.
 */
import { buildEffectiveSampleTargetIndex } from '../../domain/modbus/effective-sample-target.mjs'
import {
  buildSampleIdentityByPointId,
  ensureSampleGenerations,
} from '../../domain/modbus/prepare-config-persistence.mjs'
import { loadWorkspace, workspaceRepository } from '../../infrastructure/store/workspace-store.mjs'
import { noteSampleSchemaMigrate } from './sample-reject-log.mjs'

/**
 * Cold-start / missing-token init on a mutating path. Uses repository `update`
 * (same seam as ensureWorkspaceClaimed): writes config.json, runs
 * prepareConfigPersistence, does NOT bump configVersion. mutateRuntime cannot
 * persist sampleGenerations (applyRuntimeOnly strips them).
 *
 * @param {string} home
 * @param {string} cwd
 * @returns {Promise<{ ok: boolean, workspace: any, initialized: string[], error?: string }>}
 */
export async function ensureSampleGenerationsPersisted(home, cwd) {
  const current = loadWorkspace(home, cwd)
  const upgrading = Number(current?.modbus?.sampleIdentitySchemaVersion) !== 2
  const peek = ensureSampleGenerations(current)
  if (!peek.initialized.length) {
    return { ok: true, workspace: current, initialized: [] }
  }
  const saved = await workspaceRepository(home).update(cwd, null, async (/** @type {any} */ ws) => {
    const ensured = ensureSampleGenerations(ws)
    if (!ensured.initialized.length) return { ok: true, workspace: ws }
    return { ok: true, workspace: ensured.workspace }
  })
  if (!saved || saved.ok === false) {
    return {
      ok: false,
      workspace: current,
      initialized: [],
      error: saved?.error || 'sampleGenerations init failed',
    }
  }
  if (upgrading) {
    let ambiguous = 0
    for (const target of buildEffectiveSampleTargetIndex(current.modbus).values()) {
      if (target.kind === 'ambiguous') ambiguous += 1
    }
    noteSampleSchemaMigrate(Number(current?.modbus?.sampleIdentitySchemaVersion) || 0, peek.initialized.length, ambiguous)
  }
  return { ok: true, workspace: saved.workspace, initialized: peek.initialized }
}

/**
 * Ensure gens on disk, then build stamps for `points` from the layered modbus.
 *
 * @param {string} home
 * @param {string} cwd
 * @param {any} layeredModbus fallback when nothing to init
 * @param {any[]} points
 */
export async function capturePlanSampleIdentities(home, cwd, layeredModbus, points) {
  const ensured = await ensureSampleGenerationsPersisted(home, cwd)
  const mb = ensured.ok ? ensured.workspace?.modbus || layeredModbus : layeredModbus
  const { sampleIdentityByPointId } = buildSampleIdentityByPointId(mb, points)
  return {
    ok: ensured.ok,
    error: ensured.error,
    layeredModbus: mb,
    sampleIdentityByPointId,
    initialized: ensured.initialized,
  }
}

export { buildSampleIdentityByPointId }
