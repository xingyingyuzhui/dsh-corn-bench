// @ts-check
/**
 * Runtime value row helpers (normalize / scatter / filter). Split from
 * point-model so structure-budget stays under the allowlist without raising it.
 */
import { decodeValue, pointIdOf } from './point-math.mjs'

export const MAX_VALUES = 512
export const MAX_VALUES_SAFE = 512

/** @param {any} value @param {string} [fallback] */
const text = (value, fallback = '') => {
  const out = typeof value === 'string' ? value.trim() : ''
  return out || fallback || ''
}

/** @param {any} raw */
export const normalizeValueRec = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {}
  const at = Number(input?.at)
  const rawVal = input && Object.prototype.hasOwnProperty.call(input, 'raw') ? input.raw : null
  const scaled = input && Object.prototype.hasOwnProperty.call(input, 'value') ? input.value : null
  const stamp = input?.sampleIdentity
  const sampleIdentity =
    stamp &&
    typeof stamp === 'object' &&
    typeof stamp.fingerprint === 'string' &&
    stamp.fingerprint &&
    typeof stamp.generation === 'string' &&
    stamp.generation
      ? { fingerprint: stamp.fingerprint, generation: stamp.generation }
      : undefined
  return {
    key: text(input && (input.key || input.pointId), ''),
    pointId: text(input?.pointId || input?.key, ''),
    connectionId: text(input?.connectionId || input?.connId, ''),
    deviceId: text(input?.deviceId, ''),
    raw: rawVal,
    value: scaled,
    ok: input && input.ok === true,
    error: text(input?.error, '').slice(0, 180),
    at: Number.isFinite(at) && at > 0 ? at : 0,
    ...(sampleIdentity ? { sampleIdentity } : {}),
  }
}

/**
 * @param {any[]} values
 * @param {any} rec
 */
const putValueRec = (values, rec) => {
  const idx = values.findIndex((item) => item.key === rec.key)
  if (idx >= 0) values[idx] = rec
  else values.push(rec)
}

/**
 * @param {any[]} values
 * @param {any} point
 * @param {any} raw
 * @param {any} [opts]
 */
export const setPointValue = (values, point, raw, opts = {}) => {
  const list = (Array.isArray(values) ? values : []).map(normalizeValueRec).filter((r) => r.key)
  const hasRaw = raw !== null && raw !== undefined
  putValueRec(
    list,
    normalizeValueRec({
      key: point.id,
      pointId: point.id,
      connectionId: point.connectionId || point.connId || '',
      deviceId: point.deviceId || '',
      raw: hasRaw ? raw : null,
      value: hasRaw ? decodeValue(point, typeof raw === 'boolean' ? (raw ? 1 : 0) : raw) : null,
      ok: opts.ok !== false,
      error: opts.error || '',
      at: opts.at || Date.now(),
      ...(opts.sampleIdentity ? { sampleIdentity: opts.sampleIdentity } : {}),
    }),
  )
  return list.slice(-MAX_VALUES)
}

/**
 * @param {any[]} values
 * @param {any[]} points
 * @param {any} batch
 * @param {any[]} raw
 * @param {boolean} ok
 * @param {string} error
 * @param {number} [at]
 * @param {{ sampleIdentityByPointId?: Record<string, any> }} [stampOpts]
 */
export const scatterBatch = (values, points, batch, raw, ok, error, at = Date.now(), stampOpts = {}) => {
  const list = (Array.isArray(values) ? values : []).map(normalizeValueRec).filter((r) => r.key)
  const batchFc = batch ? (batch.fc !== undefined ? batch.fc : batch.function) : undefined
  const batchCid = batch ? String(batch.connectionId || batch.connId || '') : ''
  const batchDid = batch ? String(batch.deviceId || '') : ''
  const stamps = stampOpts.sampleIdentityByPointId || null
  for (const rawPt of Array.isArray(points) ? points : []) {
    if (!rawPt || typeof rawPt !== 'object') continue
    const fn = Number(rawPt.function)
    const addr = Number(rawPt.address)
    if (fn !== batchFc) continue
    if (!Number.isFinite(addr) || addr < batch.address || addr >= batch.address + batch.count) continue
    if (batchCid && String(rawPt.connectionId || rawPt.connId || '') !== batchCid) continue
    if (batchDid && String(rawPt.deviceId || '') !== batchDid) continue
    const id = String(rawPt.id || '').trim() || pointIdOf(fn, addr)
    const idx = addr - batch.address
    const has = ok && Array.isArray(raw) && raw[idx] !== undefined
    const rawVal = has ? raw[idx] : null
    const stamp = stamps?.[id] || stamps?.[rawPt.id] || null
    putValueRec(
      list,
      normalizeValueRec({
        key: id,
        pointId: id,
        connectionId: rawPt.connectionId || rawPt.connId || batchCid,
        deviceId: rawPt.deviceId || batchDid,
        raw: rawVal,
        value: has ? decodeValue(rawPt, typeof rawVal === 'boolean' ? (rawVal ? 1 : 0) : rawVal) : null,
        ok: !!ok,
        error: ok ? '' : String(error || ''),
        at,
        ...(stamp ? { sampleIdentity: stamp } : {}),
      }),
    )
  }
  return list.slice(-MAX_VALUES)
}

/**
 * @param {any} list
 * @param {Set<string>} validKeys
 */
export const filterValues = (list, validKeys) => {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const rec = normalizeValueRec(raw)
    if (!rec.key || !validKeys.has(rec.key) || seen.has(rec.key)) continue
    seen.add(rec.key)
    out.push(rec)
    if (out.length >= MAX_VALUES_SAFE) break
  }
  return out
}

/**
 * @param {any} list
 * @param {any[]} points
 */
export const normalizeQualifiedValues = (list, points) => {
  if (!Array.isArray(list)) return []
  const byPoint = new Map()
  for (const p of points || []) byPoint.set(p.id, p)
  const seen = new Set()
  const out = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const pointId = text(raw.pointId || raw.key || raw.id, '')
    if (!pointId || !byPoint.has(pointId) || seen.has(pointId)) continue
    const pt = byPoint.get(pointId)
    const rec = normalizeValueRec({
      ...raw,
      key: pointId,
      pointId,
      connectionId: text(raw.connectionId, '') || pt.connectionId,
      deviceId: text(raw.deviceId, '') || pt.deviceId,
    })
    const enriched = {
      ...rec,
      pointId,
      key: pointId,
      connectionId: rec.connectionId || pt.connectionId,
      deviceId: rec.deviceId || pt.deviceId,
    }
    seen.add(pointId)
    out.push(enriched)
    if (out.length >= MAX_VALUES_SAFE) break
  }
  return out
}
