# dsh-corn-bench Debug Stabilization & Integration Hardening 修复计划

> 适用仓库：`xingyingyuzhui/dsh-corn-bench`  
> 基线：当前 `main`（review 时 HEAD：`846d623989c8a3e9cc164f16e6de57a208cccf32`）  
> 目标版本建议：`0.27.x`  
> 文档用途：交由实现 Agent 直接执行；本计划优先处理 Debug/Simulator/Verify 的正确性，不继续扩展新功能。  
> 核心原则：**先修真实链路，再补功能；Host 是唯一权威；Backend 不拥有产品状态；不伪造协议；不把外部工具逻辑重复重写。**

---

# 0. 本轮修复目标

当前工程的目录分层、Debug Domain、GDB/MI Backend、RPC、Agent Tool、Runtime UI、ProgramModel、Keil Simulator、Verify 等主体结构已经铺设完成，但真实集成层仍存在阻塞级问题。

本轮不再增加新业务能力，集中完成以下目标：

1. 建立 **DebugRuntime 单一权威状态源**。
2. 修正 GDB/MI 异步执行、暂停、单步、断点、观察点语义。
3. 统一 Backend Event → Runtime State → Canonical DebugEvent。
4. 修正 UI 使用错误事件名导致的状态不刷新问题。
5. 建立 `ResolvedDebugLaunchSpec`，让 Agent 不需要知道本机路径即可启动调试。
6. 严格化 Session ownership、TargetLease、Approval。
7. 为 OpenOCD 分配动态 GDB 端口，避免多会话端口冲突。
8. 真正跑通 Windows + STM32 + OpenOCD + GDB 实机链。
9. 删除当前错误的自定义 Keil UVSOCK wire protocol，按真实 UVSC/UVSOCK ABI 重做。
10. 让插件能够自行启动临时 µCorn/UV4 实例并通过 Socket 控制，不要求用户操作 Keil UI。
11. 将 C 源码分析从正则主路径升级为 AST 主路径。
12. 收紧 Archify Adapter 边界。
13. 把 Verify 从“内部 library”接成真实可用闭环。
14. 更新 README、Acceptance、ADR，禁止未验收能力宣称为 stable。

---

# 1. 明确的 Release Blocker

以下问题未修复前，不允许把 Debug / Keil Simulator / Verify 标记为 stable，也不建议发布正式版本。

## P0-1：DebugRuntime 与 Backend 双状态源

现状：

- `src/application/debug/debug-runtime.mjs` 保存：
  - `session.state`
  - `session.location`
  - `session.stack`
  - `session.variables`
- `src/infrastructure/debug/gdb-mi/gdb-backend.mjs` 又保存：
  - `this.state`
  - `this.currentLocation`
- GDB `*stopped` 只更新 Backend 自身状态并写 EventRing。
- Runtime 的状态没有被同步更新。
- UI/RPC/Agent 的 `state()` 又读取 Runtime 状态。

结果：

```text
真实 GDB:
paused @ LowLoadControl.c:438

Backend:
state=paused
location=LowLoadControl.c:438

DebugRuntime:
state=running
location=old/null

UI / Agent:
读取到错误状态
```

必须改成单向数据流：

```text
GDB/UVSC Native Event
        ↓
DebugBackendEvent
        ↓
DebugRuntime.reduceBackendEvent()
        ↓
authoritative session state
        ↓
Canonical DebugEvent
        ↓
RPC / Agent / UI
```

Backend 不允许直接维护“对外产品状态”。

---

## P0-2：Step / Pause 完成时机错误

GDB MI：

```text
-exec-next
^running
...
*stopped,reason="end-stepping-range"
```

当前 Runtime 在 `backend.step()` 返回后立刻：

```text
state = paused
STEP_COMPLETE
```

这是错误的。

正确语义：

```text
step request
↓
Backend 发 -exec-next
↓
Runtime state = running
↓
等待 *stopped
↓
识别 reason=end-stepping-range
↓
Runtime state = paused
↓
STEP_COMPLETE
```

Pause 同理：

```text
-exec-interrupt
```

只是请求暂停，不应在命令返回时直接认为 Target 已稳定暂停。

---

## P0-3：Debug Event 名称不一致

Domain 当前定义：

```text
debug.running
debug.paused
debug.step.complete
debug.breakpoint.hit
debug.watchpoint.hit
debug.exception
debug.session.stopped
```

UI 当前判断：

```text
running
paused
step_complete
breakpoint_hit
watchpoint_hit
exception
session_stopped
```

GDB Backend 还发了：

```text
debug.stopped
```

导致 Browser 无法可靠刷新。

本轮必须：

- 禁止 UI 手写事件字符串。
- 统一共享 `DEBUG_EVENT_TYPES`。
- 删除 `debug.stopped` 这种未定义产品事件。
- Native StopEvent 只能进入 Runtime reducer。
- Runtime 决定输出：
  - `debug.paused`
  - `debug.step.complete`
  - `debug.breakpoint.hit`
  - `debug.watchpoint.hit`
  - `debug.exception`

---

## P0-4：Agent 无法自行解析 Debug Launch 参数

`corn_debug start` 不应要求 Agent 传：

```text
artifactPath
gdbBin
openocdBin
probe serial
interface cfg
target cfg
```

这些属于 Host 环境事实，不属于模型上下文。

必须新增：

```text
src/application/debug/debug-launch-spec-service.mjs
```

Host 根据：

- cwd
- workspace
- Keil target
- latest build artifact
- firmware hash
- bindings
- OpenOCD profile
- connected probe

解析出不可变：

```ts
ResolvedDebugLaunchSpec
```

Agent 只需要：

```json
{
  "action": "start"
}
```

或：

```json
{
  "action": "start",
  "backend": "gdb-openocd"
}
```

---

## P0-5：当前 Keil UVSOCK 协议实现错误

必须删除当前自定义的：

```text
10 byte header
JSON payload
0x01 ~ 0x10 opcode
```

真实 UVSC/UVSOCK 使用 Keil 定义的 C ABI / structures / enums。

至少包括：

```text
UV_PRJ_LOAD
UV_DBG_ENTER
UV_DBG_START_EXECUTION
UV_DBG_STOP_EXECUTION
UV_DBG_RESET
UV_DBG_STEP_HLL
UV_DBG_STEP_INTO
UV_DBG_STEP_OUT
UV_DBG_CALC_EXPRESSION
UV_DBG_MEM_READ
UV_DBG_CREATE_BP
UV_DBG_ENUM_STACK
UV_DBG_EXEC_CMD
UV_CMD_RESPONSE
UV_ASYNC_MSG
UV_DBG_CALLBACK
...
```

本轮禁止继续基于猜测补协议。

---

## P0-6：KeilSimBackend 未启动 UV4

目标是：

> 用户不操作 Keil UI，但允许插件临时拉起 Keil 核心进程。

正确流程：

```text
DebugRuntime.start
↓
KeilSimBackend.start
↓
spawn UV4.exe / UV4
↓
启用 UVSOCK 动态端口
↓
等待 socket ready
↓
连接 UVSC
↓
load project
↓
select target
↓
enter debugger
↓
确认 simulator backend
↓
paused-ready
```

当前 Backend 直接尝试 TCP connect，不负责拉起 UV4，必须修。

---

# 2. 修复总览

建议拆成 6 个 PR，不要一次性重写全部。

```text
PR-A  Debug Runtime Authority & Event Contract
PR-B  GDB/OpenOCD Launch / Ownership / Approval
PR-C  Real Hardware Validation
PR-D  Keil UVSC / Simulator Backend Rewrite
PR-E  ProgramModel / Archify Hardening
PR-F  Verify Productization & Documentation
```

依赖：

```text
PR-A
 ↓
PR-B
 ↓
PR-C

PR-A
 ↓
PR-D

PR-E 可与 PR-D 部分并行

PR-C + PR-D + PR-E
 ↓
PR-F
```

---

# 3. PR-A — Debug Runtime Authority & Event Contract

## 3.1 目标

让 `DebugRuntime` 成为唯一状态权威。

Backend 只负责：

- 启动外部调试器。
- 发送命令。
- 解析原生协议。
- 输出 Backend Event。
- 提供即时查询能力。

Backend 不负责：

- 对外 canonical event。
- Session state machine。
- Session ownership。
- product snapshot。
- UI 状态。

---

## 3.2 新增 Backend Event Contract

新增：

```text
src/domain/debug/backend-event.mjs
src/types/debug-backend.d.ts
```

建议定义：

```ts
type DebugBackendEvent =
  | {
      type: 'backend.running'
      threadId?: string
    }
  | {
      type: 'backend.stopped'
      reason:
        | 'breakpoint'
        | 'watchpoint'
        | 'step'
        | 'signal'
        | 'exception'
        | 'manual'
        | 'reset'
        | 'unknown'
      location?: SourceLocation
      nativeReason?: string
      breakpointNumber?: string
      watchpointNumber?: string
      threadId?: string
    }
  | {
      type: 'backend.console'
      stream: 'console' | 'target' | 'log'
      text: string
    }
  | {
      type: 'backend.exited'
      code?: number
      signal?: string
      unexpected: boolean
    }
  | {
      type: 'backend.error'
      code?: string
      message: string
      fatal?: boolean
    }
```

禁止 Backend 直接生成：

```text
debug.breakpoint.hit
debug.watchpoint.hit
debug.step.complete
```

这些由 Runtime reducer 生成。

---

## 3.3 DebugBackend 接口统一

建议新增：

```text
src/domain/debug/debug-backend-contract.mjs
```

或者只用 `.d.ts` 定义。

Backend 必须提供统一方法：

```ts
start(spec)
stop()

continue()
requestPause()

stepOver()
stepInto()
stepOut()

resetHalt()

addBreakpoint(bp)
removeBreakpoint(bp)

addWatchpoint(wp)
removeWatchpoint(wp)

stack(frame?)
locals(frame?)
registers()
evaluate(expr, frame?)
readMemory(address, length)

subscribe(listener)
```

禁止出现不同 Backend 自己扩展同义方法：

```text
pause / stopExecution / halt
run / continue
reset / resetHalt
```

Application 层只面向一套语义。

---

## 3.4 修改 GdbBackend

文件：

```text
src/infrastructure/debug/gdb-mi/gdb-backend.mjs
```

### 删除/降级

不要让：

```js
this.state
this.currentLocation
```

成为对外权威。

可保留内部 cache：

```js
this.nativeState
this.lastNativeLocation
```

但 Runtime 不读取它作为最终状态。

### 新增

```js
this.listeners = new Set()

subscribe(listener) {
  this.listeners.add(listener)
  return () => this.listeners.delete(listener)
}

_emit(event) {
  for (...) listener(event)
}
```

MI async：

```text
*running
→ backend.running

*stopped
→ backend.stopped
```

Stream：

```text
~"text"
@"target"
&"log"
→ backend.console
```

外部进程异常退出：

```text
→ backend.exited
```

---

## 3.5 修改 DebugRuntime

文件：

```text
src/application/debug/debug-runtime.mjs
```

新增内部方法：

```text
attachBackendEvents(session)
reduceBackendEvent(session, event)
refreshStoppedState(session, event)
```

建议状态：

```text
idle
starting
ready
running
pause-requested
stepping
paused
resetting
stopping
failed
```

如果现有 state machine 不想扩展太多，至少增加：

```text
running
paused
```

之外的 pending action：

```js
session.pendingExecution = null | {
  type: 'pause' | 'step' | 'reset'
  stepType?: 'over' | 'into' | 'out'
}
```

### continue

```text
Runtime:
transition paused/ready -> running
pendingExecution = null

Backend:
continue()

真正 *running 到来:
确认 running
```

### pause

```text
Runtime:
pendingExecution = { type: 'pause' }

Backend:
requestPause()

等待 backend.stopped
↓
reason manual
↓
state paused
↓
emit debug.paused
```

### step

```text
Runtime:
pendingExecution = {
  type: 'step',
  stepType
}
state = running

Backend:
step...

等待 backend.stopped
↓
若 pendingExecution.type === step
emit debug.step.complete
state paused
```

### breakpoint hit

Backend stop reason：

```text
breakpoint-hit
```

Runtime 生成：

```text
debug.breakpoint.hit
```

同时：

- 更新 location。
- 更新 hitCount。
- 可选自动 refresh stack/locals。
- 自动生成 lightweight stop context。
- 不要默认创建永久 Snapshot，避免过量。

### watchpoint hit

同上。

### exception

映射：

```text
SIGSEGV
SIGBUS
SIGILL
HardFault stop signature
...
```

输出：

```text
debug.exception
```

---

## 3.6 State Refresh Strategy

每次 `backend.stopped` 后执行：

```text
stack()
↓
top location
↓
locals(frame0)
↓
Runtime state commit
↓
canonical event
```

寄存器不建议每次自动全读，可以：

- UI展开 Registers 时拉。
- Snapshot 时拉。
- Agent inspect(include=registers) 时拉。

避免 MCU halt 后做太多同步查询拖慢交互。

---

## 3.7 Canonical Event 统一

修改：

```text
src/domain/debug/debug-event.mjs
src/shared/debug-contract.mjs
src/ui/debug/runtime/use-debug-events.mjs
```

UI：

```js
import { DEBUG_EVENT_TYPES } from '../../../domain/debug/debug-event.mjs'
```

如果 Browser bundling 不应依赖 domain 文件，则把 constant 移到：

```text
src/shared/debug-events.mjs
```

Host + UI 共同引用。

禁止 UI 内出现：

```js
if (type === 'paused')
```

只能：

```js
if (type === DEBUG_EVENT_TYPES.PAUSED)
```

---

## 3.8 Event cursor 修复

检查：

```text
createDebugEventRing.getEventsSince()
waitForEvents()
```

当前需要明确 cursor 语义：

```text
请求 cursor=N
返回 cursor >= N 还是 > N
```

建议采用：

```text
cursor 表示“客户端已经消费到的最后一个事件”
请求 afterCursor
返回 event.cursor > afterCursor
nextCursor = 最后返回 event.cursor
```

否则容易重复读取。

接口建议改：

```text
getEventsAfter(cursor)
waitForEventsAfter(cursor)
```

如果不想改 API 名字，则至少补测试覆盖：

- 第一次 cursor=0。
- 第二次传 nextCursor。
- 不重复事件。
- ring overflow 后给 `cursorExpired` 标志。

---

## 3.9 PR-A 测试要求

新增：

```text
test/debug-runtime-authority.test.mjs
test/debug-runtime-gdb-transcript.test.mjs
test/debug-event-contract.test.mjs
test/debug-event-cursor.test.mjs
```

模拟 transcript：

```text
^connected
*stopped,reason="breakpoint-hit"...
^running
*running
*stopped,reason="end-stepping-range"...
```

必须验证：

1. `runtime.state()` 永远与最后 native event 一致。
2. step 请求不会提前发 `debug.step.complete`。
3. breakpoint 命中后 location 已更新。
4. UI event reducer 能识别全部 canonical event。
5. Event cursor 不重复不丢失。

---

# 4. PR-B — Debug Launch / Session / Approval / TargetLease

## 4.1 新增 Debug Launch Spec Service

新增：

```text
src/application/debug/debug-launch-spec-service.mjs
src/types/debug-launch.d.ts
```

定义：

```ts
type ResolvedDebugLaunchSpec = {
  backend: 'gdb-openocd' | 'keil-simulator'

  workspaceCwd: string
  ownerSessionId: string

  artifact: {
    path: string
    sha256: string
    format: 'elf' | 'axf'
    mtimeMs: number
  }

  toolchain: {
    gdbBin?: string
    openocdBin?: string
    uv4Bin?: string
  }

  target: {
    openocdInterface?: string
    openocdTarget?: string
    probeSerial?: string
    keilProjectPath?: string
    keilTargetName?: string
  }

  transport: {
    gdbPort?: number
    uvsockPort?: number
  }
}
```

---

## 4.2 Resolve Algorithm

输入：

```ts
resolveDebugLaunchSpec({
  home,
  cwd,
  sessionId,
  backend
})
```

逻辑：

### GDB/OpenOCD

1. load workspace。
2. 找当前 Keil project/target。
3. 找最新成功 build artifact。
4. 只接受：
   - `.axf`
   - `.elf`
5. 重新计算 sha256。
6. 检查 artifact 是否仍在 workspace/known output 路径。
7. 从 bindings 获取：
   - OpenOCD。
   - GDB。
8. 从 workspace / flash profile 获取：
   - interface。
   - target。
9. 获取 probe identity。
10. 分配动态 GDB port。
11. 返回 immutable launch spec。

### Keil Simulator

1. project path。
2. target name。
3. `uv4` binding。
4. 分配动态 UVSOCK port。
5. optional artifact hash。
6. 不需要 OpenOCD/GDB。

---

## 4.3 Agent Tool Schema 简化

文件：

```text
src/interfaces/agent/corn-debug-tool.mjs
```

`start` 最多暴露：

```text
backend
```

以及可选：

```text
target
```

但不允许 Agent 传：

```text
gdbBin
openocdBin
uv4Bin
artifactPath
probeSerial
gdbPort
uvsockPort
```

这些由 Host 决定。

---

## 4.4 Session Ownership 修复

所有 Debug Session 查找必须：

```text
ownerSessionId === callerSessionId
```

如果同时传 cwd，则：

```text
ownerSessionId === callerSessionId
&& workspaceCwd === callerCwd
```

禁止：

```text
session match || cwd match
```

修改：

```text
src/application/debug/debug-command-service.mjs
src/interfaces/rpc/debug-rpc-handler.mjs
src/application/debug/debug-runtime.mjs
```

新增公共方法：

```js
runtime.findOwnedSession({
  ownerSessionId,
  workspaceCwd
})
```

禁止各调用方自己写 predicate。

---

## 4.5 Approval 统一

当前必须形成：

```text
Launch Spec
↓
Approval Ticket
↓
consume
↓
Debug Control Lease
↓
Runtime.start
```

Agent和 UI 不允许有两套启动语义。

新增：

```text
src/application/debug/debug-start-service.mjs
```

作为唯一业务入口：

```ts
requestDebugStart(...)
approveDebugStart(...)
rejectDebugStart(...)
```

`debug-rpc-handler.mjs` 和 `debug-command-service.mjs` 均调用它。

---

## 4.6 删除 `payload.approved`

禁止客户端通过：

```json
{
  "approved": true
}
```

跳过 approval。

只认：

```text
approvalRequestId
```

且 ticket 必须绑定：

- ownerSessionId
- workspaceCwd
- backend
- artifact sha256
- target
- probe serial / target key
- expiresAt

审批后如果 artifact hash 改变：

```text
APPROVAL_STALE
```

必须重新批准。

---

## 4.7 TargetLease 修复

文件：

```text
src/domain/debug/target-lease.mjs
```

硬件 identity 优先级：

```text
probeSerial
>
stable probe path/id
>
interface-level conservative global lock
```

不要把 cwd 当物理 Target identity。

建议：

```text
strong:
gdb-openocd:<probeSerial>

medium:
gdb-openocd:<adapterPath>

weak:
gdb-openocd:<interfaceName>:GLOBAL
```

Simulator：

```text
keil-simulator:<workspaceCwd>:<target>
```

可以按工程独占。

---

## 4.8 动态端口服务

新增：

```text
src/infrastructure/network/loopback-port.mjs
```

API：

```js
reserveLoopbackPort()
releaseLoopbackPort()
```

不要简单：

```text
find free port
close socket
then OpenOCD bind
```

如果可行，应在启动阶段快速占用 / retry。

至少：

```text
attempt random ephemeral
spawn OpenOCD
bind failed
retry N times
```

不要继续固定 `3333`。

---

## 4.9 PR-B 测试

新增：

```text
test/debug-launch-spec.test.mjs
test/debug-session-ownership.test.mjs
test/debug-approval.test.mjs
test/debug-target-lease.test.mjs
test/debug-port-allocation.test.mjs
```

必须覆盖：

- 同 cwd，Session A/B 不串。
- 同 probe，不同 cwd 不能同时拿 lease。
- artifact hash 改变后旧 approval 失效。
- Agent不能通过 `approved=true` 绕过。
- 两个不同 probe 可获得不同动态 GDB port。

---

# 5. PR-C — Windows + STM32 实机链验收

这一阶段不是“自动化测试通过”即可。

必须在真实：

```text
Windows 10 / 11
STM32
ST-Link 或实际使用的 SWD probe
OpenOCD
arm-none-eabi-gdb
```

上执行。

---

## 5.1 测试固件

准备最小专用 fixture：

```text
fixtures/stm32-debug-smoke/
```

程序建议：

```c
volatile uint32_t counter = 0;
volatile uint32_t watched = 0;

static void update_value(void) {
    watched++;
}

int main(void) {
    while (1) {
        counter++;
        if ((counter % 1000) == 0) {
            update_value();
        }
    }
}
```

必须包含：

- `main`
- 一个可 breakpoint function。
- 一个 volatile watchpoint variable。
- 可稳定循环。

---

## 5.2 实机验收脚本

人工/Agent执行：

### Start

```text
corn_debug start
```

预期：

- Approval 卡出现。
- 批准后启动。
- OpenOCD 临时进程存在。
- GDB 临时进程存在。
- UI state = paused。
- 位置合理。

### Breakpoint

在：

```text
update_value
```

打断点。

Run。

预期：

```text
debug.running
↓
debug.breakpoint.hit
```

Runtime：

```text
paused
location=正确文件/行
```

### Step

执行：

```text
step into
step over
step out
```

每次只能在 native stop 后显示 complete。

### Watchpoint

对：

```text
watched
```

设置 write watchpoint。

Run。

预期：

```text
debug.watchpoint.hit
```

并能读取 before/after 或至少当前 value。

### Inspect

验证：

```text
stack
locals
registers
evaluate
readMemory
```

### Snapshot

创建 Snapshot，必须包含：

- firmware hash。
- stop location。
- stack。
- locals。
- registers（若请求）。
- backend。
- timestamp。

### Stop

停止后：

- GDB退出。
- OpenOCD退出。
- TargetLease释放。
- port释放。
- Runtime session删除。
- UI active=false。

---

## 5.3 Windows Acceptance 文档

更新：

```text
docs/WINDOWS_ACCEPTANCE_0.27.md
```

每条带：

```text
date
machine
Windows version
OpenOCD version
GDB version
probe model/serial
MCU
artifact hash
result
```

不要只打 `[x]`。

---

# 6. PR-D — Keil UVSC / Simulator Backend Rewrite

这是本轮第二大工程。

---

## 6.1 删除错误实现

废弃：

```text
src/infrastructure/debug/keil/uvsock-client.mjs
```

当前 JSON wire protocol。

可以重命名保留历史：

```text
uvsock-client.legacy-invalid.mjs
```

但不建议打包。

最好直接删除并通过 git history 保留。

---

## 6.2 实现策略

优先级建议：

### 方案 A：Native UVSC Bridge（推荐）

新增一个非常薄的临时 helper：

```text
native/uvsc-bridge/
```

职责只有：

```text
Node JSON-RPC / framed IPC
        ↓
native helper
        ↓
Keil UVSC C ABI
        ↓
µCorn
```

Node 侧：

```text
src/infrastructure/debug/keil/
├── uvsc-bridge-process.mjs
├── uvsc-client.mjs
├── uvsc-events.mjs
└── keil-sim-backend.mjs
```

Helper 只在 simulator debug session 存在时启动。

这是允许的，因为目标本身就是：

> 核心服务少；debug期间启动小进程可以接受。

优势：

- C struct packing 更可靠。
- 直接参考 Keil/Qt Creator header。
- 避免 JS 手写复杂 union。
- Node层仍保持干净。
- 未来升级 protocol只改 native helper。

### 方案 B：Node Buffer 直接实现

只有在确认所有 ABI layout、packing、endian、pointer-free message layouts 后再做。

不推荐一开始走这个方案。

---

## 6.3 UVSC 协议来源

实现时必须以真实公开头文件/Keil文档/成熟实现为准。

不要猜：

```text
opcode
status
header size
string encoding
struct packing
async response
```

至少实现：

```text
UV_GEN_GET_VERSION

UV_PRJ_LOAD
UV_PRJ_SET_TARGET
UV_PRJ_GET_CUR_TARGET

UV_DBG_ENTER
UV_DBG_EXIT
UV_DBG_START_EXECUTION
UV_DBG_STOP_EXECUTION
UV_DBG_STATUS
UV_DBG_RESET

UV_DBG_STEP_HLL
UV_DBG_STEP_INTO
UV_DBG_STEP_OUT

UV_DBG_CALC_EXPRESSION
UV_DBG_EVAL_EXPRESSION_TO_STR

UV_DBG_CREATE_BP
UV_DBG_CHANGE_BP
UV_DBG_ENUMERATE_BP

UV_DBG_ENUM_STACK
UV_DBG_ENUM_VARIABLES
UV_DBG_READ_REGISTERS
UV_DBG_MEM_READ

UV_DBG_EXEC_CMD

UV_CMD_RESPONSE
UV_ASYNC_MSG
UV_DBG_CALLBACK
UV_DBG_CMD_OUTPUT
```

---

## 6.4 UV4 进程生命周期

新增：

```text
src/infrastructure/debug/keil/uv4-debug-process.mjs
```

职责：

```text
spawn UV4
dynamic uvsock port
hidden/minimized/no-user-interaction
lifecycle
timeout
unexpected exit
```

不要依赖用户已经打开 Keil。

启动流程：

```text
resolve uv4Bin
↓
allocate port
↓
spawn UV4 project + socket option
↓
wait port ready
↓
UVSC get version
↓
load project / select target
↓
enter debug
↓
confirm simulator
↓
ready
```

如果 Keil命令行版本对隐藏模式支持有限，目标是：

- 用户不需要操作 UI。
- 允许进程存在。
- 尽可能隐藏/minimize。
- 不把“完全无 GUI process”设成硬目标。

---

## 6.5 Simulator Backend Mapping

`KeilSimBackend` 应只实现 BackendContract。

映射：

```text
continue
→ UV_DBG_START_EXECUTION

requestPause
→ UV_DBG_STOP_EXECUTION

stepOver
→ UV_DBG_STEP_HLL

stepInto
→ UV_DBG_STEP_INTO

stepOut
→ UV_DBG_STEP_OUT

resetHalt
→ UV_DBG_RESET + wait callback/status

evaluate
→ UV_DBG_EVAL_EXPRESSION_TO_STR

readMemory
→ UV_DBG_MEM_READ

addBreakpoint
→ UV_DBG_CREATE_BP

removeBreakpoint
→ UV_DBG_CHANGE_BP / kill

stack
→ UV_DBG_ENUM_STACK

locals
→ UV_DBG_ENUM_VARIABLES

registers
→ UV_DBG_READ_REGISTERS
```

---

## 6.6 Keil Signal Function

保留：

```text
debug-script-builder.mjs
```

但不要通过一个巨型 `EXEC_CMD` 一次性注入任意复杂 script，除非确认 Keil支持该方式。

更稳妥：

```text
生成 .ini / script file
↓
通过 debug init / exec command 加载
```

Signal Function 只是 Simulator专属 scenario backend，不应混到通用 DebugBackend API。

新增：

```text
SimulatorScenarioBackend extension
```

或：

```text
KeilSimBackend.applyScenario()
```

但 Application层先判断 backend capability。

---

## 6.7 Capabilities

新增：

```text
backend.capabilities()
```

例如：

```json
{
  "breakpoints": true,
  "watchpoints": true,
  "memoryRead": true,
  "registers": true,
  "simulatorSignals": true,
  "peripheralSimulation": "device-dependent"
}
```

UI/Agent 不要假定所有 Backend支持全部能力。

---

## 6.8 Keil 验收

必须在真实 Windows + Keil MDK 下验证：

1. 用户不手动打开 µCorn。
2. Agent启动 simulator。
3. project正确加载。
4. target正确。
5. simulator模式正确。
6. breakpoint。
7. step。
8. evaluate。
9. memory。
10. stack。
11. signal function。
12. stop 后 UV4/helper 自动退出。

验收前 README只能写：

```text
experimental
```

---

# 7. PR-E — ProgramModel & Archify Hardening

---

## 7.1 正则 Analyzer 降级

当前：

```text
src/infrastructure/program/c-source-analyzer.mjs
```

重命名：

```text
heuristic-c-source-analyzer.mjs
```

所有产出：

```text
confidence: heuristic
```

不要使用：

```text
parsed
```

避免 Agent误判可信度。

---

## 7.2 AST Analyzer

优先使用成熟解析器，不自己写 C grammar。

建议：

```text
tree-sitter
tree-sitter-c
```

新增：

```text
src/infrastructure/program/tree-sitter-c-analyzer.mjs
```

抽取：

```text
function definitions
function declarations
calls
globals
locals
assignments
reads
member expressions
if/switch/for/while conditions
include directives
preprocessor nodes
```

---

## 7.3 Preprocessor 问题

STM32工程大量存在：

```text
#ifdef
#define
HAL macro
CMSIS macro
```

单纯源码 AST 仍不等于真实编译单元。

ProgramModel的 confidence 必须保留：

```text
ast
heuristic
symbol-resolved
compile-db
debug-symbol
```

未来可增强：

```text
compiler -E
compile_commands.json
DWARF
ELF symbol
map file
```

本轮不要求全部做，但数据结构不能锁死。

---

## 7.4 Archify 边界

当前 Adapter 中的：

```text
findUpstream
findDownstream
findCausalPath
```

移到：

```text
src/application/program/graph-analysis-service.mjs
```

或者：

```text
src/domain/program/graph-analysis.mjs
```

`src/infrastructure/archify/archify-adapter.mjs` 只负责：

```text
ProgramModel
→ Archify IR

DebugStory data
→ Archify render/input format

ProgramDelta
→ Archify render/input format
```

不要把通用图算法挂 Archify 名字。

---

## 7.5 Runtime Correlation

建立：

```text
source location
↓
ProgramModel node
```

新增：

```text
src/application/program/runtime-correlation-service.mjs
```

输入：

```ts
{
  file,
  line,
  function
}
```

输出：

```ts
{
  functionNodeId,
  variableNodeIds,
  nearestConditions,
  callers,
  callees
}
```

这才是 Agent debug reasoning真正需要的桥。

---

# 8. PR-F — Verify Productization

---

## 8.1 Verify 入口

目前 `verify-service.mjs` 是 library。

新增：

```text
src/application/verify/verify-command-service.mjs
src/interfaces/rpc/verify-rpc-handler.mjs
```

Agent可以放进：

```text
corn_debug
```

新增 action：

```text
verify
```

不要再单独增加一个 agent tool，除非后续 Verify扩大到非 Debug 场景。

---

## 8.2 Scenario Model

建议：

```json
{
  "name": "low-load-eev-regression",
  "timeoutMs": 180000,
  "setup": [],
  "assertions": [
    {
      "type": "debug.expression",
      "expression": "eev_target_opening",
      "operator": ">",
      "expected": 0
    },
    {
      "type": "modbus.point",
      "pointId": "receiver_level",
      "operator": ">=",
      "expected": 20
    },
    {
      "type": "stable-for-duration",
      "source": {
        "type": "modbus.point",
        "pointId": "receiver_level"
      },
      "durationMs": 120000,
      "min": 20
    }
  ]
}
```

---

## 8.3 删除 2 秒 clamp

`stable-for-duration` 不能：

```text
120000ms
→ 2000ms
```

改为：

```text
durationMs
由 scenario timeout 统一约束
```

采样：

```text
sampleIntervalMs
```

默认例如：

```text
1000ms
```

不要固定 4 个 sample。

---

## 8.4 Telemetry Source

不要从：

```text
workspace.modbus.points[].value
```

读取实时值。

必须接入现有实时值源。

建议依赖：

```text
application/modbus/read-service
live value store
polling service cache
```

新增抽象：

```text
TelemetryReader
```

接口：

```ts
readPoint(pointId)
subscribePoint(pointId)
```

Verify不应知道 workspace内部 storage layout。

---

## 8.5 Verification Timeline

Scenario执行期间记录：

```text
scenario.started
assertion.sample
assertion.pass
assertion.fail
debug.snapshot
scenario.completed
```

最终：

```text
PASS
FAIL
ERROR
TIMEOUT
CANCELLED
```

区分：

- assertion fail。
- infrastructure failure。
- user cancel。
- target disconnected。

---

## 8.6 Evidence

最终 VerifyResult 必须绑定：

```text
scenarioId
artifactSha256
debugSessionId
firmware hash
target identity
start/end timestamp
assertions
telemetry samples
debug snapshots
result
```

Evidence 不允许只写一句字符串 summary。

---

# 9. 需要修改的文件清单

## Debug Domain

```text
src/domain/debug/debug-state.mjs
src/domain/debug/debug-event.mjs
src/domain/debug/target-lease.mjs

新增:
src/domain/debug/backend-event.mjs
src/domain/debug/debug-backend-contract.mjs
```

## Debug Types

```text
src/types/debug.d.ts

新增:
src/types/debug-backend.d.ts
src/types/debug-launch.d.ts
```

## Debug Application

```text
src/application/debug/debug-runtime.mjs
src/application/debug/debug-command-service.mjs
src/application/debug/debug-approval-service.mjs

新增:
src/application/debug/debug-launch-spec-service.mjs
src/application/debug/debug-start-service.mjs
```

## GDB/OpenOCD

```text
src/infrastructure/debug/gdb-mi/gdb-backend.mjs
src/infrastructure/debug/gdb-mi/mi-client.mjs
src/infrastructure/debug/gdb-mi/stop-reason.mjs
src/infrastructure/debug/openocd/openocd-debug-process.mjs
src/infrastructure/debug/openocd/openocd-debug-profile.mjs

新增:
src/infrastructure/network/loopback-port.mjs
```

## RPC / Agent

```text
src/interfaces/rpc/debug-rpc-handler.mjs
src/interfaces/agent/corn-debug-tool.mjs
src/shared/debug-contract.mjs
```

## Debug UI

```text
src/ui/debug/runtime/use-debug-events.mjs
src/ui/debug/runtime/runtime-controller.mjs
src/ui/debug/runtime/runtime-page.mjs
src/ui/debug/runtime/debug-toolbar.mjs
src/ui/debug/runtime/stack-panel.mjs
src/ui/debug/runtime/variables-panel.mjs
src/ui/debug/runtime/breakpoint-panel.mjs
src/ui/debug/runtime/debug-timeline-panel.mjs
```

## Keil

```text
删除/重写:
src/infrastructure/debug/keil/uvsock-client.mjs

重写:
src/infrastructure/debug/keil/keil-sim-backend.mjs

保留并修正:
src/infrastructure/debug/keil/debug-script-builder.mjs

新增:
src/infrastructure/debug/keil/uv4-debug-process.mjs
src/infrastructure/debug/keil/uvsc-client.mjs
src/infrastructure/debug/keil/uvsc-bridge-process.mjs
src/infrastructure/debug/keil/uvsc-events.mjs

可选 native:
native/uvsc-bridge/*
```

## ProgramModel

```text
重命名:
src/infrastructure/program/c-source-analyzer.mjs
→ src/infrastructure/program/heuristic-c-source-analyzer.mjs

新增:
src/infrastructure/program/tree-sitter-c-analyzer.mjs
src/application/program/graph-analysis-service.mjs
src/application/program/runtime-correlation-service.mjs

修改:
src/application/program/program-service.mjs
src/infrastructure/archify/archify-adapter.mjs
```

## Verify

```text
src/application/verify/verify-service.mjs

新增:
src/application/verify/verify-command-service.mjs
src/interfaces/rpc/verify-rpc-handler.mjs
src/application/verify/telemetry-reader.mjs
```

## Docs

```text
README.md
CHANGELOG.md

docs/architecture/ADR-013-debug-runtime-boundary.md
docs/architecture/ADR-014-debug-events-over-connection-rpc.md
docs/architecture/ADR-015-program-model-and-archify-boundary.md

新增:
docs/architecture/ADR-016-debug-backend-event-contract.md
docs/architecture/ADR-017-debug-launch-and-approval.md
docs/architecture/ADR-018-keil-uvsc-bridge.md

新增:
docs/WINDOWS_ACCEPTANCE_0.27.md
```

---

# 10. 推荐提交顺序

不要提交一个巨型 commit。

建议：

```text
1. refactor(debug): introduce backend event contract
2. fix(debug): make runtime authoritative for backend state
3. fix(debug): await native stop before pause/step completion
4. fix(debug-ui): consume canonical debug event names
5. test(debug): add MI transcript end-to-end runtime tests

6. feat(debug): resolve immutable launch specs on host
7. fix(debug): enforce owner session lookup
8. fix(debug): unify approval start path
9. fix(debug): harden target lease identity
10. feat(debug): allocate per-session gdb ports

11. test(debug): add hardware smoke fixture
12. docs(debug): add Windows 0.27 acceptance

13. refactor(keil): remove invalid json uvsock protocol
14. feat(keil): add UV4 managed debug process
15. feat(keil): add real UVSC bridge/client
16. feat(keil): map UVSC simulator backend to DebugBackend

17. refactor(program): demote regex analyzer to heuristic
18. feat(program): add tree-sitter C analyzer
19. refactor(archify): separate graph analysis from adapter
20. feat(program): correlate runtime locations with ProgramModel

21. refactor(verify): use live telemetry reader
22. feat(verify): support real duration/cancellation/timeouts
23. feat(verify): expose verification through debug command path
24. docs(release): align README with validated capabilities
```

---

# 11. 测试金字塔

## Unit

必须覆盖：

```text
MI parser
stop reason mapping
state transition
backend event reducer
approval ticket
target lease
launch spec
port allocator
UVSC codec/bridge messages
ProgramModel AST
Verify assertion
```

## Integration

必须覆盖：

```text
fake GDB transcript
→ GdbBackend
→ DebugRuntime
→ RPC
→ UI event reducer
```

以及：

```text
fake UVSC server/helper
→ KeilSimBackend
→ DebugRuntime
```

## Real Hardware

必须：

```text
Windows
STM32
OpenOCD
GDB
```

## Real Keil

必须：

```text
Windows
µCorn
UVSC
Simulator
```

自动化测试不能替代后两者。

---

# 12. 必须新增的回归场景

## Scenario A — Breakpoint

```text
start
add breakpoint
run
backend.stopped(breakpoint)
runtime.paused
location updated
debug.breakpoint.hit
UI refresh
```

## Scenario B — Step

```text
paused
step over
runtime.running
不得 STEP_COMPLETE
backend.stopped(end-stepping-range)
runtime.paused
STEP_COMPLETE
```

## Scenario C — Watchpoint

```text
watch variable
run
backend.stopped(watchpoint)
runtime.paused
watchpoint hit
snapshot available
```

## Scenario D — Session Isolation

```text
same cwd
Session A owns debug
Session B query
→ not active / NOT_OWNER
```

## Scenario E — Target Lock

```text
Workspace A + probe S1
Workspace B + probe S1
→ second TARGET_BUSY
```

## Scenario F — Dynamic Port

```text
Session A
port P1

Session B
port P2

P1 != P2
```

## Scenario G — Approval Stale

```text
approval artifact hash A
rebuild → hash B
approve old ticket
→ APPROVAL_STALE
```

## Scenario H — Keil simulator

```text
no UV4 running
start simulator
plugin spawns UV4
UVSC connects
project loads
debug enters
step/breakpoint/eval work
stop
UV4 exits
```

## Scenario I — Verify 120s

```text
duration=120000
不得 clamp
支持 cancel
支持 timeout
采样次数 > 4
```

---

# 13. 架构硬规则

实现 Agent 必须遵守：

## Rule 1

**Host owns state.**

Browser 不持久化：

```text
debug session
approval
target lease
canonical runtime state
```

## Rule 2

**Backend emits facts, Runtime emits meaning.**

Backend：

```text
stopped reason
native location
process exit
console output
```

Runtime：

```text
breakpoint hit
watchpoint hit
step complete
exception
paused
```

## Rule 3

**Agent 不知道本机路径。**

不要把：

```text
C:\Program Files\...
C:\Keil_v5\...
openocd.exe
arm-none-eabi-gdb.exe
```

放进 Agent schema。

## Rule 4

**Approval 是 Host capability，不是 boolean。**

绝不信：

```text
approved=true
```

## Rule 5

**不伪造第三方协议。**

UVSC、GDB/MI、OpenOCD 均按真实协议。

## Rule 6

**外部调试内核不 Node 化。**

保留：

```text
OpenOCD
GDB
µCorn
```

Node只负责 orchestration / protocol adapter。

## Rule 7

**临时 helper 可以存在。**

尤其 UVSC C ABI，允许启动短生命周期 native helper。

不要为了“纯 Node”制造大量 ABI 风险。

## Rule 8

**静态分析必须暴露 confidence。**

Agent看到：

```text
heuristic
```

和：

```text
AST-resolved
```

必须可区分。

## Rule 9

**Verify 读取真实 telemetry source。**

不要读配置快照冒充实时值。

## Rule 10

**未通过真实设备验收，不得在 README 宣称 stable support。**

---

# 14. Definition of Done

本轮修复只有满足以下条件才能认为完成。

## GDB/OpenOCD

- [ ] Agent仅使用 `corn_debug { action: "start" }` 可启动。
- [ ] Host自动解析 artifact/GDB/OpenOCD。
- [ ] Approval正确。
- [ ] 同 Session 状态隔离。
- [ ] TargetLease按物理 probe。
- [ ] 动态端口。
- [ ] breakpoint真实可用。
- [ ] watchpoint真实可用。
- [ ] step不提前完成。
- [ ] stack/locals/register/evaluate/memory可读。
- [ ] snapshot内容对应真实 stop 时刻。
- [ ] stop无孤儿进程。
- [ ] Windows STM32验收完成。

## Keil Simulator

- [ ] 删除自定义 JSON UVSOCK协议。
- [ ] 使用真实 UVSC。
- [ ] 插件自行启动 UV4。
- [ ] 用户无需操作 Keil UI。
- [ ] project/target自动解析。
- [ ] breakpoint。
- [ ] step。
- [ ] evaluate。
- [ ] memory。
- [ ] stack。
- [ ] signal function。
- [ ] stop清理全部进程。
- [ ] Windows真实 Keil验收完成。

## ProgramModel

- [ ] Tree-sitter成为主分析器。
- [ ] Regex analyzer明确标记 heuristic。
- [ ] runtime source location能映射 ProgramModel function。
- [ ] Archify adapter不包含通用图算法。

## Verify

- [ ] Agent可调用。
- [ ] 真实 Modbus/live telemetry。
- [ ] 长时间 scenario。
- [ ] cancellation。
- [ ] timeout。
- [ ] PASS/FAIL/ERROR区分。
- [ ] Evidence绑定 firmware hash/debug session/telemetry。
- [ ] 120秒控制场景可执行。

## Documentation

- [ ] README只声明已验证能力。
- [ ] Acceptance记录真实环境。
- [ ] 新 ADR 完成。
- [ ] CHANGELOG列出 breaking/refactor 行为。

---

# 15. 最终目标架构

修复完成后，应收敛到：

```text
                         ┌─────────────────────┐
                         │      AI Agent       │
                         │    corn_debug     │
                         └──────────┬──────────┘
                                    │
                                    │ structured command
                                    ▼
┌───────────────┐          ┌─────────────────────┐
│   Browser UI  │─────────▶│  Debug Application  │
│ Runtime Debug │   RPC    │                     │
└───────────────┘          │ Launch / Approval   │
                           │ Runtime / Verify     │
                           └──────────┬──────────┘
                                      │
                                      ▼
                           ┌─────────────────────┐
                           │ DebugRuntime        │
                           │ authoritative state │
                           │ reducer / events    │
                           └───────┬─────┬───────┘
                                   │     │
                    BackendEvent   │     │ BackendEvent
                                   │     │
                 ┌─────────────────┘     └─────────────────┐
                 ▼                                         ▼
      ┌────────────────────┐                    ┌────────────────────┐
      │ GDB/OpenOCD Backend│                    │ Keil Sim Backend   │
      │                    │                    │                    │
      │ Node GDB/MI client │                    │ Node UVSC adapter  │
      └─────────┬──────────┘                    └─────────┬──────────┘
                │                                         │
                ▼                                         ▼
          arm-none-eabi-gdb                         UVSC bridge
                │                                         │
                ▼                                         ▼
             OpenOCD                                  µCorn
                │                                    Simulator
                ▼
              STM32

                         DebugRuntime
                              │
                ┌─────────────┴──────────────┐
                ▼                            ▼
          ProgramModel                    Verify
        Tree-sitter AST             Debug + Telemetry
                │                            │
                ▼                            ▼
        Graph Analysis                 Evidence
                │                            │
                └─────────────┬──────────────┘
                              ▼
                         Agent Reasoning
```

最终 Agent工作流应是：

```text
问题描述
↓
Agent查源码 / ProgramModel
↓
build
↓
flash
↓
corn_debug start
↓
breakpoint / watchpoint
↓
run
↓
真实 stop event
↓
Runtime snapshot
↓
Agent分析调用链 + 变量 + telemetry
↓
修改代码
↓
rebuild
↓
flash
↓
verify scenario
↓
PASS / FAIL
```

这才算真正完成“无需操作 Keil/GDB UI，由 Agent完成 STM32 编译、烧录、调试、分析和验证”的目标。

---

# 16. 执行优先级总结

严禁一上来修 UI 或继续做新图表。

顺序固定：

```text
P0
1. BackendEvent contract
2. DebugRuntime authoritative state
3. step/pause async semantics
4. UI canonical event
5. Agent launch spec
6. Session ownership
7. Approval
8. TargetLease
9. dynamic port
10. Windows GDB real hardware

P0
11. 删除错误 UVSOCK
12. Real UVSC
13. managed UV4
14. Windows Keil simulator acceptance

P1
15. Tree-sitter ProgramModel
16. Archify boundary
17. runtime correlation

P1
18. Verify live telemetry
19. duration/cancel/timeout
20. Verify Agent/RPC product entry

最后
21. Documentation
22. Release acceptance
```

在第 10 步完成前，不做新的 Debug 功能。

在第 14 步完成前，不宣称 Keil Simulator 已支持。

在第 20 步完成前，不宣称 Verify 闭环已完成。
