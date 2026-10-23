import assert from 'node:assert/strict'
import test from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createHmiView } from '../../bench-hmi.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { makePost, selectConn, t } from '../helpers/hmi-page-fixtures.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })

test('点位表：查看时只显示常用列，编辑点位时显示全部列且顺序固定；当前值加粗', async () => {
  const { post } = makePost()
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('设备1')), { timeout: 8000 })
  const colsOf = (/** @type {Element} */ root) =>
    Array.from(root.querySelectorAll('.dvb-point-table thead tr th')).map(
      (th) => Array.from(th.classList).find((c) => c.startsWith('dvb-col-')) || th.className,
    )
  const card = tree.container.querySelectorAll('.dvb-dev-card')[0]
  const thTexts = Array.from(card.querySelectorAll('.dvb-point-table thead th')).map((th) => (th.textContent || '').trim())
  for (const banned of ['更新时间', '状态', '写入', '读取', '删除']) {
    assert.equal(
      thTexts.some((txt) => txt === banned || txt.includes(banned)),
      false,
      `点位表不得有独立「${banned}」列`,
    )
  }
  // View mode: scale/offset/thresholds fold away; the alarm column summarises the range.
  assert.deepEqual(colsOf(card), [
    'dvb-col-name',
    'dvb-col-monitor',
    'dvb-col-fn',
    'dvb-col-addr',
    'dvb-col-value',
    'dvb-col-unit',
    'dvb-col-alarm',
  ])
  const valueCellEl = tree.container.querySelector('.dvb-point-table tbody .dvb-cell-value')
  if (valueCellEl) {
    assert.equal(valueCellEl.style.fontWeight, '600', '当前值单元格字体加粗 (fontWeight: 600)')
  }
  // Edit mode: every column, thresholds right of the alarm switch.
  const editPts = Array.from(card.querySelectorAll('button')).find((b) => b.textContent === '编辑点位')
  assert.ok(editPts, '设备1有编辑点位按钮')
  await act(async () => {
    editPts.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(colsOf(card).includes('dvb-col-deadband')), { timeout: 6000 })
  assert.deepEqual(colsOf(card).slice(0, 12), [
    'dvb-col-name',
    'dvb-col-monitor',
    'dvb-col-fn',
    'dvb-col-addr',
    'dvb-col-value',
    'dvb-col-unit',
    'dvb-col-scale',
    'dvb-col-offset',
    'dvb-col-alarm',
    'dvb-col-min',
    'dvb-col-max',
    'dvb-col-deadband',
  ])
  const firstRow = card.querySelector('.dvb-point-table tbody tr')
  assert.equal(firstRow?.querySelectorAll('td').length, colsOf(card).length, '每行单元格与表头列数一致')
  tree.unmount()
})

test('编辑设备只改设备栏；编辑点位才进入点位行内编辑', async () => {
  const { post } = makePost()
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('设备1')), { timeout: 8000 })
  const cards = Array.from(tree.container.querySelectorAll('.dvb-dev-card'))
  assert.ok(cards.length >= 2, '两个设备卡片渲染')
  const editDev = Array.from(cards[0].querySelectorAll('button')).find((b) => b.textContent === '编辑设备')
  assert.ok(editDev, '设备1有编辑设备按钮')
  await act(async () => {
    editDev.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(cards[0].querySelector('.dvb-dev-edit-row')), { timeout: 6000 })
  const d1TempRow = Array.from(cards[0].querySelectorAll('tr')).find((r) => r.textContent.includes('温度'))
  assert.ok(d1TempRow, '设备1温度行存在')
  assert.equal(d1TempRow.querySelectorAll('input.dvb-input').length, 0, '编辑设备不进入点位行内编辑')
  assert.ok(
    d1TempRow.textContent.includes('03') || d1TempRow.querySelector('.dvb-val')?.textContent === '03',
    '功能码显示两位数字',
  )
  // 取消设备编辑后进入点位编辑
  const cancel = Array.from(cards[0].querySelectorAll('button')).find((b) => b.textContent === '取消')
  await act(async () => {
    cancel.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  const editPts = Array.from(cards[0].querySelectorAll('button')).find((b) => b.textContent === '编辑点位')
  assert.ok(editPts, '设备1有编辑点位按钮')
  await act(async () => {
    editPts.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(
    () => {
      const row = Array.from(cards[0].querySelectorAll('tr')).find((r) => r.getAttribute('data-editing') === 'true')
      assert.ok(row, '点位行进入编辑态')
    },
    { timeout: 6000 },
  )
  // 设备2卡片的点行仍然文本展示（无 input 行内编辑）
  const d2Row = Array.from(cards[1].querySelectorAll('tr')).find((r) => r.textContent.includes('开关'))
  assert.ok(d2Row, '设备2=开关行存在')
  assert.equal(d2Row.querySelectorAll('input.dvb-input').length, 0, '设备2未进入编辑态')
  tree.unmount()
})

test('添加点位草稿插入当前设备表格内部并固定到该设备', async () => {
  const configCommands = []
  const base = makePost()
  const post = (path, body) => {
    if (/\/command$/.test(path) && body.action === 'config') configCommands.push(body)
    return base.post(path, body)
  }
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('设备2')), { timeout: 8000 })
  const cards = Array.from(tree.container.querySelectorAll('.dvb-dev-card'))
  const d2 = cards[1]
  const editBtn = Array.from(d2.querySelectorAll('button')).find((b) => b.textContent === '编辑点位')
  assert.ok(editBtn, '设备2有编辑点位按钮')
  await act(async () => {
    editBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  const addBtn = Array.from(d2.querySelectorAll('button')).find((b) => b.textContent === '添加点位')
  assert.ok(addBtn, '设备2编辑态有添加点位按钮')
  await act(async () => {
    addBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(d2.querySelector('.dvb-newpoint-row')), { timeout: 6000 })
  const saveBtn = Array.from(d2.querySelectorAll('.dvb-toolbar button')).find(
    (b) => b.textContent === '保存' || (b.getAttribute('aria-label') || '').includes('保存'),
  )
  assert.ok(saveBtn, '工具栏有保存按钮')
  await act(async () => {
    saveBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 50))
  })
  const saved = configCommands.find((item) => item.payload?.operation === 'points.add')
  assert.ok(saved, '持久化调用存在')
  const added = saved.payload.value.points.find((p) => p.deviceId === 'd2' && p.name !== '开关')
  assert.ok(added, '新增点位归属设备2')
  assert.equal(added.connectionId, 'c1')
  tree.unmount()
})

test('编辑态批量添加生成到草稿后统一保存', async () => {
  const configCommands = []
  const base = makePost()
  const post = (path, body) => {
    if (/\/command$/.test(path) && body.action === 'config') configCommands.push(body)
    return base.post(path, body)
  }
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('设备2')), { timeout: 8000 })
  const cards = Array.from(tree.container.querySelectorAll('.dvb-dev-card'))
  const d2 = cards[1]
  const editBtn = Array.from(d2.querySelectorAll('button')).find((b) => b.textContent === '编辑点位')
  await act(async () => {
    editBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  const batchBtn = Array.from(d2.querySelectorAll('button')).find((b) => b.textContent === '批量添加')
  assert.ok(batchBtn, '编辑态有批量添加按钮')
  await act(async () => {
    batchBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(d2.querySelector('.dvb-batch-panel')), { timeout: 6000 })
  const genBtn = Array.from(d2.querySelectorAll('.dvb-batch-panel button')).find((b) => b.textContent === '生成')
  assert.ok(genBtn, '批量面板有生成按钮')
  await act(async () => {
    genBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(d2.querySelectorAll('.dvb-newpoint-row').length >= 1), { timeout: 6000 })
  assert.equal(configCommands.length, 0, '批量生成未立即写入持久化（仅生成草稿）')

  const saveBtn = Array.from(d2.querySelectorAll('.dvb-toolbar button')).find((b) => b.textContent === '保存')
  await act(async () => {
    saveBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 50))
  })
  const saved = configCommands.find((item) => item.payload?.operation === 'points.add')
  assert.ok(saved, '保存后一次性持久化批量点位')
  tree.unmount()
})

test('编辑态点击取消丢弃新增草稿与修改', async () => {
  const configCommands = []
  const base = makePost()
  const post = (path, body) => {
    if (/\/command$/.test(path) && body.action === 'config') configCommands.push(body)
    return base.post(path, body)
  }
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  await selectConn(tree)
  await waitFor(() => assert.ok(tree.container.textContent.includes('设备2')), { timeout: 8000 })
  const cards = Array.from(tree.container.querySelectorAll('.dvb-dev-card'))
  const d2 = cards[1]
  const editBtn = Array.from(d2.querySelectorAll('button')).find((b) => b.textContent === '编辑点位')
  await act(async () => {
    editBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  const addBtn = Array.from(d2.querySelectorAll('button')).find((b) => b.textContent === '添加点位')
  await act(async () => {
    addBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(d2.querySelector('.dvb-newpoint-row')), { timeout: 6000 })
  const cancelBtn = Array.from(d2.querySelectorAll('.dvb-toolbar button')).find((b) => b.textContent === '取消')
  assert.ok(cancelBtn, '工具有取消按钮')
  await act(async () => {
    cancelBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(!d2.querySelector('.dvb-newpoint-row')), { timeout: 6000 })
  assert.equal(configCommands.length, 0, '取消后未发送持久化请求')
  tree.unmount()
})
