import assert from 'node:assert/strict'
import test from 'node:test'
import { CSS } from '../../bench-styles.mjs'
import { ATTR } from '../../src/ui/styles/base.mjs'
import { PROJECT_CSS } from '../../src/ui/styles/project.mjs'

test('工程结构 CSS 正确插值 data-dsh-corn-bench，缩放条不盖住输入框', () => {
  const css = PROJECT_CSS.join('\n')
  assert.equal(ATTR, 'data-dsh-corn-bench')
  assert.match(css, /body\[data-dsh-corn-bench\] \.dvb-project\{/)
  assert.doesNotMatch(css, /body\[\$\{ATTR\}\]/)
  assert.match(CSS, /body\[data-dsh-corn-bench\] \.dvb-project\{/)
  assert.match(css, /\.dvb-graph-host\{[^}]*isolation:isolate/)
  assert.match(css, /\.dvb-graph-zoom-bar\{[^}]*z-index:0/)
  assert.doesNotMatch(css, /\.dvb-graph-zoom-bar\{[^}]*z-index:10/)
  assert.doesNotMatch(css, /\.dvb-graph-zoom-bar\{[^}]*--dsh-composer-height/)
})

test('源码预览覆盖整张卡片：flex 链无固定高度上限', () => {
  const css = PROJECT_CSS.join('\n')
  // The preview body → code box → editor wrapper → CodeMirror host must each
  // pass a definite flex height down, otherwise the editor stopped part-way and
  // the lower half of the card stayed blank (field report: dataexchange.c).
  assert.match(css, /\.dvb-project-preview-body,\.dvb-preview-code-box,\.dvb-preview-editor-wrap\{[^}]*flex:1 1 auto[^}]*min-height:0/)
  assert.match(css, /\.dvb-preview-code-box,\.dvb-preview-editor-wrap\{[^}]*display:flex;flex-direction:column/)
  assert.match(css, /\.dvb-source-editor\{[^}]*min-height:0[^}]*height:100%/)
  assert.match(css, /\.dvb-source-editor\{[^}]*overflow:hidden/)
  assert.doesNotMatch(css, /\.dvb-source-editor\{[^}]*min-height:200px/)
})
