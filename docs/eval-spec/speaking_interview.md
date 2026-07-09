# Evaluation Spec — Speaking · Interview (`speaking_interview`)

**Ground truth:** `data/realExam2026/speaking/interview.json` — 14 sets (recalled, tier=recalled)。
字段：`{ id, source, date, tier, type, source_kind, setting, questions[], transcript }`。
**Current generated bank:** `data/speaking/bank/interview.json` — 11 sets（4 问/套，人工放置的初始库）。
**Generation profile/prompt:** `lib/speakingGen/interviewPromptBuilder.js`（30 题固定 TOPIC_POOL +
PROGRESSION_RULES 四段式）。Validator: `lib/speakingGen/speakingValidator.js` `validateInterviewSet`
（4 问、逐题 schema + INTERVIEW_WORD_RANGES Q1 25-40 / Q2-Q3 25-45 / Q4 30-50 词）。
风味模型：`data/speaking/profile/interview-flavor-model.json`；参考样例：`data/speaking/samples/interview-reference.json`。
**接线状态（2026-07-09，§7 P1-11 方案A）：** print-bank-prompt `interview` 档 → staging
`data/speaking/staging/interview-$SESSION.json`（`{items:[…]}`）→ merge-staging `validateInterviewSet`
fail-closed → scoreBatch `speaking-interview`（div/qual）→ check-quality-gates 70/80。
R1 trigger 配置尚需加行（见 docs/quality-pipeline.md ⚠ 注）。

> 任务形态：考生参加模拟采访，逐题即兴口答 45 秒，无准备时间。评分走 STT + speakingEval
> （AI 判分），所以题目的职责是「自然、有递进、可即兴展开」，不是考阅读。

---

## 输入可靠性（先说丑话）

14 组真题全部是**回忆卷**：
- **问题条数**（3-9，中位 6-7）：中等可信——漏记只会少不会多，取下界参考；
- **问题文本**（中位 7-14 词）：**不可信**——回忆者写的是压缩转述（"Do you use AI tools?"），
  不是考场上采访者的完整口语（含寒暄、背景铺垫、双联问）。不能拿它当字数锚。
- **setting/transcript**：部分组有，可用于话题域和递进结构的定性核对。

## 已知锚点差距（挂起，勿悄悄改标准）

| 维度 | 真题（回忆） | 现行产品/validator | 处置 |
|---|---|---|---|
| 每套问题数 | 3-9，中位 6-7 | 固定 4 问 | **待决策**：4 问是 App 任务设计（4×45s 时长上限），不是校准错误；若要贴真题需产品层改动（任务时长/UI）。先按 4 问出题，此差距记录在案。 |
| 问题字数 | 回忆压缩后 7-14 词 | 25-50 词（含铺垫语） | 保持 validator 现标准（参考样例支持）；回忆文本精度不足以推翻。 |
| 话题域 | 校园生活/科技/日常消费为主 | TOPIC_POOL 30 题 | 新增真题回忆时对照补池。 |

## Dimensions

### D1 — 每套 4 问、逐题 schema · **solid（产品标准）**
- Detector: `validateInterviewSet`（merge 层 fail-closed 已接）。precision 高（结构性检查）。

### D2 — 字数递进（Q1 25-40 → Q4 30-50） · **产品标准，非真题 derive**
- Detector: `INTERVIEW_WORD_RANGES` 逐题；scoreBatch `interviewQuality` 用放宽带（20-60）批级监控。
- 真题回忆文本不可作锚（见上）→ **monitor-only，不设 hard-gate 冻结带**
  （不满足 gate-registry 的 detector_precision≥0.95 前置条件）。

### D3 — 全部疑问句 + 套内不重复 · **solid**
- Detector: validator 内建（问号检查 + 文本去重）；scoreBatch `allQ` 批级复核。

### D4 — 递进结构（背景→习惯→观点/比较→展望） · **定性**
- 锚：PROGRESSION_RULES + 真题 transcript 定性一致。暂无自动 detector；
  盲审/人工抽检时核对。候选后续：位置关键词分类器（precision 未验，先不设门）。

### D5 — 话题多样性 · **monitor**
- Detector: scoreBatch `openingDiversity`（首问文本）+ 生成端 TOPIC_POOL 排除
  （print-bank-prompt 传 bank∪staging 的 topic 排除表，cap 20/30）。

## Gate 现状

- 合库硬门：validateInterviewSet（fail-closed）。
- 批级门：check-quality-gates diversity 70 / quality 80（小 N 从宽，对齐 repeat）。
- 冻结带 hard-gate：**暂缓**——唯一真题锚是回忆卷，文本级 detector precision 不达标；
  待 P2-16 锚点扩充（带完整问句的回忆/音频转写）后再 derive。

## 下一步（挂 BACKLOG）

1. R1 trigger 配置加 speaking-interview 行（唯一剩余接线，repo 外）。
2. 收集带完整问句的 interview 回忆/录音转写 → 字数与问数锚升级 → 评估 4 问设计是否要向真题靠拢。
3. speakingEval 评分侧与出题侧的 rubric 一致性核对（scoring prompt 在 `lib/ai/prompts/speaking.js`）。
