// @ts-check
/**
 * Collects call edges for the Keil project map by function name, so the
 * project call graph is drawn from the code (Lezer AST) instead of empty.
 */

/**
 * @param {number} maxEdges
 */
export function createCallEdgeCollector(maxEdges) {
  /** @type {Array<{ from: string, to: string }>} */
  const calls = []
  const keys = new Set()
  let capped = false
  return {
    /**
     * @param {{ functions: Array<{ id: string, name: string }>, callEdges: Array<{ callerId: string, calleeName: string }> }} analysis
     */
    add(analysis) {
      const nameById = new Map(analysis.functions.map((fn) => [fn.id, fn.name]))
      for (const edge of analysis.callEdges) {
        const from = nameById.get(edge.callerId)
        const key = `${from}\u0000${edge.calleeName}`
        if (!from || !edge.calleeName || keys.has(key)) continue
        if (calls.length >= maxEdges) {
          capped = true
          return
        }
        keys.add(key)
        calls.push({ from, to: edge.calleeName })
      }
    },
    get calls() {
      return calls
    },
    get capped() {
      return capped
    },
  }
}
