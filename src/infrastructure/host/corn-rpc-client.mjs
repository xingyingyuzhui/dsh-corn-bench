// @ts-check
import {
  CORN_FETCH_DISPATCH_PATH,
  CORN_RPC_CHANNEL,
  httpPathToRpcEndpoint,
} from '../../shared/corn-rpc-contract.mjs'

/**
 * @typedef {import('../../types/http-api.js').ConnectionRpcLike} ConnectionRpcLike
 */

/**
 * Unwrap Connection RPC / Fetch transport result.
 * Transport failure → throw. Business payloads (including ok:false) → return as-is.
 * @param {unknown} result
 * @returns {unknown}
 */
function unwrapRpcResult(result) {
  if (!result || /** @type {{ ok?: boolean }} */ (result).ok !== true) {
    const row = result && typeof result === 'object' ? /** @type {{ error?: { message?: string } }} */ (result) : null
    const message = row?.error && typeof row.error.message === 'string' ? row.error.message : 'corn rpc failed'
    throw new Error(message)
  }
  return /** @type {{ value?: unknown }} */ (result).value
}

/**
 * @param {unknown} timeoutOrOptions
 * @returns {{ timeoutMs: number, userSignal: AbortSignal | null }}
 */
function parsePostOptions(timeoutOrOptions) {
  let timeoutMs = 15000
  /** @type {AbortSignal | null} */
  let userSignal = null
  if (typeof timeoutOrOptions === 'number') {
    timeoutMs = timeoutOrOptions > 0 ? timeoutOrOptions : 15000
  } else if (timeoutOrOptions && typeof timeoutOrOptions === 'object') {
    if (Number(/** @type {any} */ (timeoutOrOptions).timeoutMs) > 0) {
      timeoutMs = Number(/** @type {any} */ (timeoutOrOptions).timeoutMs)
    }
    if (/** @type {any} */ (timeoutOrOptions).signal) {
      userSignal = /** @type {any} */ (timeoutOrOptions).signal
    }
  }
  return { timeoutMs, userSignal }
}

/**
 * @param {number} timeoutMs
 * @param {AbortSignal | null} userSignal
 * @returns {AbortSignal}
 */
function combineSignals(timeoutMs, userSignal) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  if (userSignal && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([timeoutSignal, userSignal])
  }
  return userSignal || timeoutSignal
}

/**
 * Preferred UI transport: relative Fetch to shared `/api/corn-bench/dispatch`.
 * @param {typeof fetch} [fetchImpl]
 * @returns {(path: string, payload?: unknown, timeoutMs?: number) => Promise<unknown>}
 */
export function createCornFetchPost(fetchImpl) {
  const impl = fetchImpl ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
  if (typeof impl !== 'function') {
    throw new Error('dsh-corn-bench: fetch is required for createCornFetchPost')
  }
  return function post(path, payload, timeoutOrOptions) {
    const endpoint = httpPathToRpcEndpoint(path)
    const { timeoutMs, userSignal } = parsePostOptions(timeoutOrOptions)
    const signal = combineSignals(timeoutMs, userSignal)
    return impl(CORN_FETCH_DISPATCH_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload: payload ?? {} }),
      signal,
    }).then(async (res) => {
      let result
      try {
        result = await res.json()
      } catch {
        throw new Error(`corn fetch HTTP ${res.status}`)
      }
      if (!res.ok && (!result || typeof result !== 'object')) {
        throw new Error(`corn fetch HTTP ${res.status}`)
      }
      return unwrapRpcResult(result)
    })
  }
}

/**
 * Legacy Web RPC transport (compat window). Prefer {@link createCornFetchPost}.
 * @param {ConnectionRpcLike} connection
 * @returns {(path: string, payload?: unknown, timeoutMs?: number) => Promise<unknown>}
 */
export function createCornRpcPost(connection) {
  if (!connection?.rpc?.call || typeof connection.rpc.call !== 'function') {
    throw new Error('dsh-corn-bench: connection.rpc.call is required')
  }
  const rpcCall = connection.rpc.call
  return function post(path, payload, timeoutOrOptions) {
    const endpoint = httpPathToRpcEndpoint(path)
    const { timeoutMs, userSignal } = parsePostOptions(timeoutOrOptions)
    const signal = combineSignals(timeoutMs, userSignal)
    return rpcCall(CORN_RPC_CHANNEL, endpoint, payload || {}, signal).then(unwrapRpcResult)
  }
}

/**
 * @param {ConnectionRpcLike | null | undefined} connection
 * @param {string} endpoint
 * @param {unknown} [payload]
 * @param {AbortSignal} [signal]
 * @returns {Promise<unknown>}
 */
export async function callCornRpc(connection, endpoint, payload, signal) {
  if (!connection?.rpc?.call) {
    throw new Error('dsh-corn-bench: connection.rpc.call is required')
  }
  const result = await connection.rpc.call(CORN_RPC_CHANNEL, endpoint, payload || {}, signal)
  return unwrapRpcResult(result)
}
