// @ts-check
/** In-memory workspaces with real runtime values for verify tests. */
import { claimWorkspaceSync } from '../../src/application/modbus/workspace-session-view.mjs'
import {
  ensureSampleGenerations,
  buildEffectivePointIndex,
} from '../../src/domain/modbus/prepare-config-persistence.mjs'
import { stampForEntry } from '../../src/domain/modbus/sample-generation.mjs'
import { connection } from '../helpers/workspace-factory.mjs'

/**
 * @param {string} id
 * @param {Record<string, any>} [extra]
 */
export const vpoint = (id, extra = {}) => ({
  id,
  name: id,
  connectionId: 'c1',
  deviceId: 'd1',
  function: 3,
  address: Number(extra.address ?? 0),
  area: 'holdingRegister',
  ...extra,
})

/**
 * A runtime value record with its own timestamp and provenance.
 *
 * @param {string} pointId
 * @param {any} value
 * @param {{
 *   ageMs?: number,
 *   ok?: boolean,
 *   connectionId?: string,
 *   deviceId?: string,
 *   sampleIdentity?: { fingerprint: string, generation: string },
 *   fingerprint?: string,
 *   generation?: string,
 * }} [opts]
 */
export const liveValue = (pointId, value, opts = {}) => {
  const sampleIdentity =
    opts.sampleIdentity ||
    (opts.fingerprint && opts.generation
      ? { fingerprint: opts.fingerprint, generation: opts.generation }
      : null)
  return {
    key: pointId,
    pointId,
    connectionId: opts.connectionId ?? 'c1',
    deviceId: opts.deviceId ?? 'd1',
    raw: typeof value === 'number' ? value : null,
    value,
    ok: opts.ok !== false,
    error: '',
    at: Date.now() - (opts.ageMs ?? 0),
    ...(sampleIdentity ? { sampleIdentity } : {}),
  }
}

/**
 * Assign sampleGenerations for every effective point and stamp each values[]
 * row so the poll cache is trusted by usableReading / resolveVerifyPoint.
 * Cold-start init alone does not stamp historic rows — tests that need a
 * trusted cache must call this (or stamp via liveValue opts) explicitly.
 *
 * When `sessionId` is set, claim the legacy private layer first so fingerprints
 * match what resolveVerifyPoint sees for that caller (toplevel→private).
 *
 * @param {any} workspace
 * @param {{ sessionId?: string }} [opts]
 * @returns {any}
 */
export function stampWorkspace(workspace, opts = {}) {
  const sid = typeof opts.sessionId === 'string' ? opts.sessionId.trim() : ''
  const base = sid ? claimWorkspaceSync(workspace, sid).workspace : workspace
  const ensured = ensureSampleGenerations(base)
  const mb = ensured.workspace.modbus || {}
  const index = ensured.index.size ? ensured.index : buildEffectivePointIndex(mb)
  const gens =
    mb.sampleGenerations && typeof mb.sampleGenerations === 'object' ? mb.sampleGenerations : {}
  const values = (Array.isArray(mb.values) ? mb.values : []).map((/** @type {any} */ rec) => {
    if (!rec || typeof rec !== 'object') return rec
    const pid = String(rec.pointId || rec.key || '')
    const entry = index.get(pid)
    const gen = gens[pid]
    if (!entry || !gen) return rec
    const stamp = stampForEntry(entry, gen)
    return stamp ? { ...rec, sampleIdentity: stamp } : rec
  })
  return {
    ...ensured.workspace,
    modbus: { ...mb, values },
  }
}

/**
 * Unpartitioned single-connection workspace.
 *
 * @param {{
 *   points?: any[],
 *   values?: any[],
 *   alarmState?: Record<string, any>,
 *   pollingByConnection?: Record<string, any>,
 *   alarms?: any[],
 *   sampleGenerations?: Record<string, string>,
 *   stamp?: boolean,
 *   sessionId?: string,
 * }} [parts]
 */
export function flatWorkspace(parts = {}) {
  const ws = {
    modbus: {
      version: 3,
      configVersion: 1,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: parts.points || [],
      values: parts.values || [],
      ...(parts.sampleGenerations ? { sampleGenerations: parts.sampleGenerations } : {}),
      ...(parts.alarmState ? { alarmState: parts.alarmState } : {}),
      ...(parts.pollingByConnection ? { pollingByConnection: parts.pollingByConnection } : {}),
    },
    ...(parts.alarms ? { alarms: parts.alarms } : {}),
  }
  return parts.stamp ? stampWorkspace(ws, { sessionId: parts.sessionId }) : ws
}

/** A point with an effective alarm rule. */
export const alarmPoint = (/** @type {string} */ id, extra = {}) => vpoint(id, { alarmEnabled: true, alarmMax: 100, ...extra })
