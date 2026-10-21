// @ts-check
import { isScopePartitioned } from '../../domain/modbus/config-scope.mjs'
import { omitInternalSampleMetadata } from '../../domain/modbus/caller-projection.mjs'
import { projectModbusForSession } from './config-scope-service.mjs'
import { normalizeModbus } from '../../domain/modbus/modbus-migration.mjs'
import {
  filterAlarmStateForSession,
  pointRuntimeVisible,
  visibleUniqueConnectionIds,
} from './agent-runtime-visibility.mjs'
import { focusForView } from './evidence-service.mjs'
import { selectPointQueryValue } from './point-query-value.mjs'

/** Project runtime before removing its identity metadata. Never write this view back.
 * @param {any} layered
 * @param {string} sessionId
 * @returns {any}
 */
export function projectCallerModbus(layered, sessionId) {
  const pack =
    sessionId || isScopePartitioned(layered) ? projectModbusForSession(layered, sessionId) : normalizeModbus(layered)
  const connectionIds = visibleUniqueConnectionIds(layered, sessionId, pack.connections)
  const pointIds = new Set(
    pack.points
      .filter((/** @type {any} */ p) => pointRuntimeVisible(layered, sessionId, p.id).visible)
      .map((/** @type {any} */ p) => p.id),
  )
  const owned = (/** @type {any} */ row) => !row?.sessionId || row.sessionId === sessionId
  const connectionMap = (/** @type {any} */ src) =>
    Object.fromEntries(Object.entries(src || {}).filter(([id]) => connectionIds.has(id)))
  const values = pack.points.flatMap((/** @type {any} */ point) => {
    if (!pointIds.has(point.id)) return []
    const selected = selectPointQueryValue({ workspaceModbus: layered, point, values: layered?.values })
    return selected.record && owned(selected.record) ? [selected.record] : []
  })
  const alarmState = Object.fromEntries(
    Object.entries(filterAlarmStateForSession(layered, sessionId, pack, pack.alarmState)).filter(
      ([id, row]) => owned(row) && owned(layered?.alarmState?.[id]),
    ),
  )
  return omitInternalSampleMetadata({
    ...pack,
    values,
    alarmState,
    trend: Object.fromEntries(Object.entries(pack.trend || {}).filter(([id]) => pointIds.has(id))),
    pollingByConnection: connectionMap(pack.pollingByConnection),
    framesByConnection: Object.fromEntries(
      Object.entries(connectionMap(pack.framesByConnection)).map(([id, frames]) => [
        id,
        Array.isArray(frames) ? frames.filter(owned) : [],
      ]),
    ),
  })
}

/** Session journals are private even when configuration categories are shared.
 * Anonymous, unpartitioned legacy workspaces retain their journal compatibility.
 * @param {any} workspace
 * @param {string} sessionId
 * @param {string} [cwd]
 * @returns {any}
 */
export function projectCallerWorkspace(workspace, sessionId, cwd = '') {
  const scoped = Boolean(sessionId) || isScopePartitioned(workspace.modbus)
  const rows = (/** @type {any} */ src) =>
    (Array.isArray(src) ? src : []).filter(
      (/** @type {any} */ row) => row?.sessionId === sessionId && Boolean(sessionId),
    )
  const modbus = projectCallerModbus(workspace.modbus, sessionId)
  const { evidenceHiddenCount, ...focus } = focusForView({ workspace, pack: modbus, sessionId, cwd })
  return {
    ...workspace,
    modbus,
    focus,
    focusEvidenceHiddenCount: evidenceHiddenCount,
    ...(scoped
      ? {
          tasks: rows(workspace.tasks),
          timeline: rows(workspace.timeline),
          manualRequests: rows(workspace.manualRequests),
          log: rows(workspace.log),
        }
      : {}),
  }
}
