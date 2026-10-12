// @ts-check
/**
 * One layered sample-target resolver. Point identity follows share/private
 * rules; connection and device are taken from that point's own effective
 * view, never from a global bare-id map.
 */
import { isCategoryShared } from './config-scope.mjs'

/**
 * @typedef {'shared' | 'private' | 'toplevel'} SampleLayer
 * @typedef {{
 *   layer: SampleLayer,
 *   sessionId: string,
 *   connectionId: string,
 *   deviceId: string,
 *   pointId: string,
 *   function: number,
 *   address: number,
 * }} PointIdentity
 * @typedef {{
 *   kind: 'missing',
 * }} MissingTarget
 * @typedef {{
 *   kind: 'ambiguous',
 *   identities: PointIdentity[],
 * }} AmbiguousTarget
 * @typedef {{
 *   kind: 'unique',
 *   point: any,
 *   connection: any,
 *   device: any,
 *   layer: SampleLayer,
 *   ownerSessionId: string,
 *   identities: PointIdentity[],
 * }} UniqueTarget
 * @typedef {MissingTarget | AmbiguousTarget | UniqueTarget} SampleTarget
 */

/**
 * @param {any} p
 * @param {SampleLayer} layer
 * @param {string} sessionId
 * @returns {PointIdentity}
 */
function toPointIdentity(p, layer, sessionId) {
  return {
    layer,
    sessionId,
    connectionId: String(p?.connectionId || p?.connId || ''),
    deviceId: String(p?.deviceId || ''),
    pointId: String(p?.id || ''),
    function: Number(p?.function) || 0,
    address: Number(p?.address) || 0,
  }
}

/**
 * @param {PointIdentity} a
 * @param {PointIdentity} b
 */
function sameGeometry(a, b) {
  return (
    a.connectionId === b.connectionId &&
    a.deviceId === b.deviceId &&
    a.pointId === b.pointId &&
    a.function === b.function &&
    a.address === b.address
  )
}

/**
 * @param {PointIdentity} a
 * @param {PointIdentity} b
 */
function sameObject(a, b) {
  return a.layer === b.layer && a.sessionId === b.sessionId && sameGeometry(a, b)
}

/**
 * Effective identity rows for one pointId.
 * When points are shared, the shared definition owns the slot.
 *
 * @param {any} modbus
 * @param {string} pointId
 * @returns {{ effective: PointIdentity[], raw: PointIdentity[] }}
 */
export function identitiesForPoint(modbus, pointId) {
  const scMap = modbus?.sessionConfigs && typeof modbus.sessionConfigs === 'object' ? modbus.sessionConfigs : {}
  const pointsShared = isCategoryShared(modbus?.share, 'points')
  const partitioned = Object.keys(scMap).length > 0
  /** @type {PointIdentity[]} */
  const raw = []

  for (const p of Array.isArray(modbus?.points) ? modbus.points : []) {
    if (!p || String(p.id) !== pointId) continue
    raw.push(toPointIdentity(p, pointsShared ? 'shared' : 'toplevel', ''))
  }
  for (const sid of Object.keys(scMap)) {
    const sc = scMap[sid]
    if (!sc || typeof sc !== 'object') continue
    for (const p of Array.isArray(sc.points) ? sc.points : []) {
      if (!p || String(p.id) !== pointId) continue
      raw.push(toPointIdentity(p, 'private', sid))
    }
  }

  /** @type {PointIdentity[]} */
  const effective = []
  const sharedRows = raw.filter((r) => r.layer === 'shared')
  const privateRows = raw.filter((r) => r.layer === 'private')
  const topRows = raw.filter((r) => r.layer === 'toplevel')

  for (const s of sharedRows) {
    if (!effective.some((e) => sameObject(e, s) || (e.layer === 'shared' && sameGeometry(e, s)))) {
      effective.push(s)
    }
  }

  if (pointsShared) {
    if (sharedRows.length) return { effective, raw }
  }

  if (!partitioned) {
    for (const t of topRows) {
      if (!effective.some((e) => sameObject(e, t))) effective.push(t)
    }
    return { effective, raw }
  }

  for (const pr of privateRows) {
    if (!effective.some((e) => sameObject(e, pr))) effective.push(pr)
  }
  if (!privateRows.length) {
    for (const t of topRows) {
      if (!effective.some((e) => sameObject(e, t))) effective.push(t)
    }
  }
  return { effective, raw }
}

/**
 * More than one effective owner stays ambiguous, including a third owner.
 * @param {PointIdentity[]} effective
 * @returns {boolean}
 */
export function effectiveRowsConflict(effective) {
  if (effective.length <= 1) return false
  const shared = effective.filter((r) => r.layer === 'shared')
  const others = effective.filter((r) => r.layer !== 'shared')
  if (shared.length > 1) {
    const geoms = new Set(shared.map((r) => JSON.stringify([r.connectionId, r.deviceId, r.function, r.address])))
    if (geoms.size > 1) return true
    if (others.length) return true
  }
  if (others.length > 1) return true
  if (shared.length && others.length) return true
  return false
}

/**
 * @param {any} modbus
 * @returns {Set<string>}
 */
function configuredPointIds(modbus) {
  /** @type {Set<string>} */
  const ids = new Set()
  for (const p of Array.isArray(modbus?.points) ? modbus.points : []) {
    if (p?.id) ids.add(String(p.id))
  }
  const sessions = modbus?.sessionConfigs && typeof modbus.sessionConfigs === 'object' ? modbus.sessionConfigs : {}
  for (const cfg of Object.values(sessions)) {
    for (const p of Array.isArray(/** @type {any} */ (cfg)?.points) ? /** @type {any} */ (cfg).points : []) {
      if (p?.id) ids.add(String(p.id))
    }
  }
  return ids
}

/**
 * @param {any} modbus
 * @param {PointIdentity} identity
 * @returns {any}
 */
function pointRow(modbus, identity) {
  const list =
    identity.layer === 'private'
      ? modbus?.sessionConfigs?.[identity.sessionId]?.points
      : modbus?.points
  return (Array.isArray(list) ? list : []).find((/** @type {any} */ p) => p && String(p.id) === identity.pointId) || null
}

/**
 * Connections and devices that belong to this point's effective view.
 * The connections share flag also owns devices.
 * @param {any} modbus
 * @param {PointIdentity} identity
 */
function entityView(modbus, identity) {
  const connectionsShared = isCategoryShared(modbus?.share, 'connections')
  if (identity.layer === 'private' && !connectionsShared) {
    const sc = modbus?.sessionConfigs?.[identity.sessionId] || {}
    return {
      connections: Array.isArray(sc.connections) ? sc.connections : [],
      devices: Array.isArray(sc.devices) ? sc.devices : [],
    }
  }
  return {
    connections: Array.isArray(modbus?.connections) ? modbus.connections : [],
    devices: Array.isArray(modbus?.devices) ? modbus.devices : [],
  }
}

/**
 * @param {any} modbus
 * @param {string} pointId
 * @returns {SampleTarget}
 */
export function resolveEffectiveSampleTarget(modbus, pointId) {
  const pid = String(pointId || '')
  if (!pid) return { kind: 'missing' }
  const { effective } = identitiesForPoint(modbus, pid)
  if (!effective.length) return { kind: 'missing' }
  if (effectiveRowsConflict(effective)) return { kind: 'ambiguous', identities: effective }
  const identity = effective[0]
  if (!identity) return { kind: 'missing' }
  const point = pointRow(modbus, identity)
  if (!point) return { kind: 'missing' }
  const view = entityView(modbus, identity)
  const connection = view.connections.find((/** @type {any} */ c) => c && String(c.id) === identity.connectionId) || null
  const devices = view.devices.filter(
    (/** @type {any} */ d) =>
      d &&
      String(d.id) === identity.deviceId &&
      String(d.connectionId || '') === identity.connectionId,
  )
  if (devices.length > 1) return { kind: 'ambiguous', identities: effective }
  const ownerSessionId = identity.layer === 'private' ? identity.sessionId : ''
  return {
    kind: 'unique',
    point,
    connection,
    device: devices[0] || null,
    layer: identity.layer,
    ownerSessionId,
    identities: effective,
  }
}

/**
 * Every configured point id, including ambiguous ones. Ambiguous is not deleted.
 * @param {any} modbus
 * @returns {Map<string, SampleTarget>}
 */
export function buildEffectiveSampleTargetIndex(modbus) {
  /** @type {Map<string, SampleTarget>} */
  const out = new Map()
  for (const pid of configuredPointIds(modbus)) {
    out.set(pid, resolveEffectiveSampleTarget(modbus, pid))
  }
  return out
}
