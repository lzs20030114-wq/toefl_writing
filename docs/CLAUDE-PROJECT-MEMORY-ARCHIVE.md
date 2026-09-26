# TOEFL Writing / TreePractice 历史项目记忆档案

整理日期：2026-09-22。这里记录项目**如何演变、哪些决定曾经成立**，不替代当前的 `CLAUDE.md`/`AGENTS.md` 架构说明、`docs/BACKLOG.md` 待办或代码。每次执行任务仍应核对当前工作区、迁移台账和线上状态。

## 证据口径与覆盖

- **作者确认**：Claude 导出中用户本人的明确表述或拍板；**已有产物**：本仓代码、迁移台账、报告或提交能证明的范围；**历史版本**：曾经适用但已被后续实现改变；**待核实**：仅有旧助手/记忆的说法、状态相互冲突，或缺线上验证。
- 检索了 2026-09-22 静态 Claude 导出（679 段网页对话及 Claude Code 参考索引）、本机三个 TOEFL 路径下的 Claude Code `memory/` 索引、项目文档地图与相关代码；完整阅读了 2 月产品初创、3 月支付/国际化/推广的相关网页对话，并抽核关键专题记忆与仓库。导出后新会话、未收录附件、参考分卷里被截断的工具结果、线上数据库和部署状态**不在本档覆盖范围**。Claude Code 原始 JSONL 应按源会话 ID 回查，不能把工具输出或助手建议当用户决定。
- 原始导出里有历史凭证和私密资料；本档**不转录密钥、账号细节或无关个人信息**。若那枚历史 API 密钥仍有效，应单独轮换。

## 项目身份和关键时间线

| 时间 | 经核查的演进 | 证据状态与回查 |
|---|---|---|
| 2026-02-13 | 用户提出用 AI 辅助学习和模拟考试的 TOEFL 工具；选 Writing 先做，并两次纠正助手：必须是 2026 年新托福**三题型、1–6 分制**，不可沿用旧综合写作。先做核心练习和真实考试风格 UI，AI 出题后置；当天从 Claude artifact 尝试转为独立 Next.js/Vercel 网站，采用 DeepSeek API。 | 作者确认：网页对话 `01b6bea0-1fea-4c5c-8701-ad2e75b06397`，用户消息 `019c55e3-b3b1-738a-9729-4b4f95087ccd`、`019c55eb-6022-7713-88b9-34692f5767bc`、`019c55ee-6576-7111-a7d3-3bf1f4020b04`、`019c5624-a9ab-7648-9f9e-b19f916bc9da`。本仓 `app/`、`app/api/ai/` 可证现在的产品形态，不能以当前代码证明当天具体部署状态。 |
| 2026-02-14～15 | 用户实际体验后把拖拽造句、中文反馈、API 错误重试、可删和可逐题回看的历史、随机题库列为优先；问及账号/使用码、避免重复出题、出题审核和最难档供给。提出造句词块应保留给定词位置、拖入句首才大写。 | 作者确认：同一对话用户消息 `019c5738-a405-756e-949d-a60fbf4c111f`、`019c5a66-9fd2-706a-8519-41a96e6fb8de`、`019c5a6f-5c1c-753b-a43d-e39b3c87b05c`、`019c5fed-2532-72d5-8126-325e97223a12`。这些是需求起点，不能据此断言所有功能当时已上线。 |
| 2026-03-14～17 | 早期 BS 离线生产采用 DeepSeek 规划/生成、Claude relay 交叉审题与组卷后批量改写。3 月 16 日快照是 16 套/160 题；用户决定停止无止境追逐 TPO 各指标比例，转而重视题型多样性和扩库。 | 历史版本：Claude Code `D--toefl_writing/memory/MEMORY.md` 与 `project_bs_generation_stability.md`。`scripts/generateBSQuestions.mjs` 仍保留 reserve pool 逻辑，但现行生产主链路已改为云端 routine，不能照搬 3 月模型、价格和题量。 |
| 2026-03-15～24 | 免费报告显示分数/概览/错误位置，把可操作修改和范文后段留给 Pro；从内测走向正式版推广。3 月 24 日用户报告约十余用户、2 位付费，主要流量来自小红书，瓶颈是曝光而非已证实的付费意愿问题。这只是**当日自报基线**。 | 前者由专题记忆 `project_free_pro_report_blur.md` 和当前 `components/writing/WritingFeedbackPanel.js`、`ScoringReport.js` 中的 ProBlur 核对；后者作者表述见网页对话 `2a32af08-db89-4f4c-92cd-c576b1c441ef` 消息 `019d2053-db9a-7422-8053-f4051d9fb149`、`019d2054-6d17-7445-90b3-feaee6925841`。不要当当前用户数。 |
| 2026-03-19～20 | 用户希望摆脱爱发电的可靠性限制；尝试 XorPay/支付宝路线，随后报告支付宝商家签约被驳回，又比较别的渠道，并探讨经营主体。早期“先接支付宝”的选择**不是永久产品方向**。 | 作者表述：网页对话 `df45a097-85db-4045-a3b9-dc3ae810bffe` 消息 `019d0647-7810-711f-bf0d-25f80df01d35`、`019d0654-b56f-7f28-991b-10a352e4411f`、`019d0a64-727e-7f8a-833a-4e6bc9e0d6c3`。现行仓库同时有 `lib/iap/providers/xorpay` 和 `afdian`；合同/收款可用性及法律结论都需另行实时验证。 |
| 2026-05～07 | 从写作扩到阅读、听力、口语和自适应模考；用 `data/realExam2026/` 作 2026 真题校准锚，建立出题 validator/盲审与防退化 gate。6 月修听力模考自动播放卡死，7 月写作评分改多采样中位数，个人题库扩到 12 题型。 | 已有产物：`lib/readingGen/`、`lib/listeningGen/`、`lib/speakingGen/`、`lib/gate/`、`lib/mockExam/`、`lib/ai/writingEval.js`、`lib/userBank/`；阶段记录见 Claude Code 专题 `realexam2026-calibration-pass.md`、`listening-mock-audio-hang.md`、`writing-scoring-adversarial-test.md`、`user-question-bank-feature.md`。精确上线日期以提交/公告为准。 |
| 2026-07～09 | 真题专区从参考题集中练习，扩为 12 题型、来源分档、截图识图/原声切片、整卷组套、丢题账本和两票复核的多来源管线。9 月的“全库完整度”数值多次因统计分母及回收改变，旧报告里的百分比均是**当时快照**。 | 已有产物：`lib/realBank.js`、`scripts/realbank/`、`data/realBank/sets.json`、`loss-ledger.json` 和 `docs/realbank-set-blueprint.md`；专题 `real-bank-feature.md`、`realbank-loss-recovery-2026-09-14.md`、`realbank-recovery-plan-2026-09-17.md`。要查当下缺题先运行只读的 `node scripts/realbank/loss_ledger.mjs`。 |

## 长期有效的决策脉络（执行前仍须验当前实现）

1. **考试忠实度优先于“像一款好看的练习 App”**：最早就纠正旧托福题型/评分，后续要求 BS 的给定词、词块边界、句首大小写、真实题面与考试 UI。真题不得拿 AI 自造标答或自行切词冒充原卷；来源/答案的证明等级必须如实展示。源：2 月网页对话上述消息；`data/realExam2026/README.md`、`docs/eval-spec/`、`scripts/realbank/extract_bs_pages.py`。
2. **真题锚 + 测试新产能**：3 月生产稳定性测试若复用 `reserve_pool.json` 会把旧题重新组卷，误以为修改有效；此历史教训仍适用于“测新生成能力”，但该文件可能含用户数据，不能未经核对直接删除。源：Claude Code `D--toefl_writing/memory/feedback_clear_reserve_pool.md`，现行 `scripts/generateBSQuestions.mjs` 的 seed/checkpoint 代码。当前质量闸是另一个更晚的体系，见 `lib/gate/`。
3. **产品化不等于无条件开放**：免费/Pro 报告差异、使用次数、试用、支付和安全限流是逐步叠加；不要从早期“免费或便宜 API”推导今日成本。当前写作评分走 DeepSeek，文本出题 routine 与听力 TTS 成本分开核算。源：早期网页对话 `01b6bea0-1fea-4c5c-8701-ad2e75b06397`；`CLAUDE.md` 的 Scoring/Generation/成本护栏。
4. **研究不等于立项**：3 月讨论过海外中文版/繁中/西语/日语、主站切语言或分站、先做台湾市场，用户要求 3 个月看到付费；对话里多数市场规模和 ARR 是助手研究/预测，**没有证据说明国际化已排期或上线**。源：网页对话 `fc41ca9b-7e59-4fa4-a114-b7c6280f78d6` 用户消息 `019cf6a1-befc-7135-be30-c6194d3ff4a5`、`019cf6a3-5b9a-7a86-9f8f-f9415d39436a`、`019cf6c1-8aa5-74d5-9036-f11a8b741936`。
5. **推广数据只作为历史诊断**：3 月用户确认小红书为当时几乎唯一入口，帖子多为截图+介绍，单条曝光很低；“提高曝光”的方案不是已验证实验结果，也不可把 2 个付费用户外推到今天。源：网页对话 `2a32af08-db89-4f4c-92cd-c576b1c441ef` 的上述用户消息。

## 明确的版本冲突与待核实项

- **早期 TPO 不入仓约束 vs 后期真题专区**：3 月记忆 `feedback_no_tpo_in_repo.md` 要求原始 TPO 参考材料仅保存在本地 ignored 文件；7～9 月项目已把经过来源分档的真题/回忆题纳入专区和版本库。这是**范围和产品策略变化**，不可把旧便笺视为对所有今日真题数据的删除命令。涉及版权/上传授权的新决定必须单独核对，不能从旧聊天推法务结论。
- **BS 门模式**：6 月旧专题 `bs-frozen-gate-not-wired.md` 仍写“默认 warning-only、待翻开”；当前 `scripts/mergeClaude.mjs` 和 `scripts/appendBSSets.mjs` 明确默认 ENFORCE，只有 `BS_GATE_ENFORCE=0` 才降为警告。以代码为准。
- **迁移状态冲突**：`docs/BACKLOG.md` 开头仍把 `real-bank-ingest-jobs.sql` 列为“上线前待跑”，而 `scripts/sql/MIGRATIONS.md` 已登记“2026-09-09 用户确认已跑”；Claude 专题 `realbank-auto-ingest-feature.md` 也称已完成工程和桶灌入。当前能证明的是**台账声称已跑**，本档没有连线上数据库核查；下一次上线/迁移决策须按 `/sql-migrate` 核对，别直接复跑或宣称未跑。
- **2026-09-17 真题补题进度**：专题 `realbank-recovery-plan-2026-09-17.md` 写 18 笔本地未推、7178/8280；当前工作区 HEAD 为 `428d58e4`，同时 `git log --all` 可见其他分支更晚提交且工作区有未提交改动。该百分比只属该工作区当时快照，线上/主分支现况待核；不得据此覆盖题库或替人推送。
- **旧源料快照会过期**：9 月听力 `source-flags.json`、账本和 Claude 专题曾互相推翻；先刷新只读统计/核对音频与盲审键，再决定重跑。详见 `realbank-listening-recovery.md` 与 `realbank-recovery-plan-2026-09-17.md`。旧报告的“只能 X、不能 Y”要以代码、原件和最新产物复验。
- **设计反馈的适用范围**：早期反馈便笺 `feedback_flat_design.md` 明确偏好简洁扁平、反对大面积渐变/glow/毛玻璃；这是旧项目 UI 反馈，不等同禁止所有阴影/色彩，应用到新页面应先看 `components/shared/ui.js` 与现有页面。

## 来源索引与回查方式

- 静态网页档案：`D:\桌面\claude历史记录\chatgpt-import\conversation-index.csv` → `conversations-04.json`（2 月初创）、`conversations-05.json`（2 月盈利）、`conversations-06.json`（3 月支付/国际化）、`conversations-07.json`（推广）；按上面的对话 UUID 找完整 `chat_messages`，继续看命中消息之后的用户发言。来源包说明在同目录 `README.md`。
- Claude Code 原始会话：`C:\Users\35827\.claude\projects\D--toefl-writing\*.jsonl`；专题索引为该目录 `memory\MEMORY.md`。早期镜像记忆另在 `D--toefl_writing\memory\` 与 `C--Users-35827-toefl-writing\memory\`，同名文件可能互相不同；后者较早版本还把 `hasAmbiguousArrangements()` 当存根，前者已记 3 月 17 日实现，不可盲用。
- 导出里的 Claude Code 索引：`D:\桌面\claude历史记录\chatgpt-import\claude-code\claude-code-index.csv`；参考分卷对大工具结果只给预览，精确证据应回原 JSONL/原始 ZIP。
- 当前执行入口：`CLAUDE.md`/`AGENTS.md` 看职责和约定；`docs/BACKLOG.md` 看挂起项；`scripts/sql/MIGRATIONS.md` 看已登记迁移；`data/claudeGen/reports/` 看专题报告；最终以当前代码、数据、可重复检查和线上验证为准。
