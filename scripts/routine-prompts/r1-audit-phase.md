# R1 — Answer-audit phase (paste into the Anthropic R1 routine config)

The R1 routine (`trig_01SmJeXr8ySEZRo2dEoohzTP`, Opus) generates all 12 banks
and merges them. Its prompt lives in the Anthropic console, **not** in this repo,
so this file documents the phase you must add there. R2's equivalent is already
wired in `r2-retry.md` (PHASE 2.5 / 2.6).

## Why

The old answer-correctness audit (`scripts/merge-staging.mjs` →
`lib/readingGen/answerAuditor.js`) calls DeepSeek over HTTP. The R1 routine
environment has **no `DEEPSEEK_API_KEY`**, so that audit was silently SKIPPED on
the primary path — reading answers shipped unverified, and listening MCQ answers
were never audited at all. A question with a wrong answer key still scored
"质量 100", because the quality score only checks structure (length/format), not
correctness.

Fix: **the routine model is the second examiner.** It re-solves every MCQ blind
(no answer key) and a deterministic script drops any item whose marked answer
disagrees. No API key needed. Covers reading (ap/rdl) + listening (la/lat/lc/lcr).
CTW is a c-test (not MCQ) and is vetted by the blanker/validator instead.

## Where it goes

Insert this **between "write all staging files" and "merge" (the old Phase 4/5
merge step)**. Do not merge any reading/listening bank until the audit has run,
so mis-keyed items are dropped *before* they reach the bank.

## Phase text to add

```
═══ PHASE 4.5 — Answer-audit (you are the second examiner; required before merge) ═══

After every bank's staging file is written and BEFORE merging:

1. node scripts/routine-audit.mjs extract $SESSION_ID
   → writes data/.audit-blind.json: every reading/listening MCQ from this
     session, with stem + options + context (passage/conversation/prompt) but
     NO answer key. If it prints "0 questions", skip the rest of this phase.

2. Read data/.audit-blind.json. For EACH question, independently choose the
   single best option letter using ONLY that question's `context`. You have NOT
   seen the answer key — re-solve honestly to catch a mis-keyed answer. Do not
   open the staging files during this step.

3. Write data/.audit-solved.json exactly as:
     { "answers": { "<key>": "B", "<key>": "D", ... } }
   Use each question's `key` verbatim. Answer EVERY question (an unanswered
   question is kept-but-unaudited, which defeats the purpose).

4. node scripts/routine-audit.mjs apply $SESSION_ID
   → compares your answers to the marked keys, DROPS any item with a mismatch
     from its staging file, and writes the receipt data/.audit-report.json.
   Read data/.audit-report.json and fold its totals into the nightly summary /
   meta, e.g.: "二审: 82/83 一致, 剔除 1 道 (lcr)". The receipt is committed
   under data/, so "did the audit run" is always verifiable after the fact.

Then proceed to merge as before. Because apply already removed mis-keyed items,
merge-staging's own DeepSeek audit (which skips here anyway, no key) is not
relied upon on this path.
```

## Notes

- **Independence caveat:** the same model that wrote the questions also audits
  them, so this primarily catches careless key/option mismatches and ambiguous
  items — it is not as independent as a different model. The blind re-solve (key
  hidden, staging not reopened) preserves most of the value. If you later want a
  truly independent examiner, set `DEEPSEEK_API_KEY` in the routine env and the
  merge-time auditor in `merge-staging.mjs` becomes a second, cross-model gate.
- CTW is intentionally out of scope (not multiple choice).
- The CI / manual-fallback workflows (`nightly-generate-*.yml`) keep the
  DeepSeek merge-time audit, which now covers listening too.
