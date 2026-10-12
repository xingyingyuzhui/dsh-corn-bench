// @ts-check
/**
 * Caller-facing workspace projection. Internal sample tokens stay on disk
 * and in Host services; they do not leave through RPC or Agent output.
 */

/**
 * @param {any} modbus
 * @returns {any}
 */
export function omitInternalSampleMetadata(modbus) {
  if (!modbus || typeof modbus !== 'object') return modbus
  const next = { ...modbus }
  delete next.sampleGenerations
  delete next.sampleIdentitySchemaVersion
  delete next.sessionConfigs
  if (Array.isArray(next.values)) {
    next.values = next.values.map((/** @type {any} */ row) => {
      if (!row || typeof row !== 'object') return row
      const copy = { ...row }
      delete copy.sampleIdentity
      return copy
    })
  }
  return next
}

/**
 * @param {any} row
 * @returns {any}
 */
export function projectValueRowForCaller(row) {
  if (!row || typeof row !== 'object') return row
  return {
    pointId: row.pointId || row.key || '',
    connectionId: row.connectionId || row.connId || '',
    deviceId: row.deviceId || '',
    value: row.value,
    raw: row.raw,
    ok: row.ok === true,
    error: row.error || '',
    at: row.at,
  }
}

const INTERNAL_SAMPLE_FIELDS = ['sampleGenerations', 'sampleIdentitySchemaVersion']

/**
 * @param {any} modbus
 * @returns {string | null}
 */
export function explicitInternalSampleField(modbus) {
  if (!modbus || typeof modbus !== 'object') return null
  for (const key of INTERNAL_SAMPLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(modbus, key)) return key
  }
  return null
}
