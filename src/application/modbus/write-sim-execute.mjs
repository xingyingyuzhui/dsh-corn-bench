// @ts-check
/**
 * Local sim write: exit sim, re-stamp against post-exit geometry, commit values.
 */
import { setPointValue } from '../../domain/modbus/point-model.mjs'
import { pointIdOf } from '../../domain/modbus/point-math.mjs'
import { findPointV3 } from '../../domain/modbus/function-code.mjs'
import { saveSessionModbusPatch } from './workspace-session-view.mjs'
import { capturePlanSampleIdentities } from './sample-identity-producer.mjs'

/**
 * @param {{
 *   home: string,
 *   roomCwd: string,
 *   sessionId: string,
 *   pack: any,
 *   targetCid: string,
 *   targetDid: string,
 *   fn: number,
 *   address: number,
 *   count: number,
 *   writeValues: any[],
 *   writePoints: any[],
 *   targetPointIds: string[],
 *   label: string,
 *   done: (ok: boolean, summary: string, extra?: any) => Promise<any>,
 * }} input
 */
export async function executeSimWrite(input) {
  const {
    home,
    roomCwd,
    sessionId,
    pack,
    targetCid,
    targetDid,
    fn,
    address,
    count,
    writeValues,
    writePoints,
    targetPointIds,
    label,
    done,
  } = input
  // Exit sim first (endpoint fingerprint includes sim). Stamping before the flip
  // would be invalidated by prepareConfigPersistence and rejected at commit.
  // Snapshot sibling rows — connection-wide sim flip invalidates every point on
  // this endpoint; re-stamp survivors so multi-device writes keep prior locals.
  const priorValues = Array.isArray(pack.values) ? pack.values.slice() : []
  const nextConns = pack.connections.map((/** @type {any} */ c) =>
    c.id === targetCid ? { ...c, conn: { ...c.conn, sim: false } } : c,
  )
  const saved = await saveSessionModbusPatch(home, roomCwd, sessionId, {
    modbus: { connections: nextConns, version: 3 },
  })
  if (saved && saved.ok === false) {
    return done(false, saved.error || '仿真写入保存失败', { errorCode: saved.errorCode })
  }
  const postMb = saved.workspace?.modbus || saved.view || pack
  const restampPoints = [
    ...writePoints,
    ...pack.points.filter((/** @type {any} */ p) => {
      if (!p?.id || targetPointIds.includes(p.id)) return false
      return priorValues.some((/** @type {any} */ rec) => String(rec?.pointId || rec?.key || '') === String(p.id))
    }),
  ]
  const stamped = await capturePlanSampleIdentities(home, roomCwd, postMb, restampPoints)
  const sampleIdentityByPointId = stamped.sampleIdentityByPointId || {}
  const at = Date.now()
  let vals = Array.isArray(saved.workspace?.modbus?.values) ? saved.workspace.modbus.values : []
  for (const rec of priorValues) {
    const pid = String(rec?.pointId || rec?.key || '')
    if (!pid || targetPointIds.includes(pid)) continue
    const point = pack.points.find((/** @type {any} */ p) => p && p.id === pid)
    if (!point) continue
    const sampleIdentity = sampleIdentityByPointId[pid] || null
    vals = setPointValue(vals, point, rec.raw, {
      ok: rec.ok !== false,
      error: rec.error || '',
      at: Number(rec.at) > 0 ? Number(rec.at) : at,
      ...(sampleIdentity ? { sampleIdentity } : {}),
    })
  }
  for (let i = 0; i < count; i++) {
    const addr = address + i
    const point = findPointV3(pack.points, fn, addr, targetCid, targetDid)
    const target = point || {
      id: pointIdOf(fn, addr),
      function: fn,
      address: addr,
      scale: 1,
      offset: 0,
      connectionId: targetCid,
      deviceId: targetDid,
    }
    const sampleIdentity = sampleIdentityByPointId[String(target.id)] || null
    vals = setPointValue(vals, target, writeValues[i], {
      ok: true,
      at,
      ...(sampleIdentity ? { sampleIdentity } : {}),
    })
  }
  return done(true, `${label}（本地生效，回读一致）`, {
    values: vals,
    simulated: true,
    readback: writeValues.slice(),
    pointValues: vals.filter(
      (/** @type {any} */ rec) =>
        targetPointIds.includes(rec.pointId || rec.key) ||
        priorValues.some((/** @type {any} */ p) => String(p?.pointId || p?.key || '') === String(rec.pointId || rec.key || '')),
    ),
  })
}
