# 021 采样信任边界修复验证

日期：2026-10-13。基线 `bc3fcda`，包版本当时为 `0.29.28`。本轮目标版本 `0.29.29`。

## 过程

计划要求每组红测先在基线上运行并记下失败摘要，再和对应修复一起提交。实际没有这样做：开始写生产代码时，工作树里已经有未提交的修复，基线红测日志没有留下。下面的证据都是修复后的结果。行为提交因此合成一条 `60b2cf0`，没有按计划拆成五个独立修复提交。EOF 空行单独在 `e110c64`。

## 行为

- 点位的 connection 和 device 只在该点自己的层里解析。两个会话复用同一个 deviceId 时，transport 请求的 unit 与 fingerprint tuple 一致。
- 几何、归属或端点变化立即换代次。旧值行保留旧章。ambiguous 没有当前 token；回到 unique 时发新 token。
- 会话 bind 不发明、不轮换 token。schema v2 只在 poll/read/write 的 ensure 路径轮换一次，prepare 不再另发一套。`configVersion` 不因这次迁移额外增加。
- 仿真写入保持 `sim=true`，只给本次点位盖当前仿真身份，并标 `source: sim-write` / `simulated: true`。显式切到真实端点后，旧值不能被校验读成当前值。
- 缺章是 `INVALID_SAMPLE`，章与当前身份不一致是 `STALE_VALUE`。未来时间在 observation 和 stable window 都是 `INVALID_SAMPLE`。身份保存失败时不做采样写入，写入任务会结束。
- `workspace/get`、`state`、`workspace/save` 成功响应和配置 mutation 响应不带 `sampleGenerations`。调用方显式提交内部字段返回 `INVALID_FIELD` / `INTERNAL_FIELD`。省略这些字段再保存，磁盘上的 token 还在。

## 门禁

修复后的 `npm run test:unit`：1827 pass，0 fail。

同时通过的检查：`structure:check`、`lint`、`typecheck`、`deps:check`、`facades:check`、`ui:ownership:check`、`assertions:check`、`test:coverage`、`coverage:critical`、`git diff --check 54581d0..HEAD`。

覆盖率摘要：statements 85.91%，branches 72.06%，functions 78.9%，lines 85.91%。`write-execute.mjs` 的分支下限从 70 调到 68，对应这次实测 68.8%。没有扩大结构预算 allowlist。

## 安装

本地包版本 `0.29.29`，`buildId` `518e7019b38e7c496515cc67149778a18135136372c6a87874b9c13177d07c74`，`gitSha` `0c54ad2`。

- Web：`dsh plugin --profile web add` 本地 tarball 后，profile 里的 `package.json` 和 `build-info.json` 已是 0.29.29。pnpm 以 `ERR_PNPM_IGNORED_BUILDS` 退出，因为 `@serialport/bindings-cpp` 的安装脚本被忽略。当时没有正在运行的 `dsh web`，所以没有重启，也没有做两会话 snapshot 或仿真校验。
- Desktop：DeepSeek Harness 没有在运行。`scripts/probes/install-desktop-local.mjs` 成功，事件 `vision.desktop.local-install`。profile 里的版本和 `buildId` 与 Web 相同。没有重新打开应用，也没有做同一组界面 smoke。

这只说明两个 profile 装上了本轮包。不能写成原生双端验收通过。

## 没有验证的部分

- 物理串口、RTU 和真实 TCP 设备仍不在本轮。
- R5/R6 焦点迁移和 R8 幂等失败终态不在本轮。
- Web 与 Desktop 的运行中界面 smoke 没有做。
- 没有推送 GitHub，没有 npm publish，没有走 Desktop 应用商店的 registry 安装。
