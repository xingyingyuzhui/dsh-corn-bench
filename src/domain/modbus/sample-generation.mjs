// @ts-check
/**
 * Sample-generation tokens. Pure helpers — callers supply the effective point
 * index built from layered identity rules.
 */
import {
  newSampleGeneration,
  sampleFingerprintOf,
  sampleGeometryChanged,
} from './point-sample-identity.mjs'

/**
 * @typedef {import('./effective-sample-target.mjs').SampleTarget} SampleTarget
 */

/**
 * @typedef {{
 *   point: any,
 *   layer: string,
 *   ownerSessionId: string,
 *   connection: any,
 *   device: any,
 * }} EffectivePointEntry
 */

/**
 * Point ids present in any layer (top-level or any sessionConfigs entry).
 * Ambiguous dual-private ids are included even when the effective index drops them.
 *
 * @param {any} modbus
 * @returns {Set<string>}
 */
export function collectConfiguredPointIds(modbus) {
  /** @type {Set<string>} */
  const ids = new Set()
  const remember = (/** @type {any[]} */ points) => {
    for (const p of Array.isArray(points) ? points : []) {
      if (p?.id) ids.add(String(p.id))
    }
  }
  remember(modbus?.points)
  const sessions = modbus?.sessionConfigs && typeof modbus.sessionConfigs === 'object' ? modbus.sessionConfigs : {}
  for (const cfg of Object.values(sessions)) {
    remember(/** @type {any} */ (cfg)?.points)
  }
  return ids
}

/**
 * Diff previous and next resolutions.
 *
 * Ambiguous and missing targets have no token. A unique point keeps its token
 * only when identity is unchanged. Geometry, owner, or schema rotation mints a
 * new token and does not reuse a candidate token. Session bind (claim fold,
 * same geometry, no previous token) does not invent one. Cold-start tokens
 * already written by `ensureSampleGenerations` are kept when `acceptCandidateTokens`
 * is set or when the identity is unchanged and no previous token exists.
 *
 * Old value rows keep their stamps. Rows are removed only when the point id
 * is gone from every candidate layer.
 *
 * @param {SampleTarget | undefined} target
 * @returns {'missing' | 'ambiguous' | 'unique'}
 */
function resolutionKind(target) {
  if (target?.kind === 'unique' || target?.kind === 'ambiguous') return target.kind
  return 'missing'
}

/**
 * @param {import('./effective-sample-target.mjs').UniqueTarget} prev
 * @param {import('./effective-sample-target.mjs').UniqueTarget} next
 */
function sameUniqueIdentity(prev, next) {
  // Legacy claim folds top-level into the claiming session without a physical change.
  const claimFold =
    prev.layer === 'toplevel' && next.layer === 'private' && !String(prev.ownerSessionId || '')
  if (!claimFold && prev.layer !== next.layer) return false
  if (!claimFold && String(prev.ownerSessionId || '') !== String(next.ownerSessionId || '')) return false
  return !sampleGeometryChanged(prev.point, next.point, prev.device, next.device, prev.connection, next.connection)
}

/**
 * @param {{
 *   prevResolutions: Map<string, SampleTarget>,
 *   nextResolutions: Map<string, SampleTarget>,
 *   prevGenerations: Record<string, string>,
 *   candidateGenerations?: Record<string, string>,
 *   values: any[],
 *   candidatePointIds?: Set<string>,
 *   rotateAll?: boolean,
 *   acceptCandidateTokens?: boolean,
 * }} input
 */
export function diffSampleGenerations(input) {
  const { prevResolutions, nextResolutions, prevGenerations, values } = input
  const candidateGenerations =
    input.candidateGenerations && typeof input.candidateGenerations === 'object' ? input.candidateGenerations : {}
  const candidatePointIds =
    input.candidatePointIds instanceof Set
      ? input.candidatePointIds
      : new Set(nextResolutions.keys())
  const rotateAll = input.rotateAll === true
  const acceptCandidateTokens = input.acceptCandidateTokens === true
  /** @type {Record<string, string>} */
  const nextGens = {}
  /** @type {Set<string>} */
  const changed = new Set()
  /** @type {Set<string>} */
  const ids = new Set([...prevResolutions.keys(), ...nextResolutions.keys(), ...candidatePointIds])

  for (const pid of ids) {
    const prev = prevResolutions.get(pid)
    const next = nextResolutions.get(pid)
    const prevKind = resolutionKind(prev)
    const nextKind = resolutionKind(next)
    const prevGen = prevGenerations[pid]
    const candGen = typeof candidateGenerations[pid] === 'string' ? candidateGenerations[pid] : ''
    if (nextKind !== 'unique' || !next || next.kind !== 'unique') {
      if (prevKind === 'unique' && prevGen) changed.add(pid)
      continue
    }
    if (rotateAll || acceptCandidateTokens) {
      nextGens[pid] = acceptCandidateTokens && candGen ? candGen : newSampleGeneration()
      if (!prevGen || prevGen !== nextGens[pid]) changed.add(pid)
      continue
    }
    const same = prevKind === 'unique' && prev?.kind === 'unique' && sameUniqueIdentity(prev, next)
    if (same && prevGen) {
      nextGens[pid] = prevGen
      continue
    }
    if (same && candGen) {
      nextGens[pid] = candGen
      continue
    }
    if (same) continue
    if (prevKind === 'missing') {
      nextGens[pid] = candGen || newSampleGeneration()
      continue
    }
    nextGens[pid] = newSampleGeneration()
    changed.add(pid)
  }

  const kept = (Array.isArray(values) ? values : []).filter((/** @type {any} */ rec) => {
    if (!rec || typeof rec !== 'object') return false
    const pid = String(rec.pointId || rec.key || '')
    return Boolean(pid) && candidatePointIds.has(pid)
  })

  return {
    sampleGenerations: nextGens,
    values: kept,
    changedPointIds: [...changed],
  }
}

/**
 * @param {EffectivePointEntry} entry
 * @param {string} generation
 */
export function stampForEntry(entry, generation) {
  if (!entry || !generation) return null
  return {
    fingerprint: sampleFingerprintOf({
      layer: entry.layer,
      ownerSessionId: entry.ownerSessionId,
      point: entry.point,
      connection: entry.connection,
      device: entry.device,
    }),
    generation: String(generation),
  }
}

export { newSampleGeneration, sampleFingerprintOf }
