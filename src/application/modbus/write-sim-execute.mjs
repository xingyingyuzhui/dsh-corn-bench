// @ts-check
/**
 * Local sim write. Stays on the simulated endpoint and updates only the
 * points this write names. Sibling rows keep their existing stamps.
 */
import { setPointValue } from '../../domain/modbus/point-model.mjs'
import { pointIdOf } from '../../domain/modbus/point-math.mjs'
import { findPointV3 } from '../../domain/modbus/function-code.mjs'
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
  const stamped = await capturePlanSampleIdentities(home, roomCwd, pack, writePoints)
  if (!stamped.ok) {
    return done(false, stamped.error || '采样身份保存失败', { errorCode: 'WORKSPACE_WRITE_FAILED' })
  }
  const sampleIdentityByPointId = stamped.sampleIdentityByPointId || {}
  const at = Date.now()
  let vals = Array.isArray(pack.values) ? pack.values.slice() : []
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
      source: 'sim-write',
      simulated: true,
      ...(sampleIdentity ? { sampleIdentity } : {}),
    })
  }
  return done(true, `${label}（本地生效，回读一致）`, {
    values: vals,
    simulated: true,
    readback: writeValues.slice(),
    pointValues: vals.filter((/** @type {any} */ rec) => targetPointIds.includes(rec.pointId || rec.key)),
  })
}
