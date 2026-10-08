// @ts-check
/**
 * `no.alarm` for verify: "no active alarm in the caller session's stored alarm
 * state for its valid sources". It does not claim the device was monitored
 * end to end, and it never triggers acquisition or rewrites alarm state.
 */
import { ALARM_GROUP, COND_ACTIVE } from '../../domain/modbus/alarm-constants.mjs'
import { pointAlarmRuleEnabled } from '../../domain/modbus/alarm-evaluate.mjs'
import { deviceDisabledOf } from '../../domain/modbus/validation.mjs'
import { unavailable, UNAVAILABLE_REASONS } from '../../domain/verify/observation.mjs'
import {
  filterAlarmStateForSession,
  pointRuntimeVisible,
  visibleUniqueConnectionIds,
} from '../modbus/agent-runtime-visibility.mjs'
import { sessionView } from './verify-point-scope.mjs'

/**
 * @typedef {import('../../domain/verify/observation.mjs').UnavailableObservation} UnavailableObservation
 */

/** @param {any} row */
function isActive(row) {
  if (row === true) return true
  if (!row || typeof row !== 'object') return false
  if (row.condition) return row.condition === COND_ACTIVE
  return row.status === 'active' || row.active === true
}

/**
 * One identity per alarm so a row present in both the current and the legacy
 * container counts once.
 *
 * @param {string} id
 * @param {any} row
 */
function alarmIdentity(id, row) {
  const group = String(row?.group || '')
  if (group === ALARM_GROUP.COMM || String(id).startsWith('comm:')) {
    const cid = String(row?.connectionId || (String(id).startsWith('comm:') ? String(id).slice(5) : ''))
    return `comm:${cid}`
  }
  return `point:${String(row?.pointId || id)}`
}

/**
 * Legacy `alarms[]` rows, keyed so the session filter can prove their owner and
 * target; rows it cannot attribute are dropped.
 *
 * @param {any} workspace
 * @returns {Record<string, any>}
 */
function legacyAlarmState(workspace) {
  const rows = [
    ...(Array.isArray(workspace?.alarms) ? workspace.alarms : []),
    ...(Array.isArray(workspace?.modbus?.alarms) ? workspace.modbus.alarms : []),
  ]
  /** @type {Record<string, any>} */
  const out = {}
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const key = String(row.id || row.pointId || '')
    if (key) out[key] = row
  }
  return out
}

/**
 * @param {any} pack
 * @param {any} point
 */
const pointMonitored = (pack, point) =>
  pointAlarmRuleEnabled(point) && !deviceDisabledOf(pack, point.connectionId || point.connId, point.deviceId)

/**
 * Count active alarms visible to the session, or explain why "zero" cannot be
 * claimed. Active alarms are counted regardless of source eligibility (stopping
 * a poll does not recover an alarm).
 *
 * @param {any} workspace layered workspace from one repository load
 * @param {string | undefined} sessionId
 * @param {string | undefined} pointId explicit target, if any
 * @returns {number | UnavailableObservation}
 */
export function countSessionAlarms(workspace, sessionId, pointId) {
  if (!workspace) return unavailable(UNAVAILABLE_REASONS.NO_ALARM_SOURCE, '工作区无告警数据源')
  const view = sessionView(workspace, sessionId)
  if (!view) return unavailable(UNAVAILABLE_REASONS.TARGET_UNAVAILABLE)
  const { layered, pack, sid } = view

  /** @type {Set<string>} */
  const active = new Set()
  for (const src of [workspace.modbus?.alarmState, legacyAlarmState(workspace)]) {
    for (const [id, row] of Object.entries(filterAlarmStateForSession(layered, sid, pack, src))) {
      if (isActive(row)) active.add(alarmIdentity(id, row))
    }
  }

  const pid = String(pointId || '').trim()
  if (pid) {
    const point = (pack.points || []).find((/** @type {any} */ p) => p?.id === pid)
    const vis = pointRuntimeVisible(layered, sid, pid)
    if (vis.reason === 'ambiguous') return unavailable(UNAVAILABLE_REASONS.AMBIGUOUS_OWNER)
    if (!point || !vis.visible) return unavailable(UNAVAILABLE_REASONS.TARGET_UNAVAILABLE)
    if (active.has(`point:${pid}`)) return 1
    if (!pointMonitored(pack, point)) {
      return unavailable(UNAVAILABLE_REASONS.NO_ALARM_SOURCE, `点位 [${pid}] 未启用有效告警规则`)
    }
    return 0
  }

  if (active.size > 0) return active.size

  let sources = 0
  let ambiguous = false
  for (const point of pack.points || []) {
    if (!point?.id || !pointMonitored(pack, point)) continue
    const vis = pointRuntimeVisible(layered, sid, point.id)
    if (vis.reason === 'ambiguous') ambiguous = true
    else if (vis.visible) sources++
  }

  // A connection counts as a comm-alarm source only once it is uniquely owned,
  // enabled, polling, and has a real poll result to judge.
  const visibleConns = visibleUniqueConnectionIds(layered, sid, pack.connections || [])
  const polling = workspace.modbus?.pollingByConnection || {}
  for (const conn of pack.connections || []) {
    const cid = String(conn?.id || '')
    if (!cid || conn.enabled === false) continue
    const st = polling[cid]
    if (!st || st.enabled !== true) continue
    if (!visibleConns.has(cid)) {
      ambiguous = true
      continue
    }
    if (Number(st.lastAt) > 0 && typeof st.lastOk === 'boolean') sources++
  }

  if (ambiguous) return unavailable(UNAVAILABLE_REASONS.AMBIGUOUS_OWNER, '可见告警来源存在归属歧义，不能判定全会话无告警')
  if (!sources) return unavailable(UNAVAILABLE_REASONS.NO_ALARM_SOURCE)
  return 0
}
