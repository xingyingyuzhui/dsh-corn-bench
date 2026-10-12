// @ts-check
/**
 * Runtime identity pre-check for poll batches.
 *
 * Three distinct sets:
 *  1. RAW config rows (shared + each private layer) — discover duplicates, never pre-union.
 *  2. EFFECTIVE identities — after share/projection semantics; a private row that
 *     is shadowed by the shared definition of the same pointId is NOT effective.
 *  3. THIS read set — executable targets' points only.
 *
 * Connection ownership unique does NOT imply a unique runtime slot: values,
 * trend, alarmState and commit merge by pointId. Two different EFFECTIVE private
 * definitions writing the same pointId clobber each other, so the batch is
 * rejected BEFORE any transport / frame / runtime commit.
 *
 * Explicit sessionId resolves target ownership — it cannot repair a shared
 * runtime key collision this round (no key migration).
 */
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import {
  effectiveRowsConflict,
  identitiesForPoint,
} from '../../domain/modbus/effective-sample-target.mjs'

export { effectiveRowsConflict, identitiesForPoint }

/**
 * @typedef {{
 *   layer: 'shared' | 'private' | 'toplevel',
 *   sessionId: string,
 *   connectionId: string,
 *   deviceId: string,
 *   pointId: string,
 *   function: number,
 *   address: number,
 * }} PointIdentity
 */

/**
 * @typedef {{
 *   entityType: 'point' | 'device' | 'connection',
 *   entityId: string,
 *   owners: string[],
 *   connectionIds: string[],
 * }} PollRuntimeConflict
 */

/**
 * @param {PointIdentity[]} rows
 * @returns {PollRuntimeConflict}
 */
function conflictFromRows(rows) {
  return {
    entityType: 'point',
    entityId: rows[0]?.pointId || '',
    owners: [...new Set(rows.map((r) => (r.layer === 'private' ? r.sessionId || r.layer : r.layer)))],
    connectionIds: [...new Set(rows.map((r) => r.connectionId).filter(Boolean))],
  }
}

/**
 * Validate runtime point identities for the points this batch will actually read.
 * Unrelated conflicting pointIds do not block the call.
 *
 * @param {any} workspace
 * @param {Array<{ connectionId: string, sourceSessionId: string, points: any[] }>} readTargets
 * @returns {{ ok: true } | { ok: false, errorCode: string, reason: string, error: string, conflicts: PollRuntimeConflict[] }}
 */
export function validatePollRuntimeIdentities(workspace, readTargets) {
  const modbus = workspace?.modbus || {}
  /** @type {PollRuntimeConflict[]} */
  const conflicts = []

  /** Point ids this batch will read. */
  /** @type {Set<string>} */
  const readPointIds = new Set()
  for (const t of readTargets || []) {
    for (const p of Array.isArray(t.points) ? t.points : []) {
      if (p?.id) readPointIds.add(String(p.id))
    }
  }

  // Batch-internal duplicates: same pointId prepared for two connections/sessions.
  /** @type {Map<string, Set<string>>} */
  const batchOwnersByPoint = new Map()
  for (const t of readTargets || []) {
    for (const p of Array.isArray(t.points) ? t.points : []) {
      if (!p?.id) continue
      const pid = String(p.id)
      const key = `${t.sourceSessionId || '__shared__'}|${t.connectionId}`
      const set = batchOwnersByPoint.get(pid) || new Set()
      set.add(key)
      batchOwnersByPoint.set(pid, set)
    }
  }
  for (const [pid, keys] of batchOwnersByPoint) {
    if (keys.size > 1) {
      conflicts.push({
        entityType: 'point',
        entityId: pid,
        owners: [...keys].map((k) => k.split('|')[0]),
        connectionIds: [...keys].map((k) => k.split('|')[1]),
      })
    }
  }

  // Cross-layer definition conflicts for points this batch touches.
  for (const pid of readPointIds) {
    if (conflicts.some((c) => c.entityType === 'point' && c.entityId === pid)) continue
    const { effective } = identitiesForPoint(modbus, pid)
    if (!effectiveRowsConflict(effective)) continue
    conflicts.push(conflictFromRows(effective))
  }

  if (conflicts.length) {
    const detail = conflicts
      .map((c) => `${c.entityType}:${c.entityId}(${c.owners.join(',')}/${c.connectionIds.join(',')})`)
      .join('；')
    return {
      ok: false,
      errorCode: ERROR_CODES.AMBIGUOUS_OWNER,
      reason: 'ambiguous-owner',
      error: `运行态点位身份冲突，需更换冲突点位 ID：${detail}`,
      conflicts,
    }
  }
  return { ok: true }
}

/**
 * Thin read-only wrapper for query/list value isolation.
 * Same effective-identity rules as poll — does not change poll allow/deny.
 *
 * @param {any} modbus layered workspace modbus (all owners)
 * @param {string} pointId
 * @returns {{ kind: 'unique' | 'ambiguous' | 'missing', identities: PointIdentity[] }}
 */
export function resolveEffectivePointIdentity(modbus, pointId) {
  const { effective } = identitiesForPoint(modbus, pointId)
  if (!effective.length) return { kind: 'missing', identities: [] }
  if (effectiveRowsConflict(effective)) return { kind: 'ambiguous', identities: effective }
  return { kind: 'unique', identities: effective }
}
