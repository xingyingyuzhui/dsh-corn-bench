# Corn 插件集结构与测试重构计划

状态：**P0–P6 已完成**（2026-09-15）；本文件为归档全文  
制定日期：2026-09-15  
修订日期：2026-09-15（P6 收口见 §10，含 P6-5 验证边界；现行摘要见 [`../CORN_STRUCTURE_AND_TEST_REFACTOR_PLAN.md`](../CORN_STRUCTURE_AND_TEST_REFACTOR_PLAN.md)）  
适用范围：`dsh-corn-bench` 0.29.0（最终提交 `8117dbb`）、`dsh-corn-harness` 0.2.0  
目标：完成大文件治理、统一分层、公共元素复用和测试体系瘦身，使结构要求可以由自动化门禁持续验证。

## 1. 当前基线

本计划以 2026-09-15 的实际仓库状态为基线，不把已经完成的模块化工作重复列为待办。

| 指标 | 当前值 | 说明 |
|---|---:|---|
| `dsh-corn-bench` 生产模块 | 311 个 `.mjs` | `src/` + `runtime/` |
| 生产代码规模 | 约 51,151 行 | 不含生成的 `client.js` |
| 500 行以上生产文件 | 16 个 | 最大 765 行 |
| 根目录 `bench-*.mjs` | 48 个 | 约 40 个仍有实质逻辑 |
| UI → `bench-*` 依赖 | 60 条依赖警告 | 质量门禁目前不会因此失败 |
| 孤立生产模块 | 2 个 | 仅被测试引用，未进入生产依赖图 |
| 测试文件 | 223 个 | 根目录 110 个、子目录 113 个 |
| 测试代码规模 | 约 39,606 行 | 约为生产代码的 77% |
| 500 行以上测试文件 | 11 个 | 最大 1,219 行 |
| 直接读取源码的测试文件 | 49 个 | 含必要发布契约和脆弱 UI 字符串锁 |
| Bench 自动测试 | 1,207/1,207 通过 | 无跳过 |
| Bench 覆盖率 | 行/语句 82.43%，分支 68.82%，函数 73.77% | 未启用 `c8 --all` |
| Harness 自动测试 | 25/25 通过 | 嵌套 runner；lint / typecheck / `c8 --all` / pack / `quality` 已齐 |

已完成并应保留的成果：

- `src/{domain,application,infrastructure,interfaces,ui}` 分层和依赖检查。
- Host 状态所有权、RPC 边界和独立设备 I/O 进程。
- Debug Panel/Tabs/Hint、图谱相机/SVG 原语和 TemperatureDemo fixture 的共享。
- 递归发现 `test/**/*.test.mjs` 的跨平台测试运行器。
- 构建确定性、Client 体积、类型、依赖和包内容门禁。

## 1.1 基线复核与修订（2026-09-15）

P0 实施前对 §1 的每个数字做了实测复核，结论是**基线全部准确**，但发现四处需要修订，
其中一处比原计划预想的严重得多。本节是现行计划的一部分，后续阶段按修订后的口径验收。

### 复核结论：基线数字逐项成立

| 指标 | 计划值 | 实测 | |
|---|---:|---:|---|
| 生产模块（`src/` + `runtime/`） | 311 | 311 | ✓ |
| 生产代码行数 | ~51,151 | 51,151 | ✓ |
| 根目录 `bench-*.mjs` | 48 | 48 | ✓ |
| >500 行生产文件 | 16 | 16 | ✓ |
| 测试文件（根 110 + 子 113） | 223 | 110 / 113 | ✓ |
| >500 行测试文件 | 11 | 11 | ✓ |
| 依赖告警 | 60 | 0 error / 60 warning | ✓ |
| 孤立生产模块 | 2 | 2 | ✓ |

### 修订 1（严重）：发布包缺 12 个生产模块，P0-4 的验收方向原本抓不到

原 P0-4 的验收只检查“清单里的路径是否存在”，方向是单向的。实测发现：

- `package.json#files` **缺少 12 个被已发布文件导入的模块**，造成 **55 处导入断链**。
  缺失清单：`bench-shared.mjs`、`bench-vendor.mjs`、`src/ui/components/{custom-select,
  modal-dialog,save-cancel-buttons,toggle-switch}.mjs`、`src/ui/hmi/connection-thead.mjs`、
  `src/ui/hmi/hooks/use-{conn,point}-col-widths.mjs`、
  `src/ui/monitor/visualization/components/viz-point-picker.mjs`、
  `src/ui/styles/typography.mjs`、`scripts/check-client-budget.mjs`。
- 其中 `bench-shared.mjs` 被 20 处、`bench-vendor.mjs` 被 8 处已发布的 UI 文件导入。
- 另有 5 条**从未存在过的幽灵路径**：`docs/architecture/ADR-019` ~ `ADR-023`
  （`docs/architecture/` 实际从 ADR-018 直接跳到 ADR-024），以及 1 条重复条目。
- 从 `host.js`/`tools.js` 出发的 185 个可达模块**全部在包里**，`client.js` 是自包含 bundle，
  所以 Host 侧运行时不受影响；这是“已发布源码图不可解析”的缺陷，而非线上故障。

因此 P0-4 的验收改为**导入闭包 + 双向校验**（已实施）：
清单内无重复、每个条目存在、且**发布集合对相对导入闭合**。
ADR-019 ~ ADR-023 记录为文档欠账（这五个子系统都有实现但从未写 ADR），由 P6-3 处理。

### 修订 2：P3 的迁移范围与任务清单不匹配，拆为 P3-5a / P3-5b 并新增 P3-6

实测根目录门面依赖共 **250 条 / 74 个文件**，按层分布：

| 层 | 条数 | 文件数 | P3 任务覆盖 |
|---|---:|---:|---|
| `src/ui` | 61 | 37 | P3-1 ~ P3-4 |
| `src/application` | 159 | 28 | 无 |
| `src/interfaces` | 17 | 1（`corn-rpc-router.mjs`） | 无 |
| `src/infrastructure` | 13 | 7 | 无 |

`2.1` 的完成定义只要求 `src/ui` 零依赖，而 `P3-5` 写的是禁止 `src/** → bench-*`。
两者相差 **189 条 / 36 个文件**，且 dependency-cruiser 目前只有 `src/domain`（error）和
`src/ui`（warn）两条门面规则，其余三层完全未约束。故拆为：

- **P3-5a**：`ui-no-bench-facades` 提升为 error（对应 2.1，保持现行范围）。
- **P3-5b**：新增 `application/infrastructure/interfaces-no-bench-facades` 规则并清零
  （独立阶段，需单独估工；`src/interfaces/rpc/corn-rpc-router.mjs` 617 行也在此阶段拆分）。

同时，`2.1` 要求全部根目录 `bench-*` ≤80 行，但实测 48 个门面共 **7,479 行**，25 个超限，
其中 **20 个（4,474 行）在 P3-1 ~ P3-4 中没有任何任务归属**（`bench-preset.mjs` 644 行、
`bench-io-broker.mjs` 411 行等）。故新增 **P3-6** 承接这批门面，并明确：
I/O 家族（`bench-io-*`、`bench-serial*`、`bench-modbus-transport`、`bench-slave` 等约 1,475 行）
虽在 §1“已完成成果”中声明为已完成进程拆分，但仍需按 2.1 瘦身为纯 re-export，
二者不冲突：**进程拆分已完成，门面瘦身未完成**。

### 修订 3：P1-4 的风险被高估，但 include 边界必须显式决定

实测 311 个生产模块中 **300 个已被测试静态可达**，仅 11 个从未加载、合计 **234 行**
（多为 `index.mjs`/barrel，最大 `runtime/corn-io-worker.mjs` 151 行）。
启用 `--all` 后分母从 51,462 行增至约 51,696 行（**+0.45%**），行覆盖率理论下限约 82.0%，
**不会跌破 75%**。§12 风险表中“覆盖率启用 `--all` 后骤降”一条据此降级。

真正需要决定的是 `--all` 的 include 边界，它对分母的影响（±15%）远大于 src 内部（±0.45%）：

- 必须显式排除生成的 `client.js`（1.6 MB 单行 bundle），否则覆盖率瞬间归零。
- 需明确是否纳入根目录 48 个门面（7,479 行）与 `host.js`/`tools.js`。
- `runtime/corn-io-worker.mjs` 会成为 0% 项，需补行为测试或显式豁免。

### 修订 4：两个孤立模块已判定删除

`src/ui/components/typography.mjs` 与 `src/ui/monitor/alarms/alarm-filter-model.mjs`
从任一生产入口（`host.js`、`tools.js`、`src/ui/client/client-entry.mjs`）均不可达，
唯一引用者是测试。两者都不构成公开 API（无入口、无消费者），故按“删除”处理：
CSS 侧 token 仍在 `src/ui/styles/typography.mjs`（`bench-styles` 聚合，生产可达），
告警页自带内联过滤逻辑，行为不变。对应测试断言同步移除，无回归点丢失。

### P0 实施记录

| 任务 | 产物 |
|---|---|
| P0-1 | `scripts/check-structure-budget.mjs`（三组阈值 + 行数 ratchet）、`test/architecture/structure-budget.test.mjs`（8 例） |
| P0-2 | `structure-budget.config.mjs`：16 生产 + 25 门面 + 11 测试，共 52 项，每项含 `max`/`reason`/`stage`，禁止通配 |
| P0-3 | `scripts/check-source-assertions.mjs`、`source-assertions.config.mjs`（33 项，含 18 项 `pending-refactor`）、`test/architecture/source-assertions.test.mjs`（9 例） |
| P0-4 | 清单修复（-6 幽灵/重复，+12 必需模块，共 400 条）、`scripts/check-package.mjs` 强化、`test/architecture/package-manifest.test.mjs`（5 例）、删除 2 个孤立模块 |
| 出口 | `npm run quality` 新增 `structure:check`、`assertions:check` |

`pending-refactor` 是在计划允许的五类用途之外**刻意新增的第六类**，只用于 P2-7 尚未替换的
脆弱源码/CSS 字符串锁；其条目数只允许下降，不得新增。

## 2. 目标与完成定义

### 2.1 必须满足的结构指标

- [ ] `src/ui/**` 不再导入根目录 `bench-*`；`ui-no-bench-facades` 从 warning 提升为 error。
- [ ] 依赖检查为 0 error、0 warning、0 非预期 orphan。
- [ ] 根目录 `bench-*` 只允许保留兼容入口或纯 re-export；每个不超过 80 行，不新增业务逻辑。
- [ ] 人工维护的生产文件原则上不超过 500 行，目标不超过 400 行。
- [ ] 必须超过 500 行的协议解析器或状态机进入显式 allowlist，并记录不能继续拆分的职责理由。
- [ ] 公共 UI 使用 `token → primitive → pattern → feature` 组合，不出现第三份相同 Panel、Tabs、Hint、状态标签或空状态 DOM。
- [ ] `package.json#files` 无重复、无失效路径，并由包内容测试覆盖。

### 2.2 必须满足的测试指标

- [ ] 单个测试文件不超过 500 行，目标不超过 350 行。
- [ ] 测试目录按 `architecture/commands/config/debug/domain/infrastructure/persistence/ui/verify/workspace` 组织；根目录只保留跨领域验收测试。
- [ ] 通用 workspace、session、RPC、React、临时目录和设备模拟 fixture 统一复用。
- [ ] UI 行为测试通过渲染结果、角色、状态和交互断言；不锁内部函数名、CSS 拼接顺序或大段源码文本。
- [ ] 源码读取测试只允许用于架构边界、生成物、发布包、安全禁用模式和版本契约。
- [x] `c8 --all` 纳入全部生产模块；第一阶段保持现有门槛 75/60/60/75，获取真实基线后再单独提高。
- [ ] Bench `quality` 和 Harness `quality` 均通过，且无 skipped/todo。（Harness `quality` 已于 P5-3 通过；双仓全量留 P6-1）
- [x] Harness 入口安装、重复安装、卸载恢复、异常恢复和日志关闭均有行为测试。

### 2.3 非目标

- 不拆成多个 npm 微包；继续采用模块化单体插件。
- 不在本轮改业务功能、UI 视觉和设备协议。
- 不为了降行数制造一层只转发一个函数的无意义 wrapper。
- 不删除有明确回归价值的审批、会话隔离、并发、协议黄金样本和真实 React 生命周期测试。
- 不把 Windows/真实 STM32/Keil 验收伪装成自动化通过。

## 3. 实施顺序

```mermaid
flowchart LR
  P0[基线与硬门禁] --> P1[测试基础设施]
  P1 --> P2[测试拆分与去脆弱断言]
  P2 --> P3[Client 旧门面迁移]
  P3 --> P4[生产大文件拆分]
  P4 --> P5[Harness 补齐]
  P5 --> P6[全量验证与发布收口]
```

原则：先让门禁能够识别“假拆分”和测试遗漏，再进行大规模移动；每个任务形成一个可独立回退的提交。

## 4. 阶段 P0：冻结基线并建立结构门禁

目标：把本计划中的数字变成自动检查，避免重构过程中反弹。

### [x] P0-1：建立结构预算脚本

**工作量：**30–60 分钟  
**内容：**新增脚本统计人工维护生产文件和测试文件的行数，排除 `client.js`、coverage、依赖和生成物。

**验收：**

- 输出超过 400/500 行的文件及行数。
- 超过 500 行且不在 allowlist 时退出失败。
- 测试覆盖脚本自身的路径排除、阈值和 allowlist 行为。

### [x] P0-2：定义临时大文件 allowlist

**工作量：**30 分钟  
**内容：**把当前 16 个超限文件按 UI 组合、应用服务、状态机、协议解析四类登记，写明负责人、拆分目标和移除阶段。

**验收：**

- allowlist 只包含当前已知文件，禁止通配整个目录。
- 每项包含原因和到期阶段；新增超限文件不能自动进入。

### [x] P0-3：建立源码断言审计门禁

**工作量：**45–60 分钟  
**内容：**识别测试中的 `readFile*`、源码/CSS 字符串断言，并维护小型许可清单。

**验收：**

- 新增 UI 源码字符串锁会失败。
- 构建产物、依赖边界、安全禁止模式等必要契约仍可保留。
- 报告能区分“读取 fixture”与“读取生产源码”。

### [x] P0-4：清理包清单和孤立模块基线

**工作量：**30–60 分钟  
**内容：**删除 `package.json#files` 的重复条目；确认 `typography.mjs`、`alarm-filter-model.mjs` 应接入还是删除。

**验收：**

- 包文件清单无重复、无不存在路径（单向：条目 → 磁盘）。
- **发布集合对相对导入闭合**：任一已发布文件导入的模块必须也在清单内（反向：磁盘 → 条目）。
  这条是本任务的核心，单项存在性检查抓不到 §1.1 修订 1 的 12 个缺失模块。
- 依赖图中不再出现“只被测试引用”的生产模块；若是公开 API，必须有明确入口。

**阶段出口：**结构预算、源码断言和包清单检查进入 `npm run quality`，现有功能测试保持全绿。

## 5. 阶段 P1：统一测试基础设施

目标：先抽复用 fixture，再拆巨型测试，避免把 setup 复制到更多文件。

### [x] P1-1：抽取 workspace/session 测试工厂

**工作量：**45–60 分钟  
**内容：**统一临时 home、cwd、workspace、connection、device、point、session 和清理逻辑。

**验收：**

- 工厂可创建单会话、双会话、多连接和配置漂移场景。
- 临时文件统一由 test cleanup 回收。
- 至少迁移 `tool-preset`、`write`、`hmi-connection-state` 中的重复 setup。

**实施记录（2026-09-15）：**

新增 `test/helpers/workspace-factory.mjs`（工厂）与 `test/architecture/workspace-factory.test.mjs`（13 项自测）。
放在 `test/helpers/` 是有意的：该目录既不匹配 `*.test.mjs`（不被 `run-tests.mjs` 当测试）、
不进结构预算、不进源码断言审计、也不在 `package.json#files` 里，基础设施就该待在这种位置。

导出：`createBench` / `createTempDir` / `trackPath` / `connection` / `pointSeries`。
句柄提供 `home`、`cwd`、`at`、`save`、`load`、`modbus`、`session`、`drift`、`write`、`read`、
`mkdir`、`exists`、`cleanup`。

**清理语义是本次最实质的修复。** 抽取前 `test/` 下有 **224 处** `mkdtemp(join(tmpdir(), ...))`，
散布在 **68 个测试文件**里。重复本身还不是最糟的：`hmi-connection-state` 一类文件把
`await rm(home, ...)` 写在测试体末尾而非 `finally`，**断言一失败临时目录就留在 /tmp**。
工厂把生命周期挂到 `t.after()`，因此失败路径也会回收；无测试上下文时退化为 `process.on('exit')` 兜底。

**迁移结果（4 个文件、50 个测试块）：**

| 文件 | 迁移块 | 测试数 | 断言行数 | 行数变化 |
| --- | --- | --- | --- | --- |
| `write.test.mjs` | 11 | 17 → 17 | 94 → 94 | 559 → 501 |
| `tool-preset.test.mjs` | 28 | 32 → 32 | 200 → 200 | 1220 → 1097 |
| `write-approval-session.test.mjs` | 11 | 11 → 11 | 73 → 73 | 322 → 274 |
| `hmi-connection-state.test.mjs` | 3 | 20 → 20 | 100 → 100 | 825 → 805 |

`write-approval-session` 是计划外但顺手的第 4 个消费者：它的 `setupBoard(prefix)` 正是
「双会话预分区」场景，改为 `setupBoard(t, prefix)` 后直接复用工厂的 `sessions` 选项。

**迁移中被发现的三个真实语义，都已固化进工厂测试：**

1. **store 会为任何 `modbus` patch 补齐默认连接与设备。** 即使只写 `modbus: {}`，
   磁盘上也会出现 1 条连接 + 1 台设备。所以测试里不存在「空工作区」，断言
   `devices.length === 0` 是错的。
2. **`ensurePresetOverlay` 的备份目录是 `dir` 的兄弟而非子目录**
   （`bench-preset.mjs:226`：`join(dirname(dir), '.dsh-corn-bench.backup.<ts>')`）。
   因此 `rm(dir, { recursive: true })` **不会**清掉它，12 个 preset 测试原本靠
   `if (bak) await rm(bak, ...)` 手动兜底。这些路径改为 `trackPath(t, bak)`，
   与临时树走同一个回收注册表，顺带获得失败路径安全。
3. **`test/tool-preset.test.mjs` 的 4 个测试在体内重复动态 `import` 了 node 内置模块**
   （`node:fs/promises`、`node:fs`、`node:os`、`node:path`），而文件顶部早就 import 了同样的名字。
   迁移时删除这些遮蔽行，`join` 回落到顶层导入。

**ratchet 自动生效：** `write.test.mjs` 从 559 行降到 **500 行**，正好不再超过 500 的 error 阈值，
结构预算门禁随即报 `is back under the 500-line limit (500); remove it from the allowlist`。
按 ratchet 规则（c）从 `structure-budget.config.mjs` 的 test 组删掉该条目，允许清单 11 → 10。
这正是设计意图：豁免必须自清理，不能沉淀成永久白名单。

**验收证据：** 4 个迁移文件 + 工厂自测共 93 项全绿；断言行数逐文件比对无变化（无断言被删）。
结构预算、源码断言、lint、typecheck、deps、pack 六道门禁全过；全量套件 1240 项全绿（0 失败 0 跳过），
覆盖率 statements/lines 82.57%、branches 69.14%、functions 73.64%（较基线 -0.01pp，来自新增的工厂文件本身）。

**遗留：** `test/` 下仍有 **64 个文件、182 处** 手写 `mkdtemp`，留待 P2 拆分时顺手迁移
（本次消除 42 处）。`trackPath` 目前只有 preset 测试使用，P1-2/P1-3 若出现同类
「生产代码写到临时树之外」的场景应复用。

### [x] P1-2：抽取 Host/RPC/审批测试工厂

**工作量：**45–60 分钟  
**内容：**统一 mock Host、RPC envelope、session identity、approval ticket 和错误响应构造。

**验收：**

- 行为测试不再各自手写 Host 注册和 envelope。
- 支持成功、结构化失败、transport failure、取消和跨会话调用。

**实施记录（2026-09-15）：**

新增 `test/helpers/rpc-factory.mjs` 与 `test/architecture/rpc-factory.test.mjs`。
三层契约收口：外层 envelope（`rpcOk`/`rpcFail`）、内层业务结果（`businessOk`/`businessFail`，审批工单经 `extra` 携带 `needsConfirm`/`request`）、
宿主/浏览器 mock（`mockRpcHost`/`createHostContext`/`mockConnection`/`createPost`/`createRouter`）。

自测对照 `host.js` 真实 envelope，防止 mock 形状静默漂移。五种场景（成功 / 结构化失败 /
transport failure / 取消 / 跨会话 `dispatchAs`）写在工厂头注释并有对应用例。

**迁移消费者（12+）：**`corn-connection-rpc`、`host-contract`、`rpc-cancel`、`write-approval-session`、
`config-scope-wiring`、`points-flags-api`、`hmi-sim-connection`、`debug-rpc-handler`、
`verify-rpc-routing`、`verify-host-singleton`、`workspace-session-isolation`、
`generated-client-effects`、`client-apply`（补上遗漏的 `mockConnection` 导入）。

### [x] P1-3：抽取 React 页面测试运行时

**工作量：**45–60 分钟  
**内容：**统一 happy-dom、真实 React、vendor runtime、render/cleanup、定时器和错误收集。

**验收：**

- `real-effects`、HMI 和 visualization 测试共享同一初始化入口。
- 每个测试自动清理 DOM、listener、timer 和全局 vendor。
- 不使用 `process.exit()` 或吞掉卸载后的异步错误。

**实施记录（2026-09-15）：**

新增 `test/helpers/react-runtime.mjs` 与 `test/architecture/react-runtime.test.mjs`。

- **profile `page`：**HMI / visualization 用的 happy-dom + noop ResizeObserver。
- **profile `virtualized`：**真实 `DvbVendor`（uPlot / virtual-core / react-virtual / table-core）+
  稳定测量矩形 + 意外 `console.warn` 失败。
- **生命周期：**`useReactPageRuntime` → `beforeEach`/`afterEach`；每次 `cleanup()`，
  vendor 与 warn 包装在 restore 时还原；不删除 `globalThis.window`（迟到 rAF/uPlot 回调）。
- **`pageWindow` 活绑定：**页面测试继续用 `import { pageWindow as win }` 派发 MouseEvent。

**迁移：**`real-effects`（virtualized）、`hmi-point-table-ux`、`hmi-point-flags-race`、
`visualization-view`（page）。行数随 setup 抽取下降（仍 >500，留待 P2 拆分）。

### [x] P1-4：启用全模块覆盖率

**工作量：**30–60 分钟  
**内容：**配置 `c8 --all` 和明确 include/exclude；保存启用后的真实覆盖率基线。

**已实测的前提（§1.1 修订 3）：**311 个生产模块中 300 个已被测试静态可达，仅 11 个从未加载、
合计 234 行，分母只增 0.45%，**不会跌破现有门槛**。因此本任务风险很低，可单个提交完成。

**必须先决定的 include 边界**（对分母的影响远大于 src 内部）：

- 排除生成的 `client.js`（1.6 MB 单行 bundle），否则覆盖率瞬间归零。
- 明确是否纳入根目录 48 个门面（7,479 行）与 `host.js`/`tools.js`，并在配置中写明理由。
- `runtime/corn-io-worker.mjs`（151 行，唯一未被加载的生产模块）需补行为测试或显式豁免。

**验收：**

- 所有发布中的 `.mjs/.js` 都出现在覆盖率报告，生成物和测试辅助文件除外。
- 继续通过 75% statements/lines、60% branches/functions 的最低门槛。
- 未加载模块显示 0%，不能从分母消失。
- include/exclude 清单在配置中有明确注释，不含 `client.js`。

#### P1-4 实施记录（2026-09-15）

**配置：**`dsh-corn-bench/.c8rc.json` + `test:coverage` 增加 `--all`；门槛保持 75/60/60/75。

**include / exclude 决策：**

| 规则 | 路径 | 理由 |
|---|---|---|
| include | `src/**`, `runtime/**`, `host.js`, `tools.js`, `bench-*.mjs` | 已发布生产代码；门面在 P3 前仍有实质逻辑，验收要求报告含已发布 `.mjs/.js`（生成物除外） |
| include | `runtime/corn-io-worker.mjs`（不排除） | 未加载模块必须以 0% 进入分母，不能消失 |
| exclude | `client.js` | 生成的 1.6MB 单行 bundle，纳入会使覆盖率归零 |
| exclude | `test/**`, `node_modules/**`, `coverage/**`, `scripts/**` | 测试 / 依赖 / 报告 / 开发门禁 |
| extension | `.js`, `.mjs` only | 排除 `.d.ts` 等非 JS 发布资产 |

**启用 `--all` 后真实基线（`npm run test:coverage`，门槛检查通过）：**

| 维度 | 百分比 | 计数 |
|---|---:|---|
| Statements | **82.54%** | 48556 / 58826 |
| Branches | **68.82%** | 10598 / 15399 |
| Functions | **73.97%** | 1728 / 2336 |
| Lines | **82.54%** | 48556 / 58826 |

对比启用前（无 `--all`）行/语句约 82.43%、分支 68.82%、函数 73.77%：纳入门面与未加载模块后分母升至 58,826，总体仍高于门槛。

**`--all` 下仍为 0% 的生产文件（10）：**

- `runtime/io/contract.mjs`
- `src/application/modbus/modbus-context.mjs`
- `src/application/modbus/result-mapper.mjs`
- `src/application/modbus/target-service.mjs`
- `src/domain/index.mjs`
- `src/domain/modbus/index.mjs`
- `src/domain/modbus/model.mjs`
- `src/infrastructure/debug/keil/uvsc-client.mjs`
- `src/infrastructure/modbus/io-broker-adapter.mjs`
- `src/ui/client/client-entry.mjs`

`runtime/corn-io-worker.mjs` 出现在报告中且约 **68%**（非 0%），说明测试运行中有加载路径触达该模块。

**附带：**`test/architecture/test-runner.test.mjs` 锁定 `--all` 与 `.c8rc.json` include/exclude/extension。

**阶段出口：**共享 fixture 被至少三个测试域使用，全模块覆盖率生效，测试数量和行为不缩水。

## 6. 阶段 P2：测试拆分、归档与去脆弱断言

目标：把测试从“历史任务日记”改造成按领域定位的行为规范。

### [x] P2-1：拆分 `tool-preset.test.mjs`

**工作量：**2–3 个 30–60 分钟任务  
**目标文件：**`preset/overlay`、`preset/transaction`、`agent/tool-schema`、`visualization/agent-actions`。

**验收：**

- 原 1,219 行文件删除。
- 每个新文件聚焦一个职责且不超过 350 行。
- 备份、回滚、所有权、Schema 和 visualization 行为全部保留。

**实施记录（2026-09-15）：**

删除 `test/tool-preset.test.mjs`（1096 行 / 32 例），拆为：

| 文件 | 行数 | 例数 | 职责 |
|---|---:|---:|---|
| `test/preset/overlay.test.mjs` | 326 | 12 | 迁移、健康检查、所有权 fail-closed、幂等 |
| `test/preset/transaction.test.mjs` | 268 | 10 | 备份/写失败/回滚/用户 persona 保全 |
| `test/agent/tool-schema.test.mjs` | 173 | 7 | Agent 入口、工具 Schema、status/read |
| `test/visualization/agent-actions.test.mjs` | 189 | 3 | visualization add/get/update 校验 |

共享 `test/helpers/preset-fixtures.mjs`：`withFsPatched` 在进程级互斥下打补丁（拆文件后并行跑不再踩 `node:fs`），
另有 `seedOwnedLegacy` / `trackBackup` / legacy persona 常量。

源码断言许可从 `tool-preset` 迁到 `agent/tool-schema`；结构预算去掉该超限条目（allowlist 11→9）。
32 例行为点全部保留，连续 3 次并行跑全绿。

### [x] P2-2：拆分 `real-effects.test.mjs`

**工作量：**2 个 30–60 分钟任务  
**目标文件：**`ui/frames-real-effects`、`ui/visualization-real-effects`。

**验收：**

- 真实 React 生命周期和卸载清理继续执行。
- Frames 与 Visualization 不共享业务断言，只共享运行时 fixture。
- 每个文件不超过 500 行。

**实施记录（2026-09-15）：**

删除 `test/real-effects.test.mjs`（1081 行 / 14 例）。因 Frames 单域断言体量仍超 500，按职责再拆出 feed 兄弟文件：

| 文件 | 行数 | 例数 |
|---|---:|---:|
| `test/ui/frames-real-effects.test.mjs` | ~380 | 7 |
| `test/ui/frames-feed-real-effects.test.mjs` | ~385 | 4 |
| `test/ui/visualization-real-effects.test.mjs` | ~223 | 3 |

共享 `test/helpers/real-effects-fixtures.mjs`（`makeFrames` / `makePost` / `framesT`）+ 已有 `react-runtime` virtualized profile。
结构预算去掉 `real-effects` 豁免（allowlist 9→8）。14 例全绿。

### [x] P2-3：拆分 HMI 巨型测试

**工作量：**4–6 个 30–60 分钟任务  
**范围：**`hmi-point-table-ux`、`hmi-connection-state`、`hmi-point-flags-race`。

**目标分组：**connection lifecycle、connection presentation、point editing、inline write、flags concurrency、column resize。

**验收：**

- 原巨型文件删除或缩减为跨功能验收文件。
- 用户行为通过渲染、事件和 RPC payload 验证。
- 不再通过内部 className 拼接顺序证明功能正确。

**实施记录（2026-09-15）：**

删除根目录三份巨型 HMI 测试，拆为 `test/hmi/` 10 个文件（全部 ≤350 行），合计 43 例全绿。共享 `test/helpers/hmi-page-fixtures.mjs`。结构预算 allowlist 收敛到仅剩 P2-5 三项。

| 文件 | 行数 | 职责 |
|---|---:|---|
| `connection-lifecycle` / `connection-actions` / `connection-form` / `connection-presentation` | 70–322 | 连接生命周期、动作、表单、展示 |
| `point-editing` / `inline-write` | 240 / 170 | 点位编辑与行内写 |
| `flags-toggle` / `flags-persist` / `flags-race` | 270 / 231 / 137 | 标志切换、持久化、竞态 |
| `column-resize` | 113 | 列宽 |

### [x] P2-4：拆分 Flash/Write/Device 测试

**工作量：**3–5 个 30–60 分钟任务  
**范围：**`flash-openocd`、`write`、`devices`、`multi-conn`。

**验收：**

- 协议参数、审批、连接生命周期和 UI 展示分开。
- 危险操作继续全部使用 fake backend/transport，不触碰真实设备。
- 每个测试文件不超过 500 行。

**实施记录（2026-09-15）：**

- Flash：删除 `test/flash-openocd.test.mjs` → `test/flash/approval.test.mjs`（140 / 审批）+ `test/flash/runner.test.mjs`（407 / 运行器）；共享 `test/helpers/flash-fixtures.mjs`（`flashTest` / `withFlashLock` 防全局审批 store 竞态）。21 例全绿。
- Devices：删除 `test/devices.test.mjs` → `test/devices/model.test.mjs` + `test/devices/validation.test.mjs`。11 例全绿。
- `write.test.mjs`（500）与 `multi-conn.test.mjs`（493）已 ≤500，保留根文件；不强制再拆。

### [x] P2-5：整理项目、图谱和可视化测试

**工作量：**3–4 个 30–60 分钟任务  
**范围：**`project-tree`、`ui/project-workspace`、`visualization-view`、`visualization-model`。

**验收：**

- model、hook race、render、interaction 分层测试。
- Demo fixture 只保留一份。
- 图谱相机和 SVG 路由使用参数化单测，不在页面测试重复数学断言。

**实施记录（2026-09-15）：**

测试 allowlist 清零（3→0）；>500 行测试文件归零。`visualization-model.test.mjs`（368）已 ≤500，保留未再拆。

| 原文件 | 拆分结果 |
|---|---|
| `project-tree`（541 / 15） | `project/tree-model`、`tree-render`、`tree-navigation` + `helpers/project-tree-fixtures` |
| `ui/project-workspace`（745 / 19） | `ui/project-workspace-gate`、`isolation`、`graph` + `helpers/project-workspace-fixtures` |
| `visualization-view`（568 / 12） | `visualization/view-crud`、`view-charts`、`view-canvas` + `helpers/visualization-view-fixtures` |

46 例全绿；React 运行时统一 `useReactPageRuntime`。

### [x] P2-6：迁移根目录测试

**工作量：**3–5 个 30–60 分钟任务  
**内容：**把可归属单一领域的 110 个根目录测试移动到相应子目录。

**验收：**

- 根目录只保留真正跨领域的 release、mount-smoke、real-effects 等验收测试。
- 测试运行器在 macOS、Linux、Windows 路径格式下都能发现全部测试。
- 移动前后测试清单可核对，无静默漏跑。

**实施记录（2026-09-15）：**

从约 101 个根目录 `*.test.mjs` 迁走 83 个到领域子目录（`agent/`、`architecture/`、`commands/`、`config/`、`domain/`、`flash/`、`hmi/`、`infrastructure/`、`keil/`、`preset/`、`project/`、`ui/`、`visualization/`、`workspace/` 等），并重写相对导入与 `import.meta.url` 根路径。

根目录保留 18 个跨领域契约/发布验收测试：

`alpha3-contract`、`alpha3-remote-spike`、`client-apply`、`client-budget`、`client-bundle`、`dependency-boundaries`、`error-codes`、`generated-client-effects`、`host-contract`、`m3`、`mount-smoke`、`package-contents`、`paths`、`release`、`selfcheck`、`type-contract`、`ui-contract`、`virtual-compat`。

特例：原根 `connection-lifecycle`（IO connection-manager）迁为 `infrastructure/connection-manager-lifecycle`，避免与 `hmi/connection-lifecycle` 撞名。

`source-assertions.config.mjs` 路径同步；全量 `test:unit` 1257/1257；`structure` / `assertions` / `quality` 通过。

### [x] P2-7：替换脆弱源码/CSS 字符串锁

**工作量：**4–8 个 30–60 分钟任务  
**内容：**按审计结果逐批替换 UI 源码断言。

**验收：**

- DOM 使用 role/text/state/interaction 断言。
- CSS 只验证关键可访问状态或独立 token，不验证整段字符串。
- 保留的源码契约均写明为什么无法用行为测试替代。

**实施记录（2026-09-15）：**

`pending-refactor` **清零**（总 allowlist 33→22）。末批：

- 删除 `hmi/table-structure`（表头/总览/无站号吸收进 presentation + form）
- `point-editing` 去掉源码锁，表头禁列改 DOM 文本断言
- `device-flow` 只留 RPC/存储行为
- `evidence-contract` 删除 UI 源码扫描（保留 helper/host POST）
- `ui-contract` 只留 Task10 共享值存储两条行为测试

结构/架构类源码读改为 `architecture-boundary` / `release-package` 等明确目的。

**阶段出口：**测试文件全部低于 500 行；根目录测试显著收敛；源码字符串测试仅剩许可项；既有行为点没有无说明删除。

## 7. 阶段 P3：退役 Client 的 `bench-*` 双轨结构

目标：让 `src/ui` 只依赖 `src/`，根目录只承担兼容入口职责。

### [x] P3-1：迁移 `bench-shared` 消费者

**工作量：**3–5 个 30–60 分钟任务  
**内容：**把 UI 对格式化、状态订阅、frame cache、focus、session 和 modal 的导入改为直接 `src/` 模块。

**验收：**

- `src/ui/** → bench-shared.mjs` 为零。
- `bench-shared.mjs` 只保留兼容 re-export，不超过 80 行。
- 未形成新的聚合“万能 common”模块。

### [x] P3-2：迁移 settings/i18n/styles 消费者

**工作量：**3–5 个 30–60 分钟任务  
**内容：**把设置状态、导航偏好、i18n 和样式 token 放入明确的 UI 层模块。

**验收：**

- `debug-view`、workspace 和 HMI 不再导入 `bench-settings`。
- i18n 数据和设置行为分离。
- 样式入口保持单次注册，无重复注入。

### [x] P3-3：迁移 points/devices/alarm/visualization 消费者

**工作量：**5–8 个 30–60 分钟任务  
**内容：**将仍位于根目录的领域逻辑放入 domain/application，UI 只消费 view model 或明确的纯函数。

**验收：**

- UI 不从 `bench-points`、`bench-devices`、`bench-alarm`、`bench-visualization-model` 获取业务逻辑。
- Domain 不依赖 UI、Host 或兼容门面。
- 根目录旧模块只 re-export 新实现。

### [x] P3-4：迁移 vendor 和 Client 入口

**工作量：**2–3 个 30–60 分钟任务  
**内容：**将 vendor runtime 和 Client composition 的主实现放入 `src/ui/vendor`、`src/ui/client`。

**验收：**

- `src/ui/vendor/**` 不再反向导入 `bench-vendor`。
- `src/ui/client/client-entry.mjs` 不再 re-export `bench-runtime.apply`。
- `bench-runtime`、`bench-vendor` 仅作兼容入口。
- `client.js` 构建结果保持确定性和体积预算。

### [x] P3-5a：将 UI 门面规则提升为 error

**工作量：**30 分钟  
**内容：**清零 `src/ui → bench-*` 的 60 条警告后将 `ui-no-bench-facades` 提升为 error。

**验收：**

- `npm run deps:check` 的 `ui-no-bench-facades` 为 0 条。
- 新 UI 代码重新导入兼容门面会立即失败。

### [x] P3-5b：迁移 application/infrastructure/interfaces 三层的门面依赖

**工作量：**8–12 个 30–60 分钟任务（§1.1 修订 2 新增，原 P3-5 未覆盖）  
**范围：**189 条导入 / 36 个文件。`src/application` 159 条 / 28 文件、
`src/interfaces` 17 条 / 1 文件、`src/infrastructure` 13 条 / 7 文件。  
**内容：**新增 `application-no-bench-facades`、`infrastructure-no-bench-facades`、
`interfaces-no-bench-facades` 三条规则并逐层清零；`src/interfaces/rpc/corn-rpc-router.mjs`
（617 行、导入 20+ 门面）在此阶段一并拆分。

**验收：**

- 三条新规则进入 dependency-cruiser 且为 error。
- `npm run deps:check` 为 0 warning。
- 拆分层不引入新的门面聚合模块。

### [x] P3-6：迁移尚未分配任务的门面

**工作量：**8–12 个 30–60 分钟任务（§1.1 修订 2 新增）  
**范围：**20 个门面 / 4,474 行，占根目录门面总量（7,479 行）的 60%。
含 `bench-preset.mjs` 644、`bench-io-broker.mjs` 411、`bench-tool.mjs` 296、
`bench-flash.mjs` 293、`bench-slave.mjs` 274、`bench-trend.mjs` 267、
`bench-io-contract.mjs` 238、`bench-modbus-transport.mjs` 237、`bench-fs.mjs` 221、
`bench-journal.mjs` 215、`bench-polling-service.mjs` 203、`bench-check.mjs` 166、
`bench-serial-monitor.mjs` 164、`bench-targets.mjs` 156、`bench-serial.mjs` 145、
`bench-run.mjs` 139、`bench-notify.mjs` 112、`bench-frames-model.mjs` 103、
`bench-modbus-commit.mjs` 101、`bench-trend-store.mjs` 89。

**内容：**把实现搬入 `src/{domain,application,infrastructure}` 对应层，根目录只留 re-export。
`bench-preset.mjs` 被 `src/interfaces/rpc/corn-rpc-router.mjs` 生产依赖，与 P3-5b 同批处理。

**验收：**

- 每个门面 ≤80 行且只含 re-export。
- `structure-budget.config.mjs` 的 `facade` 组 allowlist 清空。
- 设备 I/O 进程拆分成果不回退（进程边界保留，只瘦身门面）。

### 阶段出口（修订后）

Client 单一架构生效；`src/ui` 与 `src/{application,infrastructure,interfaces}` 均为零门面依赖；
所有根目录 `bench-*` 都是 ≤80 行的可识别兼容层或被删除。

## 8. 阶段 P4：按职责拆分生产大文件

目标：降低每个模块的变更半径，而不是机械降行数。

### [x] P4-1：拆分 `debug-view.mjs`

**工作量：**3–5 个 30–60 分钟任务  
**建议边界：**page composition、build/flash action hook、settings/bindings model、dialog state、result presentation。

**验收：**

- 主页面只负责组合，目标不超过 250 行。
- Build、Flash、Settings 的异步状态互不共享可变对象。
- 现有审批、构建错误、Keil picker 和取消路径测试全部通过。

### [x] P4-2：拆分 `frames-page.mjs` 和 Visualization 页面

**工作量：**4–6 个 30–60 分钟任务  
**建议边界：**query/state hook、table model、selection、toolbar、detail drawer、empty/error state。

**验收：**

- 页面文件只做组合。
- Frames 的分页、暂停、连接切换和清空显示行为不变。
- Visualization editor、layout、chart runtime 和 component model 不循环依赖。

### [x] P4-3：拆分 Debug Runtime 与事件订阅

**工作量：**4–6 个 30–60 分钟任务  
**范围：**`debug-runtime.mjs`、`use-debug-events.mjs`。

**建议边界：**session registry、lease ownership、backend lifecycle、event projection、wait/reconnect、persistence bridge。

**验收：**

- Runtime 仍是单一状态权威。
- startup race、墓碑、shutdown、会话隔离、lease release 和 long-poll abort 测试保持通过。
- 单个模块不同时负责存储、状态转换、订阅和 UI 投影。

**实施记录（2026-09-15）：**

| 原文件 | 行数 | 拆分结果 |
|---|---:|---|
| `debug-runtime.mjs` | 649 | facade 137 + `debug-session-registry` 241 + `debug-runtime-lifecycle` 296 |
| `use-debug-events.mjs` | 563 | hook 187 + `debug-event-projection` 64 + `use-debug-event-subscription` 155 + `use-debug-runtime-actions` 309 |
| `runtime-program-graph.mjs` | 503 | React 319 + `runtime-program-graph-model` 190 |

结构预算 production allowlist 13→10（移除上述三条目）。持久化仍由既有 `debug-event-sink` 承担。

### [x] P4-4：拆分 GDB/Keil backend

**工作量：**4–7 个 30–60 分钟任务  
**范围：**`gdb-backend.mjs`、`keil-sim-backend.mjs`、`uvsock-client.mjs`。

**建议边界：**command adapter、lifecycle、event translation、snapshot/inspect、break/watchpoint、wire client。

**验收：**

- MI/UVSOCK 协议层不知道产品 session、UI 或 workspace。
- Backend 只通过 canonical backend events 与 Runtime 通信。
- 黄金报文、错误降级、退出去重和命令注入防护保持通过。

**实施记录（2026-09-15）：**

| 原文件 | 行数 | 拆分结果 |
|---|---:|---|
| `gdb-backend.mjs` | 663 | facade 260 + session 163 + events 162 + commands 116 + inspect 93 + breakpoints 81 |
| `keil-sim-backend.mjs` | 632 | facade 294 + commands 154 + inspect 124 + session 108 + events 97 + breakpoints 55 |

`uvsock-client.mjs` 已 ≤500（486），无需再拆。结构预算 production allowlist 10→8（移除上述两条目）。公开导出 `GdbBackend` / `createGdbBackend` / `KeilSimBackend` 路径不变。

### [x] P4-5：拆分 Verify 和 Modbus 服务

**工作量：**4–7 个 30–60 分钟任务  
**范围：**`verify-service.mjs`、`modbus-migration.mjs`、`write-service.mjs`。

**建议边界：**scenario execution、sampling loop、assertion evaluation、result aggregation；schema migration steps；write validation/approval/transport/result mapping。

**验收：**

- Verify 的 hard timeout、空遥测、活动告警和异常结果不出现假通过。
- Migration 每个 schema step 可独立、幂等测试。
- Write 的审批、配置漂移、结果未知和 readback 行为保持不变。

**实施记录（2026-09-15）：**

| 原文件 | 行数 | 拆分结果 |
|---|---:|---|
| `verify-service.mjs` | 659 | facade 299 + `verify-assertion-eval` 173 + `verify-sampling` 110 + `verify-timeout` 53 |
| `modbus-migration.mjs` | 604 | facade 246 + `modbus-migrate-steps` 200 + `modbus-compat-accessors` 108 |
| `write-service.mjs` | 519 | facade 230 + `write-execute` 333 |
| `preset.mjs`（顺手） | 645 | facade 260 + `preset-overlay` 360 + `preset-transaction` 112 |

结构预算 production allowlist 移除本任务四条目（`verify-service` / `modbus-migration` / `write-service` / `preset`）；并行完成后 production allowlist 已为空。公开 API 路径不变：`createVerifyService`、`normalizeModbus`/`migrateLegacy`/`migrateV2ToV3`/`patchConn`、`modbusWrite`/`resolvePendingWrite`、`ensurePresetOverlay`/`seedCornBenchPreset`。`package.json` files[] 增补新模块。

### [x] P4-6：处理复杂解析器例外

**工作量：**2–4 个 30–60 分钟任务  
**范围：**heuristic/lezer C analyzer 等仍超限模块。

**验收：**

- tokenization、AST traversal、symbol extraction、graph assembly 可拆则拆。
- 若拆分会破坏协议/状态机完整性，ADR 记录例外和测试依据。
- 最终 allowlist 只剩有明确技术理由的模块。

**实施记录（2026-09-15）：**

| 原文件 | 行数 | 结果 |
|---|---:|---|
| `heuristic-c-source-analyzer.mjs` | 635 | **拆分**：facade 89 + `c-source-keywords` 58 + `heuristic-c-sanitize` 97 + `heuristic-c-extract-symbols` 195 + `heuristic-c-extract-edges` 213 + `program-reference-resolve` 85 |
| `lezer-c-analyzer.mjs` | 603 | **拆分**：facade 180 + `lezer-c-location` 32 + `lezer-c-extract-vars` 69 + `lezer-c-extract-function` 118 + `lezer-c-walk-body` 267 |
| `device-card.mjs` | 511 | **拆分（次要）**：panel 101 + `device-card-item` 421 |
| `corn-rpc-router.mjs` | 611 | **拆分（次要）**：dispatcher 452 + `corn-rpc-workspace` 181（endpoint 契约不变） |

无“不可拆”例外：tokenizer / symbol / body-edge / resolve 与 Lezer location / vars / function / walk-body 边界均可独立测试，不破坏解析状态机。

结构预算 production allowlist 8→0（移除 P4-6 四条目；并行工作使 verify/migration/write/preset 也已 ≤500，按 ratchet 清零）。无未解释 >500 生产文件。公开导出路径不变：`analyzeCSourceHeuristic` / `sanitizeCSource` / `C_KEYWORDS` / `resolveModelReferences` / `analyzeCSourceWithLezer` / `renderDeviceCards` / `createCornRpcRouter`。

**阶段出口：**无未解释的 500 行以上生产文件；所有大文件拆分都有行为测试和依赖边界支撑。

## 9. 阶段 P5：补齐 `dsh-corn-harness`

目标：让小插件不仅“文件小”，而且入口生命周期可证明正确。

### [x] P5-1：测试 standing guard 入口生命周期

**工作量：**45–60 分钟  
**验收：**

- 缺少 `agentPresets.ensureStanding` 时给出明确错误。
- 重复 apply 不产生双重包装。
- dispose 恢复原方法并关闭日志。
- retry 只作用于当前包装，卸载后不残留全局方法。

**实施记录（2026-09-15）：**

`test/standing/entry.test.mjs`（4 例）：缺 `ensureStanding` 抛
`requires agentPresets.ensureStanding`；三次 apply 共用同一 wrap；dispose 清
`retryStanding`、去掉 `__dshCornStandingGuard`、写盘日志后可继续走原方法；
卸载后再 apply 是全新 wrap。共享 `test/helpers/guard-context.mjs` 捕获 `ctx.effect`。

### [x] P5-2：测试 scan guard 入口生命周期

**工作量：**45–60 分钟  
**验收：**

- batch dirty name 只扫描一次 loader tree。
- apply/dispose 后监听器和原方法正确恢复。
- 单个插件处理失败不会破坏其他 dirty name。

**实施记录（2026-09-15）：**

`test/scan/entry.test.mjs`（5 例）：三 dirty flush 只 walk loader 一次；dispose 后
恢复为每名一次 walk；`disabled` 插件失败经 `onError` 隔离，其余名仍处理；
`flushDirtyNames` 隔离另测于 `test/scan/batch.test.mjs`。

### [x] P5-3：增加 Harness 质量门禁

**工作量：**45–60 分钟  
**内容：**加入 lint、typecheck/JSDoc check、`c8 --all` coverage、pack check 和统一 `quality`。

**验收：**

- `npm run quality` 一条命令完成全部检查。
- 发布文件与 `package.json#files` 一致。
- CI 与本地使用同一命令。

**实施记录（2026-09-15）：**

`quality` = lint（biome）+ typecheck（`tsc -p tsconfig.check.json`，`checkJs`）+
`c8 --all`（门槛 75/60/60/75，覆盖 standing/scan/lib）+ `pack:check`（重复/幽灵/
导入闭包）。`.github/workflows/quality.yml` 跑同一 `npm run quality`。
实测 coverage：statements/lines 93.68%、branches 73.03%、functions 94.28%。

### [x] P5-4：统一 Harness 测试组织

**工作量：**30–60 分钟  
**验收：**

- 测试运行器支持嵌套目录，不依赖 shell glob。
- cache、log、scan、standing entry 分文件组织。
- 每个测试文件低于 350 行。

**实施记录（2026-09-15）：**

`scripts/run-tests.mjs` 递归收集 `test/**/*.test.mjs`（跳过 helpers/fixtures）。
删除根 `standing-failure-cache.test.mjs`，拆为：

| 文件 | 职责 |
|---|---|
| `test/standing/failure-cache.test.mjs` | generation 缓存 / backoff |
| `test/standing/entry.test.mjs` | standing apply/dispose |
| `test/scan/batch.test.mjs` | snapshot / flushDirtyNames / resolve cache |
| `test/scan/entry.test.mjs` | scan apply/dispose |
| `test/log/harness-log.test.mjs` | 限流与 close |
| `test/architecture/*` | runner / pack 门禁自测 |

全部 <350 行；`npm test` / `npm run quality` 25/25 全绿。

**阶段出口：**Harness 有完整入口测试和独立质量门禁，不依赖 Bench 测试间接兜底。

## 10. 阶段 P6：验证、文档与发布收口

### [x] P6-1：运行全量自动门禁

**工作量：**30–60 分钟  
**验收：**

- Bench：build check、lint、typecheck、dependency、coverage、package check 全通过。
- Harness：lint、typecheck、coverage、package check 全通过。
- 结构预算、源码断言审计、orphan 和兼容门面门禁全通过。
- 两个仓库工作区无非预期生成物。

**实施记录（2026-09-15）：**

| 仓 | 命令 | 结果 |
|---|---|---|
| `dsh-corn-bench` | `npm run quality` | **通过**：build:check、lint、typecheck、deps（0 error/0 warn）、structure、assertions、test:coverage **1245/1245**、pack:check |
| `dsh-corn-harness` | `npm run quality` | **通过**：lint、typecheck、test:coverage **25/25**、pack:check |

覆盖率（Bench，`c8 --all`）：statements/lines **83.19%**，branches **69.43%**，functions **74.92%**（门槛 75/60/60/75）。  
Harness：statements/lines **93.68%**，branches **73.03%**，functions **94.28%**。  
结构：生产 >500 行为 **0**；门面均 ≤80 行；`deps:check` 四条 no-bench-facades 规则为 error 且清零。

P6-1 期间修复：CORE 模块迁入 `src/` 后缺 JSDoc 导致 typecheck 失败；`polling-service` 误回退到 `bench-*` 导入；`visualization-model` 因 JSDoc 略超 500 行；`polling-coordinator` 类型断言损坏运行时 `timers` Map。均已修且门禁复绿。

### [x] P6-2：执行关键集成验收

**工作量：**45–60 分钟  
**场景：**插件安装/卸载、Corn 页面挂载、双会话隔离、模拟 Modbus、Debug 模拟 backend、审批拒绝/批准、Client 重建加载。

**验收：**

- 每个场景记录输入、观察结果和未覆盖边界。
- 不连接真实设备，不声称 Windows/硬件通过。

**实施记录（2026-09-15）— 自动化证据（无真机）：**

| 场景 | 自动化证据（既有测试，全绿于 P6-1） | 未覆盖边界 |
|---|---|---|
| 插件安装 / 卸载（概念） | Bench `test/host-contract.test.mjs`（`apply` 幂等、`dispose` 清审批仓）；Harness `test/standing/entry.test.mjs`、`test/scan/entry.test.mjs`（apply/dispose/无残留） | 真实 `dsh plugin add/remove` + Web UI 热重载 |
| Corn 页面挂载 | `test/mount-smoke.test.mjs`；`test/client-apply.test.mjs`；`test/generated-client-effects.test.mjs` | 宿主真实会话区目视 |
| 双会话隔离 | `test/workspace/session-isolation.test.mjs`、`workspace-session-isolation.test.mjs`；`test/ui/project-workspace-isolation.test.mjs`；`test/ui/frame-cache-session-isolation.test.mjs`；写审批跨会话用例在 `write-approval-session` | 多浏览器窗口并发手测 |
| 模拟 Modbus | `test/hmi/sim-connection.test.mjs`；`test/infrastructure/polling-service.test.mjs` | 真 RTU/TCP 口与从站 |
| Debug 模拟 backend | `test/debug/keil-simulator-backend.test.mjs`、`keil-simulator-fake-uvsock.test.mjs` | 真 Keil UVSC / 板级 GDB |
| 审批拒绝 / 批准 | `test/workspace/write-approval-session.test.mjs`；`test/flash/approval*.test.mjs`；`test/debug/debug-approval*.test.mjs`、`debug-start-approval.test.mjs` | 宿主确认卡动效与超时 UI |
| Client 重建加载 | `test/client-bundle.test.mjs`；`test/client-budget.test.mjs`；quality 内 `build:check` | 打包进宿主后的缓存 bust 手测 |

不声称 Windows / STM32 / 真串口通过。

### [x] P6-3：更新架构文档

**工作量：**30–60 分钟  
**内容：**将 ADR-024 从 “First slice in progress” 更新为完成或准确的新状态；记录最终兼容层和大文件例外。

**验收：**

- README、ADR、包结构和实际源码一致。
- 历史计划移入 archive，现行计划只保留未完成事项。

**实施记录（2026-09-15）：**

- `dsh-corn-bench/docs/architecture/ADR-024-*.md`：Status → **Completed**；决策改为 `src/**` 禁止导入门面（四条 cruiser error）；兼容层 ≤80 行；记录 ADR-019–023 文档欠账与 Windows 验收边界。
- 本全文移入 `docs/archive/`；合集根现行计划缩为未完成事项摘要。
- 合集 `README.md` 规划段指向归档 + 现行摘要。

### [x] P6-4：版本与子模块收口

**工作量：**30–60 分钟  
**验收：**

- 先在 `dsh-corn-bench` 完成版本、CHANGELOG 和构建产物提交。
- 再在合集更新 submodule 指针和套件说明。
- 未经明确批准不发布 npm、不推送 release。

**实施记录（2026-09-15）— 已完成（除发布）：**

| 项 | 最终值 | 证据 |
|---|---|---|
| Bench 版本 | **0.29.0** | `dsh-corn-bench/package.json`；CHANGELOG `## 0.29.0` |
| Bench 提交 | `823bf22` 发布结构/测试重构 + 生成物；`8117dbb` Windows CI 路径修复 | `git log --oneline` |
| Harness 版本 | **0.2.0** | `dsh-corn-harness/package.json`；CHANGELOG |
| 合集 submodule `dsh-corn-bench` | `823bf22 → **8117dbb**` | 合集 P0-1 提交（见 `docs/CORN_COMPONENT_REUSE_AND_ENGINEERING_PLAN.md` §P0-1） |
| 合集内 `dsh-corn-harness` | 非 submodule，与合集同树 | 随合集提交 |
| 发布 | **未** npm publish / **未** git tag | 未经明确批准不做 |

**双仓 `npm run quality` 已绿**（Bench 1245 tests、Harness 25 tests，无 skipped/todo）。
合集指针在 P0-2 时已同步到含 Windows 修复的 `8117dbb`；按用户指示**暂不推送远端**。

### [x] P6-5：验证边界的准确表述

自动化与真机是两条独立证据链，不得互相代表：

| 层次 | 已证 | 未证 |
|---|---|---|
| **Windows 自动化 CI** | GitHub Actions `quality.yml` 在 `ubuntu-latest`/`windows-latest` × Node 20/22 四组矩阵通过（含路径断言 Windows-safe 修复 `8117dbb`） | CI 不装载真实宿主插件，不接真串口/探针 |
| **真实 Windows 宿主** | — | `dsh plugin add/remove`、多窗口、client 缓存 bust、Windows 路径手测 |
| **真实硬件** | — | STM32 + OpenOCD 板级调试、Keil UV4 真机编译、Modbus RTU 从站、Keil UVSC 仿真器 |

`DEFERRED_WINDOWS_ACCEPTANCE` 保持有效。计划的“Windows 通过”一律指**自动化 CI**，不是真机验收；
真机验收清单见 `dsh-corn-bench/docs/WINDOWS_ACCEPTANCE_0.27.md`（**仍未执行**）。

## 11. 提交与审查策略

- 每个任务一个聚焦提交；纯移动与行为修改尽量分开。
- 每次移动测试先证明移动前后测试清单一致，再删除旧文件。
- 每次拆生产模块先保留公开导出契约，再迁移调用者，最后收窄兼容门面。
- 不在结构提交中顺手调整视觉或业务规则。
- 子模块提交与合集指针提交分开，便于独立回滚。
- 每阶段结束运行完整 `quality`；阶段内每个小任务至少运行相关测试和依赖检查。

## 12. 风险与控制

| 风险 | 控制措施 |
|---|---|
| 移动测试后静默漏跑 | 比较移动前后测试文件列表与测试数量；runner 自测保留 |
| 抽公共组件导致所有页面同时回归 | 一次只迁移一种 pattern；保留页面级真实 React 测试 |
| 门面迁移破坏 Client bundle 作用域 | 每批迁移运行 `build:check`、bundle contract 和 mount smoke |
| Runtime 拆分破坏状态单一权威 | 先固定 canonical event/session/lease 契约，再移动实现 |
| 覆盖率启用 `--all` 后骤降 | 已实测不成立：分母只增 0.45%，不会跌破门槛（§1.1 修订 3）。仍按“第一提交只记录真实基线”执行 |
| 发布包缺模块而门禁看不见 | 已修：`pack:check` 增加导入闭包校验；新增缺失模块会立即失败 |
| 门面迁移范围被低估 | 已修：P3 拆为 P3-5a/P3-5b 并新增 P3-6；`facade` 组 allowlist 逐项记录到期阶段 |
| 为追求行数制造碎片 | 审查模块是否拥有清晰职责、输入输出和独立测试，而非只看行数 |
| Windows/硬件能力被自动测试误代表 | 保留 `DEFERRED_WINDOWS_ACCEPTANCE`，发布说明明确验证边界 |

## 13. 建议里程碑

| 里程碑 | 包含阶段 | 可验收结果 |
|---|---|---|
| M1：门禁可信 | P0–P1 | 能自动识别大文件、脆弱测试、漏覆盖和包清单问题 |
| M2：测试可维护 | P2 | 无 500 行测试文件，目录按领域组织，UI 源码锁大幅清零 |
| M3：Client 单轨 | P3 | `src/ui → bench-*` 为零，依赖警告为零 |
| M4：生产模块收敛 | P4 | 无未解释的 500 行生产文件，关键状态机契约保持通过 |
| M5：套件完成 | P5–P6 | Bench/Harness 双质量门禁通过，文档和发布边界一致 |

推荐从 M1 单独开始实施和审查。M1 不改用户可见功能，却决定后续重构能否被客观验收。
