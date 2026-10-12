// @ts-check
/**
 * Low-frequency sample trust diagnostics. Never prints fingerprints, tokens,
 * register data, or session ids.
 */

const WINDOW_MS = 5000
/** @type {Map<string, number>} */
const lastAt = new Map()

/**
 * @param {string} key
 */
function allow(key) {
  const now = Date.now()
  const prev = lastAt.get(key) || 0
  if (now - prev < WINDOW_MS) return false
  lastAt.set(key, now)
  return true
}

/**
 * @param {string} pointId
 * @param {string} reason
 * @param {boolean} [generationChanged]
 */
export function noteSampleReject(pointId, reason, generationChanged = false) {
  const pid = String(pointId || '')
  const why = String(reason || '')
  if (!allow(`${pid}|${why}`)) return
  console.info(
    JSON.stringify({
      event: 'vision.sample.reject',
      reason: why,
      pointId: pid,
      generationChanged: generationChanged === true,
    }),
  )
}

/**
 * @param {number} fromVersion
 * @param {number} uniqueCount
 * @param {number} ambiguousCount
 */
export function noteSampleSchemaMigrate(fromVersion, uniqueCount, ambiguousCount) {
  if (!allow('schema-migrate')) return
  console.info(
    JSON.stringify({
      event: 'vision.sample.schema-migrate',
      from: Number(fromVersion) || 0,
      to: 2,
      unique: uniqueCount,
      ambiguous: ambiguousCount,
    }),
  )
}
