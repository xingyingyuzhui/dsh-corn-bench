// @ts-check

import { createScopedPointReader } from './scoped-point-reader.mjs'

/**
 * @typedef {import('./verify-point-scope.mjs').PointReading} TelemetryReading
 * @typedef {import('./scoped-point-reader.mjs').ResolvedScope} ResolvedScope
 */

/**
 * Default verify telemetry reader. Reads only session-visible runtime values
 * (poll records with their own timestamp and provenance), published live
 * samples, or a controlled dynamic reader; static `points[].value` config is
 * never treated as data.
 *
 * `boundScope` declares the single scope a loader-less reader serves (tests and
 * external sources); without a loader or bound scope every read is unavailable.
 *
 * @param {{
 *   workspaceLoader?: ((cwd: string) => any) | null,
 *   liveValues?: Map<string, TelemetryReading>,
 *   boundScope?: { cwd: string, sessionId?: string } | null,
 *   readPointFn?: (scope: ResolvedScope, pointId: string, signal?: AbortSignal) => Promise<TelemetryReading | null>,
 * }} [options]
 */
export function createTelemetryReader(options = {}) {
  const readPointFn = options.readPointFn || null
  return createScopedPointReader({
    workspaceLoader: options.workspaceLoader || null,
    liveCache: options.liveValues,
    boundScope: options.boundScope || null,
    directRead: readPointFn ? (scope, target, signal) => readPointFn(scope, target.point.id, signal) : null,
  })
}
