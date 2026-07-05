---
name: bs-fix
description: Fix a specific Build a Sentence question by ID. Use when a question has quality issues found by /bs-review.
disable-model-invocation: true
user-invocable: true
argument-hint: <question-id> [issue description]
---

# Build a Sentence — Question Fixer

> **⚠️ 管线现状(2026-07-05)**：现行生产管线 = claude.ai 云端 routine 每晚生成 + `lib/gate/` 冻结门（`BS_GATE_ENFORCE` 默认开启，`mergeClaude`/`appendBSSets` 默认强制）。本 skill 描述的本地 DeepSeek 管线是**手动后备**。live 库 = `data/buildSentence/questions.json`（`question_sets` 键，约 534 题 = `cg_bs_*` 194 + `ets_*` 340，nightly 持续增长）。质量问题优先走 `/calibration-fix` 和 `lib/quality/scoreBatch` + `data/eval-profiles/`，不要按本文的旧硬编码比例目标修"假回归"。

Fix a specific question in the bank. This modifies `data/buildSentence/questions.json`.

## Parse Arguments

- `$0` — question ID (required), e.g. `ets_s3_q5`
- `$1...` — optional issue description to guide the fix
- `$ARGUMENTS`

If no ID provided, ask the user which question to fix.

## Step 1: Diagnose

Run: `node scripts/review-bank.mjs --id $0`

Parse the JSON output. Identify all issues:
- `fatal` — schema validation failures
- `prompt_fatal` — prompt validation failures
- `runtime_check` — runtime normalization failures
- `format_warnings` — format issues
- `content_warnings` — content issues
- Low score (< 7)

If the question has score >= 9 and no issues, tell the user it looks fine.

## Step 2: Determine Fix Strategy

Based on the issue type:

### Word count mismatch (chunks + prefilled != answer words)
- Read the question from `data/buildSentence/questions.json`
- Recalculate: split answer into words, compare with chunks + prefilled
- Fix by adjusting chunks (split or merge multi-word chunks)
- Ensure distractor is not counted in word balance

### Distractor appears in answer
- Choose a different distractor that:
  - Is the same part of speech
  - Does NOT appear in the answer
  - Is plausible but grammatically incorrect as a substitution
- Update the `distractor` field

### Prompt issues (prompt_fatal)
- Read the `prompt_task_kind` and `prompt_task_text`
- Fix prompt to match the kind:
  - `yesno`: must be a yes/no question ending with "?"
  - `statement`: must be a declarative sentence ending with "."
  - `ask`/`report`/`respond`: must contain an explicit task/instruction
- Validate with: `node -e "const {validateStructuredPromptParts} = require('./lib/questionBank/buildSentencePromptContract'); const q = <question_json>; console.log(JSON.stringify(validateStructuredPromptParts(q)));"`

### Runtime check failure
- Run `normalizeRuntimeQuestion` on the question to see the exact error
- Common fixes: adjust prefilled_positions, fix chunk order, ensure prefilled words exist in answer

### Low score (no specific error)
- Check if multi-word chunks can be added (improves diversity)
- Check if prompt can be made more natural
- Check grammar_points accuracy

## Step 3: Apply Fix

1. Read `data/buildSentence/questions.json`
2. Find the question by ID
3. Apply the minimum necessary fix (do not change what isn't broken)
4. Write back to the file (preserve formatting)
5. Validate the fix:
   ```bash
   node scripts/review-bank.mjs --id $0
   ```
6. Run full validation:
   ```bash
   node scripts/validate-bank.js --strict
   ```

## Step 4: Report

```
Fixed: <question_id>
  Before: score X/10, issues: [...]
  After:  score Y/10, issues: [...]
  Changes: <what was changed>
  Bank validation: PASSED/FAILED
```

If the fix introduced new issues, revert and try a different approach.

## Important Rules

- NEVER change the `answer` field (it's the core content, changing it invalidates the question's purpose)
- NEVER change the `id` field
- Keep changes minimal — fix only the identified issue
- 手动修完的题不要绕过 check-quality-gates —— 修完之后仍然要过 `lib/gate/` 的冻结门检查，不要因为是"手动修一道题"就认为可以跳过
- Always validate after fixing
- If the question is fundamentally broken (e.g., answer doesn't make grammatical sense), suggest removing it instead of fixing
