// @ts-check

import { isScopePartitioned, normalizeScopeSessionId } from '../../domain/modbus/config-scope.mjs'
import { VerifyRequestError } from '../../domain/verify/errors.mjs'
import { assertChangedBaselines, assertScenarioBudget, effectiveTimeoutMs } from '../../domain/verify/scenario.mjs'
import { normalizeCwd } from '../../shared/path-normalize.mjs'
import { createVerifyRunRegistry } from './verify-run-registry.mjs'
import { createVerifyService } from './verify-service.mjs'

/**
 * @typedef {{
 *   workspaceCwd: string,
 *   ownerSessionId?: string,
 *   verificationRunId?: string,
 *   scenarioId?: string,
 * }} VerifyRunQuery
 */

const RUN_NOT_VISIBLE = '验证运行不存在或不可见'

/**
 * Creates the VerifyCommandService application service that handles scenario
 * execution, timeouts, cancellation and owner-scoped result tracking.
 *
 * Every run, status and cancel call carries the caller's scope (workspace cwd +
 * owner session). Anonymous callers keep working on unpartitioned workspaces,
 * but only see anonymous runs of the same cwd; once the workspace is
 * partitioned they get SESSION_REQUIRED.
 *
 * @param {{
 *   verifyService?: any,
 *   debugRuntime?: any,
 *   workspaceLoader?: (cwd: string) => any,
 *   telemetryReader?: any,
 *   onJournalEvent?: ((event: any) => Promise<void>) | null,
 *   runRegistry?: { now?: () => number, maxCompleted?: number, completedTtlMs?: number },
 * }} [deps]
 */
export function createVerifyCommandService(deps = {}) {
  const verifyService = deps.verifyService || createVerifyService(deps)
  const workspaceLoader = deps.workspaceLoader || null
  const registry = createVerifyRunRegistry(deps.runRegistry)

  function generateRunId() {
    return `vr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  /** @param {string} cwd */
  function partitioned(cwd) {
    if (!workspaceLoader) return false
    try {
      return isScopePartitioned(workspaceLoader(cwd)?.modbus)
    } catch {
      return true
    }
  }

  /**
   * @param {string | undefined} workspaceCwd
   * @param {string | undefined} ownerSessionId
   * @returns {import('./verify-run-registry.mjs').RunScope}
   */
  function resolveScope(workspaceCwd, ownerSessionId) {
    const cwd = normalizeCwd(workspaceCwd)
    if (!cwd) throw new VerifyRequestError('INVALID_FIELD', '验证请求缺少 cwd', { field: 'cwd', reason: 'REQUIRED' })
    const sid = normalizeScopeSessionId(ownerSessionId)
    if (!sid && partitioned(String(workspaceCwd))) {
      throw new VerifyRequestError('SESSION_REQUIRED', '工作区已按会话分区，验证必须带 sessionId')
    }
    return { cwd, sid }
  }

  /**
   * @param {VerifyRunQuery} query
   */
  function locate(query) {
    const scope = resolveScope(query?.workspaceCwd, query?.ownerSessionId)
    const runId = String(query?.verificationRunId || '').trim()
    const scenarioId = String(query?.scenarioId || '').trim()
    if (!runId && !scenarioId) {
      throw new VerifyRequestError('INVALID_FIELD', '需要 verificationRunId 或 scenarioId', {
        field: 'verificationRunId',
        reason: 'REQUIRED',
      })
    }
    const found = registry.find(scope, { runId, scenarioId })
    if (!found) throw new VerifyRequestError('TARGET_MISMATCH', RUN_NOT_VISIBLE)
    return found
  }

  /**
   * Executes a verification scenario.
   *
   * @param {{
   *   workspaceCwd: string,
   *   ownerSessionId: string,
   *   scenario: import('../../types/verify.d.ts').ScenarioSpec,
   *   verificationRunId?: string,
   *   debugSessionId?: string,
   *   timeoutMs?: number,
   *   signal?: AbortSignal,
   *   source?: 'user' | 'agent',
   *   artifactPath?: string,
   *   artifactSha256?: string,
   *   firmwareHash?: string,
   *   targetIdentity?: string,
   * }} options
   * @returns {Promise<import('../../types/verify.d.ts').VerifyResult>}
   */
  async function execute(options) {
    const scope = resolveScope(options.workspaceCwd, options.ownerSessionId)
    const { scenario } = options
    assertScenarioBudget(scenario, effectiveTimeoutMs(scenario, options.timeoutMs))
    assertChangedBaselines(scenario)
    const scenarioId = scenario.id || `scenario_${Date.now()}`
    const external = String(options.verificationRunId || '').trim()
    if (external && registry.has(external)) {
      throw new VerifyRequestError('CONFLICT', `验证运行 ID 已被使用: ${external}`, {
        reason: 'RUN_ID_REUSE',
        verificationRunId: external,
      })
    }
    const verificationRunId = external || generateRunId()

    const abortController = new AbortController()
    registry.register({ runId: verificationRunId, scope, scenarioId, abortController, startedAt: Date.now() })

    const externalSignal = options.signal
    const onExternalAbort = () => abortController.abort()
    if (externalSignal) {
      if (externalSignal.aborted) abortController.abort()
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }

    try {
      const result = await verifyService.runVerification({
        ...options,
        ownerSessionId: scope.sid,
        verificationRunId,
        scenario: { ...scenario, id: scenarioId },
        signal: abortController.signal,
      })
      registry.complete(verificationRunId, scope, [scenarioId, result.scenarioId], result)
      return result
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort)
      registry.release(verificationRunId)
    }
  }

  /**
   * Requests cancellation of a run visible to the caller. Only aborts; the run
   * keeps its ID until execution unwinds.
   *
   * @param {VerifyRunQuery} query
   * @returns {{ cancelled: boolean }}
   */
  function cancel(query) {
    const found = locate(query)
    if (!found.active) return { cancelled: false }
    found.active.abortController.abort()
    return { cancelled: true }
  }

  /**
   * @param {VerifyRunQuery} query
   * @returns {{ running: boolean, result: import('../../types/verify.d.ts').VerifyResult | null }}
   */
  function status(query) {
    const found = locate(query)
    return { running: Boolean(found.active), result: found.completed?.result || null }
  }

  return {
    execute,
    cancel,
    status,
    /** Bounded store sizes, for diagnostics and tests. */
    registrySizes: () => registry.sizes(),
  }
}
