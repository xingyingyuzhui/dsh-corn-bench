// @ts-check
/**
 * Config-write seam (domain): assign sampleGenerations and drop values whose
 * geometry or owner no longer matches the candidate. Pure — no I/O.
 */
import { isCategoryShared, isScopePartitioned } from './config-scope.mjs'
import {
  collectConfiguredPointIds,
  diffSampleGenerations,
  newSampleGeneration,
  stampForEntry,
} from './sample-generation.mjs'

/**
 * @param {any} modbus
 * @returns {Map<string, import('./sample-generation.mjs').EffectivePointEntry>}
 */
export function buildEffectivePointIndex(modbus) {
  /** @type {Map<string, import('./sample-generation.mjs').EffectivePointEntry>} */
  const out = new Map()
  if (!modbus || typeof modbus !== 'object') return out

  const pointsShared = isCategoryShared(modbus.share, 'points')
  const partitioned = isScopePartitioned(modbus)
  const sessions = modbus.sessionConfigs && typeof modbus.sessionConfigs === 'object' ? modbus.sessionConfigs : {}

  /** @type {Map<string, any>} */
  const byConn = new Map()
  /** @type {Map<string, any>} */
  const byDev = new Map()
  const remember = (/** @type {any[]} */ conns, /** @type {any[]} */ devices) => {
    for (const c of conns || []) if (c?.id) byConn.set(String(c.id), c)
    for (const d of devices || []) if (d?.id) byDev.set(String(d.id), d)
  }
  remember(modbus.connections, modbus.devices)
  for (const cfg of Object.values(sessions)) {
    remember(/** @type {any} */ (cfg)?.connections, /** @type {any} */ (cfg)?.devices)
  }

  /**
   * @param {any} point
   * @param {string} layer
   * @param {string} owner
   */
  const put = (point, layer, owner) => {
    if (!point?.id) return
    const pid = String(point.id)
    const existing = out.get(pid)
    // Shared wins over private backups; first writer otherwise.
    if (existing && existing.layer === 'shared' && layer !== 'shared') return
    if (existing && layer === 'private' && existing.layer === 'private' && existing.ownerSessionId !== owner) {
      // Ambiguous private same id — leave neither as a single trusted slot.
      out.delete(pid)
      return
    }
    if (existing && layer !== 'shared' && existing.layer === 'shared') return
    out.set(pid, {
      point,
      layer,
      ownerSessionId: owner,
      connection: byConn.get(String(point.connectionId || point.connId || '')) || null,
      device: byDev.get(String(point.deviceId || '')) || null,
    })
  }

  for (const p of Array.isArray(modbus.points) ? modbus.points : []) {
    put(p, pointsShared ? 'shared' : 'toplevel', '')
  }
  if (!pointsShared) {
    for (const [sid, cfg] of Object.entries(sessions)) {
      for (const p of Array.isArray(/** @type {any} */ (cfg)?.points) ? /** @type {any} */ (cfg).points : []) {
        put(p, 'private', String(sid))
      }
    }
  } else if (partitioned) {
    // Points shared: private backups are shadowed — already handled by put().
  }
  return out
}

/**
 * @param {any} currentWs
 * @param {any} candidateWs
 */
export function prepareConfigPersistence(currentWs, candidateWs) {
  const currentMb = currentWs?.modbus || {}
  const candidateMb = candidateWs?.modbus || {}
  const prevIndex = buildEffectivePointIndex(currentMb)
  const nextIndex = buildEffectivePointIndex(candidateMb)
  const prevGens =
    currentMb.sampleGenerations && typeof currentMb.sampleGenerations === 'object'
      ? /** @type {Record<string, string>} */ ({ ...currentMb.sampleGenerations })
      : {}
  const candidateGens =
    candidateMb.sampleGenerations && typeof candidateMb.sampleGenerations === 'object'
      ? /** @type {Record<string, string>} */ ({ ...candidateMb.sampleGenerations })
      : {}
  const values = Array.isArray(candidateMb.values)
    ? candidateMb.values
    : Array.isArray(currentMb.values)
      ? currentMb.values
      : []
  const diff = diffSampleGenerations({
    prevIndex,
    nextIndex,
    prevGenerations: prevGens,
    candidateGenerations: candidateGens,
    values,
    candidatePointIds: collectConfiguredPointIds(candidateMb),
  })
  return {
    workspace: {
      ...candidateWs,
      modbus: {
        ...candidateMb,
        sampleGenerations: diff.sampleGenerations,
        values: diff.values,
      },
    },
    changedPointIds: diff.changedPointIds,
  }
}

/**
 * @param {any} workspace
 */
export function ensureSampleGenerations(workspace) {
  const mb = workspace?.modbus || {}
  const index = buildEffectivePointIndex(mb)
  /** @type {Record<string, string>} */
  const gens = {
    ...(mb.sampleGenerations && typeof mb.sampleGenerations === 'object' ? mb.sampleGenerations : {}),
  }
  /** @type {string[]} */
  const initialized = []
  for (const pid of index.keys()) {
    if (!gens[pid]) {
      gens[pid] = newSampleGeneration()
      initialized.push(pid)
    }
  }
  // Drop tokens only when the id is gone from every layer — not when the
  // effective index deletes an ambiguous dual-private slot.
  const configuredIds = collectConfiguredPointIds(mb)
  for (const pid of Object.keys(gens)) {
    if (!configuredIds.has(pid)) delete gens[pid]
  }
  return {
    workspace: { ...workspace, modbus: { ...mb, sampleGenerations: gens } },
    index,
    initialized,
  }
}

/**
 * @param {any} layeredModbus
 * @param {any} point
 */
export function captureSampleIdentity(layeredModbus, point) {
  const ensured = ensureSampleGenerations({ modbus: layeredModbus })
  const mb = ensured.workspace.modbus
  const entry = ensured.index.get(String(point?.id || ''))
  const gen = mb.sampleGenerations?.[String(point?.id || '')]
  if (!entry || !gen) return { stamp: null, modbus: mb, initialized: ensured.initialized }
  return { stamp: stampForEntry(entry, gen), modbus: mb, initialized: ensured.initialized }
}

/**
 * Stamp map for a read/write plan from already-persisted gens.
 * Does NOT allocate tokens — callers must persist ensureSampleGenerations first.
 *
 * @param {any} layeredModbus
 * @param {any[]} points
 * @returns {{ sampleIdentityByPointId: Record<string, { fingerprint: string, generation: string }> }}
 */
export function buildSampleIdentityByPointId(layeredModbus, points) {
  const mb = layeredModbus && typeof layeredModbus === 'object' ? layeredModbus : {}
  const index = buildEffectivePointIndex(mb)
  const gens =
    mb.sampleGenerations && typeof mb.sampleGenerations === 'object'
      ? /** @type {Record<string, string>} */ (mb.sampleGenerations)
      : {}
  /** @type {Record<string, { fingerprint: string, generation: string }>} */
  const sampleIdentityByPointId = {}
  for (const point of Array.isArray(points) ? points : []) {
    const pid = String(point?.id || '')
    if (!pid) continue
    const entry = index.get(pid)
    const gen = gens[pid]
    if (!entry || !gen) continue
    const stamp = stampForEntry(entry, gen)
    if (stamp) sampleIdentityByPointId[pid] = stamp
  }
  return { sampleIdentityByPointId }
}
