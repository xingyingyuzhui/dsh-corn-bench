/** Authenticated Connection RPC channel for Corn browser operations (Web compat). */
export const CORN_RPC_CHANNEL = '/corn-bench'

/**
 * Shared Connection exact Fetch route (Web + Desktop).
 * Body: `{ endpoint: string, payload?: object }`.
 */
export const CORN_FETCH_DISPATCH_PATH = '/api/corn-bench/dispatch'

/** Stable HTTP path → RPC endpoint mapping consumed by `post()`. */
export const CORN_HTTP_TO_RPC = Object.freeze({
  '/dsh-corn-bench/state': 'state',
  '/dsh-corn-bench/bindings': 'bindings/save',
  '/dsh-corn-bench/workspace': 'workspace/save',
  '/dsh-corn-bench/fs/list': 'fs/list',
  '/dsh-corn-bench/project/file': 'project/file',
  '/dsh-corn-bench/keil/log': 'keil/log',
  '/dsh-corn-bench/keil/artifact': 'keil/artifact',
  '/dsh-corn-bench/keil/download': 'keil/download',
  '/dsh-corn-bench/keil/scan': 'keil/scan',
  '/dsh-corn-bench/keil/targets': 'keil/targets',
  '/dsh-corn-bench/keil/map': 'keil/map',
  '/dsh-corn-bench/keil/build': 'keil/build',
  '/dsh-corn-bench/modbus/read': 'modbus/read',
  '/dsh-corn-bench/modbus/write': 'modbus/write',
  '/dsh-corn-bench/modbus/write/approve': 'modbus/write/approve',
  '/dsh-corn-bench/modbus/connect': 'modbus/connect',
  '/dsh-corn-bench/modbus/points': 'modbus/points',
  '/dsh-corn-bench/points/flags': 'points/flags',
  '/dsh-corn-bench/frames/list': 'frames/list',
  '/dsh-corn-bench/frames/clear': 'frames/clear',
  '/dsh-corn-bench/focus': 'focus',
  '/dsh-corn-bench/evidence': 'evidence',
  '/dsh-corn-bench/manual/resolve': 'manual/resolve',
  '/dsh-corn-bench/modbus/poll': 'modbus/poll',
  '/dsh-corn-bench/polling/start': 'polling/start',
  '/dsh-corn-bench/polling/stop': 'polling/stop',
  '/dsh-corn-bench/polling/status': 'polling/status',
  '/dsh-corn-bench/connection/open': 'connection/open',
  '/dsh-corn-bench/connection/close': 'connection/close',
  '/dsh-corn-bench/serial/ports': 'serial/ports',
  '/dsh-corn-bench/serial/sources': 'serial/sources',
  '/dsh-corn-bench/selfcheck': 'selfcheck',
  '/dsh-corn-bench/openocd/probe': 'openocd/probe',
  '/dsh-corn-bench/serial/feed': 'serial/feed',
  '/dsh-corn-bench/command': 'command',
  '/dsh-corn-bench/debug/state': 'debug/state',
  '/dsh-corn-bench/debug/command': 'debug/command',
  '/dsh-corn-bench/debug/events/wait': 'debug/events/wait',
  '/dsh-corn-bench/debug/approval': 'debug/approval',
})

/** @type {readonly string[]} */
export const CORN_RPC_ENDPOINTS = Object.freeze(Object.values(CORN_HTTP_TO_RPC))

/**
 * @param {string} path
 * @returns {string}
 */
export function httpPathToRpcEndpoint(path) {
  const key = String(path || '').split('?')[0]
  const endpoint = CORN_HTTP_TO_RPC[key]
  if (!endpoint) {
    throw new Error(`dsh-corn-bench: unknown RPC path ${key}`)
  }
  return endpoint
}

/**
 * @param {string} endpoint
 * @returns {boolean}
 */
export function isCornRpcEndpoint(endpoint) {
  return CORN_RPC_ENDPOINTS.includes(endpoint)
}
