// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { labelList, labelOf, pickById } from '../../src/application/config/summary-labels.mjs'

test('summary labels lead with the name and keep the id', () => {
  assert.equal(labelOf({ id: 'p1', name: 'speed' }), 'speed（p1）')
  assert.equal(labelOf({ id: 'p1', name: 'p1' }), 'p1')
  assert.equal(labelOf(undefined, 'c9'), 'c9')
  const pts = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }]
  assert.equal(labelList(pts.slice(0, 2)), 'A（a）、B（b）')
  assert.equal(labelList(pts), 'A（a）、B（b）、C（c） 等 4 项')
  assert.deepEqual(pickById(pts, ['b', 'zz']), [{ id: 'b', name: 'B' }, { id: 'zz' }])
})
