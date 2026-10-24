# 019 Verify 隔离与查询契约：修复验证报告

本报告记录 [2026-10-08-019-verify-isolation-and-query-contract-fix-plan.md](./2026-10-08-019-verify-isolation-and-query-contract-fix-plan.md) 相对审查 [2026-10-08-current-corn-review.md](../reviews/2026-10-08-current-corn-review.md) 的实际执行证据。所有命令在 `dsh-corn-bench/` 内执行；未执行项在 §6 标明，不计入通过。

本轮范围：**R1–R4、R7、R9–R11**。**未做 R5/R6（焦点迁移）、R8（幂等失败终态）**；**未推送**。

## 1. 提交

| 提交 | 内容 |
| --- | --- |
| `5a8bb5f` | `fix(verify): distinguish unavailable observations from assertion failures`（R3） |
| `a2c2cf3` | `fix(verify): authorize run access and bound completed results`（R2） |
| `1777ad2` | `fix(verify): scope telemetry and bind real read results`（R1/R4/no.alarm） |
| `ef4b593` | `fix(evidence): revalidate historical refs on append results`（R7） |
| `b71d558` | `fix(points): inherit omitted view from validated cursors`（R11） |
| `606c4e6` | `fix(agent): clarify query fields and timeline truncation`（R9/R10） |
| 本 docs 提交 | 收录审查、019 计划与本验证报告 |
| 随后 `chore(build)` | 刷新 `build-info.json`（`buildId` 与 published files 指纹一致） |

基线父提交：`ea3057d`（018 evidence focus closure 之后的 build-info）。六组行为提交各自先在父提交上得到红测，再实施转绿。

## 2. 裁定落地对照

| 用户裁定 | 落点 |
| --- | --- |
| 1-a 补读正常留痕 | `verify-telemetry-adapter` 经真实 `modbusRead`；忙/失败 → `READ_FAILED`，不重试、不旧值掩盖；超时/取消保持原状态 |
| 2-a 时长超预算执行前拒绝 | `assertScenarioBudget` → `INVALID_FIELD` + `details.reason=INVALID_VALUE`；剩余不足 → 整体 `timeout`，不缩短窗口 |
| 3-a Agent `ok === (status === 'pass')` | Agent 信封补 `failedCount`/`unverifiableCount`/`errorCode`；完整结果保留断言 `outcome`/`reason`；RPC 与 Agent 契约分测 |
| 4 删除静态点值兜底 | `telemetry-reader` 去掉 `points[].value`；测试改用带 `at`/provenance 的运行值；新增“仅静态配置 → unverifiable” |
| 5 通信来源边界 | 可见+唯一归属+enabled+`polling.enabled`+真实 `lastAt`+明确 `lastOk`；未首轮 → `NO_ALARM_SOURCE`；停轮询后仍有 active 通信告警仍计入 |

## 3. 验收矩阵（本地单测）

| 组 | 行为 | 主要新测 / 既有绿测 |
| --- | --- | --- |
| R3 | unavailable ≠ fail；unverifiable → run `error` | `test/verify/verify-outcome-contract.test.mjs` |
| R2 | 分区 `SESSION_REQUIRED`；run 作用域；`RUN_ID_REUSE`；completed 50/1h | `test/verify/verify-run-scope.test.mjs` |
| R1/R4 | 跨会话不可读；补读绑定 `values[]`；静态值不可验证；`no.alarm` 来源 | `verify-telemetry-scope` / `verify-alarm-scope` |
| R7 | append 成功结果与 status 同投影；磁盘保留不可验证历史行 | `test/agent/evidence-append-history.test.mjs` |
| R11 | 省略 `view` 继承游标；显式不一致 / 过滤器变 → `CURSOR_EXPIRED` | `test/agent/points-view-inherit.test.mjs` |
| R9/R10 | points list `kind`/`id` 拒绝；`summaryTruncated` / `budgetTruncated` | `query-field-applicability` / `timeline-truncation-meta` |

## 4. 门禁实测（docs 提交前）

```
npm run -s test:unit     → 1781 pass / 0 fail
npm run -s lint          → ok
npm run -s typecheck     → ok
npm run -s deps:check    → no dependency violations
npm run -s structure:check / assertions:check / facades:check / pack:check → ok
git diff --check         → ok
```

未扩大 `structure-budget` allowlist。新增 verify 模块已列入 `package.json` `files`。

## 5. 新增 / 关键模块（摘要）

- `src/domain/verify/observation.mjs`、`errors.mjs`；断言 `outcome`/`reason`
- `src/application/verify/verify-run-registry.mjs`、`verify-point-scope.mjs`、`scoped-point-reader.mjs`、`verify-alarm-scope.mjs`
- `verify-telemetry-adapter.mjs` 迁至 `src/application/verify/`（依赖方向）
- `evidence-append-service` 成功路径走 `projectVisibleFocus`
- `points-list-page` 游标后决议 `view`；`agent-query-fields` 适用表；timeline `summaryTruncated` / `budgetTruncated`

## 6. 未执行 / 未宣称

- **R5/R6** 多会话焦点存储迁移；**R8** 幂等失败终态
- **未推送** remote；发布需另行授权
- Web/Desktop 真实 Agent 安装验收（cursor 回填、verify 作用域、buildId 核对）未在本轮跑；API 单测不能代替安装验收
- 无物理硬件写入验收；sim 路径已覆盖补读与告警来源边界
