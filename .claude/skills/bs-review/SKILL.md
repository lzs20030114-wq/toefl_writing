---
name: bs-review
description: Deep quality review of the Build a Sentence question bank. Use when checking question quality, finding bad questions, auditing the bank, or before deploying.
disable-model-invocation: true
user-invocable: true
argument-hint: [set N | question-id | --full]
---

# Build a Sentence — Quality Review

You are performing a deep quality review. This is READ-ONLY — do not modify files.

## Parse Arguments

- No args or `--full`: full bank review
- `set N`: review set N only (1-based)
- A question ID like `ets_s3_q5`: single question deep analysis
- `$ARGUMENTS`

## Data Collection

Use the dedicated review script for reliable, structured data:

```bash
# Full review
node scripts/review-bank.mjs

# Single set
node scripts/review-bank.mjs --set N

# Single question
node scripts/review-bank.mjs --id ets_s3_q5

# Summary only (faster)
node scripts/review-bank.mjs --summary
```

The script outputs JSON with validated data from the actual validation functions (`validateQuestion`, `validateRuntimeQuestion`, `validateStructuredPromptParts`, `estimateQuestionDifficulty`, `isEmbeddedQuestion`, `isNegation`).

## Review Modes

### Single Question (by ID)

Run: `node scripts/review-bank.mjs --id <ID>`

Present the JSON result as a structured analysis in Chinese:

```
## 题目分析: <id>

答案: "<answer>"
提示: [<prompt_kind>] "<prompt_text>"
难度: <difficulty> (score: X)

### 结构检查
- Chunks: X 个 (multi-word: Y)
- 答案词数: X
- Prefilled: [words] at positions [...]
- Distractor: "<word>" / 无

### 语法特征
- Grammar points: [...]
- Embedded: 是/否
- Negation: 是/否
- Question mark: 是/否

### 验证结果
- Schema: X fatal, Y format, Z content
- Prompt: X fatal, Y format
- Runtime: OK / <error>

### 评分: X/10
```

If score < 7, suggest specific fixes and offer to run `/bs-fix <id>`.

### Single Set (by set number)

Run: `node scripts/review-bank.mjs --set N`

Show per-question summary table:
```
  #  ID           Diff   Type        Embed  Neg  Dist  QM  Score
  1  ets_sN_q1    med    report      yes    no   yes   no   10
  2  ets_sN_q2    hard   yesno       yes    yes  yes   no    8
  ...
```

Then set-level stats:
```
Set N stats:
  Difficulty: E1/M7/H2  Prompt types: ask=2 report=3 yesno=2 statement=2 respond=1
  Embedded: 6/10  Negation: 2/10  Distractor: 9/10  QMark: 1/10  Prefilled: 9/10
  Issues: X fatal, Y warnings
  Set score: XX/100
```

Flag any question with score < 7.

### Full Bank Review

Run: `node scripts/review-bank.mjs` (full output)

Present in order:

1. **Bank overview table** — one row per set with key stats
2. **TPO compliance** — ratio comparison from summary.ratios
3. **Cross-set duplicates** — from summary.duplicates
4. **Topic clusters** — from summary.topic_clusters (flag if too concentrated)
5. **Weakest 5 questions** — from summary.weakest, with their issues
6. **Strongest 3 questions** — from summary.strongest
7. **Recommendations** — actionable improvements, most impactful first

End with: `Bank score: XX/100`

## Language

Use Chinese for headers and explanations. Keep field names and technical terms in English.
