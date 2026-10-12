# 020 落地复审：结合 Harness 第十、十一轮反馈

日期：2026-10-08。审查 HEAD：`bc3fcda37434af2ef9b4810010245680dfe42af4`；行为对比基线：`54581d0`。开始审查时工作树干净。

依据：[020 计划](../plans/2026-10-08-020-verify-sampling-provenance-fix-plan.md)、[实现方交付](../plans/2026-10-08-020-verify-sampling-provenance-fix-verification.md)、[Harness 第 10–11 轮反馈](/Users/qin/DSH/vision-plugin-round10-11-verification.md)。原报告和计划未修改。

**结论：查询参数、hint、初值拒绝和 legacy alarm owner 等修复已落地，但 020 尚不能完整验收。复审发现 3 项 P1、4 项 P2；11 条额外行为断言均失败。部分缺口能直接让 verify 在配置切换后错误 pass，不能用“14 项收敛、只有 status.log 遗留”描述整个插件。**

## 1. 本次实测与范围

| 检查 | 结果 |
|---|---|
| bench 单测 | **1807/1807** 通过，0 失败/跳过 |
| Harness npm test | **25/25** 通过 |
| lint / typecheck / deps / structure / assertions / facades / ui:ownership | 通过 |
| build:check | 通过 |
| check-build-info / check-package | 通过；buildId `5baff2374420…`、gitSha `2ec1124`、包导入闭包完整 |
| git diff --check（当前工作树） | 审查开始时干净 |
| git diff --check 54581d0..HEAD | **未通过**：point-model.mjs:322 新增 EOF 空行；见 M3 |
| 额外独立复现 | **11 条断言，0 通过 / 11 失败**；对应下列 7 组缺口，未混入现有单测数量 |
| Web / Desktop / 物理硬件 | 本次未安装或操作；实现方 Desktop lab 已明确受阻，不能计作验收通过 |

额外复现：[脚本](/tmp/vision-review020-extra.test.mjs)、[输出](/tmp/vision-review020-extra.log)。生产 poll/device.update/sim-write 使用临时 home/cwd 和注入 transport；其它使用内存 fixture。没有修改用户 `/Users/qin/DSH` 的设备工作区，没有操作物理串口/TCP 设备。

本次日志：[/tmp/vision-review020-unit.log](/tmp/vision-review020-unit.log)、[/tmp/vision-review020-harness.log](/tmp/vision-review020-harness.log)，其它门禁在 `/tmp/vision-review020-*.log`。本次直接调用两个 build/package 检查器，没有执行会重写 build-info 的 pack:check。

报告的 gitSha/buildId 与当前 build-info 一致；较后的 HEAD 主要是生成信息/交付说明，不能仅因 HEAD 不是 `2ec1124` 就判定报告测了旧行为构建。现场 pid、体量和原始调用结果本次没有重新采集。

## 2. 发现总表

| 编号 | 优先级 | 问题 | 独立证据 |
|---|---|---|---|
| F1 | P1 | observeReading 丢失采样 fingerprint/generation，stable 中途改几何仍 pass | 真实 verifyService + scoped adapter，实际两个代次却通过 |
| F2 | P1 | 新 effective 索引按裸 conn/device ID 跨层合并，指纹与实际路由不一致；冲突枚举也不可靠 | 实际 poll 读 unit1 却盖 unit2；真实 device.update 后旧 unit1 值仍 pass；三 owner 纯函数复现 |
| F3 | P1 | sim-write 将未读取的旧兄弟样本重新盖成新真实端点的采样 | 真实 modbusWrite：p2 的值/at 没变，sim=false 后新 generation 被信任 |
| F4 | P2 | unique→ambiguous→unique 复用旧 generation，旧样本重新合格 | 配置差异 helper + scoped reader，恢复后直接读回旧 77 |
| F5 | P2 | 完整 publish reading 与无章 direct result 被 reader 强行贴上当前身份 | 错章 publish 被接受；无章 read provider 返回 99 被缓存为合格 |
| F6 | P2 | 未来采样 timestamp 可被 stable 当作完整时间覆盖 | 可控 clock：当前 1080，末样本 2000，80ms 窗成功返回数值列表 |
| F7 | P2 | RPC 会话快照外发全局 sampleGenerations，包括外国私有 pointId/token | 实际 sessionWorkspaceView：A 看不到 B 的点，但收到 B 的 token |

### F1：窗口保护在观察层被洗掉

位置：[verify-observation.mjs:54](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/verify/verify-observation.mjs:54)、[verify-sampling.mjs:145](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/verify/verify-sampling.mjs:145)。

reader 返回正确的 fingerprint/generation，但 observeReading 重新组装对象时只保留 value/rawValue/timestamp/quality/provenance。sampleStableDuration 随后读取 reading.fingerprint/generation，两者已不存在，于是每个样本的窗口身份都变成空字符串。

已复现：第一份样本来自地址 0；第二次读取前真实调用 prepareConfigPersistence 把地址改为 5、生成新代次，再由 scoped adapter 发布新配置下的同值样本。reader 确实见到了两个 generation，最终 verify 却返回：

```json
{"status":"pass","generations":2,"actual":{"min":10,"max":10,"sampleCount":4}}
```

这不是 createStableWindow 的 identity-change 单测能排除的：该测试直接传两个 generation，绕过了会洗掉字段的生产 observation seam。

修复：Observation/ObservedReading 类型显式保留经过 reader 校验的 fingerprint/generation，避免 any 强转掩盖缺字段；sampling 不把必需的身份默默降成空字符串。补完整 service→reader→observe→window 测试，要求中途地址/unit/owner/generation 改变返回 STALE_VALUE/unverifiable，不允许重开窗口拼凑 pass。

另一个较小的输出缺口：readTelemetryPoint 在窗口判断前就把每次缓存复查 push 到 telemetrySamples，新增的 checkOnly 字段没有实际使用。窗口有效计数虽已去重，结果中的采样轨迹仍会重复，应区分有效采样与复查，不能把轨迹长度当有效 sampleCount。

### F2：采样章使用了另一个会话的设备

位置：[prepare-config-persistence.mjs:31](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/domain/modbus/prepare-config-persistence.mjs:31)、[prepare-config-persistence.mjs:61](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/domain/modbus/prepare-config-persistence.mjs:61)。

buildEffectivePointIndex 自行构建 byConn/byDev，将顶层和所有 session 的设备按裸 ID 放进一个 Map，后来的 B/d1 覆盖 A/d1。点位的 owner 被保留，但其设备/连接却从这张全局字典取出；缺少层、sid、connection 的定位和真实 resolvePointDevice 路由校验。

真实生产 poll 已复现：A 是 c1/d1/unit1，B 是 c2/d1/unit2，点位 ID 不冲突，I/O 正确路由；但 A 的采样章错误：

```json
{"actualUnit":1,"stampedUnit":2,"raw":1000}
```

生产 device.update 再将 A 的 unit1 改成 unit9，B 仍 unit2。配置保存成功，但错误索引仍认为 A 使用 B/unit2，generation 不变、旧 raw=1000 保留，普通验证期望 1000 又 pass：

```json
{"actualUnit":9,"oldRaw":1000,"status":"pass","value":1000,"tokenChanged":false}
```

复现先经过一次实际元数据 mutation，使规范化默认值稳定，再建基线；否则首次 fold 的 scale/offset 默认化可能偶然清值，掩盖真正的 unit 失效 bug。

同一新索引还有冲突枚举问题：两个私有 dup 先 out.delete，第三个 owner 又 out.set，结果三个 owner 被索引为 C 的唯一对象。旧 resolveEffectivePointIdentity 仍判歧义，因此这条证据不是“正常 batch poll 已绕过旧预检”；它说明用于 generation/commit 的新索引与旧授权判断分叉，必须修，不能依赖其它入口刚好挡住。

修复：复用既有 layered 有效身份、shared 覆盖规则和已解析设备路由；按真实层/sid/connection+device 取实体，不跨层裸 ID union。索引应显式返回 unique/ambiguous/missing，冲突状态不能在第三条变回 unique。capture 使用实际执行计划的 connection/device，commit 用同一语义核对。测试须对照 transport 的真实 unit/endpoint 与 stamp，而不是 producer、fixture、reader 都调用同一 helper 后自洽。

### F3：仿真退出后重新授予旧值新身份

位置：[write-sim-execute.mjs:46](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/modbus/write-sim-execute.mjs:46)、[write-sim-execute.mjs:72](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/modbus/write-sim-execute.mjs:72)。

写 p1 时先将 conn.sim 改为 false，配置失效本来已删除该端点旧值；新分支随后遍历 priorValues，对未被写入的 p2 使用旧 raw/旧 at 加上新端点的 fingerprint/generation，再提交。

真实 sim modbusWrite 复现：p2=77 的时间戳完全没变，端点已 sim=false，generation 被替换为新 token；scoped reader 禁止补读时仍返回合格 77。没有对 p2 做真实设备采集。

修复：禁止重贴章恢复旧兄弟样本。旧值可作为明确标注的历史/仿真数据保留，但不得进入新真实端点的可信 live values。目标写入也应保留“sim/local”来源：要么保持模拟端点，要么使用独立模拟/覆盖来源语义；不能以切换 sim=false 后盖章宣称真实 readback。若要进入真实模式，必须新的合法采集。不要以兼容“写一个点保留其它显示值”为理由放宽章的来源不变量。

### F4：歧义解除后旧 token 与旧值一起复活

位置：[sample-generation.mjs:81](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/domain/modbus/sample-generation.mjs:81)、[sample-generation.mjs:120](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/domain/modbus/sample-generation.mjs:120)。

当前逻辑保留 ambiguous ID 的 token；恢复单 owner 时 prevIndex 没有该点，代码把它当 new point，却优先复用 candidateGenerations 的旧 token，且不加入 invalidated。

已复现 A 唯一 p1=77 → B 新增同 ID → B 删除同 ID：恢复后新旧 generation 相同，未采集就可直接读回合格 77。

“歧义行不从磁盘删除”的既定要求不意味着“信任代次可以复用”。修复应分开历史保留与资格失效：唯一/歧义/missing 的状态迁移必须进入 diff；歧义期间可以保留旧磁盘行，但进入或解除歧义时撤销/更新可信代次，恢复后旧 stamp 不能合格。补 transient ambiguity 和三个以上 owner 的状态机测试。

### F5：reader 仍可把无章/错章数据洗成当前合格值

位置：[scoped-point-reader.mjs:126](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/verify/scoped-point-reader.mjs:126)、[scoped-point-reader.mjs:253](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/verify/scoped-point-reader.mjs:253)、[verify-telemetry-adapter.mjs:88](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/verify/verify-telemetry-adapter.mjs:88)。

两条边界复现：

- publish 完整 reading 带 foreign-old-geometry/old-generation，函数仍返回 true，并覆盖成当前 fingerprint/generation。
- 真实 adapter 使用的 modbusReadFn 返回 ok=true、时间戳新鲜、但 values 行没有 sampleIdentity；条件只在 stamp 已存在时查错配，随后 finalizeDirect 为无章数据盖当前章，99 被缓存成合格。

第二条是可注入 provider 的契约缺口，不宣称正常生产 read 在每次调用中都返回无章；第一条 API 当前主要由受控调用/测试使用，也不是 Agent 任意输入可直接攻击。但两者都违反已裁定的“完整 reading 必须验证，不能自动补章”，使异步迟到/适配错误能绕过信任边界。

修复：标量“现在发布”的受控 API 与携带 timestamp/provenance 的完整 reading 分支明确区分；完整 reading 缺章/错章拒绝，不覆盖。direct result 的 stamp 必须存在并匹配 I/O 后重新确认的当前身份；冷启动只允许 Host 采集前初始化生成的合法 stamp，不允许 reader 事后创造。默认无章/错章 provider、撤权、配置改变、cold-start 均测具体错误和“不缓存”。

### F6：未来 timestamp 可以提前制造覆盖证据

位置：[verify-observation.mjs:40](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/application/verify/verify-observation.mjs:40)、[stable-window.mjs:47](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/domain/verify/stable-window.mjs:47)。

observeReading 只校验正有限 timestamp，age 用 Math.max(0, now-timestamp)，未来时间被视为新鲜。stable window 也不比较样本时间和实际观察时间。

可控 clock 已复现：首样本 1000，下一次当前仅 1020 时提供时间戳 2000；墙钟到 1080 时，80ms 窗口已返回 `[10,10]`，把尚未发生的采样当覆盖。

修复：Host 采样时间不得大于本次观察时间（如要容差必须显式定义并测试，不能默认 Infinity）。Observation 与 window 防御性校验、clock/now 贯通；返回 INVALID_SAMPLE/unverifiable，不能刷新为 now 或算作 freshness=0。保留已有 timeout/cancel 与历史数据等待规则。

### F7：内部全局代次表进入了会话 RPC 快照

位置：[modbus-migration.mjs:131](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/domain/modbus/modbus-migration.mjs:131)、[vision-rpc-workspace.mjs:125](/Users/qin/DSH/plugins/dsh-vision-suite/dsh-vision-bench/src/interfaces/rpc/vision-rpc-workspace.mjs:125)。

normalizeModbus 保留整个 sampleGenerations；projectModbusForSession 携带它，omitSessionConfigs 只去掉私有配置。生产 RPC 使用的 sessionWorkspaceView 因而外发整张全局表。

复现中 A 的 points 只有 public-to-a，但 modbus.sampleGenerations 同时含 private-b-id 及其 token。泄露的是外国点位存在和内部代次标识，不是此次证明已泄露外国完整采样值；UUID 也不是认证密钥。它仍违反了 020 明确的“内部 map 不进外国会话响应”要求。

修复：在客户端/Agent 输出边界排除内部全局 map（UI 不需要时完全省略，确需时只投影可信可见点）。Host config/runtime 与 capture/commit 内部仍完整保留；不要为了隐藏输出把保存路径的 metadata 一并删掉。workspace/get、snapshot、workspace/save 成功返回及 config 返回分别回归。

## 3. 对第十、十一轮报告的确认与纠正

### 已确认匹配源码的部分

- A-14：status/trend 已进入 Agent kind/id 适用表，Host/preflight 共用校验。实际非法 kind 的六查询验证有效；本次既有测试还覆盖 id。不要把六个 kind 调用扩大成“全部参数已严格校验”。
- A-15：公共 hint 不再固定提 points list，evidence 专属 hint 保留。这里已收敛。
- timeline 的 summaryTruncated/budgetTruncated 确已实现，但来自 019；本轮再次实测确认，不是 020 才首次加入。
- 初值的非有限数及特殊字符串已在注册前拒绝；领域防御已补。legacy 显式 owner 过滤已改为先 owner 后 ID。没有在此次发现对应的新假阳性。
- read 的 Agent 投影确实直接返回 value 对象，因此会带 sampleIdentity。这条体积观察有代码依据。

### M1：A-11 不再按业务缺陷立项

`vision-bench-tool.mjs` 已写明 status.log 隐藏无会话归属短日志，logHiddenCount 不是可读条数/未读计数，会话事件走 timeline.list。timeline 不是那 8 条无主日志的完整展开入口；也不能把 status.log 永远空作为所有调用方的通用契约。当前报告的“唯一遗留未修、建议补文档”漏掉了已有说明。

### M2：响应体积应在 Agent 投影精简，不能省掉新采样

projectRead 在选择 wanted IDs 后未 compact value row，sampleIdentity 完整字符串随每条 value 返回，体量会上升。报告的现场字节估算本次没有复测；字节/token 的换算与 tokenizer/语言相关，不把估算作精确 token 证据。

建议保留 Host persistence/read-service/verify 的完整采样章，Agent 默认输出仅需要 point/conn/device、value/raw、ok/error、at；必要的来源诊断使用独立受控详细查询或简短标记。不要修改内部 read-service 的 stamp 契约，否则又击穿 F5。

“值未变时不重复返回”需要纠正：数值相同但 timestamp 前进是新的合法采样，恰好是 stable 的证据。可以省不必要的模型可见 metadata，不能因为 fingerprint/generation/value 相同就把新采样事件/时间抹掉。fingerprint 证明配置，generation 证明代次；何时采样由 at/timestamp 证明，UUID 本身不编码时间。

### M3：交付 diff 检查覆盖面不足

当前工作树干净，所以 git diff --check 可以绿；对完整迭代范围运行却在 point-model.mjs:322 报 new blank line at EOF。是小型 P3 清理项，不影响上面业务优先级，但不能把工作树检查当作所有已提交改动的 diff 检查证据。

### 验收边界

- 报告没有测 vision_debug verify；该工具的 Modbus 验证并不要求先有活动 GDB 调试会话。没有活动 debug session 不能成为跳过核心 verify 行为的理由。
- `read` 不改 configVersion，不等于无副作用：它会写任务、帧、运行值、时间线；“两轮只读”应限定成未修改配置/未写物理设备。
- `summaryTruncated/budgetTruncated` 本轮定义在 timeline；不能把“points/frames 没同名字段”直接当回归，需分别看既有分页契约。
- 没有真正回填游标、没有两会话验证、没有 sim→real 来源测试，不足以声明所有能力无退化。15 项清单的完成数不是整个插件的质量百分比。
- R5/R6 焦点迁移、R8 幂等失败终态仍是明确延期；不计为本轮新回归。

## 4. 建议下一步

先修 F1、F2、F3，堵住实际错误 pass 和旧值重新合格；同步处理 F4/F5，统一采样身份与 generation 的信任边界。F6/F7 作为独立时间/输出边界回归收齐，响应瘦身随后在 Agent 投影做。

迁入上述独立复现，生产路径必须对照真实执行请求和实际代次；不要只扩 stampWorkspace fixture，让 producer、reader、测试仍共用同一个错误索引。门禁全绿后，另补真实 Agent 的 vision_debug verify、两会话、sim 端点切换、完整游标回填和 Web/Desktop lab 验收，再声明 020 完整闭环。

本次仅新增本审查文档及 /tmp 复现材料，未修改业务代码、原始反馈/计划、生成产物，未提交、推送或安装。
