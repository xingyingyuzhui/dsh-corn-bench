// @ts-check
/**
 * Config-write seam (domain): assign sampleGenerations. Old value rows keep
 * their stamps. Pure — no I/O. Schema v2 rotation is performed by
 * ensureSampleGenerations; this seam keeps those tokens instead of minting
 * a second set. Ordinary saves and session bind do not start that migration.
 */
import { buildEffectiveSampleTargetIndex } from './effective-sample-target.mjs'
import {
  collectConfiguredPointIds,
  diffSampleGenerations,
  newSampleGeneration,
  stampForEntry,
} from './sample-generation.mjs'

/**
 * @param {any} modbus
 * @returns {Map<string, import('./sample-generation.mjs').EffectivePointEntry>}
 */
export function buildEffectivePointIndex(modbus) {
  /** @type {Map<string, import('./sample-generation.mjs').EffectivePointEntry>} */
  const out = new Map()
  if (!modbus || typeof modbus !== 'object') return out
  for (const [pid, target] of buildEffectiveSampleTargetIndex(modbus)) {
    if (target.kind !== 'unique') continue
    out.set(pid, {
      point: target.point,
      layer: target.layer,
      ownerSessionId: target.ownerSessionId,
      connection: target.connection,
      device: target.device,
    })
  }
  return out
}

/**
 * @param {any} currentWs
 * @param {any} candidateWs
 */
export function prepareConfigPersistence(currentWs, candidateWs) {
  const currentMb = currentWs?.modbus || {}
  const candidateMb = candidateWs?.modbus || {}
  const prevResolutions = buildEffectiveSampleTargetIndex(currentMb)
  const nextResolutions = buildEffectiveSampleTargetIndex(candidateMb)
  const prevGens =
    currentMb.sampleGenerations && typeof currentMb.sampleGenerations === 'object'
      ? /** @type {Record<string, string>} */ ({ ...currentMb.sampleGenerations })
      : {}
  const candidateGens =
    candidateMb.sampleGenerations && typeof candidateMb.sampleGenerations === 'object'
      ? /** @type {Record<string, string>} */ ({ ...candidateMb.sampleGenerations })
      : {}
  const values = Array.isArray(candidateMb.values)
    ? candidateMb.values
    : Array.isArray(currentMb.values)
      ? currentMb.values
      : []
  const currentVersion = Number(currentMb.sampleIdentitySchemaVersion)
  const candidateVersion = Number(candidateMb.sampleIdentitySchemaVersion)
  const migrating = currentVersion !== 2 && candidateVersion === 2
  const diff = diffSampleGenerations({
    prevResolutions,
    nextResolutions,
    prevGenerations: prevGens,
    candidateGenerations: candidateGens,
    values,
    candidatePointIds: collectConfiguredPointIds(candidateMb),
    acceptCandidateTokens: migrating,
  })
  /** @type {any} */
  const modbus = {
    ...candidateMb,
    sampleGenerations: diff.sampleGenerations,
    values: diff.values,
  }
  if (migrating || currentVersion === 2 || candidateVersion === 2) modbus.sampleIdentitySchemaVersion = 2
  return {
    workspace: {
      ...candidateWs,
      modbus,
    },
    changedPointIds: diff.changedPointIds,
  }
}

/**
 * @param {any} workspace
 */
export function ensureSampleGenerations(workspace) {
  const mb = workspace?.modbus || {}
  const resolutions = buildEffectiveSampleTargetIndex(mb)
  const index = buildEffectivePointIndex(mb)
  const upgrading = Number(mb.sampleIdentitySchemaVersion) !== 2
  /** @type {Record<string, string>} */
  const prev = mb.sampleGenerations && typeof mb.sampleGenerations === 'object' ? mb.sampleGenerations : {}
  /** @type {Record<string, string>} */
  const gens = {}
  /** @type {string[]} */
  const initialized = []
  for (const [pid, target] of resolutions) {
    if (target.kind !== 'unique') continue
    if (!upgrading && prev[pid]) {
      gens[pid] = prev[pid]
      continue
    }
    gens[pid] = newSampleGeneration()
    initialized.push(pid)
  }
  return {
    workspace: {
      ...workspace,
      modbus: { ...mb, sampleGenerations: gens, sampleIdentitySchemaVersion: 2 },
    },
    index,
    initialized,
  }
}

/**
 * @param {any} layeredModbus
 * @param {any} point
 */
export function captureSampleIdentity(layeredModbus, point) {
  const ensured = ensureSampleGenerations({ modbus: layeredModbus })
  const mb = ensured.workspace.modbus
  const entry = ensured.index.get(String(point?.id || ''))
  const gen = mb.sampleGenerations?.[String(point?.id || '')]
  if (!entry || !gen) return { stamp: null, modbus: mb, initialized: ensured.initialized }
  return { stamp: stampForEntry(entry, gen), modbus: mb, initialized: ensured.initialized }
}

/**
 * Stamp map for a read/write plan from already-persisted gens.
 * Does NOT allocate tokens — callers must persist ensureSampleGenerations first.
 *
 * @param {any} layeredModbus
 * @param {any[]} points
 * @returns {{ sampleIdentityByPointId: Record<string, { fingerprint: string, generation: string }> }}
 */
export function buildSampleIdentityByPointId(layeredModbus, points) {
  const mb = layeredModbus && typeof layeredModbus === 'object' ? layeredModbus : {}
  const index = buildEffectivePointIndex(mb)
  const gens =
    mb.sampleGenerations && typeof mb.sampleGenerations === 'object'
      ? /** @type {Record<string, string>} */ (mb.sampleGenerations)
      : {}
  /** @type {Record<string, { fingerprint: string, generation: string }>} */
  const sampleIdentityByPointId = {}
  for (const point of Array.isArray(points) ? points : []) {
    const pid = String(point?.id || '')
    if (!pid) continue
    const entry = index.get(pid)
    const gen = gens[pid]
    if (!entry || !gen) continue
    const stamp = stampForEntry(entry, gen)
    if (stamp) sampleIdentityByPointId[pid] = stamp
  }
  return { sampleIdentityByPointId }
}
