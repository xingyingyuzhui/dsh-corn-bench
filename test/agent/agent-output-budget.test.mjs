// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { projectAgentResult, utf8ByteLength } from '../../src/application/commands/agent-result-projection.mjs'
import { AGENT_TEXT_CAPS } from '../../src/application/commands/agent-result-caps.mjs'
import { CORN_GUIDANCE } from '../../src/infrastructure/harness/guidance.mjs'
import { cornBenchTool } from '../../src/interfaces/agent/corn-bench-tool.mjs'

test('corn_bench renders compact JSON so token size matches the budget', () => {
  const tool = cornBenchTool('/tmp')
  const value = { ok: true, points: [{ id: 'p1', name: '温度' }] }
  const rendered = tool.output.render({}, value)
  assert.equal(rendered[0].text, JSON.stringify(value))
  assert.equal(rendered[0].text.includes('\n'), false)
})

test('list projections stay inside the agent text budget', () => {
  const points = Array.from({ length: 400 }, (_, i) => ({
    id: `p${i}`,
    name: '点位'.repeat(40),
    address: i,
  }))
  const projected = projectAgentResult({ action: 'points', op: 'list' }, { ok: true, action: 'points', points })
  assert.ok(utf8ByteLength(projected) <= AGENT_TEXT_CAPS.listBytes)
  assert.equal(projected.truncated === true || projected.overrun === true, true)
})

test('guidance states approval once, in Chinese, without asking the agent for an endpoint fingerprint', () => {
  assert.doesNotMatch(CORN_GUIDANCE, /Writes\/downloads/)
  assert.doesNotMatch(CORN_GUIDANCE, /endpoint fingerprint/)
  assert.match(CORN_GUIDANCE, /Host 会自动绑定端点与配置版本，配置变化后需重新发起/)
  assert.equal((CORN_GUIDANCE.match(/需要用户批准/g) || []).length, 1)
})
