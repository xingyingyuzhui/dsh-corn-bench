// @ts-check
/**
 * User policy for Agent-initiated hardware writes (Settings → Corn).
 *
 * Only the Settings page writes this file, through the browser `bindings/save`
 * endpoint; no Agent command path reaches it, so an Agent cannot turn its own
 * approval off. Reads fail safe: a missing, unreadable or malformed file means
 * approval is required. Only an explicit `false` disables it.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeJsonAtomicSync } from '../persistence/atomic-json.mjs'
import { storeDir } from './bindings-store.mjs'

/** @typedef {{ agentWriteApproval: boolean }} AgentPolicy */

/** @returns {AgentPolicy} */
export const defaultAgentPolicy = () => ({ agentWriteApproval: true })

/** @param {string} home */
export const agentPolicyPath = (home) => join(storeDir(home), 'agent-policy.json')

/**
 * @param {unknown} input
 * @returns {AgentPolicy}
 */
export const normalizeAgentPolicy = (input) => {
  const src = input && typeof input === 'object' ? /** @type {Record<string, unknown>} */ (input) : {}
  return { agentWriteApproval: src.agentWriteApproval !== false }
}

/**
 * @param {string | undefined} home
 * @returns {AgentPolicy}
 */
export const loadAgentPolicy = (home) => {
  if (!home) return defaultAgentPolicy()
  try {
    return normalizeAgentPolicy(JSON.parse(readFileSync(agentPolicyPath(home), 'utf8')))
  } catch {
    return defaultAgentPolicy()
  }
}

/**
 * @param {string} home
 * @param {unknown} input
 * @returns {{ ok: true, agentPolicy: AgentPolicy }}
 */
export const saveAgentPolicy = (home, input) => {
  const agentPolicy = normalizeAgentPolicy(input)
  mkdirSync(storeDir(home), { recursive: true })
  writeJsonAtomicSync(agentPolicyPath(home), agentPolicy)
  return { ok: true, agentPolicy }
}
