// @ts-check
/**
 * Sample provenance for verify and runtime commits: proves which geometry a
 * value was actually captured under. Distinct from layered read eligibility.
 */
import { normalizeConn } from './connection-model.mjs'
import { randomUUID } from 'node:crypto'

/**
 * @param {any} connRow
 * @returns {any[]}
 */
export function connectionEndpointTuple(connRow) {
  const c = normalizeConn(connRow?.conn || connRow)
  if (c.mode === 'tcp') {
    return ['tcp', c.host || '', c.tcpPort, c.sim === true]
  }
  return ['rtu', c.port || '', c.baudrate, c.bytesize, c.parity, c.stopbits, c.sim === true]
}

/**
 * Decode fields that actually affect point_math.decodeValue / transport size.
 * @param {any} point
 */
export function effectiveDecodeTuple(point) {
  return [
    point?.dataType ?? point?.type ?? null,
    point?.length ?? point?.quantity ?? null,
    point?.byteOrder ?? point?.endian ?? null,
    point?.wordOrder ?? null,
  ]
}

/**
 * Structured fingerprint of the capture identity. Shared owners use the shared
 * layer marker (empty session), not the caller's sid.
 *
 * @param {{
 *   layer: string,
 *   ownerSessionId?: string,
 *   point: any,
 *   connection: any,
 *   device: any,
 * }} input
 */
export function sampleFingerprintOf(input) {
  const point = input.point || {}
  const device = input.device || {}
  const layer = String(input.layer || '')
  const owner =
    layer === 'shared' || layer === 'toplevel' ? '' : String(input.ownerSessionId || '')
  return JSON.stringify([
    layer,
    owner,
    String(point.id || ''),
    String(point.connectionId || point.connId || ''),
    String(point.deviceId || ''),
    connectionEndpointTuple(input.connection),
    device.unitId ?? null,
    point.function ?? null,
    point.address ?? null,
    effectiveDecodeTuple(point),
    point.scale ?? null,
    point.offset ?? null,
  ])
}

/** Fresh opaque generation token (Host-allocated, never from the request body). */
export function newSampleGeneration() {
  return randomUUID()
}

/**
 * @param {any} stamp
 * @returns {{ fingerprint: string, generation: string } | null}
 */
export function normalizeSampleIdentity(stamp) {
  if (!stamp || typeof stamp !== 'object') return null
  const fingerprint = typeof stamp.fingerprint === 'string' ? stamp.fingerprint : ''
  const generation = typeof stamp.generation === 'string' ? stamp.generation : ''
  if (!fingerprint || !generation) return null
  return { fingerprint, generation }
}

/**
 * Geometry fields that invalidate a sample when they change.
 * @param {any} a point-like
 * @param {any} b point-like
 * @param {any} [aDev]
 * @param {any} [bDev]
 * @param {any} [aConn]
 * @param {any} [bConn]
 */
export function sampleGeometryChanged(a, b, aDev, bDev, aConn, bConn) {
  if (!a || !b) return true
  if (String(a.connectionId || a.connId || '') !== String(b.connectionId || b.connId || '')) return true
  if (String(a.deviceId || '') !== String(b.deviceId || '')) return true
  if (Number(a.function) !== Number(b.function)) return true
  if (Number(a.address) !== Number(b.address)) return true
  if ((a.scale ?? null) !== (b.scale ?? null)) return true
  if ((a.offset ?? null) !== (b.offset ?? null)) return true
  if (JSON.stringify(effectiveDecodeTuple(a)) !== JSON.stringify(effectiveDecodeTuple(b))) return true
  if ((aDev?.unitId ?? null) !== (bDev?.unitId ?? null)) return true
  if (
    JSON.stringify(connectionEndpointTuple(aConn)) !== JSON.stringify(connectionEndpointTuple(bConn))
  ) {
    return true
  }
  return false
}
