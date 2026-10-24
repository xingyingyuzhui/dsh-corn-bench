# Corn 证据与焦点会话隔离收口计划（018）

## 基线与目标

基线为本地 `main@7082f88`（017 后、相对本地 `origin/main` 超前 4 个提交），工作树干净。已验证 `test:unit` **1705/1705**，lint、typecheck、deps、structure、assertions、pack、build 均通过。本计划只修复 017 审查后剩余的四类边界：无归属旧焦点泄露、跨会话同 ID 引用自相矛盾、verify 引用未统一授权、`focus` 输入与身份契约不严。不改变配置共享开关、全局 journal 页面或硬件读写语义。

必须保持：Agent/Host origin 不从业务 body 推断；UI RPC 的 `sessionId` 是页面作用域而非本机强认证；任何拒绝都不改变 `config.json`、`runtime.json`、focus、configVersion；Web 与 Desktop 不能仅凭单测声称安装验收通过。实施前先把以下复现写成失败测试，每组修复后转绿。

## A（P1）：无归属旧焦点按来源失败关闭

现状：`src/application/modbus/evidence-scope.mjs::projectVisibleFocus` 对 `focus.sessionId=''` 不走拒绝分支，虽过滤 `evidence`，却原样返回 `request/prev/tempWatchIds`。`src/application/modbus/evidence-append-service.mjs::appendEvidence` 允许带 sid 的调用认领无主 focus，并保留旧 request、prev 与 evidence。`src/application/modbus/focus-service.mjs::requestFocus` 也把旧 request 写进新焦点的 `prev`。在分区工作区，旧 B 目标可经 A 的 Host status/RPC snapshot 暴露。

1. 在 `evidence-scope.mjs` 定义纯函数 `focusOwnership(focus,sid,partitioned)`，区分 `owned`、`foreign`、`unowned-empty`、`unowned-legacy`。**空的无主焦点**必须同时满足 `request==null`、`prev==null`、`tempWatchIds.length===0`、`evidence.length===0`、`badgeOnly!==true`；只要一项仍有内容（包括仅剩旧 evidence 或 badgeOnly），就是遗留焦点。当前调用携带非空 sid，而旧 focus 无 owner 时，**读视图返回空焦点**；不根据 target ID 或当前配置反推旧 focus 属于 A。仅未分区且无 sid 的旧匿名视图保留兼容；证据行仍逐条解析。`focusForView`、Host status、RPC `sessionWorkspaceView` 共用它，不能只在 React 中隐藏。
2. `appendEvidence` 在 repository 的 `updateRuntime` 锁内先判归属：`owned` 继续，`foreign` 返回 `SESSION_MISMATCH`，`unowned-empty` 可建立 sid，`unowned-legacy` 返回 `SESSION_MISMATCH` 与 `details.reason='UNOWNED_LEGACY_FOCUS'`，提示先由本会话显式设新焦点。无 sid、未分区的旧调用维持原有匿名兼容。不得仅给旧焦点写 `sessionId=sid`。
3. `requestFocus` 可用明确的新目标替换 `unowned-legacy`，但 `prev=null`、只保存本次已验证的 evidence，不能把旧 request/prev/tempWatchIds 带入新焦点；拒绝时零写入。对于已归同一 sid 的焦点继续保留正常 `prev`。保持用户显式新 focus 的语义，不加隐式跨会话接管。

红测使用原始旧磁盘 fixture：无主 focus 包含 B 私有 `request/prev`、旧 evidence 与 tempWatchIds。A/B 的 Host `status`、RPC `workspace/get`/`state` 都不得看见这些字段；A `appendEvidence` 被拒且两盘文件字节不变；A 显式新 `focus` 后 `prev=null`、新 request 属于 A；同会话 focus 更新仍有正确 prev；未分区匿名调用保持兼容。

产品取舍已定：**未分区工作区只要页面带 sid，也不再展示无主旧焦点**。升级后已有高亮可能暂时消失，下一次用户显式“定位”会建立可归属的新焦点；不自动猜 owner 或迁移旧焦点。测试需覆盖“单会话、未分区、带 sid”的此行为，并验证匿名旧入口仍兼容。

## B（P2）：journal 引用的生成与追加使用同一身份键

现状：`collectVisibleEvidenceRefs` 按 `sessionId` 先筛任务/事件，`resolveJournalRef` 却先 `find(id)` 再检查 owner。B 的同 ID 记录排在 A 前时，A 会收到自己的 `log/build` 引用，却无法追加它。

1. 在 `evidence-scope.mjs` 增加纯 helper `findOwnedJournalRow(rows,{kind,id,sessionId})`，按 `kind + id + owner` 一次匹配；`log` 只搜 timeline，`build` 只搜 build tasks。匹配数为 0 返回原有不泄露其他会话的 `TARGET_MISMATCH`，匹配数为 1 成功；**同一 owner 内同 kind/id 出现多个**时也返回 `TARGET_MISMATCH`（`details.reason='AMBIGUOUS_ID'`），不随机挑第一条。顶层 `error` 仍统一写“记录不存在、已过期或当前会话不可见”；`AMBIGUOUS_ID` 只针对当前 owner 内的重复，不能回显别人的 owner、ID 列表或重复数量。
2. 生成端选 latest build/log 后也经过这个 helper；若同 owner 不唯一，就跳过该引用，不生成无法兑现的 ID。跨 owner 同 ID 是合法输入，按 owner 区分；不通过给 ID 自动改名掩盖旧数据。
3. 上述规则同时用于历史 focus evidence 的读时复核；旧行没有 owner 时只能在匿名未分区视图中匹配无归属来源。把 `details.reason` 从纯 resolver 经 `resolveEvidenceBatch`、`appendEvidence`/`requestFocus`、Host handler 与 Agent 投影逐层透传；RPC 也保留这个结构化字段，不能只在内部 helper 返回后丢失。

红测包含 B 在前/A 在后的同 ID `log` 与 `build`：A 生成的引用可成功追加，B 只能引用 B；同 owner 重复 ID 不生成、不追加，Host/Agent 的顶层文案保持统一且 `details.reason==='AMBIGUOUS_ID'`；旧行按同样规则隐藏；异会话 ID 不存在/被淘汰仍保持同一个 `TARGET_MISMATCH` 文案且不透露其它 owner。检查批次第二条失败时 0 写入。

## C（P2）：verify 的可选证据输入也走来源校验

现状：`src/application/verify/verify-service.mjs::ownsSnapshot` 在 runtime 没有 `resolveOwnedSnapshotRef` 时返回 `Boolean(ownerSessionId)`，没有验证 snapshot ID、owner、cwd；`evidenceBuilder(cwd,ownerSessionId)` 返回的非快照引用原样进入结果。当前生产构造未注入 builder，但此可选接口不满足 017 的统一授权约定。

1. 删除 `Boolean(ownerSessionId)` 宽松 fallback。runtime 缺少 owned snapshot resolver 时，候选 `debug_snapshot` 一律不进入结果；对 verify 刚创建的快照也一样。测试 fake 应实现 resolver，不能用 fake 缺能力来放宽生产路径。
2. 从 `workspaceLoader(workspaceCwd)` 获取**同一份** workspace 快照，构造与 `evidence-scope.mjs::resolveEvidenceRef` 一致的会话 scope（配置用当前 sid 的有效投影，build/log 用结构化 owner，debug 用 owner+cwd+snapshotId）。候选 builder 行逐条验证后再进入 `VerifyResult.evidence`；未知 kind、无归属、别的会话、已淘汰项丢弃。验证失败不得回填原始候选行。若 workspace 不可加载，builder 候选全部失败关闭；verify 断言本身可继续。
3. 新建快照走 `debugRuntime.command({debugSessionId,ownerSessionId}, snapshot)` 后，用 owned resolver 再核一次 id/cwd/owner，返回引用包含 `debugSessionId`，便于后续引用解析。避免 `verify-service` 与 Host 存储形成循环依赖；共享纯 resolver，可用小型 scope factory，新增模块加入 `package.json files`，不扩 structure 白名单。

红测让 builder 同时返回 A/B 的 build/log、B 快照、无归属与未知 kind；结果仅保留可验证的 A 行。旧 fake 无 resolver 时快照不出现；实现 resolver 的 fake 和真实 debug registry 在 A/cwd 匹配时返回新快照；同 owner 不同 cwd、同 cwd 不同 owner 均被过滤。既有 verify 正常断言数、status 和 timeout/cancel 行为不变。

## D（P2）：收紧 `focus` 入口身份与输入上限

1. `requestFocus(home,cwd,body,origin)` 不再默认 `originOf(body)`；若省略 origin，按 `{source:'user',sessionId:''}` 的匿名旧调用处理，**绝不读 `body.source/body.sessionId`**。Agent 入口必须显式传 Host command origin；UI RPC 显式传页面 session scope。分区工作区省略 origin 返回 `SESSION_REQUIRED`，零写入；未分区匿名调用保留兼容。
2. `body.evidence === undefined` 表示空列表。显式 `null`、对象、字符串等非数组返回 `INVALID_FIELD`；数组长于 20 返回 `INVALID_FIELD` 与 `details.maxItems=20`，不得先 `slice(0,20)` 使第 21 条逃过校验。长度 0～20 每项都在同一 `updateRuntime` 锁内验证；第二十条失败整批失败。保持成功时最多保存 20 行的磁盘上限。
3. `src/interfaces/rpc/corn-rpc-workspace.mjs::rpcRequestFocus` 与 `handlers/evidence-command-handler.mjs` 不把请求体的 sid/source 当成覆盖独立 origin 的参数。更新 `focus-explicit` 等直接调用 `requestFocus` 且靠 body.source 推出 Agent 角标的测试，显式传 `{source:'agent',sessionId}`，保持原断言不放宽；`focus-routing` 主要是纯路由测试，先重跑再决定是否需要改，不机械修改。对确实依赖匿名兼容的用例写清预期。

红测覆盖 `body.sessionId='B'` 而独立 origin 为 A、完全省略 origin 的分区调用、非数组/null evidence、21 项中第 21 项非法、20 项中末项非法、20 项合法、并发 focus/append。拒绝均为 0 磁盘改动，Agent 错误经 tool→Host 投影保留 `commandId/errorCode`。

## 实施与验收顺序

按 **A → B → C → D** 分四个小提交；每组先红测、后实现、再绿测。A、B 共用的纯辅助函数可在 A 建立，后续 B 增补；避免循环依赖，生产文件与测试文件分别守住结构预算。不要合并未完成的组，也不要通过改宽断言让红测消失。

每组跑相关测试；收尾跑 `npm run test:unit`（基线 1705/1705，新增测试后仍须 0 失败）、`lint`、`typecheck`、`deps:check`、`structure:check`、`assertions:check`、`pack:check`、`build:check`、`git diff --check`。`pack:check` 会重生成 `build-info.json`：提交前确认其内容与最终源码构建一致，并确保除预期提交外工作树干净。不得把旧“三项基线失败”再列作豁免。

最后用同 cwd 两会话在 Web 和 Desktop lab 验收：无主旧焦点读取/追加、同 ID 引用生成→追加、verify-owned 快照、正常 UI“让 Agent 分析”及 017 查询契约回归；记录源码 SHA、buildId、插件版本与工作区文件指纹。无需真实硬件写入；lab 验收与正式 Desktop 产品安装证明分开表述。

推送顺序已定：**先单独推送并确认 017 的四个现有提交（HEAD `7082f88`），再以该远端基线实施 018**。018 文档当前未跟踪，不混进 017 推送；018 四组提交、门禁和验收结束后再单独推送。这里记录交付决策，本轮仅更新计划，不代替实际 `git push`。
