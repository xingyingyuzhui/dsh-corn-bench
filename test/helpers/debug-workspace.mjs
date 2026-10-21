// @ts-check
/**
 * Real on-disk workspace with a firmware artifact for debug launch tests.
 *
 * `resolveDebugLaunchSpec` pins every launch to firmware bytes on disk: a
 * missing workspace, a hash without a path, or a path that does not exist is
 * `DEBUG_TARGET_SPEC_INVALID`. Tests therefore build the workspace they name
 * instead of relying on `/workspace/...` happening not to exist on the runner.
 *
 * Synchronous on purpose: callers often need several workspaces up front and
 * clean them through `t.after()`, so a failed assertion still removes them.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * @typedef {{ cwd: string, artifactPath: string, artifactSha256: string }} DebugWorkspace
 */

/**
 * @param {{ after: (fn: () => void) => void }} t node:test context, used for cleanup
 * @param {{ prefix?: string, bytes?: string | Buffer, name?: string }} [options]
 * @returns {DebugWorkspace}
 */
export function createDebugWorkspace(t, options = {}) {
  const cwd = mkdtempSync(join(tmpdir(), options.prefix || 'dvb-debug-ws-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const objects = join(cwd, 'Objects')
  mkdirSync(objects, { recursive: true })
  const artifactPath = join(objects, options.name || 'firmware.axf')
  const bytes = options.bytes ?? `ELF firmware fixture for ${cwd}`
  writeFileSync(artifactPath, bytes)
  const artifactSha256 = createHash('sha256').update(bytes).digest('hex')
  return { cwd, artifactPath, artifactSha256 }
}
