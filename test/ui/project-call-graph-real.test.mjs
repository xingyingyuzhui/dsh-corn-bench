// @ts-check
/** The project call graph is built from the mapped project, never a demo. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFunctionCallGraph } from '../../src/ui/debug/project/project-graph-model.mjs'

const groups = [
  {
    name: 'App',
    files: [
      { rel: 'src/app.c', functions: [{ name: 'main', line: 5 }, { name: 'app_init', line: 2 }, { name: 'app_tick', line: 3 }] },
      { rel: 'src/drv.c', functions: [{ name: 'drv_read', line: 1 }] },
    ],
  },
]

test('without call data the graph lists the real functions and says so', () => {
  const g = buildFunctionCallGraph(groups, {})
  assert.deepEqual(g.nodes.map((n) => n.name).sort(), ['app_init', 'app_tick', 'drv_read', 'main'])
  assert.equal(g.edges.length, 0)
  assert.equal(g.focus, 'main')
  assert.match(g.scopeNote, /4 个函数；暂无调用关系数据/)
  assert.equal(g.nodes.some((n) => /Temperature/.test(n.name)), false)
})

test('call edges come from the backend and depth is measured from main', () => {
  const calls = [{ from: 'main', to: 'app_tick' }, { from: 'app_tick', to: 'drv_read' }, { from: 'main', to: 'nope' }]
  const one = buildFunctionCallGraph(groups, { depth: '1' }, calls)
  assert.deepEqual(one.nodes.map((n) => n.name).sort(), ['app_tick', 'main'])
  assert.deepEqual(one.edges.map((e) => [e.from, e.to]), [['fn:main', 'fn:app_tick']])
  const all = buildFunctionCallGraph(groups, { depth: 'all' }, calls)
  assert.equal(all.edges.length, 2)
  assert.deepEqual(all.nodes.find((n) => n.name === 'drv_read')?.callers.map((c) => c.name), ['app_tick'])
})

test('an empty project yields an empty graph with an honest note', () => {
  const g = buildFunctionCallGraph([], {})
  assert.deepEqual(g.nodes, [])
  assert.match(g.scopeNote, /未识别到函数/)
})
