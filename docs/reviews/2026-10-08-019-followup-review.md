# 019 落地复审：结合 Harness 第九轮反馈

日期：2026-10-08。审查基线：`54581d0`，版本 0.29.28。对比起点：018 的 `ea3057d`。审查开始时工作树干净；019 有六个行为提交、一个 docs 提交和一个 build-info 提交。

依据：[019 计划](../plans/2026-10-08-019-verify-isolation-and-query-contract-fix-plan.md)、[实现方交付报告](../plans/2026-10-08-019-verify-isolation-and-query-contract-fix-verification.md)、[Harness 第九轮实测](/Users/qin/DSH/corn-plugin-round9-verification.md)。原报告和计划未修改。

结论：019 的主要修复确已落地，原先 runId 跨会话查询/取消、scoped miss 裸读回退、undefined 当前值判 changed 通过、顶层 res.value 适配错误等核心复现已有对应覆盖。但当前仍有 **2 项 P1、3 项 P2、1 项 P3**，不能将本轮视为完整验收通过。第九轮仅测 corn_bench 查询，没有测 corn_debug/verify 和游标回填；它发现的字段与 hint 问题是真实的，也不足以排除下列 verify 问题。

## 1. 本次验证

| 检查 | 本次结果 |
|---|---|
| bench `npm run test:unit` | **1781/1781 通过**，0 失败/跳过 |
| Harness `npm test` | **25/25 通过** |
| lint / typecheck / deps / structure / assertions / facades / ui:ownership | 通过 |
| build:check | 通过 |
| check-build-info / check-package | 通过，buildId `f7f96d3eab1d…`，553 个 files 条目，导入闭包完整 |
| git diff --check ea3057d..HEAD | 通过 |
| 额外独立复现 | **5 个预期行为断言均失败**，证实剩余缺口；未混入现有单测计数 |
| Web/Desktop 安装、物理硬件 | 本次未执行；第九轮也未提供这些核心场景的验收 |

独立红测：[临时复现脚本](/tmp/corn-review019-extra.test.mjs)，输出：[复现日志](/tmp/corn-review019-extra.log)。脚本只使用内存或临时 home/cwd，真实 points update 使用 sim 配置；没有读写用户工作区或操作物理设备。临时文件便于继续核对，不是已纳入仓库的回归测试。

本次直接执行 build-info/package 检查器，没有用会重新生成 build-info 的 pack:check。build-info 的 gitSha 为 `5695ba9`，与第九轮标识一致；源码指纹通过，不能因它不是包含生成文件的 HEAD 而误判旧包。第九轮的 pid/configVersion 属于当时运行态观察，本次未再次操作该实际环境。

## 2. 剩余发现

| 编号 | 优先级 | 问题 | 证据 |
|---|---|---|---|
| S1 | P1 | stable-for-duration 用同一历史记录重复凑出“持续采样”，仍可错误 pass | production 默认 reader + verify service 红测 |
| S2 | P1 | 几何失效后重新接纳旧 runtime 值；新的失败 poll 又可被旧成功缓存掩盖 | 真实 points update + adapter；最新失败记录 + verify service 红测 |
| S3 | P2 | 旧 alarms[] 的显式外国 owner 未校验，仍影响本会话 no.alarm | 分区内存工作区 + countSessionAlarms 红测；service 另行复现 |
| S4 | P2 | changed 未验证非有限初值，Infinity/NaN 仍可判变化通过 | verify service 红测 |
| S5 | P2 | kind/id 适用表遗漏已知查询 status/trend | 源码及第九轮实测；属于 R9 未收齐 |
| S6 | P3 | alarm/timeline 的 kind hint 写成 points list 规则 | 源码与第九轮一致（A-15） |

### S1：等待经过了，不代表获得了整个时窗的采样

位置：[verify-sampling.mjs:111](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/verify/verify-sampling.mjs:111)、[scoped-point-reader.mjs:122](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/verify/scoped-point-reader.mjs:122)。

stable 采集器每次 readPoint 后取 value 并 push；结束条件使用 Date.now()-sampleStart，却不检查 reading.timestamp 是否前进。默认 reader 会不断返回同一 runtime/cache 记录。一个合法的历史记录就能被重复记成五个样本，经过 80ms 等待后判“持续稳定”。

已复现（一次旧记录，无任何新发布、poll 或设备读取）：

```json
{"status":"pass","samples":5,"distinctSampleTimestamps":1,"firstToLastSampleMs":0,"runDurationMs":82}
```

复现既覆盖一分钟前的记录，也覆盖执行前刚生成的记录；不是通过增加全局 maxAgeMs 就能完整修复。当前测试 `stable-for-duration samples the full window` 用 reader 每次产生新的 Date.now()，因此没有走真实缓存复用路径。

修复建议：采集阶段保留采样时间/身份，区分“再次检查缓存”与“新的采样”。重复同一记录不能增加有效 sampleCount 或覆盖时长。稳定窗口需要真实样本的时间覆盖原请求窗口；数据未更新则在该窗口结束时不可验证，不能把等待时间当作证据。沿用整体 timeout/cancelled 优先级，不自动在每个 interval 强制补读硬件；可等待有效 poll/publish 或使用明确受控的新读点策略。只有经过覆盖检查的数值才交给 judgeStable。

验收：冻结缓存不 pass；缓存 maxAgeMs 尚未过期仍不能伪造时间覆盖；真实新样本覆盖时窗可 pass；中途坏样本不可跳过；重复时间戳、覆盖不足、停止轮询、超时/取消均有行为测试。需至少一个测试贯通生产 reader，而非全部用每次返回 now 的 fake。

### S2：身份指纹不能证明 runtime 值来自当前配置

位置：[scoped-point-reader.mjs:118](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/verify/scoped-point-reader.mjs:118)、[verify-point-scope.mjs:101](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/verify/verify-point-scope.mjs:101)、[point-service.mjs:210](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/modbus/point-service.mjs:210)。

两个实际出口：

1. **改地址后旧 runtime 行被重新授予新指纹。** 内存 cache 的 fingerprint 确实变化，但 selectPointQueryValue 只检查 point/connection/device，runtime record 没有几何代次。旧地址的 values 行仍被认作合法 poll 值，再写入新 fingerprint 的缓存。
2. **最新 poll 失败被较旧 good cache 掩盖。** pollUsable=null 后 best 仍选缓存 good，忽略已有的更新失败记录，既不报告质量问题也不尝试受控补读。

第一项使用真实 Host `points op=update`，在临时分区工作区将 p1 地址 0 改成 5；更新成功后 adapter 仍返回旧值 77，read-serviceCalls=0：

```json
{"updateOk":true,"address":5,"previous":77,"next":77,"source":"poll-cache","reads":0}
```

现有 revoke/delete/rebind 测试只 publish 内存样本，没有同时留下已提交的 runtime.values，所以能通过却没有覆盖真实状态。第二项先读有效 p1=9 建缓存，再让 repository 当前值成为更新的 ok=false 记录，并让补读 provider 返回失败；verify 仍 pass、actual=9、补读次数=0。

修复建议：让采样携带可验证的几何/配置代次，或在配置事务中明确失效受影响点的运行值；不能只失效 adapter 的内存 map。覆盖地址/function/unit、解码规则和实际设备绑定变化，元数据改名不必全部清空值。新配置没有可信采样时，采用已裁定的一次补读或不可验证。poll/read/write 提交和 normalize 必须保留用于验证的采样身份；未经证明的旧行不能仅凭当前 pointId 被赋予新身份。

reader 选择最新记录时也要保留失败/坏质量状态，不能先过滤失败再选择“最后一次成功”。新失败可触发一次受控补读；补读失败仍不可验证，不回退旧 good。补测试：真实更新后持有旧 values、冷启动只读旧值、最新错误覆盖旧 cache、补读失败、补读恢复，以及名称变更不误伤。

### S3：旧告警的显式 owner 不能被当前 pointId 可见性取代

位置：[verify-alarm-scope.mjs:53](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/verify/verify-alarm-scope.mjs:53)、[verify-alarm-scope.mjs:93](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/verify/verify-alarm-scope.mjs:93)。

legacyAlarmState 把旧行放进 id 字典，不比较 row.sessionId；filterAlarmStateForSession 只按当前连接/点身份筛选。A 当前唯一拥有 p1，不代表一条显式标为 B 的历史 p1 告警属于 A。

分区 fixture 中 A 有带规则的 p1、B 为空，旧 alarms 行 `{id:'old-b-alarm',pointId:'p1',sessionId:'b',active:true}`；A 的 countSessionAlarms 返回 1。service 复现亦为 status=fail、actual=1。它不是泄露外国详细记录，但会把外国历史活动算入 A 的验证，违反计划“归属与目标都能证明”的约束。

修复建议：转换旧 alarms 前校验显式 owner 与调用方；按实际旧字段契约处理 sessionId/ownerSessionId，不猜第一个当前 owner。无主旧行沿用已定兼容边界，分区环境不能无条件归属给当前点；如无法证明，应隐藏该外国旧行或将本会话不确定来源标不可验证，不能计作 A 的活动告警。不要改掉“本会话合法 active 告警停轮询后仍计入”的规则。先按归属过滤，再构建 ID 索引/去重，避免外国同 ID 覆盖本会话合法行。

### S4：changed 的初值只查 null，没有查有效性

位置：[verify-assertion-eval.mjs:49](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/verify/verify-assertion-eval.mjs:49)、[assertion.mjs:289](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/domain/verify/assertion.mjs:289)。

当前值已做 scalarProblem，初值仅检查 undefined/null。Infinity 初值、实际合法 10 得到：

```json
{"status":"pass","outcome":"pass","actual":10,"expected":"changed (from Infinity)"}
```

这是 service/领域入口复现，不宣称第九轮 Harness 传过非有限 JSON 数值。计划已经要求非有限数不能当有效比较数据，领域入口仍应满足该不变量。

修复建议：对初值复用有效 scalar 校验。缺初值继续 BASELINE_MISSING；非有限初值在场景校验阶段 INVALID_FIELD/INVALID_VALUE，领域 evaluateAssertion 防御性返回 unverifiable/INVALID_SAMPLE。避免通过 String 或 Number 的比较兜底给无效初值判 pass。保留 0/false、expected 别名与有效初值相同则 fail。

### S5/S6：第九轮的查询反馈准确，但表尚未收齐

位置：[agent-query-fields.mjs:93](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/commands/agent-query-fields.mjs:93)、[agent-query-fields.mjs:212](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/commands/agent-query-fields.mjs:212)。

inFieldTable 枚举 points/timeline/focus/evidence/frames/alarm/visualization，却没有 status/trend；这两个已知查询因此静默接受无效果的 kind，id 同样缺适用校验。cursor/view 不受此表限制，已有拒绝不能证明 kind/id 已一致。不要以“不扩大到所有参数”解释已知查询遗漏。

补齐 status/trend 的 kind/id 规则，保持合法过滤参数和非 Agent 宽松兼容；Host/preflight 两出口一起测。top-level kind 的合法 focus 行为无需实现新能力；handler 已将其映射为 target.kind，第九轮没测写操作不能得出该功能不存在。

通用 kind hint 中的最后一句是固定 `points list 的 kind 不是过滤器`，所以 alarm/timeline 也回相同文字。可删除该专属分句，用公共正确提示，或按 action/op 生成。需增加文案与 action 一致测试，不能只断 errorCode/reason。

## 3. 对第九轮报告的保留与纠正

- A-14 部分落地、A-15 的 hint 问题：实测与源码一致，保留。
- A-11 不再新增业务修复：status.log 是无归属短日志的隔离设计，tool 已明确说明 logHiddenCount 不是可读条数/未读计数。timeline 只提供当前会话事件，并非那 8 条日志的完整替代，不建议删除兼容字段。
- `trend total:0` 不能仅凭 polling.enabled=false 断定原因。查询默认过去五分钟，并读取已有历史序列，停止轮询不必然清掉窗口内历史；要结合时间窗和存储/可见性确认。此处纠正解释，不另列回归故障。
- timeline kind/source 过滤是增强建议，019 未承诺实现。若以后增加，要让过滤器与游标契约一起设计，不能只在首页 filter。
- report 的“所有收敛项均未回退”只能限定其实际重复测试的调用；verify、evidence 追加、focus 写入、真正 cursor 续页仍未测。15 项进度不是整个插件的缺陷总量或质量百分比。

## 4. 建议后续顺序

先修 S1/S2，保证“通过”来自正确配置和真实采样时窗；再收齐 S3/S4 的输入及历史来源校验。S5/S6 可作为独立查询契约小提交。继续保持每组真实复现红→绿，不靠 fake reader 每次生成 now 来替代生产缓存行为。

R5/R6 焦点迁移与 R8 幂等失败终态仍按原计划延期，没有把它们当成 019 新回归。上述修复后，再安排 Web/Desktop 真实工具调用、两会话 verify、游标回填及 evidence 追加验收；sim 不能替代物理设备验收。

本次只新增本审查文档及 /tmp 复现材料，未修改业务代码、原计划或用户实测报告，未提交/推送。
