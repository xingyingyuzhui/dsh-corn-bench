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
 * Diff current vs candidate effective point maps; bump generations and drop
 * values for invalidated point ids.
 *
 * @param {{
 *   prevIndex: Map<string, EffectivePointEntry>,
 *   nextIndex: Map<string, EffectivePointEntry>,
 *   prevGenerations: Record<string, string>,
 *   values: any[],
 * }} input
 */
export function diffSampleGenerations(input) {
  const { prevIndex, nextIndex, prevGenerations, values } = input
  /** @type {Record<string, string>} */
  const nextGens = {}
  /** @type {Set<string>} */
  const invalidated = new Set()

  for (const [pid, next] of nextIndex) {
    const prev = prevIndex.get(pid)
    const prevGen = prevGenerations[pid]
    if (!prev) {
      // New point: allocate a token. No prior runtime slot to invalidate.
      nextGens[pid] = newSampleGeneration()
      continue
    }
    if (!prevGen) {
      // Cold-start / first token only. Keep unstamped rows for display;
      // verify still rejects them until a producer writes a matching stamp.
      nextGens[pid] = newSampleGeneration()
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
    const ownerChanged =
      prev.layer !== next.layer || String(prev.ownerSessionId || '') !== String(next.ownerSessionId || '')
    if (geoChanged || ownerChanged) {
      nextGens[pid] = newSampleGeneration()
      invalidated.add(pid)
    } else {
      nextGens[pid] = prevGen
    }
  }

  const kept = (Array.isArray(values) ? values : []).filter((/** @type {any} */ rec) => {
    if (!rec || typeof rec !== 'object') return false
    const pid = String(rec.pointId || rec.key || '')
    if (!pid || !nextIndex.has(pid)) return false
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
