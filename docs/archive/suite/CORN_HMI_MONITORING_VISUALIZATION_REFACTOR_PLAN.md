# Corn 上位机点位监视、告警与可视化改造计划

> 适用仓库：`/Users/qin/DSH/plugins/dsh-corn-suite/dsh-corn-bench`  
> 基线版本：`0.19.3`  
> 制定日期：2026-08-26  
> 计划性质：代码级执行计划；本文件不代表功能已经实现  
> 建议目标版本：`0.20.0`

## 1. 目标

本轮改造只解决当前 Windows 上位机主链路，不扩展 CAN/DBC、远程 Runner、多设备拓扑市场、领域知识包或多人共享台架。

目标是把现有“点位配置 + 固定曲线页”升级为以下完整闭环：

1. 每个连接下面包含设备，每个设备卡片直接管理自己的点位。
2. 点位表持续展示当前工程值和状态。
3. 可写点位直接点击“当前值”原地写入，不进入整表编辑模式。
4. 点位通过“监视”开关决定是否成为可视化数据源。
5. 点位通过“告警”开关及上下限决定是否参与告警判断。
6. 侧边栏“曲线”更名为“可视化”，不再固定展示所有监视点位。
7. 用户点击“新建组件”或编辑现有组件，选择组件类型并关联已监视点位。
8. 第一版支持曲线图、柱状图、数值卡和开关四类组件。
9. 用户和当前 Session Agent 对同一份点位、监视、告警和可视化配置进行读写与回显。

## 2. 已确认的产品决策

### 2.1 上位机点位表

- 删除“更新时间”列，释放横向空间。
- 设备卡片工具栏顺序统一为：
  - 添加点位
  - 批量添加
  - 读取
  - 编辑
  - 导入 CSV
  - 导出 CSV
  - Agent 图标按钮
- “读取”读取当前设备的全部点位。
- “编辑”切换当前设备卡片的配置编辑状态；点位配置直接在表格行内编辑。
- 普通状态不显示独立的“编辑点位”“删除点位”“写入”文字按钮。
- 删除动作只在设备编辑状态中出现，并使用图标或行内危险操作。
- Agent 动作用紧凑图标按钮表示，保留 tooltip 和无障碍名称。
- 添加点位时，在当前设备表格内部插入一条新增草稿行，不在页面底部另开大卡片。

目标列为：

| 列 | 普通状态 | 设备编辑状态 |
| --- | --- | --- |
| 名称 | 文本 | 输入框 |
| 功能码 | 文本 | 下拉框 |
| 地址 | 文本 | 数字输入 |
| 倍率 | 文本 | 数字输入 |
| 偏移 | 文本 | 数字输入 |
| 单位 | 文本 | 输入框 |
| 当前值 | 工程值；可写点位可点击 | 仍可见，不承担配置编辑 |
| 状态 | 未读取/正常/告警/通信异常/已断开 | 仍可见 |
| 监视 | 开关 | 开关 |
| 告警 | 开关 | 开关 |
| 下限 | 值或 `—` | 数字输入 |
| 上限 | 值或 `—` | 数字输入 |

### 2.2 当前值写入

- 只有可写功能码点位允许点击当前值：FC01 线圈、FC03 保持寄存器。
- 点击当前值后，只把该单元格替换成输入框、确认和取消按钮。
- 写入目标必须固定到该行的 `connectionId + deviceId + pointId`，不得回退到当前激活设备。
- 输入和显示均使用工程值；提交前根据 `scale/offset` 反算寄存器原始值。
- 反算公式：`raw = (engineeringValue - offset) / scale`。
- FC03 反算结果必须是合法整数寄存器值；不得静默四舍五入。
- FC01 使用开/关语义，不显示任意数字输入。
- 写入成功后使用读回值更新当前值；超时显示“结果未知”，不得自动重试。
- 同一时刻一行只允许存在一个写入编辑器。

### 2.3 监视

- “监视”是点位属性，不是独立侧边栏页面。
- 开启后，该点位进入历史采样，并成为“可视化”组件编辑器的可选数据源。
- 关闭后，点位仍可正常读取、显示当前值和参与独立告警；只是停止新增可视化历史样本。
- 关闭监视不得静默删除已关联该点位的组件。
- 已有关联组件显示“数据源未监视”，保留组件和编辑入口。

### 2.4 告警

- “告警”与“监视”相互独立。
- 开启告警时至少配置一个有效阈值。
- 同时配置上下限时必须满足 `下限 < 上限`。
- 阈值使用工程值，与点位倍率/偏移换算后的值比较。
- 关闭告警后停止判断；阈值可保留，便于再次开启。
- 点位状态列优先显示激活告警，其次显示通信质量状态。
- 侧边栏“告警”页继续保留，用于查看、确认、跳转和交给 Agent 分析。

### 2.5 可视化侧边栏

- 原侧边栏“曲线”改名为“可视化”。
- 保留现有内部 Tab ID `dsh-corn-bench:charts`，避免已有焦点路由和外部引用失效；只更换用户可见名称和页面实现。
- 默认页面不展开“已监视点位”列表。
- 页面以组件为中心：
  - `＋新建组件`
  - 已创建组件列表/画布
  - 组件右上角编辑图标
- 点击新建或编辑后显示组件编辑器：
  - 组件名称
  - 组件类型
  - 关联点位搜索与多选
  - 保存
  - 取消
- “关联点位”只列出 `monitorEnabled=true` 的点位。
- 点位选项必须显示限定路径，至少为“连接 / 设备 / 点位”，防止同名点位混淆。

## 3. 当前代码基线

### 3.1 已有能力

- `bench-hmi.mjs` 已按设备卡片挂载点位表。
- `bench-hmi.mjs` 已有点位表单、设备读取、CSV、行内写入状态和 Agent 引用。
- 点位已经包含 `trendEnabled`、`alarmMin`、`alarmMax`。
- `bench-trend-store.mjs` 已在读、轮询和写后读回的统一提交阶段保存趋势样本。
- `bench-live.mjs` 已使用 uPlot 渲染固定趋势曲线。
- `bench-alarm.mjs` 和 `bench-points.mjs` 已具备告警判断及告警状态机。
- `bench-store.mjs` 已提供工作区持久化、配置版本和 RFC 6902 草稿机制。
- `bench-tool.mjs` 已向 Agent 暴露点位、趋势、告警和聚焦能力。
- 当前自动化基线：`npm test` 共 356 项通过。

### 3.2 当前缺口

1. 点位表仍有“时间、写入、读取、编辑、删除、让 Agent 分析、曲线”等过多列。
2. 点位编辑和写入仍会在表格下方打开独立卡片。
3. 当前写入编辑器使用寄存器原始值初始化，但表格展示工程值。
4. 当前写请求只携带功能码和地址，没有固定该行的连接、设备和点位 ID。
5. `trendEnabled` 只表达“进入曲线”，无法表达通用可视化数据源。
6. 告警是否启用仍由上下限是否为空隐式推断，没有稳定的显式字段。
7. 侧边栏趋势页固定选择前 8 个 `trendEnabled` 点位，无法保存用户组件。
8. 当前没有可视化组件配置、验证、迁移和 Agent 契约。
9. 告警死区的部分比较仍直接使用 raw 值，需要统一为工程值。

## 4. 架构决策

### 4.1 方案对比

#### 方案 A：只改文案，继续使用 `trendEnabled` 和固定曲线页

优点：改动最小。

缺点：

- “监视”仍被曲线实现绑死。
- 无法持久化柱状图、数值卡和开关。
- Agent 无法引用稳定的可视化组件。
- 后续每加一种组件都继续堆进 `bench-live.mjs`。

结论：不采用。

#### 方案 B：兼容迁移为 `monitorEnabled`，新增轻量可视化组件模型

优点：

- 复用现有 Modbus、趋势缓存、uPlot、写入和告警能力。
- 不引入新的仪表盘框架或第二套状态源。
- 数据模型能支撑多种组件和 Agent 引用。
- 旧工作区与旧 CSV 可迁移。

代价：

- 需要同时修改规范化、持久化、CSV、UI、Agent 和测试。
- 需要一段版本内兼容 `trendEnabled`。

结论：采用。

#### 方案 C：嵌入 Node-RED Dashboard 或另一套 HMI 运行时

优点：组件生态多。

缺点：

- 引入第二套工程模型、状态存储和运行生命周期。
- 增加 Windows 安装体积、依赖和升级风险。
- 与当前 Session Agent、工作区隔离和写入审批难以统一。

结论：当前阶段不采用。

### 4.2 依赖方向

采用现有模块化单体结构：

```text
点位/组件纯模型
    ↑
工作区持久化与迁移
    ↑
Modbus 提交、趋势采样、告警判断
    ↑
上位机页面 / 可视化侧边栏 / Agent 工具
```

- 纯模型不得依赖 React、Harness 插槽或 HTTP。
- UI 只消费工作区状态并提交显式配置补丁。
- Modbus 采集仍是当前值的唯一来源。
- 可视化页面不得自己打开串口或启动第二条轮询链路。

## 5. 目标数据模型

### 5.1 点位模型

```js
{
  id: 'p1',
  connectionId: 'c1',
  deviceId: 'd1',
  name: '送风温度',
  function: 3,
  address: 0,
  scale: 0.1,
  offset: 0,
  unit: '°C',
  monitorEnabled: true,
  alarmEnabled: true,
  alarmMin: 18,
  alarmMax: 30
}
```

兼容规则：

```js
monitorEnabled = raw.monitorEnabled === true
  || (raw.monitorEnabled === undefined && raw.trendEnabled === true)

alarmEnabled = raw.alarmEnabled !== undefined
  ? raw.alarmEnabled === true
  : raw.alarmMin != null || raw.alarmMax != null
```

- 新保存的数据以 `monitorEnabled`、`alarmEnabled` 为准。
- 读取旧工作区和旧 CSV 时接受 `trendEnabled`。
- 兼容期内 Agent 输出可同时提供只读别名 `trendEnabled: monitorEnabled`；新写入参数只推荐 `monitorEnabled`。
- 不直接把 Modbus schemaVersion 从 3 改成 4；本轮是 v3 内字段演进，降低迁移范围。

### 5.2 可视化模型

在 `modbus.visualization` 下持久化：

```js
{
  schemaVersion: 1,
  components: [
    {
      id: 'viz_xxx',
      name: '送风温度趋势',
      type: 'line',
      pointIds: ['p1', 'p2'],
      order: 0,
      settings: {
        windowMs: 300000,
        confirmWrite: true
      }
    }
  ]
}
```

第一版约束：

| 类型 | 标识 | 数据源约束 | 渲染来源 |
| --- | --- | --- | --- |
| 曲线图 | `line` | 1–8 个数值型监视点位 | `modbus.trend` |
| 柱状图 | `bar` | 1–16 个数值型监视点位 | 最新 `modbus.values` |
| 数值卡 | `value` | 1 个监视点位 | 最新 `modbus.values` |
| 开关 | `switch` | 1 个可写 FC01 监视点位 | 最新值 + `/modbus/write` |

全局限制：

- 每工作区最多 32 个组件。
- 名称最长 40 个字符。
- `pointIds` 去重。
- 组件关联使用稳定 pointId，不使用名称或地址。
- 点位关闭监视或被删除时，不自动删除组件；组件进入 degraded 状态并提示修复。
- 组件配置属于配置版本的一部分，新增、编辑、删除组件必须递增 `configVersion`。

## 6. 代码修改范围

### 6.1 新增 `bench-visualization-model.mjs`

职责：纯函数模型，不依赖 React。

导出建议：

```js
emptyVisualization()
normalizeVisualization(input, points)
normalizeVisualizationComponent(input)
validateVisualizationComponent(component, points)
visualizationComponentStatus(component, points)
monitoredPointOptions(pack)
componentUsesPoint(component, pointId)
```

必须覆盖：

- 类型白名单。
- ID、名称、顺序和 settings 归一化。
- 每种组件的点位数量和类型校验。
- 只允许关联已开启监视的点位。
- 缺失点位和关闭监视点位的 degraded 诊断。
- 不因诊断自动删除用户配置。

### 6.2 新增 `bench-visualization-view.mjs`

职责：侧边栏“可视化”页面和组件渲染器。

包含：

- `createVisualizationPage(React, t, post, hooks)`。
- 新建/编辑组件状态机。
- 已监视点位搜索、多选和限定路径展示。
- 组件保存、取消、删除二次确认。
- 曲线图渲染器：复用 uPlot 和现有趋势数据。
- 柱状图渲染器：优先复用 uPlot bars 能力，不引入新图表库。
- 数值卡渲染器：使用当前值、单位和质量状态。
- 开关渲染器：复用用户写点接口；默认确认后写入并等待读回。
- 组件右上角紧凑编辑图标和 Agent 图标。
- 空状态只提示“新建组件”，不展开全部监视点位。

### 6.3 修改 `bench-hmi.mjs`

#### 状态重构

- 删除页面底部独立点位编辑卡片和独立写入卡片的渲染路径。
- 用以下局部状态替代：

```js
editingDeviceId
deviceDraft
pointDraftsById
newPointDraft
inlineWrite
thresholdDraft
```

- 所有草稿固定携带 `connectionId/deviceId/pointId`。

#### 设备工具栏

- 将读取和编辑移动到批量添加右侧。
- 设备名称、Unit ID 和点位配置统一由设备编辑模式管理。
- 进入编辑时拍摄当前设备快照。
- 保存时一次提交该设备的 metadata 和点位列表。
- 取消时恢复快照，不产生部分持久化。
- 删除按钮只在编辑状态出现。

#### 点位行

- 删除“更新时间、写入、读取、编辑、删除、让 Agent 分析、曲线”列。
- 新增“状态、监视、告警、下限、上限”。
- 当前值单元格负责行内写入。
- Agent 改为图标按钮，可放在名称单元格末尾或 hover 操作区。
- 添加点位在设备表格内插入草稿行。
- `monitorEnabled`、`alarmEnabled` 和阈值写回当前设备点位。

#### 行内写入修复

- `openWriteRow(point)` 改为保存完整目标：

```js
{
  connectionId,
  deviceId,
  pointId,
  function,
  address,
  engineeringValue,
  rawValue
}
```

- 新增 `encodeValue(point, engineeringValue)` 到 `bench-points.mjs`。
- `/modbus/write` 请求必须携带 `connectionId`、`deviceId`、`pointId`。
- 写入成功前不乐观覆盖显示值。

#### 状态列

新增纯函数 `pointRuntimeStatus(point, valueRec, alarmState, connectionState)`，优先级：

1. 激活告警
2. 通信异常
3. 连接断开
4. 正常
5. 未读取

### 6.4 修改 `bench-points.mjs`

- 规范化 `monitorEnabled` 和 `alarmEnabled`。
- 保留 `trendEnabled` 旧输入别名。
- 新增 `encodeValue` 并验证 scale 不为 0、结果为合法整数。
- `evaluateAlarm` 和相关助手显式检查 `alarmEnabled`。
- CSV 新表头：

```text
name,function,address,scale,offset,unit,monitorEnabled,alarmEnabled,alarmMin,alarmMax
```

- CSV 导入兼容旧 `trendEnabled`。
- CSV 导出只使用新字段，避免继续扩散旧命名。

### 6.5 修改 `bench-devices.mjs`

- `normalizePointV3()` 支持新点位字段和旧字段迁移。
- `normalizeModbus()` 规范化 `visualization`。
- 不清理失效组件引用，只附带可计算诊断。
- 旧工作区没有 visualization 时默认 `{ schemaVersion: 1, components: [] }`。

### 6.6 修改 `bench-store.mjs`

- `isV3Patch()` 识别 `visualization`。
- `saveWorkspace()` 合并并规范化 `visualization`。
- `stringifyConfigSlice()` 加入 visualization，保证组件修改递增 `configVersion`。
- 点位删除、关闭监视和组件引用之间不做隐式级联删除。
- RFC 6902 配置草稿允许修改 `/visualization/components`。
- 草稿摘要增加“新增/修改/删除可视化组件”统计。

### 6.7 修改趋势和告警模块

#### `bench-trend-store.mjs`

- 采样条件从 `trendEnabled` 改为 `monitorEnabled`。
- 读取旧点位时依赖规范化后的兼容结果。
- 文件名和 `modbus.trend` 暂不改，避免无收益的数据迁移；用户可见文案全部改成“监视/可视化”。

#### `bench-trend.mjs`

- 保留时间序列、uPlot 数据和 trendKey 兼容能力。
- 抽出可供单个可视化组件按 pointIds 和 windowMs 读取的数据构造函数。

#### `bench-alarm.mjs`

- 只评估 `alarmEnabled=true` 的点位。
- 死区、延迟和恢复比较全部使用工程值，不再混用 raw 值。
- 关闭告警时，如当前存在激活告警，生成一次明确恢复/停用事件，不留悬空激活状态。

### 6.8 修改 `bench-live.mjs` 与 `bench-runtime.mjs`

- `bench-live.mjs` 保留告警和操作记录页面。
- 将固定 `createTrendPage` 迁移为 `createVisualizationPage`。
- 兼容期可从 `bench-live.mjs` re-export 旧 `createTrendPage` 名称，内部指向新页面，随后更新测试。
- `bench-runtime.mjs` 注册新的可视化页面。
- 保持 sidebar 类型 `dsh-corn-bench:charts` 不变。
- Agent 的 `kind=trend` 仍路由到可视化页。
- 新增 `kind=visualization` 和 `visualizationId` 时也路由到同一页并高亮组件。

### 6.9 修改 `bench-tool.mjs`、`bench-targets.mjs` 和 Agent 预设

#### 点位契约

`points` 的 list/add/update 输出和输入增加：

```js
monitorEnabled
alarmEnabled
alarmMin
alarmMax
```

旧 `trendEnabled` 作为只读兼容别名保留一个版本。

#### 可视化契约

新增工具 action：`visualization`。

第一版操作：

- `op=list`：读取组件和 degraded 诊断。
- `op=get`：按 `visualizationId` 读取组件和关联点位当前值。
- `op=proposeAdd`：生成配置草稿，不直接应用。
- `op=proposeUpdate`：生成配置草稿，不直接应用。
- `op=proposeRemove`：生成配置草稿，不直接应用。

Agent 不得绕过现有草稿审批直接改变可视化配置。

#### 聚焦与证据

- `focus` 支持 `visualizationId`。
- 结构化引用新增 `kind=visualization`。
- 引用包含稳定 ID、configVersion、组件类型、pointIds 和时间范围。
- 页面被 Agent 新建或修改后，当前 Session 立即看到组件变化或待审批草稿。

#### `bench-preset.mjs`

- 把“加入曲线”更新为“开启监视并在可视化组件中关联”。
- 明确 Agent 创建/修改组件必须提交草稿。
- 明确开关组件写入属于高影响动作，继续遵循用户确认和读回规则。

### 6.10 修改样式、文案和打包

#### `bench-i18n.mjs`

- `liveChart` 中文改为“可视化”，英文改为 “Visualization”。
- `trendOn` 改为“监视”。
- `trendHint` 改为“开启后可被可视化组件关联并记录历史样本”。
- 新增组件编辑、类型、关联点位、数据源失效、写入确认等中英文文案。
- 更新 `test/i18n.test.mjs` 的预期值。

#### `bench-styles.mjs`

新增并验证：

- 紧凑点位表列宽。
- 行内编辑态和行内写入态。
- switch、状态圆点和告警状态。
- 可视化组件卡片、组件编辑器、点位多选和 degraded 状态。
- 窄侧栏下的单列降级布局。
- 深色模式、键盘焦点和禁用状态。

#### `package.json`

- `files` 中加入新增的模型和视图模块。
- 版本建议提升到 `0.20.0`。
- 不新增图表依赖；继续使用 uPlot。
- `client.js` 只能由 `npm run build` 生成，禁止手工编辑。

## 7. 分阶段执行顺序

### P0：冻结契约与迁移模型

修改：

- `bench-points.mjs`
- `bench-devices.mjs`
- `bench-store.mjs`
- 新增 `bench-visualization-model.mjs`

完成条件：

- 旧 `trendEnabled` 工作区迁移为 monitorEnabled 语义。
- alarmEnabled 兼容旧阈值推断。
- visualization 可持久化并递增 configVersion。
- 新旧 CSV 均可导入，新 CSV 可稳定往返。

### P1：重构设备卡片与点位表

修改：

- `bench-hmi.mjs`
- `bench-points.mjs`
- `bench-styles.mjs`
- `bench-i18n.mjs`

完成条件：

- 删除更新时间和冗余操作列。
- 添加、编辑和删除全部发生在设备卡片内部。
- 设备读取和编辑按钮位置符合确认稿。
- 当前值直接行内写入，并稳定绑定连接/设备/点位。
- 倍率/偏移写入转换正确。

### P2：把固定曲线页升级为可视化组件页

修改：

- 新增 `bench-visualization-view.mjs`
- `bench-live.mjs`
- `bench-runtime.mjs`
- `bench-trend.mjs`
- `bench-styles.mjs`
- `bench-i18n.mjs`

完成条件：

- 侧边栏标题为“可视化”。
- 默认不展开监视点位列表。
- 可以新建、编辑、保存和删除组件。
- 点位选择器只显示已监视点位并带限定路径。
- 四类组件可工作。

### P3：统一监视、告警和运行状态

修改：

- `bench-trend-store.mjs`
- `bench-alarm.mjs`
- `bench-modbus-commit.mjs`
- `bench-hmi.mjs`

完成条件：

- 监视只控制可视化历史和数据源资格。
- 告警独立运行。
- 当前值、状态、可视化和告警来自同一次提交数据。
- 通信失败形成曲线断点、状态异常和告警质量变化，不生成伪数据。

### P4：补全 Agent 联动

修改：

- `bench-tool.mjs`
- `bench-targets.mjs`
- `bench-shared.mjs`
- `bench-preset.mjs`
- `bench-runtime.mjs`

完成条件：

- Agent 能读取监视点位、告警配置和可视化组件。
- Agent 修改组件只能生成配置草稿。
- Agent 聚焦组件时打开“可视化”并高亮目标。
- UI 保存后当前 Session Agent 读取到同一配置版本。

### P5：回归、打包和 Windows 手工验收

修改：

- 测试文件
- `package.json`
- `README.md`
- 生成 `client.js`

完成条件：

- 自动化全部通过。
- npm 包内容完整。
- Windows 真实 COM 环境完成手工验收。

## 8. 自动化测试计划

### 8.1 新增测试

#### `test/visualization-model.test.mjs`

- 四类组件规范化和数量限制。
- 非监视点位不可新关联。
- 关闭监视和删除点位只产生 degraded，不删除组件。
- switch 只接受 FC01 可写点位。
- 组件 ID、pointIds、名称和 settings 边界。

#### `test/visualization-view.test.mjs`

- 页面挂载无错误和 effect 泄漏。
- 默认不渲染展开的已监视点位列表。
- 新建和编辑进入同一个组件编辑器。
- 搜索结果只包含 monitorEnabled 点位。
- 保存后组件立即渲染。
- 编辑图标恢复正确草稿。
- degraded 组件显示修复入口。

#### `test/hmi-point-table-ux.test.mjs`

- 不存在“更新时间”表头。
- 不存在普通状态的独立写入/读取/编辑/删除文字列。
- 当前值点击只打开当前行写入编辑器。
- 设备编辑使该设备点位行内可编辑，不影响其他设备。
- 删除只在编辑状态出现。
- 添加点位草稿固定到按钮所在设备。
- 监视、告警、上下限字段渲染和保存正确。
- Agent 使用图标按钮并具备 aria-label/title。

### 8.2 更新现有测试

- `test/trend-selection.test.mjs`
  - `trendEnabled` 基线改为 `monitorEnabled`，保留旧字段迁移用例。
- `test/trend.test.mjs`
  - 验证组件 pointIds 的趋势数据选择，不再默认取前 8 个全局点位。
- `test/alarm.test.mjs`、`test/alarm-condition.test.mjs`
  - 增加 alarmEnabled、工程值死区和关闭告警恢复。
- `test/points.test.mjs`、`test/m3.test.mjs`
  - 增加 encodeValue 和新 CSV 字段。
- `test/store.test.mjs`
  - visualization round-trip、configVersion 和旧工作区迁移。
- `test/tool-preset.test.mjs`
  - visualization action、草稿审批和预设文案。
- `test/focus-routing.test.mjs`
  - visualizationId 路由到原 charts Tab ID。
- `test/ui-contract.test.mjs`
  - “可视化”名称和新点位表契约。
- `test/package-contents.test.mjs`
  - 新增模块必须进入发布包。
- `test/i18n.test.mjs`
  - “曲线”更新为“可视化”。

### 8.3 必跑命令

在 `dsh-corn-bench` 目录执行：

```bash
npm test
npm run build
npm run build:check
npm pack --dry-run
git diff --check
```

说明：

- `npm test` 是逻辑与组件自动化证据。
- `npm run build` 更新生成的 `client.js`。
- 自动化通过不等于 Windows COM、实际写点和最终视觉验收通过。

## 9. 人工 UX 验收

### 9.1 点位表

1. 建立 COM3 连接并添加两个不同 Unit ID 的设备。
2. 两个设备分别添加同地址 HR0 点位。
3. 点击设备1读取，只更新设备1点位。
4. 点击设备2编辑，只让设备2的配置进入行内编辑状态。
5. 普通状态确认不存在更新时间、删除和独立写入卡片。
6. 点击可写点位当前值，只在该单元格打开写入。
7. 取消后值不变；确认后显示读回工程值。
8. 带 `scale=0.1` 的点位输入 `24.0`，实际写入 raw `240`。
9. 只读点位当前值不可点击，并有明确只读提示。

### 9.2 监视与可视化

1. 开启三个点位监视。
2. 打开“可视化”，确认没有预先展开的点位清单。
3. 新建曲线图并关联两个点位。
4. 新建数值卡并关联一个点位。
5. 新建 FC01 开关并完成确认写入和读回。
6. 编辑现有组件，修改名称、类型和关联点位。
7. 关闭一个已关联点位的监视，组件保留并提示数据源未监视。
8. 重新开启监视后组件恢复，不需要重新创建。

### 9.3 告警

1. 开启告警并只设置上限，保存成功。
2. 同时设置上下限且下限大于上限，保存被阻止。
3. 点位越限时状态列显示告警，侧边栏出现告警记录。
4. 关闭告警后不再产生新告警；已有激活告警得到明确恢复/停用处理。
5. 监视关闭但告警开启时，告警仍可工作。

### 9.4 Agent 联动

1. Agent 读取点位时能看到当前值、状态、monitorEnabled、alarmEnabled 和阈值。
2. Agent 读取可视化组件时能看到稳定 visualizationId 和关联 pointIds。
3. Agent 提议新建组件后只出现配置草稿，不直接修改页面。
4. 用户批准后页面自动出现组件。
5. Agent 聚焦组件后打开“可视化”侧边栏并高亮目标。

## 10. Windows 真实设备验收

当前 macOS 自动化不能替代以下 Windows 验收：

- COM1–COM9 和 COM10+ 路径。
- 两个 USB 串口同时存在时的端口唯一性。
- 真实 Modbus RTU 设备的轮询、断线、重连和报文归属。
- FC01、FC03 实际写入与写后读回。
- 设备拔出时点位状态、可视化断点和告警质量。
- 侧边栏窄宽度、系统缩放 100%/125%/150%。
- 长点位名称、中文单位和 32 个组件时的布局与性能。

Windows 证据应单独记录，不得用 macOS `npm test` 结果代替。

## 11. 性能与安全门槛

- 不新增第二条轮询服务。
- 可视化页面关闭时，历史采样仍按 monitorEnabled 运行。
- 单工作区最多 256 点位、32 组件。
- 单曲线组件最多 8 条序列。
- uPlot 实例只在组件序列集合变化时重建，实时数据使用 `setData`。
- 组件编辑搜索不得每 500ms 重建全部大对象。
- 写入必须使用稳定 ID 和配置版本校验。
- 用户开关组件写入默认二次确认。
- Agent 写入继续走现有人工批准；Agent 组件配置继续走草稿批准。
- 串口报文层和可视化层不得拥有打开/关闭 COM 的按钮或能力。

## 12. 明确不做

- 不实现任意拖拽大屏编辑器。
- 不实现自由定位、栅格吸附和多页面 HMI 设计器。
- 不引入 Node-RED Dashboard、Grafana、ECharts 或新的图表框架。
- 不实现脚本组件或用户自定义 JavaScript。
- 不实现远程 Runner、共享台架、模板市场或云同步。
- 不实现 CAN/DBC、OPC UA、MQTT 等新协议。
- 不在本轮删除 `trend` 存储键、trendKey 或 charts Tab 内部 ID。

## 13. 风险与处理

| 风险 | 处理 |
| --- | --- |
| 旧工作区只有 trendEnabled | 规范化时迁移为 monitorEnabled |
| 旧 CSV 仍用 trendEnabled | 导入兼容，导出改用新字段 |
| 组件引用关闭监视/删除点位 | 保留组件并 degraded，不静默删 |
| 多设备同地址写错目标 | 请求强制携带 connectionId/deviceId/pointId |
| 工程值与 raw 写入混淆 | 新增 encodeValue，拒绝非整数反算 |
| 告警 deadband 混用 raw | 全部改用工程值比较 |
| Agent 直接改组件绕过用户 | 只生成 RFC 6902 配置草稿 |
| 新页面导致 bundle 漏文件 | package contents 测试 + npm pack dry-run |
| 侧栏组件过多影响性能 | 32 个上限，曲线实例按需挂载 |

## 14. 完成定义

只有同时满足以下条件才算完成：

1. 点位表符合确认稿，不显示更新时间和冗余操作列。
2. 点位添加、编辑、删除均在所属设备卡片内部完成。
3. 当前值可以原地写入，且多设备与倍率换算正确。
4. 监视与告警是两个独立点位属性。
5. “可视化”侧边栏以组件为中心，不展开点位清单。
6. 四类组件均可创建、编辑、保存、恢复和处理失效数据源。
7. Agent 能读取并聚焦组件，配置修改走草稿审批。
8. `npm test`、build check、package check 和 diff check 全部通过。
9. 人工视觉/交互验收有独立记录。
10. Windows 真实 COM 和设备验收有独立记录；未执行时必须明确标记“未验证”，不能宣称已完成 Windows 部署验收。

