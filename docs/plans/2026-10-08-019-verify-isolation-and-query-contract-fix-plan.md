# 019：verify 隔离、判定与查询契约修复计划

日期：2026-10-08。基线：`ea3057d964249553433b6ec672068a486e87c5de`（0.29.28）。

依据：[当前审查报告](../reviews/2026-10-08-current-vision-review.md)、[Harness 第 5–8 轮实测](/Users/qin/DSH/vision-plugin-rounds5-8-verification.md)。本文件裁定实施语义；本次仅制定计划，未修改业务代码、提交或推送。

## 1. 范围与十一项裁定

| 问题 | 裁定 |
|---|---|
| Q1 本轮范围 | 做 R1–R4、R7、R9–R11，共 8 项。R5/R6 焦点迁移、R8 幂等失败终态另轮实施 |
| Q2 焦点计划与短期释放 | R5/R6 单独制定迁移计划，再实施。不在 019 加 release/clear 入口；它不能解决同时存在的两会话焦点，反而新增需要迁移的授权入口 |
| Q3 提交与推送 | 直接在本地 018 基线上实施，不以先推 018 为前置条件。019 代码按行为分组提交；审查、计划及交付报告独立 docs 提交纳入同一交付。不主动推送；远程同步留给明确授权的发布步骤 |
| Q4 无法验证 | 保留顶层 VerifyStatus 枚举。断言增加 outcome=pass/fail/unverifiable；unverifiable 时 pass=false，并带 reason。非取消/超时的正常聚合中，只要存在 unverifiable，整体 status=error；有效数据不满足期望才算 fail |
| Q5 无目标 no.alarm | 仅检查当前会话有效的已存告警状态；无有效告警来源则 unverifiable/NO_ALARM_SOURCE，不判 pass。具体来源与覆盖规则见第 3 节 |
| Q6 分区匿名 verify | run/status/cancel 均拒绝 SESSION_REQUIRED，不提供“匿名只能看共享点”的例外 |
| Q7 匿名 run / 保留 / 重复 ID | 未分区工作区保留匿名兼容，但只允许同 cwd、同匿名归属查询/取消；不是有 sid 调用方可认领的 run。completed records 全服务最多 50 个唯一 run，完成后 TTL=1 小时。重复外部 runId 在 active 或保留的 completed 中存在时返回 CONFLICT，details.reason=RUN_ID_REUSE |
| Q8 幂等后续方向 | R8 不在本轮改。后续仅显式列入的无副作用查询可在 executor throw/reject 后受控重试；有副作用且结果不明使用通用 COMMAND_OUTCOME_UNKNOWN，不能把 build/focus/config 伪装成 WRITE_OUTCOME_UNKNOWN。具体状态机与淘汰方案见第 8 节 |
| Q9 summary 续页 | 未显式传 view 时，合法 cursor 中的 view 可继承；显式不一致仍拒绝。cursor 不能改变可信 session/cwd 授权 |
| Q10 字段适用表 | 本轮仅覆盖 kind/id/cursor/view。points list 的 kind/id 均 INVALID_FIELD；保留其他已实现的合法别名与入口，不能用全局黑名单 |
| Q11 截断字段 | 保留旧 truncated 行为；事件增加 summaryTruncated，Agent timeline 投影增加 budgetTruncated。本轮不统一旧字段语义 |

019 不迁移 runtime.json，不改变 poll 的身份允许/拒绝规则，不修改 points list 的默认 20/最大 50，也不放开 status.log 的隐藏策略。A-12 是证实既有行为；A-11 的 tool 说明已有，不再列业务修复。

## 2. verify 结果契约（R3，并供 R1/R4 使用）

修改落点：

- `src/types/verify.d.ts`：AssertionResult 增加 outcome 与 reason；VerifyResult 增加 unverifiableCount 和可选 errorCode。顶层状态仍为 pass/fail/error/timeout/cancelled。
- `src/domain/verify/result.mjs`：显式聚合不可验证项并生成独立摘要，不能出现“执行异常 undefined”或将不可验证项描述为设备不满足期望。
- `src/domain/verify/assertion.mjs`：检查数据可用性后再比较。
- `src/application/verify/verify-service.mjs`、`verify-assertion-eval.mjs`、`verify-sampling.mjs`：保留采样失败原因，停止 catch 后统一洗成 undefined 的处理。
- Agent/RPC、日志及存在的结果 UI 消费者：保留 outcome/reason/unverifiableCount，不因投影预算删掉这些判断字段。

新增统一的可用性结果 helper（建议 `src/application/verify/verify-observation.mjs`），区分：

```js
// 内部采样契约；不得靠对象是否 truthy 判断采样有效。
{ availability: 'available', reading: { value, rawValue, timestamp, quality, provenance } }
{ availability: 'unavailable', reason: 'DATA_MISSING' /* 等 */, message }
```

原因至少覆盖 DATA_MISSING、STALE_VALUE、TARGET_UNAVAILABLE、AMBIGUOUS_OWNER、READ_FAILED、BASELINE_MISSING、NO_ALARM_SOURCE。外部不可见/不存在目标统一 TARGET_UNAVAILABLE，不回传其他会话 owner、设备配置或值。内部未预料异常仍是 error，不能假装成普通采样缺失。

断言输出示例：

```json
{"id":"a1","type":"changed","pass":false,"outcome":"unverifiable","reason":"DATA_MISSING","actual":null,"expected":10,"message":"当前无可用采样，无法判断是否变化"}
```

聚合规则：

1. 显式取消与超时保留原有 cancelled/timeout 语义及已完成断言；不可验证结果不能覆盖它们。
2. 未预料执行异常为 error；正常执行但存在不可验证项也为 error，后者 result.errorCode=VERIFY_UNVERIFIABLE。
3. 没有不可验证项，存在有效比较失败则 fail，否则 pass。空 assertions 继续沿用现有场景校验拒绝，不产生“零项全部通过”。
4. passedCount 仍统计 pass=true；failedCount 为 totalCount-passedCount，保持既有兼容。unverifiableCount 是 failedCount 的子集，真实比较失败数为 failedCount-unverifiableCount。摘要必须同时列“比较失败”和“无法验证”，避免混淆。
5. RPC ok=true 仅表示返回了执行结果，不表示验证通过；通过只看 result.status=pass。请求层错误（如 SESSION_REQUIRED）仍为 ok=false。Agent `vision_debug verify` 保持现有 `ok = (status === 'pass')`，fail/error/timeout/cancelled 均 ok=false；外层补 failedCount、unverifiableCount 和存在时的 errorCode，完整 verifyResult 保留每条 outcome/reason。两入口的 ok 契约不同，文档和测试明确区分，不强行统一。

changed 初值优先沿用规范化后的 spec.value（createScenario 已处理 expected 别名）；缺初值为 BASELINE_MISSING，不新增自动采集初值功能。undefined/null、NaN/Infinity、坏质量、过旧数据均不能成为有效数值；0/false 合法。range/stable 的数值转换前必须先判空；stable 采样期间出现不可用样本即不可验证，不能删掉坏样本后拿剩余样本判 pass，也不能缩短 duration 后宣称满足原时长。

稳定时长裁定：按实际生效的场景超时校验（包括调用方 timeoutMs 覆盖）。durationMs 缺省 1000ms；显式值必须为有限正数，不用 `Number(x) || 1000` 把非法值洗成缺省。要求 durationMs 大于实际总 timeoutMs 时，在注册 run/启动任务/采样前拒绝：`ok:false, errorCode:INVALID_FIELD, details:{field:'durationMs',reason:'INVALID_VALUE',durationMs,timeoutMs}`。沿用现有 INVALID_FIELD 错误分类，不新建顶层 INVALID_VALUE 码。多个断言或 setup 已耗时，开始 stable 时剩余预算不足原 duration，则整体 timeout；不改成 unverifiable，也不缩短时长。删除 Math.min(timeoutMs,durationMs)，采样按原始时窗执行并覆盖结束边界；signal/deadline 始终有效，取消仍 cancelled。用可控 clock 测超过总预算、前序耗时、边界时长与完整采样覆盖，不靠真实长 sleep。

新鲜度使用同一 helper：显式 maxAgeMs 优先，超过该上限为 STALE_VALUE；缺省保留现有 adapter 的 Infinity（本轮不另加全局 5 秒阈值）。所有 reader 均遵守；原始质量已标 stale/error 的行不能因缺省 Infinity 升级为 good。不能用 Date.now() 替换缺失记录时间来伪造新鲜采样。若需要强制全局 freshness SLA，另定与实际轮询周期匹配的配置；本轮不宣称缺省 maxAgeMs 已保证实时性。

## 3. 采样、直接读点与 no.alarm（R1/R4）

### 3.1 作用域与 reader 契约

主要文件：

- `src/infrastructure/modbus/verify-telemetry-adapter.mjs`
- `src/application/verify/telemetry-reader.mjs`
- `src/application/verify/verify-sampling.mjs`
- `src/application/verify/verify-assertion-eval.mjs`
- `src/application/verify/verify-service.mjs`

新增或抽出 `verify-point-scope.mjs`，复用 repository loader、会话投影、pointRuntimeVisible、resolveEffectivePointIdentity、selectPointQueryValue；不另写一套平面 pointId 判断。

每次读取使用同一次 repository load 获得的 layered workspace 构建可见配置并选择 values；先检查分区匿名、目标可见性与有效身份，再命中缓存或发起读取。唯一有效身份才能使用现有旧 provenance 兼容；双私有歧义不因 normalize 补字段而解开。

reader 统一为 `readPoint({cwd, sessionId}, pointId, {signal, maxAgeMs})`，作用域来自独立调用上下文。删除 scoped miss → `readPoint(pointId)` 回退；默认 telemetry-reader 也升级，不只修生产 adapter。旧测试/外部 reader 如需兼容，构造时显式声明其绑定作用域并接适配器；分区环境缺少可证明作用域的 reader 返回不可验证，不自动降级。

liveCache/listeners 使用 JSON tuple `[cwd, sessionId, pointId]`，记录经过校验的 point/connection/device 及几何身份指纹。删除全局 pointId alias；缓存命中重新核对当前身份与 provenance。配置删除、换绑定或撤回共享时，旧缓存不能复用。发布/订阅接口同样携带作用域，找全调用者后调整；不得选第一个私有 owner 来补 sessionId。

纯作用域判定、有效缓存命中和来源拒绝不落盘 claim、不改 configVersion，也不创建 read 任务。查询安全 helper 的身份规则与 poll 行为保持不变。拒绝不可见/歧义目标必须发生在调用 read-service 之前，而不只是 transport 之前。

默认 reader 删除 points[].value/rawValue 静态配置兜底及其 Date.now() 伪时间戳，仅接受可验证的运行值或受控动态 reader。verify-productization 等依赖静态值的测试改用有真实 at/provenance 的运行值 fixture；新增“只有静态 point.value 时不可验证”断言，不能通过测试 fake 偷偷保留生产兜底。

### 3.2 真实 read-service 响应

补读副作用裁定：选择复用现有有留痕 read-service。verify 是可触发设备读取的验证动作，不属于纯查询白名单；本计划不增加“无痕补读”入口、不关闭日志/报文/运行值提交。作用域合法但运行值缺失或不可用时，可按现有补读策略调用一次真实 read-service，允许该调用执行正常 durable claim、任务创建、报文/值/告警运行态提交和操作日志。不得为修 adapter 修改手动 read 的既有语义。

read-service 返回忙、失败或无有效目标结果时，本次采样为 READ_FAILED（可附 readErrorCode 表达已知子错误），不等待别人的任务、不自动循环重试、不使用旧缓存将失败转成功。明确区分来源拒绝与补读失败：前者绝不进入 read-service；后者一旦调用该 service，可能已发生 claim/任务留痕，不能承诺“拒绝补读后磁盘完全不变”。abort/deadline 按既有 timeout/cancelled 规则，不洗成 READ_FAILED。tool 文案说明 verify 可能补读及留痕，测试验证实际副作用与拒绝路径的差别。

先解析并验证实际 point/device 路由，再按当前生产 read-service 契约传 connectionId/deviceId/pointId、可信来源和 signal。从 `res.values[]` 中选唯一、身份匹配的有效行，映射 value/raw/at；不再取不存在的顶层 res.value。

res.ok=true 不能证明有采样。缺行、重复目标行、provenance 错配、行 ok=false 或无实际值均不可缓存为 good。values/readings 两者用途以实际 read-service 实现为准，不用“第一条对象”兜底。保留 raw=0/value=0 和合法 false。

使用真实 sim read-service → adapter → verify 做贯通测试，不能只写返回 `{ok:true,value:260}` 的假 service。结果出现 error/unverifiable 时，telemetrySamples 不得夹带外国点或把 undefined 序列化成“成功采样”。

### 3.3 no.alarm 的本轮定义

定义为“当前会话有效来源的当前已存告警状态没有活动告警”，不宣称物理设备已被全面监测或从未发生告警。使用同一 workspace 的有效配置 + filterAlarmStateForSession，旧 alarms 仅在归属和目标都能证明时纳入；同一个告警不能因同时存在新旧容器而重复计数。

无目标时检查本会话完整的有效告警来源集合；外会话告警不计入。来源至少包括启用且有实际阈值的有效点位，以及当前可安全归属的通信告警来源。仅有普通点位、但未启用规则，不自动成为“已判定无告警”的来源。

通信来源裁定：没有阈值点位时，只有可见且归属唯一、配置已启用、运行态 polling.enabled=true 的连接可作为通信监测候选。仅 enabled=true 尚不能证明已监测；至少已有真实 polling.lastAt 和明确 lastOk 才能用作“无活动告警”的来源，尚未首次轮询时 NO_ALARM_SOURCE。停止/禁用/外国/歧义连接不能为 pass 提供覆盖依据。此资格规则不用于删除合法已存 active 告警：停止轮询后仍存在的本会话 active 通信告警仍计入并使断言 fail，不因关闭轮询而伪装恢复。增加仅通信来源成功/失败、未首次轮询、停轮询无历史状态、停轮询仍有 active、跨会话与歧义连接测试。

没有可判定来源 → NO_ALARM_SOURCE。显式 pointId 不可见/不存在 → TARGET_UNAVAILABLE。当前可见告警来源存在运行身份歧义等不可确认项时，不能过滤掉该项后宣称全会话无告警，返回不可验证。有效来源集合明确且无 active 记录可返回 0，不要求所有从未触发告警的点都有 recovered 历史行；有 active 记录返回正数并按断言 fail。

不发起额外硬件采集来证明 no.alarm，不写回或修复告警状态。若未来需要“验证区间内无告警/监测覆盖率”的语义，另设时窗契约，不塞入本轮。

## 4. run 查询、取消与有界结果（R2）

修改 `verify-command-service.mjs` 和 `verify-rpc-handler.mjs`，所有 run/status/cancel 都使用结构化 scope：

```js
{ workspaceCwd, ownerSessionId, verificationRunId, scenarioId }
```

RPC params 增加 cwd 的明确契约，并从路由的受控 workspace/page origin 取值；不得从 run 的 owner 字段反推调用者 scope，Agent 来源不得接受业务 payload 冒充身份。串起 `vision-rpc-router.mjs` 与实际调用者，不只修 isolated handler 测试。

active/completed record 均保存 cwd+ownerSessionId。匿名 owner 用空字符串，不使用与真实 sid 可能重名的 'anon' 哨兵。按 scenario 查询索引为 JSON tuple `[cwd, sid, scenarioId]`；runId 只是定位字段，命中后仍比较 scope。未分区匿名只能访问同 cwd 的匿名 run，有 sid 调用者不能认领；工作区后来分区时匿名访问按 SESSION_REQUIRED 关闭。

不存在、过期或不可见 run 对外统一 TARGET_MISMATCH 和同一文案，不泄露是否在跑或其归属。cancel 只 abort，不提前从 active 删除，执行 finally 后才释放；否则 run 尚在取消中时可被重复 ID 覆盖。重复外部 ID 检查在注册前完成，active 和仍保留的 completed 均返回 CONFLICT/RUN_ID_REUSE，不替换原行、不触发新的 run。

completed 按唯一 run 存储，全服务最多 50 条，finishedAt 起 1 小时 TTL；scenario latest index 单独指向 run，不把别名算作第二份结果。TTL/容量淘汰时清理指向该 run 的索引。active 不受 completed 淘汰影响；外部 abort listener 在 finally 移除。clock/max/ttl 可注入测试，避免真实等待。

## 5. evidence 成功返回闭环（R7）

修改 `evidence-append-service.mjs`：在写锁内使用已保存 workspace 和相同 evidence scope，对成功返回的历史 evidence 执行 resolveEvidenceRef(checkVersion=false)，或复用 projectVisibleFocus 的完整过滤。不能只比较 row.sessionId。

保留新批次的全量原子校验；非法新行拒绝整批。旧不可验证行只在输出隐藏、继续留在磁盘。service/UI RPC/Host status 对同一历史行必须一致。不要误改 Agent evidence handler 的“追加后重新生成 refs”语义，也不认领 foreign/遗留 focus。

## 6. 查询契约（R9–R11）

### 6.1 view 继承（R11）

`point-service.mjs` 不提前把缺省 view 压成 full；`points-list-page.mjs` 先解析 cursor，验证 configVersion、可信 session 与过滤条件，再决议 view：无 cursor 缺省 full；有 cursor 且未显式 view 时继承合法 full/summary；显式不一致仍 CURSOR_EXPIRED。resolved view 用于 fingerprint 与最终行投影。

cursor 不能覆盖 origin 的 sessionId/cwd，不能把非法 view 带入投影；connection/device 条件仍要求续页保持一致，不顺便新增过滤器继承。tool 文案与示例说明“view 可省略继承，过滤条件保持一致”。

### 6.2 已知字段适用表（R9）

Agent 预检和 Host 共用 `agent-query-fields.mjs`：本轮限定 kind/id/cursor/view，不升级为全部参数严格 schema。维护按 action/op 的真实适用表；先搜索 handler、tool/preset/doc 和别名使用，避免推测某入口支持。

- points list：kind/id 拒绝；cursor/view 允许。
- points get：id 合法；cursor/view/kind 不适用。
- timeline.list：cursor 合法；其余按现有实际入口，本轮不新增 kind 过滤能力。
- focus：保留实际支持的 kind；evidence 顶层 kind/id 继续拒绝。
- frames/alarm：保留实际 id 别名，数字 offset 继续有效，cursor/view 不适用。

错误统一 INVALID_FIELD、details.reason=UNSUPPORTED_FIELD，hint/supportedBy 描述真正支持位置；非法值仍为 INVALID_VALUE。只改变 Agent 契约，非 Agent/UI 的已有宽松行为不无意收紧。每个出口保留 commandId。

### 6.3 截断元数据（R10）

`agent-observe-queries.mjs` 在 slice(0,180) 前记录真实长度，事件始终输出 summaryTruncated 布尔值。`agent-result-project-timeline.mjs` 输出 budgetTruncated，正常 limit 分页为 false，预算缩小实际事件页时才 true；不改变旧 truncated 的生成规则与 nextCursor 的正确锚点。

明确 scope：budgetTruncated 本轮仅在 timeline Agent 投影定义，不假装是所有 action 通用字段。预算错误 RESULT_TOO_LARGE 仍 ok=false、returned=0、nextCursor=null，并保留 eventId/commandId。补 tool/文档说明旧 truncated 的动作差异，不能写成“只表示内容截断”。

## 7. 提交、红测与验收

建议 6 个行为提交，每组先在当前基线上得到该组复现红测，再实施转绿；后来依赖修改的红测要记录使用的父提交：

1. `fix(verify): distinguish unavailable observations from assertion failures`（R3 与统一结果契约）
2. `fix(verify): authorize run access and bound completed results`（R2）
3. `fix(verify): scope telemetry and bind real read results`（R1/R4/no.alarm）
4. `fix(evidence): revalidate historical refs on append results`（R7）
5. `fix(points): inherit omitted view from validated cursors`（R11）
6. `fix(agent): clarify query fields and timeline truncation`（R9/R10）

审查、019 计划、交付验证矩阵独立 docs 提交。新增模块列入 package.json files；不扩 structure allowlist。采样 scope、结果可用性和 completed registry 优先拆 helper，不让 verify-service 继续膨胀。生成 client.js/build-info 按构建步骤执行，交付的源码指纹必须匹配。

最低回归矩阵：

| 组 | 必须通过的行为 |
|---|---|
| 结果 | missing current / missing baseline / null / stale / READ_FAILED 不 pass；0→1、false→true 正常；相同有效值 fail；mixed fail+unverifiable 为 error；timeout/cancel 不被覆盖 |
| 作用域 | A 读 B 点、双私有同 ID、跨 cwd 缓存均不可取得值；scoped miss 不调用裸 reader；共享合法点可读；撤回共享/删点/改绑定后缓存失效；分区匿名 0 I/O |
| read 适配 | 真实 sim values[] 正确；0/false；错配/重复/缺行不缓存；signal 贯通；默认 reader 和生产 adapter 一致 |
| no.alarm | B 告警不影响 A；A 无来源不可验证；A 有合法规则无 active 为 0；A active fail；可见范围中歧义源不能被静默跳过 |
| run | A/B status/cancel、同 sid 跨 cwd、匿名/有 sid 隔离；同 owner 合法访问；取消未完成不释放 ID；重复 ID 不覆盖；50 条唯一容量与 1 小时 TTL、索引清理 |
| evidence | 合法追加后 foreign/过期/伪 owner 旧行不返回；磁盘旧行保留；新非法批次原子拒绝；RPC 与 status 一致 |
| cursor | summary 首页→仅 cursor 续页；显式变 full 拒绝；跨 sid/config drift/改变过滤条件拒绝；缩页后枚举无重无漏 |
| 字段 | points list kind/id 拒绝；points get id、frames/alarm id、focus kind 合法；Host/preflight 错误一致且带 commandId |
| timeline | 正常分页 budgetTruncated=false；末页长摘要 summaryTruncated=true；预算缩页 true；超大单项拒绝且未消费 |

已有审查基线为单测 1724/1724、Harness 25/25，无“三项失败”豁免。实施时先确认 HEAD/工作区未被其他任务修改；不得把用户并行改动混入本轮提交。

收尾跑 test:unit、Harness test、lint、typecheck、deps:check、facades:check、ui:ownership:check、structure:check、assertions:check、build:check、pack:check、git diff --check。完成后新增测试使总数改变，报告使用真实最终计数。

Web 与 Desktop 均用真实 Agent tool 做无物理写入验收：points summary 真正回填 cursor、timeline 回填、错误字段、合法/非法作用域 verify，核对 gitSha/buildId 和结果 outcome。API 单测/裸 ESM import 不能代替安装验收；Desktop identity 探针失败时标未验证并按既定阶段处理，不桥接 Web 端口。缺硬件不阻塞 sim 修复，不宣称已验物理设备。

## 8. 明确延期的两个计划

### 020：R5/R6 会话焦点迁移

另写完整迁移计划再开工：focusBySession 存储版本、ownerless 历史隐藏、只读 projection、request/prev/evidence/tempWatch 同槽、告警 agent-focus 的授权读取、sid+cwd UI store、完整状态同步与导航事件去重分离、5 秒高亮 TTL。列出所有仍引用全局 focus.sessionId 的消费者，做兼容读取与持久化迁移测试。不得通过允许 B 覆盖 A 解决锁定；不在 019 加短期释放入口。

### 021：R8 幂等失败终态

原则已定，实施细节独立审查：

- 只读重试采用显式 action/op/有效 payload 白名单，至少包括 system.ping、status、points list/get、frames、trend、timeline.list、focus.get 和不追加的 evidence。evidence 的非空数组、非法字段及未识别动作不能靠“看起来像查询”进入白名单。
- 仅异常 throw/reject 的查询终态可允许后续受控重试；普通业务 ok=false 不一概清缓存；并发同 ID 仍共用一次 pending。失败记录保留 fingerprint，参数改变仍 COMMAND_ID_REUSE。
- 有副作用且无法确定是否执行的异常为 COMMAND_OUTCOME_UNKNOWN、retryable=false。同 ID 返回该终态，不再 executor；具体 Modbus 写的既有 WRITE_OUTCOME_UNKNOWN 不被抹掉。执行前已知拒绝不冒称“可能已执行”。
- 失败记录必须有终态时间且受容量/TTL 约束，pending 不被淘汰后重放；但 unknown 记录到期也不能被当成“从未执行”自动重试。明确去重保证时窗，必要时以有界持久化命令日志/底层操作身份承接，不能靠永久保留 rejected promise 或无限内存墓碑。
- 必测 side-effect-then-throw 不重复执行、unknown 过期处理、读失败同 ID 重试、参数变化、并发、TTL、容量和挂起操作。未完成状态/淘汰契约前不实施简单 catch→delete。

本轮交付仍明确保留 R5/R6/R8，不宣称 11 项全修。
