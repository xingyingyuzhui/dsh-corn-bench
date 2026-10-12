# 021：采样信任链、代次状态机与会话输出边界修复计划

日期：2026-10-12。实施基线：`bc3fcda`，工作区版本 `0.29.28`，目标修复版本 `0.29.29`。本机 DSH、Web、Desktop 分别为 `0.1.7-alpha.2`、`dsh-vision-bench@0.29.28`、`dsh-vision-bench@0.29.28`。

依据：[020 落地复审](../reviews/2026-10-08-020-followup-review.md)、[020 原计划](2026-10-08-020-verify-sampling-provenance-fix-plan.md)、当前源码上的独立反例。本计划覆盖复审中的 F1–F7；R5/R6 焦点迁移、R8 幂等失败终态、物理串口/RTU 真机验收继续不在本轮范围。编写本计划不修改业务代码、不提交、不推送、不安装。

## 1. 目标与验收结论

本轮目标不是给七个症状分别加条件，而是建立一条唯一的可信链：

```text
layered 配置
  → 唯一且带层/owner 的物理目标解析
  → Host 在 I/O 前分配并捕获 generation + fingerprint
  → poll/read/write 生产带章结果
  → commit 在锁内按当前目标重新核验
  → reader 只读取匹配当前身份的样本
  → observation/stable 保留身份并校验时间
  → RPC/Agent 只输出调用方可见的业务数据
```

完成标准：配置、会话、仿真模式或采样来源发生变化时，旧值可以作为历史展示存在，但不能重新变成当前可信 live sample；任何缺章、错章、未来时间、跨会话目标或歧义目标都不能让 verify 得到 `pass`。

必须同时满足：

1. 020 复审的七组反例全部迁入仓库并转绿。
2. 现有 1807 项测试零回归；新增测试使用独立观察值验证实际 endpoint/unit/owner，不能让 producer、fixture、reader 共用同一个错误 helper 后自洽。
3. Web 与 Desktop 安装版本、`buildId`、`gitSha` 一致；Desktop 未完成完整退出与实验安装时明确记为 `unverified`。
4. 不扩大结构预算 allowlist，不把内部采样代次暴露到客户端，不新增 Web 端口桥。

## 2. 本轮裁定

| 项目 | 裁定 |
| --- | --- |
| 采样目标 | 由统一 resolver 返回 `unique / ambiguous / missing`；`unique` 必须同时包含 point、实际 connection、实际 device、layer、ownerSessionId |
| ID 冲突 | point/device/connection 的裸 ID 不能跨会话全局合并；第三个同 ID owner 不能把 ambiguous 重新变成 unique |
| generation | 只代表当前唯一身份代次；进入 ambiguous、离开 ambiguous、删除重建、owner/几何/端点变化都撤销旧代次 |
| 历史值 | ambiguous 时允许保留磁盘历史行，但没有当前 generation 就不具备可信资格；恢复 unique 后必须生成新 token |
| 仿真写 | 在 `sim=true` 连接上写入仍是仿真写，不自动切换 `sim=false`；模式切换只由显式 UI/配置动作完成 |
| sim→real | 整个端点相关 live values 的可信资格失效；立即发新 token，但不修改旧行的章。旧行可作历史展示，不能作为当前值；首个真实 poll/read 后恢复 |
| publish | 生产只接受完整且带章的 reading；标量“现在发布”仅存在于测试 fixture，不进入生产 adapter/RPC |
| direct read | I/O producer 必须返回 sampleIdentity；reader 不允许事后创造 stamp |
| 未来时间 | 当前 Host 采样全部使用同一系统时钟，默认未来容差为 0；若以后接入外部时钟，必须在 adapter 显式配置有限容差 |
| RPC 输出 | `sampleGenerations`、内部 fingerprint/token 不进入 workspace/state/config 成功响应或 Agent 默认投影 |
| 迁移 | 引入内部 identity schema 版本；升级后一次性撤销旧可信代次，不给旧值补新章 |

### 2.1 实施前十二项补充裁定

以下规则优先于本文后续的接口示意，实施时不得另选语义：

1. **shared / toplevel 的 owner 固定为空字符串。** `unique` 结果始终有 `ownerSessionId` 字段，但 shared、toplevel 的值为 `''`；private 才写真实 owner sid。调用方 sid 单独用于授权，不进入共享点 fingerprint。同一个共享点被 A、B 调用时身份完全相同。
2. **ambiguous 不隐藏配置点。** UI 与 Agent list/get 继续显示调用方配置视图中的点，运行值为 `valueStatus: 'unavailable'`，不返回 raw/value；summary 视图仍保留该状态。显式 read/verify 返回 `AMBIGUOUS_OWNER`。producer 不做 I/O，commit 拒绝落值，二者只记低频诊断。resolver 的 sample ambiguity 不参与删减配置列表，因此不改变现有 shared/private 可见性矩阵。
3. **几何字段冻结为现有 `sampleGeometryChanged()` 集合，本轮不扩字段。** 精确集合是 point 的 connectionId、deviceId、function、address、scale、offset、`effectiveDecodeTuple(dataType/type,length/quantity,byteOrder/endian,wordOrder)`，device.unitId，以及规范化 connection endpoint tuple：TCP 的 mode/host/tcpPort/sim，RTU 的 mode/port/baudrate/bytesize/parity/stopbits/sim。name、显示 unit、告警、监视、可视化不进入；area 由 function 规范化，不单独加入。021 只修“拿错 connection/device”，不顺带扩大几何定义。
4. **“不重新盖章”只指不改旧行。** unique 的几何/owner/端点变化在配置事务中立即发出新 generation；旧 values 行继续携带旧 fingerprint/generation，因此自动失配。不是等第一次真实采集才创建 token。ambiguous 没有当前 token；恢复 unique 时立即生成新 token。
5. **仿真写不顺手修兄弟点。** schema v2 升级会先轮换所有 unique 点的 token，升级前已有错章统一失效。升级后若某兄弟点仍出现错章，本次仿真写原样保留该历史行但 reader 拒绝；只有该点自己的合法 poll/read/write 才能写入新 live 值，禁止机会主义重贴章。
6. **每个当前点位只有一个 live value 槽。** 新失败记录替换该槽里的上一次成功，verify 看到最新失败后不得回退旧 good。历史成功/失败保留在 task、timeline、frame、trend 等历史结构中，不在 `values[]` 为同一当前点同时堆两条。legacy 重复行加载时按 timestamp 选最新，同 timestamp 失败优先。
7. **schema version 与 generations 写入 `config.json`。** `sampleIdentitySchemaVersion` 与 `sampleGenerations` 同属内部配置身份；runtime.json 只存 values 等运行态。poll 触发迁移时先在 workspace 锁内写新 schema/token，写失败则不做 I/O；写成功后同一轮重新加载/重建计划，使用新 token 采集，不等待下一轮。迁移前已在途的旧 poll 结果由 commit 因 token 不匹配而丢弃。
8. **客户端省略内部字段时保留，显式提交时拒绝。** `workspace/save` 继续是 patch，不改成整包替换；投影删掉 `sampleGenerations/sampleIdentitySchemaVersion` 后原样回传不会清除 Host 字段。若 RPC/UI/Agent 请求显式携带任一内部字段，返回 `INVALID_FIELD`（`details.reason='INTERNAL_FIELD'`），不静默忽略。Host 内部迁移使用 repository 专用路径，不走客户端 RPC patch。
9. **生产环境不提供可调用的 `publishScalarNow`。** 当前生产源码没有 publish 调用者；标量即时 publish 只移入测试用 in-memory reader fixture。`createVerifyTelemetryAdapter`、RPC、UI、Agent、debug 均不暴露该方法。生产数据只能通过带 I/O 前 stamp 的 `publishStampedReading` 或正常 commit 路径进入可信缓存。
10. **缺章统一为 `INVALID_SAMPLE`。** 完整 publish 和 direct read 只要声称成功却缺少合法 sampleIdentity，均返回 `INVALID_SAMPLE`；合法 stamp 与当前身份不一致为 `STALE_VALUE`；底层调用抛错、超时以外的实际读取失败才是 `READ_FAILED`。两条入口使用同一提示映射。
11. **本轮包含 Web 本地安装与 Desktop lab 安装，不包含发布。** 自动化与隔离验收通过后升级到 `0.29.29`，更新 Web 本地安装；用户完整 `Cmd+Q` 后执行 Desktop lab installer。若 Desktop 未退出则停在 `unverified`。GitHub push、npm publish、Desktop“应用 → 桌面插件”正式 registry 安装仍需另一次明确指令。
12. **红测与对应修复同提交。** 每组反例先在本地基线运行并把红测输出记录到 verification 文档，转绿后与对应生产修复一起提交；不建立独立失败的 tests-only commit，也不等全部修完后再提交一大包测试。

## 3. 阶段 0：冻结基线并先建立失败测试

### 3.1 基线证据

实施前记录：

```text
git HEAD                 bc3fcda
package                  0.29.28
DSH                      0.1.7-alpha.2
Web installed            0.29.28
Desktop installed        0.29.28
npm test                 1807 pass
```

先修复 `src/domain/modbus/point-model.mjs` 的 EOF 空行，使 `git diff --check 54581d0..HEAD` 重新通过；这项单独作为 P3 清理，不与业务修复混写。

### 3.2 迁入七组红测

新增测试建议：

| 文件 | 覆盖行为 |
| --- | --- |
| `test/verify/verify-identity-through-observation.test.mjs` | service → reader → observation → stable 全链保留 fingerprint/generation；窗口中途换地址/unit/owner 必须 `STALE_VALUE` |
| `test/verify/sample-target-resolution.test.mjs` | 两会话复用 deviceId、connectionId；三个 owner 同 pointId；实际 transport unit 与 fingerprint tuple 一致 |
| `test/devices/sim-mode-sample-trust.test.mjs` | sim write 不退出仿真；显式 sim→real 后兄弟点旧值不可信，未真实采集前 verify 不通过 |
| `test/verify/sample-generation-transitions.test.mjs` | unique→ambiguous→unique、删除→重建、shared↔private、A→B→A 状态迁移 |
| `test/verify/verify-reader-stamp-contract.test.mjs` | publish 缺章/错章、direct read 缺章/错章、I/O 期间撤权或改配置均拒绝且不缓存 |
| `test/verify/verify-future-sample.test.mjs` | 未来 timestamp 在 observation 和 stable 两层均为 `INVALID_SAMPLE` |
| `test/rpc/sample-metadata-projection.test.mjs` | workspace/get、state、workspace/save、配置 mutation 响应都不外发全局代次表 |

测试不得用 `stampWorkspace()` 同时生成生产预期和被测结果。关键断言直接解析 fingerprint JSON tuple，核对实际 `unitId`、endpoint、layer、owner；生产 poll/read 测试同时捕获 transport 请求参数。

每组行为先在基线运行得到稳定红测，再实现；红测证据写入最终 verification 文档，但不要求提交一个长期失败的 Git commit。

## 4. 阶段 1：统一 layered 目标解析

### 4.1 新的领域接口

新增纯领域模块，建议为 `src/domain/modbus/effective-sample-target.mjs`：

```js
resolveEffectiveSampleTarget(layeredModbus, pointId)
// { kind: 'missing' }
// { kind: 'ambiguous', identities: [...] }
// { kind: 'unique', point, connection, device, layer, ownerSessionId }

buildEffectiveSampleTargetIndex(layeredModbus)
// Map<pointId, resolution>，保留 ambiguous，不通过 delete 表示
```

实现要求：

1. point 身份先按 shared/private/toplevel 规则解析，不能按数组顺序抢占。
2. connection/device 必须在该 point 的实际有效视图中解析；mixed share 情况分别遵守 connections 与 points 的共享规则。
3. device 除 `id` 外还必须匹配有效 connection；不能从所有 session 的 `byDev` 全局 Map 取最后一个。
4. 同一私有 ID 出现两个及以上 owner，状态始终为 ambiguous，不因第三条记录恢复 unique。
5. shared、toplevel 的 `ownerSessionId` 固定为 `''`；private 写唯一 owner sid。caller sid 只参与授权，不改变 fingerprint。
6. shared 对 private 的遮蔽与现有 `pointRuntimeVisible`、`resolveEffectivePointIdentity` 保持一致。resolver 的 ambiguous 结果不用于过滤配置列表；列表仍显示点，运行值状态为 unavailable。
7. 将 `poll-runtime-identity.mjs` 中纯拓扑判断下沉或薄包装复用，删除两套独立规则；不得造成 domain → application 反向依赖。

### 4.2 替换所有身份消费者

以下路径统一使用同一个 resolver：

- `prepare-config-persistence.mjs`
- `sample-identity-producer.mjs`
- `modbus-commit.mjs`
- `verify-point-scope.mjs`
- poll/read/write 计划捕获

旧 `buildEffectivePointIndex()` 可以暂留为兼容 facade，但必须返回或传播 ambiguous，而不是把它折叠成缺失。所有调用点迁完后再删除 facade。

阶段验收：A/c1/d1/unit1 与 B/c2/d1/unit2 的两个不同 point 必须分别产生 unit1、unit2 的 stamp；三个 owner 同 `p1` 时 producer、commit、reader 三者均拒绝。

## 5. 阶段 2：把 generation 改成显式状态机

### 5.1 转移矩阵

`diffSampleGenerations()` 不再只比较两个 `Map` 是否有 entry，而是比较前后 resolution：

| 前状态 | 后状态 | generation | 旧 live value |
| --- | --- | --- | --- |
| missing | missing | 无 | 删除无配置残留 |
| missing | unique | 新建 | 不接纳旧行 |
| missing | ambiguous | 无 | 可保留历史，但不可信 |
| unique | unique，同身份/几何 | 保留 | 保留 |
| unique | unique，owner/几何/端点变化 | 新建 | 失效 |
| unique | ambiguous | 删除 | 可保留历史，但不可信 |
| unique | missing | 删除 | 删除或转历史，不进入 live |
| ambiguous | ambiguous | 无 | 保留历史，不可信 |
| ambiguous | unique | 新建 | 旧行不得重新合格 |
| ambiguous | missing | 无 | 清理无配置残留 |

这里“可保留历史”只表示磁盘兼容，不允许 reader 返回。若 `values[]` 目前没有明确历史/live 分区，最保守实现是保留行但撤销 generation；所有读取资格由 stamp 与当前 token 的匹配决定。

几何变化严格调用现有 `sampleGeometryChanged()`，不在 021 添加 role、显示 unit 或其它字段。改动点是给它传入正确层中的实际 connection/device；状态变化时立即生成或撤销 token，绝不修改旧 value 行上的 stamp。

### 5.2 升级迁移

增加内部 `modbus.sampleIdentitySchemaVersion = 2`，与 `sampleGenerations` 一起存入 `config.json`：

1. 旧工作区首次进入合法 mutating 配置/采集路径时，在 workspace 锁内为所有当前 unique point 生成新 generation，并写入 schema version；写失败则本轮不做 I/O。
2. 旧 `values[]` 不补新章；其旧 stamp 与新 token 不匹配，因此 verify 不信任。
3. ambiguous point 不分配 token。
4. 迁移不更改用户拓扑，不额外增加 `configVersion`；配置变更仍只增加一次版本。
5. config 先写、runtime 后写的崩溃状态依旧安全：新 generation 会拒绝旧 runtime。
6. normalize、只读 workspace/get、session bind 不执行随机迁移或生成 token。
7. poll/read/write 触发迁移后，在同一次操作里重新加载 workspace、重建执行计划并使用新 token；迁移前已在途结果按旧 token 在 commit 被拒绝。

### 5.3 存储与输入边界

- `sampleGenerations` 和 schema version 只由 Host 维护。
- 客户端 workspace/save、Agent/config patch 省略这些字段时保留当前 Host 值；若显式携带则统一 `INVALID_FIELD` + `INTERNAL_FIELD`，不能覆盖内部状态。
- split/merge/migration 显式保留内部字段；runtime-only 更新不能写 generation。

阶段验收：unique→ambiguous→unique 后 token 必须变化，旧 `77` 即使仍在磁盘也不能被 scoped reader 接纳。

## 6. 阶段 3：修正 producer、commit 与仿真模式

### 6.1 捕获与提交

每次 poll/read/write：

1. 在 I/O 前用已解析的真实执行计划捕获 `{fingerprint,generation}`。
2. fingerprint 的 connection/device 必须与 transport 请求中的 endpoint/unit 完全相同。
3. I/O 返回后，commit 在 workspace 锁内重新解析当前目标。
4. 当前 resolution 不再 unique、generation 不同或 fingerprint 不同：拒绝写 values/trend/alarm；允许保留现有 drift frame 证据。
5. 成功、失败记录均保留捕获时 stamp；失败记录不能被旧 good 掩盖。

`values[]` 维持一个 pointId 一个当前 live 槽：本轮失败覆盖上一次成功。历史结果写入 task、timeline、frame、trend，不在 live 数组并列保留。legacy 重复行归一化时按 `at` 选择最新，同一时间失败优先，避免数组顺序决定 verify 结果。

不要让 producer 与 commit 都只调用同一个 helper 后在测试里互相证明。集成测试必须另外观察真实 transport request。

### 6.2 仿真写语义

删除 `executeSimWrite()` 中“先把连接改成 `sim=false`，再恢复 priorValues”的流程：

- 仿真写保持 connection `sim=true`。
- 只更新本次目标点，标明 `source: sim-write` / `simulated: true`，使用 sim endpoint 的当前身份。
- 未写兄弟点不需要重贴章；因为端点没有变化，其既有合法仿真值可原样保留。
- 已经错章的兄弟点也不在本次写入中修复；它保持历史/不可用，等自己的合法采样替换。schema v2 首次迁移已保证旧版错章不会继续匹配当前 token。
- 显式 `toggleSim` 才负责 sim↔real。sim→real 时配置事务使该 endpoint 上所有 point generation 更新或失效，并停止把旧仿真值当 live。
- real→sim 同样建立新代次；第一条模拟采样或模拟写之后才恢复可信值。

这会修复 F3，也让 UI 的“仿真开关”和“写点位”职责清晰。任何旧行为依赖“写一次自动退出仿真”的测试和文案应改为显式切换，不保留隐式兼容。

## 7. 阶段 4：收紧 reader/publish 信任边界

### 7.1 生产只保留带章 publish

生产接口：

```js
publishStampedReading(scope, pointId, reading)
// 完整 reading：必须自带 fingerprint/generation/timestamp/quality
```

`publishStampedReading` 必须先解析当前 target，再逐字段核验；缺章返回 `INVALID_SAMPLE`，错章/配置已改变返回 `STALE_VALUE`，外国或歧义目标沿用 `TARGET_UNAVAILABLE/AMBIGUOUS_OWNER`。失败不能写 liveCache，也不能通知 subscriber。

旧 `publishPointValue` 不在生产保留兼容 facade。现有调用者全部位于测试，迁到 `test/verify/fixtures/in-memory-telemetry-reader.mjs` 的测试专用 `publishScalarNow`。生产 `createVerifyTelemetryAdapter`、RPC、UI、Agent、debug 不导出任何“Host 自动盖当前章”的入口。

### 7.2 Direct read 契约

`directRead` 返回的成功 reading 必须包含 I/O 前捕获的合法 sampleIdentity。`finalizeDirect()` 只验证，不能覆盖：

```text
缺 stamp                 → INVALID_SAMPLE（producer 契约不完整）
stamp 与读取后目标不符   → STALE_VALUE
target 撤权/歧义/删除    → 对应作用域错误
timestamp/value/quality 非法 → INVALID_SAMPLE / READ_FAILED
合法匹配                 → cache + return
```

冷启动 generation 必须在 I/O 前由 Host mutating 路径初始化并持久化。不能以“读取回来时还没有 token”为理由让 reader 事后造章。

阶段验收：外国完整 publish 和无章 direct result 都被拒绝；cache 保持空；同一次 I/O 期间修改地址、unit、owner 或 sim 模式后，迟到结果不能落盘或返回。

## 8. 阶段 5：Observation 与稳定窗口的时间/身份闭环

### 8.1 类型与字段保留

`ObservedReading` 明确包含：

```ts
{
  value: unknown
  rawValue: unknown
  timestamp: number
  quality: string
  provenance: string
  fingerprint: string
  generation: string
}
```

point reading 缺 `fingerprint/generation` 时不能降级为空字符串。`observeReading()` 保留 reader 已验证的身份；`sampleStableDuration()` 直接使用强类型字段，删除 `any` 和 `|| ''`。

### 8.2 时间规则

一次读取只取一个 `observedAt = now()`，同时用于 freshness 与 future check：

- `timestamp <= 0` 或非有限：`DATA_MISSING/INVALID_SAMPLE`。
- `timestamp > observedAt`：`INVALID_SAMPLE`，默认容差 0。
- `observedAt - timestamp > maxAgeMs`：`STALE_VALUE`。
- stable window 也接收 `observedAt` 并防御性重复检查未来时间，避免上层绕过。
- debug evaluate 使用 Host 完成求值时的时间，仍受 timeout/cancel 控制。

### 8.3 样本轨迹

`readTelemetryPoint()` 不再在窗口接受前盲目追加 telemetrySamples。stable 路径区分：

- 新且被窗口接受的样本：`checkOnly=false`，计入 sampleCount。
- 同一 timestamp 的缓存复查：不计有效样本；如需要诊断则 `checkOnly=true`。
- 被拒绝的未来/错章样本：只记录脱敏原因，不作为 telemetry evidence。

阶段验收：generation 中途改变立即 `STALE_VALUE`；墙钟 1080 时 timestamp 2000 的样本不能证明 80ms 窗口；telemetrySamples 数量不再冒充有效 sampleCount。

## 9. 阶段 6：会话输出与 Agent 体积边界

源码扫描显示 UI 没有消费 `sampleGenerations`。因此在统一输出投影处完全移除：

- `/state` / snapshot 的 `workspace`
- `workspace/get`
- `workspace/save` 成功响应
- config/points/device/connection mutation 成功响应
- Agent status/read/points 默认输出

不要在底层 `normalizeModbus` 或持久化对象上删除内部字段；只在序列化/投影边界调用类似：

```js
projectWorkspaceForCaller(workspace, { sessionId })
// topology/runtime 按既有规则投影
// 删除 sessionConfigs、sampleGenerations、sampleIdentitySchemaVersion
// values 默认删除内部 fingerprint/generation；只保留业务诊断字段
```

Host 内部 read-service、commit、verify 继续拿完整 stamp。Agent `projectRead` 对 value row 精简为 point/connection/device/value/raw/ok/error/at；需要来源诊断时以后另立受控 detail 查询，不能为了缩体积修改内部数据。

`workspace/save` 保持现有 patch 语义：投影中省略内部字段不会删除 `config.json` 里的 Host 值。RPC 请求若显式带 `sampleGenerations` 或 `sampleIdentitySchemaVersion`，在进入 `applyWorkspacePatch` 前以 `INVALID_FIELD/INTERNAL_FIELD` 拒绝；repository 内部迁移使用独立方法写入，不开放客户端透传。

阶段验收：A 会话响应中既没有 B 私有 ID/token，也没有全局代次表；Host 保存后重新加载仍保留完整内部 metadata。

## 10. 阶段 7：测试、门禁与运行验收

### 10.1 自动化矩阵

除七组红测外，补充：

1. 两会话相同 deviceId、不同 connection/unit 的 poll/read/write。
2. shared point + private connection、private point + shared connection 的 mixed share。
3. 两个、三个、四个 owner 的 duplicate point 状态机，遍历插入顺序。
4. A→B→A、sim→real→sim、删除→重建均不能复用旧值。
5. config 写入与迟到 poll/read 并发；commit 拒绝旧 stamp。
6. cold-start schema v1→v2，迁移前后 configVersion 不额外变化。
7. workspace config/runtime 分文件崩溃组合：新 generation + 旧 runtime 必须安全拒绝。
8. subscriber 不收到被拒绝 reading。
9. run-local direct-read budget 在代次变化后使用新 key，旧请求不能复活。
10. Agent 输出预算在移除 stamp 后保持或下降。

建议给 generation transition 纯函数增加表驱动或小型 property test，随机打乱 owner 顺序，保证结果与数组顺序无关。

### 10.2 必跑门禁

```sh
npm run build:check
npm run lint
npm run typecheck
npm run deps:check
npm run facades:check
npm run ui:ownership:check
npm run structure:check
npm run assertions:check
npm run test:coverage
npm run coverage:critical
npm run pack:check
git diff --check <baseline>..HEAD
```

`pack:check` 会刷新 build-info，放到行为提交之后。最终记录测试数、覆盖率、buildId、gitSha、package file count，不用“全绿”代替具体数字。

### 10.3 隔离运行验收

使用临时 `DSH_HOME`，不接物理设备：

1. 建 A/B 两个会话，复用 deviceId 但使用不同 connection/unit。
2. 启动 sim poll，确认 stamp tuple 与各自实际执行计划一致。
3. 运行 stable verify，中途改地址/unit，必须不可验证。
4. 显式 sim→real，未取得真实样本前 read/verify 不得返回旧 sim 值。
5. 拉取两个会话 RPC snapshot，确认没有外国 ID/token。
6. 重启 Host，generation 与读取资格不漂移。

### 10.4 Web 与 Desktop

行为和隔离验收通过后再升级到 `0.29.29`：

- Web：安装本地包、重启 `dsh web`，核对插件版本/buildId，执行两会话 snapshot 和 sim verify。
- Desktop：用户完整 `Cmd+Q` 后运行 `scripts/probes/install-desktop-local.mjs`；脚本若检测到 Harness 仍运行则停止，不强杀、不绕过。
- Desktop 重开后核对版本/buildId/gitSha，执行同一组无硬件 smoke。
- Web/Desktop 任一未执行，都不得写“原生双端验收通过”。

这里的“安装”仅指本机 Web 本地安装和 Desktop lab installer，是 021 验证范围的一部分；不包含 npm registry 发布、GitHub 推送或 Desktop 产品入口的正式 `name@version` 安装。Desktop 因仍在运行而无法 lab 安装时，验证文档记录 `unverified` 后结束本轮，不用 Web 结果代替。

物理串口、RTU 和真实 TCP 设备仍 defer；本轮只要求生产 transport 参数与 stamp 的自动化对照，以及 sim/隔离环境。

## 11. 日志与可诊断性

新增低频结构化诊断，默认只在拒绝或迁移时输出：

```json
{"event":"vision.sample.reject","reason":"STAMP_MISMATCH","pointId":"p1","generationChanged":true}
{"event":"vision.sample.schema-migrate","from":1,"to":2,"unique":12,"ambiguous":1}
```

要求：

- 不打印完整 fingerprint、generation token、寄存器数据或外国 sessionId。
- 同 cwd/point/reason 做短窗口去重，poll 每轮同错不刷屏。
- 统计 rejected-by-reason、schema migration 次数、stable invalid-sample 次数；不新增常驻高频轮询。
- UI 只显示可操作错误，例如“配置在采样期间改变，请重新采集”，不暴露内部 token。

## 12. 提交拆分

建议保持七个可审查提交组：

1. `chore: restore full-range diff hygiene`：只清理既有 EOF 空行，建立可比较基线。
2. `fix(modbus): unify layered sample target resolution`：统一 resolver、跨会话 endpoint 修复、ambiguous 保留，并带该组已转绿回归测试。
3. `fix(modbus): enforce generation transitions and schema migration`：状态机、v2 内部迁移、持久化边界，并带 transition/migration 测试。
4. `fix(modbus): preserve simulation provenance through writes`：producer/commit 与 sim 写语义，并带实际 transport/stamp 对照测试。
5. `fix(verify): reject unstamped and future observations`：reader/publish、observation、stable、轨迹，并带对应测试与测试专用 in-memory publisher。
6. `fix(rpc): hide internal sample metadata from caller views`：RPC/Agent 投影、显式内部字段拒绝、体积回归测试。
7. `docs: record sampling trust boundary verification` + `chore(build)`：验证证据、版本 `0.29.29`、生成产物。

七组红测按职责分入第 2–6 项，不单独提交失败状态。每项实施前先在本地运行对应红测，把命令和失败摘要写入 verification；生产代码转绿后再一起提交。

## 13. 停止条件、回滚与风险

出现以下情况时停止进入安装阶段：

- 统一 resolver 改变已有 shared/private 可见性矩阵。
- commit 仍能接受与 transport 实际 unit/endpoint 不一致的 stamp。
- sim→real 后旧值仍能通过 verify。
- 任何 caller response 仍含完整 `sampleGenerations`。
- 新代码需要扩大结构预算 allowlist 或引入循环依赖。
- `npm test` 虽绿，但独立 endpoint/unit oracle 不一致。

回滚采用 Git 提交级回退和插件版本回装。schema v2 迁移只轮换内部 token，不删除用户拓扑、可视化或历史值；回退到旧版本后最多需要重新采集，不应造成配置丢失。实施前与隔离迁移测试均保留 workspace 备份，禁止用真实用户 Home 验证破坏性迁移。

主要风险是统一 resolver 触及 poll、commit、Agent point visibility 多条路径。控制方式是先冻结现有可见性矩阵，再替换内部实现；每阶段完成后运行相关小组测试和全部 unit，而不是等最后一次性集成。

## 14. 最终交付物

- 本计划对应的七组仓库内回归测试。
- 统一 sample target resolver 和 generation 状态机。
- 明确的 sim write / sim→real 行为。
- 严格 publish/direct-read/observation 契约。
- 不泄露内部代次的 RPC/Agent 投影。
- `docs/plans/2026-10-12-021-verify-sampling-trust-boundary-fix-verification.md`，记录提交、门禁数字、隔离实测、Web/Desktop 状态与未验项目。
- 版本 `0.29.29` 的可打包产物，以及本机 Web 安装和条件允许时的 Desktop lab 安装证据；GitHub 推送、npm 发布和 Desktop registry 正式安装另按用户指令执行。
