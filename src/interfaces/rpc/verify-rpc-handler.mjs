// @ts-check

import { createVerifyCommandService } from '../../application/verify/verify-command-service.mjs'
import { VerifyRequestError } from '../../domain/verify/errors.mjs'

/**
 * @typedef {{
 *   cwd?: string,
 *   sessionId?: string,
 *   verificationRunId?: string,
 *   runId?: string,
 *   scenarioId?: string,
 * }} VerifyRunParams
 */

/**
 * The page's cwd and sessionId are the caller scope; a run's own owner fields
 * are never used to infer it.
 *
 * @param {VerifyRunParams} params
 */
const queryOf = (params) => ({
  workspaceCwd: String(params?.cwd || ''),
  ownerSessionId: String(params?.sessionId || ''),
  verificationRunId: String(params?.verificationRunId || params?.runId || ''),
  scenarioId: String(params?.scenarioId || ''),
})

/** @param {unknown} err */
function failure(err) {
  if (err instanceof VerifyRequestError) {
    return { ok: false, errorCode: err.code, error: err.message, details: err.details }
  }
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

/**
 * Creates RPC handlers for closed-loop verification operations. `ok: true`
 * means a result or status came back; whether verification passed is
 * `result.status === 'pass'`.
 *
 * @param {{
 *   verifyCommandService?: ReturnType<typeof createVerifyCommandService>,
 *   verifyService?: any,
 *   debugRuntime?: any,
 *   workspaceLoader?: (cwd: string) => any,
 * }} [deps]
 */
export function createVerifyRpcHandler(deps = {}) {
  const commandService = deps.verifyCommandService || createVerifyCommandService(deps)

  /**
   * @param {VerifyRunParams & {
   *   scenario: import('../../types/verify.d.ts').ScenarioSpec,
   *   debugSessionId?: string,
   *   timeoutMs?: number,
   * }} params
   */
  async function handleRun(params) {
    if (!params || !params.scenario) {
      return { ok: false, error: '缺少 scenario 场景配置' }
    }
    try {
      const query = queryOf(params)
      const result = await commandService.execute({
        workspaceCwd: query.workspaceCwd,
        ownerSessionId: query.ownerSessionId,
        scenario: params.scenario,
        verificationRunId: query.verificationRunId || undefined,
        debugSessionId: params.debugSessionId,
        timeoutMs: params.timeoutMs,
      })
      return { ok: true, verificationRunId: result.verificationRunId, result }
    } catch (err) {
      return failure(err)
    }
  }

  /** @param {VerifyRunParams} params */
  async function handleCancel(params) {
    try {
      return { ok: true, ...commandService.cancel(queryOf(params)) }
    } catch (err) {
      return failure(err)
    }
  }

  /** @param {VerifyRunParams} params */
  async function handleStatus(params) {
    try {
      return { ok: true, ...commandService.status(queryOf(params)) }
    } catch (err) {
      return failure(err)
    }
  }

  return {
    // Canonical endpoints
    'verify/run': handleRun,
    'verify/cancel': handleCancel,
    'verify/status': handleStatus,

    // Backward compatibility aliases
    'vision.verify.run': handleRun,
    'vision.verify.cancel': handleCancel,
    'vision.verify.status': handleStatus,
  }
}
