// @ts-check
/**
 * Memory of a simulated Modbus device.
 *
 * Simulated reads are generated from time and address, so without memory a
 * write "succeeded" and the next poll overwrote it — the HMI showed the old
 * curve right after "写入成功". A real slave keeps coils and holding registers
 * until something writes them again; this bank gives the simulator the same
 * behaviour. Discrete inputs (FC02) and input registers (FC04) stay generated:
 * they are read-only on real hardware too.
 *
 * Process-local and keyed by workspace + connection + unit, so two workspaces
 * that both call their connection `c1` never share registers. Entries go away
 * when the connection is released (deleted, re-pointed, switched to real).
 */

/** @param {unknown} fc @returns {'coil' | 'holding' | ''} */
function tableOf(fc) {
  const code = Number(fc)
  if (code === 1 || code === 5 || code === 15) return 'coil'
  if (code === 3 || code === 6 || code === 16) return 'holding'
  return ''
}

/** @type {Map<string, number>} */
const bank = new Map()

/** @param {unknown} cwd @param {unknown} connectionId */
const connectionKey = (cwd, connectionId) => `${String(cwd || '')}\u0000${String(connectionId || '')}`

/**
 * @param {{ cwd?: unknown, connectionId?: unknown, unitId?: unknown }} at
 * @param {'coil' | 'holding'} table
 * @param {number} address
 */
const registerKey = (at, table, address) =>
  `${connectionKey(at.cwd, at.connectionId)}\u0000${Math.trunc(Number(at.unitId) || 0)}\u0000${table}\u0000${address}`

/**
 * Remember values written to a simulated device.
 * @param {{ cwd?: unknown, connectionId?: unknown, unitId?: unknown, functionCode?: unknown, address?: unknown, values?: unknown }} write
 */
export function rememberSimWrite(write) {
  const table = tableOf(write.functionCode)
  if (!table || !write.connectionId) return
  const values = Array.isArray(write.values) ? write.values : [write.values]
  const start = Math.trunc(Number(write.address) || 0)
  values.forEach((value, i) => {
    const raw = table === 'coil' ? (Number(value) ? 1 : 0) : Math.trunc(Number(value))
    if (Number.isFinite(raw)) bank.set(registerKey(write, table, start + i), raw)
  })
}

/**
 * Overlay remembered values onto a generated read.
 * @param {{ cwd?: unknown, connectionId?: unknown, unitId?: unknown, functionCode?: unknown, address?: unknown }} read
 * @param {number[]} generated
 * @returns {number[]}
 */
export function overlaySimRead(read, generated) {
  const table = tableOf(read.functionCode)
  if (!table || !read.connectionId || bank.size === 0) return generated
  const start = Math.trunc(Number(read.address) || 0)
  return generated.map((value, i) => {
    const kept = bank.get(registerKey(read, table, start + i))
    return kept === undefined ? value : kept
  })
}

/**
 * Forget a released connection's registers.
 * @param {unknown} cwd
 * @param {unknown} connectionId
 */
export function forgetSimConnection(cwd, connectionId) {
  const prefix = `${connectionKey(cwd, connectionId)}\u0000`
  for (const key of bank.keys()) if (key.startsWith(prefix)) bank.delete(key)
}

/** Test seam: drop every remembered register. */
export function clearSimRegisterBank() {
  bank.clear()
}
