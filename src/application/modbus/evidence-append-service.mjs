// @ts-check
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { workspaceRepository } from '../../infrastructure/store/workspace-store.mjs'
import { requireWorkspaceCwd } from '../../shared/workspace-paths.mjs'
import { hostDebugSnapshotResolver } from './evidence-service.mjs'
import { anonymousLegacyCompat, focusOwnership, ownedBy, resolveEvidenceBatch } from './evidence-scope.mjs'
import { evidenceScopeFromWorkspace } from './evidence-scope-factory.mjs'

const EVIDENCE_KEEP = 20

/**
 * In-memory session view of a workspace loaded inside the write lock.
 * Never persists a legacy claim.
 *
 * @param {any} current layered workspace
 * @param {string} sessionId
 * @param {string} cwd
 * @returns {{ ok: true, scope: import('./evidence-scope.mjs').EvidenceScope } | { ok: false, errorCode: string, error: string }}
 */
export function lockedEvidenceScope(current, sessionId, cwd) {
  const scope = evidenceScopeFromWorkspace({ workspace: current, sessionId, cwd, debug: hostDebugSnapshotResolver() })
  if (!scope) {
    return { ok: false, errorCode: ERROR_CODES.SESSION_REQUIRED, error: '该工作区已按会话隔离，必须携带 sessionId' }
  }
  return { ok: true, scope }
}

/**
 * Who may write through the current focus. Another session's focus is refused;
 * ownerless leftovers are refused for session callers (only an explicit new focus
 * replaces them) and kept for old anonymous callers on unpartitioned workspaces.
 *
 * @param {any} focus
 * @param {import('./evidence-scope.mjs').EvidenceScope} scope
 * @returns {{ ok: true, ownership: string } | { ok: false, errorCode: string, error: string, details?: Record<string, unknown> }}
 */
export function focusWriteAccess(focus, scope) {
  const ownership = focusOwnership(focus, scope.sessionId)
  if (ownership === 'foreign') {
    return { ok: false, errorCode: ERROR_CODES.SESSION_MISMATCH, error: '当前焦点属于其他会话，不能写入' }
  }
  if (ownership === 'unowned-legacy' && !anonymousLegacyCompat(scope)) {
    return {
      ok: false,
      errorCode: ERROR_CODES.SESSION_MISMATCH,
      error: '当前焦点来自旧版本且无法确认归属，请先由本会话重新定位',
      details: { reason: 'UNOWNED_LEGACY_FOCUS' },
    }
  }
  return { ok: true, ownership }
}

/**
 * @param {unknown} evidence
 * @returns {{ ok: true, list: any[] } | { ok: false, errorCode: string, error: string }}
 */
export function evidenceList(evidence) {
  if (Array.isArray(evidence)) return { ok: true, list: evidence }
  if (evidence && typeof evidence === 'object') return { ok: true, list: [evidence] }
  return { ok: false, errorCode: ERROR_CODES.INVALID_FIELD, error: 'evidence 必须是数组或对象' }
}

/**
 * Validate every row against the caller's view, then append in one locked write.
 * Any failure leaves focus and disk untouched.
 *
 * @param {string} home
 * @param {string | undefined} cwd
 * @param {unknown} evidence
 * @param {unknown} [sessionId] trusted origin session only
 */
export const appendEvidence = async (home, cwd, evidence, sessionId = '') => {
  const room = /** @type {{ cwd: string, error?: string }} */ (requireWorkspaceCwd(cwd))
  if (room.error) return { ok: false, error: room.error }
  const parsed = evidenceList(evidence)
  if (!parsed.ok) return parsed
  if (!parsed.list.length) return { ok: false, error: '缺少 evidence', errorCode: ERROR_CODES.TARGET_REQUIRED }
  const sid = typeof sessionId === 'string' ? sessionId.trim() : ''
  const saved = await workspaceRepository(home).updateRuntime(room.cwd, async (/** @type {any} */ current) => {
    const built = lockedEvidenceScope(current, sid, room.cwd)
    if (!built.ok) return built
    const access = focusWriteAccess(current.focus, built.scope)
    if (!access.ok) return access
    const batch = resolveEvidenceBatch(built.scope, parsed.list)
    if (!batch.ok) return batch
    const focus = current.focus && typeof current.focus === 'object' ? current.focus : {}
    const prevRows = Array.isArray(focus.evidence) ? focus.evidence : []
    return {
      ok: true,
      workspace: {
        ...current,
        focus: {
          ...focus,
          sessionId: String(focus.sessionId || '').trim() || sid,
          evidence: [...prevRows, ...batch.rows].slice(-EVIDENCE_KEEP),
        },
      },
    }
  })
  if (!saved || saved.ok === false) {
    return {
      ok: false,
      error: saved?.error || '证据保存失败',
      errorCode: saved?.errorCode,
      ...(saved?.details ? { details: saved.details } : {}),
    }
  }
  const rows = Array.isArray(saved.workspace?.focus?.evidence) ? saved.workspace.focus.evidence : []
  return { ok: true, evidence: rows.filter((/** @type {any} */ r) => ownedBy(r, sid)) }
}
