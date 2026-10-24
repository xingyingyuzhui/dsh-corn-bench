# Corn 插件集结构与测试重构 — 现行摘要

状态：**P0–P6 已完成**（2026-09-15）；后续组件治理见组件复用计划  
完整计划（基线、任务正文、实施记录）：[`archive/CORN_STRUCTURE_AND_TEST_REFACTOR_PLAN.md`](./archive/CORN_STRUCTURE_AND_TEST_REFACTOR_PLAN.md)  
后续治理：[`CORN_COMPONENT_REUSE_AND_ENGINEERING_PLAN.md`](./CORN_COMPONENT_REUSE_AND_ENGINEERING_PLAN.md)（进行中；真机验收暂缓）

## 版本

| 仓 | 版本 | 最终提交 | 说明 |
|---|---|---|---|
| `dsh-corn-bench` | **0.29.0** | `642b23b` | 结构/测试重构 + ADR-019～025 + P2-3 API 统一；CI 修复含 Windows 路径与 ModalDialog 展示测试 |
| `dsh-corn-harness` | **0.2.0** | 随合集树 | 入口生命周期测试与 `quality` 门禁 |

合集 submodule 指针已同步到 `642b23b`（经 `8117dbb` Windows CI 路径修复与后续 P2 工作），并已推送 `origin/main`（合集 tip `cccc2ed`）。

## 门禁

| 仓 | 命令 | 结果 |
|---|---|---|
| `dsh-corn-bench` | `npm run quality` | 本地与 CI 通过（无 skipped/todo） |
| `dsh-corn-harness` | `npm run quality` | 通过 |
| `dsh-corn-bench` | Windows 自动化 CI | 通过（`quality.yml`：ubuntu/windows × Node 20/22；最新绿 run 对应 `642b23b`） |

## 仍待人工事项

1. **真实 Windows 宿主验收** — `dsh plugin add/remove`、多窗口/session 隔离、client 缓存 bust、Windows 路径手测。  
   **自动化 Windows CI 不等于真机验收**，两者是独立证据链。按当前指示**暂缓**。
2. **真实硬件验收** — STM32 + OpenOCD、Keil UV4、Modbus RTU、Keil UVSC。  
   状态 `DEFERRED_WINDOWS_ACCEPTANCE`；清单见 `dsh-corn-bench/docs/WINDOWS_ACCEPTANCE_0.27.md`（**仍未执行**）。

## 结构目标快照

- `src/**` → `bench-*`：deps 规则为 error，0 违规。
- 根门面：≤80 行 re-export；生产 allowlist 为空。
- ADR-019～025 已齐；019–023 补文档欠账。
