// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { alarmRangeText, EDIT_ONLY_COLS, visiblePointCols } from '../../src/ui/hmi/point-columns.mjs'

test('view mode drops scale/offset/thresholds; edit mode keeps all 12 columns', () => {
  assert.equal(visiblePointCols(true).length, 12)
  assert.deepEqual(visiblePointCols(false), ['name', 'monitor', 'fn', 'addr', 'value', 'unit', 'alarm'])
  for (const k of EDIT_ONLY_COLS) assert.ok(visiblePointCols(true).includes(k), k)
})

test('alarm range summary shows only the thresholds that are set', () => {
  assert.equal(alarmRangeText({ alarmMin: 10, alarmMax: 50 }), '<10 · >50')
  assert.equal(alarmRangeText({ alarmMax: 50 }), '>50')
  assert.equal(alarmRangeText({ alarmMin: 0 }), '<0')
  assert.equal(alarmRangeText({ alarmMin: null, alarmMax: '' }), '')
})
