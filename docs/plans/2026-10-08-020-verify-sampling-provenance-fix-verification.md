# 020 真实采样时窗与来源信任：修复验证报告

本报告记录 [2026-10-08-020-verify-sampling-provenance-fix-plan.md](./2026-10-08-020-verify-sampling-provenance-fix-plan.md) 相对 [019 落地复审](../reviews/2026-10-08-019-followup-review.md) 的实际执行证据。所有命令在 `dsh-vision-bench/` 内执行；未执行项在 §6 标明，不计入通过。

本轮范围：**S1–S6**。**未做 R5/R6（焦点迁移）、R8（幂等失败终态）**；**未推送、未发布**。

## 1. 提交

| 提交 | 内容 |
| --- | --- |
| `ba15e8e` | `fix(verify): require complete sampling windows and trusted sample identities`（S1+S2） |
| `1102ef5` | `fix(verify): validate legacy alarm owners and changed baselines`（S3+S4） |
| `f7e4071` | `fix(modbus): keep sampleGenerations cold-start off session bind`（S2 跟进：Host bind 不发明代次） |
| `4263eb4` | `fix(agent): validate status and trend fields with consistent hints`（S5+S6） |
| `b1cf2fb` | `fix(modbus): accept layered sample stamps and preserve ambiguous values`（提交对齐 / 歧义值保留 / 结构拆分） |
| `e04407f` | `fix(verify): satisfy typecheck and lint for stable sampling` |
| 本 docs 提交 | 收录 019 复审、020 计划与本验证报告 |
| 随后 `chore(build)` | 刷新 `build-info.json` / `client.js`（`buildId=5baff237…`，`gitSha` 对齐 docs 父提交） |

基线父提交：`54581d0`（019 build-info）。五条 `/tmp` 红测已迁入仓库（adapted，非原文复制）。

## 2. 裁定落地对照

| 裁定 | 落点 |
| --- | --- |
| Q1/Q2/Q3 stable 完整窗口 | `createStableWindow` + `sampleStableDuration`：`allowDirectRead=false`；≥2 严格递增 timestamp 且覆盖 `durationMs`；历史 `timestamp < startedAt` 不计；不足 → `INSUFFICIENT_SAMPLES` / run `error`/`VERIFY_UNVERIFIABLE` |
| Q4/Q5 A+B 来源 | `sampleGenerations` + `sampleIdentity`；`prepareConfigPersistence` 几何/owner 失效清 values；producer 在 I/O 前盖章；commit 按 layered 身份验收 |
| Q6 失败屏障 + 额度 | 新 bad 压旧 good；run-local `createDirectReadBudget` 每 `[cwd,sid,pointId,generation]` 一次；stable 不补读 |
| Q7/Q8 legacy alarm | owner 先于 ID 归并；分区无主隐藏；显式外国不降格无主；诊断不泄外国 id |
| Q9/Q10 changed baseline | 注册前 `INVALID_FIELD`/`INVALID_VALUE`；领域 `INVALID_SAMPLE` 兜底；拒绝 `NaN`/`±Infinity` 字符串 |
| Q11/Q12 查询 | status/trend 拒顶层 kind/id；通用 hint 不再冒用 points list |

## 3. 验收矩阵（本地单测）

| 组 | 主要新测 |
| --- | --- |
| S1 stable | `test/verify/verify-stable-window.test.mjs` |
| S2 provenance / poll failure | `verify-sample-provenance` / `verify-poll-failure` |
| S3 alarm owner | `verify-alarm-scope`（含外国 legacy 红测） |
| S4 baseline | `verify-changed-baseline.test.mjs` |
| S5/S6 query | `test/agent/query-field-applicability.test.mjs` |

## 4. 门禁实测（docs 提交前）

```
npm run -s test:unit          → 1807 pass / 0 fail
npm run -s lint               → ok
npm run -s typecheck          → ok
npm run -s deps:check         → no dependency violations
npm run -s structure:check / assertions:check / facades:check / ui:ownership:check → ok
npm run -s build:check / pack:check → ok（pack 刷新 build-info）
git diff --check              → ok
```

Harness（`dsh-vision-harness`）`npm test` → **25 pass / 0 fail**。

## 5. 新增 / 关键模块（摘要）

- Domain：`point-sample-identity`、`sample-generation`、`prepare-config-persistence`、`stable-window`、`point-runtime-values`
- Application：`sample-identity-producer`、`write-sim-execute`；verify sampling/reader/adapter/service；alarm-scope；agent-query-fields
- Persistence：repository `prepareConfigPersistence` 注入；migration 保留 `sampleGenerations` / `sampleIdentity`

## 6. 未执行 / 未宣称

- **R5/R6** 焦点迁移；**R8** 幂等失败终态
- **未推送** remote；**未** registry `name@version` 正式产品安装
- Desktop lab / Web 真实 Agent fiber 验收：门禁后另行记录；失败或受阻标未验证，不桥接 Web 端口、不强杀 Harness
- 无物理硬件写入验收
