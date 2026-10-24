# 合集工程化与 0.30.0 收口 — 现行计划

状态：**进行中**（2026-10-23 起）  
范围：`dsh-corn-suite` 合集层；`dsh-corn-bench` 只做门禁修正，不动发布包  
基线：bench `0.30.2`（`v0.30.2` @ `d1f6f7f`），DSH 契约钉 `0.2.1-rc.2`

## 背景

合集仓此前只有 README、两篇计划文档和一个 submodule，没有任何门禁。0.30.0 发布当天出现三处漂移：

1. `README.md` 仍写发布线 `0.29.30`，而 submodule 已经指到 `e98fc18`（当时的 `v0.30.0`）。
2. `docs/CORN_STRUCTURE_AND_TEST_REFACTOR_PLAN.md` 的「版本」表仍以 `0.29.0` / `642b23b` 为基线。
3. bench 仓 `CHANGELOG.md` 在打了 `v0.30.0` 标签时还留着 `## Unreleased` 段，且 `v0.30.0` 提交上没有跑过 CI。

同时 `npm view dsh-corn-bench` 仍是 404 —— 官方 npm 产品安装路径依然不可用，Desktop 只能走 lab tarball。

## 事实来源

| 事实 | 权威来源 |
|---|---|
| 发布版本 | `dsh-corn-bench/package.json` 的 `version` + `v*` tag |
| 合集 pin | 合集仓 index 里的 submodule gitlink（不是 checkout） |
| 契约版本 | `dsh-corn-bench/src/infrastructure/harness/dsh-contract.mjs` 的 `SUPPORTED_DSH_CONTRACT` |
| 文档该写什么 | `suite.manifest.json` |

## 本轮完成

### S1 机器可读清单

`suite.manifest.json` 记录发布线、tag、DSH 契约钉、文档清单和每个插件的 `kind`（`submodule` / `vendored`）、`defaultInstall`。README 不再是唯一事实来源。

### S2 一致性门禁

`scripts/check-suite.mjs`（`npm run check`）从 git 和 `package.json` 反查，只有**说错了**才失败：

| 检查 | 失败条件 |
|---|---|
| 版本对齐 | `package.json` 的 version ≠ manifest `releaseLine` |
| 文档对齐 | README 没有提到 releaseLine、tag 或契约钉 |
| 发布记录 | `CHANGELOG` 缺少 `## <releaseLine>` 段，或已发布版本下仍有 `## Unreleased` |
| pin 与 tag | manifest tag 不存在，或 tag 指向的提交 ≠ 合集 pin |
| submodule 形态 | `kind: submodule` 但 index 里不是 gitlink |
| vendored 形态 | `kind: vendored` 却声称自己有 tag |
| 默认安装 | 不是恰好一个 `defaultInstall` |
| 文档存在 | manifest 引用的计划文档缺失 |

**故意不算失败的两件事**：插件工作树 dirty、submodule checkout 不等于 pin。前者是开发中的正常状态，后者本来就要在提 PR 前才对齐；两者都以 `note:` 输出。真正的谎言（pin 指到未打 tag 的提交）才拦截。

门禁只读：不自动改文件，所以写错的文档不可能静默通过。

### S3 发版脚本

`scripts/bump.mjs --tag vX.Y.Z [--dry-run]` 一次对齐 manifest、README 和 submodule pin；tag 不存在、包名不符、插件树 dirty、合集有无关改动、README 没有发布线句式，都会在写文件**之前**失败。

### S4 合集单测

`test/check-suite.test.mjs`（14 例）与 `test/bump.test.mjs`（11 例）。每个用例只破坏一个事实；涉及 pin 的用例用真实的两仓 git 布局，不 mock。

### S5 CI

`.github/workflows/suite.yml`：合集门禁 + 单测，加上 bench（ubuntu/windows × Node 20/22/24）的 `npm run quality`。此前 bench 的 CI 只在自己的仓里跑，合集没有任何跨仓验证。

### S6 bench 的一条假通过

`test/devices/write-task-lifecycle.test.mjs` 在 macOS 上一直是假通过：`write-file-atomic` 在 rename 前会 `fs.realpathSync`，而 `$TMPDIR` 的 `/var/...` 会被解析成 `/private/var/...`，测试拿未解析的路径去比对，mock 从不命中，于是「保存失败必须关掉写任务」这条路径其实没被验证。改为比对解析后的路径后该用例才真正通过，并在修复后补跑 `npm run quality` 全绿。

### S7 安装文档的一处假话

README 与验收矩阵此前都写「桌面插件窗口拒绝 `file:` / `tgz` / `link:` / `github:`，只有 registry 包名可用」。按本机 DSH `0.2.1-rc.2` 解包 `app.asar` 后读 `@deepseek-ai/dsh-plugin-manager` 的 `install-spec.js`（正是那个窗口解析 spec 的地方），实测四种形式都被接受，只有裸包名需要 registry：

| 输入 | 解析 |
|---|---|
| `github:owner/repo#v0.30.1` | `git` |
| `https://github.com/.../pkg-0.30.1.tgz` | `tarball` |
| `/abs/path/pkg-0.30.1.tgz` | `tarball` |
| `name` / `name@version` | `registry` |

文档已按此改写。这是**读代码得出的能力判断**，不是安装证据：没有在窗口里真的点安装，验收矩阵那一行仍标 `not yet exercised`。

### S8 发版 0.30.1

S6 只动测试文件，`buildId` 不变；S7 动的是 `README.md` 与 `docs/ACCEPTANCE_NATIVE_WEB_DESKTOP.md`，两者都在 `files[]` 内，`buildId` 因此变化——**文档修正必须跟随一次发版才能进入安装包**。所以发 `0.30.1`：

| 项 | 值 |
|---|---|
| tag | `v0.30.1` @ `0e80efe` |
| 产物 | `dsh-corn-bench-0.30.1.tgz`（1230756 B） |
| SHA-256 | `3045b582e5b0334e053aaf145bccbd04fd51184d822dc93ec7ae1f63bc26c047` |
| `buildId` | `d723c17c8c6e…` |
| 渠道 | 仅 GitHub Release（维护者决定不发 npm） |

产物由干净工作树的 tag 提交 `npm pack` 得到，上传后 GitHub 报的 digest 与本地 SHA-256 一致；tarball 内 `package.json` 版本、`build-info.json` 版本与 `gitSha` 都已核对。

## 未完成

| 项 | 状态 | 说明 |
|---|---|---|
| npm 发布 `dsh-corn-bench` | **不发** | 维护者决定只放 GitHub 仓。裸包名仍 404，所以桌面插件窗口只能填 git tag 或 tgz 绝对路径 |
| Desktop 实测安装 | **未做** | 未在窗口里实际点安装（会弹窗）；能力判断来自 `install-spec.js`，证据仍为 `not yet exercised` |
| Desktop 运行时验收 | **未做** | 按维护者指示不自动跑会弹窗的 Electron 测试；证据保持 `unverified` |
| bench 仓 Actions | **保持禁用** | 维护者决定不启用。bench 的门禁改由合集 workflow 跨仓执行 |
| Desktop DSH 根路径解析 | **已修（0.30.2）** | Electron 下 `process.execPath` 是应用主程序，旧逻辑落到无关的全局 CLI，导致误报 DSH 版本；改用 `process.resourcesPath` 指向 `app.asar/dsh` |
| `dsh-corn-harness` | **已移除** | 0.2.1 只适用 DSH ≤ 0.1.6，与 0.2.x 契约不兼容；移除前已打归档 tag `archive/dsh-corn-harness-0.2.1` |
| Windows 真机 / 完整 RTU | **未宣称** | 见 `dsh-corn-bench/docs/WINDOWS_ACCEPTANCE_0.27.md` |
| plan 文档版本表 | 部分 | 本文件为现行基线；`CORN_STRUCTURE_AND_TEST_REFACTOR_PLAN.md` 保留为历史摘要，其版本表不再作为发布依据 |
