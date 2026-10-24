import { CORN_RPC_CHANNEL } from '../../src/shared/corn-rpc-contract.mjs'

/**
 * @param {(endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>} handler
 */
export function createMockCornConnection(handler) {
  return {
    rpc: {
      handle(channel, fn) {
        if (channel !== CORN_RPC_CHANNEL) throw new Error(`unexpected rpc channel: ${channel}`)
        return () => {}
      },
      async call(channel, endpoint, payload, signal) {
        if (channel !== CORN_RPC_CHANNEL) throw new Error(`unexpected rpc channel: ${channel}`)
        const value = await handler(endpoint, payload, signal)
        return { ok: true, value }
      },
    },
  }
}
