---
name: bs-produce
description: Build a Sentence question generation with quality monitoring. Use when generating new BS questions, expanding the question bank, or running batch production.
disable-model-invocation: true
user-invocable: true
argument-hint: [sets=6] [--append] [--dry-run] [--resume]
---

# Build a Sentence — Production Pipeline

> **⚠️ 管线现状(2026-07-05)**：现行生产管线 = claude.ai 云端 routine 每晚生成 + `lib/gate/` 冻结门（`BS_GATE_ENFORCE` 默认开启，`mergeClaude`/`appendBSSets` 默认强制）。本 skill 描述的本地 DeepSeek 管线是**手动后备**。live 库 = `data/buildSentence/questions.json`（`question_sets` 键，约 534 题 = `cg_bs_*` 194 + `ets_*` 340，nightly 持续增长）。质量问题优先走 `/calibration-fix` 和 `lib/quality/scoreBatch` + `data/eval-profiles/`，不要按本文的旧硬编码比例目标修"假回归"。

You are managing the Build a Sentence question generation pipeline. Follow this workflow precisely.

## Parse Arguments

- `$ARGUMENTS` may contain: a number (target sets, default 6), `--append` (add to existing bank), `--dry-run` (audit only), `--resume` (resume interrupted run)
- Examples:
  - `/bs-produce` — generate 6 sets (overwrite)
  - `/bs-produce 4 --append` — generate 4 new sets, merge with existing bank
  - `/bs-produce --resume` — resume from last checkpoint
  - `/bs-produce --dry-run` — audit existing bank only

## Pre-flight Checks

Run these checks in parallel:

1. Read `data/buildSentence/questions.json` — count existing sets and questions
2. Read `data/buildSentence/reserve_pool.json` — count reserve pool size
3. Read `data/buildSentence/run_history.json` (if exists) — check last run's acceptance rate
4. Check `.env.local` for required keys (don't print values):
   - `DEEPSEEK_API_KEY` — **required** for generator
   - `CLAUDE_RELAY_API_KEY` + `CLAUDE_RELAY_BASE_URL` — optional but recommended for high-quality review. If missing, reviewer falls back to DeepSeek self-review (lower quality)
5. Run `node scripts/validate-bank.js --strict`
6. Check for existing checkpoint: `data/buildSentence/generation_checkpoint.json`

Report:
```
Pre-flight:
  Current bank:     X sets, Y questions
  Reserve pool:     Z questions
  Last acceptance:  XX% (healthy/concerning/critical)
  Bank validation:  PASSED/FAILED
  Generator:        DeepSeek V3.2 — OK/MISSING
  Reviewer:         Claude relay — OK / DeepSeek fallback (no relay)
  Checkpoint:       found (round N, pool M) / none
```

If `DEEPSEEK_API_KEY` is missing, STOP.
If Claude relay is not configured, WARN but continue (quality may be lower).
If a checkpoint exists and `--resume` was not specified, ask user whether to resume or start fresh.

## Generation Phase

If not `--dry-run`:

1. **Reserve pool handling**:
   - Overwrite mode: clear reserve pool (`[]` → `data/buildSentence/reserve_pool.json`)
   - Append mode: do NOT clear — existing reserve questions are valid seed material
   - Resume mode: do NOT clear — checkpoint has its own pool state
2. Run the appropriate command:
   - Overwrite: `node scripts/generateBSQuestions.mjs`
   - Append: `node scripts/batch-produce.mjs --sets N --append`
   - Resume: `node scripts/generateBSQuestions.mjs --resume`
3. Set env vars as needed: `BS_TARGET_SETS=N`
4. Stream the output so the user can watch progress

## Post-Generation Quality Audit

After generation completes (or for `--dry-run`, audit existing bank):

1. Run `node scripts/validate-bank.js --strict` — report pass/fail
2. Run `node scripts/review-bank.mjs --summary` — parse the JSON output
3. For issues, run `node scripts/review-bank.mjs` (full review) and examine per-question details

### Present Results

**目标比例以 `data/eval-profiles/bs.json`（及 `bs-difficulty-standard.json`）为准，不要用下面模板里的数字当真值** —— 这些旧硬编码目标（如 embedded 63%）已被证实偏离真实值（embedded 真值 ≈ 45%），按旧数字改会做出"假回归"。先读 eval-profiles 拿当前真值，再填模板：

```
Bank Summary (X sets, Y questions):
  TPO Compliance:
    Question mark:  X% (target: 见 eval-profiles/bs.json)  [OK/DRIFT]
    Embedded:       X% (target: 见 eval-profiles/bs.json)  [OK/DRIFT]
    Distractor:     X% (target: 见 eval-profiles/bs.json)  [OK/DRIFT]
    Negation:       X% (target: 见 eval-profiles/bs.json)  [OK/DRIFT]
    Prefilled:      X% (target: 见 eval-profiles/bs.json)  [OK/DRIFT]
  Difficulty: easy X% / medium X% / hard X%
  Prompt diversity: ask X / report X / respond X / yesno X / statement X
  Quality: X fatal, Y warnings
  Duplicates: X cross-set duplicate answers found
  Bank score: XX/100
```

### Issue Handling

If fatal issues found (score < 60 or any `total_fatal > 0`):
- List each problematic question with its issues
- Suggest: run `/bs-fix <question_id>` to fix, or re-generate

If DRIFT detected:
- Per project decision (2026-03-16), minor drift is acceptable
- Only flag if severely off (>20pp from target)

## Final Verdict

```
PASS: X sets, Y questions — bank score XX/100
WARN: X sets, Y questions — Z issues found (see above)
FAIL: critical issues detected, do not deploy
```
