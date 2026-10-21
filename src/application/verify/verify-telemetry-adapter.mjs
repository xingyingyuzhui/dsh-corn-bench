// @ts-check

import { createScopedPointReader } from './scoped-point-reader.mjs'
import { readingFromRecord } from './verify-point-scope.mjs'
import { SAMPLE_STAMP_MESSAGES, unavailable, UNAVAILABLE_REASONS } from '../../domain/verify/observation.mjs'

/**
 * @typedef {import('./verify-point-scope.mjs').PointReading} LiveTelemetryReading
 * @typedef {import('./scoped-point-reader.mjs').DirectRead} DirectRead
 */

/** @param {AbortSignal | undefined} signal */
function abortError(signal) {
  const isTimeout = signal?.reason?.message === 'VERIFY_TIMEOUT' || signal?.reason?.name === 'TimeoutError'
  const err = new Error(isTimeout ? 'VERIFY_TIMEOUT' : 'VERIFY_CANCELLED')
  err.name = isTimeout ? 'TimeoutError' : 'AbortError'
  return err
}

/**
 * One real read through the production read-service, after the point has been
 * resolved and authorised. The read-service leaves its normal trace (claim,
 * task, frames, values, journal). Its response is bound by picking the single
 * `values[]` row of this point with matching provenance, refreshed by this read;
 * busy, failed, missing, duplicated or mismatched results are READ_FAILED.
 *
 * @param {(home: string, cwd: string, body: any, opts?: any) => Promise<any>} modbusReadFn
 * @param {() => string} getHome
 * @returns {DirectRead}
 */
function readServiceDirectRead(modbusReadFn, getHome) {
  return async (scope, target, signal) => {
    const point = target.point
    const startedAt = Date.now()
    let res
    try {
      res = await modbusReadFn(
        getHome(),
        scope.cwd,
        {
          pointId: point.id,
          connectionId: point.connectionId || point.connId,
          deviceId: point.deviceId,
          sessionId: scope.sid,
          source: scope.source,
        },
        { sessionId: scope.sid, signal },
      )
    } catch (err) {
      if (signal?.aborted) throw abortError(signal)
      return unavailable(UNAVAILABLE_REASONS.READ_FAILED, err instanceof Error ? err.message : String(err))
    }
    if (signal?.aborted || res?.cancelled) throw abortError(signal)
    if (!res?.ok) {
      return unavailable(
        UNAVAILABLE_REASONS.READ_FAILED,
        String(res?.error || '读取失败'),
        res?.errorCode ? { readErrorCode: res.errorCode } : {},
      )
    }
    const conn = String(point.connectionId || point.connId || '')
    const dev = String(point.deviceId || '')
    const rows = (Array.isArray(res.values) ? res.values : []).filter((/** @type {any} */ r) => {
      if (!r || String(r.pointId || r.key || '') !== point.id) return false
      const rc = String(r.connectionId || r.connId || '')
      const rd = String(r.deviceId || '')
      return (!rc || rc === conn) && (!rd || rd === dev)
    })
    if (rows.length !== 1) {
      return unavailable(UNAVAILABLE_REASONS.READ_FAILED, rows.length ? '读取结果目标行重复' : '读取结果缺少目标行')
    }
    // Identity was resolved before I/O and provenance is unique above. The scoped
    // reader re-resolves after I/O and validates the capture stamp there, including
    // a generation first initialized by this read. Do not compare to a pre-read token.
    const reading = readingFromRecord(rows[0], point, 'direct-read')
    if (reading && Number(reading.timestamp) > Date.now()) {
      return unavailable(UNAVAILABLE_REASONS.INVALID_SAMPLE, SAMPLE_STAMP_MESSAGES.FUTURE)
    }
    if (!reading || reading.quality !== 'good' || !(reading.timestamp > 0) || reading.value == null) {
      return unavailable(UNAVAILABLE_REASONS.INVALID_SAMPLE, SAMPLE_STAMP_MESSAGES.ILLEGAL)
    }
    if (reading.timestamp < startedAt) {
      return unavailable(UNAVAILABLE_REASONS.READ_FAILED, '读取结果没有本次有效采样')
    }
    if (!reading.fingerprint || !reading.generation) {
      return unavailable(UNAVAILABLE_REASONS.INVALID_SAMPLE, SAMPLE_STAMP_MESSAGES.MISSING)
    }
    if (
      target.generation &&
      (reading.fingerprint !== target.fingerprint || reading.generation !== target.generation)
    ) {
      return unavailable(UNAVAILABLE_REASONS.STALE_VALUE, SAMPLE_STAMP_MESSAGES.MISMATCH)
    }
    return reading
  }
}

/**
 * Production verify telemetry reader: session-scoped poll values, then one
 * real read-service read when the scope is valid but no usable value exists.
 * Static `points[].value` defaults are never data.
 *
 * @param {{
 *   getHome?: () => string,
 *   workspaceLoader?: (cwd: string) => any,
 *   modbusReadFn?: (home: string, cwd: string, body: any, opts?: any) => Promise<any>,
 *   liveCache?: Map<string, LiveTelemetryReading>,
 *   directReadBudget?: import('./scoped-point-reader.mjs').DirectReadBudget | null,
 * }} [deps]
 */
export function createVerifyTelemetryAdapter(deps = {}) {
  const getHome = deps.getHome || (() => '')
  return createScopedPointReader({
    workspaceLoader: deps.workspaceLoader || null,
    liveCache: deps.liveCache,
    directReadBudget: deps.directReadBudget || null,
    directRead: deps.modbusReadFn ? readServiceDirectRead(deps.modbusReadFn, getHome) : null,
  })
}
