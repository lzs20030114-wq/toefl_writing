# 全库质量监测 — 交接文档（2026-07-09 收笔）

> 本轮工作到 L1 全量启动为止；后续接手者（任何会话/账号/人工）按本文续跑即可，
> 不需要原会话上下文。所有状态都在仓库里。

## 当前状态（一句话）

**R 前置阶段 ✅ 完成 · L0 ✅ 完成 · L1 🔄 全量运行中（GitHub Actions）· L2/L3 ⏸ 待启动。**

## 各层状态与产物

| 层 | 状态 | 产物/位置 |
|---|---|---|
| R0-R3 标准审查 | ✅ 完成 | 本目录同级 `R0/R1/R2/R3-*-2026-07-09.md` 四份报告；常驻脚本 `scripts/audit/measure-anchors.mjs`；裁决=可用4/修后可用3/仅monitor2，P0×3 已修（scoreBatch 量尺） |
| L0 确定性全扫 | ✅ 完成 | `L0-report.md` + `L0-suspects.json`。全库干净；唯一嫌疑=BS 题级重复 11 条（4 exact+7 near）**待 L3 人审** |
| L1 答案二审 | 🔄 运行中 | GitHub Actions `full-audit-l1`（workflow 在 main，运行在本分支）。冒烟已验证（24 条：19 ok / 5 suspect）。结果自动提交回本分支：`L1-report.md` + `L1-suspects.json` + `L1-state.json` |
| L2 拟真度抽样 | ⏸ 待启动 | 前置全部就绪：13/13 题型标准过审、执行三原则写在 `FULL-QUALITY-AUDIT-PLAN-2026-07-09.md` L2 节。启动方式=把「每库分层抽 30 题按 eval-spec 维度出 verdict」排给夜间 Claude routine，分 2-3 晚 |
| L3 人工复核 | ⏸ 待启动 | 等 L1/L2 出全嫌疑清单后，人工过一遍（每库≤10 条），拍板删/修/留 |

## L1 续跑手册（最可能需要的操作）

- **正常情况**：一轮 5 小时预算内跑完 ~1665 条，报告自动提交，无需操作。
- **没跑完/有 error**：再触发一次即可断点续跑（已审条目不重复花钱，error 自动重试）。
  - 网页：仓库 → Actions → full-audit-l1 → Run workflow → **Branch 选 `claude/recent-work-visibility-yg5ma4`** → 全留空 Run；
  - 或 API：`POST /repos/lzs20030114-wq/toefl_writing/actions/workflows/full-audit-l1.yml/dispatches` body `{"ref":"claude/recent-work-visibility-yg5ma4"}`。
- 判断跑完：`L1-report.md` 末尾出现「**状态：全部审完**」。
- 成本：DeepSeek 全量约 ¥15-40，断点续跑不重复计费。

## 分支与合并说明

- **工作分支 `claude/recent-work-visibility-yg5ma4`** 含本轮全部代码工作（除 L1 两文件已 cherry-pick 上 main 外均未合 main）：
  监控加固 4 检查、admin deploy 封旁路(deployGate)、merge-staging interview fail-closed、
  interview 自动化接线、scoreBatch 量尺修复(P0)、eval-spec rdl/interview 两份、
  审计脚本 ×3(measure-anchors / run-l0 / run-l1)、email em224-227 修复、全部审计报告。
  jest 639 全过 + next build 过。**合 main 时走 /ship 检查链。**
- **main 已有**：L1 跑批器 + workflow（e948d8b cherry-pick）；孤儿音频清理已执行完毕（删 740/留 120，台账已登记 MIGRATIONS.md）。

## 移交的未决事项（详见 docs/BACKLOG.md，此处只列本轮新增/相关）

1. **R1 trigger 配置加 speaking-interview 行**（repo 侧全接好，只差 trigger prompt 加行，见 docs/quality-pipeline.md ⚠ 注）；
2. L1 跑完 → 看 L1-report / L1-suspects，与 L0 的 BS 11 条一起进 L3 人审；
3. L2 排夜间 routine（按计划文档 L2 节 + 三原则）；
4. R3 修订清单 P1×5 / P2×1（BS 常量重锁、锚落库、库级形态检查进 monitor、病例库、时效脚注、解析质量等五盲区立项）；
5. 盲审 routine 重建决策（P0-1，最老的未决项）；口语 repeat 合库 07-08 已恢复但需观察 quality-monitor 日报。
