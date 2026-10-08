# 当前 Vision 插件代码审查（018 落地后）

审查日期：2026-10-08。源码基线：`ea3057d964249553433b6ec672068a486e87c5de`，插件版本 `0.29.28`。审查前插件工作树干净，`main` 比 `origin/main` 超前 6 个提交。套件父仓库的 `AGENTS.md`、子模块指针和 `.cursor/` 已有本地变动，本次未修改这些内容。

结论：018 的四组修复已实现，但当前验证链路仍存在会话隔离和错误通过的问题。日常点表查询、引用生成的改进不能外推为 verify 的采样、判定和运行管理均已安全。第 2 节的 8 项以源码和临时工作区复现为依据；第 4 节结合 Harness 第 5–8 轮报告，补充 3 项接口契约问题。未把未覆盖的硬件路径描述为已验证，也未把所有问题归因于 018 新引入。

## 1. 验证范围与基线

本次检查了 Host/Agent/RPC 入口、018 改动、证据与焦点、verify 的采样和断言、UI 焦点同步、命令幂等缓存，以及发布文件闭包。使用现有 `twoSessionBench` 创建临时 home/cwd，使用纯函数、React 生命周期和 sim 读点复现；未操作用户实际工作区或物理设备。

| 检查 | 本次结果 |
|---|---|
| `dsh-vision-bench` 全量 `test:unit` | **1724/1724 通过**，0 失败/跳过 |
| `dsh-vision-harness` `npm test` | **25/25 通过** |
| lint / typecheck / deps / structure / assertions | 通过 |
| `build:check` / `git diff --check` | 通过 |
| `node scripts/check-package.mjs` | 通过，546 个 files 条目，导入闭包完整 |
| `node scripts/check-build-info.mjs` | 通过，buildId `c8ba8e9cfecc…` |
| Web / Desktop 安装验收 | 本次未运行 |
| 真实串口、Modbus、Keil/OpenOCD 硬件验收 | 本次未运行 |

这里直接调用打包检查器和 build-info 检查器，没有运行会重新生成 build-info 的 `npm run pack:check`。build-info 的 `gitSha=c97dba3` 是生成该文件时的前序提交，当前源码指纹检查通过，不能单凭它不等于包含 build-info 的 HEAD 就认定旧构建。

018 已对上代码的部分：无主旧 focus 读视图关闭；追加不认领遗留旧 focus；journal 引用按 kind/id/owner 查找；verify builder 引用统一解析；focus 身份来自独立 origin；focus evidence 非数组及超过 20 条明确拒绝。这些应保留。

## 2. 发现清单

| 编号 | 优先级 | 问题 | 证据等级 |
|---|---|---|---|
| R1 | P1 | verify 采样、缓存和 no.alarm 绕过会话有效身份 | 临时双会话工作区及跨 cwd 缓存复现 |
| R2 | P1 | verify/status、verify/cancel 按 runId 忽略调用方归属 | RPC handler 复现读取和取消 |
| R3 | P1 | changed 在没有当前采样时返回 pass | verify service 复现 |
| R4 | P2 | 直接读点响应形状与 verify 适配器不匹配 | 真实 read service 的 sim 路径复现 |
| R5 | P2 | 全局单个 focus 槽导致第二会话无法建立自己的焦点 | 两会话显式 focus 复现 |
| R6 | P2 | UI 将焦点事件去重用于整个状态，吞掉后续 evidence 更新 | React 生命周期复现；缓存额外静态检查 |
| R7 | P2 | appendEvidence 成功出口返回未复核的历史证据 | repository + service 复现 |
| R8 | P2 | rejected promise 留在幂等缓存且无 completedAt | 独立缓存实例复现 |

### R1：verify 的实际值并未复用现有读取隔离

位置：[verify-telemetry-adapter.mjs:66](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/infrastructure/modbus/verify-telemetry-adapter.mjs:66)、[verify-sampling.mjs:40](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/verify/verify-sampling.mjs:40)、[verify-assertion-eval.mjs:68](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/verify/verify-assertion-eval.mjs:68)。

适配器从参数读取了 sessionId，但读取 `liveCache` 和 `workspace.modbus.values` 时没有用它做可见性判定。缓存键是 cwd+pointId；磁盘值按裸 pointId 查找。Host 注入的是分层原始 workspaceLoader，因此 B 私有点的运行值也位于这份全局 values 中。018 只校验结果中的证据引用，没有校验这些实际采样。

复现：A 配置 `c-a/d-a/pa`，B 配置 `c-b/d-b/pb`，全局运行值中有 B 的 `pb=777`。以 A 为 owner 执行 `modbus.point(pb)==777`：

```json
{"status":"pass","actual":777,"telemetrySamples":[{"pointId":"pb","value":777}]}
```

第二条绕行：`readTelemetryPoint` 在作用域读取返回空之后调用 `readPoint(pointId, …)`。适配器 `publishPointValue` 又把 cwd 内样本写进全局 pointId 别名。向 `/other-workspace` 发布 `p=999`，当前 workspace 的 scoped 读取无值时，回退会得到 999。把缓存改成 sid+cwd 键仍不足以修复这个回退。

第三条绕行：`no.alarm` 直接读取原始 `modbus.points/alarmState`，忽略 ownerSessionId。A 的点无告警、只有 B 的 pb 活动时，A 的无目标 `no.alarm` 返回 `actual:1` 并失败。私有层 points 未进入顶层数组时，有效 A 点也可能被误判为没有告警源。

代码级建议：

- 在采样之前从同一份 layered workspace 建立调用方有效配置视图，并复用 `pointRuntimeVisible`、`resolveEffectivePointIdentity` 和 `selectPointQueryValue` 的身份规则。只改缓存键不能替代身份检查。
- liveCache/listeners 使用结构化的 cwd+sessionId+pointId 键，保留采样 provenance；命中缓存时也要重新检查当前配置身份，避免删点、重新绑定或共享开关变化后沿用旧样本。
- 删除运行时“scoped miss → 无作用域读取”回退。若需旧 reader 兼容，在构造 reader 时显式转换接口，不能把拒绝或无数据当成脱离作用域读取的理由。
- `no.alarm` 基于本会话有效 points 和 `filterAlarmStateForSession` 判定；未知/歧义点返回不可验证，不能从别人的全局告警获得结果。若产品需要工作区全局验证，另设明确的 scope 契约。
- 验收至少覆盖：A 读 B 唯一点、双私有同 pointId、跨 cwd 同 pointId、缓存后删除/改绑定、B 告警不影响 A、共享点在明确共享时可验证。

### R2：runId 是定位字段，却被当成全部访问条件

位置：[verify-rpc-handler.mjs:66](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/interfaces/rpc/verify-rpc-handler.mjs:66)、[verify-command-service.mjs:63](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/verify/verify-command-service.mjs:63)。

RPC 提供 runId 时直接调用 `cancel(runId)`、`isRunning(runId)`、`getResult(runId)`，调用方的 sessionId/cwd 被丢弃。activeEntry 有 ownerSessionId，但 cancel 的直接查找分支不比较 owner；pastResults 直接保存 result，未保存独立访问归属。sessionScenarioIndex 的键也没有 cwd。

已复现：A 的 run 完成后，B 携带自己的 sessionId 和 A 的 runId，`verify/status` 返回 `ok:true` 及 A 的结果/采样；A 的延迟验证尚未完成时，B 的 `verify/cancel` 返回 `cancelled:true`，A 的结果变为 `cancelled`。

这是产品会话隔离缺口；UI 页面 sid 本身不是本机强认证，不意味着可以忽略页面作用域。此结论不依赖把 runId 猜测难度当作安全边界。

代码级建议：查询、取消、结果访问统一接收 `{workspaceCwd, ownerSessionId, verificationRunId/scenarioId}`；active 和 completed record 均保存 owner+cwd；索引采用 tuple；结果不存在或不可见时统一拒绝。拒绝无归属调用方访问分区 run。禁止外部指定的重复 runId 覆盖活跃记录。并为 completed records 加明确的数量/TTL 上限，避免长期运行积累结果。

### R3：changed 将缺数据误判为变化

位置：[verify-assertion-eval.mjs:155](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/verify/verify-assertion-eval.mjs:155)、[assertion.mjs:246](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/domain/verify/assertion.mjs:246)。

读取为空时，执行层仍返回 `{initial: spec.value, current: undefined}`；领域层只检查 `initial !== current`。初始值 10、reader 返回 null：

```json
{"status":"pass","message":"点位 [pa] 发生状态变化 (10 -> undefined)","telemetrySamples":[]}
```

这会让 Agent 把设备无响应或无权限读取当成测试通过。它是现有断言链路问题，并非 018 evidence 修复引入。

代码级建议：采样结果携带明确的 availability/quality；`changed` 必须同时拥有有效初始值和当前值才可比较。undefined、未知、过旧、读取错误均不能 pass，0/false 应作为合法值保留。不要仅凭 JSON 中存在 `current` 键就判有数据。补 missing-current、missing-initial、stale、timeout、false→true、0→1、值未变的行为测试。`range` 和 stable 采样也应采用同一可用性规则，避免通过 `Number(null)` 把空值变成 0。

### R4：实际 direct-read 成功值没有进入 verify

位置：[verify-telemetry-adapter.mjs:124](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/infrastructure/modbus/verify-telemetry-adapter.mjs:124)。

生产注入的 modbusRead 返回 `values/readings`，适配器却只读顶层 `res.value/res.rawValue`。只要 `res.ok` 为 true，即使取不到任何值，也创建 quality=good 的 reading 并缓存。

使用真实 `modbusRead` sim 路径对 A 的 pa 读取：

```json
{"modbusOk":true,"values":[{"pointId":"pa","value":260,"raw":260}],"adapterValue":"undefined","adapterQuality":"good"}
```

结果是断言明明有合法采样仍失败，或与 R3 组合后错误通过。现有实时采样测试主要用手写的 `val` fixture，未贯通生产 read-service 的返回形状。

代码级建议：先确定 R1 的合法目标，再给 read-service 明确 connectionId/deviceId/pointId 与受控来源；从成功响应的 values 中选唯一且 provenance 匹配的目标记录，读取 value/raw/at。`ok:true` 不是“已取得数值”的充分条件，空值、失败记录和多个错配记录不应缓存为 good。补真实 sim read-service→adapter→verify 的测试，保留 0/false，并校验 signal 向读取服务传递。

### R5：foreign 拒绝正确，但焦点生命周期缺少独立会话槽

位置：[focus-service.mjs:74](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/modbus/focus-service.mjs:74)、[evidence-append-service.mjs:94](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/modbus/evidence-append-service.mjs:94)。

workspace 只有一个全局 focus。A 一旦显式定位，B 对自己的合法目标显式定位也会在目标解析之前返回 `SESSION_MISMATCH`。甚至 A 仅追加证据、没有 request，也会把空 focus 的 owner 建成 A，从而锁住 B。UI 5 秒后清高亮只修改 React 本地状态，磁盘 owner 继续存在；当前正常 focus API 没有 owner-scoped clear/release。

复现：A 定位 pa 成功，B 定位 pb 失败，错误码 `SESSION_MISMATCH`。

这是遵守 017/018 禁止跨会话覆盖后暴露出的能力缺口，不建议直接放开 B 覆盖 A。应设计会话独立 focus 存储和 projection（例如 focusBySession），连同 prev/evidence/tempWatch、alarm agent-focus 授权及 UI store 一起切换。若短期不能迁移，至少提供带 owner 校验的清理入口并明确生命周期；单独清理仍不能提供真正并行焦点。遗留无主焦点保持隐藏，不能猜 owner 自动迁移。

### R6：焦点事件去重吞掉 evidence-only 更新

位置：[use-agent-focus.mjs:39](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/ui/hmi/hooks/use-agent-focus.mjs:39)。

effect 依赖不包含 evidence、tempWatchIds、prev，且相同 request key 会直接 return。于是同一个焦点后追加新证据，Host 状态已经更新，UI focusState 和共享 focus store 仍保持旧证据。React 生命周期复现中，rerender 输入 `evidence:[new-event]`，最终 focusState.evidence 仍为 `[]`。

key 没有 sessionId/cwd，切换 scope 后若请求键相同也会被去重。静态检查还发现 `focus-store.mjs` 的 focus/tempWatch map 仅以 cwd 为键；`visualization-page.mjs:73` 订阅只带 cwd，不检查 sessionId。这些读取方式没有承接 Host 已投影好的会话作用域。

代码级建议：拆开“同步完整 focus 状态”和“新事件触发路由/限时高亮”。前者必须消费 evidence/prev/tempWatch/badge/owner 的更新；后者才按 request identity 去重，且 scope 改变时重置 key。5 秒高亮 TTL 不因证据追加重启。focus store、订阅、tempWatch 使用 sid+cwd tuple，visualization 的订阅与 owner 一致。foreign/ownerless 输入应关闭显示，不能只标为 badgeOnly 后继续广播。

验收：同 request 追加证据、只改 tempWatch/badge、到期后追加、A/B 同 cwd、切换 cwd 后相同 target，以及重复状态轮询不重复导航。

### R7：append 成功出口没有执行历史证据读时校验

位置：[evidence-append-service.mjs:108](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/modbus/evidence-append-service.mjs:108)。

输入批次被验证，但成功返回的完整 evidence 只用 `ownedBy(row,sid)` 筛选。历史行即使标为 A，只要其实际来源不属于 A/已过期，也会经 UI RPC evidence 出口返回。status 的 `projectVisibleFocus` 却能隐藏相同行，形成两个出口不一致。

复现：A-owned focus 中留着 `{kind:'log',id:'b-event',sessionId:A}`，向它合法追加 a-event：

```json
{"appendReturned":["b-event","a-event"],"statusVisible":["a-event"]}
```

仅持有 A owner 标签不能证明 b-event 来源属于 A。Agent evidence handler 追加后重新列出 refs，因此此缺口重点在直接 service/UI RPC 返回，不应宣称所有 Agent evidence 查询均泄露。

代码级建议：使用写锁内保存后的 workspace 与相同 scope，对成功返回的每条历史行执行 `resolveEvidenceRef(...,{checkVersion:false})`，或统一调用 projectVisibleFocus。沿用“隐藏但不自动删历史磁盘行”的政策；新批次保留原子校验。补 RPC evidence 和 Host status 对同一旧行输出一致的回归。

### R8：幂等缓存永远保留 rejected promise

位置：[command-idempotency-cache.mjs:100](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/commands/command-idempotency-cache.mjs:100)。

executor throw/reject 时没有设置 completedAt，也没有失败终态。重复同一 commandId 只 await 原 rejected promise；prune 只处理 completed entry，失败行不会按 TTL 到期，也不会被 completed-only 容量裁剪。

复现：第一次 executor 抛 transient，第二次同 ID 的 executor 本可成功，实际两次均 rejected，executorCalls=1，completedAt=null。外层 Host client 把它包装为 HOST_DISPATCH_FAILED 不会修复内层缓存。这是之前明确延期的缓存问题，当前仍存在。

代码级建议：定义 pending/completed/failed-or-unknown 状态并给失败终态完成时间，保证 TTL/容量有效。针对读操作可定义受控重试；对可能已经产生副作用的写/build/flash，不要简单删除失败记录后自动重放，应返回“结果未确认”的终态并要求查询实际状态。拒绝已挂起操作被容量裁剪后重新执行。测试同 ID 失败重放、失败 TTL、容量、并发 pending，以及 side-effect-then-throw 不重复写入。

## 3. 建议迭代顺序

1. **先修 R1 与 R2**：把实际采样、告警断言、run 查询/取消接到同一作用域规则。不要只再给 evidence 增加过滤。
2. **接着修 R3 与 R4**：统一可用采样契约，并用实际 read-service 的 sim 响应验证到最终断言；无数据必须不可通过。
3. **修 R7**：收齐 018 的成功返回边界，改动小，可独立提交。
4. **设计并实现 R5/R6**：焦点按会话存储，完整状态同步和导航事件分开；后端与所有 UI 消费者同时落地，不靠放开跨会话覆盖绕过问题。
5. **独立处理 R8**：有界失败缓存与副作用未知的重放策略一起定，避免修缓存时引入重复硬件操作。

每组补上述行为红测，再修复、转绿。测试应贯通真实 production helper，避免只让 fake loader 返回假定的平面值。结构拆分优先于扩大白名单；新增发布模块加入 files 闭包。

本次未改业务代码、未提交或推送。所有门禁通过代表当前已有测试的结果；新复现证明还需补全覆盖。下一轮验收继续要求零单测失败，不再沿用历史“三项基线失败”豁免。Web/Desktop 需要同 cwd 两会话复核引用、验证和焦点；硬件验收单列，不用 sim 结果替代。

## 4. 结合 Harness 第 5–8 轮实测

对照来源：[vision-plugin-rounds5-8-verification.md](/Users/qin/DSH/vision-plugin-rounds5-8-verification.md)。原报告保持不变。本节区分其实际观察、对观察的解释以及当前源码可以证明的行为。

### 4.1 实测与源码对照

| 报告事项 | 综合判断 | 依据与边界 |
|---|---|---|
| A-10：summary 可用、字段减少 | 符合源码 | `projectPointListRow` 输出 id/name/connectionId/deviceId/valueStatus；具体 85% 降幅来自该实测样本，不能作为所有点表的固定比例 |
| A-12：无 limit，56 个点返回 20 | 观察正确，修复时间需纠正 | `points-list-page.mjs` 默认 20、最大 50；`git show 79d8768:…` 已有相同上限。实现来自更早的 `253f83b`，第七轮应归类为确认既有行为，而非新增默认值 |
| A-13：非法 view 文案已自洽 | 符合源码 | `agent-query-fields.mjs` 区分 UNSUPPORTED_FIELD / INVALID_VALUE / INVALID_TYPE，compact 返回 allowedValues |
| A-11：log=[]、logHiddenCount | 符合设计，不重新列为泄露修复 | `redactAgentStatusLog` 隐藏无归属短日志；timeline 只返回当前 sid 的事件，不能声称完整还原那 8 条隐藏日志 |
| A-14：kind 在 evidence 报错，在 points list 被忽略 | 已独立复现 | 全局 schema 接受 kind；通用查询校验仅覆盖 cursor/view，evidence handler 独立拒绝 kind/id，points list 没有相应校验 |
| truncated 表示内容截断 | 与当前源码不符 | timeline Agent 投影只要 nextCursor 非空就设 true；summary 截到 180 字符本身却不设置截断标记 |
| evidence 返回 5 个点，因为这些点被可视化引用 | 选择规则解释不符 | `collectVisibleEvidenceRefs` 选择有效可见点中前 5 个，不查询可视化引用关系；该样本可能刚好重合 |
| 游标保留视图、翻页正常 | 报告证据不足，存在契约缺口 | 第十一节明确未测游标回填；游标内有 view 不等于下一请求自动沿用 view，见 R11 |
| 14 项中 12 项收敛，剩余均低优先级 | 仅适用于其已登记的问题集合 | 未覆盖 verify 的值读取/断言/run 管理、focus 写入、evidence 追加、UI evidence 更新，不能用于排除本审查的 R1–R8 |

本地 build-info 的 gitSha 为 c97dba3，源码指纹检查通过，与第七、八轮的构建标识相符。报告的 pid/configVersion 和清理结果属于当时运行态证据，本次没有再次读取或改动用户实际工作区来确认。只读快照也不足以把版本推进或连接关闭归因于查询。

现有 tool 描述已明确 `status.log` 隐藏无会话归属的短日志，`logHiddenCount` 不是可读取条数或未读计数。因此 A-11 无需新增业务修复；应纠正报告的“完全覆盖”表述，不移除兼容字段。若报告中的 timeline 首页确实同时出现 `nextCursor` 非空和 `truncated:false`，则与当前 Agent 投影不符；需保留那次完整请求/原始响应及 Host、工具构建信息，对照是否走了未投影的 Host 返回。现有文档摘录不能确定当时调用链，不能凭这点另下“部署故障”的结论。

### R9 / P3：已知字段不适用时，Agent 查询缺少一致校验

位置：[agent-query-fields.mjs:135](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/commands/agent-query-fields.mjs:135)、[vision-bench-tool.mjs:188](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/interfaces/agent/vision-bench-tool.mjs:188)、[evidence-command-handler.mjs:76](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/commands/handlers/evidence-command-handler.mjs:76)。

在临时工作区构造 26 个私有点，经实际 Host command 链路以 Agent 来源查询：

```json
{"request":{"action":"points","op":"list","kind":"log","view":"summary"},"ok":true,"total":26,"returned":20}
{"request":{"action":"evidence","kind":"log"},"ok":false,"errorCode":"INVALID_FIELD"}
```

这是调用纠错缺口，不是 point kind 过滤能力。不要将 kind 当成有效过滤器，也不要为修它新增不存在的过滤语义。

修复建议：在共享查询校验器中为 Agent 的已知查询字段建立 action/op 适用表，先覆盖 kind/id/cursor/view；points list + kind 返回 INVALID_FIELD、reason=UNSUPPORTED_FIELD 和实际支持位置。预检与 Host 使用同一规则，在读取工作区之前拒绝。必须保留 points get 的 id 别名、frames/alarm 的合法 id 入口和 focus 的 kind 用法；不要用全局字段黑名单误伤它们。搜查预设、文档和内部调用，非 Agent/UI 的宽松兼容规则单独保持。测试覆盖错误字段、合法别名、正确 kind 入口及错误响应的 commandId。

### R10 / P3：timeline 的分页与内容截断标记混用

位置：[agent-result-project-timeline.mjs:34](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/commands/agent-result-project-timeline.mjs:34)、[agent-observe-queries.mjs:90](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/commands/agent-observe-queries.mjs:90)。

临时 workspace 有 2 个事件，其中一个原 summary 为 240 字符。经实际 timeline 查询及 Agent 投影得到：

| 请求 | 返回摘要长度 | nextCursor | Host truncated | Agent truncated |
|---|---|---|---|---|
| limit=1 | 180 | e1 | false | true |
| limit=2 | 180、5 | null | false | false |

即：分页本身会把 Agent truncated 设成 true；已经发生文本裁剪，末页仍可是 false。另一个 26 点返回 20 的 points list 却为 false。当前字段不是跨动作一致的“内容完整性”标记。不能照报告的推断直接补一段“只表示内容截断”的文档，否则文档会与实现冲突。

修复建议：首先明确兼容契约。分页继续只用 nextCursor/returned/total；在 `projectTimelineEvent` 增加每条 `summaryTruncated`，以裁剪前长度判定；Agent 投影另返回 `budgetTruncated`，只在字节预算缩页时为 true。短期保留旧 truncated 的现有行为并注明动作差异，避免静默改变已有客户端判断；如要统一其语义，另做明确的契约变更。测试普通分页、末页长摘要、字节预算缩页、单事件 RESULT_TOO_LARGE，均验证不漏事件且游标锚点对应实际返回末项。points get 的 omittedIds 与这些字段也应分别解释。

### R11 / P2：summary 续页只传 cursor 会被拒绝

位置：[point-service.mjs:98](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/modbus/point-service.mjs:98)、[points-list-page.mjs:137](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/modbus/points-list-page.mjs:137)。

服务先将缺省 view 变成 full，再比较游标 fingerprint。纯分页 helper 已复现：首请求 view=summary、limit=1；下一请求仅回填 cursor，返回 CURSOR_EXPIRED；再次显式带 view=summary 才成功。现有多页测试每页均显式传 summary，因此覆盖不到缺省续页。这里是查询契约与 Agent 提示的可用性缺口，不能把它描述为游标必然重置视图或跨会话读取。

建议实现：保留“未传 view”与“显式 full”两个状态；在游标解析后、对 configVersion 和可信 origin session 校验通过后，缺省 view 可继承游标内已校验的 full/summary；显式 view 与游标不同仍拒绝。由分页结果的 resolved view 决定行投影，不能提前按 full 投影。游标里的 sessionId 永远不能替代 origin 授权；connectionId/deviceId 过滤器仍按现有匹配规则，文档要求每页保持过滤条件。若决定继续要求重复 view，则必须在 tool 描述、分页示例和错误 hint 中明确写出，不能仅写“把 nextCursor 作为 cursor 续查”。

验收增加：summary 首页→只传 cursor 的后续页、显式切 full、跨 sid、配置版本变化、过滤器改变、字节预算裁剪后续页；完整枚举 ID 无重无漏，summary 页均不带运行值。Web/Desktop 的实际工具调用也需做至少一次游标回填，不能只解码字符串确认里面含 view。

### 4.2 合并后的修复与验收优先级

1. R1/R2/R3 是本轮优先修复项：先保证 Agent 的验证数据、结果归属和通过判定可信；R4 与其共用真实 read-service 的集成验收。
2. R7 收齐证据返回校验，R5/R6 贯通多会话焦点与 UI 生命周期，R8 单独处理失败终态及写操作重放。
3. 查询契约小组处理 R11，再处理 R9/R10；A-11 保留现有隐藏策略、字段和已写明的 tool 说明，修正验收报告解读即可；A-12 不再修改默认 limit。
4. Harness 回归表增加 verify 跨会话/无值、focus 写入、evidence 追加与历史行、真实游标回填、UI 同焦点追加证据。均可先在临时 sim 工作区完成，不需要物理写入。

本次补充重跑 `points-list-pagination`、`timeline-budget`、`query-field-values`：**8/8 通过**。新增临时工作区复现仅用于证明上面的边界，未加入生产代码或测试套件；原有通过测试不能证明这些新场景已被修复。全量 1724/1724 是第 1 节本次审查的已跑结果，没有因只更新文档重复全量门禁。
