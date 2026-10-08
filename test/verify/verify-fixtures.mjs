// @ts-check
/** In-memory workspaces with real runtime values for verify tests. */
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
 * @param {{ ageMs?: number, ok?: boolean, connectionId?: string, deviceId?: string }} [opts]
 */
export const liveValue = (pointId, value, opts = {}) => ({
  key: pointId,
  pointId,
  connectionId: opts.connectionId ?? 'c1',
  deviceId: opts.deviceId ?? 'd1',
  raw: typeof value === 'number' ? value : null,
  value,
  ok: opts.ok !== false,
  error: '',
  at: Date.now() - (opts.ageMs ?? 0),
})

/**
 * Unpartitioned single-connection workspace.
 *
 * @param {{ points?: any[], values?: any[], alarmState?: Record<string, any>, pollingByConnection?: Record<string, any>, alarms?: any[] }} [parts]
 */
export function flatWorkspace(parts = {}) {
  return {
    modbus: {
      version: 3,
      configVersion: 1,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: parts.points || [],
      values: parts.values || [],
      ...(parts.alarmState ? { alarmState: parts.alarmState } : {}),
      ...(parts.pollingByConnection ? { pollingByConnection: parts.pollingByConnection } : {}),
    },
    ...(parts.alarms ? { alarms: parts.alarms } : {}),
  }
}

/** A point with an effective alarm rule. */
export const alarmPoint = (/** @type {string} */ id, extra = {}) => vpoint(id, { alarmEnabled: true, alarmMax: 100, ...extra })
