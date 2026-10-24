# Corn 套件整体审查（2026-10-15）

> 后续状态：N1–N8 已在本地工作树修复，代码、红绿测试和安装边界见 [022 修复验证](../plans/2026-10-15-022-project-wide-fix-verification.md)。下文保留审查时的发现与证据。

## 1. 结论与审查范围

工程基础比前几轮完整：Host/Agent/Client 已分层，配置有版本与写锁，采样有身份章，设备写入与烧录有审批路径，构建、结构、覆盖率和包闭包均有门禁。但当前仍存在多入口规则不一致、调试运行态授权与资源索引缺口；**不能仅凭主流程及全量单测通过，视为多会话和失败恢复已经稳定。**

本次新增 **5 项 P1、3 项 P2**，用 **10 条独立失败断言**定位，详见第 4 节。另保留两项已知延期债务，以及依赖/双端验收观察；不把它们冒充本轮新回归。

审查对象：

- `dsh-corn-bench` 0.29.29，HEAD `dfa68cf`；主要行为更新为 `60b2cf0`（021），此前基线 `bc3fcda`（020）。
- 可选 `dsh-corn-harness` 0.2.0；位于套件父仓库 `05530de9`。该 guard 本机 Web/Desktop profile **均未安装**，其发现是组件本身的问题，不代表当前 bench 现场正在触发它们。
- bench 有 476 个 src 文件、7 个 runtime 文件、438 个 test 文件。本次是全量自动门禁加关键调用链审查，没有声称人工逐行证明全部模块。
- `/Users/qin/DSH` 是工作目录集合，不是 Git 仓库；本报告没有将其它 DSH 插件或官方 Harness 全部纳入。

bench 审查开始时干净。套件父仓库已有 AGENTS.md、bench 子模块状态与 `.cursor/` 的用户改动，未触碰。

## 2. 验证证据

| 检查 | 本次结果 |
|---|---|
| bench test:unit | **1827/1827**，0 失败/跳过 |
| bench test:coverage | **通过**：statements/lines 85.91%，branches 72.06%，functions 78.90% |
| coverage:critical | 9 个关键文件通过；当前 write-execute 分支下限为 68，021 交付已披露由 70 调整，不当作未披露降门禁 |
| lint / typecheck / deps / structure / assertions / facades / ui:ownership | 全通过 |
| build:check、check-build-info、check-package | 全通过；包 files 563 项，闭包完整 |
| 完整迭代范围 diff 检查 | `git diff --check 54581d0..HEAD` 通过；此前 EOF 空行已清理 |
| Harness npm test | **25/25** |
| Harness quality | lint/typecheck/coverage/pack 全过；lines 93.68%，branches 73.03% |
| 新增独立复现 | **10 项预期断言，0 通过 / 10 失败**，对应 N1–N8；不计入仓库既有 1827 项 |
| 生产依赖 audit | `npm audit --omit=dev --json`：1 项 moderate，ECharts；无 high/critical，见第 6 节 |

独立复现：[脚本](/tmp/corn-project-review-20261015-extra.test.mjs)、[日志](/tmp/corn-project-review-20261015-extra.log)。设备相关只在临时 home/cwd 中使用已盖章 fixture 与配置操作，调试全部使用 fake backend；HTML 只检查字符串，使用无脚本的标签探针。没有对用户工作区或真实设备做控制操作。

其它日志为 `/tmp/corn-project-review-20261015-{unit,coverage,harness,harness-quality,lint,typecheck,deps,structure,assertions,facades,ui,build,critical,build-info,package}.log`；依赖审计为 `/tmp/corn-project-review-20261015-audit.json`。

本次直接调用 build-info/package 检查器，没有执行会重写生成信息的 bench pack:check。覆盖率产物属于忽略文件；未改业务或生成代码。

## 3. 各维度判断

| 维度 | 已有基础 | 当前边界/缺口 |
|---|---|---|
| 架构 | application/domain/infrastructure/interfaces/ui 分层；依赖与 facade 门禁通过 | 会话、样本有效性规则仍在不同出口分别实现，容易一处收紧、另一处遗漏 |
| 采样与设备 I/O | 021 将真实路由、generation、commit、reader/observation 连通；sim write 不再退出仿真 | points get/list 仍可将失效历史行投影成当前正常值（N2） |
| 会话隔离 | Agent points 查询、verify run、evidence/focus 有专门可见性与归属处理 | RPC 的配置投影不等于运行态投影（N1）；调试命令入口有绕过（N3） |
| 调试与生命周期 | fake/GDB transcript、target lease、失败会话回收、事件环等测试齐备 | 重复 debugSessionId 可覆盖活会话（N4）；断点失败污染权威状态（N6） |
| UI | 生成包、状态总线、请求代次、图表生命周期等已有自动测试 | tooltip 拼 HTML 未转义（N5）；全局 focus 存储仍是已知债务，未作视觉验收 |
| API/Agent 契约 | commandId、查询字段适用表、预算投影、cursor/view、错误修复指引已建立 | “当前可用值”的含义尚未在所有接口统一；幂等异常终态仍延期 |
| 可选 Harness guard | 组件独立，默认不随 bench 自动启用；扫描 batch 源码与本机 CLI 同步实现匹配 | 挂载 single-flight 与日志限流边界存在可复现缺口（N7/N8） |
| 工程交付 | 全量门禁可重复、版本/buildId 可追溯 | 安装文件一致仍缺真实双端 Agent 验收；关键新测试缺少跨出口负例 |

021 上一轮 F1–F7 的主要修复在源码与新增自动测试中可确认：观察层保留 fingerprint/generation；有效实体解析按层/连接；三个 owner 保持歧义；冲突解除换 token；sim write 保持 sim；完整 reading 拒错章；未来时间拒绝；客户端不再外发全局 generation map。原先的“内部 metadata 泄露”已修，下面 N1 是更广的运行值本体隔离缺口。

## 4. 新增发现

| 编号 | 优先级 | 问题 | 影响 |
|---|---|---|---|
| N1 | P1 | RPC 会话视图仍携带外国运行值 | A 的配置仅有 pA，响应 values 却含 B/pB=8888 |
| N2 | P1 | points 查询忽略采样章失效 | 地址从 0 改 5 后仍返回旧 77、ok=true、available |
| N3 | P1 | 显式 debugSessionId 绕过缺失 owner/cwd 不匹配 | 匿名或错误工作区仍可调用已有调试后端 |
| N4 | P1 | debugSessionId 重复覆盖活会话 | B 替换 A 索引，旧 backend/lease 失去正常回收入口 |
| N5 | P1 | 图表 tooltip 将点名等文本直接拼入 HTML | 已证明 HTML 注入；具备 XSS 风险，未在真实双端执行利用 |
| N6 | P2 | 后端断点失败后权威状态仍 verified=true | Agent/UI 误以为断点已生效，移除失败也有对称问题 |
| N7 | P2 | Harness 预设缓存不是可靠 single-flight | 同时请求启动两次；同步 throw 后 explicit retry 仍卡 pending |
| N8 | P2 | Harness 限流实际成为等待静默的防抖 | 持续错误期间不再输出周期摘要 |

### N1 — RPC 配置隔离没有延伸到 values

位置：[corn-rpc-workspace.mjs:121](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/interfaces/rpc/corn-rpc-workspace.mjs:121)、[config-scope-service.mjs:159](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/modbus/config-scope-service.mjs:159)、[caller-projection.mjs:10](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/domain/modbus/caller-projection.mjs:10)。

sessionWorkspaceView 调 projectModbusForSession 选择拓扑，随后只移除 sessionConfigs、采样 metadata；runtime 的 values 仍是全局集合。normalizeModbus 在携带所有 sessionConfigs 时按 union points 保留了外国行。

双私有 fixture 中，A 的 points 只有 pA；调用生产 RPC 使用的 sessionWorkspaceView 后：

```json
{"points":["pA"],"values":[{"pointId":"pA","value":1},{"pointId":"pB","value":8888}]}
```

因此不是“前端没显示 B，所以没泄露”。workspace/get/state 等返回的实际 JSON 已含 B 的值。前置 Connection 用户信任仍存在，本发现不声称匿名远程网络访问；问题是插件承诺的会话隔离在 RPC 出口没有成立。

建议：建立一份 caller-facing runtime projection，在去掉内部 metadata **之前**，依据同一 layered workspace 与可信 sid 过滤/遮罩 values，并覆盖 alarmState、trend、frames、polling 等运行集合的实际归属。共享值须按共享规则保留，歧义值隐藏但磁盘历史保留；tasks/timeline/journal 的归属也需按同一路径审计。不要直接改写 Host 运行态或仅在 UI 组件过滤。

回归入口至少包含 workspace/get、state、workspace/save 成功结果和配置返回，覆盖 A/B 私有、共享、双私有同 ID、匿名分区。现有 metadata-projection 测试只证明“不带内部 token”，不能证明“不带外国值”。

### N2 — 失效历史行被 points get 当作新地址当前值

位置：[point-query-value.mjs:136](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/modbus/point-query-value.mjs:136)。

021 保留旧 values 的旧章用于历史兼容，verify reader 已正确检查 fingerprint/generation；selectPointQueryValue 却仍只核 point/connection/device 三元组，不校验章与当前代次。因此 producer/verify 规则与查询规则分裂。

真实 points update 将 p1 地址从 0 改成 5，已确认 generation 改变；随后的 points get 返回：

```json
{"id":"p1","address":5,"raw":77,"value":77,"ok":true,"valueStatus":"available"}
```

77 来自旧地址。这不是简单的时间新鲜度：即使记录刚产生，来源几何已经不同。Agent 日常使用 get/list 时仍会据此判断设备，修好 verify 不足以保护这条路径。

建议：复用当前采样身份校验，区分“历史行存在”和“当前值可用”。新 schema 中错章/旧代次返回 unavailable、raw/value=null；配置行仍可见，计入 returned，不加入 missingIds。磁盘保留历史不是允许当前值接口继续返回 ok=true。同步检查 visualization latest、状态摘要、告警等其它消费 values 的出口；本次已确认的是 get，list 复用同一选择函数。

### N3 — 调试控制入口未真正使用通过授权的解析结果

位置：[debug-command-service.mjs:183](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/debug/debug-command-service.mjs:183)、[debug-command-service.mjs:133](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/debug/debug-command-service.mjs:133)、[debug-session-registry.mjs:72](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/debug/debug-session-registry.mjs:72)。

findOwnedDebugSession 正确返回 null（缺 owner 或 cwd 不符），但 command service 随后用 `debugSessionId || active?.debugSessionId` 继续派发。runtime.requireSession 又只在 owner 非空时比较归属，所以空 owner 成为绕过。stop 分支也在使用已授权 session 前就选择显式 ID、撤销 lease。

fake backend 端到端复现两条：

- source=agent、sessionId 为空、提供已有 debugSessionId → evaluate 成功，后端被调用一次。
- 同 owner、cwd 换成另一个工作区、提供原 debugSessionId → evaluate 仍成功。

正常 RPC handler 的 findOwned 路径较严格，并不能替 Host/Agent command service 保证一致性。没有绕过用户的硬件启动批准；这里是对已经启动会话的控制隔离缺口。

建议：控制/读状态都以解析成功的 session 为唯一目标；显式 ID 只能用于定位，不能代替授权。runtime 默认拒绝空 owner，必要的内部管理操作另建受控 API；统一校验 cwd+sid+debugSessionId。拒绝前不 revoke lease，不触发 backend。补 run/pause/step/evaluate/inspect/snapshot/stop 的两个入口矩阵。

### N4 — 活动调试 ID 没有唯一注册保护

位置：[debug-runtime-lifecycle.mjs:45](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/debug/debug-runtime-lifecycle.mjs:45)、[debug-runtime-lifecycle.mjs:88](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/debug/debug-runtime-lifecycle.mjs:88)、[target-lease.mjs:86](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/domain/debug/target-lease.mjs:86)。

start 接受外部 debugSessionId，没有在 acquireLease/backendFactory 前判断已有 active/starting ID，直接 sessions.set 覆盖。lease 以物理 target 为键，不保证 debug ID 全局唯一。

复现：A 在 probe-a 启动 existing-debug；B 用相同 ID 在 probe-b 再启动。结果 sessions 只有 B 一条、leases 却有两条；A 的 backend 未正常停止，A 也不能再按其 ID 访问原会话。全部使用 fake backend，没有启动真实进程。

建议：在任何异步构造前为 ID 原子预留；重复 ID 返回明确 CONFLICT/ID_REUSE，保持原会话不变。starting/stopping 同样占位，失败只清理本次实例持有的记录。target lease 的相同 sessionId 分支也应比较 owner/cwd，不能仅以 ID 相同认作同一拥有者。显式 restart 若需要，另定停止旧实例后重建的语义。

### N5 — 自定义 tooltip 没有转义动态文本

位置：[viz-chart-options.mjs:253](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/ui/monitor/visualization/hooks/viz-chart-options.mjs:253)、[viz-helpers.mjs:92](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/ui/monitor/visualization/viz-helpers.mjs:92)、[trend-model.mjs:61](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/domain/modbus/trend-model.mjs:61)。

点名进入 trend meta.label，再成为 seriesName；formatter 将 seriesName、yUnit 等直接插入 HTML。ECharts 的 formatter 回调返回值是 raw HTML，[官方安全指南](https://echarts.apache.org/handbook/en/best-practices/security/)明确要求动态文本转义。当前安装库 TooltipHTMLContent 也确实使用 innerHTML。

无脚本探针 label=`<b data-review-probe>温度</b>` 经实际 option builder 得到：

```html
<div>08:00:02</div><div><b data-review-probe>温度</b>: <b>11.0</b></div>
```

这证明标签被当 HTML，而不是文本。含事件属性等内容能否在实际客户端执行还取决于载体 CSP，本次没有做 Web/Desktop 利用演示；已确认的是可持久化文本到 raw HTML 的注入路径，不宣称已执行代码或存在远程代码执行。

建议：对 seriesName、单位及其它非数值动态文本调用统一 HTML escaping，或返回 DOM 并使用 textContent，或使用不解释 HTML 的渲染方式。保留应用自己生成的可信 marker，不能通过禁用所有标点或升级库来代替调用方转义。回归 `<>&"'`、Unicode、点名/CSV/Agent 更新的实际来源，以及 tooltip 的正常样式。

### N6 — 断点操作在后端确认前提交权威状态

位置：[debug-command-executor.mjs:157](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench/src/application/debug/debug-command-executor.mjs:157)。

addBreakpoint 先写 map 且 verified=true，再 await backend.addBreakpoint。后端抛错时 command 失败，但随后 runtime.state 仍显示该断点 verified=true。复现输出为 `[{id:'bp1',file:'main.c',line:12,verified:true}]`。watchpoint 相同模式；移除先删 map、后端失败时则软件说已删而设备仍可能保留。

建议：后端确认后再提交，或显式 pending/failed 状态并完整回滚；verified 采用实际后端结果。失败不能生成成功创建/删除事件，重试同 ID 不应制造幽灵条目。补创建失败、删除失败、native ID/验证结果、重试和事件一致性测试。

### N7 — 可选 Harness guard 的 pending 发布时序错误

位置：[standing-failure-cache.mjs:182](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-harness/lib/standing-failure-cache.mjs:182)。

两种独立复现：

1. 空 cache 同时 Promise.all 两个相同 ensure，双方检查 inflight 后都 await waitDispose，之后未重新检查；实际 mount 调用 **2 次**，违背 single-flight。
2. mount 同步 throw 时，async IIFE 的 catch 先写 failed，外层随后又写 pending+已拒绝 promise；explicit retry 仍复用该 promise，调用数保持 1、status=pending。此条是 helper 的同步异常边界，不宣称已在本机官方实际预设挂载中触发。

建议：等待 dispose 后重新读取当前记录，或串行化同 preset 的状态迁移；先发布 pending/deferred，再通过 Promise.resolve().then 执行 mount。正常完成、同步 throw、异步 reject、generation 更换、显式 retry、旧任务迟到都使用 mountId 保护。这个组件缓存与 bench 的 commandId 幂等缓存是两件事，不能混为 R8。

本机两个 profile 未安装 guard，故本项影响可选组件，修复优先级低于 bench 的会话控制。guard 依赖 Harness 私有方法，启用前仍要核对目标版本，不能因为单测通过就跨版本注入。

### N8 — 持续错误会让 Harness 摘要日志长期静默

位置：[harness-log.mjs:117](/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-harness/lib/harness-log.mjs:117)。

每次被抑制时都更新 prev.lastAt。若同 key 每 500ms 到达、阈值 1000ms，永远达不到输出条件，只有首条日志；不是预期的一秒一条聚合。

可控时钟复现 3 秒持续事件仅 emitted=1。修复应分开 lastEmittedAt 与 lastSeenAt，按最后输出时间限流，周期输出 suppressed/count；持续错误、突发、恢复后的再次错误、轮转和 close 都要测。该问题影响可选 guard 的故障可观测性，不是 bench 主流程的运行失败。

## 5. 已知延期项与工程反馈

### D1 — 全局焦点槽位仍未迁移（原 R5/R6）

Host workspace.focus 仍为单槽；UI `FOCUS_BY_CWD`、TEMP_WATCH 也只按 cwd，而 state bus 已按 sid+cwd。这会让同工作区的会话焦点互相拒绝或在 UI 中交替覆盖/清空。隔离保护比早期强，但产品体验和存储粒度尚未统一。

这仍是之前明确延期的迁移工作，不算 021 新引入。应单独设计 focusBySession 的磁盘兼容、ownerless 旧数据、通知授权、UI store 和生命周期；不能靠允许 B 接管 A 焦点“修好”。

### D2 — 异常幂等缓存仍没有失败终态（原 R8）

`command-idempotency-cache.mjs:101` 只有成功 then 设置 completedAt；executor reject 留下 rejected promise，无终态时间，不参与现有 TTL/完成条目容量清理。重放持续失败，新失败 ID 累积可超过 maxEntries。

继续按已有方案单列：无副作用查询受控重试，有副作用且结果未知的命令保留 unknown 终态和防重放保证。不能直接 catch→delete，让设备写、build 等执行两次。

### 工程上的主要原因

- RPC、Agent points、verify、visualization 各自选择/过滤值，统一采样章尚未形成统一“可用样本”出口。
- debug 的查找、命令派发、runtime registry、target lease 分别检查部分字段，调用者能绕过上层结果。
- 当前关键覆盖率门禁聚焦 write/flash/preset；覆盖率不等同跨入口一致性。N1/N2/N3 需要真实入口负例，不能只测底层 helper。
- 021 交付已坦诚记录：没有留下修复前红测日志，多个行为合成一条提交。这不是本轮功能缺陷，但使回归定位和逐组验收更难；下一轮先留红测，再分行为提交。
- 本次未发现需要推倒分层重写的证据。优先统一边界 helper、补负例和失败状态机，不另造一套 scope 或大规模换框架。

## 6. 依赖与运行环境观察

### O1 — ECharts advisory 命中，但不要与 N5 混淆

项目锁定 echarts 5.6.0。npm audit 的唯一生产依赖告警为 moderate **CVE-2026-45249 / GHSA-fgmj-fm8m-jvvx**，范围 `<6.1.0`，修复版本 6.1.0。[安全公告](https://github.com/advisories/GHSA-fgmj-fm8m-jvvx)、[Apache 修复提交](https://github.com/apache/echarts/commit/1e39b00eedda0e4a0b048e099c0e13ce7149d90f)。

公告针对 Lines series 的默认 tooltip；本项目已检查到的 option builder 使用 line/bar，line 又使用自己的 formatter，**尚未证明该库级 CVE 在当前产品路径可达**。列为依赖治理观察，不额外算一项已利用漏洞。建议评估 6.1.0 升级及图表回归；升级不能修复 N5 的自定义 HTML 拼接。

### O2 — 包安装一致，不代表原生双端已验收

本次静态检查：

- CLI `dsh --version`：0.1.7-alpha.2。
- Desktop Info.plist：0.2.0-rc.2。
- 工作区及两个 profile 的 bench：0.29.29，buildId 都为 `518e7019b38e…`，gitSha `0c54ad2`。
- 021 交付记录 Web 安装曾因 ignored native builds 非零退出，Desktop local-install 成功；两边都没有完成运行中 smoke。

本次未启动/重启应用，未执行现场 Agent fiber 或硬件调用。旧 skill 的官方 checkout 路径本机已不存在；必要的 CLI client-modules 行为改从本机实际安装的 0.1.7 编译源码核对。没有把未核对的 Desktop 内部实现当作兼容性结论。

下一轮验收需要真实 Agent 的 Host 身份、会话 A/B 数据、调试失败路径、分页回填和图表交互；不能将包目录版本一致替代 B2 identity 或 UI 验收。物理设备按既有范围另排，不据 sim 结果外推。

## 7. 建议修复顺序

1. **会话与值的统一出口：N1+N2。** 先建立 server-side caller runtime projection 与当前样本资格函数，再接 RPC、points 和其它当前值消费者。保留内部完整章及磁盘历史。
2. **调试授权和资源注册：N3+N4。** 统一已授权 session 解析、空身份拒绝、cwd 校验和 ID 原子占位；加入并发/失败回滚测试。
3. **UI 文本安全与调试状态：N5+N6。** tooltip 转义是小且独立的修复，不必等框架升级；断点/watchpoint 按后端确认提交。
4. **可选 guard：N7+N8。** 修正 pending 发布和日志时序，默认仍不启用未验证版本。
5. 后续独立处理 D1/D2；ECharts 升级及 Web/Desktop 运行验收按明确证据推进。

每组先把对应临时反例迁为仓库回归，保留红→绿证据。新增测试验证真实入口、明确拒绝原因、0 次非法 backend 调用、旧资源是否保留/释放；不要只断言“不 pass”。

本次仅新增本审查文档及 /tmp 复现/日志，未修业务代码、未改原计划与反馈、未提交、推送、发布或安装。
