# 022 整体审查修复与验证（2026-10-15）

## 范围与状态

依据 [整体审查](../reviews/2026-10-15-project-wide-review.md) 的 N1–N8，由本会话直接完成代码、复现测试、回归与本地打包。Bench 从 `0.29.29` 更新到 `0.29.30`；可选 Harness 从 `0.2.0` 更新到 `0.2.1`。10 月 15 日交付时改动留在工作树，未提交、推送或发布；10 月 22 日用户已授权同步 GitHub，本节保留当时的验收记录，后续提交记录见文末。

原始 10 条失败断言已拆入仓库，不依赖 `/tmp` 才能复现。补充正向与失败边界后，新增 Bench 21 条、Harness 5 条测试，共 26 条；部分单条测试包含多个动作/身份组合。

## 修复交付矩阵

| 项目 | 代码落点 | 最终行为与验证 |
| --- | --- | --- |
| N1 RPC 运行态隔离 | `src/application/modbus/caller-runtime-projection.mjs`；`src/interfaces/rpc/corn-rpc-workspace.mjs`、`corn-rpc-router.mjs`；`src/application/config/config-mutation-service.mjs` | 先保留分层身份做可见性/采样校验，再剥离内部元数据。values、alarmState、trend 按可见且身份唯一的点过滤；polling/frames 按可见且唯一归属的连接过滤；报文有显式外国会话时不返回。tasks/timeline/manualRequests/log 按调用方会话过滤；焦点和证据沿用既有读时验证。workspace/get、state、workspace/save、config 返回及 journal 使用同一边界。共享运行值仍可见，私有日志不会随配置共享开放；源工作区/磁盘历史不被删除。 |
| N2 失效历史值当当前值 | `src/application/modbus/point-query-value.mjs`；`src/application/commands/handlers/project-command-handler.mjs`、`visualization-command-handler.mjs` | 在身份唯一和 provenance 匹配之后，比对当前 fingerprint/generation；schema v2 的缺章/错章/旧代次不可用。先选择最新行，更新失败行阻断旧 good 回退。get/list 返回 unavailable 与空当前值；配置点仍计入 returned。status 与可视化当前值复用校验。仅改名保留当前值，改 address/scale 等后隐藏，新的合法采样恢复可用。旧 schema 无代次的唯一点保留既有兼容。 |
| N3 调试显式 ID 绕过 | `src/application/commands/command-contract.mjs`；`src/application/debug/debug-command-service.mjs`、`debug-session-registry.mjs`、`debug-runtime-lifecycle.mjs` | sessionId/cwd 只来自命令信封，不从嵌套 payload 回填。控制目标只能是归属与工作区校验成功的 session，不用请求里的 ID 作为 fallback。未授权 stop 不撤销控制 lease；匿名 runtime state/events/stop 不再享有空 owner 特权，失败墓碑查询也要求 owner。30 个动作×身份组合中的拒绝路径没有后端或撤销副作用。RPC/inspect 的命令 type 由已路由动作覆盖，不能被 payload 改成别的动作。 |
| N4 调试会话覆盖/资源泄漏 | `src/application/debug/debug-runtime-lifecycle.mjs`、`debug-runtime.mjs`；`src/domain/debug/target-lease.mjs` | 活跃/starting/stopping ID 被独占，重复 start 在第二次后端创建前返回 DEBUG_COMMAND_REJECTED。失败 ID 在现有 5 分钟墓碑窗口内也不可重用，正常 stop 完成后可再启动；租约重入同时核对 owner/cwd。stop 等待 startupDone 并共享 stopPromise；取消的 start 不能恢复 ready。shutdown 先关闭新 start，再等待所有既有启动/停止清理；控制命令在 starting/stopping 时返回 STALE。实例身份检查避免晚到 cleanup 删除别的记录。 |
| N5 tooltip HTML 注入 | `src/ui/monitor/visualization/hooks/viz-chart-options.mjs`；生成的 `client.js` | 自定义 HTML formatter 中转义 seriesName、yUnit、标题文本的 &、尖括号、单双引号。保留 ECharts 生成的 marker HTML、中文和数值格式。测试包含 HTML 标签名称、特殊字符单位和 marker 正向控制。没有升级 ECharts 主版本。 |
| N6 断点/观察点虚假状态 | `src/application/debug/debug-command-executor.mjs` | add/remove 等后端确认后才改权威 Map，异常或明确 `ok:false` 不伪造成功事件。后端不支持则拒绝；后端返回 verified:false 时如实保留 false。删除失败保留原项，随后合法删除可完成。测试覆盖断点创建失败、观察点创建失败、两类删除失败与恢复。 |
| N7 Standing 挂载竞争/同步异常 | `../dsh-corn-harness/lib/standing-failure-cache.mjs` | await dispose 之后统一读取状态；最终检查到 pending 发布之间没有 await。先发布 deferred promise 再执行 mount，同步 throw 进入 failed，不会被 pending 覆盖。并发首次请求只 mount 一次；显式 retry 可恢复；旧 generation 晚失败不会覆盖新成功结果。 |
| N8 持续故障日志消失 | `../dsh-corn-harness/lib/harness-log.mjs` | 分开 lastEmittedAt/lastSeenAt，以真正输出时间限流；count 累计，suppressed 只统计上次输出后的抑制数。500ms 连续错误可每秒输出摘要，只有首行携带 stack。close 刷完队列、幂等关闭，晚到 record/微任务不重开流；保留现有队列上限与滚动策略。 |

新运行模块已进入 package.json files 和既有 TypeScript 检查范围；未修改结构白名单和覆盖率阈值。

## 测试位置

Bench：

- `test/rpc/caller-runtime-isolation.test.mjs`：四类出口、所有运行态 map/journal/focus、匿名、共享和重复私有身份。
- `test/modbus/caller-runtime-boundary.test.mjs`：RPC 外国值、真实配置事务改址、改名保留、改几何隐藏与新采样恢复。
- `test/debug/debug-ownership-boundary.test.mjs`：匿名/外国 owner/错误 cwd、payload 身份、各类控制与失败状态。
- `test/debug/debug-session-reservation.test.mjs`：并发重复 ID、stop/shutdown 取消启动、关闭期间新 start、租约归属。
- `test/monitor/chart-tooltip-escape.test.mjs`：HTML 转义与安全显示正向控制。

Harness：`test/standing/runtime-boundary.test.mjs`。既有 failure-cache 测试改为等待真实 mount 启动信号，不再依赖恰好一次微任务调度。

既有调试测试补齐真实调用所需的 cwd、墓碑 owner 和 fake 后端断点方法；没有把拒绝断言放宽成成功。原采样元数据测试补齐 scale=1/offset=0，使测试章对应保存后实际几何。

### 补读兼容修复

生产 verify adapter 曾复用 points 查询选择器只做身份检查。N2 将选择器升级为当前采样校验后，首次 read-service 初始化 generation 会使“拿读前快照校验读后样本”失败。现保留补读结果唯一性、conn/device、质量、时间和章检查，交由既有 scoped reader 在 I/O 后重新解析目标并核对 fingerprint/generation；不将缺章视为合法，也不省略读后撤销/重绑校验。真实补读与 provenance 相关 19 条聚焦回归通过。

## 完整门禁

| 检查 | 结果 |
| --- | --- |
| Bench `npm run quality` | 通过 |
| Bench 全量测试/覆盖率 | **1848/1848**，0 fail/cancel/skip；lines/statements **86.02%**，branches **72.24%**，functions **78.97%** |
| Bench build:check / lint / typecheck / deps / facades / UI ownership / structure / assertions | 全过 |
| Bench critical coverage | 9 个关键文件门禁通过 |
| Bench pack:check / build-info | 564 条 files 项，无重复/幽灵路径/闭包缺口；build-info 563 个参与哈希文件 |
| Harness `npm run quality` | 通过，**30/30**；lines/statements **94.25%**，branches **80.62%**，functions **94.28%**；pack 闭包通过 |
| `git diff --check` | Bench 与父仓库 Harness 修改均通过 |

基线是零失败；没有把新失败归为历史基线。完整日志在 `/tmp/corn-fix-quality-final.log`、`/tmp/corn-fix-harness-quality.log`。原始红测在 `/tmp/corn-fix-red-bench.log`、`/tmp/corn-fix-red-harness.log`。

## 本地构建与安装证据

最终 Bench buildId：

```text
ebf6e5f97d53c32fb494738ba7c244f59d59f20e571f03eedc056174520e606c
```

| 位置 | 版本 | buildId |
| --- | --- | --- |
| 工作区 | 0.29.30 | ebf6e5f97d53… |
| Web profile 已落盘包 | 0.29.30 | ebf6e5f97d53… |
| Desktop profile lab 包 | 0.29.30 | ebf6e5f97d53… |

`gitSha=dfa68cf` 是修改所基于的 HEAD，**不是已包含本轮改动的提交**；这是 10 月 15 日未提交工作树的安装证据，应使用 buildId 识别该次构建；10 月 22 日同步时会更新源码包的 gitSha。

安装期间实际发现同版本 tarball 路径会复用 pnpm 旧 integrity：最初 0.29.30 文件落盘仍为中间构建。已修 `scripts/probes/install-desktop-local.mjs`：总是打包当前树，使用 `name-version-buildId前12位.tgz` 安装，避免路径缓存混淆；Web 也使用最终 buildId 对应的独立包路径。两端最终读取到完全相同 buildId。

Desktop lab 安装命令成功，未启动或关闭用户的 App。Web `dsh plugin --profile web add` 已更新包文件，但命令因既有 `ERR_PNPM_IGNORED_BUILDS`（`@serialport/bindings-cpp` 未获本机构建许可）非零退出；未修改 Web 的 allowBuilds/构建批准策略，**不宣称 Web 安装流程全绿或串口可用**。旧 Web lockfile 指向但已缺失的 0.29.29 tarball，先从 Desktop 缓存核验版本后恢复了原包。

另以两端已安装的 ESM 模块做无硬件 smoke：当前采样可用、改址旧样本拒绝、tooltip 转义、重复调试 ID 拒绝、payload owner 绕过拒绝，Web/Desktop 均通过。该验证是 **installed-module-smoke**，不是运行中的 Harness Agent fiber、页面交互或真实硬件验收。结果见 `/tmp/corn-fix-installed-smoke.log`。

## 保留边界

- 未实施此前明确延期的焦点按会话分槽，以及旧审查 R8 的命令幂等缓存失败终态；本轮 N8 是可选 Harness 日志，编号与旧 R8 无关。
- 不宣称所有查询入口和所有历史数据问题均已解决。RPC state/snapshot 原有 claim/轮询协调行为未在本轮重构；新投影函数自身不写盘。
- 无真实设备、烧录、实时 Web/Desktop UI 或真实 Agent fiber 验收。没有替用户启动 Harness 或触发设备 I/O。
- 可选 Harness 只更新源码、版本和自动测试，保持未安装、未启用，不改变当前宿主私有接口兼容范围。
- ECharts 依赖升级仍为单独事项；本轮修复自定义 formatter 的已证实 HTML 注入点，不声称清零所有第三方依赖风险。
- 套件父仓库原有 AGENTS.md、`.cursor/` 和子模块状态未清理或纳入无关提交。

## 2026-10-22 GitHub 同步收尾

用户已明确授权将当前套件上传至自己的 GitHub。Bench 修复提交为 `c23e988`（`fix: close runtime isolation and debug safety gaps`）；同一主分支此前未同步的 29 个提交一并纳入此次正常快进推送。

提交后重新执行两组件 `npm run quality`：Bench **1848/1848**、Harness **30/30**，全部门禁通过。Bench `build-info.json` 的 `gitSha` 更新为实际修复提交 `c23e988`，运行文件 `buildId` 仍为 `ebf6e5f97d53c32fb494738ba7c244f59d59f20e571f03eedc056174520e606c`；后续构建信息提交不改变这份业务源码。

目标仓库为 `xingyingyuzhui/dsh-corn-bench` 与 `xingyingyuzhui/dsh-corn-suite` 的 `main` 分支。套件仓库包含 Harness 修复并更新 Bench 子模块指针；父仓库本机 `AGENTS.md` 与 `.cursor/` 状态保留在本地。本次仅同步 GitHub 源码，不创建 npm 发布、GitHub Release 或新的安装验收声明；远端最终提交以 GitHub/Git 引用为准。
