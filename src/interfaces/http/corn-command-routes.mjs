// @ts-check

import { normalizeCommand } from '../../application/commands/command-contract.mjs'
import { executeHostCommand } from '../../application/commands/host-command-service.mjs'
import { losslessCommandResult } from '../../application/commands/lossless-json.mjs'

/**
 * @param {any} home
 * @param {any} [deps]
 * @returns {any}
 */
export function createCornCommandDispatcher(home, deps = {}) {
  return {
    /** @param {any} input */
    async dispatch(input) {
      return losslessCommandResult(
        await executeHostCommand({ ...normalizeCommand(input), home: input.home || home }, deps),
      )
    },
  }
}

/**
 * @param {any} home
 * @param {any} arg
 * @param {any} [deps]
 * @returns {any}
 */
export function cornCommandRoute(home, { readBodyAndTouchSession }, deps = {}) {
  return {
    kind: 'exact',
    path: '/dsh-corn-bench/command',
    handler: null,
    dispatch: (/** @type {any} */ req) => handleCommand(home, req, readBodyAndTouchSession, deps),
  }
}

/**
 * @param {any} home
 * @param {any} req
 * @param {any} readBodyAndTouchSession
 * @param {any} [deps]
 * @returns {Promise<any>}
 */
export async function handleCommand(home, req, readBodyAndTouchSession, deps = {}) {
  const body = await readBodyAndTouchSession(req)
  return losslessCommandResult(
    await executeHostCommand(
      {
        ...body,
        home,
        payload: body.payload || body,
        action: body.action || body.payload?.action,
        // The bridge exists for out-of-process Agent tools. Its caller is an
        // Agent whatever the body claims: approval gates key on source, and a
        // self-declared 'user' would skip them.
        source: 'agent',
      },
      deps,
    ),
  )
}
