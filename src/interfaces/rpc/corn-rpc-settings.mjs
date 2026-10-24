// @ts-check
/**
 * Settings → Corn endpoints: tool bindings, workspace share and the Agent
 * write policy. Browser-only: these are reachable through the authenticated
 * Connection RPC / Fetch dispatch, never through the Agent command bridge.
 */
import { mutateConfig } from '../../application/config/config-mutation-service.mjs'
import { loadAgentPolicy, saveAgentPolicy } from '../../infrastructure/store/agent-policy-store.mjs'
import { loadBindings, probeBindings, saveBindings } from '../../infrastructure/store/bindings-store.mjs'
import { loadGlobalShare, saveGlobalShare } from '../../infrastructure/store/global-share-store.mjs'

export const SETTINGS_ENDPOINTS = new Set(['bindings/get', 'bindings/save'])

/** @param {string} home */
function settingsView(home) {
  const bindings = loadBindings(home)
  return {
    ok: true,
    bindings,
    globalShare: loadGlobalShare(home),
    health: probeBindings(bindings),
    agentPolicy: loadAgentPolicy(home),
  }
}

/**
 * Each field is saved only when the caller sent it: a share toggle or a policy
 * toggle must not rewrite tool paths, and an omitted `bindings` must not wipe
 * them (normalizeBindings(undefined) is all-empty).
 *
 * @param {string} home
 * @param {string} endpoint
 * @param {Record<string, any>} body
 * @returns {Promise<Record<string, any>>}
 */
export async function handleSettingsEndpoint(home, endpoint, body) {
  if (endpoint === 'bindings/get') return settingsView(home)
  if (body.bindings !== undefined) {
    const saved = saveBindings(home, body.bindings)
    if (!saved.ok) return saved
  }
  if (body.agentPolicy !== undefined) saveAgentPolicy(home, body.agentPolicy)
  if (body.share !== undefined) {
    saveGlobalShare(home, body.share)
    const sid = String(body.sessionId || '').trim()
    const cwd = String(body.cwd || '').trim()
    if (cwd) {
      try {
        await mutateConfig({
          home,
          cwd,
          sessionId: sid,
          source: 'user',
          action: 'config',
          payload: {
            cwd,
            operation: 'share.update',
            value: { share: body.share, confirmed: true },
          },
        })
      } catch {
        /* workspace sync best-effort */
      }
    }
  }
  return settingsView(home)
}
