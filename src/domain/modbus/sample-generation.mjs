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
 * Diff current vs candidate effective point maps; bump generations and drop
 * values for invalidated point ids.
 *
 * Missing tokens are NOT invented here on every config write (Host session bind
 * must not rewrite sampleGenerations). Cold-start allocation belongs to
 * `ensureSampleGenerations` on mutating poll/read/write; those gens are kept
 * when present on the candidate.
 *
 * Values are dropped only when geometry/owner invalidated, or the point id is
 * gone from every candidate layer — not merely absent from the single-owner
 * effective index (ambiguous dual-private must keep disk rows for isolation).
 *
 * @param {{
 *   prevIndex: Map<string, EffectivePointEntry>,
 *   nextIndex: Map<string, EffectivePointEntry>,
 *   prevGenerations: Record<string, string>,
 *   candidateGenerations?: Record<string, string>,
 *   values: any[],
 *   candidatePointIds?: Set<string>,
 * }} input
 */
export function diffSampleGenerations(input) {
  const { prevIndex, nextIndex, prevGenerations, values } = input
  const candidateGenerations =
    input.candidateGenerations && typeof input.candidateGenerations === 'object' ? input.candidateGenerations : {}
  const candidatePointIds =
    input.candidatePointIds instanceof Set ? input.candidatePointIds : new Set(nextIndex.keys())
  /** @type {Record<string, string>} */
  const nextGens = {}
  /** @type {Set<string>} */
  const invalidated = new Set()

  for (const [pid, next] of nextIndex) {
    const prev = prevIndex.get(pid)
    const prevGen = prevGenerations[pid]
    if (!prev) {
      // New point: prefer an explicit candidate token, else allocate.
      nextGens[pid] = candidateGenerations[pid] || newSampleGeneration()
      continue
    }
    const geoChanged = sampleGeometryChanged(
      prev.point,
      next.point,
      prev.device,
      next.device,
      prev.connection,
      next.connection,
    )
    // Legacy claim folds top-level → the claiming session's private slot without
    // changing physical geometry. That is not a cross-session owner transfer.
    const claimFold =
      prev.layer === 'toplevel' && next.layer === 'private' && !String(prev.ownerSessionId || '')
    const ownerChanged =
      !claimFold &&
      (prev.layer !== next.layer || String(prev.ownerSessionId || '') !== String(next.ownerSessionId || ''))
    if (!prevGen) {
      if (geoChanged || ownerChanged) {
        nextGens[pid] = newSampleGeneration()
        invalidated.add(pid)
      } else if (candidateGenerations[pid]) {
        // Explicit cold-start init from ensureSampleGenerations — keep display rows.
        nextGens[pid] = candidateGenerations[pid]
      }
      // else: leave uninitialized (e.g. session bind / no-op config write)
      continue
    }
    if (geoChanged || ownerChanged) {
      nextGens[pid] = newSampleGeneration()
      invalidated.add(pid)
    } else {
      nextGens[pid] = prevGen
    }
  }

  // Preserve tokens for ids still configured in any layer but absent from the
  // effective index (ambiguous dual-private), so a later sole owner can resume.
  for (const pid of candidatePointIds) {
    if (nextGens[pid] || nextIndex.has(pid)) continue
    const prevGen = prevGenerations[pid]
    const candGen = candidateGenerations[pid]
    if (prevGen) nextGens[pid] = prevGen
    else if (candGen) nextGens[pid] = candGen
  }

  const kept = (Array.isArray(values) ? values : []).filter((/** @type {any} */ rec) => {
    if (!rec || typeof rec !== 'object') return false
    const pid = String(rec.pointId || rec.key || '')
    if (!pid || !candidatePointIds.has(pid)) return false
    if (invalidated.has(pid)) return false
    return true
  })

  return {
    sampleGenerations: nextGens,
    values: kept,
    changedPointIds: [...invalidated],
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
