// @ts-check

export const MAX_COMPLETED_RUNS = 50
export const COMPLETED_RUN_TTL_MS = 60 * 60 * 1000

/**
 * @typedef {{ cwd: string, sid: string }} RunScope
 * @typedef {{
 *   runId: string,
 *   scope: RunScope,
 *   scenarioId: string,
 *   abortController: AbortController,
 *   startedAt: number,
 * }} ActiveRun
 * @typedef {{
 *   runId: string,
 *   scope: RunScope,
 *   scenarioIds: string[],
 *   result: import('../../types/verify.d.ts').VerifyResult,
 *   finishedAt: number,
 * }} CompletedRun
 */

/**
 * @param {RunScope} scope
 * @param {string} scenarioId
 */
const scenarioKey = (scope, scenarioId) => JSON.stringify([scope.cwd, scope.sid, scenarioId])

/**
 * @param {RunScope} a
 * @param {RunScope} b
 */
const sameScope = (a, b) => a.cwd === b.cwd && a.sid === b.sid

/**
 * Owner-scoped verify run bookkeeping. A runId only locates a record; every
 * lookup still compares the caller's scope. Completed runs are stored once per
 * run (scenario aliases are index entries, not copies) and are bounded by count
 * and age; active runs are never evicted.
 *
 * @param {{ now?: () => number, maxCompleted?: number, completedTtlMs?: number }} [opts]
 */
export function createVerifyRunRegistry(opts = {}) {
  const now = opts.now || Date.now
  const maxCompleted = opts.maxCompleted ?? MAX_COMPLETED_RUNS
  const ttlMs = opts.completedTtlMs ?? COMPLETED_RUN_TTL_MS

  /** @type {Map<string, ActiveRun>} */
  const active = new Map()
  /** @type {Map<string, string>} */
  const activeByScenario = new Map()
  /** @type {Map<string, CompletedRun>} finish order */
  const completed = new Map()
  /** @type {Map<string, string>} */
  const latestByScenario = new Map()

  /** @param {CompletedRun} run */
  function evict(run) {
    completed.delete(run.runId)
    for (const id of run.scenarioIds) {
      const key = scenarioKey(run.scope, id)
      if (latestByScenario.get(key) === run.runId) latestByScenario.delete(key)
    }
  }

  function prune() {
    const t = now()
    for (const run of [...completed.values()]) {
      if (t - run.finishedAt >= ttlMs) evict(run)
    }
    while (completed.size > maxCompleted) {
      const oldest = completed.values().next().value
      if (!oldest) break
      evict(oldest)
    }
  }

  return {
    /** @param {string} runId */
    has(runId) {
      prune()
      return active.has(runId) || completed.has(runId)
    },

    /** @param {ActiveRun} run */
    register(run) {
      active.set(run.runId, run)
      activeByScenario.set(scenarioKey(run.scope, run.scenarioId), run.runId)
    },

    /** @param {string} runId */
    release(runId) {
      const run = active.get(runId)
      if (!run) return
      active.delete(runId)
      const key = scenarioKey(run.scope, run.scenarioId)
      if (activeByScenario.get(key) === runId) activeByScenario.delete(key)
    },

    /**
     * @param {string} runId
     * @param {RunScope} scope
     * @param {string[]} scenarioIds
     * @param {import('../../types/verify.d.ts').VerifyResult} result
     */
    complete(runId, scope, scenarioIds, result) {
      const ids = [...new Set(scenarioIds.filter(Boolean))]
      completed.delete(runId)
      completed.set(runId, { runId, scope, scenarioIds: ids, result, finishedAt: now() })
      for (const id of ids) latestByScenario.set(scenarioKey(scope, id), runId)
      prune()
    },

    /**
     * Locate a run visible to `scope`, by runId or by the scope's latest run of a
     * scenario. Returns null when absent, expired or owned by another scope.
     *
     * @param {RunScope} scope
     * @param {{ runId?: string, scenarioId?: string }} target
     * @returns {{ active: ActiveRun | null, completed: CompletedRun | null } | null}
     */
    find(scope, target) {
      prune()
      if (target.runId) {
        const a = active.get(target.runId) || null
        const c = completed.get(target.runId) || null
        const owner = a?.scope || c?.scope
        if (!owner || !sameScope(owner, scope)) return null
        return { active: a, completed: c }
      }
      if (target.scenarioId) {
        const key = scenarioKey(scope, target.scenarioId)
        const a = active.get(activeByScenario.get(key) || '') || null
        const c = completed.get(latestByScenario.get(key) || '') || null
        if (!a && !c) return null
        return { active: a, completed: c }
      }
      return null
    },

    /** Test/diagnostic view of the bounded stores. */
    sizes() {
      return { active: active.size, completed: completed.size, latestIndex: latestByScenario.size }
    },
  }
}
