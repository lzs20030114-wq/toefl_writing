# BS 题质量标准 (2026-05-29)

为今天反复测试的题库设计的"高质量稳定多样"标准。**允许每 10 道 1-2 道偶尔跳脱创新**,但 systemic flaws (uniform prefilled, contrived scenario) 零容忍。

## L1 — Schema (任何不过 = 判废)

源: `lib/questionBank/buildSentenceSchema.js`

- id / prompt / answer / chunks / prefilled / prefilled_positions / has_question_mark / grammar_points 字段齐全
- chunks (minus distractor) + prefilled 词数 = answer 词数 完全一致
- distractor 是单词,不在 answer 内
- prefilled_positions 对齐 answer 中的实际位置
- prefilled 长度 < 6 词
- has_question_mark 与 answer 末尾标点匹配
- chunks 内不含独立 floating adverb

## L2 — TPO 风格一致性 (必过)

源: 60 道 tpo_source.md + `PREFILLED_PROFILE`

- Answer 词数 7-15 (TPO mean 10.6)
- Effective chunks 4-7
- 句型属 6 大类: indirect-Q / negation / passive / comparative / relative / other-statement
- Prompt opener 属 4 大类: "What did X ask" / wh-Q / yes-no / statement
- Indirect-Q 用陈述句序 (no inversion)
- 92% answer 陈述句结尾

## L3 — 单题可解性 (必过)

- 给定 prompt + chunks + prefilled,**存在唯一正确排列**
- 排除 distractor 后,所有 chunk 用完无多无少
- 答案语法正确,语义连贯,prompt 与 answer 主题相关

## L4 — 自然度 (必过, 主观)

- Answer 像真人对话,不是新闻稿/法律文书
- Scenario 具体可信,无 "the matter / the situation" 这种泛指
- 角色名 + 场景 不矛盾
- 无 AI-ism ("leverage the", "stakeholders", "paradigm shift") 等

## L5 — 批次多样性 (10 道一组)

源: `lib/quality/scoreBatch.mjs`

- Prefilled 类型 ≥ 4 种 (7 种 TPO 类型中)
- Top prefilled 类型占比 ≤ 60% (避免单一化)
- 1-2 道有 empty prefilled
- 句型 ≥ 3 种
- Opener ≥ 3 种
- 角色名 distinct count ≥ 7/10
- Scenario 全 distinct (10/10)

## L6 — 允许的创新 (Pass with note)

每 10 道允许 0-2 道这些情况(不判废,反而是 TPO-style 健康偏离):

- 句型跨类组合 (indirect-Q + passive)
- 不寻常的话题 (e.g., "deep sea bioluminescence" 而非常见 "campus shuttle")
- 4+ 词 prefilled 段 (TPO 17% 出现)
- 中间/末尾位置的 prefilled
- Statement opener 不带角色名 (用 "I" / "My friend")

## 单题评分

- L1 失败 → 0 分,判废
- L2-L4 任一失败 → 0 分,判废
- L1-L4 全过 → 80 分起步
- 每 L6 创新 +5 (上限 95)

## 批次评分

- 批次 L5 全通过 → 批次合格
- 单题分平均 ≥ 85 → 批次合格

## 合格判定

- 单题合格: 个别题目分 ≥ 80 (即 L1-L4 全过)
- 批次合格: L5 + 单题分平均 ≥ 85
- 总体合格: 单题合格率 ≥ 95% AND 批次合格率 ≥ 70%
