import assert from 'node:assert/strict'
import test from 'node:test'
import { createScopedPointReader } from '../../src/application/verify/scoped-point-reader.mjs'
import { SAMPLE_STAMP_MESSAGES, UNAVAILABLE_REASONS } from '../../src/domain/verify/observation.mjs'
import { prepareConfigPersistence } from '../../src/domain/modbus/prepare-config-persistence.mjs'
import { flatWorkspace, stampWorkspace, vpoint } from './verify-fixtures.mjs'

const scope = { cwd: '/w', sessionId: 's' }

/**
 * Address edits have to hit the layer the reader actually resolves.
 * @param {any} workspace
 * @param {number} address
 */
function retargetAddress(workspace, address) {
  const mb = workspace.modbus || {}
  const sessions = mb.sessionConfigs && typeof mb.sessionConfigs === 'object' ? mb.sessionConfigs : null
  if (sessions) {
    /** @type {Record<string, any>} */
    const nextSessions = {}
    for (const [sid, cfg] of Object.entries(sessions)) {
      const row = /** @type {any} */ (cfg)
      nextSessions[sid] = {
        ...row,
        points: (Array.isArray(row?.points) ? row.points : []).map((/** @type {any} */ point) =>
          point?.id === 'p1' ? { ...point, address } : point,
        ),
      }
    }
    return { ...workspace, modbus: { ...mb, sessionConfigs: nextSessions } }
  }
  return {
    ...workspace,
    modbus: {
      ...mb,
      points: (Array.isArray(mb.points) ? mb.points : []).map((/** @type {any} */ point) =>
        point?.id === 'p1' ? { ...point, address } : point,
      ),
    },
  }
}

/**
 * @param {any} workspace
 * @param {any} [directRead]
 */
function readerFor(workspace, directRead) {
  const box = { workspace }
  const reader = createScopedPointReader({
    workspaceLoader: () => box.workspace,
    directRead: directRead ? (readScope, target, signal) => directRead(readScope, target, signal, box) : null,
  })
  return { reader, box }
}

test('unstamped and mismatched publish do not cache or notify', async () => {
  const ws = stampWorkspace(flatWorkspace({ points: [vpoint('p1')], values: [] }), { sessionId: 's' })
  const { reader } = readerFor(ws)
  let notices = 0
  reader.subscribePoint(scope, 'p1', () => {
    notices += 1
  })
  assert.equal(reader.publishPointValue(scope, 'p1', 7), false)
  const missing = reader.publishStampedReading(scope, 'p1', { value: 7, timestamp: Date.now(), quality: 'good' })
  assert.equal(missing.reason, UNAVAILABLE_REASONS.INVALID_SAMPLE)
  assert.equal(missing.message, SAMPLE_STAMP_MESSAGES.MISSING)
  const wrong = reader.publishStampedReading(scope, 'p1', {
    value: 7,
    rawValue: 7,
    timestamp: Date.now(),
    quality: 'good',
    fingerprint: 'other',
    generation: 'other',
  })
  assert.equal(wrong.reason, UNAVAILABLE_REASONS.STALE_VALUE)
  assert.equal(wrong.message, SAMPLE_STAMP_MESSAGES.MISMATCH)
  assert.equal(notices, 0)
  const cached = await reader.readPoint(scope, 'p1', { allowDirectRead: false })
  assert.equal(cached.reason, UNAVAILABLE_REASONS.DATA_MISSING)
})

test('direct read without a stamp or with the wrong stamp is not cached', async () => {
  const ws = stampWorkspace(flatWorkspace({ points: [vpoint('p1')], values: [] }), { sessionId: 's' })
  const bare = readerFor(ws, async () => ({
    value: 5,
    rawValue: 5,
    timestamp: Date.now(),
    quality: 'good',
    source: 'direct-read',
  }))
  const missing = await bare.reader.readPoint(scope, 'p1')
  assert.equal(missing.reason, UNAVAILABLE_REASONS.INVALID_SAMPLE)
  assert.equal(missing.message, SAMPLE_STAMP_MESSAGES.MISSING)
  const afterMissing = await bare.reader.readPoint(scope, 'p1', { allowDirectRead: false })
  assert.equal(afterMissing.reason, UNAVAILABLE_REASONS.DATA_MISSING)

  const mismatched = readerFor(ws, async (_scope, target) => ({
    value: 5,
    rawValue: 5,
    timestamp: Date.now(),
    quality: 'good',
    fingerprint: target.fingerprint,
    generation: 'not-the-current-token',
  }))
  const stale = await mismatched.reader.readPoint(scope, 'p1')
  assert.equal(stale.reason, UNAVAILABLE_REASONS.STALE_VALUE)
  assert.equal(stale.message, SAMPLE_STAMP_MESSAGES.MISMATCH)
  const afterStale = await mismatched.reader.readPoint(scope, 'p1', { allowDirectRead: false })
  assert.equal(afterStale.reason, UNAVAILABLE_REASONS.DATA_MISSING)
})

test('a direct read that lands after an address change is refused', async () => {
  const ws = stampWorkspace(flatWorkspace({ points: [vpoint('p1', { address: 0 })], values: [] }), { sessionId: 's' })
  const { reader } = readerFor(ws, async (_scope, target, _signal, holder) => {
    const prepared = prepareConfigPersistence(holder.workspace, retargetAddress(holder.workspace, 9))
    holder.workspace = prepared.workspace
    return {
      value: 77,
      rawValue: 77,
      timestamp: Date.now(),
      quality: 'good',
      fingerprint: target.fingerprint,
      generation: target.generation,
    }
  })
  const late = await reader.readPoint(scope, 'p1')
  assert.equal(late.reason, UNAVAILABLE_REASONS.STALE_VALUE)
  assert.notEqual(late.value, 77)
  const cached = await reader.readPoint(scope, 'p1', { allowDirectRead: false })
  assert.equal(cached.reason, UNAVAILABLE_REASONS.DATA_MISSING)
})
