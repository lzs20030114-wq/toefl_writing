# 挂起事项统一清单 (BACKLOG)

> 汇总全仓库范围内散落在各会话记忆 / 报告 / 分支里的待办、待决策、待验证事项。
> 风险等级：[高] 安全/资损/数据丢失风险 [中] 影响体验或成本 [低] 打磨/卫生类

## 需用户决策

- [高] 盲审 routine 停摆：阅读/听力/口语 9 库自 2026-06-30 停止合库，388 条积压 staging；trigger 台账仅剩 R1（07-03 重建时盲审/R2 未建回）。需拍板重建独立 trigger 还是并回 R1。出处：QUESTION-PIPELINE-REVIEW-2026-07-07。
- [高] 认证模型改造：6位码 bearer 可爆破（`app/api/auth/verify-code` 限流是内存滑动窗口，Vercel 多实例不全局生效）+ legacy 码自助升级仍在（同文件自动 upsert `legacy=pro`）。出处：PROJECT-REVIEW-2026-06-17，2026-07-05 复核仍在，未修复。
- [中] v1.11.0 线上冒烟未做（12 题型导入→练习全链路，重点 edge-tts 首次 Vercel 真实环境跑通）+ `DASHSCOPE_API_KEY` 是否已在 Vercel Production 环境勾选未确认。
- [中] 语音全库切换 gpt-4o-mini-tts 的 go/no-go：成本报价已出（全库一次性 ¥117，增量满勤 ¥50/月，2026-07-05 实测），只差 `/admin-voice-vote` 票数；lat/la/lcr persona 推广、音色定稿后重新生成听力库均挂在此决策之后。
- [中] 插入题专属 UI 立项与否：2026-07-05 复测确认数据面已清零（154/154 恰 4 个 ■ 标记+双重校验兜底），但渲染复用通用选择题壳（■ 是普通字符，肉眼数方块选 ABCD），无"点方块插入"原生交互。接受现状 or 立项做专属组件。
- [中] 2026-07-05 合并的支付修复 + CTW 防呆是否发版（用户可见变更：升级按钮修通 + CTW 灰底 chip；走 /release-notes）。
- [低] 模考 6.4 残项：#13 邮件排版（等参考图）/ #2#3 全屏与顶栏（等定范围）/ #18 三科合考（用户已 defer）。

## 进行中

（暂无）

## 可派工

- [中] referral 奖励无上限 + 一次性邮箱可无限薅 3 天 Pro（email-login 自动发放）——需先定防滥用策略，再实施节流/校验。
- [低中] gate harness 推广：`scripts/cli/enforce-gates.mjs` 仍是 REPORT-only，未接入生产 merge 流程；更多题型待接入注册表；语义判分门尚未设计。
- [低] IDOR 端点复查后的修复（feedback / mistakes / entitlements / speech-consent 等端点，具体清单见 PROJECT-REVIEW-2026-06-17）。
- [低] 清理残留的 `cleanup-orphan-audio` Edge Function（一次性删音频用，已完成使命；Supabase Dashboard → Edge Functions → 删除即可，或下次连 Supabase MCP 时由 agent 替换为失效桩）。
- [低] 休眠 fallback 直写路径防重补齐：`nightly-generate-bs.yml`→appendBSSets.mjs 只有精确 answer-key 去重（无模糊近重复）；`nightly-generate-disc/email.yml`→generateDisc/EmailQuestions.mjs 直写 prompts.json 仅 prompt 软提示避重（= §7 P1-8 残项）。三者均为手动触发的休眠后备，且有 quality-monitor CONTENT_DUP 兜底探测；接 contentDedup 或明确退役二选一。
- [中] R1 trigger 配置加 speaking-interview 行（repo 侧 07-09 已全接好：print-bank-prompt/merge/scoreBatch/gate/eval-spec；trigger prompt 在远程配置里，加行当晚即生效，见 docs/quality-pipeline.md ⚠ 注）。
- [中] R3 修订清单（评价标准审查产出，L2 前必修 P0×3）：①scoreBatch AP 段落数检测改格式无关 ②rdl-long 词数带复核（真锚覆盖仅 42%，顺带 ctw 60-95 复核）③L2 弃用 spec 的 Current 列；P1：BS 常量重锁×2（negationRatio/multiSegmentRatio）、关键锚落 data/realExam2026（AD 教授贴/AP 题型分布/listening 答案位）、库级形态检查进 L0 与 monitor、判别力病例库 data/eval-profiles/cases/、9 份 spec 补锚时效脚注；P2：解析质量等五盲区立项。详见 reports/R3-verdicts-2026-07-09.md。
- [中] 全库质量监测（计划已批准待执行；R 前置阶段 07-09 已完成：标准体系总体可信 78/80 复算通过，逐份裁决=可用4/修后可用3/仅monitor2，P0 修订后 L2 可开跑）：四层漏斗 L0 确定性全扫→L1 DeepSeek 答案二审(≈¥15-40, 顺手接听力 auditor=P1-9)→L2 拟真度抽样走夜间 routine→L3 人工复核；方案见 data/claudeGen/reports/FULL-QUALITY-AUDIT-PLAN-2026-07-09.md。
- [中] 出题管线审查 P1/P2 余项（BS 干扰词 0%/82%/10% 定案、答案位/最长项批级校验、听力 auditor 接线、LCR 范式配比等）：完整清单见 QUESTION-PIPELINE-REVIEW-2026-07-07 §7（监控加固已于 07-08 完成并移出）。
- [低] 仓库卫生：
  - 5 个已合并 worktree + 孤儿目录 `cranky-lehmann` 清理
  - 已合并分支清理
  - `.github/workflows/fix-legacy-prompts.yml` 删除（一次性脚本，确认已执行过且无后续用途后可删）
  - 约 25 个一次性脚本归档至 `scripts/legacy/`
  - （以上均为破坏性操作，需用户批准后再执行；本次任务未做任何删除）
  - `generate-bs.yml` / `generate-disc.yml` / `generate-email.yml` **不可删** — 见下方"调查 A"结论，仍被 `app/api/admin/generate-*/route.js` 通过 `lib/generateConfig.js` 主动 dispatch。

## 低优先级排队

- [低] 打卡三件套：树苗成长形态 / 移动端卡片 / goal 云同步（2026-06-12 flame v1 上线后无进展）。
- [低] BS 疑难搁置项（2026-06-17"太难修了先搁置"，具体内容需会话考古确认后再细化条目）。

---

## 调查结论

### 调查 A：`generate-bs.yml` / `generate-disc.yml` / `generate-email.yml` 是否仍被引用

**结论：全部仍在用，不可删除。**

- `lib/generateConfig.js` 的 `TASK_CONFIG` 显式声明三者为 `bs` / `disc` / `email` 三个题型的 `workflowFile`：
  - `bs` → `generate-bs.yml`
  - `disc` → `generate-disc.yml`
  - `email` → `generate-email.yml`
- `app/api/admin/generate-bs/route.js` 中 `WORKFLOW_FILE = "generate-bs.yml"`，并在 `dispatches` 请求中拼接 `https://api.github.com/repos/.../actions/workflows/${WORKFLOW_FILE}/dispatches` 实际触发 GitHub Actions。
- 与其平行存在的 `nightly-generate-bs.yml` / `nightly-generate-disc.yml` / `nightly-generate-email.yml` 是**定时任务**（cron 触发的夜间批量生成），和上述三个**按需/管理后台触发**的 workflow 是两套不同用途，不是新旧替代关系，两者都要保留。

### 调查 B：`data/buildSentence/answer_hashes.json` 生成入口

**结论：有两个不同粒度的生成入口，均在 `scripts/` 内，非孤立文件。**

1. **增量维护（生产管线内置，随生成自动跑）**：`scripts/generateBSQuestions.mjs`
   - 读取：`loadAnswerHashes()` 从 `ANSWER_HASHES_PATH` 加载已有 hash 集合，用于跨批次去重。
   - 写回：`saveAnswerHashes()` 在生成流程中更新该文件。
   - 这是 `generate-bs.yml` workflow 实际执行的脚本（`run: node scripts/generateBSQuestions.mjs`），按理每次生成都会顺带更新，但从 mtime（2026-05-14）看，近期的生成可能未触发这条路径，或该次运行未落盘更新——需要进一步确认最近几次生成是否真的调用了 `saveAnswerHashes`。
   - **不要在本任务中执行**——涉及真实 DeepSeek 调用与题库写入，有副作用与成本。
2. **全量重建（一次性/离线维护脚本）**：`scripts/batch-produce.mjs`
   - 末尾有显式重建全量 hash 的代码块："Regenerate answer_hashes.json to cover ALL bank answers"：遍历 `finalSets` 里所有 `questions[].answer`，对每个答案做 `sha256(trim().toLowerCase())`，整体覆盖写入 `data/buildSentence/answer_hashes.json`。
   - **建议重生命令**（供后续派工时参考，本次未执行）：
     ```bash
     node scripts/batch-produce.mjs
     ```
     该脚本运行后会自动把 `answer_hashes.json` 与当时的 `finalSets`（含全量题库）对齐重建。执行前应确认脚本的其它副作用（是否会同时追加新生成的题目到 `questions.json`），必要时先读脚本头部的用法/环境变量说明，或加对应的"仅重建 hash 不生成新题"参数（如脚本支持）。
   - `scripts/batch-fresh-produce.mjs` 只是读取路径常量（`HASHES_PATH`），未在已读片段中看到显式写入调用，需要进一步确认其是否也会触发全量重写（如需要精确重生流程再深入读取该脚本全文）。

---

## 使用说明

发版/推送前须过一遍本清单；完成的条目移到文件底部 Done 区并标日期。

## Done

- 2026-07-09 RDL 拟真度标准沉淀（docs/eval-spec/rdl.md）：把 rdlDeepFlavor/rdlGapAnalysis/rdlPitfallAnalysis 三个分析文件（04-09 实测）整理成 11 维标准；确认 samples/readInDailyLife 含 ETS 官方 6 组（金层）+ 备考商 51 组（银层）参照语料——「RDL 零锚」实为「有锚未登记」。至此 13/13 题型全部有成文标准。后续：官方 6 组归档 realExam2026、易加检测器×4 并入 P1-7（见 spec 末节）。
- 2026-07-09 interview 纳入自动化（§7 P1-11 方案A，分支 claude/recent-work-visibility-yg5ma4）：print-bank-prompt interview 档 + merge-staging validateInterviewSet fail-closed + scoreBatch/quality-gates(70/80) + eval-spec（真题锚差距「4 问产品设计 vs 回忆中位 6-7 问」记录在案，字数维度 monitor-only）。剩 R1 trigger 配置加行（转可派工）。
- 2026-07-08 出题管线审查 P0 收尾包（分支 claude/recent-work-visibility-yg5ma4，待合 main）：①监控加固 4 项（bank git 时间戳 >48h 告警 / staging 积压 7 日增量判警 / live 库内容重复旁路探测 / null 指标升硬告警，实测即抓到 repeat.json 停更 212h）②封 admin「部署到正式题库」零校验旁路（lib/gen/deployGate.js 与夜间 mergeClaude 同判：validator+去重 0.75/0.8+strict 门；merge-staging 对 interview fail-closed）③email em224-227 占位符修复。全量 jest 639 过 + next build 过。
- 2026-07-08 孤儿听力音频清理落地：删 740 / 留 120（被练习历史引用），走一次性 Edge Function + SQL Editor 执行（scripts/sql/2026-07-08-cleanup-orphan-audio.sql，用户确认跑完）；全清单存档 reports/orphan-audio-cleanup-2026-07-08.json；台账已登记。
- 2026-07-07 出题去重全链路（分支 claude/question-pipeline-review-6p2bpt，待合 main）：合库层内容去重挂全题型 + 生成端排除改 bank∪staging（修 LAT 排除空转、RDL 补 exclude）+ 清除 8 库存量重复 1472 条（3083→1611，复测归零）+ `answer_hashes.json` 重建（590→612；原「重生」待办一并完成，旧台账与现库零重叠早已失效）。
- 2026-07-05 XorPay 金额对账（按分对账无容差，不符 403 拒发权益）+ webhook 顺序改"先授予后标 processed"（原顺序会致付钱不发货）——已合 main，jest 581 全过。
- 2026-07-05 五处升级按钮 `open-upgrade-modal` 死 no-op 修复（HomePageClient 全局监听 + speaking-exam 自持 modal）——已合 main。
- 2026-07-05 CTW 填词防呆修复（灰底锁定 chip + 键盘导航）cherry-pick 2b3f96c 合入 main（分支上过时的 v1.9.4 发版提交已丢弃）。
- 2026-07-05 产品 P0 复测：BS 干扰项已修（did 99.6%→14.6%，88 种）；模考评分失败清零 band 已修（"--"+错误文案+重试按钮）；插入题数据面已清零（UI 欠账转为上方决策项）。
