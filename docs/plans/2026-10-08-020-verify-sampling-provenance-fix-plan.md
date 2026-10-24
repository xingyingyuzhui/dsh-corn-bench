# 020：真实采样时窗、运行值来源与查询契约修复计划

日期：2026-10-08。实施基线：`54581d0`，版本 0.29.28。

依据：[019 落地复审](../reviews/2026-10-08-019-followup-review.md)、[019 计划](2026-10-08-019-verify-isolation-and-query-contract-fix-plan.md)、[第九轮 Harness 反馈](/Users/qin/DSH/corn-plugin-round9-verification.md)、[五条独立红测](/tmp/corn-review019-extra.test.mjs)。原始审查与反馈保留不改。本文件裁定本轮实施语义；编写计划时未改业务代码、提交、推送或安装。

## 1. 十五项裁定

| 问题 | 裁定 |
|---|---|
| Q1 冻结缓存 | 完整观察窗口结束但采样没有推进：断言 `outcome=unverifiable`、`reason=INSUFFICIENT_SAMPLES`，整体按 019 聚合为 `status=error`、`errorCode=VERIFY_UNVERIFIABLE`。不新增 NO_PROGRESS。实际总 deadline 到期或剩余预算无法容纳原时长，仍整体 timeout；显式取消仍 cancelled |
| Q2 stable 默认策略 | 点位 stable 默认只观察有效 poll/publish 的推进，`allowDirectRead=false`；冻结时间戳不触发补读，不在每个 interval 读硬件。debug 表达式仍允许每次真实 evaluate。需要主动采集的点位验证，先由用户明确启动采集，再验证；本轮不加新的主动 stable 模式 |
| Q3 覆盖判据 | 同一身份及采样代次中，至少两个严格递增的有效采样 timestamp，且 `lastAt-firstAt >= durationMs`。墙钟等待与若干不同 timestamp 都不能替代时间覆盖。开始前历史值不能证明本轮窗口；首样本等待和末样本不足的处理见第 2 节 |
| Q4 几何失效 | **A+B 都做，B 是信任边界，A 是主动失效。** 配置事务移除受影响 values，并更新内部采样代次；runtime 行携带采样时捕获的身份/几何/代次，reader 和 commit 比对。只清内存 cache、只清 values、或只用当前配置给旧行补 fingerprint 均不合格 |
| Q5 失效字段 | address、function/规范化 area、实际 device.unitId、scale、offset、connectionId、deviceId，以及实际生效的设备路由/连接端点变更；当前实现若存在影响读取/解码的类型、长度或字节序，也纳入。删除、重建及有效 owner/share 变化同样失效。仅 name、显示单位、告警阈值、可视化改动不改变采样几何，保留已合格值 |
| Q6 新失败后的补读 | 最新可信失败不能被旧 good 掩盖。**普通点位断言**在 reader 有真实补读能力、目标合法、未取消/超时且额度未用时补读一次；每 run 的同 cwd/sid/pointId/采样代次最多一次。失败则 `READ_FAILED/unverifiable`，禁止回退旧 good。stable 按 Q2 不补读；无能力/额度用尽则按 BAD_QUALITY 等真实原因不可验证。不是任何场景“总是读一次” |
| Q7 显式外国 legacy owner | 先过滤，不计入本会话。若本会话另有可信来源，正常判断；若过滤后没有本会话可判定来源，`NO_ALARM_SOURCE/unverifiable`，不能用外国记录证明“零告警”。不返回外国记录存在与否 |
| Q8 无主 legacy 行 | 已分区工作区隐藏；不能作为本会话告警或监测来源。隐藏本身不必使已有独立可信来源的验证失败；没有独立来源则 NO_ALARM_SOURCE。未分区保留无主兼容，但显式外国 owner 不降格成无主。已证明属于本会话的 active 告警，停轮询后仍计入 |
| Q9 非有限初值 | 两道校验：注册前 `INVALID_FIELD`、`details.reason=INVALID_VALUE`；绕过场景入口的领域判定仍 `unverifiable/INVALID_SAMPLE`。缺初值继续 BASELINE_MISSING |
| Q10 非有限字符串 | trim 后的 `NaN`、`Infinity`、`+Infinity`、`-Infinity`（大小写不敏感）也拒绝；不能用字符串兜底绕过。保留正常字符串状态、0、false；不把所有字符串强制转数字 |
| Q11 status/trend 字段 | Agent 顶层 kind 和 id 均拒绝，id 不是 trendKey 的别名。trend 仍支持实际已有的 trendKey、pointId/pointIds、connectionId/deviceId、时间窗等，不能误改成“只认 trendKey” |
| Q12 hint | 用正确的公共短文案，删除通用 kind hint 里的固定 points list 分句；保留 evidence/alarm 等已有专属指导。不建立不必要的逐 action 文案分叉 |
| Q13 流程 | 先按本 020 文档统一语义，再落地三组行为提交：S1+S2 → S3+S4 → S5+S6；计划、审查、交付证据另一个 docs 提交。本次已完成裁定，实施方可按本文件开搞 |
| Q14 /tmp 红测 | 五条行为复现全部迁入仓库，**不原样复制脚本**。改相对 import、复用临时工作区 fixture、按行为拆文件，用可控 clock；补具体 reason/I/O/版本/来源断言。S4 改为验证注册前拒绝，并另测领域兜底 |
| Q15 延期/发布/安装 | R5/R6 焦点迁移、R8 幂等终态继续延期；本轮只在本地提交，**不推送、不发布**。修完门禁后安排 Desktop lab 重装，并保留 Web 真实调用验收；lab 不等于正式产品安装。现场探针/安装受阻须如实标未验证，不桥接 Web 端口、不强杀运行中的 Harness |

019 第 8 节中的“020 焦点迁移、021 幂等终态”是后续占位名称；本轮 020 用于修复此次复审缺口，那两个项目按后续实际编号另立计划，不修改原报告、不视作本轮已修。

## 2. S1：stable 只用真实新采样证明完整窗口

主要文件：`src/application/verify/verify-sampling.mjs`、`verify-service.mjs`、`verify-observation.mjs`、`src/domain/verify/observation.mjs`、`src/types/verify.d.ts`。可将窗口状态机抽到 `verify-stable-window.mjs`，不扩 structure allowlist。

### 2.1 内部采样与窗口状态

采集器保留 `{value,timestamp,identity,generation}`；不能在读取后立即只取 value。缓存中的同一记录被检查多次，不算多次采样。建议窗口 helper 的状态为：

```js
// 示意内部接口，不新增 Agent 输入字段。
createStableWindow({ startedAt, durationMs })
window.accept({ value, timestamp, identity, generation })
window.finish() // { values, sampleCount, coveredMs } 或 unavailable
```

规则：

1. 点位读取始终携带当前可信 cwd/sid，采用 scoped reader；身份歧义/撤权的原有拒绝保留。
2. 本轮起点为开始该断言的 Host 时间。`timestamp < startedAt` 的历史 good 行不计入本轮有效样本，不以 `Date.now()` 重新盖时间；等新 poll/publish。错误、非法值或质量不可信仍立即不可验证，不能以“旧记录不计入”为由吞掉真实错误。
3. 首个本轮有效样本到达后，以其实际 timestamp 锚定 `requiredEndAt = firstAt + durationMs`。等首样本的时间不算稳定时长；若剩余场景预算已不足原 duration，整体 timeout，不能缩窗。
4. 一直没有本轮有效样本时，等待最多原 duration，然后 INSUFFICIENT_SAMPLES；不无限等待采样源恢复。首样本阶段的 DATA_MISSING 可等待；TARGET_UNAVAILABLE/AMBIGUOUS_OWNER、明确坏质量/非法样本立即停止。进入窗口后出现 DATA_MISSING 也立即不可验证，不能跳过缺测段。若总 deadline 更早触发，保留 timeout。
5. 锚定后，观察到该完整窗口结束边界，再检查实际采样覆盖。相同 timestamp 的缓存复查不增加 sampleCount；相同 timestamp 却改变 value/身份是矛盾样本，INVALID_SAMPLE。时间倒退或未来时间不能成为覆盖证据。
6. 至少两个严格递增 timestamp，末首差达到原 duration 才允许 judgeStable。窗口结束但末样本仍早于 requiredEndAt：INSUFFICIENT_SAMPLES。生产轮询周期与窗口不吻合时，允许保守地不可验证，不以墙钟补齐样本；本轮不追加无限尾部等待或自动补读。
7. 同一 stable 窗内身份或 generation 改变，立即不可验证（STALE_VALUE，文案“采样配置已改变，无法证明同一窗口稳定”），不把两种配置的值拼成一窗。源产生新坏样本立即停止，不能跳过该样本后继续求 pass。
8. debug 表达式每次必须真实 evaluate，沿用已有取消/错误处理；每次成功 evaluate 的 Host 时间可作为实际观察时间，不将 point-cache 规则错误套成“禁止 debug 重复求值”。

窗口验收成功前不调用 judgeStable。通过覆盖检查后再将 values 交给既有数值/tolerance 判断；有效数据超 tolerance 是 fail，不是 unverifiable。`telemetrySamples`/样本计数区分有效样本与缓存复查，不能再输出“重复一条历史值得到五个有效样本”。若需要记录检查次数，用独立内部诊断字段。

### 2.2 时钟与结果出口

- 采样 helper 的 now/delay 可注入；生产默认使用现有 Host 时间与 abortableDelay，测试不通过改全局 Date.now 掩盖生产路径。
- `checkDeadline`、remainingMs 与采样测试使用一致的时钟；取消/超时在读、等待及输出结果前均检查。不能将 AbortError 洗成采样不足。
- sampleCount/coveredMs/requiredDurationMs 是当前断言的诊断数据，不回传外国 owner；新增输出字段时同步类型与 Agent/RPC 投影。
- 保持 019 聚合：普通不可验证 → error/VERIFY_UNVERIFIABLE；实际 deadline → timeout；用户取消 → cancelled。

## 3. S2：配置事务失效 + 可验证采样来源

### 3.1 两类身份分开

读取资格仍由已有 layered 有效身份判断决定，不能因为有 stamp 就绕过 pointRuntimeVisible/resolveEffectivePointIdentity。采样来源则证明“该值是在哪份读取配置下实际取得的”。

新增纯领域模块建议 `src/domain/modbus/point-sample-identity.mjs`，输入已经解析的 point、实际 connection/device、有效 owner，生成结构化 JSON tuple 的 fingerprint。不得按裸 deviceId 找第一个设备，也不做 JSON 字符串手术。tuple 至少包含当前实际生效的：

```js
[layer, ownerSessionId, pointId, connectionId, deviceId,
 connectionEndpointTuple, device.unitId, point.function, point.address,
 effectiveDecodeTuple, point.scale, point.offset]
```

共享对象的 owner 使用共享身份，不把调用它的不同 sid 变成不同物理样本；私有 owner 必须包含 sid。endpoint 采用 normalizeConn 后真正用于 transport 的连接方式/地址/端口/串口参数，排除显示名称与 UI 状态。decodeTuple 只收集实际存在且影响解码的字段，不凭空给当前模型添加新类型能力。

如持久化层需要有效身份枚举，将 `poll-runtime-identity.mjs` 中纯身份枚举部分下沉到 domain，由原模块薄包装/转出原导出；不得让 infrastructure 反向依赖 application，也不得复制另一套 share/影子覆盖算法。既有 poll 允许/拒绝矩阵必须零变化。

### 3.2 持久化的采样代次

只用几何 fingerprint 无法排除 A→B→A 和删除再建的旧缓存。添加内部 `modbus.sampleGenerations`（pointId → 不重复 token），与配置同存；runtime 行新增 `sampleIdentity`：

```js
// 字段名按此约定；这些不是 Agent 可写字段。
sampleGenerations: { p1: 'opaque-generation-token' }
// values[] 的一行，at 仍是实际采样时间：
{ pointId, connectionId, deviceId, raw, value, ok, at,
  sampleIdentity: { fingerprint, generation } }
```

- token 由 Host 在合法配置/采集持久化路径分配（可用 randomUUID），不是请求体提供。只维护当前配置点位集合，删除时移除，重新添加时生成新 token；不积累无限 tombstone。冲突身份不能靠某个 token 消除。
- 新建、实际几何/端点/owner 改变、唯一身份变成冲突或冲突解除，更新相应代次，并移除该运行槽的旧 values。未变化的点位保留 token 与已合格值。
- name-only 等元数据变化不更换代次。不能把整个 configVersion 当作每次取值必须相等的代次，从而使一次改名让所有值失效。
- 旧工作区没有代次、旧行没有 stamp 时，verify 不接纳其作为当前配置的采样。普通断言可走已裁定的一次真实补读；stable 等下一次正常采样。不在 normalize/load/只读查询中给旧行补当前 stamp。
- 旧行可以保留作为历史兼容展示，但不得被 verify 当作可信 live sample。真正取得新数据后，生产采集路径才写新 stamp；不能通过第一次配置保存把全部旧值“升级为合格”。

这项是可选内部字段的存储扩展，**不是** R5/R6 的焦点槽位迁移，也不迁移全局 pointId 运行键。

### 3.3 配置失效落点与磁盘一致性

文件：`src/infrastructure/persistence/workspace-repository.mjs`、`workspace-migration.mjs`、`src/infrastructure/store/workspace-store.mjs`、`src/domain/modbus/modbus-migration.mjs`、`point-model.mjs`；应用入口包括 `workspace-session-view.mjs`、points/device/connection/config/share mutations 与导入路径。

1. repository 的 `update` 与 `mutateConfig` 都有生产配置写入，不能只拦 mutateConfig。在现有工作区锁内，比较 **current 与最终 fold 后的 layered candidate**，分配代次、剔除受影响 values，然后 persist。不是比较某个 session 的投影 union 数组。
2. 建议 repository 增加 `prepareConfigPersistence(current,candidate)` 注入 seam，由纯领域 helper 计算差异；配置持久化入口统一调用，运行态 mutateRuntime 不重新生成 token。审计 saveWorkspace/迁移入口，明确测试 seed 可制造旧磁盘，生产替换不得绕过差异处理。
3. 一次合法配置操作仍只涨一次 configVersion；代次改变不能额外再提交一次配置。非法操作在保存前失败，不改变 configVersion/代次/values。
4. 冷启动旧配置的代次初始化只在 mutating 采集/配置路径进行，并重新装载同一代次后捕获读取计划；不能由每次只读 load 随机生成，也不能把 stamp 留在 normalize 会丢弃的字段中。单独初始化内部代次不改拓扑、不涨 configVersion；正常配置修改仍沿用其一次版本递增。代次不会接受客户端 patch，repository 以 current 的内部状态为准计算。
5. `splitWorkspaceParts/mergeWorkspaceParts` 显式保存/恢复 sampleGenerations；normalizeModbus 保留内部 map，normalizeValueRec/normalizeQualifiedValues 保留合法 stamp。坏字段只丢弃，不按当前 point 反填。运行态 applyRuntimeOnly 不允许 poll 改写配置代次。
6. 配置和 runtime 是两个文件：现在 saveV4Workspace 先写 config.json 再写 runtime.json，并非跨文件原子提交。保持配置先行，利用新 generation 拒绝“新配置 + 未清干净旧 runtime”的崩溃状态；增加该状态的重启测试。不能宣称一把锁让两个文件在崩溃时原子。
7. 内部 map 不进入 Agent commit 增量、status、points 行或外国会话 workspace 响应；session projection/fold 也不能丢代次或把外部字段写回。测试外部输出没有完整 sampleGenerations/其他会话 metadata。

### 3.4 poll/read/write 生产者与提交边界

文件：`poll-target-preparation.mjs`、`polling-service.mjs`、`read-service.mjs`、`write-execute.mjs`、`modbus-runtime-context.mjs`、`modbus-commit.mjs`，以及实际 scatter/setPointValue 链路。

- 在 I/O 前、已验证设备路由后，从本次读取计划捕获 fingerprint+generation。scatter 生成成功或失败记录都携带这份捕获身份；不能等 I/O 完再取最新配置给结果盖章。
- 若旧工作区未初始化 token，先在 mutating 入口锁内初始化并重新准备计划，再做 I/O。禁止读取后拿新 token 为旧数据补章。
- modbus-commit 在运行态锁内逐条核对采样身份、当前资格与 generation，并保留已有 baseConfigVersion drift 检查。配置变更中的迟到数据不能写 values、trend 或产生告警迁移；允许现有 drift frame 留痕。
- 同一份“接纳后的 incoming”用于 values 合并、trend 采样与相关告警结果，不能只过滤 values，却仍把全部 input.pointValues 送进 sampleTrendValues。
- 真正 read 返回的 values[] 保留 stamp；adapter 选择匹配且属于本次读取的唯一记录，不能取整个工作区中的旧值伪装补读成功。
- `write-execute.mjs` 的 sim 分支先 saveSessionModbusPatch、再 commit，并特意省略 baseConfigVersion；也必须遵守 generation 比对。逐一覆盖 sim/真实 write 的输出值来源，不用“sim 没硬件”豁免旧值盖章。

### 3.5 reader 的选择顺序、补读额度与失败屏障

文件：`verify-point-scope.mjs`、`scoped-point-reader.mjs`、`verify-telemetry-adapter.mjs`、`telemetry-reader.mjs`、verify service/sampling 的调用上下文。

建议 readPoint 内部 options 增加 `allowDirectRead` 及 run-local 补读额度句柄；不新增 Agent schema 参数。普通独立 reader 调用最多一次 directRead；verify 内共享 run-local 额度，稳定窗口固定禁用补读。

```text
load layered → 校验当前目标/身份 → 核对 sampleIdentity
→ 按实际 timestamp 选最新记录（包括坏质量）
→ 最新 good 且有效：返回
→ 最新 bad/缺失/失效：普通断言有额度则 directRead 一次，否则 unavailable
→ 补读失败：unavailable，不读旧 good
```

- 缓存保存 fingerprint+generation，发布接口携带经验证的采样身份；受控标量 publish 是一次真实“现在发布”的事件，才能用 Host 当前时间，不把它当作任意旧 record 的迁移手段。
- 对异步读取/外部发布的完整 reading，必须校验来源身份，不无条件覆盖调用者 stamp。directRead 等待完成后重新验证当前目标与代次；撤权/改配置时不缓存、不返回旧结果。
- 同一代次内保留失败记录参与排序，先选最新再判质量。相同 timestamp 成功/失败矛盾时失败优先，不能靠 cache >= poll 的比较吞掉错误。
- 最新失败使旧 good 不再可回退；一次较新的合法补读成功可以恢复。maxAgeMs/非法 timestamp/非有限值校验先于复用，不把 null 或错误记录解码回旧值。
- 补读额度键采用结构化 tuple `[cwd,sid,pointId,generation]`，生命周期仅本 run，结束释放；同 run 不因新失败重复读硬件，也不建设无限全局负缓存。
- 真实补读沿用 019：允许 read-service 的任务/帧/操作记录及 mutating claim；缓存命中、拒绝、stable 观察均不落盘 claim。不增加无留痕硬件读取路径。

## 4. S3：legacy alarm 先核 owner，再归并 ID

文件：`src/application/verify/verify-alarm-scope.mjs`，必要时抽小型 owner helper；复用现有 effective visibility，避免新增全局告警存储形状。

1. `legacyAlarmState(workspace,scope)` 接收真实调用方 sid 与是否分区，先检查 owner，再构建 ID 字典。先按 ID 取第一条/最后一条再验 owner 会被外国同 ID 行挡住，禁止这种顺序。
2. sessionId/ownerSessionId 只处理源码中实际出现的旧字段。两个非空 owner 字段相互矛盾则不可归属、隐藏；不是把第二个当作第一个的回退。显式外国 owner 永远不算当前会话。
3. 已分区无主 legacy 隐藏；未分区无主保持兼容。owner 合格之后仍要目标可见、唯一归属，不能仅凭 owner 放行。
4. 当前 alarmState 与 legacy 归并继续按逻辑告警去重；不得让外国行覆盖本会话合法 active 行。适用的 current 行若带显式 owner，也不得绕过同样的 owner 校验；正常由已验证采样提交的 ownerless current state 仍按其现有有效目标归属判断，不把它误当作 legacy 数组。
5. 检查本会话来源再判零：有有效来源且无合法 active 为 0；无来源为 NO_ALARM_SOURCE。停轮询/禁用来源不自动清除已经证明属于本会话的 active 告警。
6. 错误和诊断不输出外国 owner、告警 id 或“隐藏了 B 的几条”，文案维持当前会话无法判定。

## 5. S4：changed 初值注册前拒绝，领域出口再防御

文件：`src/domain/verify/observation.mjs`、`scenario.mjs`、`assertion.mjs`、`src/application/verify/verify-command-service.mjs`、`verify-service.mjs`、`verify-assertion-eval.mjs`。

- 抽可比较 scalar 的统一校验，非有限 number 和 Q10 的特殊字符串返回 INVALID_SAMPLE；正常 string/boolean/有限 number 保留。对当前值和初值复用，不先通过 String/Number 运算判断不同。
- 注册前按 createScenario 的真实别名优先级决议 baseline：value 非 undefined 优先，否则 expected。缺 baseline 保留运行结果 BASELINE_MISSING；非法 baseline 抛 VerifyRequestError(INVALID_FIELD, ..., {field:'value'或'expected',reason:'INVALID_VALUE',assertionId})。
- verifyCommandService 在 registry.register/task 开始前调用相同校验；直接 verifyService 入口也调用。不能只在 createScenario 做，而 command service 提前注册了非法 run。
- 领域 evaluateAssertion 即使直接收到初值 Infinity，也返回 `unverifiable/INVALID_SAMPLE`，不 pass。修改 service 的 changed 路径，避免它生成“from Infinity”的通过描述。
- 非有限内容用安全文字回显，不能让 JSON.stringify(NaN) → null 改写真实原因。0、false、正常状态字符串、expected 别名、有效相同值 fail 都回归。

## 6. S5/S6：补齐已知查询字段和公共 hint

文件：`src/application/commands/agent-query-fields.mjs`，Host 与 `src/interfaces/agent/agent-tool-preflight.mjs` 的调用点，必要的 tool 说明。

- 将 status/trend 纳入已有 kind/id 适用表；保持 Agent-only 收紧、非 Agent/UI 既有兼容、未知 action 不新增全局黑名单。
- status/trend 的 kind、id 返回 INVALID_FIELD/UNSUPPORTED_FIELD。trend 的合法 filters 保留；不用 id 默默映射 trendKey。
- 通用 kind hint 改为：`kind 只用于 focus 目标类型；证据条目请使用 evidence[].kind。` evidence 保留只读/追加/timeline 专属指导。
- 通用 id hint 描述真实适用位置；alarm 继续明确 alarmId 不是 id。禁止 supportedBy 和顶层 error/hint 再互相矛盾。
- Host/preflight 两出口同码、同 reason；最终结果带当前 commandId。不是只测纯 helper，而漏过请求字段被 schema 清掉的真实入口。
- cursor/view、points summary 续页、points get 合法 id、frames 的 id 别名、focus 的合法 kind 均保持。

## 7. 红测迁移与最低回归矩阵

新增测试可放 `test/verify/verify-stable-window.test.mjs`、`verify-sample-provenance.test.mjs`、`verify-poll-failure.test.mjs`、`verify-changed-baseline.test.mjs`，另有生产配置/持久化集成测试与现有 alarm/query 测试。按行为拆文件，不超过预算后再加白名单。

| 组 | 必须覆盖 |
|---|---|
| 五条原红测 | 冻结历史值；非有限初值；新失败被旧 cache 掩盖；真实 address update 保留旧 values；显式外国 legacy 告警。记录在 54581d0 的原始失败，再迁为精确行为测试 |
| stable | 冻结且 maxAge 未过期仍不足；重复 timestamp；相同时间矛盾值；起点前历史值；不同 timestamp 但覆盖不足；完整跨度成功；值越界 fail；中途坏样本/身份变化；停止 poll；无源；总 timeout/cancel 优先；默认 0 次补读 |
| runtime 身份 | 地址/function/unit/scale/offset/绑定/真实 endpoint 变化；name-only 保留；A→B→A；删除再建同 ID；share owner 变化；共享多会话看到同一合格样本；私有同 ID 歧义不放行 |
| 冷启动与磁盘 | config/runtime split→save→load 保留新字段；无 stamp 旧行不自动合格；重启不随机换已有 generation；新 config + 旧 runtime 的崩溃状态不 pass；只读查询不写文件/claim/token |
| 生产提交 | poll/read/write/sim 都产出合法 stamp；I/O 中修改配置后迟到值不进 values/trend/告警通知；错误行 stamp 保留；无效 stamp 不被 normalize 修成合法；新增 metadata 不出现在外国响应 |
| 失败与额度 | 更新的 bad 压住旧 good；普通断言一次补读；失败后 READ_FAILED、实际 I/O=1；同 run 重复观察不重读；合法补读恢复；无 directRead → BAD_QUALITY；stable 最新 bad 不 pass 且 0 补读 |
| alarm | 外国/无主 legacy；同 ID 两个 owner 两种顺序；owner 字段矛盾；本会话无来源不可验证；有规则无 active 为 0；本会话 active 在停止轮询后仍计数；输出不泄露外国元数据 |
| baseline | ±Infinity/NaN 数值及特殊字符串注册前拒绝、0 I/O/0 run 注册；绕过入口领域不可验证；expected 别名；0/false/正常字符串成功比较；缺 baseline；相同有效 baseline fail |
| 查询 | status/trend 的 kind/id：Host/preflight 两出口拒绝且带 commandId；trend 实际合法过滤不变；alarm/timeline/status hint 不再冒用 points list；已有 focus/id/cursor/view 契约无回归 |

迁移红测的注意事项：新 stamp 策略下，“旧无章 fixture 被拒绝”不能替代 S1/S2 的根因测试。冻结/最新失败测试必须先用生产采集或合法可信 fixture 建立可用样本，再制造被冻结/失败；几何测试先证明旧值确可读，修改后断言旧值被移除或不可接纳、补读目标地址正确。不能全部弱化为 `status !== 'pass'`。Infinity 的新注册前拒绝须 assert.rejects/请求错误断言，不把它当作测试崩溃。

## 8. 提交、门禁与安装证据

本地三组行为提交：

1. `fix(verify): require complete sampling windows and trusted sample identities`（S1+S2，包含生产者/存储/reader；未完成整链路前不宣称该组落地）
2. `fix(verify): validate legacy alarm owners and changed baselines`（S3+S4）
3. `fix(agent): validate status and trend fields with consistent hints`（S5+S6）

每组先有行为红测，再修复转绿；新增缺口测试在基线/上一组父提交上的结果和日志写入交付报告。审查、本计划及验证报告另一个 docs 提交；新模块进入 package.json files 和类型检查范围。保留用户并行改动，不做混合提交。

最近已核验基线：bench 单测 **1781/1781**、Harness **25/25**，零失败；五条 /tmp 红测是额外缺口证据，不是可永久豁免的单测基线。本轮总数使用实际最终结果，不沿用早期“三项已知失败”。

收尾执行 test:unit、Harness npm test、lint、typecheck、deps:check、facades:check、ui:ownership:check、structure:check、assertions:check、build:check、pack:check、git diff --check。pack:check 会更新 build-info，完成后核对最终源指纹与 files 导入闭包，生成产物单列提交或按既有构建流程归档。

门禁后以隔离 sim 工作区进行 Web/Desktop lab 真实工具调用：

- ping 核 gitSha/buildId；不能仅比较 version 字符串。
- 真实 Agent fiber 的 corn_debug verify：冻结窗口不可验证、采样推进的完整窗口、非法 baseline、两会话隔离；corn_bench 的 status/trend 非法字段与合法查询。
- Desktop 完整退出再重启以换构建；若安装器提示 Harness 正在运行，停止并记录，不强杀。identity 探针失败则 Desktop-dependent 步骤未验证，不用 Web 端口绕过。
- 仅本地 tgz/lab，不推送、不发布；产品 registry name@version 安装与物理硬件另行授权验收。

交付报告区分“源码/自动测试通过”“Web 真实调用通过”“Desktop lab 真实调用通过”“物理设备未验证”，列出命令、提交、sample 时间跨度、补读次数、构建身份与未完成项目；任何安装未完成如实保留未验证，不填 true。
