// @ts-check

/**
 * Creates a structured VerifyResult object from evaluated assertions and evidence.
 *
 * @param {{
 *   scenario: { id?: string; name: string },
 *   assertions?: import('../../types/verify.d.ts').AssertionResult[],
 *   durationMs?: number,
 *   evidence?: Array<Record<string, any>>,
 *   error?: any,
 *   status?: import('../../types/verify.d.ts').VerifyStatus,
 *   verificationRunId?: string,
 *   artifact?: { path?: string; sha256?: string; sizeBytes?: number },
 *   artifactPath?: string,
 *   artifactSha256?: string,
 *   debug?: { backend?: string; debugSessionId?: string; firmwareHash?: string; targetIdentity?: string },
 *   backend?: string,
 *   debugSessionId?: string,
 *   firmwareHash?: string,
 *   targetIdentity?: string,
 *   snapshots?: any[],
 *   startedAt?: number,
 *   finishedAt?: number,
 *   startAt?: number,
 *   endAt?: number,
 *   telemetrySamples?: Array<{ pointId?: string; expr?: string; timestamp: number; value: any }>,
 * }} params
 * @returns {import('../../types/verify.d.ts').VerifyResult}
 */
export function createVerifyResult(params) {
  const {
    scenario,
    assertions = [],
    durationMs = 0,
    evidence = [],
    error,
    artifactSha256,
    debugSessionId,
    firmwareHash,
    targetIdentity,
    startAt,
    endAt,
    telemetrySamples = [],
  } = params

  const totalCount = assertions.length
  const passedCount = assertions.filter((a) => a.pass).length
  const failedCount = totalCount - passedCount
  const unverifiable = assertions.filter((a) => a.outcome === 'unverifiable')
  const unverifiableCount = unverifiable.length
  const compareFailed = assertions.filter((a) => !a.pass && a.outcome !== 'unverifiable')

  /** @type {import('../../types/verify.d.ts').VerifyStatus} */
  let status = 'pass'
  /** @type {string | undefined} */
  let errorCode
  if (params.status) {
    status = params.status
  } else if (error) {
    const msg = String(error?.message || error)
    if (msg.includes('TIMEOUT') || msg.includes('timeout')) {
      status = 'timeout'
    } else if (msg.includes('CANCEL') || msg.includes('cancel') || msg.includes('abort')) {
      status = 'cancelled'
    } else {
      status = 'error'
    }
  } else if (unverifiableCount > 0) {
    status = 'error'
    errorCode = 'VERIFY_UNVERIFIABLE'
  } else if (failedCount > 0) {
    status = 'fail'
  }

  const counts =
    `${passedCount}/${totalCount} 项断言通过` +
    `，比较失败: [${compareFailed.map((a) => a.id).join(', ')}]` +
    `，无法验证: [${unverifiable.map((a) => `${a.id}:${a.reason || 'UNKNOWN'}`).join(', ')}]`
  let summary = ''
  if (status === 'timeout') {
    summary = `验证场景 [${scenario.name}] 超时未完成 (TIMEOUT)`
  } else if (status === 'cancelled') {
    summary = `验证场景 [${scenario.name}] 已被取消 (CANCELLED)`
  } else if (status === 'error' && errorCode) {
    summary = `验证场景 [${scenario.name}]: ${counts}，存在无法验证项，不能判定通过 (ERROR)`
  } else if (status === 'error') {
    const reason = error ? error?.message || String(error) : '未知错误'
    summary = `验证场景 [${scenario.name}] 执行异常: ${reason} (ERROR)`
  } else if (status === 'pass') {
    summary = `验证场景 [${scenario.name}]: 全部 ${totalCount} 项断言通过 (PASS)`
  } else {
    summary = `验证场景 [${scenario.name}]: ${counts} (FAIL)`
  }

  const startedAt = startAt || Date.now() - Math.max(0, Math.round(durationMs))
  const finishedAt = endAt || Date.now()
  const snapshots =
    params.snapshots ||
    evidence.filter((e) => e && (e.kind === 'debug_snapshot' || e.kind === 'snapshot' || e.snapshotId))

  return {
    verificationRunId: params.verificationRunId || `vr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    scenarioId: scenario.id || '',
    scenarioName: scenario.name,
    status,
    passedCount,
    failedCount,
    unverifiableCount,
    totalCount,
    ...(errorCode ? { errorCode } : {}),
    durationMs: Math.max(0, Math.round(durationMs)),
    assertions,
    evidence,
    summary,
    timestamp: Date.now(),
    artifact: {
      path: params.artifactPath || params.artifact?.path,
      sha256: artifactSha256 || params.artifact?.sha256,
    },
    artifactSha256,
    debug: {
      debugSessionId,
      backend: params.backend || params.debug?.backend,
      targetIdentity: targetIdentity || params.debug?.targetIdentity,
    },
    debugSessionId,
    firmwareHash,
    targetIdentity,
    snapshots,
    startedAt,
    finishedAt,
    startAt: startedAt,
    endAt: finishedAt,
    telemetrySamples,
  }
}
