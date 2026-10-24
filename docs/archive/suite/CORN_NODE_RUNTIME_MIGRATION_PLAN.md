# Corn 插件 Node 通信与内置 OpenOCD 运行时迁移计划

> 基线：`dsh-corn-bench 0.18.4`  
> 目标平台：Windows 10/11 x64；macOS 仅作为当前开发与无硬件自动测试环境  
> 文档状态：待执行  
> 计划范围：
> 1. 使用 `modbus-serial + serialport` 取代 Modbus/原始串口相关 Python 强绑定。
> 2. 在插件内置 Windows x64 OpenOCD 运行时，并使用 Node/TS 进程执行封装取代 `openocd_flash.py` 和用户手工绑定的 OpenOCD/Python 路径。
> 3. 在 0.19/0.20 保持 Keil 不动；0.21.0 再以 Node 等价替换现有 Keil Python 兼容层，但继续调用用户已安装并绑定的 `UV4.exe`。

---

## 1. 目标结果

完成后，用户安装 Corn 插件并重启 DeepSeek Harness，即可：

1. 创建 RTU/TCP 主机连接。
2. 选择 COM、配置波特率/数据位/校验位/停止位。
3. 添加设备、Unit ID 和点位。
4. 直接执行轮询、读点、受控写点和写后回读。
5. 在“串口报文”中查看按连接分轨的 Modbus TX/RX。
6. 打开指定 COM 的原始串口监视。
7. 在工程产生固件后，选择 OpenOCD interface/target，并通过插件内置 OpenOCD 完成烧录、校验和复位。
8. Agent 发起的读写、轮询、烧录和聚焦操作继续同步反映在当前会话的 Corn 页面、任务、时间线和证据中。
9. 在 0.21.0 后，无需 Python 即可扫描 `.uvprojx`、枚举 Target、生成工程映射、调用 UV4 编译、解析日志和发现固件产物。

“安装即用”指插件功能不再要求安装或绑定 Python、pymodbus、pyserial、OpenOCD 或额外 Node 路径；USB-RS485/RS232、ST-LINK、CMSIS-DAP、J-Link 等硬件对应的 Windows 驱动仍属于操作系统/硬件前置条件。Keil 编译仍要求用户合法安装并绑定 MDK/`UV4.exe`、许可证、编译器与对应 Device Pack；这些专有组件不随插件分发。

以下操作不再要求 Python：

- Modbus RTU/TCP 读写。
- Modbus 轮询。
- 写后回读。
- 原始串口监视。
- OpenOCD 固件烧录、校验和复位。

在 0.19/0.20 兼容期，Python 暂时仍只服务于：

- Keil 工程扫描和 Target 解析。
- Keil 编译及其日志/产物解析。

“未绑定 Python”不得再导致上位机、串口报文或 OpenOCD 烧录整体不可用。

0.21.0 Windows 验收通过并删除两段 Keil Python 脚本后，插件正式运行路径不再保留 Python binding。

---

## 2. 不在本计划范围内

本计划不增加以下内容：

- CAN/DBC。
- 多设备拓扑平台化。
- 远程 Runner。
- 设备模板市场、行业知识包或多人台架预约。
- Node-RED 运行时或 `node-red-contrib-modbus`。
- `jsmodbus` 或 `modbus-stream`。
- 超出现有 `FLASH_INTERFACES` / `FLASH_TARGETS` 白名单的新探针或新芯片支持。
- GDB Server、断点、寄存器/内存实时调试和 SWO Trace；本期只迁移烧录、校验、复位链路。
- STM32CubeProgrammer、Option Bytes、STM32 外部 Loader、安全固件安装和 UART/USB DFU。
- 工厂量产烧录、序列号批量写入或产线工位管理。
- 替代或内置 Keil MDK、UV4、ARM Compiler、许可证、Device Family Pack。
- 将 `.uvprojx` 转换为 CMake、CMSIS-Toolbox、GCC 工程或其他构建系统。
- 修改 `.uvprojx/.uvoptx`、Keil Target、工具链选项、Pack 配置或 User/After-Build 命令。
- 新增 Keil 调试、ULINK 烧录、仿真、断点或寄存器功能；0.21.0 只等价迁移当前 scan/targets/map/build 能力。

本次也不重写现有 TCP 从机模拟实现。`bench-slave.mjs` 保持原有职责，仅用作测试或现有模拟能力。

### 2.1 Keil 分阶段边界

本计划中的“烧录”仅指：对一个已经存在且已完成 SHA256 确认的 `.hex/.bin/.elf/.axf` 产物调用 OpenOCD。产物由 Keil、其他 IDE 或外部流水线生成均可，但本计划不参与产物构建。

0.19/0.20 阶段以下文件和契约视为回归保护对象，不是迁移对象：

- `bench-keil.mjs`、`runtime/keil_project.py`、`runtime/keil_build.py`。
- Keil 扫描、Target 选择、编译、日志解析和 UV4 binding。
- 现有 HTTP 路由 `/dsh-corn-bench/keil/download`；0.20.0 内部可转发到中性的 Flash Service，但不删除、不改请求字段。
- `bench-run.mjs` 被 OpenOCD 复用时，只允许增加向后兼容的可选回调；既有 Keil/Python 调用的返回值、超时和取消语义必须通过回归测试。

因此，0.19/0.20 发布后仍允许“未绑定 Python 导致 Keil 扫描/编译不可用”，但不得连带使 Modbus、串口监视或内置 OpenOCD 烧录不可用。只有 0.20.0 已完成并稳定后才进入 0.21.0；0.21.0 可以改造上述 Keil 兼容文件，但不得改变对外行为和 UV4 binding 语义。

---

## 3. 当前依赖与问题

### 3.1 Modbus 与串口

当前真实 Modbus 事务由 `bench-modbus.mjs` 调用：

- `runtime/modbus_read.py`
- `runtime/modbus_write.py`

当前原始串口监视由 `bench-serial-monitor.mjs` 启动：

- `runtime/serial_monitor.py`

由此产生的问题：

- 用户必须自行安装并绑定 Python。
- 用户必须自行安装 `pymodbus`、`pyserial`。
- 不同 Python/pymodbus 版本造成接口漂移。
- 每个真实事务启动脚本，串口频繁打开/关闭。
- Python 子进程、COM 锁、Agent 任务和 UI 状态分属不同生命周期。

### 3.2 烧录

当前 `bench-flash.mjs` 同时要求：

- Python 绑定。
- OpenOCD 路径绑定。
- `runtime/openocd_flash.py`。

`runtime/openocd_flash.py` 本质只做输入校验、OpenOCD argv 拼装、子进程执行和结果整理。迁移后这些职责进入 Node/TS，OpenOCD 仍是实际烧录引擎，当前已声明的 STM32、nRF、RP2040、LPC55、Kinetis、EFM32、SAMD 等目标能力不因去 Python 而主动收缩。

### 3.3 Keil 兼容层

当前 `bench-keil.mjs` 通过 `runPythonScript()` 调用：

- `runtime/keil_project.py`：受限扫描 `.uvprojx`、枚举 Target、生成组/文件/Include/Define/函数/include-edge 工程映射。
- `runtime/keil_build.py`：构造 UV4 argv/PATH、执行编译、读取 UTF-8/GBK/CP936 日志、分类 compile/after-build 错误、统计 ROM/RAM、发现 `.hex/.bin/.axf/.elf`。

两者共约 836 行，均使用 Python 标准库，没有必须依赖 Python 才能实现的能力。真正不可替代的外部组件是用户本机的 `UV4.exe`、编译器、许可证与 Device Pack，而不是这两段包装代码。

当前问题：

- 即使用户已安装 Keil，scan/targets/map/build 仍被 Python binding 卡住。
- Python JSON 子进程增加一层错误、编码和取消生命周期。
- 当 Modbus、串口和烧录都已 Node 化后，仅为两个兼容脚本保留 Python 设置项会造成产品认知割裂。
- 当前工程映射依赖启发式 C 函数正则；迁移只要求行为等价，不借机把它宣称成完整 C/C++ AST。

### 3.3 必须保留的产品契约

迁移不得破坏：

- 多工作区按 `cwd` 隔离。
- 多连接按 `connectionId` 隔离。
- 一个物理 COM 不可被两个连接重复占用。
- 原始监视与 Modbus 事务不可同时占用同一 COM。
- Agent 多连接/多设备操作必须显式提供 `connectionId`、`deviceId`。
- Agent 写点必须走现有批准流程。
- 写入成功仍表示写入后回读一致，而不是只看 CLI/API 返回成功。
- `frameId`、`transactionId`、`taskId`、`source`、`sessionId` 不丢失。
- `framesByConnection` 继续按连接分轨并维持 500 条环形上限。
- 烧录前继续展示固件路径、大小和 SHA256，并在批准后再次校验。
- 任务取消、超时、插件卸载必须释放 COM、ST-LINK 和子进程。

---

## 4. 架构决策

### ADR-01：只保留一套 Modbus 协议栈

**决定**

- 唯一 Modbus 协议库：`modbus-serial`，固定精确版本。
- 串口驱动层：`serialport`，固定精确版本并作为直接依赖声明。
- 不引入 `jsmodbus`、`modbus-stream`、`node-red-contrib-modbus`。

建议起始版本：

```json
{
  "modbus-serial": "8.0.25",
  "serialport": "13.0.0"
}
```

执行时先重新查询 npm 当前版本与 Node 兼容性；未经 Windows 验证不得自行升级 major。

**原因**

- `modbus-serial` 覆盖当前所需 FC01/02/03/04/05/06/15/16、RTU 和 TCP。
- 开启 debug 后可取得本次事务的请求/响应字节，能够映射到现有报文契约。
- 显式依赖 `serialport` 可避免 optional dependency 被跳过后 RTU 静默不可用。

### ADR-02：硬件通信运行在插件自带的 Node 子进程

**决定**

新增一个长期存活的 `runtime/corn-io-worker.mjs`：

```text
Harness Host
  └─ bench-io-broker.mjs
       └─ process.execPath runtime/corn-io-worker.mjs
            ├─ modbus-serial
            ├─ serialport
            ├─ RTU/TCP 连接池与事务队列
            └─ 原始串口监视
```

不在 `host.js` 或浏览器 `client.js` 中直接加载原生串口模块。

**原因**

- 用户无需安装额外 Node 或 Python，子进程复用 Harness 的 `process.execPath`。
- 原生串口崩溃不会直接拖垮 Harness 主进程。
- 保留现有 Python 子进程提供的故障隔离和可终止性。
- 可以维持持久连接，减少轮询时频繁打开/关闭 COM。

### ADR-03：业务层不依赖具体通信库

新增内部端口契约：

```js
transport.health()
transport.read(request, { signal })
transport.write(request, { signal })
transport.openRawMonitor(request)
transport.closeRawMonitor(request)
transport.rawFeed(request)
transport.releaseConnection(request)
transport.stop()
```

`bench-modbus.mjs` 只处理目标选择、点位、批准、任务、回读、告警、持久化和报文转换，不直接调用 `modbus-serial`。

### ADR-04：OpenOCD 通过 Node Flash Provider 接入

新增内部烧录端口：

```js
flashProvider.health()
flashProvider.flash(request, { signal })
```

首个且本期唯一 Provider：`openocd`。

`bench-flash.mjs` 保留固件确认、SHA256 二次校验、任务、Agent 来源和工作区持久化等产品规则；`bench-flash-openocd.mjs` 只负责解析内置运行时、生成受限参数、调用 `runExecFile()` 和归一化输出。

不新建第二套通用进程框架：复用 `bench-run.mjs` 的 `runExecFile()` 和 `killProcessTree()`，只按需增加有界 stdout/stderr 增量回调，使 OpenOCD 进度可写入任务和 UI。始终使用 `shell: false`，禁止通过 `cmd.exe`、PowerShell 或字符串命令启动。

### ADR-05：xPack OpenOCD Windows x64 直接随插件交付

固定起始版本为 xPack OpenOCD `0.12.0-7`，Windows x64 发行包直接收录到插件的 Node-only runtime 目录，不进入浏览器 `client.js`：

```text
dsh-corn-bench/
  runtime/openocd/win32-x64/
    bin/openocd.exe
    bin/*.dll
    openocd/scripts/**
    distro-info/licenses/**
    manifest.json
```

不要求用户安装 xpm，也不把 `@xpack-dev-tools/openocd` 当作运行期全局依赖。运行时解析只使用相对于当前插件模块的确定路径，并显式向 OpenOCD 传入 `-s <bundled scripts dir>`，避免 PATH、当前工作目录或 xPack 安装位置影响结果。macOS 开发环境不伪装为可烧录，只通过 fake executable/依赖注入完成无硬件测试。

内置运行时必须：

- 只来源于 xPack OpenOCD 官方 GitHub Release 的 `xpack-openocd-0.12.0-7-win32-x64.zip`。
- 在 `manifest.json` 记录上游版本、对应 OpenOCD 源码提交、下载地址、原始归档 SHA256、收录文件 SHA256 和生成时间。
- 完整保留发行包的 `distro-info/licenses` 及所需版权/通知文件，并提供对应源码/构建信息或合规的源码获取说明；发布前完成 GPL 及第三方组件再分发义务核对。
- 保留 `openocd.exe` 实际需要的 DLL 和完整 scripts；不得只复制 exe 后依赖用户系统 DLL/脚本。
- 通过维护脚本生成，不允许开发者手工散拷导致来源不可复现。
- 在 Windows Defender 开启的干净机上验证解压、启动和烧录，不因二进制被隔离而伪报 ready。

若内置运行时、许可证清单或 Windows 实机验证任一未完成，不得把“安装插件即可烧录”标记为已实现。

预计增加约 3.23 MB 下载体积，归档内容约 8 MB、典型占盘约 11 MB；发布时以实际 `npm pack` 产物为准记录增量，不把估算值当作验收结果。

### ADR-06：分三个版本交付

- `0.19.0`：Node Modbus/串口运行时；上位机不再依赖 Python。
- `0.20.0`：内置 OpenOCD + Node Flash Provider；烧录不再依赖 Python 和外部 OpenOCD 绑定。
- `0.21.0`：Node Keil Compatibility Layer；扫描、映射和 UV4 编译包装不再依赖 Python，但仍要求外部 UV4/MDK。

每一版完成 Windows 验收后才能开始下一版，不允许把三次迁移合成一次发布。

### ADR-07：每个 Harness 进程只存在一个 I/O Broker

`host.js`、`bench-tool.mjs` 和后台轮询不能各自创建 Worker。新增进程级 `getCornIoBroker()` / `releaseCornIoBroker()`：

- 首次真实 I/O 时懒启动一个 Worker；模拟模式、只读状态页和 Keil 操作不启动 Worker。
- HTTP、Agent 工具与轮询通过同一 Broker 进入同一物理端口 owner 表，因此 Agent 发起的操作会进入与 UI 相同的任务、报文和状态链路。
- Broker 采用引用计数或明确的插件生命周期所有权；`host.js` dispose 时停止接收新请求、取消在途请求、关闭全部连接/监视器，再终止 Worker。
- 测试通过 `opts.transport` / `opts.brokerFactory` 注入 fake，不用替换模块私有变量。

不得为每个请求启动 Worker，也不得按 `cwd` 启动多个 Worker；`cwd` 是协议隔离键，不是进程数量键。

### ADR-08：线路串行化与工作区提交串行化分层处理

Worker 的队列只保证线路事务顺序，不能解决 Host 对 `workspace.json` 的陈旧覆盖。新增 `bench-modbus-commit.mjs`，提供：

```js
commitReadResult(home, cwd, result)
commitWriteResult(home, cwd, result)
commitPollResult(home, cwd, result)
appendTransactionFrame(home, cwd, frame)
```

这些函数按规范化 `cwd` 串行执行，并在进入临界区后重新 `loadWorkspace()`：

- 只合并本次返回涉及的 `pointId -> value`，不得把事务开始前捕获的整份 `values` 覆盖回去。
- 只向目标 `connectionId` 的 frame ring 追加一个规范化 frame。
- 告警计算以合并后的最新值为输入。
- 保存前再次核对 `configVersion`、连接/设备/点位仍存在；配置漂移时保留报文证据，但不得把结果写到已删除或改绑的点位。
- `saveWorkspace()` 仍负责磁盘规范化；新的 commit 层负责一次业务结果的原子合并语义。

### ADR-09：设备 Unit ID 属于事务，不属于连接池指纹

连接池只由 Endpoint 决定；`device.unitId` 必须随每个 read/write 请求发送。Worker 在对应连接队列内部、调用协议函数前立即 `client.setID(unitId)`，不得从 `connection.conn.slave` 或上一事务继承。

- RTU/TCP 连接可被同一连接下的多个设备复用。
- `unitId` 不进入 Endpoint fingerprint，否则切换设备会造成无意义重连。
- 当前产品不支持 Unit 0 广播：读操作无合法响应，写操作也无法满足“写后回读一致”，因此 Host 与 Worker 均拒绝 `unitId === 0`。

### ADR-10：区分真实线路报文与库归一化报文

只使用 `modbus-serial` 的公开接口：`setID()`、`setTimeout()`、read/write 方法、`close()` 和 `isDebugEnabled`。禁止依赖或 monkeypatch `_port`、`_transactions` 等私有字段。

- RTU debug buffer 是包含地址、PDU 和 CRC 的 RTU ADU，可标记 `frameFormat: "rtu-adu"`。
- `modbus-serial` 的 TCP Port 会在库内部将 MBAP 转为 RTU 风格缓冲供核心层处理；其 debug buffer 不是 TCP 线上原始 MBAP。0.19.0 标记为 `frameFormat: "tcp-normalized"`，UI 必须写“协议归一化报文”，不能宣称“原始 TCP 报文”。
- 如果未来必须展示精确 TCP MBAP，应另建受支持的 socket tap/协议适配器任务；本计划不通过私有字段取巧。

### ADR-11：Node 化 Keil 兼容层，不替代 Keil

0.21.0 保留现有 `keilScan/keilTargets/keilMap/keilBuild` 应用入口和返回契约，内部改为：

```text
bench-keil.mjs
  ├─ bench-keil-project.mjs   # scan / targets / map
  ├─ bench-keil-log.mjs       # 编译日志解码、分类和指标
  ├─ bench-keil-artifact.mjs  # OutputDirectory/OutputName 与产物发现
  └─ bench-keil-runner.mjs    # 白名单 argv + runExecFile(UV4.exe)
```

建议精确依赖起点：

```json
{
  "fast-xml-parser": "5.11.0",
  "iconv-lite": "0.7.3"
}
```

- `fast-xml-parser` 只负责只读解析 `.uvprojx`，不把 XML 对象再序列化回工程文件。
- `iconv-lite` 保证 GBK/CP936 日志解码不依赖 Harness Node 是否以 full-ICU 构建；UTF-8 BOM/UTF-8 优先，CP936 fallback。
- `bench-keil-runner.mjs` 复用 `runExecFile()`、`killProcessTree()`，始终 `shell:false`；不新建 Worker，因为一次 build 本来就是一个有界 UV4 子进程。
- Node 层是 Keil 的防腐/兼容层：业务任务和 UI 不依赖 UV4 命令细节，Runner 不读取或修改工作区状态。
- 0.21.0 的成功标准是与当前 Python 输出等价，不是支持所有历史 µCorn 文件格式；继续只接受当前产品支持的 `.uvprojx`。

---

## 5. 目标运行时协议

### 5.1 Host 与 I/O Worker

使用 stdout/stdin NDJSON，每行一个 JSON 对象，协议版本固定为 `1`。

请求：

```json
{
  "v": 1,
  "id": "req-123",
  "op": "modbus.read",
  "cwd": "C:\\workspace\\board",
  "connectionId": "c1",
  "deviceId": "d1",
  "endpoint": {
    "mode": "rtu",
    "port": "COM3",
    "baudrate": 9600,
    "bytesize": 8,
    "parity": "N",
    "stopbits": 1
  },
  "unitId": 1,
  "functionCode": 3,
  "address": 0,
  "count": 10,
  "timeoutMs": 1000
}
```

响应：

```json
{
  "v": 1,
  "id": "req-123",
  "ok": true,
  "data": [1, 2, 3],
  "frames": {
    "requestHex": "01030000000AC5CD",
    "responseHex": "010314...",
    "frameFormat": "rtu-adu"
  },
  "durationMs": 21
}
```

错误：

```json
{
  "v": 1,
  "id": "req-123",
  "ok": false,
  "error": {
    "code": "PORT_IN_USE",
    "message": "串口被占用: COM3"
  }
}
```

约束：

- 单行请求和响应上限 64 KiB。
- `id` 必须唯一，Broker 只解析匹配的响应。
- stderr 仅用于诊断，不作为业务结果通道。
- Worker 崩溃时，Broker 立即失败所有在途请求，不允许悬挂 Promise。
- Worker 采用有限重启：首次按需重启；连续崩溃进入 unhealthy，不无限循环。
- 每个物理 RTU COM 只有一个串行事务队列。
- 每个 TCP 连接也串行化请求，避免 Unit ID/事务状态交叉。
- `connectionId` 只定位产品连接，`deviceId + unitId` 定位本次从站；Worker 必须验证三者都存在于请求，不自行读取工作区或推断设备。
- read 请求限定 FC01/02 数量 1..2000、FC03/04 数量 1..125；write 限定 FC05/06 单值、FC15 1..1968、FC16 1..123，并校验地址范围不越过 65535。
- `timeoutMs` 是协议响应超时；连接建立另使用有界 `connectTimeoutMs`。两者都在 Host/Worker 双层限幅，不能由 Agent 传入无限值。
- Endpoint 指纹变化时先关闭旧连接，再创建新连接。
- Agent/用户取消当前事务时关闭该连接并清空该连接队列，不影响其他 COM/TCP 连接。
- Worker 为每个已受理事务生成唯一 `transactionId = <workerEpoch>:<monotonicSeq>`；Host 将同一 ID 用作 `transactionId/frameId`，不得在保存和返回结果时各生成一次。
- `durationMs` 由 Worker 用单调时钟实测，不再使用真实事务 20ms、模拟事务 5ms 之类常量。

### 5.2 稳定错误码

至少归一化：

- `IO_RUNTIME_UNAVAILABLE`
- `IO_RUNTIME_CRASHED`
- `IO_BACKPRESSURE`
- `PORT_IN_USE`
- `PORT_NOT_FOUND`
- `PORT_OPEN_FAILED`
- `PORT_DISCONNECTED`
- `CONNECTION_TIMEOUT`
- `MODBUS_TIMEOUT`
- `MODBUS_CRC_ERROR`
- `MODBUS_EXCEPTION`
- `INVALID_RESPONSE`
- `CANCELLED`
- `FLASH_RUNTIME_UNAVAILABLE`
- `FLASH_RUNTIME_CORRUPT`
- `FLASH_PROBE_NOT_FOUND`
- `FLASH_MULTIPLE_PROBES`
- `FLASH_CONNECT_FAILED`
- `FLASH_CONFIG_NOT_FOUND`
- `FLASH_VERIFY_FAILED`
- `FLASH_TIMEOUT`
- `FLASH_CANCELLED`
- `FLASH_UNSUPPORTED_TARGET`

UI、Agent 工具和时间线使用相同错误码，不直接展示第三方库内部类名或堆栈。

### 5.3 Broker/Worker 状态机与取消协议

Broker 状态只允许：

```text
idle → starting → ready → stopping → stopped
             ↘ unhealthy ↗
```

- `starting` 期间的调用进入有界队列；启动成功后发送，启动失败全部以同一 cause 结束。
- Worker spawn 后必须在 5 秒内完成 `health` 握手，且返回协议版本 `v:1`；版本不符立即终止。
- stdout 解析器按字节累计到换行，单行超过 64 KiB 立即判定协议违规并终止 Worker；不能无限缓存等待换行。
- stdin `write()` 返回 false 时等待 `drain`，Broker 待发送队列设上限；超过上限返回 `IO_BACKPRESSURE`，不能继续吃内存。
- 每个 pending 记录 `{resolve,reject,timer,abortCleanup,workerEpoch}`，任何完成路径统一调用一次 `settlePending()` 清理 timer/listener/map。
- 用户 Abort 时 Broker 发送 `{v:1,op:"cancel",targetId}`。Worker 若目标尚在队列则移除；若正在执行则关闭对应 slot，使库调用失败并映射 `CANCELLED`。迟到响应因 pending 已删除而被忽略并记录受限诊断。
- Worker 对 `SIGTERM` 或 `shutdown` 请求停止接单，关闭 raw monitor 和 client，等待有界时间后退出；Broker 超时才调用 `killProcessTree()`。
- 自动重启采用“每 60 秒最多 1 次”的熔断规则；只有下一次真实 I/O 才触发重启。配置页读取 health 不应造成无限拉起。

### 5.4 Worker 内部模块边界

`runtime/corn-io-worker.mjs` 是进程入口，不应成为另一个千行单体。Node-only 实现拆为：

```text
runtime/corn-io-worker.mjs       # NDJSON、dispatch、shutdown
runtime/io/contract.mjs            # Worker 侧结构验证（与 Host 共享纯 schema 时可复用）
runtime/io/connection-manager.mjs  # slot、owner、queue、idle close
runtime/io/modbus-driver.mjs       # modbus-serial 调用与 debug buffer 提取
runtime/io/raw-monitor.mjs         # serialport 字节 ring
runtime/io/error-map.mjs           # 第三方错误 -> 稳定错误码
```

依赖方向固定为：进程入口 → manager/monitor → driver；业务层 `bench-modbus.mjs` 不允许反向 import runtime 实现。`error-map.mjs` 不用中文 message 匹配作为唯一判断，优先读 `code/name/modbus exceptionCode`，message 只作最后的受限 fallback。

---

## 6. 文件改动清单

### 6.1 新增文件

位于 `dsh-corn-bench/`：

- `bench-io-contract.mjs`：请求、响应、错误码、Endpoint 指纹纯函数。
- `bench-io-broker.mjs`：Worker 启停、NDJSON、请求关联、取消和崩溃恢复。
- `bench-modbus-transport.mjs`：业务层使用的 Modbus/原始串口适配器。
- `bench-modbus-commit.mjs`：按工作区串行合并点值、告警和报文，消除异步陈旧覆盖。
- `bench-flash-provider.mjs`：Flash Provider 契约和 Provider 选择。
- `bench-flash-openocd.mjs`：内置运行时解析、OpenOCD 参数生成、进程执行和结果归一化。
- `bench-flash-output.mjs`：CLI 输出解析纯函数。
- `bench-keil-project.mjs`：Node 工程扫描、Target 枚举和工程映射纯实现。
- `bench-keil-log.mjs`：Keil 日志字节解码、错误分类和 ROM/RAM 指标。
- `bench-keil-artifact.mjs`：目标输出目录、输出名和固件产物发现。
- `bench-keil-runner.mjs`：UV4 参数、环境、进程执行和返回归一化。
- `runtime/openocd/win32-x64/**`：固定版本的 OpenOCD exe、DLL、scripts、许可证和 manifest。
- `scripts/vendor-openocd.mjs`：校验上游归档并可重复生成内置运行时目录；只供维护者执行。
- `runtime/corn-io-worker.mjs`：`modbus-serial`、`serialport`、连接池和监视器所有者。
- `runtime/io/contract.mjs`：Worker 侧请求校验。
- `runtime/io/connection-manager.mjs`：连接槽、物理 owner、串行队列和空闲回收。
- `runtime/io/modbus-driver.mjs`：唯一的 `modbus-serial` 适配层。
- `runtime/io/raw-monitor.mjs`：原始串口字节 ring。
- `runtime/io/error-map.mjs`：第三方错误归一化。
- `test/io-contract.test.mjs`
- `test/io-broker.test.mjs`
- `test/modbus-transport.test.mjs`
- `test/modbus-commit.test.mjs`
- `test/modbus-node-e2e.test.mjs`
- `test/flash-openocd.test.mjs`
- `test/flash-output.test.mjs`
- `test/keil-project-node.test.mjs`
- `test/keil-log-node.test.mjs`
- `test/keil-artifact-node.test.mjs`
- `test/keil-runner-node.test.mjs`
- `test/keil-python-parity.test.mjs`
- `test/fixtures/fake-io-worker.mjs`
- `test/fixtures/fake-openocd.mjs`
- `test/fixtures/fake-uv4.mjs`
- `test/fixtures/keil-projects/**`
- `test/fixtures/keil-logs/**`

### 6.2 修改文件

- `package.json`
- `host.js`
- `bench-actions.mjs`
- `bench-tool.mjs`
- `bench-modbus.mjs`
- `bench-portlock.mjs`
- `bench-serial-monitor.mjs`
- `bench-flash.mjs`
- `bench-run.mjs`
- `bench-check.mjs`
- `bench-store.mjs`
- `bench-settings.mjs`
- `bench-view.mjs`
- `bench-i18n.mjs`
- `bench-prompt.mjs`
- `bench-preset.mjs`
- `README.md`
- 与上述契约相关的现有测试。

### 6.3 最终删除文件

仅在相应阶段 Windows 验收通过后删除：

- `runtime/modbus_read.py`
- `runtime/modbus_write.py`
- `runtime/serial_monitor.py`
- `runtime/openocd_flash.py`
- `runtime/keil_project.py`（仅在 0.21.0 Windows/等价验收通过后）。
- `runtime/keil_build.py`（仅在 0.21.0 Windows/等价验收通过后）。

0.19/0.20 继续保留：

- `runtime/keil_project.py`
- `runtime/keil_build.py`

0.21.0 删除两者后，`bench-run.mjs::SCRIPTS` 和 `package.json files[]` 同步移除对应项；若全仓已无 Python 正式运行路径，再从 `BINDING_KEYS/emptyBindings()`、设置和自检中移除 Python binding。

### 6.4 当前代码必须顺手修正的具体缺口

这不是泛化重构清单，而是迁移时已经确认会影响正确性的代码点：

| 位置 | 当前行为 | 本计划要求 |
|---|---|---|
| `bench-modbus.mjs::modbusRead` | `all:true` 先对跨连接点位调用 `planReadBatches(filtered)`，随后用 `batches.map(() => targetCid)` 补连接，批次可能被错误发送到当前连接 | 先按 `connectionId + deviceId + unitId + functionCode` 分组，再在组内规划连续地址批次；批次对象自带目标身份 |
| `bench-modbus.mjs::connArgs` | 事务参数来自 `connection.conn.slave`，设备的 `device.unitId` 没成为传输层唯一真相 | `toTransportRequest()` 必须显式接收目标 device，并复制其 `unitId`；Worker 每次事务设置 ID |
| `runtime/modbus_read.py` / `modbus_write.py` | Host 传入 bytesize/parity/stopbits，但脚本参数没有完整实现这些配置 | Node RTU open options 必须实际使用这三个字段，并由 PTY/Windows 实机测试证明 |
| `bench-modbus.mjs` 读/写/轮询完成路径 | 异步事务持有旧 `pack.values`，不同类型操作可互相覆盖刚写入的新值 | 所有结果通过 `bench-modbus-commit.mjs` 重新读取最新工作区并按 pointId 增量合并 |
| `bench-modbus.mjs::modbusWrite` | 保存 frame 后又为返回值构造第二个 frame，时间和 ID 可能不同 | 一次事务只调用一次 `createTransactionFrame()`；同一对象用于保存、返回、任务证据 |
| `bench-modbus.mjs::frameEntry` | ID 主要由时间/label/task 拼接，快速事务可能碰撞 | 使用 Worker 返回的 epoch + sequence transactionId；模拟模式使用独立单调序列 |
| `bench-modbus.mjs` | 真实/模拟 `durationMs` 使用固定常量 | Worker/模拟 provider 均用单调时钟测量 |
| `bench-portlock.mjs` | Host Map 只能看到当前进程局部 busy，且 queued 与 physical owner 语义不完整 | Worker owner 表成为物理占用唯一真相；Host 仅保留纯端口规范化和业务提交锁 |
| `bench-serial-monitor.mjs` | 每个工作区一个 Python 进程，只返回解码文本，关闭仅 kill child | 保持“每工作区一次只监视一个 COM”的产品契约，但底层改为 Worker byte stream，返回 hex + text，并统一进程/端口释放 |
| `bench-flash.mjs` / `bench-store.mjs` | `keil.flash` 被保存但 `normalizeWorkspace()` 未稳定保留；Agent 工具也没有 flash action | 将烧录状态独立为 `workspace.flash`，增加可持久批准请求；保留 Keil 构建结构和旧下载路由 |
| `bench-keil.mjs` | scan/targets/map/build 全部先检查 Python，UV4 已绑定也不能独立编译 | 0.21.0 改为直接调用 Node project/runner，最终删除 `needPython()`，只让 build 检查 UV4 |
| `runtime/keil_build.py::read_log_text` | UTF-8 → GBK → CP936 fallback 隐藏在 Python | Node 以 Buffer 读取，BOM/严格 UTF-8 成功后再用 `iconv-lite` CP936；不得先按 UTF-8 replacement 解码后丢失原始字节 |
| `runtime/keil_build.py::run_build` | UV4 可能运行 Before/After-Build 子进程 | Node timeout/Abort 必须终止完整 Windows 进程树，而不是只结束 UV4 父进程 |
| `runtime/keil_project.py::map_project` | XML、路径限制、文件/函数/include edge 上限共同构成 UI 契约 | Node 逐字段复刻上限、排序、inside 判断与 truncation，不因 XML 库默认 array 形态改变返回 |

---

## 7. 阶段 A：冻结当前契约

### [ ] A1. 固定 0.18.4 基线证据

**文件**：无代码修改。

**执行**：

```bash
cd /Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench
npm test
npm run build:check
npm pack --dry-run
npm audit --omit=dev
git status --short
```

**验收**：

- 记录测试数量、pack 文件清单、产物大小和 audit 结果。
- 父仓与子仓均无意外改动。
- macOS 结果不得代替 Windows 结论。

### [ ] A2. 为当前读写结果建立契约测试

**文件**：`test/modbus-transport.test.mjs`、现有 `multi-conn.test.mjs`、`write.test.mjs`。

**验收**：

- 冻结成功/失败/取消返回字段。
- 冻结写前值、目标值、回读值语义。
- 冻结 `framesByConnection`、`frameId`、`transactionId`、`source`。
- 模拟模式行为不因真实后端迁移改变。

### [ ] A3. 为当前烧录确认流程建立契约测试

**文件**：`test/flash-openocd.test.mjs`、现有 `serial-monitor.test.mjs`。

**验收**：

- 未批准只返回 `needsConfirm`，不创建下载任务。
- 固件大小或 SHA256 改变时拒绝烧录。
- 批准后任务携带 `source/sessionId`。
- 超时、取消、失败均结束任务并写入稳定错误。

---

## 8. 阶段 B：Node I/O Worker 基础设施

### [ ] B1. 加入精确依赖并验证可加载

**文件**：`package.json`、锁文件。

**验收**：

- `modbus-serial`、`serialport` 使用精确版本。
- `npm pack --dry-run` 不把依赖源代码误塞进插件 `files[]`。
- macOS Node 当前版本能加载两个包。
- Windows x64 Harness 实际 Node 版本满足依赖 engines。

### [ ] B2. 实现 I/O 协议纯函数

**文件**：`bench-io-contract.mjs`、`test/io-contract.test.mjs`。

**验收**：

- 拒绝未知协议版本、未知 op、超大消息和缺少目标字段。
- Endpoint 指纹包含 mode、port/host、baudrate、bytesize、parity、stopbits、tcpPort。
- 错误对象最多保留受限长度，不泄漏堆栈或任意环境信息。

### [ ] B3. 实现 Broker 请求关联与生命周期

**文件**：`bench-io-broker.mjs`、`test/io-broker.test.mjs`、fake worker。

**验收**：

- 并发请求根据 `id` 正确关联。
- 超时/Abort 会清理监听器和 pending map。
- Worker 退出会失败全部在途请求。
- `stop()` 等待或强制结束子进程，Windows 使用进程树终止。
- 不存在未捕获 rejection 或孤儿进程。

### [ ] B4. 实现 Worker health 与按需启动

**文件**：`runtime/corn-io-worker.mjs`、`bench-io-broker.mjs`。

**验收**：

- Worker 启动后返回 Node、平台、架构、库版本和 serial native binding 状态。
- TCP 能力与 RTU native binding 状态分开报告。
- RTU 驱动失败不会使 Harness Host 启动崩溃。

### [ ] B5. 固化单例 Broker 与可测试注入点

**文件**：`bench-io-broker.mjs`、`bench-modbus-transport.mjs`、`host.js`、`bench-tool.mjs`。

**实现**：

```js
export function getCornIoBroker(options = {})
export async function stopCornIoBroker(reason = 'plugin-dispose')
export function createModbusTransport({ broker = getCornIoBroker() } = {})
```

- `modbusRead/modbusWrite/modbusPoll/openSerialMonitor` 的 `opts` 增加可选 `transport`，测试传 fake；生产调用省略时取得单例。
- `bench-tool.mjs` 不直接生成第二个 Broker；Agent 与 HTTP 导入同一个 transport factory。
- `host.js` dispose 最终调用 `stopCornIoBroker()`；stop 应幂等，重复 dispose 不抛错。

**验收**：

- 同一进程连续调用 HTTP read、Agent read、poll 只产生一个 Worker PID。
- 两个 cwd 的 COM 配置仍由同一个全局 owner 表仲裁。
- 模拟连接、Keil build、读取 `/state` 均不启动 Worker。
- dispose 后 pending map 为 0、连接池为 0、raw monitor 为 0、Worker 进程退出。

---

## 9. 阶段 C：Modbus 主站迁移

### [ ] C1. 先建立 Host → Transport 请求映射

**文件**：`bench-modbus-transport.mjs`、`bench-io-contract.mjs`、`test/modbus-transport.test.mjs`。

新增纯函数，禁止在 Worker 内读取工作区：

```js
toEndpoint(connection) // 不包含 unitId
toReadRequest({ cwd, connection, device, batch, timeoutMs })
toWriteRequest({ cwd, connection, device, point, values, timeoutMs })
```

映射规则：

- RTU endpoint 精确包含规范化 COM、baudrate、bytesize、parity、stopbits；TCP endpoint 包含 host、tcpPort。
- `unitId` 只从选中的 `device.unitId` 复制；不得从 `connection.conn.slave` 回退。
- request 携带 `configVersion`、`connectionId`、`deviceId`、FC、address/count 或 values，方便 Host 完成配置漂移校验。
- Host 与 Worker 共用 `validateIoRequest()`，但 Worker仍不信任 Host，必须再次验证范围与类型。

**验收**：

- 同一连接 device 1/2 生成相同 endpoint fingerprint、不同 unitId。
- bytesize/parity/stopbits 每个字段变化都会改变 RTU fingerprint。
- Unit 0、NaN、浮点地址、越界数量、未知 FC 在启动物理 I/O 前失败。

### [ ] C2. 修正跨连接/设备的读批次规划

**文件**：`bench-modbus.mjs`、`bench-pollplan.mjs`、`test/multi-conn.test.mjs`、`test/pollplan.test.mjs`。

先构造带身份的 scope，再在 scope 内调用现有连续地址规划：

```js
{
  connectionId,
  deviceId,
  unitId,
  functionCode,
  points,
  batches
}
```

- `modbusRead({all:true})`、单设备 read、`modbusPoll()` 共用 `planScopedReadBatches()`。
- 删除 `batchConnIds = batches.map(() => targetCid)` 这种事后补目标方式。
- 任一 batch 的 point 必须全部拥有相同 connection/device/unit/fc；开发构建下可 assert，生产返回 `CONFIG_DRIFT`。
- 每个 scope 可独立失败；返回 `results[]` 保留目标身份。是否部分成功沿用当前产品契约，不允许无提示丢弃失败连接。

**验收**：

- COM3 device d1 与 COM4 device d2 地址同为 0/FC3 时产生两个事务，分别命中各自 transport。
- 同连接 Unit 1/2 地址连续也不得合并为一个批次。
- 删除/禁用设备后旧 batch 不会落到 activeDevice。

### [ ] C3. 实现 RTU/TCP 连接槽与队列

**文件**：`runtime/corn-io-worker.mjs`、`test/modbus-node-e2e.test.mjs`。

Worker 内部建议结构：

```js
connections: Map<cwdConnectionKey, {
  endpointFingerprint,
  client,
  queueTail,
  state: 'opening' | 'open' | 'closing' | 'closed',
  lastUsedAt
}>
portOwners: Map<normalizedCom, { kind: 'modbus'|'raw', cwd, connectionId }>
```

- 创建/关闭 client 只发生在对应 slot 队列中，避免 open 与 close 交叉。
- RTU 使用 `connectRTUBuffered(port, { baudRate, dataBits, parity, stopBits })`；parity 从产品值 `N/E/O` 映射为 `none/even/odd`。
- TCP 使用 `connectTCP(host, { port })`；连接超时后销毁 client，不能把半开连接放回池。
- 每次调用前设置 timeout、unitId、`isDebugEnabled = true`；调用后读取本次 result/error 上的公开 debug 字段。
- Endpoint 漂移、Abort、串口 disconnect、TCP socket close 会使 slot 失效；下一事务创建新 client。
- 空闲回收定时器必须 `unref()`，测试可注入 clock；stop 时清空定时器并逐一 close。

**验收**：

- 同一 COM 严格串行，不同 COM 可并行；同一 TCP slot 串行，不同 endpoint 可并行。
- 同连接 Unit 1 → 2 → 1 返回各自数据，不发生 ID 泄漏。
- open 失败、事务超时、拔线、取消后下一次请求能重建或给出稳定错误，不永久卡住 queueTail。
- Worker 崩溃后 OS 自动释放端口；Broker restart 后旧 epoch 的迟到响应不能完成新请求。

### [ ] C4. 实现 FC01/02/03/04/05/06/15/16

**文件**：`runtime/corn-io-worker.mjs`、`test/modbus-node-e2e.test.mjs`。

明确映射：

| FC | 调用 | 输入限制 | 规范化返回 |
|---|---|---|---|
| 01 | `readCoils` | count 1..2000 | boolean[] |
| 02 | `readDiscreteInputs` | count 1..2000 | boolean[] |
| 03 | `readHoldingRegisters` | count 1..125 | uint16[] |
| 04 | `readInputRegisters` | count 1..125 | uint16[] |
| 05 | `writeCoil` | 单 boolean | echoed value |
| 06 | `writeRegister` | 单 uint16 | echoed value |
| 15 | `writeCoils` | 1..1968 boolean[] | quantity |
| 16 | `writeRegisters` | 1..123 uint16[] | quantity |

Worker 不做点位 scale/offset、批准、写前读取、写后回读或告警；这些仍属于 `bench-modbus.mjs`。当前写入业务继续按“写前读 → 获批目标 → 写 → 写后读 → 比较”执行，任一步失败都不能报告成功。

### [ ] C5. 建立唯一 Transaction Frame

**文件**：`runtime/corn-io-worker.mjs`、`bench-modbus-transport.mjs`、`bench-modbus.mjs`、`bench-devices.mjs`。

- Worker 返回 `transactionId`、`startedAt`、`durationMs`、`requestHex`、`responseHex`、`frameFormat`、`status/errorCode`。
- RTU 成功结果从 `result.request/result.responses` 取公开 debug buffer；错误从 `error.modbusRequest/error.modbusResponses` 尽力提取。
- TCP debug 字段标记 `tcp-normalized`，不验收 MBAP transaction id；RTU 标记 `rtu-adu`。
- Host 的 `createTransactionFrame()` 只调用一次，同一对象传给 `appendTransactionFrame()`、任务证据和 API 返回。
- `normalizeFramesByConnection()` 明确保留 `frameFormat`，并继续兼容旧 frame 没有此字段的情况。
- request/response hex 限长并校验偶数长度/十六进制；partial response 可留存但状态必须是 error。

**验收**：

- RTU 报文包含地址、FC、数据和 CRC。
- TCP 页面明确显示“归一化协议报文”，不宣称原始 MBAP。
- 一次 write 的 persisted frame、API frame、task frame 三者 transactionId 和时间完全相同。
- 高并发 10,000 个模拟事务 ID 无碰撞。

### [ ] C6. 实现增量结果提交，消除陈旧覆盖

**文件**：`bench-modbus-commit.mjs`、`bench-modbus.mjs`、`bench-store.mjs`、`test/modbus-commit.test.mjs`。

- `modbusRead/modbusWrite/modbusPoll` 不再直接保存事务开始时的整份 `values` 或 `framesByConnection`。
- commit 输入只允许 `{baseConfigVersion, connectionId, deviceId, pointValues, frame, alarmInputs}`。
- 进入 cwd commit queue 后加载最新 workspace，按 pointId 更新，frame 追加到对应 ring，再一次 `saveWorkspace()`。
- frame 即使因配置漂移无法映射点值也应保留，并标记 `CONFIG_DRIFT`；不得写入错误连接。
- commit queue 的异常必须释放 tail，后续提交仍可执行。

**验收**：

- 人工 read 与 poll 交错完成时，两批不同 pointId 的新值都保留。
- write 回读与另一个连接 poll 交错时，任何一方不覆盖另一方 frame/value。
- 事务期间删除点位后不复活该点位；frame 仍保留为可审计证据。

### [ ] C7. 切换生产入口并统一 COM 所有权

**文件**：`bench-modbus.mjs`、`bench-actions.mjs`、`bench-portlock.mjs`、Worker。

**验收**：

- 真实读写路径删除 `needPython()`、`connArgs()`、`runModbusScript()` 和 `runPythonScript()`；模拟模式不启动 Worker。
- `modbusRead`、`modbusWrite`、`modbusPoll`、Agent tool、HTTP 路由全部经过同一 transport，没有隐藏旁路。
- Host 不再维护第二份物理 COM owner；`bench-portlock.mjs` 只保留 `portKey()` 等纯函数或被彻底删除。
- COM3 被 raw monitor 占用时 COM3 Modbus 返回 `PORT_IN_USE`，COM4 正常；不同 cwd 也不能同时拥有同一物理 COM。
- Worker crash/dispose 后 owner 表、连接池和 OS 句柄全部释放。

---

## 10. 阶段 D：原始串口监视迁移

### [ ] D1. 使用 `serialport` 实现原始监视

**文件**：`runtime/corn-io-worker.mjs`。

**验收**：

- `serial.monitor.open` 接受 `cwd/connectionId/port/baudrate/bytesize/parity/stopbits`；Worker 用同一 `portOwners` 表先原子 claim，再创建 `SerialPort`。open 失败必须回滚 owner。
- 保持现有产品规则：一个 cwd 同时只打开一个 raw monitor；切换 COM 时先等待旧 port close 完成，再打开新 port。不同 cwd 也不能占用相同物理 COM。
- 以字节流为真相，每个 chunk 生成 `{id,t,hex,bytes,text}`；`text` 是 `TextDecoder('utf-8', {fatal:false})` 的容错视图，不作为协议证据。
- 维护最多 2000 条 Worker ring；`rawFeed({since,max})` 的 max 限定 1..500。单 chunk 超过上限时截断并返回 `truncated:true`，无换行数据不会无限增长。
- 如需兼容现有“行”显示，Host 适配器可按 `\r?\n` 组装 `line`，尾部残片设有字节上限并在 close 时作为最后一条 `partial:true` 返回；不得丢失残片且不得让缓存无界。
- `error/close/disconnect` 生成状态事件并释放 owner；重复 close 幂等。

### [ ] D2. 保持现有 serial HTTP 契约

**文件**：`bench-serial-monitor.mjs`、`host.js`。

**验收**：

- `/serial/open` 不再读取 Python binding。
- `/serial/feed`、`/serial/close` 路由保持兼容。
- `open/port/baudrate/error/lastId/lines` 现有字段继续存在。
- `lines[]` 继续包含 `{id,t,line}`，可向后兼容地新增 `{hex,bytes,partial,truncated}`，旧 UI 不依赖新字段也能工作。
- `serialState()` 的 `total` 来自 Worker monitor，不再来自 Host Python 子进程 buffer。
- Worker crash 后所有 monitor state 变为 `{open:false,error:'IO_RUNTIME_CRASHED'}`；重启 Worker 不自动重开 COM，必须由用户重新确认打开。

### [ ] D3. 更新 Frames/HMI 的原始报文显示

**文件**：`bench-frames-view.mjs`、必要时 `bench-hmi.mjs`。

**验收**：

- 已打开 COM 后选择器锁定真实端口。
- 页面身份使用 Worker 返回的实际 port。
- 暂停、清空、切换连接和关闭行为保持 0.18.4 契约。
- Agent 复制证据包含实际 COM 和时间范围。
- raw monitor 与 Modbus transaction 的 UI 名称明确区分：“原始串口字节流”与“Modbus 事务报文”，避免把两类数据混为同一抓包。

---

## 11. 阶段 E：自检、设置与 0.19.0 发布

### [ ] E1. 将健康状态改为能力矩阵

**文件**：`bench-check.mjs`、`bench-store.mjs`。

建议状态：

```json
{
  "capabilities": {
    "modbusTcp": { "ready": true },
    "modbusRtu": { "ready": true },
    "serialMonitor": { "ready": true },
    "keilProject": { "ready": false, "reason": "未绑定 Python" },
    "keilBuild": { "ready": false, "reason": "未绑定 UV4" },
    "openocdFlash": { "ready": false, "reason": "0.20.0 将迁移为内置运行时" }
  }
}
```

**验收**：

- 删除 `pymodbus`、`pyserial` 自检。
- 未绑定 Python 时 Modbus/串口仍为 ready。
- RTU native binding 加载失败时 TCP 可单独 ready。
- `runSelfCheck().ok` 不再要求所有可选能力都通过；增加 `requiredOk` 与分组状态，避免 Keil 未配置导致整个 Corn 红色。

### [ ] E2. 更新设置页面

**文件**：`bench-settings.mjs`、`bench-i18n.mjs`。

**验收**：

- Python 标记为“Keil 工程脚本（可选）”。
- 0.19.0 暂时保留旧 OpenOCD 输入并标记为“烧录兼容项，将在 0.20.0 移除”；不得在内置运行时尚未交付时提前切断现有烧录。
- 显示内置 Modbus/串口运行时版本与状态。
- 不允许用户手填 `serialport` 或 Node 路径；OpenOCD 旧输入只在 0.19.x 兼容期存在，并在 F8 移除。
- 不改变 Keil/UV4/Python binding 的保存键和调用行为；仅改变能力分组与说明文案。

### [ ] E3. 更新预设与 Agent 指引

**文件**：`bench-preset.mjs`、`bench-prompt.mjs`、README。

**验收**：

- 删除“先绑定 Python/pymodbus”提示。
- Agent 仍必须先读取状态、显式选择连接/设备、写点等待批准。
- 不向 Agent 暴露 Worker、npm 包或 CLI 内部细节。

### [ ] E4. 删除 Modbus/串口 Python 运行时

**文件**：`bench-run.mjs`、`package.json`、三个 Python 文件。

**前置条件**：Windows 实机验收通过。

**验收**：

- `SCRIPTS` 不再包含 modbus/serial 项。
- `package.json files[]` 不再包含三个 Python 文件。
- 全仓搜索不存在 pymodbus/pyserial/旧提示（历史计划文档和 changelog 可保留）。

### [ ] E5. 发布 0.19.0

**验收**：

- 完成第 14 节中与 0.19.0 相关的自动测试。
- 完成第 15 节 Windows Modbus/串口验收。
- 子仓提交并打版本后，父仓只更新 submodule 指针和对应说明。
- 未完成 Windows 实机测试不得发布。

---

## 12. 阶段 F：内置 OpenOCD + Node 进程执行封装

### [ ] F1. 建立 Flash Provider 契约和 fake Provider

**文件**：`bench-flash-provider.mjs`、`test/flash-openocd.test.mjs`。

**验收**：

- `bench-flash.mjs` 可注入 fake Provider 测试。
- 业务层不知道 OpenOCD exe、scripts 路径和具体命令参数。
- Provider 返回统一的 runtime、progress、result、error 结构。
- 本期 Provider 固定为 `openocd`，不提前实现多 Provider 选择 UI。

### [ ] F2. 可重复引入 xPack Windows 运行时

**文件**：`scripts/vendor-openocd.mjs`、`runtime/openocd/win32-x64/**`、`package.json`。

**执行要求**：

1. 固定上游 Release 和 Windows x64 归档文件名，不使用 `latest` URL。
2. 下载后先校验归档 SHA256，再解压到临时目录。
3. 只从已验证归档复制 exe、必需 DLL、完整 scripts、`distro-info/licenses` 和通知文件。
4. 生成包含每个收录文件 SHA256 的 `manifest.json`。
5. 维护脚本重复执行结果一致；目标目录有未识别文件时失败，不静默覆盖。

**验收**：

- `npm pack --dry-run` 明确包含全部内置运行时文件。
- 解包后的正式 npm 包可离线执行 `openocd.exe --version`。
- 删除用户 PATH 中的 OpenOCD 后仍可运行。
- `client.js` 和浏览器 bundle 不包含二进制内容或运行时解析代码。
- 许可证审查结果、上游 URL、版本和哈希有发布记录。

### [ ] F3. 实现确定性运行时解析与健康检查

**文件**：`bench-flash-openocd.mjs`、`bench-check.mjs`、`bench-store.mjs`。

**验收**：

- 只从当前插件目录解析 `runtime/openocd/win32-x64`，不搜索 PATH、注册表、常见安装目录或旧 binding。
- Windows x64 校验 exe、DLL、scripts、manifest 后执行 `--version`，返回版本与 `source: "bundled"`。
- 完整自检可重新计算文件哈希；普通页面健康检查使用缓存，且插件版本/文件 mtime 变化时失效。
- 非 Windows x64 返回 `FLASH_RUNTIME_UNAVAILABLE` 和明确平台原因，不伪装 ready。
- manifest 不匹配或 scripts 缺失返回 `FLASH_RUNTIME_CORRUPT`，不回退到系统 OpenOCD。

### [ ] F4. 实现白名单参数与固件命令生成

**文件**：`bench-flash-openocd.mjs`、`test/flash-openocd.test.mjs`。

目标 argv 结构：

```text
openocd.exe
  -s <bundled openocd/scripts>
  -f interface/<allowlisted-interface>.cfg
  -f target/<allowlisted-target>.cfg
  [-c "adapter serial <validated-serial>"]
  -c "program <tcl-quoted-firmware> [bin-address] verify reset exit"
```

**验收**：

- interface/target 必须来自现有 `FLASH_INTERFACES` / `FLASH_TARGETS` 白名单，并确认对应 cfg 实际存在。
- 固件只允许当前产品声明的 `.hex/.bin/.elf/.axf`；`.bin` 必须给出经过范围校验的起始地址。
- `adapterSerial` 可选但必须满足受限字符集和长度；多探针台架应显式配置 serial。
- OpenOCD 不提供统一、可靠的跨探针物理枚举接口，因此本期不虚构“自动列出所有探针”能力；无法唯一选择时返回稳定错误并要求配置 serial。
- 固件路径进入 `-c` 前走专用 Tcl quoting，不只依赖 `shell: false`；覆盖空格、中文、反斜杠、引号、分号、方括号、美元符号和花括号测试。
- 任意用户输入都不能生成额外 `-f`、`-c` 或 Tcl 命令。

### [ ] F5. 复用并加固 Node 进程执行封装

**文件**：`bench-run.mjs`、`bench-flash-openocd.mjs`、`bench-flash-output.mjs`、`bench-store.mjs`、`bench-journal.mjs`。

**验收**：

- 通过 `runExecFile(openocdExe, argv, ...)` 执行，始终 `shell: false`、`windowsHide: true`。
- 复用现有 timeout、AbortSignal 和 Windows `taskkill /T /F` 进程树终止；超时、取消后探针能被下一次任务重新使用。
- 为 `runExecFile` 增加可选的 stdout/stderr 增量回调，但不改变 Keil 等现有调用方返回契约。
- OpenOCD 主要进度来自 stderr；解析层按行提取连接、擦除、写入、校验、复位阶段并节流写入任务/UI。
- 当前任务 API 只有 `openTask()/finishTask()`；新增 `updateTask(home,cwd,taskId,patch)`，只允许更新 `phase/stage/progress/summary`，不得改变 task 身份、source 或 status。按 taskId 在最新 workspace 上增量更新，写入节流为最多每 200ms 一次，结束前强制 flush 最后一阶段。
- 建议阶段映射固定为 `probe 10 / connect 20 / erase 35 / program 40..80 / verify 85..95 / reset 98 / done 100`；无法获得字节进度时只更新 phase，不伪造精确百分比。
- stdout/stderr 设置总量上限和尾部环形缓存；输出过大时不会拖垮 Harness，也不会在日志中泄漏环境变量。
- 结果不能仅依赖中文文本或单一 `shutdown command invoked` 字样；综合 exit code、verify 阶段和明确错误行归一化结果。
- ENOENT、DLL 缺失、cfg 缺失、无探针、连接失败、保护、verify 失败、超时、取消分别映射稳定错误码。

### [ ] F6. 保留烧录安全与 Agent 联动边界

**文件**：`bench-flash.mjs`、`bench-journal.mjs`、`bench-tool.mjs`、`host.js`、`bench-store.mjs`。

拆成两个明确入口：

```js
requestFlash(home, cwd, input, opts)   // 只验证并创建批准请求
resolveFlash(home, cwd, requestId, decision, opts) // approve/reject
```

`requestFlash()` 必须：

1. 解析产物并计算 canonical path、size、mtime、SHA256。
2. 规范化 provider/interface/target/adapterSerial/binAddress/verify/resetAfter。
3. 写入带 TTL 的 `workspace.flash.pending[]`，生成稳定 `requestId`，记录 `source/sessionId/createdAt/expiresAt`。
4. 返回 `needsConfirm:true`，但不创建 download running task、不启动 OpenOCD。

`resolveFlash(..., 'approve')` 必须在真正启动前重新加载 request 和工作区，重新计算文件 SHA256/size，逐字段比较全部烧录参数；任何漂移都把旧请求标记 expired 并要求重新批准。`reject`/过期只结束请求，不产生物理操作。

**验收**：

- 内部导出改为中性 `requestFlash/resolveFlash`；HTTP `/keil/download` 作为兼容适配器：无 `confirm` 时调用 request，有 `confirm:true + requestId` 时调用 resolve。
- 新增中性路由 `/dsh-corn-bench/flash/request` 与 `/dsh-corn-bench/flash/resolve`；新 UI/Agent 使用中性路由，旧 UI 仍可使用兼容路由。
- 批准卡显示 Provider、interface、target、adapter serial、固件、大小、SHA256、bin address、verify/reset。
- 未批准只返回 `needsConfirm`，不启动 OpenOCD；批准后再次核对固件 SHA256、大小和所有烧录参数；缺少 requestId 的 `confirm:true` 一律拒绝，避免客户端自行伪造已批准状态。
- 已批准文件发生变化、target/interface/serial/address 发生变化时必须重新批准。
- Agent 和人工烧录共用同一入口、任务、批准、通知、时间线与进度事件，不提供 Agent 专用旁路。
- 同一工作区只允许一个烧录任务；取消、超时、插件卸载必须结束完整 OpenOCD 进程树。
- `bench-tool.mjs::ACTIONS` 增加 `flash`，但只允许创建 request 或查询状态，Agent schema 不提供 `confirm/approve` 字段；批准只能由用户 UI 调用 resolve。
- `/state` 返回当前未过期 pending flash；所以 Agent 创建 request 后，当前 Corn 页面无需刷新插件即可显示同一个批准卡。
- task/timeline 统一使用 requestId、taskId、source、sessionId；Agent 发起、用户批准后，最终任务 source 仍记录 agent，并另记 `approvedBy:'user'`。

### [ ] F7. 兼容迁移工作区 flash 配置

**文件**：`bench-store.mjs`、`bench-view.mjs`。

建议结构：

```json
{
  "flash": {
    "version": 1,
    "provider": "openocd",
    "interface": "stlink",
    "target": "stm32f4x",
    "adapterSerial": "",
    "verify": true,
    "resetAfter": true,
    "binAddress": "0x08000000",
    "pending": []
  }
}
```

**验收**：

- `emptyWorkspace()`、`normalizeWorkspace()`、`saveWorkspace()` 明确保留顶层 `flash`；不得再把烧录配置塞进 `keil` merge 后又被 normalizer 丢弃。
- 可一次性读取旧 `keil.flash.interface/target` 作为迁移输入，但保存后只写顶层 `flash`；`keil.project/target/artifact/download` 原样保留。
- pending 上限 10，过期时间建议 10 分钟；normalizer 限制字符串长度、白名单和路径，启动/读状态时清除过期项。
- 同一 artifact + 参数 + source 的重复 request 可返回原 requestId，避免 Agent 重试生成批准卡风暴；参数变化必须生成新 request 并使旧请求失效。
- 旧 OpenOCD 可执行路径不进入工作区配置，也不再影响执行。
- 未知/已移除的 interface 或 target 只进入待确认草稿，不自动烧录。
- Keil Target 名称与 OpenOCD target cfg 概念分开，避免两个 `target` 混用。
- `verify` 默认且本期固定为 true；UI 不允许关闭。`resetAfter` 若当前命令始终执行 reset，也应固定为 true 而不是提供无效开关。
- 回滚到 0.19.x 时未知顶层 `flash` 字段不得使整个 workspace 无法加载；0.20.0 迁移不修改任何 Keil 工程文件。

### [ ] F8. 更新 UI、设置与 Agent 预设

**文件**：`bench-view.mjs`、`bench-settings.mjs`、`bench-tool.mjs`、`bench-prompt.mjs`、`bench-preset.mjs`、`bench-i18n.mjs`、README。

**验收**：

- 保留 OpenOCD interface/target 选择，因为它们仍是实际烧录配置。
- 设置页删除外部 OpenOCD 路径输入，改为只读内置版本、完整性和平台状态。
- 烧录区增加可选 adapter serial 和 `.bin` address；多探针场景没有 serial 时给出明确风险提示。
- Agent 发起烧录时必须给出 artifact；多探针台架必须给出 adapterSerial，不得静默选择第一支探针。
- Agent 操作继续在当前 Corn 页面同步展示批准卡、忙碌状态、阶段进度、结果和证据。
- 文案统一为“内置 OpenOCD”，不再提示用户安装、绑定或寻找 OpenOCD 路径。
- `bench-prompt.mjs` 明确告诉 Agent：`flash` 只提交请求；返回 requestId 后停止并等待用户在 Corn 页面批准，禁止循环重提或声称已烧录。
- UI 通过已有状态刷新机制读取 pending/task；如当前机制只在用户点击后局部保存 `flash.confirm`，必须改为以服务端 workspace pending 为唯一真相。

### [ ] F9. 删除 Python 包装与旧 OpenOCD binding

**文件**：`bench-run.mjs`、`bench-store.mjs`、`bench-settings.mjs`、`bench-check.mjs`、`package.json`、`runtime/openocd_flash.py` 及相关测试。

**前置条件**：Windows OpenOCD 实机验收通过。

**验收**：

- `SCRIPTS` 不再包含 `openocd_flash.py`，正式烧录路径不调用 `runPythonScript()`。
- `BINDING_KEYS`、`emptyBindings()`、设置 UI 和自检不再保存/显示外部 OpenOCD 路径。
- `openocd_flash.py` 不再发布；其输入校验、TOCTOU、超时和错误测试已迁移到 Node 测试。
- 历史 `bindings.json.openocd` 可被读取时忽略，下一次保存时安全清除，不因旧字段使整个绑定文件失效。
- 全仓普通文案不再要求绑定 OpenOCD；历史 changelog/计划证据可保留。
- `runtime/keil_project.py`、`runtime/keil_build.py`、Python binding 和 UV4 binding 均继续存在；删除范围只允许命中 `openocd_flash.py` 与 OpenOCD binding。

### [ ] F10. 发布 0.20.0

**验收**：

- 完成内置运行时来源、哈希、许可证和 npm 包清单门禁。
- 完成第 14 节自动测试和第 15 节 Windows 实机验收。
- 发布说明明确：烧录引擎仍是 OpenOCD，只移除了 Python 包装与用户路径绑定。
- 发布说明列出已验证的 interface/target/调试器硬件矩阵；未实测组合标记为“配置保留、硬件未验证”，不得笼统宣称全部支持。

---

## 13. 阶段 G：Node 化 Keil 兼容层（0.21.0）

### [ ] G1. 冻结 Python 兼容层黄金契约

**文件**：现有 `runtime/keil_project.py`、`runtime/keil_build.py`，新增 `test/keil-python-parity.test.mjs`、fixtures。

在删除 Python 前，将当前输出固化为版本化 JSON golden：

- `scan`：正常、空目录、超过 50 个工程、超过 8 层、盘根/用户目录拒绝、大小写 `.UVPROJX`。
- `targets`：单/多 Target、空 Target、损坏 XML、错误后缀。
- `map`：Groups/Files、IncludePath、Define、缺失/二进制/越界文件、函数和 include edge、所有 capped/truncated 字段。
- `build`：exit code 0/1/2/3/11、compile error、after-build error、warning-only、Program Size、无日志、不同编码、产物组合。

Parity 比较应忽略确实不稳定的绝对临时目录和时间，只规范化路径分隔符；其余 `status/action/error/details/counts/limits/truncated/metrics/phase/errors/download` 必须深度一致。

**验收**：

- Python 旧实现对 fixtures 生成 golden；Node 新实现只能消费，不得人工修改 golden 来掩盖差异。
- 发现当前 Python 明确 bug 时先新增独立失败测试和 ADR，再决定两端同时修复；不能在迁移提交里无记录改变契约。

### [ ] G2. 实现安全的 `.uvprojx` 扫描与 XML 读取层

**文件**：`bench-keil-project.mjs`、`test/keil-project-node.test.mjs`。

建议内部纯函数：

```js
scanKeilProjects(root, { maxResults = 50, maxDepth = 8 })
parseUvprojx(buffer, sourcePath)
listKeilTargets(projectModel)
```

实现要求：

- 目录扫描使用 `lstat/opendir`，不跟随目录 symlink/junction；跳过 `.git/.svn/.hg/node_modules/.venv/venv/__pycache__`。
- 保留 broad-root 拒绝：盘根、用户主目录、`Users/Windows/Program Files/Program Files (x86)`；所有候选最终走 `requireKeilProject()`/workspace 边界。
- 深度和数量必须在遍历过程中限流；达到 51 个即返回 `too_many_projects` 与前 50 个排序结果，不先扫描整盘。
- XML 输入设置字节上限（建议 8 MiB）；禁用实体处理/外部引用，不解析 DTD，不允许 XML 触发网络或文件读取。
- `fast-xml-parser` 对 `Targets.Target`、`Groups.Group`、`Files.File` 等节点强制数组语义；单元素与多元素工程返回形状一致。
- 解析层输出内部 model，不把第三方 parser 对象泄漏给业务/API。

### [ ] G3. 等价迁移 Target 与工程映射

**文件**：`bench-keil-project.mjs`、`test/keil-project-node.test.mjs`、fixtures。

完整复刻当前限制：`MAX_MAP_FILES=500`、Include/Define 各 80、include edge 400、单文件函数 80、总函数 1200、单源文件读取 256 KiB。

- 路径解析以 project directory 为基准，最终用 `realpath/relative` 做 inside 判断；`..`、symlink 和 Windows 大小写差异不能逃逸 workspace。
- 文本读取按 UTF-8 BOM → 严格 UTF-8 → CP936；包含 NUL 或 textish 比例不足仍标记 binary。
- Group/File 顺序与 `.uvprojx` 保持一致；scan 结果按 path 稳定排序。
- Include/Define 去重保持首次出现顺序；返回 `counts/limits/truncated` 与 Python 版一致。
- 函数提取继续明确标记为启发式索引，不扩张成 C/C++ 语义分析器；宏、模板、复杂声明漏识别不影响构建正确性。

**验收**：Python/Node parity fixtures 全部一致，中文路径、反斜杠、相对 include、同名头文件和 workspace 外路径均有用例。

### [ ] G4. 实现确定性日志解码与分类

**文件**：`bench-keil-log.mjs`、`test/keil-log-node.test.mjs`、`test/fixtures/keil-logs/**`。

建议接口：

```js
decodeKeilLog(buffer) -> { text, encoding }
classifyKeilLog(text) -> { metrics, errors, compileErrors, afterBuildErrors, phase, excerpt }
```

- 始终以 Buffer 读取；先识别 UTF-8 BOM，再用 fatal UTF-8 验证，失败后使用 `iconv-lite.decode(buffer,'cp936')`。
- 不使用已替换为 `�` 的 UTF-8 字符串再次猜编码。
- 迁移现有 ERROR/AFTER_BUILD/COUNT_LINE/SIZE_LINE 规则、最多 8 条错误、excerpt 8000 字符和最后 60 行语义。
- `Program Size: Code/RO-data/RW-data/ZI-data` 继续计算 `flashBytes = Code + RO-data + RW-data`、`ramBytes = RW-data + ZI-data`。
- 返回中增加内部诊断 `encoding` 可以进入 details，但不改变 UI 成功判断。

**验收**：UTF-8、UTF-8 BOM、GBK/CP936、混合无法解码字节、CRLF、超长日志和无最终换行均有测试；不得因中文错误信息解码失败把 build 误判成功。

### [ ] G5. 等价迁移产物发现

**文件**：`bench-keil-artifact.mjs`、`test/keil-artifact-node.test.mjs`。

```js
resolveTargetOutput(projectModel, targetName)
collectKeilArtifacts(projectPath, targetName)
```

- 只读取目标 `TargetOption/TargetCommonOption/OutputDirectory/OutputName`；target 不存在时保持当前 fallback 行为。
- 相对 OutputDirectory 以工程目录解析；不修改目录，不搜索整个 workspace，不猜测任意同名固件。
- 返回 `axf_file/elf_file/hex_file/bin_file/debug_file/flash_file/output_dir`，再由现有 `pickArtifact()` 选择用户要求类型。
- 文件必须在 build 结束后重新 stat；任务开始前残留旧产物不能仅凭存在就证明本次 build 成功。

**验收**：无输出目录、空 OutputName、中文/空格路径、hex+axf、只有 bin、target 不存在、旧产物残留都有测试。

### [ ] G6. 实现 UV4 Node Runner

**文件**：`bench-keil-runner.mjs`、`bench-run.mjs`、`test/keil-runner-node.test.mjs`、`test/fixtures/fake-uv4.mjs`。

唯一允许的 build argv：

```text
UV4.exe -b <absolute-project.uvprojx> -j0 -o <absolute-task-log> [-t <exact-target-name>]
```

- `uv4/project/logDir` 都先走路径验证；target 作为单独 argv，不允许附加任意 UV4 option。
- 使用 `runExecFile(bindings.uv4, argv, {cwd:projectDir, timeoutMs:600000, signal, windowsHide:true})`，始终 `shell:false`。
- PATH 只在副本上前置当前 UV4 安装下已存在的 `ARM/ARMCC/Bin`、`ARM/ARMCLANG/bin` 与 UV4 目录；不得修改 `process.env`。
- timeout/Abort/dispose 使用 `killProcessTree()` 结束 UV4 及 Before/After-Build 后代进程；任务结束后移除所有 listener/timer。
- 以 UV4 exit code + 日志分类共同决定结果：0/1 可成功，2/3 失败，11/12/13/15/20 映射稳定错误；任何 compile/after-build/log errors 均不能因 exit code 0 而成功。
- stdout/stderr 仅作有界诊断，build log 才是主要证据；日志缺失时不得伪造 metrics。

### [ ] G7. 切换 `bench-keil.mjs`，保持 Host/Agent/UI 契约

**文件**：`bench-keil.mjs`、`bench-actions.mjs`、`host.js`、`bench-tool.mjs`、现有 Keil/build 测试。

- `keilScan/keilTargets/keilMap/keilBuild` 导出签名不变，HTTP 路由和 Agent `build/map/select` action 不变。
- scan/targets/map 不再读取 bindings，也不要求 Windows；macOS 开发环境可对 fixture 工程执行只读解析。
- build 只检查 `bindings.uv4`，保持 `hasRunning(workspace,'build')`、`source/sessionId`、任务、取消、日志保留和 `keil.download` 保存语义。
- `bench-keil.mjs` 只编排任务，不重新实现 XML、日志或 argv 细节。
- Agent build 继续写入当前 Corn 页面的任务、时间线、日志、产物和证据，不创建 Agent 专用 build 路径。

**验收**：现有 UI/HTTP/tool 消费方无需改返回字段；Python 与 Node 对同一输入的规范化结果深度一致。

### [ ] G8. 移除 Python binding 和两段兼容脚本

**文件**：`bench-run.mjs`、`bench-store.mjs`、`bench-check.mjs`、`bench-settings.mjs`、`bench-i18n.mjs`、`package.json`、README、两段 Python 文件。

**前置条件**：G1-G7、完整自动测试和第 15.5 节 Windows UV4 实机验收全部通过。

**验收**：

- `SCRIPTS` 和 `package.json files[]` 不再包含 `keil_project.py/keil_build.py`。
- 全仓正式运行代码不再 import/call `runPythonScript()`；若已无调用，删除该函数和 Python script registry。
- `BINDING_KEYS/emptyBindings()`、设置 UI、自检、预设和 README 删除 Python binding；历史 `bindings.json.python` 读取时忽略，下一次保存时清除。
- UV4 binding 继续保留并明确显示“Keil MDK 外部组件”；自检区分 `uv4Bound/uv4Exists`，不把 UV4 描述成插件内置。
- `fast-xml-parser/iconv-lite` 加入精确生产依赖和 lockfile，`files[]` 加入四个 Node 模块；测试 fixtures 留在仓库测试范围，不进入正式包。

### [ ] G9. 发布 0.21.0

**验收**：

- 完成第 14 节全部自动/包测试和第 15.5 节 Windows Keil 验收。
- 从实际 `.tgz` 安装后，在没有 Python 的 Windows 机器完成 scan → targets → map → build → artifact → OpenOCD request 全链路。
- 发布说明明确“Node 化的是 Keil 兼容层，不是内置或替代 Keil”；列出验证的 MDK/UV4、ARM Compiler 与 Device Pack 组合。
- 未绑定 UV4 时 scan/targets/map 仍可用，build 返回明确 `UV4_NOT_CONFIGURED`，不影响其他 Corn 能力。

---

## 14. 测试设计

### 14.1 无硬件自动测试

必须覆盖：

- NDJSON 拆包、粘包、乱码、超长行。
- Worker 启动失败、运行中崩溃、重启和 stop。
- 并发 COM3/COM4 不串线。
- 同一 COM 的事务严格串行。
- Endpoint 修改触发旧连接关闭。
- Unit ID 切换不泄漏。
- `all:true` 跨连接/跨设备不会把 batch 路由到 active connection。
- read/poll/write 交错完成只增量合并目标 pointId，不发生 values/frame 陈旧覆盖。
- 同一事务的 API、持久化 frame、task evidence 共用一个 transactionId/frameId。
- FC01/02/03/04/05/06/15/16。
- Modbus exception、CRC、超时、取消、端口占用、拔出。
- request/response Hex 和现有 frame 契约。
- pause/clear/selection 与 Worker 增量数据交互。
- fake OpenOCD 的成功、verify 失败、无探针、连接失败、cfg 缺失、超时、取消、输出过大和非 UTF-8 容错。
- 参数注入测试：固件路径和 adapter serial 覆盖空格、引号、`&`、`|`、反引号、`;`、`$`、`[]`、`{}`，既不能启动 shell，也不能注入额外 Tcl 命令。
- 固件 TOCTOU：确认后替换文件必须失败。
- Agent `flash` 只能创建 pending request；Agent 无法传入 approve，UI 批准后才启动 fake OpenOCD。
- pending flash 过期、重复请求去重、参数漂移失效和服务端重启后恢复。
- 多会话 Agent 聚焦和任务来源仍按 cwd/session 隔离。
- 内置 OpenOCD manifest 正常、缺文件、被篡改和版本不一致。
- `runExecFile` 增量回调不破坏既有 Keil/Python 调用，timeout/Abort 监听器均被清理。
- `.uvprojx` scan/targets/map 的 Python/Node golden parity。
- XML 单/多节点数组、损坏/超大 XML、实体/DTD、symlink/junction 逃逸和 broad-root 拒绝。
- Keil 日志 UTF-8 BOM、严格 UTF-8、CP936、compile/after-build、error/warning/Program Size 分类。
- fake UV4 argv 注入、exit code、缺日志、旧产物、timeout、Abort 和 Windows 进程树终止。
- Agent/HTTP/UI 的 build 返回、task、timeline、logFile、download 与旧契约一致。

### 14.2 TCP 集成测试

在无串口环境中启动本地受控 Modbus TCP Server，验证：

- 真实 Node Transport 完成读写。
- 写后回读一致。
- 断开后下一请求能恢复或返回稳定断线错误。
- TCP 读写命中正确 Unit ID 和 FC；frame 标记 `tcp-normalized`，测试不得把 debug buffer 误断言为原始 MBAP。
- 若测试 Server 需要验证真实 MBAP，只能在 Server 侧抓取并断言；该抓包属于测试证据，不作为 0.19.0 UI frame 契约。

测试不得依赖外网或长期后台服务；每个 test 自行启动并在 finally 中关闭 Server/Worker。

### 14.3 包检查

```bash
cd /Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench
npm test
npm run build:check
npm pack --dry-run
npm audit --omit=dev
```

检查：

- 新增运行时和模块全部列入 `files[]`。
- `fast-xml-parser`、`iconv-lite` 为精确生产依赖并存在于 lockfile；实际 `.tgz` 安装后可离线加载。
- `client.js` 不包含 `serialport`、`modbus-serial`、OpenOCD 二进制内容或 Node-only import。
- npm 包不重复收录生成物。
- npm 包包含 OpenOCD exe、所需 DLL、完整 scripts、manifest 和许可证目录，解包后路径与 resolver 一致。
- 生产依赖无已知高危漏洞。
- 0.21.0 包中不再包含任何 `runtime/*.py`；若历史文档提及 Python，不得被误收入运行时代码路径。

---

## 15. Windows 干净环境验收

以下结果必须单独记录，不能用 macOS 推断：

### 15.1 安装

- Windows 10 x64 一台。
- Windows 11 x64 一台。
- 记录实际 Harness、Node、pnpm、插件和内置 OpenOCD 版本。
- 机器不预装 Python、pymodbus、pyserial 或系统 OpenOCD，并确认 PATH 中没有 OpenOCD。
- 从实际发布 `.tgz` 或 registry 安装，不使用源码 link。
- 启动后 Modbus TCP/RTU/串口自检 ready。
- 内置 OpenOCD 能自动解析、通过 manifest/`--version` 自检，用户不填写路径。

### 15.2 Modbus RTU

- 至少一个 USB-RS485 适配器和一个真实/受控 Modbus 从站。
- 创建 COM 连接、设备和点位后直接轮询。
- FC03 读取、FC06 写入、写后回读。
- 至少验证一次线圈 FC01/05 或 FC15。
- 串口报文显示真实 TX/RX，并位于正确 COM 内部页签。
- 占用 COM 的串口助手存在时返回 `PORT_IN_USE`。
- 拔出/插回适配器后不留下假连接或死锁。
- COM10 以上路径正确。

### 15.3 多连接与 Agent 联动

- COM3、COM4 同时配置，内容不串线。
- Agent 对 COM3 读点时，UI 的 COM3 点值、报文、任务和时间线同步变化。
- Agent 写点必须等待批准；拒绝后无物理写入。
- Agent 对多个设备未给 deviceId 时返回明确歧义错误。
- 关闭/切换会话后其他 cwd 不抢焦点、不继承报文。

### 15.4 OpenOCD 烧录

最低硬件矩阵：

- ST-LINK/V2 或板载 V2-1。
- ST-LINK/V3。
- CMSIS-DAP 探针。
- 一块常见 STM32F1/F4/G0 板。
- 至少一块现有非 STM32 白名单目标板，优先 nRF52 或 RP2040；没有硬件时必须明确标记未验证，不得从 cfg 存在推断烧录成功。

场景：

- 内置 `openocd.exe --version` 与 scripts 路径解析。
- 单探针且 serial 为空时完成烧录。
- 两支同类探针时按 adapter serial 精确选择；无法唯一选择时不得静默烧错设备。
- ST-LINK + STM32 `.hex` 烧录、verify、reset。
- CMSIS-DAP + 已支持目标完成至少一次 `.hex` 或 `.elf` 烧录。
- `.axf/.elf` 在 OpenOCD/目标组合实际支持时直接烧录；不支持时返回明确格式/目标错误。
- `.bin` 缺少地址时拒绝；地址正确时烧录。
- 固件确认后被替换时拒绝。
- verify 失败不会报告成功。
- 目标断电、探针拔出、芯片读保护、interface/target 不匹配时错误可理解。
- 中文/空格路径完成一次真实烧录；危险 Tcl 字符路径按实现契约安全处理或明确拒绝，不能执行额外命令。
- 取消/超时后 OpenOCD 进程树和探针都被释放。
- Agent 发起烧录时批准卡、任务、通知和时间线完整。

### 15.5 Node Keil 兼容层

环境矩阵至少包含：

- Windows 10 x64 + 一套实际仍支持的 MDK5/UV4。
- Windows 11 x64 + 一套实际仍支持的 MDK5/UV4。
- 至少一个 Arm Compiler 5 工程和一个 Arm Compiler 6 工程；无法取得时必须把缺失组合标为未验证。
- 至少两个不同 Device Family Pack/芯片系列工程。
- 系统不安装 Python，PATH 中也没有 Python；插件只绑定 `UV4.exe`。

验收流程：

1. 安装实际发布 `.tgz`，扫描含多个 `.uvprojx` 的具体 workspace。
2. 枚举多个 Target，切换 Target 后工程映射的 Group/File/Include/Define 与 µCorn 工程一致。
3. 对中文、空格和 COM/盘符无关的常见 Windows 路径完成 build。
4. 分别验证 warning-only、compile error、link error、after-build error 和成功构建；UI/Agent 的 phase、errors、metrics、日志不能误判。
5. 成功构建后发现正确 `.hex/.bin/.axf/.elf`，不得选择上一轮残留或其他 Target 的同名产物。
6. Agent 发起 build 时 Corn 页面同步显示任务、来源、日志、产物和证据；取消后 UI 与 Agent 返回一致。
7. 构造超过 10 分钟的 fake/可控构建验证 timeout；取消/卸载后 Task Manager 中无 UV4 或 After-Build 孤儿进程。
8. 未绑定 UV4 时 scan/targets/map 可用，build 明确失败且不创建假成功产物。
9. Python binding 已从设置和自检移除，现有旧 `bindings.json.python` 不导致启动失败。
10. 用构建产物继续提交内置 OpenOCD flash request，确认 Keil Node 化没有破坏 0.20.0 烧录批准链。

每个实机记录必须包含插件、Harness、Node、MDK/UV4、Compiler、Device Pack、工程 fixture commit、Target、exit code、日志编码、产物 SHA256 和结果。不能用 fake UV4 或 macOS XML 测试代替本节。

---

## 16. 发布与回滚原则

### 16.1 发布门禁

每个版本必须同时满足：

- 自动测试通过。
- build check 通过。
- pack dry run 清单正确。
- 生产依赖审计通过。
- 父/子仓无意外脏文件。
- 对应 Windows 实机矩阵通过。
- README、设置文案、Agent 预设和版本说明一致。

### 16.2 回滚

- `0.19.0` 发布前保留 0.18.4 tag/tarball，可整体回滚版本；不在正式包中保留隐藏 Python Modbus 双后端。
- `0.20.0` 发布前保留 0.19.x，可整体回滚；不在正式包中保留隐藏的 Python 烧录旁路或系统 OpenOCD PATH 回退。
- `0.21.0` 发布前保留 0.20.x，可整体回滚；正式包只保留 Node Keil 后端，不保留运行时双后端开关。回滚版本仍可读取未变化的 keil workspace/binding 数据。
- 工作区数据迁移必须向前兼容：旧数据可读；回滚时不能因为新增字段导致整个 workspace 无法加载。
- 任何失败都不得修改已批准固件、点表或连接配置。

### 16.3 建议提交切片（必须逐片保持绿色）

不要把全部迁移堆成一个提交。按以下顺序实施，每片完成后执行对应定向测试，再执行完整 `npm test`：

1. **契约与回归护栏**：新增当前 read/write/flash/serial 返回契约测试，不改生产后端。
2. **I/O protocol + fake Worker**：只加入 contract、Broker、生命周期测试；生产仍走 Python。
3. **Node TCP vertical slice**：先让注入式 Transport 通过本地 TCP Server，仍不切生产默认。
4. **RTU driver + owner/queue**：加入 serialport、PTY/loopback 自动测试和 Windows 最小冒烟。
5. **scope batching + commit layer**：先修多连接误路由与陈旧覆盖，再切 read/poll。
6. **write + readback 切换**：保留批准边界，验证 frame 单一身份。
7. **raw monitor 切换**：保持 HTTP/UI 兼容，统一 owner 后再删 Python monitor。
8. **0.19 Windows 验收与删除旧 Modbus/serial Python**。
9. **Flash Provider + fake OpenOCD**：先实现 request/resolve、pending 和 Agent action，不引入真实二进制。
10. **vendor OpenOCD + resolver**：单独提交二进制、manifest、许可证和维护脚本，便于审计体积与来源。
11. **OpenOCD 生产切换**：旧 `/keil/download` 只做兼容适配；Keil build 保持不变。
12. **0.20 Windows 验收与删除 `openocd_flash.py`/外部 OpenOCD binding**。
13. **Keil parity fixtures**：先冻结 Python scan/targets/map/build golden，不改生产入口。
14. **Node project/log/artifact 纯模块**：完成 XML、路径、编码与产物的无进程测试。
15. **fake UV4 Runner**：验证 argv、环境、exit code、timeout、Abort 和进程树。
16. **Keil 生产切换**：保持 API/任务/UI/Agent 契约，只去掉 Python 检查和调用。
17. **0.21 Windows 验收与删除两段 Keil Python/Python binding**。

每片的最小命令：

```bash
cd /Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench
node --test test/<本片相关测试>.test.mjs
npm test
npm pack --dry-run
git diff --check
```

涉及 UI module 时必须运行 `npm run build` 重新生成 `client.js`，随后 `npm run build:check`；不得手改生成的 `client.js`。涉及 OpenOCD runtime 的提交还必须解包实际 `.tgz`，从解包目录运行 resolver/`openocd.exe --version`，不能只检查源码目录。

### 16.4 代码审查硬门禁

以下任一项出现即不应合并：

- 新的真实 I/O 路径直接 import `runPythonScript()`。
- `bench-modbus.mjs` 直接访问 `modbus-serial` 或 `serialport`。
- 使用 `_port`、`_transactions` 等第三方私有字段抓包。
- 任何跨连接 batch 不携带完整 connection/device/unit identity。
- async 事务完成后保存事务开始时捕获的整份 `values`/`framesByConnection`。
- Agent schema 出现 `approve/confirm:true`，或批准请求只存在浏览器局部状态。
- OpenOCD 使用 `shell:true`、拼接字符串命令、搜索 PATH 回退或接受任意 cfg/Tcl 片段。
- 在 0.19/0.20 提交中修改 Keil 扫描、构建、Target 解析或 UV4 binding；0.21.0 必须从独立 parity 提交开始。
- Node Keil parser 写回 `.uvprojx/.uvoptx`、跟随 symlink 逃逸 workspace，或接受 Agent 注入任意 UV4 参数。
- Node Keil build 只杀 UV4 父进程、只看 exit code、忽略 after-build 错误或用旧产物报告成功。
- macOS fake/自动测试被描述成 Windows 实机通过。

---

## 17. 最终完成定义

只有同时满足以下条件，计划才算完成：

- [ ] 插件真实 Modbus/串口路径中不存在 Python 调用。
- [ ] 插件烧录路径中不存在 Python 调用或用户 OpenOCD 路径绑定，实际引擎为插件内置 OpenOCD。
- [ ] 未安装 Python 的 Windows 用户安装插件后可直接使用上位机 RTU/TCP 功能。
- [ ] xPack OpenOCD Windows x64 运行时随插件安装并通过来源、哈希、完整性和许可证门禁。
- [ ] 用户无需绑定 Node、serialport、Python、pymodbus、pyserial 或 OpenOCD 路径；Keil build 只保留外部 UV4/MDK 前置条件。
- [ ] Agent 操作仍在 Corn UI、报文、任务、时间线和证据中同步显示。
- [ ] 写点和烧录批准边界没有下降。
- [ ] 多 cwd、多 COM、多设备、多探针不存在静默误路由；OpenOCD 无法可靠枚举的探针场景已明确要求 adapter serial。
- [ ] Windows 10/11 x64 实机验收有版本、硬件和结果记录。
- [ ] Keil scan/targets/map/build 正式路径已经 Node 化，Python binding 和全部 `runtime/*.py` 已从正式包删除。
- [ ] Node Keil 层与旧 Python golden 契约一致，真实 UV4/Compiler/Device Pack Windows 矩阵有记录。
- [ ] 文档明确插件没有内置或替代 Keil；用户仍需合法安装、授权并绑定 UV4/MDK 与相应工具链/Pack。

---

## 18. 参考

- modbus-serial：https://github.com/yaacov/node-modbus-serial
- Node SerialPort 平台支持：https://serialport.io/docs/guide-platform-support/
- OpenOCD 官方仓库：https://github.com/openocd-org/openocd
- xPack OpenOCD Releases：https://github.com/xpack-dev-tools/openocd-xpack/releases
- xPack OpenOCD 安装与便携归档：https://xpack-dev-tools.github.io/openocd-xpack/docs/install/
- xPack OpenOCD 许可证说明：https://xpack-dev-tools.github.io/openocd-xpack/docs/getting-started/
- Keil µCorn 命令行与 ERRORLEVEL：https://www.keil.com/support/man/docs/uv4/uv4_commandline.asp
- Keil µCorn 工程文件类型：https://www.keil.com/support/man/docs/uv4cl/uv4cl_b_filetypes.htm
- Node `child_process.execFile`/AbortSignal：https://nodejs.org/api/child_process.html
- Node `TextDecoder` 与 ICU 编码能力：https://nodejs.org/api/util.html
- DeepSeek Harness 插件安装：https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md
