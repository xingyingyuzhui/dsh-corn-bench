# Changelog

合集层（`dsh-corn-suite`）自身的变更。插件变更记录见
[dsh-corn-bench](https://github.com/xingyingyuzhui/dsh-corn-bench/blob/main/CHANGELOG.md)。

## 0.1.3

品牌化为 **Corn**（原 Corn），对齐 Corn Modbus：

- README 标题改为「Corn 套件」，文案里的 Corn模式 / 设置 → Corn 改为 Corn模式 / 设置 → Corn；新增「品牌与技术 id」一节说明哪些 id 不改。插件侧的界面改动见 [dsh-corn-bench#4](https://github.com/xingyingyuzhui/dsh-corn-bench/pull/4)，随插件下一个版本发布；本版仍钉 `v0.30.2`。
- 新增玉米图标 `assets/corn-icon.png`，README 顶部显示；标注作者 [xingyingyuzhui](https://github.com/xingyingyuzhui) 与仓库地址。
- 授权从 MIT 改为 **PolyForm Noncommercial 1.0.0**：新增 `LICENSE.md`（含 Required Notice），`package.json` 的 `license` 改为 `PolyForm-Noncommercial-1.0.0`，补 `author` / `homepage` / `repository`。此前的版本仍按 MIT。

## 0.1.2

- 发布线更新到 `dsh-corn-bench 0.30.2`（`v0.30.2`）。该版修正 Desktop 下 DSH 安装位置解析：Electron 的 `process.execPath` 是应用主程序，反推的前缀并不存在，解析会落到无关的全局 CLI，导致设置页误报「已安装 DSH 0.1.7」并让 `dsh-persona` 无法加载。现在优先用 `process.resourcesPath` 指向应用自带的 `app.asar/dsh`。

## 0.1.1

移除 `dsh-corn-harness`：

- 它只适用于 DSH ≤ 0.1.6（standing-guard 包装的 `agentPresets.ensureStanding` 在 0.1.7 起已不存在，插件会在加载时明确抛错），且从未发布到 npm、没有独立仓库 —— 合集里的这棵树是唯一副本。
- 移除前打归档 tag 并从该 tag 导出快照，代码仍可完整取回：

  ```sh
  git archive --format=tar.gz archive/dsh-corn-harness-0.2.1 dsh-corn-harness \
    > dsh-corn-harness-0.2.1.tar.gz
  tar -xzf dsh-corn-harness-0.2.1.tar.gz
  ```

  归档 tag：`archive/dsh-corn-harness-0.2.1`（指向 `8c2a272`），28 个文件。
  注意不要把 `dsh-corn-harness` 写成 `-- dsh-corn-harness`：一旦用 `--` 分隔，`--prefix` 会再叠加一层，产出 `dsh-corn-harness/dsh-corn-harness/`。
- `suite.manifest.json` 新增 `archived[]` 段记录此事；CI 去掉 harness job；README 与包描述同步更新。


## 0.1.0

合集从「只有 README + submodule」升级为有门禁的合集：

- 新增 `suite.manifest.json`：机器可读地记录发布线、submodule tag、DSH 契约钉和文档清单。版本号不再只写死在 README 里。
- 新增 `scripts/check-suite.mjs`（`npm run check`）：用 git 和每个插件的 `package.json` 反查事实，README 写错版本、submodule 指针落后于 tag、`CHANGELOG` 还留着 `## Unreleased`、vendored 插件冒充自己的 tag、多个 `defaultInstall` 都会直接失败。门禁只读，不改文件。
- 新增合集自身的单测（`test/check-suite.test.mjs` 14 例 + `test/bump.test.mjs` 11 例），每个用例只破坏一个事实。
- 新增 `scripts/bump.mjs`：发版时一次性对齐 manifest、README 与真实 tag，拒绝指向未打 tag 的提交。
- 新增 GitHub Actions（`.github/workflows/suite.yml`）：合集门禁 + 两个插件各自的 `npm run quality`。
- README 发布线更新到 `dsh-corn-bench 0.30.1`（`v0.30.1`），DSH 契约钉 `0.2.1-rc.2`。

修正：

- `dsh-corn-bench` 的 `write-task-lifecycle` 在 macOS 上一直假通过：`write-file-atomic` 写前会对路径做 `fs.realpathSync`，而 `$TMPDIR` 的 `/var/...` 会被解析成 `/private/var/...`，测试比对的未解析路径永远不命中，于是「保存失败」这条路径其实没被验证到。改为比对解析后的路径。
- README 与验收矩阵此前声称桌面插件窗口拒绝 `file:` / `tgz` / `link:` / `github:`。实测本机 DSH `0.2.1-rc.2` 的 `@deepseek-ai/dsh-plugin-manager` `install-spec.js`，这些形式都接受，只有裸包名需要 registry。已改正。
