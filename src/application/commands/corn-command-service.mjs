// @ts-check
import { rejectUnsupportedQueryField } from './agent-query-fields.mjs'
import { envelope, normalizeCommand } from './command-contract.mjs'
import { globalCommandIdempotency } from './command-idempotency-cache.mjs'
import { finalizeAgentCommandResult } from './lossless-json.mjs'
import { runCornBench } from './corn-command-router.mjs'

/**
 * Normalize → idempotency → route → envelope.
 * @param {any} input
 * @returns {Promise<any>}
 */
export async function executeCornCommand(input) {
  const cmd = normalizeCommand(input)
  if (cmd.source === 'agent') {
    const unsupported = rejectUnsupportedQueryField({ ...(cmd.payload || {}), action: cmd.action })
    if (unsupported) return envelope(cmd, unsupported)
  }
  const ran = await globalCommandIdempotency.run(cmd, async () => {
    const args = /** @type {any} */ ({ ...(cmd.payload || {}), action: cmd.action })
    if (cmd.expectedConfigVersion != null && args.expectedConfigVersion == null) {
      args.expectedConfigVersion = cmd.expectedConfigVersion
    }
    const result = await runCornBench(
      cmd.home,
      args,
      cmd.cwd,
      {
        source: cmd.source,
        sessionId: cmd.sessionId,
      },
      { signal: cmd.signal, commandId: cmd.commandId, transport: cmd.transport },
    )
    return envelope(cmd, result)
  })
  return finalizeAgentCommandResult(ran, cmd.source)
}

export { ACTIONS, runCornBench, _internal } from './corn-command-router.mjs'
