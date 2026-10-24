# dsh-corn-bench：AI 原生嵌入式 Debug / Program Graph / Archify 迭代实施计划

> 目标读者：后续执行本计划的 Coding Agent / 工程师  
> 基线仓库：`xingyingyuzhui/dsh-corn-bench`  
> 基线分支：`main`  
> 基线提交：`79155a21bbf9c7de7a63fe2342116a60c2228a49`  
> 基线版本：`0.26.1`  
> 文档日期：2026-09-05  
> 计划性质：**代码实施计划，不是概念设计**。执行时若 `main` 已前移，必须先做“代码锚点重定位”，不得机械套行号。

---

## 0. 最终目标

把现有 `dsh-corn-bench` 从：

```text
Harness WebUI
  ├─ 调试：Keil 工程 / 编译 / OpenOCD 烧录 / 工程结构
  ├─ 上位机：Modbus / 点位 / 设备 / 连接
  └─ 监控：趋势 / 可视化 / 告警 / 串口报文 / 操作记录
```

迭代为：

```text
DeepSeek Harness / dsh web
│
├─ Browser Cordis / React client
│  ├─ 调试
│  │  ├─ 工作台
│  │  ├─ 工程
│  │  └─ 运行调试      ← 新增
│  │      ├─ Run / Pause / Step / Reset
│  │      ├─ Breakpoint / Watchpoint
│  │      ├─ Call Stack
│  │      ├─ Locals / Watches / Registers
│  │      ├─ Program Graph + Runtime Overlay
│  │      └─ Debug Timeline / Snapshot
│  ├─ 上位机
│  └─ 监控
│
└─ Host Cordis / Node
   ├─ Workspace / Journal / Evidence
   ├─ Modbus / I/O Runtime
   ├─ Keil Build / Project Model
   ├─ Flash Runtime
   ├─ Debug Runtime             ← 新增，Host 内部能力，不是新服务
   │  ├─ DebugSessionManager
   │  ├─ DebugTargetLease
   │  ├─ DebugEventRing
   │  ├─ DebugSnapshotService
   │  ├─ GdbMiAdapter
   │  ├─ OpenOcdDebugProcess
   │  └─ KeilUvSockAdapter      ← 后期
   ├─ ProgramModel              ← 扩展现有 keil/map
   └─ ArchifyAdapter            ← 后期，嵌入式库能力，不启独立服务

Debug Session 临时子进程：
  真机：arm-none-eabi-gdb + openocd
  仿真：UV4.exe / µCorn Simulator
```

最终闭环：

```text
发现异常
  → Agent / 用户设置断点或 Watchpoint
  → 真机/仿真运行
  → 命中
  → Debug Snapshot
  → Program Graph 高亮运行路径
  → Agent 读取源码 + Stack + Variables + Telemetry
  → Root Cause
  → 修改代码
  → Build
  → Flash
  → 重现条件
  → Verify
  → Evidence / Journal 完整留痕
```

---

# 1. 不可违反的架构原则

执行 Agent 必须优先遵守本节，优先级高于“尽快做出 UI”。

## 1.1 不新建独立 Corn Web 服务

DeepSeek Harness 本身已经是 WebUI；当前插件 Client 已直接注入 Harness Browser Cordis/React，Host 已运行在 Harness Host Cordis 树。

因此禁止：

```text
× 新建 Express/Fastify Debug Server
× 新建独立 WebSocket Server
× 新建 Archify Preview Server
× iframe 一个独立 Debug SPA
× 单独启动一个“Corn Debug Backend”长期服务
```

Debug 后端必须是 **现有 Host 插件内部 application/infrastructure 能力**。

Browser ↔ Host 继续走 Harness `ctx.connection.rpc`。

Agent 跨进程继续复用当前唯一的：

```text
POST /dsh-corn-bench/command
```

不得为 Debug 再开第二个 HTTP Agent bridge，除非先新增 ADR 并明确废弃 ADR-012 的“exactly one HTTP bridge”约束。

---

## 1.2 Node 化接口层，不重写调试内核

必须复用：

```text
Keil / µCorn
OpenOCD
GNU GDB
GDB/MI
Keil UVSOCK
OpenOCD 官方 cfg
```

禁止自行重写：

```text
× SWD/JTAG
× ST-Link protocol
× Cortex-M debug core
× Flash algorithm
× GDB Remote Serial Protocol（V1）
× ELF/DWARF parser（V1）
× C expression evaluator
× stack unwinder
× Keil Simulator
× 通用图布局引擎
```

原则：

```text
官方机器接口 > 官方 CLI > 官方配置/脚本 > 成熟实现模式 > 自己实现
```

---

## 1.3 继续使用项目当前的运行时形态

当前主工程是：

```text
ESM .mjs
@ts-check
.d.ts 类型契约
TypeScript 仅用于静态检查
```

**本轮不要把 Host Runtime 大规模改成 `.ts` + 编译产物。**

原因：

1. 当前发布包直接暴露 `host.js` / `client.js` / `.mjs`。
2. 当前 `npm run quality` 已围绕 `.mjs + tsc check` 建立。
3. 新增 TS Runtime 会引入另一条 build/runtime 链，收益低。

推荐：

```text
新业务实现：*.mjs + // @ts-check
公共类型：src/types/*.d.ts
仅必要时使用 TS 开发辅助，不改变 runtime contract。
```

---

## 1.4 Host 保持唯一权威状态所有者

延续 ADR-004 / ADR-006：

```text
UI       ─┐
Agent    ─┼→ Host Application Services → State / I/O / Debug
Worker   ─┘
```

禁止：

```text
× Browser 直接连接 GDB/OpenOCD
× Agent 直接 spawn GDB/OpenOCD
× Agent 自己持有 DebugSession
× Client 自己保存 authoritative breakpoint/session 状态
```

UI 可以 optimistic，但必须从 Host reconcile。

---

## 1.5 ProgramModel 是内部 canonical model，Archify 只是 Adapter

禁止把 Archify IR 直接作为 Corn 核心 Domain Model。

正确关系：

```text
Keil Project / Source / Tree-sitter
            ↓
       ProgramModel       ← Corn canonical model
        /        \
       ↓          ↓
现有 React Graph   ArchifyAdapter
                  ↓
              Archify IR
```

这样 Archify 可以升级、替换、关闭，不影响 Debug Domain。

---

# 2. 当前代码基线与必须保护的能力

以下是执行 Agent 开工前必须重新确认的当前锚点。

## 2.1 Host / Client 架构

### `host.js`

当前关键锚点：

- `apply(ctx, config)`：约当前 L130-L230。
- `role === 'agent'` 分支只注册 `cornBenchTool`。
- Host 分支要求 `ctx.connection.rpc.handle`。
- Host 创建 `createCornRpcRouter()`。
- Host 创建 `createCornCommandDispatcher()` 并 `registerCornHost()`。
- Browser RPC 走 `CORN_RPC_CHANNEL`。
- 唯一 HTTP 路由是 `/dsh-corn-bench/command`。
- dispose 时清理 polling / approvals / I/O broker。

**Debug 必须接入这个 lifecycle。**

### `src/ui/client/client-entry.mjs`

当前仅：

```js
export { apply } from '../../../bench-runtime.mjs'
export const name = 'dsh-corn-bench'
export const inject = ['slots', 'locale', 'connection']
```

不要新增第二个 Browser plugin entry。

### `bench-runtime.mjs`

当前：

- 从 Harness `ctx.connection.rpc.call` 获取 Browser RPC。
- 使用 Harness React。
- 注册 Settings / DebugWorkspace / HMI / Monitor。
- Agent focus 已能跨页面路由。

Debug Runtime UI 必须继续由这里注册的 `DebugWorkspace` 承载。

---

## 2.2 Browser RPC

### `src/shared/corn-rpc-contract.mjs`

当前是所有 Browser path → Connection RPC endpoint 的权威映射。

后续 Debug Browser API 只新增以下 3～4 个稳定入口，不要为每一个按钮建 endpoint：

```text
/dsh-corn-bench/debug/state       -> debug/state
/dsh-corn-bench/debug/command     -> debug/command
/dsh-corn-bench/debug/events/wait -> debug/events/wait
/dsh-corn-bench/debug/approval    -> debug/approval   （若需要）
```

建议以 `debug/command` 的 `op` 承载 run/pause/step/breakpoint/watchpoint 等操作。

---

## 2.3 Session state polling

### `src/ui/common/state-subscription.mjs`

当前：

```js
POLL_MS = 2000
```

按 `sessionId + cwd` 复用 `/state` 轮询。

**不得拿这个 2 秒轮询承载 Debug stop/run/step 实时事件。**

后续单独新增 Debug long-poll event stream，但仍使用 `ctx.connection.rpc.call`。

---

## 2.4 Debug workspace

### `src/ui/workspace/corn-route.mjs`

当前：

```js
DEBUG_SECTIONS = {
  WORKBENCH: 'workbench',
  PROJECT: 'project',
}
```

必须扩展为：

```js
DEBUG_SECTIONS = {
  WORKBENCH: 'workbench',
  PROJECT: 'project',
  RUNTIME: 'runtime',
}
```

并在 `routeForKind()` 增加：

```text
debug / breakpoint / watchpoint / snapshot / debug-event
→ VIEW_DEBUG + DEBUG_SECTIONS.RUNTIME
```

`targetOf()` 同时扩展：

```text
debugSessionId
breakpointId
watchpointId
snapshotId
frameLevel
function
```

### `src/ui/workspace/debug-workspace.mjs`

当前只有：

```text
WorkbenchPage
ProjectPage
```

需新增：

```text
RuntimePage
```

不得把 Runtime Debug 直接塞进现有 `createDebugView()` 形成更大的 monolith。

---

## 2.5 Project Graph

当前已有：

```text
src/ui/debug/project/project-graph-model.mjs
src/ui/debug/project/project-graph-layout.mjs
src/ui/debug/project/project-graph-view.mjs
```

已有能力：

- node / edge / cluster；
- truncation；
- neighborhood；
- SVG；
- pan / zoom；
- fit；
- focus；
- keyboard；
- edge highlight。

**这已经是后续 Runtime Program Graph 的 UI 基础。不要引入 iframe Archify viewer 替换。**

后续应抽出通用图能力，而不是复制文件。

---

## 2.6 Keil 当前 Python 边界

### `bench-keil.mjs`

当前：

```text
keilScan    → Python keil_project.py
keilTargets → Python keil_project.py
keilMap     → Python keil_project.py
keilBuild   → Python keil_build.py → UV4.exe
```

### `runtime/keil_project.py`

当前做：

- 工作区扫描 `.uvprojx`；
- Target；
- XML；
- Group/File；
- IncludePath；
- Define；
- include edge；
- C 函数 regex；
- workspace escape 防护；
- 文件/函数/边数量截断。

### `runtime/keil_build.py`

当前做：

- `UV4 -b ... -j0 -o log`；
- PATH 补 Keil toolchain；
- compile/after-build error classification；
- Program Size；
- AXF/ELF/HEX/BIN 产物发现。

这些能力可以 Node 化，但必须做 **行为等价迁移**，不能边迁移边改 contract。

---

## 2.7 OpenOCD / process 现有基础

### `bench-run.mjs`

已经有：

```text
runExecFile()
AbortSignal
Timeout
killProcessTree()
windowsHide
```

### `src/infrastructure/process/openocd-runner.mjs`

已经有：

```text
OpenOCD identity probe
interface/target profile
Tcl path encoding
program verify reset exit
AbortSignal
result evidence parsing
```

### `bench-io-broker.mjs`

已经有一套成熟的长生命周期子进程治理模式：

```text
idle → starting → ready → unhealthy → stopping
handshake
request id
pending map
backpressure
abort
crash cleanup
kill tree
```

**DebugProcess 代码要参考这套模式，但不要把 I/O Broker 抽象成一个万能父类。**

---

# 3. 目标目录结构

完成本路线后建议达到：

```text
src/
├── domain/
│   ├── config/
│   ├── flash/
│   ├── modbus/
│   ├── keil/                         # 新
│   │   ├── project-model.mjs
│   │   ├── build-result.mjs
│   │   └── errors.mjs
│   ├── debug/                        # 新
│   │   ├── debug-state.mjs
│   │   ├── debug-event.mjs
│   │   ├── debug-location.mjs
│   │   ├── breakpoint.mjs
│   │   ├── watchpoint.mjs
│   │   ├── target-lease.mjs
│   │   ├── snapshot.mjs
│   │   └── errors.mjs
│   └── program/                      # 新
│       ├── program-model.mjs
│       ├── graph-model.mjs
│       └── source-ref.mjs
│
├── application/
│   ├── keil/                         # 新
│   │   ├── project-service.mjs
│   │   └── build-service.mjs
│   ├── debug/                        # 新
│   │   ├── debug-runtime.mjs
│   │   ├── debug-session-service.mjs
│   │   ├── debug-control-service.mjs
│   │   ├── debug-breakpoint-service.mjs
│   │   ├── debug-inspect-service.mjs
│   │   ├── debug-event-service.mjs
│   │   ├── debug-snapshot-service.mjs
│   │   ├── debug-approval-service.mjs
│   │   └── debug-command-service.mjs
│   ├── program/                      # 新
│   │   ├── program-model-service.mjs
│   │   └── program-graph-service.mjs
│   └── commands/
│       └── host-command-service.mjs  # 新，兼容旧 command bridge
│
├── infrastructure/
│   ├── keil/                         # 新
│   │   ├── uvprojx-parser.mjs
│   │   ├── keil-project-scanner.mjs
│   │   ├── uv4-build-runner.mjs
│   │   └── uv4-env.mjs
│   ├── debug/                        # 新
│   │   ├── process/
│   │   │   ├── debug-process.mjs
│   │   │   └── ready-detector.mjs
│   │   ├── gdb-mi/
│   │   │   ├── mi-record.mjs
│   │   │   ├── mi-parser.mjs
│   │   │   ├── mi-client.mjs
│   │   │   └── gdb-backend.mjs
│   │   ├── openocd/
│   │   │   ├── openocd-debug-process.mjs
│   │   │   └── openocd-debug-profile.mjs
│   │   └── keil/
│   │       ├── uvsock-client.mjs     # 后期
│   │       └── keil-sim-backend.mjs  # 后期
│   ├── program/
│   │   ├── source-analyzer.mjs       # V1 parity
│   │   └── tree-sitter-analyzer.mjs  # 后期
│   └── archify/                      # 后期
│       ├── archify-adapter.mjs
│       └── archify-runtime.mjs
│
├── interfaces/
│   ├── rpc/
│   │   ├── corn-rpc-router.mjs
│   │   └── debug-rpc-handler.mjs     # 新
│   └── agent/
│       └── corn-debug-tool.mjs     # 新
│
├── shared/
│   ├── corn-rpc-contract.mjs
│   └── debug-contract.mjs            # 新，Browser/Host 共用 DTO
│
├── types/
│   ├── debug.d.ts                    # 新
│   ├── program.d.ts                  # 新
│   └── agent-tool.d.ts               # 修改
│
└── ui/
    ├── workspace/
    │   ├── corn-route.mjs
    │   └── debug-workspace.mjs
    ├── debug/
    │   ├── project/
    │   └── runtime/                  # 新
    │       ├── runtime-page.mjs
    │       ├── runtime-controller.mjs
    │       ├── debug-toolbar.mjs
    │       ├── debug-status-strip.mjs
    │       ├── stack-panel.mjs
    │       ├── variables-panel.mjs
    │       ├── watches-panel.mjs
    │       ├── breakpoint-panel.mjs
    │       ├── debug-timeline.mjs
    │       ├── runtime-program-graph.mjs
    │       └── use-debug-events.mjs
    └── common/
        └── focus-store.mjs
```

注意：上面是**目标结构**。必须按阶段建立，禁止第一笔 commit 一次创建全部空文件。

---

# 4. Phase 0：基线冻结、ADR 与测试护栏

## 4.1 新增 ADR

新增：

```text
docs/architecture/ADR-013-debug-runtime-boundary.md
docs/architecture/ADR-014-debug-events-over-connection-rpc.md
docs/architecture/ADR-015-program-model-and-archify-boundary.md
```

### ADR-013 必须写死

```text
- DebugRuntime 属于 Host 内部 application/runtime。
- GDB/OpenOCD/UV4 为 session-scoped child process。
- Browser/Agent 不直接控制调试器。
- Host 是 DebugSession、Breakpoint、Watchpoint、Lease、Snapshot 唯一 owner。
- V1 Hardware backend = GDB/MI + OpenOCD。
- Keil Simulator backend 延后。
```

### ADR-014 必须写死

```text
- 普通 workspace state 继续 2s poll。
- Debug event 不进入普通 /state 高频刷新。
- V1 使用 Connection RPC cursor long-poll。
- 不新增 WebSocket server / port。
- Event stream 是可替换 transport；未来 Harness typed stream 可替换实现。
```

### ADR-015 必须写死

```text
- ProgramModel 是 Corn canonical IR。
- 当前 ProjectGraph UI 继续保留。
- Archify 仅通过 Adapter 使用。
- 不嵌 Archify preview shell / iframe。
```

## 4.2 建立基线测试

在改代码前确保：

```bash
npm run quality
```

必须通过。

新增或加强以下 contract test：

```text
test/architecture/debug-boundary.test.mjs
```

先测试“未来约束”，即：

- Browser 不注册额外 HTTP route。
- `CORN_RPC_CHANNEL` 仍唯一。
- `corn_bench` 当前 ACTIONS 未出现 debug op。
- `DebugWorkspace` 仍只有已知 sections（Phase 3 再更新 expected）。

### 完成标准

```text
[ ] ADR commit 独立
[ ] quality 绿色
[ ] 无产品行为变化
```

建议 commit：

```text
docs: define debug runtime and program graph boundaries
```

---

# 5. Phase 1：先把 Keil Python 桥 Node 化（纯等价迁移）

这一阶段不做 Debug UI。

目标：

```text
Before:
bench-keil.mjs → Python → UV4/XML/filesystem

After:
bench-keil.mjs → application/keil → Node infrastructure → UV4/XML/filesystem
```

## 5.1 新增纯 JS XML 依赖

优先选一个成熟、纯 JS、无后台服务、无 native build 的 XML parser，例如：

```text
fast-xml-parser
```

要求：

- production dependency；
- Windows 无 node-gyp；
- parser 配置固定；
- 不使用 regex 解析 `.uvprojx` XML。

修改：

```text
package.json dependencies
package-lock.json
```

## 5.2 新建 `src/infrastructure/keil/uvprojx-parser.mjs`

把 `runtime/keil_project.py` 中 XML 相关逻辑逐项迁移：

```text
listTargets(projectPath)
readTarget(projectPath, wantedTarget)
readVariousControls(target)
readGroups(target)
readOutputOptions(target)
```

必须保持：

- Target 顺序；
- Group/File 顺序；
- IncludePath 分隔语义；
- Define `;` / `,` 行为；
- 相对路径以 `.uvprojx` 所在目录为基准。

禁止在这一 commit 同时改输出 schema。

## 5.3 新建 `src/infrastructure/keil/keil-project-scanner.mjs`

迁移：

```text
scan_projects()
is_broad_root()
_depth()
_inside()
_readable()
_read_source()
```

复用 Node：

```text
node:fs/promises
node:path
```

必须继续：

- 禁止盘根 / home / system broad scan；
- `.git/.svn/.hg/node_modules/.venv/...` skip；
- max depth；
- max results；
- workspace 防逃逸。

## 5.4 新建 `src/infrastructure/program/source-analyzer.mjs`

**Phase 1 先做 parity，不马上引 Tree-sitter。**

把 Python 当前：

```text
INCLUDE_RE
FUNC_PROTO
FUNC_SKIP
```

等价迁移。

加注释：

```text
// PARITY IMPLEMENTATION ONLY.
// Phase 7 replaces function/call/data extraction with a parser-backed analyzer.
```

避免 Agent 后续误把 regex 继续扩成编译器。

## 5.5 新建 `src/domain/keil/project-model.mjs`

不要让 parser 直接返回任意 JSON。

建立 normalize 函数：

```js
export function normalizeKeilProjectMap(raw) { ... }
```

保证当前 `keilMap()` 返回的 `result.details` contract 不变：

```text
project
target
groups
includes
defines
include_edges
truncated
limits
counts
```

## 5.6 新建 `src/infrastructure/keil/uv4-env.mjs`

迁移 `keil_build.py`：

```text
toolchain_bins()
build_env()
```

要求：

- 从 UV4 位置推导 ARMCC/ARMCLANG bin；
- 保持当前 PATH 前置逻辑；
- Windows path 正确；
- 不污染 `process.env`，只返回复制后的 env。

## 5.7 新建 `src/infrastructure/keil/uv4-build-runner.mjs`

复用当前 `bench-run.mjs::runExecFile()`。

执行参数必须与现有 Python 完全一致：

```text
UV4.exe
-b <project>
-j0
-o <log>
-t <target>   # target 非空时
```

迁移：

```text
ERRORLEVEL_MAP
ERROR_LINE
AFTER_BUILD
COUNT_LINE
SIZE_LINE
classifyLog()
collectArtifacts()
```

注意 `runExecFile` 当前是 UTF-8；Keil log 文件仍需保留：

```text
utf-8-sig
utf-8
gbk/cp936 fallback
```

因此新增一个文件读取 helper，不要依赖 stdout 获得 Keil build log。

## 5.8 新建 application services

```text
src/application/keil/project-service.mjs
src/application/keil/build-service.mjs
```

把：

```text
workspace validation
binding validation
task opening
task finishing
prune log
artifact selection
```

从 `bench-keil.mjs` 逐步下沉。

## 5.9 修改 `bench-keil.mjs`

当前整个文件仍对外暴露：

```text
keilScan
keilTargets
keilMap
keilBuild
```

**保留 API 不变。**

实现变成 facade：

```js
export { keilScan, keilTargets, keilMap } from './src/application/keil/project-service.mjs'
export { keilBuild } from './src/application/keil/build-service.mjs'
```

或薄 wrapper。

## 5.10 设置页兼容期

当前 README/Settings 把 Python 标为 optional，但 Keil scan/build 实际仍需要。

迁移完成后：

- Python binding 不再用于 Keil。
- Settings UI 先保留一版 deprecated 字段，显示“已不需要”；
- 下一 minor release 再删除 disk binding schema，避免直接破坏已有 settings。

## 5.11 parity tests

新增：

```text
test/keil/uvprojx-parser.test.mjs
test/keil/project-scanner.test.mjs
test/keil/project-map-parity.test.mjs
test/keil/uv4-build-args.test.mjs
test/keil/build-log-parser.test.mjs
test/keil/artifact-discovery.test.mjs
```

fixture：

```text
test/fixtures/keil/simple.uvprojx
test/fixtures/keil/multi-target.uvprojx
test/fixtures/keil/includes-and-defines.uvprojx
test/fixtures/keil/sample-build-ok.log
test/fixtures/keil/sample-build-error.log
test/fixtures/keil/sample-after-build-error.log
```

### 删除 Python 的门槛

仅在以下全部通过后删除：

```text
runtime/keil_project.py
runtime/keil_build.py
bench-run.mjs 中 runPythonScript / SCRIPTS（若无其他用途）
package files 中 Python 文件
Settings 的 Python binding（可分下一 commit）
```

### Phase 1 完成标准

```text
[ ] Windows 不安装 Python，也可 scan/targets/map/build
[ ] map JSON 与旧实现 fixture 等价
[ ] build result contract 不变
[ ] Agent `corn_bench build/map` 无需改 prompt
[ ] npm run quality 通过
```

推荐拆 3 个 commit，不要一笔：

```text
refactor(keil): add native uvprojx project services
refactor(keil): run uv4 build directly from node
chore(keil): remove python runtime dependency after parity
```

---

# 6. Phase 2：建立 Debug Domain，不连真实 GDB

这一阶段只建立纯 domain/application model，全部可 unit test。

## 6.1 新建 `src/types/debug.d.ts`

至少定义：

```ts
export type DebugBackendKind = 'gdb-openocd' | 'keil-simulator'
export type DebugRunState = 'idle' | 'starting' | 'ready' | 'running' | 'paused' | 'stopping' | 'failed'

export interface SourceLocation {
  file: string
  line: number
  column?: number
  function?: string
  address?: string
}

export interface DebugBreakpoint { ... }
export interface DebugWatchpoint { ... }
export interface DebugStackFrame { ... }
export interface DebugVariable { ... }
export interface DebugRegister { ... }
export interface DebugEvent { ... }
export interface DebugSnapshot { ... }
export interface DebugSessionView { ... }
```

## 6.2 新建 `src/domain/debug/debug-state.mjs`

定义合法状态迁移：

```text
idle
 → starting
 → ready/paused
 → running
 → paused
 → stopping
 → idle

任意运行态 → failed
failed → stopping/idle
```

提供：

```js
canTransition(from, to)
transition(state, event)
```

禁止 UI 或 GDB adapter 自己随意拼 state 字符串。

## 6.3 新建 `src/domain/debug/debug-event.mjs`

统一事件 type：

```text
debug.session.starting
debug.session.ready
debug.session.stopped
debug.session.failed

debug.running
debug.paused
debug.breakpoint.created
debug.breakpoint.removed
debug.breakpoint.hit
debug.watchpoint.created
debug.watchpoint.removed
debug.watchpoint.hit
debug.step.complete
debug.exception
debug.console
debug.snapshot.created
debug.session.closed
```

每个 event 至少带：

```text
id
cursor
debugSessionId
workspaceCwd
ownerSessionId
timestamp
type
backend
```

## 6.4 新建 `src/domain/debug/target-lease.mjs`

V1 即使只允许一个 active debug session，也必须抽象 lease，避免以后重构。

```js
createTargetKey({ backend, interfaceName, target, probeSerial })
```

V1 可：

```text
probeSerial 不可得 → interfaceName + target + workspace
```

但返回值必须明确 `identityStrength: weak|strong`。

错误：

```text
DEBUG_TARGET_BUSY
DEBUG_SESSION_NOT_OWNER
DEBUG_SESSION_STALE
```

## 6.5 新建 `src/domain/debug/snapshot.mjs`

snapshot schema：

```text
id
createdAt
reason
location
stack
locals
watches
registers?       # 默认可省
selectedGlobals?
sourceContext?
firmwareHash
backend
breakpointId?
watchpointId?
```

**不要默认抓全部 RAM/全部 register/全部 global。**

Agent 诊断默认 snapshot 要控制体积。

## 6.6 新建 application DebugRuntime shell

```text
src/application/debug/debug-runtime.mjs
```

职责：

- 维护 session registry；
- 维护 lease；
- 暴露 snapshot view；
- 持有 backend factory；
- 管理 cleanup；
- 不解析 MI；
- 不知道 React。

建议接口：

```js
createDebugRuntime(deps)

runtime.start(spec)
runtime.stop(scope)
runtime.command(scope, command)
runtime.state(scope)
runtime.waitEvents(scope, cursor, signal)
runtime.shutdown(reason)
```

## 6.7 单测

```text
test/debug/debug-state.test.mjs
test/debug/debug-lease.test.mjs
test/debug/debug-event-ring.test.mjs
test/debug/debug-runtime-lifecycle.test.mjs
```

### 完成标准

```text
[ ] 无 GDB/OpenOCD 也能用 fake backend 跑完整 session lifecycle
[ ] Session A 无法控制 Session B
[ ] 两个 session 抢同 target 得到 DEBUG_TARGET_BUSY
[ ] Abort/stop 后 lease 一定释放
[ ] quality 绿色
```

---

# 7. Phase 3：实现 GDB/MI + OpenOCD Hardware Backend

## 7.1 Settings 新增 GDB binding

修改 Settings/Bindings domain：

```text
uv4
openocd
gdb        ← 新
python     ← 若 Phase 1 已删除则移除
```

GDB identity probe：

```text
arm-none-eabi-gdb --version
```

验证输出中至少有：

```text
GNU gdb
```

不要仅检查文件存在。

## 7.2 新建 `src/infrastructure/debug/process/debug-process.mjs`

参考：

```text
bench-io-broker.mjs
bench-run.mjs
```

但只做 session-scoped child：

```js
spawnManagedProcess({
  bin,
  args,
  cwd,
  env,
  signal,
  onStdout,
  onStderr,
})
```

能力：

```text
windowsHide
kill tree
abort
exit promise
stderr tail cap
stdout line framing
ready timeout
idempotent stop
```

不要实现通用 worker request protocol。

## 7.3 OpenOCD debug runtime

新增：

```text
src/infrastructure/debug/openocd/openocd-debug-profile.mjs
src/infrastructure/debug/openocd/openocd-debug-process.mjs
```

必须复用：

```text
src/domain/flash/openocd-profile.mjs
```

即 interface/target allowlist 不复制。

启动参数 V1：

```text
-f interface/<interface>.cfg
-f target/<target>.cfg
```

并通过 `-c` 关闭无用 telnet（若当前 OpenOCD 版本支持）或保持 loopback。

Ready 判定不要只 sleep：

优先检测：

```text
Listening on port ... for gdb connections
```

同时用 socket connect 做最终 ready probe。

### V1 端口策略

第一版建议：

```text
Host 同时只允许 1 个 active Hardware DebugSession
```

使用默认 GDB port 3333。

原因：先不引动态端口 allocator；DebugTargetLease 已为未来放开并发留接口。

## 7.4 GDB MI process

启动：

```text
arm-none-eabi-gdb
--interpreter=mi3
--quiet
--nx
<debug_file.axf/elf>
```

连接：

```text
-target-select extended-remote 127.0.0.1:3333
```

V1 先不让 GDB 负责烧录；沿用现有 Flash 工作流生成/确认固件，Debug 只连接当前已烧录固件。

## 7.5 GDB/MI parser

新增：

```text
mi-record.mjs
mi-parser.mjs
mi-client.mjs
```

**Parser 按官方 MI grammar 实现，不使用 `split(',')`。**

必须支持：

```text
result-record: ^done ^error ^running ^connected ^exit
exec async:    *running *stopped
notify async:  =...
stream:        ~console @target &log
value:         const tuple list
optional token
C-string escaping
```

内部保持 Native MI model：

```js
{
  token,
  kind: 'result' | 'exec-async' | 'notify-async' | 'console-stream' | ...,
  class,
  results
}
```

**MI parser 层禁止返回 Corn `DebugEvent`。**

## 7.6 `mi-client.mjs`

职责：

```text
token generator
pending request map
command timeout
AbortSignal
stdout framing
MI parse
async event subscribe
process exit propagation
```

接口示例：

```js
await mi.command('-break-insert', ['file.c:123'])
mi.onRecord(record => ...)
```

## 7.7 `gdb-backend.mjs`

这里才做 Native → Corn Domain 映射。

实现：

```text
start
stop
run
pause
stepInto
stepOver
stepOut
resetHalt
setBreakpoint
removeBreakpoint
setWatchpoint
removeWatchpoint
stack
locals
evaluate
registers
readMemory
```

MI command 建议：

```text
-break-insert
-break-delete
-break-watch
-exec-continue
-exec-interrupt
-exec-step
-exec-next
-exec-finish
-stack-list-frames
-stack-list-variables
-data-evaluate-expression
-data-list-register-names
-data-list-register-values
-data-read-memory-bytes
-interpreter-exec console "monitor reset halt"
```

## 7.8 Stop reason 映射

建立单独函数：

```js
mapGdbStopReason(miRecord)
```

输出：

```text
breakpoint
watchpoint
step
signal
exception
pause
exit
unknown
```

禁止在 UI 判断 GDB `reason` 字符串。

## 7.9 Hardware session startup 顺序

固定为：

```text
1. 校验 workspace/session ownership
2. 校验 bindings.openocd / bindings.gdb
3. 校验 debug artifact AXF/ELF 存在
4. 计算 artifact sha256
5. 获取 DebugTargetLease
6. spawn OpenOCD
7. wait GDB server ready
8. spawn GDB MI
9. target-select
10. monitor reset halt
11. 读取初始 frame/state
12. DebugSession = paused/ready
13. emit debug.session.ready
```

失败必须逆序 cleanup。

## 7.10 Shutdown 顺序

```text
1. 标记 stopping，拒绝新命令
2. GDB interrupt（若 running，短 timeout）
3. GDB detach/exit
4. kill/stop GDB
5. stop OpenOCD
6. release target lease
7. emit closed
8. remove runtime registry
```

Host/plugin dispose 必须执行全部 active session `shutdown('plugin-dispose')`。

## 7.11 测试

Parser 不能依赖真机：

```text
test/debug/gdb-mi-parser.test.mjs
test/debug/gdb-mi-client.test.mjs
test/debug/gdb-stop-reason.test.mjs
test/debug/openocd-debug-process.test.mjs
test/debug/gdb-backend-contract.test.mjs
```

使用录制的 MI fixture：

```text
test/fixtures/gdb-mi/breakpoint-hit.txt
test/fixtures/gdb-mi/watchpoint-hit.txt
test/fixtures/gdb-mi/step-complete.txt
test/fixtures/gdb-mi/error.txt
```

参考实现可以研究：

```text
phryniszak/stmcp
Marus/cortex-debug
GDB 官方 MI grammar
```

只能参考边界和协议处理，不应直接大段复制第三方实现。

---

# 8. Phase 4：Debug Event Ring + Harness Connection RPC

## 8.1 新建 `src/application/debug/debug-event-service.mjs`

每个 DebugSession 维护：

```text
ring capacity: 建议 512 或 1024
monotonic cursor
waiters
```

接口：

```js
append(event)
listAfter(cursor, limit)
waitAfter(cursor, { signal, timeoutMs })
close()
```

### long-poll 规则

```text
有新事件 → 立即返回
无事件 → 最多挂起 20~25s
AbortSignal → 立即清 waiter
session stop → 返回 closed marker
```

不能无限挂 Promise。

## 8.2 修改 `src/shared/corn-rpc-contract.mjs`

在 `CORN_HTTP_TO_RPC` 增加：

```js
'/dsh-corn-bench/debug/state': 'debug/state',
'/dsh-corn-bench/debug/command': 'debug/command',
'/dsh-corn-bench/debug/events/wait': 'debug/events/wait',
```

若 approval 单独 endpoint：

```js
'/dsh-corn-bench/debug/approval': 'debug/approval',
```

## 8.3 新建 `src/interfaces/rpc/debug-rpc-handler.mjs`

不要继续让 `corn-rpc-router.mjs` switch 无限增长。

接口：

```js
export function createDebugRpcHandler(deps) {
  return async function handleDebugRpc(endpoint, body, signal) { ... }
}
```

处理：

```text
debug/state
debug/command
debug/events/wait
debug/approval
```

## 8.4 修改 `src/interfaces/rpc/corn-rpc-router.mjs`

当前文件已有很大的 switch。

在 `createCornRpcRouter()` 初始化时创建：

```js
const debugRpc = createDebugRpcHandler(...)
```

`dispatch()` 最前面（完成 touchSession 后）增加：

```js
if (endpoint.startsWith('debug/')) {
  return debugRpc(endpoint, body, signal)
}
```

Debug 逻辑不得散落到已有 Modbus switch 里。

## 8.5 Event DTO

新建：

```text
src/shared/debug-contract.mjs
```

只放 serializable DTO normalize/validate，不 import Node APIs。

Client/Host 可共享。

## 8.6 不修改普通 state poller

`src/ui/common/state-subscription.mjs` 保持 2s 语义。

不要把：

```text
stack
locals
registers
debug event ring
```

塞进 `/state` 普通 snapshot。

最多在 `/state` 放轻量 capability：

```text
debug: {
  available: true,
  active: true/false,
  ownerSessionId?,
  backend?
}
```

---

# 9. Phase 5：新增 `corn_debug` Agent Tool，保持 `corn_bench` 干净

## 9.1 不向 `bench-tool.mjs::ACTIONS` 塞 debug actions

当前 `corn_bench` 已经很大。

禁止：

```text
corn_bench action=debugStart
corn_bench action=debugRun
...
```

## 9.2 新建 `src/interfaces/agent/corn-debug-tool.mjs`

Tool：

```text
name = corn_debug
```

V1 action schema：

```text
status
start
stop
run
pause
step
breakpoint
watchpoint
inspect
evaluate
snapshot
reset
```

参数：

```text
backend
file
line
function
expression
access
breakpointId
watchpointId
frame
include
address
length
commandId
```

Agent tool 不暴露：

```text
raw MI command
raw OpenOCD command
raw UVSOCK packet
```

## 9.3 Agent Host command bridge

为了继续只有一个 HTTP `/command`，内部 command action 使用 namespace：

```text
debug.status
debug.start
debug.stop
debug.run
...
```

Browser 不需要这些 prefix；Browser 走 `debug/command` RPC。

## 9.4 新建 `src/application/debug/debug-command-service.mjs`

```js
executeDebugCommand(input)
```

负责：

```text
normalize
session ownership
idempotency（必要操作）
route
result envelope
```

## 9.5 新建 `src/application/commands/host-command-service.mjs`

保持 backward compatibility：

```js
export async function executeHostCommand(input) {
  const action = String(input?.action || '')
  if (action.startsWith('debug.')) return executeDebugCommand(input)
  return executeCornCommand(input)
}
```

然后把 Host `/command` 的 dispatcher 从 `executeCornCommand` 切到 `executeHostCommand`。

原 `corn_bench` 行为不变。

## 9.6 修改 `src/infrastructure/host/corn-host-client.mjs`

目前 `dispatchCornCommand()`：

```text
in-process host handle
→ local executeCornCommand fallback
→ HTTP /command
```

新增通用：

```js
dispatchHostCommand()
```

然后：

```js
dispatchCornCommand = wrapper(dispatchHostCommand)
dispatchCornDebugCommand = wrapper(dispatchHostCommand)
```

不要复制 `tryHostHttp()`。

`queryTimeoutMs()` 增加：

```text
debug.start / debug.stop: 20~30s
debug.run/pause/step: 10s
debug.inspect: 10s
```

## 9.7 修改 `host.js`

当前 `role === 'agent'` 分支：

```js
const stopTool = ctx.tools.register(cornBenchTool(dshHome))
```

改为：

```js
const stopBenchTool = ctx.tools.register(cornBenchTool(dshHome))
const stopDebugTool = ctx.tools.register(cornDebugTool(dshHome))
```

cleanup 两个。

Preset 仍然是一份 Corn 模式，不创建第二个 preset。

## 9.8 修改 `bench-preset.mjs`

`CORN_GUIDANCE` 增加 Debug 指引，但保持短：

```text
- Firmware runtime diagnosis uses corn_debug, not raw GDB/OpenOCD commands.
- For unexplained value changes, prefer watchpoint → run → inspect snapshot.
- Never start a second hardware debug session when target lease is busy.
- Debug snapshots are evidence; cite snapshot ids in diagnosis.
```

不要把所有 debug schema 塞 system prompt。

## 9.9 tests

```text
test/debug/agent-tool.test.mjs
test/debug/host-command-routing.test.mjs
test/debug/debug-command-ownership.test.mjs
```

验证：

```text
corn_bench ACTIONS 不包含 debug
corn_debug 只注册在 Corn preset generation
跨 session 控制拒绝
HTTP bridge 仍只有一个
```

---

# 10. Phase 6：真机 Debug Approval / Control Lease

## 10.1 不做每个 Run/Step 都确认

否则不可用。

新增一种：

```text
Debug Control Approval
```

首次 `debug.start`：

```text
Target
Probe/interface
OpenOCD target cfg
AXF/ELF path
artifact sha256
风险：启动后允许 halt/run/step/reset
TTL
owner Session
```

用户批准后生成本 DebugSession control lease。

同 session 内允许：

```text
run
pause
step
breakpoint
watchpoint
inspect
reset-halt
```

不重复确认。

重新要求批准：

```text
flash 新固件
artifact hash 变化
backend/target/interface 变化
危险 memory write
```

## 10.2 参考 flash approval，但不要混 store

新建：

```text
src/application/debug/debug-approval-service.mjs
```

参考 `flash-approval-service.mjs` 的：

```text
TTL
requestId
session scope
consume once
max items
purgeExpired
```

不要直接让 FlashApproval record 支持 `kind=debug`，避免不同安全语义耦合。

## 10.3 UI approval card

建议放：

```text
调试 → 运行调试
```

而非上位机。

Agent 发起 start：

```text
Host 建 request
→ Browser event/state 显示确认卡
→ user approve
→ runtime.start()
→ Agent 收到完成通知
```

用户自己点“开始调试”可同样走确认卡，保持一套业务逻辑。

---

# 11. Phase 7：Browser Runtime Debug UI

## 11.1 修改 `src/ui/workspace/corn-route.mjs`

当前 `DEBUG_SECTIONS` 增加：

```js
RUNTIME: 'runtime'
```

`routeForKind()`：

```text
debug
breakpoint
watchpoint
snapshot
debug-event
→ DEBUG_SECTIONS.RUNTIME
```

`targetOf()` 扩展 Runtime identifiers。

## 11.2 修改 `src/ui/workspace/debug-workspace.mjs`

当前：

```text
WorkbenchPage
ProjectPage
```

新增：

```js
const RuntimePage = createRuntimePage(React, t, post)
```

`labels`：

```text
WORKBENCH → 工作台
PROJECT   → 工程
RUNTIME   → 运行调试
```

`sections` 顺序建议：

```text
WORKBENCH, PROJECT, RUNTIME
```

不要把 Runtime 设默认页。

## 11.3 新建 `src/ui/debug/runtime/runtime-controller.mjs`

把 RPC/事件处理从 React view 拆出去。

职责：

```text
getState()
command(op,payload)
waitEvents(cursor, signal)
```

不持有 DOM。

## 11.4 新建 `use-debug-events.mjs`

算法：

```text
mount
 → debug/state
 → cursor = state.eventCursor
 → long-poll debug/events/wait
 → apply events
 → immediately wait next

identity/session/cwd change
 → abort previous controller
 → reset cursor/state

unmount
 → abort
```

必须复制/复用 `latest-request-gate` 的“旧 identity 不得回写新页面”原则。

## 11.5 UI 初版布局

```text
┌────────────────────────────────────────────────────────┐
│ target/backend/status              Run Pause Step Reset│
├──────────────────┬─────────────────────────────────────┤
│ Call Stack       │ Program Graph / Source              │
│                  │                                     │
├──────────────────┼─────────────────────────────────────┤
│ Break/Watch      │ Variables / Watches / Registers     │
├──────────────────┴─────────────────────────────────────┤
│ Debug Timeline                                         │
└────────────────────────────────────────────────────────┘
```

V1 不需要可拖拽 IDE panel。

保持布局确定性，减少复杂度。

## 11.6 `debug-toolbar.mjs`

按钮状态由 Host state 决定：

```text
idle     → Start
starting → disabled
paused   → Run / Step / Reset
running  → Pause
failed   → Stop / Restart
```

UI 不自己推断 session state transition。

## 11.7 `stack-panel.mjs`

点击 frame：

```text
Host command inspect(frame)
→ variables panel 切换 frame locals
→ source/program graph focus location
```

## 11.8 `variables-panel.mjs`

V1 分：

```text
Locals
Watches
Registers（折叠）
```

禁止每 100ms refresh。

刷新时机：

```text
stopped
selected frame changed
manual refresh
```

## 11.9 `breakpoint-panel.mjs`

支持：

```text
file:line
function
删除
启停（若 backend 支持）
```

Watchpoint：

```text
expression
write/read/access
```

Cortex-M 硬件 watchpoint 资源不足错误要原样映射为 domain error，例如：

```text
DEBUG_WATCHPOINT_RESOURCE_EXHAUSTED
```

## 11.10 Debug Timeline

不要复制监控 Journal。

Runtime 页只展示当前 DebugSession ring：

```text
run
pause
breakpoint hit
watchpoint hit
snapshot
exception
```

持久化的重要事件仍写现有 Journal。

---

# 12. Phase 8：Debug Snapshot + Journal + Evidence

## 12.1 Snapshot capture 策略

命中 breakpoint/watchpoint/exception 时：

```text
1. 当前 stop location
2. stack（默认最多 16/32 frames）
3. frame 0 locals
4. 用户 watch expressions
5. selected globals（可配置）
6. firmware hash
7. source context（可选，限制行数）
```

不要自动读取：

```text
全部 RAM
全部全局变量
全部 register bank 历史
```

## 12.2 Evidence

扩展现有 evidence kind：

```text
debug_snapshot
```

Evidence ref 至少：

```text
snapshotId
debugSessionId
reason
file
line
firmwareHash
timestamp
```

## 12.3 Journal

新增 journal/task event type/summary：

```text
debug start
debug stop
breakpoint hit
watchpoint hit
exception
snapshot created
verify pass/fail
```

不要把每一次普通 step 持久化到长期 Journal，避免噪声。

建议：

```text
短期 DebugEventRing：所有 step/run/pause
长期 Journal：关键事件
Evidence：诊断快照
```

## 12.4 Agent output contract

`corn_debug inspect/snapshot` 返回 compact summary：

```text
location
reason
stack top N
relevant variables
snapshotId
```

Agent 若需要完整结构再用：

```text
snapshot get <id>
```

避免单次 tool 返回巨大对象。

---

# 13. Phase 9：ProgramModel — 从当前 Keil Map 升级为程序级模型

**这一阶段不要阻塞 Hardware Debug V1。**

## 13.1 新建 `src/domain/program/program-model.mjs`

Canonical Model：

```text
ProgramModel
├─ project
├─ target
├─ files[]
├─ symbols/functions[]
├─ variables[]
├─ callEdges[]
├─ includeEdges[]
├─ readEdges[]
├─ writeEdges[]
├─ conditions[]
├─ tasks/interrupts[]   # 可后续
└─ metadata
```

ID 必须稳定：

```text
file:<normalized-rel-path>
fn:<file>:<name>:<line>
var:<scope>:<name>
```

不要用数组 index 作为长期 ID。

## 13.2 当前 `keilMap` contract 不直接删除

提供：

```text
legacy project map DTO
       ↓
ProgramModel builder
```

`corn_bench map` 先保持旧 compact result。

Browser Project page 可以逐步改读新的 `program/map` RPC，但不需要一次切换。

## 13.3 Tree-sitter 引入策略

先做 Windows packaging spike。

优先目标：

```text
无 node-gyp 安装要求
无常驻 parser process
```

优先考虑 WASM 形态。

若选 WASM：

```text
runtime/assets/tree-sitter-c.wasm
```

必须：

- 固定版本；
- 带 LICENSE；
- 加入 package `files`；
- 增加 package contents test；
- parser init failure 有 fallback/error，不 crash Host。

## 13.4 分析能力按顺序做

不要一次尝试“全 C 语义”。

顺序：

```text
1 function definitions
2 call expressions
3 assignments
4 identifier reads/writes
5 if/switch condition refs
6 globals/static variables
7 function pointers（后续，标 uncertain）
8 macro expansion（交给 Clang 后期）
```

每条 edge 带：

```text
confidence: exact | parsed | inferred | unresolved
source location
```

## 13.5 函数调用图不等于运行因果图

明确两个 model：

```text
StaticProgramGraph
RuntimeExecutionOverlay
```

Agent/Browser组合，不要把 runtime edge 永久写进静态 source graph。

---

# 14. Phase 10：重构现有 Project Graph，为 Runtime Overlay 复用

当前 graph model/layout/view 已很好，不重写。

## 14.1 抽共享基础，不做“大一统 Graph Framework”

建议抽：

```text
src/ui/debug/graph/
├── graph-camera.mjs
├── graph-svg-primitives.mjs
└── graph-focus.mjs
```

从当前：

```text
project-graph-layout.mjs
project-graph-view.mjs
```

只抽：

```text
pan/zoom
fit
focus transform
common edge marker
```

Project-specific cluster layout 继续留在 project。

## 14.2 Runtime Program Graph

新建：

```text
src/ui/debug/runtime/runtime-program-graph.mjs
```

输入：

```text
ProgramGraph DTO
+
RuntimeOverlay
```

RuntimeOverlay：

```js
{
  activeFunctionId,
  activeNodeIds,
  activeEdgeIds,
  breakpointNodeIds,
  watchpointHitNodeId,
  exceptionNodeId,
  valuesByNodeId,
}
```

## 14.3 不因每次 Step 重 layout

只有以下变化重新 layout：

```text
project/target 改变
source graph 改变
filter/graph mode 改变
```

以下只改 class/overlay：

```text
PC
stack
breakpoint hit
watchpoint hit
variable value
```

---

# 15. Phase 11：Archify 集成 — 只作为嵌入式能力

## 15.1 第一阶段不依赖 Archify Viewer

不要：

```text
archify preview
iframe
独立 HTML shell
```

## 15.2 新建 Adapter

```text
src/infrastructure/archify/archify-adapter.mjs
```

接口：

```js
programModelToArchify(programModel, options)
debugStoryToArchify(events, snapshots)
programDeltaToArchify(before, after)
```

## 15.3 优先吸收 3 个能力

### A. Path / upstream / downstream

如果 Archify 算法可作为模块稳定调用，则 wrapper；否则在 Corn canonical graph 上实现等价图遍历。

注意这里图遍历很小，不必为了“避免造轮子”强依赖整个 viewer。

### B. Guided Debug Story

输入：

```text
DebugEvent + Snapshot + Agent conclusion
```

输出步骤：

```text
enter LowLoad
→ timer condition true
→ watchpoint hit
→ eev_target 126 → 0
→ root cause
```

### C. Before / Delta / After

用于修复验证：

```text
before ProgramModel/runtime evidence
change set
after ProgramModel/runtime evidence
```

## 15.4 依赖形态

优先：

```text
embedded Node module / vendored pinned source
```

而不是 child process。

如果 Archify 当前没有稳定 library export：

```text
src/infrastructure/archify/archify-runtime.mjs
```

作为唯一隔离层。

Corn 其他模块禁止 deep import Archify 私有文件。

## 15.5 package / license

若 vendoring：

```text
third_party/archify/
LICENSES/archify-MIT.txt
```

`package.json files` 必须显式包含。

---

# 16. Phase 12：Keil Simulator Backend

必须在 GDB/OpenOCD backend + Domain/UI 稳定后做。

## 16.1 新增 Settings capability

Debug backend：

```text
Hardware / GDB + OpenOCD
Keil Simulator
```

Keil Simulator 只在：

```text
UV4 binding valid
project/target valid
```

时可选。

## 16.2 `uvsock-client.mjs`

严格按 Keil UVSOCK 官方协议建 Client。

层次：

```text
UVSOCK Native Message
       ↓
KeilUvSockClient
       ↓
KeilSimBackend
       ↓
Corn Debug Domain
```

不要让 Domain 出现 UVSOCK opcode。

## 16.3 UV4 lifecycle

```text
DebugSession start
→ spawn UV4 hidden / socket enabled
→ wait UVSOCK connect
→ enter debug/simulator
→ ready
```

stop：

```text
stop debug
→ close socket
→ terminate UV4 process tree
```

## 16.4 Simulator scenario

后续支持：

```text
Debug INI / Signal Function
```

由 Corn 生成 scenario file，而不是自己模拟 ADC/UART。

新增：

```text
src/infrastructure/debug/keil/debug-script-builder.mjs
```

输入是安全结构化 scenario，不允许 Agent 直接自由拼任意 Keil debug script 后执行。

---

# 17. Phase 13：Verify 闭环

当前 README 明确尚未实现 verify。

DebugRuntime 稳定后再做。

## 17.1 新建 Verify Domain

```text
src/domain/verify/
├── scenario.mjs
├── assertion.mjs
└── result.mjs
```

Application：

```text
src/application/verify/verify-service.mjs
```

## 17.2 Assertion 类型

```text
debug.expression
modbus.point
no.exception
no.alarm
range
changed
stable-for-duration
```

例如：

```yaml
scenario: low-load-eev-min
assertions:
  - type: debug.expression
    expr: eev_target
    op: '>='
    value: 80
  - type: modbus.point
    pointId: eev-opening
    op: '>='
    value: 80
  - type: no.exception
```

## 17.3 Agent 自动验证

```text
修改
→ build
→ flash approval
→ debug start
→ 复现场景
→ assertions
→ PASS/FAIL
→ Evidence
```

Verify 失败不得自动宣布修复成功。

---

# 18. 关键代码行级修改清单

> 行号是基线提交附近的定位参考；执行时以 **symbol + context** 为主。

## `host.js`

### 当前锚点：`apply(ctx, config)`，约 L130-L230

修改：

```text
1. import cornDebugTool
2. import get/stopDebugRuntime
3. role=agent：注册第二个 corn_debug tool
4. Host init：DebugRuntime 不必 eager spawn 外部进程，但应初始化 singleton/service
5. dispose：先 stop DebugRuntime，再 stop I/O worker
6. 仍只注册一个 /dsh-corn-bench/command HTTP route
```

禁止：

```text
ctx.webServer.register('/debug/...') for browser
```

Browser Debug 走 Connection RPC。

---

## `src/shared/corn-rpc-contract.mjs`

### 当前锚点：`CORN_HTTP_TO_RPC`

新增：

```text
debug/state
debug/command
debug/events/wait
debug/approval（可选）
```

测试 `CORN_RPC_ENDPOINTS` 自动包含。

---

## `src/interfaces/rpc/corn-rpc-router.mjs`

### 当前锚点：`createCornRpcRouter()` / `dispatch()`

修改顺序：

```text
1 touchSessionFromPayload 保留
2 normalize body 保留
3 if endpoint startsWith debug/ → delegate debugRpcHandler
4 旧 switch 原样保留
```

不要在旧 switch 新增十几个 debug cases。

---

## `src/ui/workspace/corn-route.mjs`

### 当前锚点：`DEBUG_SECTIONS`

新增：

```js
RUNTIME: 'runtime'
```

### 当前锚点：`targetOf(req)`

新增 Runtime ids。

### 当前锚点：`focusKindOf()`

新增 debug kinds。

### 当前锚点：`routeForKind()`

Debug event → Runtime section。

### 当前锚点：routeKey array

加入：

```text
debugSessionId
snapshotId
breakpointId/watchpointId
```

避免不同 Debug focus 被去重成同一 navigation event。

---

## `src/ui/workspace/debug-workspace.mjs`

### 当前约 L1-L65

新增 import：

```js
createRuntimePage
```

新增：

```js
const RuntimePage = ...
```

`labels/sections/render` 增第三项。

保持：

```text
initialSection()
navigate()
subscribeNav()
```

统一逻辑，不另建 Runtime navigation store。

---

## `src/ui/common/state-subscription.mjs`

**不把 Debug event 塞这里。**

仅可能在 state snapshot 增轻量 debug capability。

新增 `use-debug-events.mjs` 独立实现实时流。

---

## `bench-tool.mjs`

### 当前锚点：`ACTIONS` 和 `cornBenchTool()` schema

不新增 Debug action。

只在描述中最多加一句：

```text
Firmware runtime debug 使用 corn_debug。
```

所有 debug schema 在新 tool 文件。

---

## `src/application/commands/corn-command-router.mjs`

当前 `ACTIONS` 保持业务范围。

不加 `debug.*`。

新增 Host-level router，不污染这个 router。

---

## `src/infrastructure/host/corn-host-client.mjs`

### 当前锚点：`tryHostHttp()`

复用，不复制。

### 当前锚点：`dispatchCornCommand()`

重构成：

```text
dispatchHostCommand()  # generic transport
  ├ dispatchCornCommand()
  └ dispatchCornDebugCommand()
```

HTTP body 已有 action/payload，足够支持 `debug.*`。

---

## `bench-keil.mjs`

### 当前锚点：全文件

逐步 facade 化。

最终不 import：

```text
runPythonScript
```

改 import application/keil services。

---

## `bench-run.mjs`

保留：

```text
runExecFile
killProcessTree
```

Phase 1 删除 Python 后：

```text
SCRIPTS
pythonArgv
runPythonScript
```

若完全无 caller，则删；测试同时删/迁。

不要把 Debug 的长生命周期 GDB 用 `execFile()`；用新 spawn managed process。

---

## `src/infrastructure/process/openocd-runner.mjs`

继续只负责 flash one-shot。

不要强改成同时支持 Debug 形成分支地狱。

共享的：

```text
profile resolution
identity probe
safe encoding helpers
```

可下沉到公共 OpenOCD infrastructure 文件后由两个 runner import。

---

## `src/ui/debug/project/project-graph-model.mjs`

保持现有 ProjectFile graph contract。

后续可增加 adapter：

```js
programGraphToProjectGraph(...)
```

但不要让现有 `buildProjectGraph()` 同时承担 file graph + function graph + runtime graph 三套语义。

---

## `src/ui/debug/project/project-graph-layout.mjs`

保留 Project cluster layout。

只抽 camera/focus utility。

Runtime Function Graph 可有不同 layout strategy。

---

## `src/ui/debug/project/project-graph-view.mjs`

复用交互习惯：

```text
pan
zoom
fit
keyboard
focus
```

不要直接把 Runtime overlay 状态硬编码进这个 Project-specific component。

---

## `package.json`

阶段性修改：

Phase 1：

```text
+ pure JS XML parser
- Python runtime files（最终）
```

Phase 9：

```text
+ Tree-sitter/WASM dependency or packaged asset（spike 通过后）
```

Phase 11：

```text
+ Archify embedded dependency / vendored files（仅确认 library boundary 后）
```

每次改 `files` 都必须更新 package-contents tests。

---

# 19. 进程模型最终要求

## Idle

```text
dsh web Host
Browser
Corn I/O Worker（仅连接需要时，按现状）
```

Archify：0 额外进程。  
Program parser：0 额外进程。  
Debug：0 额外进程。

## Build

```text
Host → UV4.exe（临时） → exit
```

## Flash

```text
Host → OpenOCD（一次性 program verify reset exit） → exit
```

## Hardware Debug

```text
Host
 ├→ OpenOCD（DebugSession 生命周期）
 └→ arm-none-eabi-gdb（DebugSession 生命周期）
```

## Keil Simulator

```text
Host → UV4.exe / µCorn Debugger（DebugSession 生命周期）
```

目标不是“只有一个 OS process”，而是：

> **只有 Harness Host 持有长期产品状态；调试器只是可回收 Session worker。**

---

# 20. Debug 安全 / 并发 /失败语义

必须新增错误码：

```text
DEBUG_BACKEND_UNAVAILABLE
DEBUG_GDB_NOT_FOUND
DEBUG_OPENOCD_NOT_FOUND
DEBUG_OPENOCD_START_FAILED
DEBUG_GDB_START_FAILED
DEBUG_TARGET_BUSY
DEBUG_SESSION_NOT_FOUND
DEBUG_SESSION_NOT_OWNER
DEBUG_INVALID_STATE
DEBUG_COMMAND_TIMEOUT
DEBUG_COMMAND_REJECTED
DEBUG_BREAKPOINT_FAILED
DEBUG_WATCHPOINT_FAILED
DEBUG_WATCHPOINT_RESOURCE_EXHAUSTED
DEBUG_EVALUATE_FAILED
DEBUG_TARGET_DISCONNECTED
DEBUG_RUNTIME_CRASHED
DEBUG_APPROVAL_REQUIRED
DEBUG_APPROVAL_EXPIRED
DEBUG_ARTIFACT_CHANGED
```

要求：

- 不使用一个 `DEBUG_FAILED` 吞掉全部错误；
- raw stderr 可作为 details tail，但 Agent/UI 主逻辑看 errorCode；
- GDB/OpenOCD crash 必须 transition session → failed 并 release lease；
- artifact hash 与 approval/start 时不一致，fail closed；
- Session ownership mismatch 不得 stop/continue 他人的 target。

---

# 21. 测试体系要求

每个 Phase 都要加入 test，不允许最后统一补。

## Unit

```text
Domain state
Lease
Event ring
Snapshot normalize
MI parser
MI stop mapping
Keil XML parsing
Build log parse
Program graph ids
```

## Contract

```text
Browser RPC path mapping
Agent debug tool schema
Host command route
Session ownership
Abort propagation
Package contents
```

## Integration with fakes

Fake GDB MI process：

```text
Node fixture child
读 stdin MI command
输出预设 MI response
```

这样可测试真实 `spawn + parser + pending request`，无需 STM32。

Fake OpenOCD：

```text
输出 Listening on port...
等待信号
```

## Windows acceptance

新增：

```text
docs/WINDOWS_ACCEPTANCE_DEBUG_0.xx.md
```

必须实机测试：

```text
Windows 10/11
ST-Link
一个 STM32 工程
OpenOCD
arm-none-eabi-gdb
UV4 build
```

验收场景：

```text
1 Start Debug
2 break main
3 run → hit
4 step over
5 locals
6 evaluate global
7 write watchpoint
8 run → hit
9 stack
10 snapshot
11 stop
12 无遗留 GDB/OpenOCD/UV4 子进程
13 第二次 start 正常
14 Agent Session A / Session B ownership 测试
```

---

# 22. CI / Quality Gate

现有：

```text
build:check
lint
typecheck
deps:check
test:coverage
pack:check
```

继续全部保留。

建议新增 dependency-cruiser 规则：

```text
ui -> application/infrastructure 禁止直接跨 Host-only modules

domain/debug -> infrastructure 禁止

domain/program -> archify 禁止

interfaces/agent -> gdb/openocd 禁止
```

新增架构 test：

```text
Agent tool cannot import debug backend
Browser client cannot import node:child_process
Program domain cannot import Archify
```

---

# 23. 推荐 commit / PR 切分

严禁一个“feat: add AI debugger”几千行 PR。

推荐：

```text
PR 1  docs: debug/runtime architecture ADRs
PR 2  refactor(keil): native node uvprojx parser
PR 3  refactor(keil): native node UV4 build runner
PR 4  feat(debug): add domain runtime and lease models
PR 5  feat(debug): add GDB/MI parser and client
PR 6  feat(debug): add OpenOCD hardware debug backend
PR 7  feat(debug): add Connection RPC debug transport
PR 8  feat(debug): add corn_debug agent tool
PR 9  feat(debug-ui): add runtime workspace
PR 10 feat(debug): snapshots journal and evidence
PR 11 feat(program): canonical ProgramModel
PR 12 feat(program): parser-backed call/data graph
PR 13 feat(debug-ui): runtime graph overlay
PR 14 feat(archify): path/story/delta adapter
PR 15 feat(debug): Keil simulator backend
PR 16 feat(verify): debug + telemetry verification loop
```

每个 PR：

```text
npm run quality
```

必须绿色才能进下一阶段。

---

# 24. 执行 Agent 工作规则

把本节直接作为实现 Agent 的操作约束。

1. **先读再改。** 每个 Phase 开始前重新读取计划列出的锚点文件，不依据旧记忆改代码。
2. **以当前 main 为准。** 行号只是基线定位；symbol/context 才是稳定锚点。
3. **每次只做一个 Phase/PR。** 不跨阶段偷偷提前做 UI、Tree-sitter、Archify。
4. **不破坏既有 RPC。** 旧 Browser path、`corn_bench` action 和 result contract 保持兼容，除非该 Phase 明确写了迁移。
5. **不新增长期服务。** 新功能优先 Host 内 module；GDB/OpenOCD/UV4 只能按 session spawn。
6. **不让 Agent 接触原始调试协议。** Raw MI/UVSOCK/OpenOCD 只在 infrastructure。
7. **Domain 无基础设施依赖。** `src/domain/debug` 不能 import `child_process/net/fs/GDB/OpenOCD`。
8. **ProgramModel 不依赖 Archify。** 只能 ArchifyAdapter 依赖 ProgramModel。
9. **所有长操作贯穿 AbortSignal。** 复制当前 RPC cancel 的成功经验。
10. **所有子进程可回收。** Error / timeout / abort / plugin dispose 路径都必须有 test。
11. **不要扩大普通 `/state`。** 高频 Debug event 单独 long-poll。
12. **不要重写 ProjectGraph。** 先复用现有 model/layout/view，再最小抽共享能力。
13. **不做 silent fallback。** Debug backend 不可用时返回明确 errorCode，不退回假的模拟数据。
14. **真机高影响动作 fail closed。** Session ownership、approval、artifact hash 不确定时不执行。
15. **修改完必须更新 README/ADR/Windows acceptance。**

---

# 25. 第一轮最小可交付版本（建议定义为 Debug MVP）

若希望最快得到可用价值，第一轮只做到：

```text
Phase 0
Phase 1
Phase 2
Phase 3
Phase 4
Phase 5
Phase 6
Phase 7
Phase 8
```

即：

```text
Node 化 Keil Python bridge
+
GDB/OpenOCD Hardware Debug
+
corn_debug Agent tool
+
Harness 原生 Runtime Debug UI
+
Breakpoint/Watchpoint/Stack/Variables
+
Debug Snapshot/Evidence
```

暂不做：

```text
Tree-sitter ProgramModel
Archify
Keil Simulator
Verify
```

此 MVP 已能支持真实价值场景：

```text
用户：为什么 eev_target 突然变成 0？

Agent：
corn_debug watchpoint eev_target write
→ run
→ watchpoint hit
→ snapshot
→ stack/source/locals
→ 给出真正写入位置和触发条件
```

这是最值得先完成的闭环。

---

# 26. 第二轮：Program Graph + Runtime Overlay

在 Debug MVP 稳定后：

```text
ProgramModel
→ Function/Call/Read/Write
→ Runtime active stack overlay
→ breakpoint/watchpoint projection
```

目标效果：

```text
Sensor
  ↓
SuperheatCalc
  ↓
PID          pid_output=126
  ↓
LowLoad      ← PC / WATCHPOINT HIT
  │
  │ 126 → 0
  ↓
EEV Target   0
```

真正区分：

```text
静态代码关系
+
动态 CPU 证据
```

---

# 27. 第三轮：Archify + Verify + Keil Simulator

Archify 最终承担：

```text
复杂路径解释
upstream/downstream
Debug Story
Before / Delta / After
```

Corn 自己承担：

```text
Harness UI
实时 overlay
Agent focus
Runtime controls
Snapshot
Timeline
```

Keil Simulator 最终只是第二个 Backend：

```text
Debug Domain
 ├ GDB/OpenOCD Backend
 └ Keil Simulator Backend
```

上层 UI/Agent 不分叉。

---

# 28. 最终验收定义

只有同时满足下面条件，才能认为这次迭代真正完成，而不是“做了个 Debug 页面”。

## 架构

```text
[ ] Harness仍是唯一WebUI
[ ] Browser业务仍用Connection RPC
[ ] Host仍是唯一Debug state owner
[ ] Debug无独立长期server
[ ] Agent无直接GDB/OpenOCD访问
[ ] ProgramModel不依赖Archify
```

## 进程

```text
[ ] idle时无GDB/OpenOCD/UV4 Debug进程
[ ] session结束全部清理
[ ] crash/abort/timeout全部清理
[ ] 无 orphan process
```

## Debug

```text
[ ] start/stop
[ ] run/pause
[ ] step into/over/out
[ ] reset-halt
[ ] source breakpoint
[ ] function breakpoint
[ ] write watchpoint
[ ] stack
[ ] locals
[ ] expression evaluate
[ ] registers
[ ] memory read
[ ] stop reason
```

## Agent

```text
[ ] corn_debug 独立 tool
[ ] watchpoint→hit→snapshot 自动链可用
[ ] Session ownership严格
[ ] Snapshot可作为Evidence引用
```

## UI

```text
[ ] 调试内第三页“运行调试”
[ ] 命令响应低延迟，不依赖2s state poll
[ ] Agent focus可跳 Runtime
[ ] Runtime event不抢后台Session前台焦点
```

## Program / Archify（完整路线）

```text
[ ] ProgramModel canonical
[ ] Function call graph
[ ] basic read/write graph
[ ] Runtime overlay
[ ] Archify adapter隔离
[ ] Debug Story / Delta可用
```

## Verify（完整路线）

```text
[ ] 修复后可以自动复验
[ ] Debug assertion + Modbus assertion
[ ] PASS/FAIL 有Evidence
```

---

# 29. 本计划最关键的技术判断

不要把项目演进成：

```text
“自己重新做一个 Keil”
```

也不要演进成：

```text
“Harness 里 iframe 一个复杂 Debug IDE”
```

正确方向是：

```text
DeepSeek Harness 提供：
  会话 / Agent / WebUI / Cordis / Connection RPC

Corn 提供：
  嵌入式领域模型 / I/O / Debug orchestration / Evidence / Program causality

成熟工具提供：
  Keil build/simulator
  GDB source-level debug
  OpenOCD target/probe access

Archify 提供：
  可选的结构解释 / path / story / delta 能力
```

最终产品的真正差异化应是：

```text
Source Code
    ↕
CPU Runtime
    ↕
Physical Telemetry
    ↕
Agent Reasoning
    ↕
Evidence / Verify
```

而不是“换了一个更漂亮的 Keil 界面”。

---

# 30. 外部实现参考（只用于研究，不作为硬依赖）

执行相关阶段时可研究：

```text
GNU GDB 官方 GDB/MI 文档
OpenOCD 官方 Server / Tcl / GDB 配置文档
Keil 官方 UVSOCK / µCorn Debug Command 文档
Marus/cortex-debug
phryniszak/stmcp
ARMmbed/DAPjs（只用于长期纯Node probe研究，不用于V1）
tt-a1i/archify
```

原则：

> 参考协议处理、进程生命周期和边界设计；不要复制大型第三方 debugger 代码进入 Corn。

