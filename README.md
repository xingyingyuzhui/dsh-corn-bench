<img src="assets/corn-icon.png" width="96" alt="Corn" align="right">

# Corn · dsh-corn-bench

作者：[xingyingyuzhui](https://github.com/xingyingyuzhui) · 仓库：<https://github.com/xingyingyuzhui/dsh-corn-bench> · 授权：[PolyForm Noncommercial 1.0.0](LICENSE.md)（非商业授权）

包名 `dsh-corn-bench`，Agent 预设 **Corn模式**（id `corn-bench`），工具 `corn_bench` / `corn_debug`，数据目录 `$DSH_HOME/corn-bench/`。

从 0.30.2 及更早版本升级：先卸载旧插件，再装 `dsh-corn-bench`。首次启动会把旧数据目录整体搬到 `$DSH_HOME/corn-bench/`（绑定、工作区、点表、日志、Agent 权限都在里面）；界面的导航偏好也会自动迁移。已有 `corn-bench/` 时不覆盖。旧预设不会被自动删除，新建 Session 时选 **Corn模式**。

版本见 [CHANGELOG.md](CHANGELOG.md)。支持 DSH `0.1.5-rc.1` – `0.2.1-rc.2`（三轨：≤0.1.6 目录式；0.1.7 声明式；0.2.x 声明式，契约钉 `0.2.1-rc.2`）。DSH 0.2.x 需要 Node 24+。

会话区里的调试 / 上位机 / 监控工作台。跟 Claw 无关。同一份现场状态同时给界面和当前 Session 的 Agent 用。

| 面 | 现在能做什么 |
|---|---|
| **Web** | 完整工作台。Host 走 Connection Fetch；有 `webServer` 时额外挂旧 RPC 与 Agent HTTP 桥。 |
| **Desktop** | 同一套 UI / Agent / TCP / 仿真，无 Corn 监听端口。实验室用本地 tarball 安装。 |
| **尚未宣称** | 官方 Desktop 产品安装（npm `name@version` 尚未发布）；官方 Desktop 完整 Modbus RTU（`serialport` 不在 Desktop `allowBuilds`）；Windows + STM32 / Keil 真机。 |

验收矩阵：[`docs/ACCEPTANCE_NATIVE_WEB_DESKTOP.md`](docs/ACCEPTANCE_NATIVE_WEB_DESKTOP.md)。

完整变更见 [CHANGELOG.md](CHANGELOG.md)。支持 DSH `0.1.5-rc.1` – `0.2.1-rc.2`（三轨：≤0.1.6 目录式；0.1.7 声明式；0.2.x 声明式，契约钉 `0.2.1-rc.2`）。DSH 0.2.x 需要 Node 24+。

## 安装

### Web

```sh
dsh plugin --profile web add github:xingyingyuzhui/dsh-corn-bench
```

本机开发请 `npm pack` 再 add 那个 `.tgz`，不要 `link:` 源码树（会把 `node_modules/`、`coverage/` 整棵链进 profile）：

```sh
npm pack
dsh plugin --profile web add ./dsh-corn-bench-*.tgz
```

装完重启 `dsh web`。打开 **调试** / **上位机** / **监控**，或 **设置 → Corn**。新会话选 **Corn模式**。

### Desktop

官方产品安装用打包应用里的 **应用 → 桌面插件…**。它接受包名、Git 地址、tarball 或本地绝对路径，所以已发布的版本可以立刻装 —— 把下面 `${version}` 换成 [Releases](https://github.com/xingyingyuzhui/dsh-corn-bench/releases) 里最新标签的版本号：

```
github:xingyingyuzhui/dsh-corn-bench#v${version}
```

或下载对应 Release 的 `dsh-corn-bench-${version}.tgz`（同目录有 `.sha256`），把它**绝对路径**填进同一个框。裸包名 `dsh-corn-bench` 需要 registry 上有这个包 —— 当前 npmjs.org 仍是 404。

本机实验室（先 **Cmd+Q** 完全退出 DeepSeek Harness）：

```sh
node scripts/probes/install-desktop-local.mjs
```

不要执行 `dsh plugin --profile desktop`。Desktop profile 由 Electron 独占。实验室脚本走 profile 内 `file:` tarball，只算 lab 证据，不算官方产品安装。

## 卸载

```sh
dsh plugin --profile web remove dsh-corn-bench
```

Desktop 在 **桌面插件…** 里移除。绑定写在 `$DSH_HOME/corn-bench/bindings.json`。用户预设 **Corn模式** 不会随卸载删除。

## 三个工作区

会话区标签：**调试**、**上位机**、**监控**。

- **调试**：选 `.uvprojx`（暂不支持 `.uvmpw`）、Target、编译、烧录；右侧工程结构；运行调试（GDB/MI + OpenOCD）。
- **上位机**：连接 / 设备 / 点位。RTU 扫描本机 COM；真实读写走内置 Node Modbus（仿真不启动 Worker）。
- **监控**：可视化、告警、串口报文、操作记录。点表值 / 可视化 / 告警 / 报文共享同一实时来源。

设置页 **Corn**：绑定 Keil UV4（纯 Node，不需要 Python）、OpenOCD（外部兼容绑定）、Modbus/串口运行时。一键 **运行自检**。

连接状态只看真实链路：未连接 / 连接中 / 已连接 / 断开中 / 连接异常。只使用绑定路径，不在磁盘上搜索。

## Corn模式

宿主 `dsh-corn-bench` 顶层只注入 `connection`，UI 发 `POST /api/corn-bench/dispatch`。旧 `/corn-bench` RPC 与 Agent HTTP 命令桥仅在有 `webServer` 时挂载。Agent 工具是另一条 loader：`dsh-corn-bench/agent`（`export name` 为 `dsh-corn-bench-tools`），由 **Corn模式** 预设插入，不和宿主同名。

DSH `0.1.5-rc.1`–`0.1.6` 的 Corn模式是目录式预设：首次安装或升级后执行 `node scripts/seed-preset.mjs`（或设置页重建），写入 `$DSH_HOME/.agent-presets/corn-bench/`。DSH `0.1.7+` 由 Host 自动声明注册，无需 seed。**新建 Session 后生效**。

`corn_bench` 只出现在这个预设里。Agent 需要时自己调用，不把现场状态塞进每一轮系统提示。

| action | 作用 |
|---|---|
| `status` | 当前工程、Target、下载包、进行中任务、操作记录、连接真实状态与点位 runtimeStatus |
| `ls` | 列出工作区内目录和 `.uvprojx`（不含 `.uvmpw`） |
| `select` | 选定工程 |
| `build` | 编译 |
| `map` | 当前 Target 的组、源文件、包含关系和函数名；超出上限时带 `truncated` |
| `read` | 不传 address 则读点表全部段；传入则单次读 |
| `write` | 写线圈 / 保持寄存器：`values` 长度 1 走 FC05/06，大于 1 走 FC15/16；写入后自动回读。**Agent 写点需界面批准**（上位机确认卡，5 分钟内有效） |
| `manual` | 请求用户完成现场人工操作；`text` 必填 |
| `visualization` | `op=list\|get\|add\|update\|remove\|layout`。`layout` 必须带 `expectedConfigVersion` 与 `items[{id,x,y,w,h}]`；`CONFIG_DRIFT` 后重新 list/get 再提交 |

另有 `corn_debug`（与 `corn_bench` 隔离）和 `debug_snapshot`。

## 能力说明

**编译与烧录。** 失败编译给出错误数、前几条原文、阶段和日志路径；「查看完整日志」在应用内打开（尾部 256KB，可搜索）。烧录走确认卡：目标、固件、大小、sha256，批准后才 `program verify reset exit`。OpenOCD 只烧录哈希校验后的固件快照。

**上位机。** 流程：创建连接 → 配置 COM/TCP → 连接 → 添加设备（名称 + 连接内唯一 Unit ID）→ 设备卡片内加点位（唯一键 = 连接+设备+功能码+地址）→ 开始采集。功能码 01/03 可写（FC05/06 单点、FC15/16 批量），02/04 只读。写入后显示 **写前值 → 目标值 → 回读值**。超时返回 `WRITE_OUTCOME_UNKNOWN`，不要直接重试，先读回再决定。连接 / 断开中不可改端点参数。也支持从机（Slave）监听，不启动主动轮询。

**串口报文。** RTU 记 ADU（含 CRC）；TCP 显示协议归一化报文。该页只展示用过的 RTU 通道，负责筛选查看，不负责打开串口。串口由上位机连接持有；Windows 下 COM 独占，占用返回 `PORT_IN_USE`。

**点表 / 告警 / 可视化。** 点位可带倍率、偏移、单位、告警上下限；CSV 导入导出。监视开关决定是否进入可视化数据源（每点 600 样本环形缓存）。告警开关关闭后立即把已激活告警转为恢复。可视化以组件为中心：GridStack；曲线/柱状图优先 ECharts（无运行时则 uPlot / CSS）；数值卡/开关。关联点位只列已监视且类型匹配的点；数据源失效时组件保留并提示修复。

**写入边界。** Host 是工作区唯一写者。配置走 `mutateConfig`（成功才递增 `configVersion`）；实时值/趋势/告警/报文走同一把 `runExclusive` 队列上的 `mutateRuntime`。Agent 改配置无需确认卡；真实线圈/寄存器写入、烧录、复位仍需界面批准。Agent 与 Host 分进程时走 HTTP 命令桥；`system.ping` 无副作用。失败返回 `HOST_UNAVAILABLE` / `HOST_TIMEOUT` / `HOST_UNAUTHORIZED` / `HOST_FORBIDDEN` / `HOST_INVALID_RESPONSE`，不静默降级。缺 Host 句柄时不猜 `127.0.0.1:3080`。

**会话。** Corn 自动服务当前 Session。后台 Session 的操作只记录，不抢焦点。Agent 定位目标时短时高亮，右下角提示「Agent 已定位到 …」。

**运行调试（实验性能力已落地，真机暂缓）。** `DebugRuntime` 是唯一状态权威。GDB/MI + OpenOCD；`TargetLease` 互斥；启动必须带不可变 `ResolvedDebugLaunchSpec` 和 `approvalRequestId`。Keil UVSOCK 仿真器有 fake server 测试，Windows µCorn 真机未做。ProgramModel 用 Lezer C/C++ AST（`confidence: 'ast'`），启发式分析器降级为 `heuristic`。`corn_debug` 的 `verify` 做场景化断言（表达式、遥测、无告警、`stable-for-duration`）。

Windows 无 Python 时，从 `.tgz` 安装即可用 Keil 工程扫描 / 编译和 Modbus 主机读写。Keil 仍要本机 UV4；烧录仍要外部 OpenOCD。macOS 自动测试不能代替 Windows 10/11 实机，见 `docs/WINDOWS_ACCEPTANCE_0.27.md`（状态 `DEFERRED_WINDOWS_ACCEPTANCE`）。

还没做：CAN 监视。

## 开发

实现优先改 `src/{domain,application,infrastructure,interfaces,ui}`；根目录 `bench-*.mjs` 仅为兼容 re-export。架构决策见 `docs/architecture/`（ADR-024 客户端原语、ADR-025 公共 UI 组件契约）。

```sh
npm install
npm test
npm run quality
npm run build
```

`npm test` 含 `build:check`。不要手改生成的 `client.js`。`dsh plugin add` 装到运行时后只有生产依赖，不要在那个安装目录跑测试。

## 归档

原合集仓库已并入本仓库：现行工程计划在 [`docs/plans/suite/`](docs/plans/suite/)，历史计划与合集变更记录在 [`docs/archive/suite/`](docs/archive/suite/)。已移除的旧 harness 插件（0.2.1，仅适用 DSH ≤ 0.1.6）源码快照和原合集的完整 git 历史保存在 Release [`archive/legacy-2026-10`](https://github.com/xingyingyuzhui/dsh-corn-bench/releases/tag/archive/legacy-2026-10)。

## 授权

本项目以 **PolyForm Noncommercial License 1.0.0** 开源，全文见 [`LICENSE.md`](LICENSE.md)。

- 可以：个人学习、研究、测试、自用，以及非营利组织、教育和公共研究机构使用；可以修改和分发，但必须附上 `LICENSE.md`（含开头的 `Required Notice` 署名行）。
- 不可以：任何商业用途（包括把它或修改版用于销售、收费服务、商业产品或公司内部的营利业务）。商业授权请联系作者 [xingyingyuzhui](https://github.com/xingyingyuzhui)。
- 注意：非商业授权不属于 OSI 定义的“开源许可证”，这里的“开源”指源码公开、可在非商业条件下使用。
- 0.30.2 及更早的版本按当时附带的 MIT 授权发布，已取得的副本仍适用 MIT；本授权从下一个版本起生效。
- 打包进 `client.js` 的第三方依赖（CodeMirror、ECharts、TanStack、uPlot、gridstack、modbus-serial、serialport 等）仍按各自的 MIT / ISC / Apache-2.0 / BSD 授权，与本项目的非商业授权不冲突。

Copyright 2026 xingyingyuzhui. Corn 名称与图标归作者所有。
