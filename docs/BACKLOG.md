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
- [中] 860 条孤儿听力音频清理（Supabase storage）：清库删除的重复条目各有独立 audio_url，id 清单在 `data/claudeGen/reports/dedup-removed-ids-2026-07-07.json`。
- [中] admin「部署到正式题库」按钮接入 validator+gate（当前零校验旁路，同题不同判）。出处：QUESTION-PIPELINE-REVIEW-2026-07-07 §2.3。
- [中] 出题管线审查 P1/P2 余项（BS 干扰词 0%/82%/10% 定案、答案位/最长项批级校验、听力 auditor 接线、LCR 范式配比、监控加固等）：完整清单见 QUESTION-PIPELINE-REVIEW-2026-07-07 §7。
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

## 自适应模考超时修复 review 遗留（2026-07-12）

> 本次已修：误挂超时徽章 / 听力展开态位置下标 / 深链改带 session 身份 + 保存失败提示 / 弱项诊断排除全未答任务。以下为 review 确认但本次未修的余项。

- [中] 听力回看渲染器（`LCRDetail`/`LADetail`/`LCDetail`）缺「未作答」标注，与阅读 `MockSessionDetail`（有 `selected == null → 未作答`）不一致；根因是听力未复用 `MockSessionDetail`。出处：`components/listening/ListeningProgressView.js`。
- [中] checkpoint 中途退出仍丢当前题作答——collector 机制已在（`partialCollectorRef`），接进 `saveAdaptiveCheckpoint` 即可复用超时那套部分作答收集。出处：`components/mockExam/AdaptiveExamShell.js`（checkpoint effect）。
- [低中] `IntroCard` 题量为手写魔法串（如「20 题 (CTW 10空 + RDL 5题 + AP 5题)」），应由 planner 导出构成常量派生，避免与真实出题结构漂移。出处：`components/mockExam/AdaptiveExamShell.js` ~1211 + `lib/mockExam/readingPlanner.js` / `listeningPlanner.js`。
- [低] 阅读 `IntroCard` 5 盒奇数网格致「总计」盒孤儿半宽（视觉不齐）。出处：`components/mockExam/AdaptiveExamShell.js` ~1248，可给「总计」盒加 `gridColumn: "span 2"`。
- [低中] 三个 collector 与各 `handleSubmit` 判分逻辑重复（MCQ 的 `correctAnswer = q.correct_answer || q.answer` 已 3 份），可提取纯判分函数进 `lib/mockExam/timeoutFinalize.js` 单一真源。出处：`components/mockExam/AdaptiveExamShell.js`。
- [低] 深链消费 effect 与「⏱ 超时」徽章样式在阅读/听力两视图重复复制，可提取 `useMockDeepLink` hook + 共享徽章组件。出处：`components/reading/ReadingProgressView.js` + `components/listening/ListeningProgressView.js` + `components/reading/MockSessionDetail.js` / `MockTaskCard`。
- [低] `ResultsCard` 的琥珀超时提示（含既有「计时规则」框）可改用 `components/shared/ui.js` 的 `InfoStrip(tone="warn")` 统一样式。出处：`components/mockExam/AdaptiveExamShell.js` `ResultsCard`。
- [低中] `timeoutFinalize` 防御加固：`isValidPartial` 对 `item.id == null` 应 fail-closed（当前 `partial.itemId === item.id`，两侧同为 undefined 会误判通过）+ 交叉校验 `partial.correct === results.filter(isCorrect).length`。出处：`lib/mockExam/timeoutFinalize.js`。
- [低] 超时结算 effect 依赖数组仅 `[timeLeft, phase]`，读取 `m1Items/m2Items/m1Results/...` 靠每秒 tick 触发的闭包新鲜度隐式成立，脆弱；补全依赖或加注释锁定不变量。出处：`components/mockExam/AdaptiveExamShell.js`（auto-finish on timeout effect）。
- [低] collector 返回对象外层 `itemId` 为死字段（`finalizeTimedOutResults` 只读 `collect()` 返回的 `itemId`，外层 `collectorRef.current.itemId` 无人消费），三处可删。出处：`components/mockExam/AdaptiveExamShell.js`（CTW/MCQ/LCR 三个 collector）。
- [低] `handleM1Complete`/`handleM2Complete` 无内部幂等守卫，仅靠 `autoFinishedRef` + 调用点保证单次；未来若新增第三条结束路径易重复 `saveSess`（重复历史）。出处：`components/mockExam/AdaptiveExamShell.js`。

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

- 2026-07-07 出题去重全链路（分支 claude/question-pipeline-review-6p2bpt，待合 main）：合库层内容去重挂全题型 + 生成端排除改 bank∪staging（修 LAT 排除空转、RDL 补 exclude）+ 清除 8 库存量重复 1472 条（3083→1611，复测归零）+ `answer_hashes.json` 重建（590→612；原「重生」待办一并完成，旧台账与现库零重叠早已失效）。
- 2026-07-05 XorPay 金额对账（按分对账无容差，不符 403 拒发权益）+ webhook 顺序改"先授予后标 processed"（原顺序会致付钱不发货）——已合 main，jest 581 全过。
- 2026-07-05 五处升级按钮 `open-upgrade-modal` 死 no-op 修复（HomePageClient 全局监听 + speaking-exam 自持 modal）——已合 main。
- 2026-07-05 CTW 填词防呆修复（灰底锁定 chip + 键盘导航）cherry-pick 2b3f96c 合入 main（分支上过时的 v1.9.4 发版提交已丢弃）。
- 2026-07-05 产品 P0 复测：BS 干扰项已修（did 99.6%→14.6%，88 种）；模考评分失败清零 band 已修（"--"+错误文案+重试按钮）；插入题数据面已清零（UI 欠账转为上方决策项）。
