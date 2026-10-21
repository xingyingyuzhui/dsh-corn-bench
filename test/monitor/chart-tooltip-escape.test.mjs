import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLineOption } from '../../src/ui/monitor/visualization/hooks/viz-chart-options.mjs'

test('chart tooltip must escape series labels before returning HTML', () => {
  const label = '<b data-review-probe>温度</b>'
  const option = buildLineOption(
    {},
    {
      data: [
        [1, 2],
        [10, 11],
      ],
      meta: [{ label }],
    },
    false,
    false,
    2000,
  )
  assert.equal(option.series[0].name, label)
  const html = option.tooltip.formatter([
    { seriesName: option.series[0].name, value: [2000, 11], axisValue: 2000, marker: '' },
  ])
  assert.equal(html.includes(label), false, html)
  assert.ok(html.includes('&lt;b'))
})

test('tooltip keeps the trusted ECharts marker, Unicode labels and numeric formatting', () => {
  const marker = '<span style="background:red"></span>'
  const option = buildLineOption(
    { xMode: 'count', yUnit: '<em>x</em>' },
    {
      data: [
        [1, 2],
        [10, 11],
      ],
      meta: [{ label: '温度 & "压力"' }],
    },
    false,
    false,
    2000,
  )
  const html = option.tooltip.formatter([{ seriesName: '温度 & "压力"', value: [1, 11], axisValue: 1, marker }])
  assert.ok(html.includes(marker))
  assert.ok(html.includes('温度 &amp; &quot;压力&quot;'))
  assert.equal(html.includes('<em>'), false)
  assert.ok(html.includes('11.0'))
})
