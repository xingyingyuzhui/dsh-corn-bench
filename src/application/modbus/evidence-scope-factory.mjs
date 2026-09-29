// @ts-check
/**
 * Build an evidence scope from one loaded layered workspace (no disk I/O).
 * The legacy private claim is applied in memory only.
 */
import { isScopePartitioned, normalizeScopeSessionId } from '../../domain/modbus/config-scope.mjs'
import { normalizeModbus } from '../../domain/modbus/modbus-migration.mjs'
import { claimLegacyPrivate, projectModbusForSession } from './config-scope-service.mjs'

/**
 * @param {{
 *   workspace: any,
 *   sessionId?: string,
 *   cwd: string,
 *   debug?: import('./evidence-scope.mjs').DebugSnapshotResolver | null,
 * }} input
 * @returns {import('./evidence-scope.mjs').EvidenceScope | null} null when the caller has no usable view
 */
export function evidenceScopeFromWorkspace(input) {
  const workspace = input.workspace
  if (!workspace || typeof workspace !== 'object') return null
  const sid = normalizeScopeSessionId(input.sessionId)
  const debug = input.debug || null
  if (!sid) {
    if (isScopePartitioned(workspace.modbus)) return null
    return { workspace, pack: normalizeModbus(workspace.modbus), sessionId: '', cwd: input.cwd, debug }
  }
  const view = { ...workspace, modbus: claimLegacyPrivate(workspace.modbus, sid).modbus }
  return { workspace: view, pack: projectModbusForSession(view.modbus, sid), sessionId: sid, cwd: input.cwd, debug }
}
