// @ts-check

import { selectPointQueryValue } from '../modbus/point-query-value.mjs'
import { createScopedPointReader } from './scoped-point-reader.mjs'
import { readingFromRecord, usableReading } from './verify-point-scope.mjs'
import { unavailable, UNAVAILABLE_REASONS } from '../../domain/verify/observation.mjs'

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
    const selected = selectPointQueryValue({ workspaceModbus: target.view?.layered, point, values: rows })
    if (selected.status !== 'available') return unavailable(UNAVAILABLE_REASONS.READ_FAILED, '读取结果来源与点位不符')
    const reading = readingFromRecord(rows[0], point, 'direct-read')
    if (!usableReading(reading) || reading.timestamp < startedAt) {
      return unavailable(UNAVAILABLE_REASONS.READ_FAILED, '读取结果没有本次有效采样')
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
 * }} [deps]
 */
export function createVerifyTelemetryAdapter(deps = {}) {
  const getHome = deps.getHome || (() => '')
  return createScopedPointReader({
    workspaceLoader: deps.workspaceLoader || null,
    liveCache: deps.liveCache,
    directRead: deps.modbusReadFn ? readServiceDirectRead(deps.modbusReadFn, getHome) : null,
  })
}
