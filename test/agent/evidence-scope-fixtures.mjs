// @ts-check
/** Two-session partitioned workspace fixtures for evidence / focus scope tests. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveWorkspace, workspaceKey } from '../../bench-store.mjs'
import { workspaceDir } from '../../src/infrastructure/persistence/workspace-migration.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

export const A = 'session-a'
export const B = 'session-b'

/** @param {string} id @param {string} cid @param {string} did */
export const point = (id, cid, did) => ({ id, name: id, connectionId: cid, deviceId: did, function: 3, address: 0, area: 'holdingRegister' })

/**
 * @param {any} t
 * @param {{ focus?: any }} [extra]
 */
export async function twoSessionBench(t, extra = {}) {
  const bench = await createBench(t, { prefix: 'dvb-ev-scope-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 5,
      share: { enabled: false, connections: false, points: false },
      privateClaimSessionId: A,
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        [A]: {
          connections: [connection('c-a', 'tcp', '', { sim: true })],
          devices: [{ id: 'd-a', connectionId: 'c-a', name: 'DA', unitId: 1 }],
          points: [point('pa', 'c-a', 'd-a')],
          visualization: { schemaVersion: 2, components: [] },
        },
        [B]: {
          connections: [connection('c-b', 'tcp', '', { sim: true })],
          devices: [{ id: 'd-b', connectionId: 'c-b', name: 'DB', unitId: 1 }],
          points: [point('pb', 'c-b', 'd-b')],
          visualization: { schemaVersion: 2, components: [] },
        },
      },
    },
    timeline: [
      { id: 'b-event', at: 30, kind: 'read', source: 'agent', sessionId: B, taskId: '', ok: true, summary: 'b' },
      { id: 'a-event', at: 20, kind: 'read', source: 'agent', sessionId: A, taskId: '', ok: true, summary: 'a' },
      { id: 'legacy-event', at: 10, kind: 'read', source: 'user', sessionId: '', taskId: '', ok: true, summary: 'x' },
    ],
    tasks: [
      { id: 'b-build', type: 'build', status: 'ok', sessionId: B, startedAt: 3, endedAt: 4, progress: 0 },
      { id: 'a-build', type: 'build', status: 'ok', sessionId: A, startedAt: 1, endedAt: 2, progress: 0 },
    ],
    ...extra,
  })
  return bench
}

/**
 * On-disk config + runtime, minus the Host session binding (`session.boundId`),
 * which every Host command refreshes for notifications and is not evidence state.
 * @param {string} home @param {string} cwd
 */
export function diskBytes(home, cwd) {
  const dir = workspaceDir(home, workspaceKey(cwd))
  return ['config.json', 'runtime.json'].map((name) => {
    const json = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    delete json.session
    return JSON.stringify(json)
  })
}

/** @param {any[]} refs */
export const idsOf = (refs) => refs.map((r) => `${r.kind}:${r.id}`).sort()

/**
 * Exact on-disk bytes, for direct service calls that never touch the Host session binding.
 * @param {string} home @param {string} cwd
 */
export function rawDiskBytes(home, cwd) {
  const dir = workspaceDir(home, workspaceKey(cwd))
  return ['config.json', 'runtime.json'].map((name) => readFileSync(join(dir, name)))
}
