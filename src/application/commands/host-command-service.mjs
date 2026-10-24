// @ts-check

import { executeDebugCommand } from '../debug/debug-command-service.mjs'
import { executeCornCommand } from './corn-command-service.mjs'

/**
 * Universal host command dispatcher.
 * Routes debug.* actions to executeDebugCommand and all others to executeCornCommand.
 * Parity with ADR-013 & Phase 5 Section 9.5.
 *
 * @param {any} input
 * @param {any} [deps]
 * @returns {Promise<any>}
 */
export async function executeHostCommand(input, deps) {
  const action = String(input?.action || input?.payload?.action || '').trim()
  if (action.startsWith('debug.')) {
    return executeDebugCommand(input, deps)
  }
  return executeCornCommand(input)
}
