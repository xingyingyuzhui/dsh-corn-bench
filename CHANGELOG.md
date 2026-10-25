## 0.31.1

需要 DSH 0.2.1-rc.2 或 0.2.1-rc.3。

- 修正工作台「Keil 设置已绑、工作台仍显示未绑定」：设置 → Corn 在 Keil 构建改用内置 Node UV4 运行器、去掉 Python 字段后，编译门控仍要求 `health.python` 就绪，导致 UV4 已绑定时也恒显示「未绑定 Keil UV4」且编译按钮禁用（构建链路只需要 UV4 绑定）。门控与按钮禁用条件改为只看 UV4；自检里 `keilProject` 能力不再由 Python 推导（工程扫描/解析本就是纯 Node）。
- 修正调试 → 工程结构右侧源码预览只显示上半、下半空白：编辑器主题把 `.cm-scroller` 写死 `max-height:320px`，且预览卡片的高度链没有确定高度，文件后半段滚不到。现在编辑器撑满卡片高度并在内部滚动（无 CodeMirror 的 `<pre>` 兜底同样处理），预览正文/代码框/编辑器容器统一 `flex:1 1 auto; min-height:0`。

## 0.31.0

需要 DSH 0.2.1-rc.2 或 0.2.1-rc.3。**破坏性改名**：DSH 会把它当作新插件，需卸载旧插件后重新安装。

- 修正 DSH 0.2.1-rc.3 上的误报：设置页原本会提示「Corn模式 按 DSH 0.2.1-rc.2 的 standard 预设生成，已安装 DSH 0.2.1-rc.3；工具集可能不同，请升级插件」。在 0.2.x 上，注册时已经拿当前 DSH 的 standard 预设逐行比对过；比对确实执行且没有差异时，不再退回到版本号比较。rc.2 → rc.3 的预设注册表、UI 插槽、connection、tools、persona 包内容完全相同。
- README 支持范围更新到 `0.2.1-rc.3`，并说明新版的「更多」菜单。

- 品牌改为 **Corn**，技术名称一并改名：包名 `dsh-corn-bench`、GitHub 仓库 `xingyingyuzhui/dsh-corn-bench`、预设 id `corn-bench`（「Corn模式」）、工具 `corn_bench` / `corn_debug`、Agent loader `dsh-corn-bench-tools`、Fetch 路由 `/api/corn-bench/dispatch`、数据目录 `$DSH_HOME/corn-bench/`、环境变量 `CORN_BENCH_*`，源码文件和函数名同步改名。
- 升级迁移：Host 和 Agent 首次启动时把旧数据目录整体改名为 `$DSH_HOME/corn-bench/`（已存在则不动）；界面首次加载时把旧 localStorage 偏好（导航、上次打开的页面）迁到 `dsh-corn-bench:` 前缀。旧名只保留在 `src/shared/legacy-names.mjs`。DSH 会把它当作新插件：需要卸载旧插件后重新安装，新建 Session 选 Corn模式。
- 设置 → Corn 顶部加玉米图标、作者 [xingyingyuzhui](https://github.com/xingyingyuzhui) 与仓库、授权链接。DSH 的 `settings.section` / `conversation.view` 插槽没有图标字段，所以图标只出现在插件自己的页面里；源图在 `assets/corn-icon.png`。
- 授权从 MIT 改为 **PolyForm Noncommercial 1.0.0**（`LICENSE.md`，含 Required Notice）。`package.json` 的 `license` 改为 `PolyForm-Noncommercial-1.0.0`，补 `author` / `homepage` / `bugs`。0.30.2 及更早版本仍是 MIT。
- 原合集仓库已并入本仓库：现行工程计划移到 `docs/plans/suite/`，历史计划和合集 CHANGELOG 在 `docs/archive/suite/`；已移除的旧 harness 插件（0.2.1，仅适用 DSH ≤ 0.1.6）源码快照作为 Release 附件 `harness-0.2.1-legacy.tar.gz` 保存。

## 0.30.2

需要 DSH 0.2.1-rc.2。

- 修正 Desktop 下 DSH 安装位置解析错误：原先用 `process.execPath` 反推安装前缀，而 Electron 的 `execPath` 是应用主程序，算出的 `Contents/lib/node_modules/@deepseek-ai/dsh` 并不存在，解析于是落到无关的全局 CLI（本机是 0.1.7）。后果是 `readInstalledDshVersion()` 报错版本，设置页出现误导性告警「Corn模式 按 DSH 0.2.1-rc.2 的 standard 预设生成，已安装 DSH 0.1.7-alpha.2；请升级插件」。
- 改为优先用 Electron 的 `process.resourcesPath` 定位应用自带的 `Resources/app.asar/dsh` —— 那才是 Host 真正在跑的 DSH；`execPath` 推导和前缀路径退到其后。
- 同一修复让 `loadOfficialPersonaConfig()` 在 Desktop 下重新可用（此前无法解析 `@deepseek-ai/dsh-persona`）。
- 回归测试覆盖 Electron 情形，并验证「应用自带副本排在 execPath 推导之前」；该用例在修复前失败。

## 0.30.1

需要 DSH 0.2.1-rc.2。

- 修正安装文档：桌面插件窗口**接受** Git 地址、tarball 和本地绝对路径，不只是 registry 包名。此前 README 与验收矩阵都写成「`file:` / `link:` / `github:` / tgz 一律被拒绝」，与实际应用行为不符。按本机 DSH 0.2.1-rc.2 解包 `app.asar` 后 `@deepseek-ai/dsh-plugin-manager` 的 `install-spec.js` 核对。因此已发布的版本可以填 `github:xingyingyuzhui/dsh-corn-bench#v0.30.1` 或 tgz 绝对路径直接装；只有裸包名仍需 npm。
- 修正一条假通过的测试：`write-task-lifecycle` 依赖 `fs.renameSync` 的 mock，但 `write-file-atomic` 在 rename 前会做 `fs.realpathSync`，macOS 上 `$TMPDIR` 的 `/var/...` 会解析成 `/private/var/...`，mock 从不命中，「保存失败必须关掉写任务」从未被真正验证。改为比对解析后的路径。
- 该文档修正位于 `files[]` 内，因此 `buildId` 变化；安装包内的文档说明以本版为准。

## 0.30.0

Requires DSH 0.2.1-rc.2.

- 对齐 DSH 0.2.1-rc.2：契约钉改为 `0.2.1-rc.2`；Corn模式 重述 0.2.1 的 standard 预设（新增 time-context、tool-schedule、plugin-market 工具，persona 只保留 prefix）。按注册表能力选快照，DSH 0.1.7 继续用冻结快照。DSH 0.2.x 上与实时 standard 比对，不一致在设置页提示。CI 增加 Node 24。
- 设置 → Corn 新增「Agent 权限」：可关闭 Agent 写点批准（默认开，关闭需确认）。关闭后写点结果带 `approval: 'policy-disabled'`；`status` 返回 `agentWriteApproval`。
- 安全：Agent HTTP 命令桥一律按 Agent 执行，请求体不能自称 user 绕过写点批准。
- 安全：调试启动不再伪造固件（工作区不存在、只有哈希、`allowMissingArtifact`）；OpenOCD 接口/目标白名单无论工作区是否存在都生效；GDB/OpenOCD/UV4 路径只取设置里的绑定，不接受请求指定。
- 稳定窗口校验在时钟越过窗口终点而最新采样差 1ms 时会等下一采样，不再误报采样不足。
- `bindings/save` 未带 `bindings` 时不再清空工具路径。
- 测试：两个 CI 失败修复（verify 超时定时器、`chflags` 仅 macOS）；调试测试改用真实工作区与固件。
- UI 边界：Corn 嵌在 DSH 会话面板里，宽度与窗口无关。告警、操作记录、串口报文、调试、通用分栏改用面板容器查询，窄面板改为上下排列；工程结构页在窄面板把函数详情和预览放到文件树下方，不再截掉右侧（如「MDK-」链接）；筛选栏、子工具栏、分页、调试子标签改为换行，不再把搜索框和重置按钮藏进横向滚动。
- 深色模式跟随 DSH 自己的外观设置（`body[data-ds-dark-theme]`），不再跟随系统；工程图谱、函数详情的配色在深色下不再白底白字，函数图标与 TX/RX 标签在深色下用浅色调。
- 运行调试在没有调试会话时只显示一张说明卡（如何启动、需要准备什么），不再是六张空卡片；断点和监视需会话存在才能添加，空闲时不再显示会失败的添加按钮。
- 告警、操作记录表格为空时说明「当前筛选条件下没有…」；详情提示不再写「左侧」，并提高对比度。
- 点位表查看时只显示名称、监视、功能码、地址、当前值、单位、告警，告警列附阈值摘要（如 `<10 · >50`）；倍率、偏移和阈值列在编辑点位时显示。表宽按实际渲染列计算（之前漏算告警回差）。
- 行内写入浮层标明写入的点位和地址；工程树根节点只显示工程名，代码预览去掉重复的路径标题。
- 视图切换（树形/图谱、协议报文/原始数据、HEX/Text）改为分段控件；按钮里的文字符号（▶ ↻ ＋ ⛶ ⚠️ 等）换成统一线条图标；「＋连接」改为「新建连接」。
- 浅色模式下选中标签文字加深到约 5:1 对比度；串口报文默认只露连接、方向、状态，其余筛选收进「更多筛选」并显示仍生效的数量；禁用的编译、下载固件按钮悬停显示原因。

## 0.29.30

- RPC 工作区、状态与配置响应统一过滤运行值、告警、趋势、报文和会话日志；共享配置不开放其他会话的私有任务。
- points get/list、status 和可视化当前值核对采样几何与代次，旧采样保持在磁盘但不再显示为当前有效值。
- 调试命令只接受信封身份，显式调试 ID 不能绕过会话/工作区校验；禁止匿名访问调试状态和事件。
- 调试 ID 在启动期间独占保留，停止/退出等待后端清理，防止覆盖会话与泄漏租约。
- 断点/观察点在后端确认后更新权威状态，失败不伪造成功状态或事件。
- 图表 HTML tooltip 转义点位名称、单位和标题，保留 ECharts 自带标记。

## 0.29.29

- 采样身份按点位自己的连接和设备解析。两个会话即使复用相同的 deviceId，也各自使用自己的 unit 和端点。
- 点位几何、归属或端点变化会立即换新的采样代次。旧值留在原处，但不再当作当前值。归属不唯一时没有当前代次；恢复唯一后重新发代次。
- 仿真写入保持仿真连接，只更新被写的点。切到真实模式后，旧仿真值不能通过校验，要等新的真实采集。
- 缺章、错章或时间超前的采样不能进入校验。调用方的工作区、状态和配置响应不再带出内部采样代次表。

## 0.29.28

- Agent `points` get/list：分层运行值隔离；结果带 `valueStatus`（available|missing|unavailable）；`unavailable` 不授权改写。
- get 超预算裁剪后 `returned === points.length`；预算丢弃进 `omittedIds`，不与配置缺失的 `missingIds` 混用。
- get/list 只读：不持久化 workspace claim，不把点搬进会话私有层。
- Host 进程内 throw/reject/非法响应统一为可关联的 `HOST_DISPATCH_FAILED`（含 `commandId`）。

- 进行中的轮询只回写采集时间与成败，不再把已停止的连接重新打开，也不再覆盖采集间隔。
- 告警回差默认改为触发阈值绝对值的 1%。点位可单独设置回差；显式填 0 表示无回差。原先隐式的 1 个工程单位回差不再使用。
- 仿真写入保存失败或总线抛错时，写入任务会结束，不再挡住下一次写入。同一工作区已有写入时，后一次返回 `WRITE_BUSY`。
- 一次从站超时不再关掉同一条串口上的其他设备。Host 退出后，I/O 进程会放开 COM 口。
- 批准写入时会再核对点表与端点；对不上则原批准失效。总线忙时该请求仍留在待批准列表。
- Agent 写点待批准返回 `APPROVAL_PENDING`，并说明等待界面批准、不要重试。相同未过期写点复用原批准。
- DSH 0.1.7+ 上 `node scripts/seed-preset.mjs` 不再报错退出：Corn模式由 Host 声明注册。热重载后预设会等上一份 Host 注销完成再注册。
- 模态框支持 Tab 焦点循环；危险确认默认聚焦取消，且默认不可点遮罩关闭。
- 折线图改为只使用 ECharts。客户端不再打包 uPlot。

## 0.29.27

- 适配 DSH 0.1.7 声明式 Agent 预设：Corn模式 经 `agentPresets.register()` 注册为 `corn-bench` 声明，重新出现在预设选择器（旧版本仍走目录式 seed）。
- 预设子插件清单改为随包快照重述 0.1.7 `standard` 并追加 `dsh-corn-bench/agent` 工具行；漂移由 `scripts/gen-standard-preset-snapshot.mjs --check` 把关。
- 旧目录式预设在声明通过 roster 校验后整体改名备份到 `.corn-bench.backup.<ISO>`，不删除用户文件。旧会话 `corn-bench` 身份的 Desktop 复验待做（见 011 §7）。
- 契约钉升至 `0.1.7-alpha.2`（静态契约核对 + lab 安装；Desktop 复验待做（见 011 §7））。

## 0.29.26

- 共享发布/撤销时同层重复 deviceId 被明确拒绝并给出冲突明细，不再静默去重丢设备。
- 设备冲突提示标注实际写回层（shared / private / top 及所属会话），诊断指向不再错位。

## 0.29.25

- 操作详情「原始记录」固定展开，去掉图标和折叠箭头。
- 仿真连接在「原始数据」页也能列出并展示报文。

## 0.29.24

- 折线图在点位断连/失败后不再用墙钟空点把 X 轴往右拉；轴停在最后一条有效样本。

## 0.29.23

- 串口报文列表从上到下按时间从新到旧；自动滚动跟随顶部新报文。

## 0.29.22

- 协议报文筛选行用「过滤关键字」输入框撑满剩余宽度，重置与上方导出按钮右对齐。

## 0.29.21

- 告警详情去掉「确认表示已知悉，不代表故障恢复。」说明。

## 0.29.20

- 告警页筛选栏与列表之间不再显示确认/复制等通知条。

## 0.29.19

- 操作记录每页最多 50 条，按时间从新到旧。

## 0.29.18

- 操作详情去掉底部「添加到 Agent 输入」和说明，右上角复制改为 AI。

## 0.29.17

- 设置页去掉「页面导航」下的两行说明。

## 0.29.16

- 「重试连接」改为「重试」。
- 运行调试源码预览去掉外层滚动条，只留编辑器一条。
- 「＋连接」留在全部连接页并打开下方连接编辑框。
- 仿真轮询写入串口报文（SIM TX/RX）。

## 0.29.15

- 全部连接：连接为蓝色、断开为红色；端点列用绿灯/红灯表示状态。
- 报文详情：去掉「AI 辅助分析」和顶栏复制，改为右上角 AI；筛选栏「重置」不再被挤成竖排。

## 0.29.14

- 全部连接表操作列：连接/断开合成一个按钮；去掉已连接的禁用按钮。

## 0.29.13

- 报文详情 HEX / Text 框内文字与「复制」按钮垂直居中。

## 0.29.12

- 串口报文筛选下拉从 140px 收到 112px，与告警/操作记录工具条对齐。

## 0.29.11

- 可视化卡片三点菜单按内容收窄（不再固定 218px 宽），右对齐 ⋯ 按钮。

## 0.29.10

- 可视化卡片右上角三个按钮收成 DSH 风格三点菜单（AI / 编辑 / 删除）。数值卡去掉组件内标题和「更新于」时间。Client 体积上限 1 675 000 bytes。

## 0.29.9

- 可视化组件操作栏「让 Agent 分析」改为与上位机点位相同的紧凑 **AI** 按钮。

## 0.29.8

- 折线图数据点改为实心圆（ECharts `symbol: 'circle'`，uPlot 点填充与线同色），不再用默认空心 `emptyCircle`。

## 0.29.7

- 折线图 Y 轴上限对齐 1/2/5×10ⁿ 刻度，不再把 `峰值×1.08` 的原始浮点（如 6.6464）画成轴顶标签。Client 体积上限 1 672 000 bytes。

## 0.29.6

- 编辑组件卡片边框不再只依赖 `--dvb-bdr` 继承：`border` 带字面 fallback，挂到 `document.body` 后类型卡 / 配置卡 / 预览 / 筛选胶囊仍有线框。

## 0.29.5

- 编辑组件弹窗挂到 `document.body` 后仍继承 `--dvb-bdr`，类型卡 / 配置卡 / 预览 / 筛选胶囊线框不再消失。

## 0.29.4

- 编辑组件弹窗挂到 `document.body`，不再被会话区 `container-type` 和底部输入框（z-index 7）盖住。Keil 工程选择器同样处理。

## 0.29.3

- 折线图时间轴在窗口未填满时从第一条样本起算（从左往右长），不再把十几秒数据拉满整轴、把最新点贴在右边缘裁掉。关闭「自动滚动」会钉在起点窗口。Y 轴自动范围给峰值留出余量。

## 0.29.2

- 监控二级 tab 切走再回来时，可视化页保持挂载（`visibility` 隐藏，不用 `display:none`），折线图不再按 140px 占位高度重算 Y 轴。
- 图表等到容器有真实宽高再 `init`；ECharts 与 uPlot 都跟 ResizeObserver。GridStack 关闭 one-column 折叠。

## 0.29.1

- 监控/调试二级 tab 在渲染时再取文案，避免 Host 中文偏好落地前被浏览器临时英文冻结成 Charts / Alarms / Serial Frames / Operation Log。
- Client 体积上限随 locale tick 调至 1 667 000 bytes。

## 0.29.0

结构与测试重构收口（计划 P0–P6）：

- `src/**` 禁止导入根目录 `bench-*`（dependency-cruiser 四条 error）；门面仅保留 ≤80 行 re-export。
- 生产大文件按职责拆分；structure-budget allowlist 清空。
- 测试按领域目录重组，结构/源码断言/包闭包进 `npm run quality`。
- 补齐 ADR-019～023（debug/写点会话所有权、告警模型、verify 真实性、Windows 验收边界）；ADR-024 标 Completed。
- Client 体积上限随模块边界税上调至 1 665 000 bytes。

## 0.28.7

- 修复 `normalizeCwd` 相对路径单测：用 `path.isAbsolute`，不再假设 POSIX `/` 前缀（Windows CI 绿）。

## 0.28.6

- 删掉一批源码/CSS 字符串锁和重复 import 检查；行为测和写点/I/O/preset 保险丝保留。

## 0.28.5

- 工程结构页拆成 `use-project-session`（会话/地图/预览）和 `project-toolbar`，workspace 只拼布局。

## 0.28.4

- 合并 8 个单测 debug 文件到主题文件（批准、RPC、事件游标、探针租约）。工程结构图与运行时图共用同一套 fit/zoom 相机 hook。

## 0.28.3

- TemperatureDemo 源码/工程树/调用图/调试会话收到 `src/ui/debug/fixtures/`，工程结构和运行调试页不再内嵌同一份 demo。

## 0.28.2

- Client 第一刀：空间/圆角/描边 token，`Panel`/`Tabs`/`Hint` 原语，运行调试面板改走共用壳。UI 引用 `bench-*` 门面改为 cruiser warn（ADR-024）。

## 0.28.1

- 工程结构树形页：修复 `PROJECT_CSS` 未插值 `data-dsh-corn-bench`，左右栏卡片框丢失。右侧「示例源码 / 文件符号」补上独立卡片框；去掉树下「当前文件」卡片。树形/图谱切换去掉外围框线和工具栏底部分割线，并收紧工具栏上下间距。源码预览标题与函数/跳转收成一行，去掉复制/搜索按钮和标题栏底部分割线，并收紧标题栏与源码卡片之间的间距。去掉「示例源码」「文件符号」左侧箭头。图谱页去掉底部图例、统计和操作提示。缩放条贴在画布右下角，层级锁在图谱内，不再盖住会话输入框。函数详情：标题栏关闭按钮回到右侧，源码片段用真实行号而不再写死 ReadTemperature；调用图谱默认打开焦点函数详情。图谱画布铺满容器、绕视口中心缩放，不再在选中节点或 Resize 时把相机打回 35%。点击函数节点打开详情卡片，不再被画布拖拽吃掉。函数详情把名称、文件和行号收成一行。去掉树形源码预览底栏状态行。图谱工具栏只保留「适应画布」。运行调试页按理想稿对齐：会话条、已暂停状态、源码执行行/断点槽、两条 demo 断点、可折叠事件表。去掉运行调试页顶部会话条（目标名和 GDB/OpenOCD）。

## 0.28.0

Requires DSH `0.1.5-rc.1`. Repair release: native DSH contract, upgrade migration, no long-term framework patches.

- Preset overlay migrates `text → prefix` and the tool row to `dsh-corn-bench/agent`, validates with official `dsh-persona` Config, and copies shipped `standard` on first install.
- Settings preset health uses the same schema/tool-row contract, not YAML parse alone.
- Host stays `connection` + `webServer`. Agent is `./agent` (`dsh-corn-bench-tools`) with required `tools` + `systemPrompt`.
- Default bundle no longer inserts `standing-guard` / `scan-guard`. Those remain an optional sibling `dsh-corn-harness` with an explicit DSH version pin, not a production dependency.
- Debug page still does one state query; event wait parks for Agent-started sessions instead of 1 Hz polling.
- Debug wait/wake require owner session id and workspace cwd. Watch values survive pause/step. Host dispose waits for the same RPC unregister promise. Preset health uses official `dsh-persona` Config.

## 0.27.2

Requires DSH `0.1.5-rc.1`. Preset compatibility and standing-mount isolation.

- Migrate Corn persona `config.text` → `config.prefix` and rewrite the managed tool row to `dsh-corn-bench/agent` (no leftover `role`). Overlay validates with the official `dsh-persona` Config before write.
- First install copies the shipped `standard` preset when `agentPresets.copy` is unavailable, then overlays and validates. Failures are not swallowed as success.
- Failed standing mounts are cached by composition digest: deterministic schema errors remount once per generation; transient errors back off; explicit retry and file changes remount.
- Host RPC registration that resolves after dispose still runs the disposer. Shared debug runtime dispose is identity-checked. Agent guidance is a required `systemPrompt` effect and no longer imports the YAML migrator.
- Debug page keeps one state query, parks on `waitEvents` while idle, and wakes when Agent starts a session. Scan flush snapshots the plugin tree once per dirty batch.

## 0.27.0

Requires DSH 0.1.2-alpha.3. Install from an `npm pack` tarball.

Major stabilization, debug runtime hardening, and verification release (PR-A through PR-F):

- **Debug Runtime Authority & Event Contract (PR-A)**:
  - `DebugRuntime` is now the single authoritative state reducer for embedded debugging.
  - Replaced ad-hoc backend state mutations with strict `DebugBackendEvent` contracts (`backend.running`, `backend.stopped`, `backend.console`, `backend.exited`, `backend.error`).
  - True asynchronous pause and stepping semantics: step/pause actions await genuine native target stop events before reporting completion, eliminating fake synchronous stepping.
  - Canonical event naming shared between Host and UI via `src/shared/debug-events.mjs` (`DEBUG_EVENT_TYPES`), eliminating unverified string checks.
- **Host Launch Spec & Session Ownership (PR-B)**:
  - Host resolves immutable `ResolvedDebugLaunchSpec` based on workspace, Keil target, build artifact hash, OpenOCD profile, and probe serial. Agent parameters simplified to `{ action: "start" }`.
  - Removed insecure boolean `payload.approved = true`; debug startup enforces expirable `approvalRequestId` tickets tied to artifact sha256. Stale tickets are rejected with `APPROVAL_STALE`.
  - Target lease identity hardened to physical probe identity (`probeSerial`) rather than workspace directory.
  - Replaced fixed GDB port 3333 with dynamic loopback port allocation (`allocateLoopbackPort`).
- **Windows + STM32 Hardware Smoke Fixture (PR-C)**:
  - Added dedicated minimal STM32 test fixture in `fixtures/stm32-debug-smoke/` (`main.c`, `system_stm32.c`, `openocd.cfg`, `stm32_smoke.axf`).
  - Added formal Windows acceptance checklist template in `docs/WINDOWS_ACCEPTANCE_0.27.md`.
- **Keil UVSC Binary Protocol & Simulator Rewrite (PR-D)**:
  - Replaced legacy mock JSON protocol with genuine 16-byte fixed-header UVSC binary framing (`0x43535655`).
  - Added managed background `UV4DebugProcess` capable of dynamically spawning UV4 without user GUI interaction.
  - Implemented request-response matching and asynchronous event routing (`UV_DBG_CALLBACK`, `UV_ASYNC_MSG`, `UV_DBG_CMD_OUTPUT`).
- **ProgramModel AST & Archify Boundary Decoupling (PR-E)**:
  - Introduced Lezer/Tree-sitter C AST source analyzer (`tree-sitter-c-analyzer.mjs`) with `confidence: 'ast'`.
  - Demoted regex analyzer to heuristic analyzer (`heuristic-c-source-analyzer.mjs`) with `confidence: 'heuristic'`.
  - Decoupled graph traversal algorithms (`findUpstream`, `findDownstream`, `findCausalPath`) into `src/domain/program/graph-analysis.mjs`.
  - Added `runtime-correlation-service.mjs` to map runtime execution locations to ProgramModel function nodes, callers, callees, variable dependencies, and nearest conditions.
- **Verify Productization & Live Telemetry (PR-F)**:
  - Added `TelemetryReader` abstraction reading from live value stores rather than static workspace layout.
  - Removed 2-second hardcoded clamp on `stable-for-duration`; supports dynamic sampling and unconstrained durations bounded by scenario timeouts.
  - Added cancellation support via AbortSignal and distinguished result statuses (`pass`, `fail`, `error`, `timeout`, `cancelled`).
  - Enriched evidence binding firmware hash, artifact sha256, debug session ID, target identity, and telemetry sample series.
  - Exposed `verify` action directly in `corn_debug` agent tool and RPC handler.
  - Added architectural decision records: ADR-016, ADR-017, ADR-018.


Requires DSH 0.1.2-alpha.3. Install from an `npm pack` tarball.

Security and integration fixes (no new product features):

- Browser business operations use authenticated `connection.rpc` on `/corn-bench`; loopback Origin no longer substitutes for capability on the Agent HTTP bridge (`POST /dsh-corn-bench/command` only).
- Agent focus requests are preserved when Corn pages are not mounted; `viewRequest` is not dropped while workspace cwd is still loading.
- Project workspace state is isolated by session, cwd, Keil project, and target; stale map/file responses are rejected.
- Project graph layout, truncation hints, keyboard navigation, and `/` search shortcut guards are corrected.
- `npm run test:full` and `npm run pack:check` pass.

Windows serial / Modbus / OpenOCD device-chain acceptance remains **not** signed off. See `docs/archive/WINDOWS_ACCEPTANCE_0.26.md`.

## 0.26.0

Requires DSH 0.1.2-alpha.3. Install from an `npm pack` tarball. This is an integration migration, not a visualization schema change.

Breaking Harness integration:

- Session workspace path comes from `useWorkspaces` items by `sessionId`. `useSessions` is gone.
- Cross-tab navigation uses `openView` + `dvb1:` focus tokens and `viewRequest`. `slots.select` is gone.
- Client inject is `slots` + `locale` + `connection` (authenticated RPC).
- Plugin notices include a `randomUUID` `id` and the alpha.3 `source` contract.
- Browser Host calls no longer use a static `X-DSH-Corn-Bench` header. Loopback Origin is required; Agent HTTP uses a process-lifetime capability. Official Typert Remote is not available to this thin-JS plugin (ADR-012).
- Corn preset changes apply to **new sessions**. Open sessions keep their generation.

Windows serial / Modbus / OpenOCD device-chain acceptance is **not** signed off. See `docs/archive/WINDOWS_ACCEPTANCE_0.26.md`.

Profile risk (not Corn bugs): `dsh-excel-panel` 0.6.1 and `@omdsh-dev/dsh-genui` 0.8.4 may still fail on alpha.3. Isolation Profile + Corn tarball is the compatibility evidence.
