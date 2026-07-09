# Nightly Question Generation Pipeline

End-to-end pipeline that generates fresh TOEFL practice items every night using Claude routines (Anthropic remote agents), validates against TPO standards, retries failed batches, and emails the daily summary.

## High-level flow

```
   ┌─────────────────────────────────────────────────────────────────┐
   │                  03:00 Beijing (19:00 UTC) daily                │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ R1 ── Generator routine (trig_01SmJeXr8ySEZRo2dEoohzTP)         │
   │                                                                 │
   │ 1. git clone repo                                               │
   │ 2. Phase 2: for each of 12 banks (see R1 bank list below)       │
   │      a. node scripts/print-bank-prompt.mjs <bank>               │
   │         → returns TPO-calibrated prompt (etsProfile +            │
   │           readingEtsProfile + bank-specific prompt builder)     │
   │      b. Claude generates N items in head                         │
   │      c. Write staging file                                      │
   │      d. node scripts/mergeClaude.mjs <bank> <staging>           │
   │         (or merge-staging.mjs for reading)                      │
   │ 3. Phase 3: write meta + run check-quality-gates +              │
   │             compute-quality-report                              │
   │ 4. Phase 4: single commit + push                                │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ GitHub Actions: send-nightly-email.yml fires on push to         │
   │ data/.last-nightly-summary.md → emails the user                 │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                  03:30 Beijing (19:30 UTC) daily                │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ R2 ── Retry routine (trig_016m6uqgCvXtFcjYzhq8jyW3)             │
   │                                                                 │
   │ 1. git pull                                                     │
   │ 2. Read data/.pending-retry.json                                │
   │ 3. IF retry_banks is empty → EXIT CLEAN (no work, no commit)    │
   │ 4. ELSE for each failed bank:                                   │
   │      a. node scripts/print-bank-prompt.mjs <bank>               │
   │      b. Generate items_to_supplement items with the gate's      │
   │         specific hints (which axis failed, what to fix)         │
   │      c. Write staging file with -r2 suffix                      │
   │      d. Merge                                                   │
   │ 5. Update meta with r2_supplemented + r2_items_added per bank   │
   │ 6. Re-run compute-quality-report → updates summary.md           │
   │ 7. Commit + push                                                │
   └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ Email workflow fires again with R1+R2 combined data             │
   └─────────────────────────────────────────────────────────────────┘
```

## R1 bank list (generation order) — 12 banks

The R1 routine (Anthropic remote-agent trigger `trig_01SmJeXr8ySEZRo2dEoohzTP`, prompt
held in the trigger config, NOT in this repo) loops over all 12 banks. For each, it
runs `print-bank-prompt.mjs <arg>`, generates in-head, writes staging, then merges.
Updated 2026-05-31 to add listening + speaking (were DeepSeek-only; DeepSeek undershoots
long-form length, so they moved to the Claude routine).

| bank key (gate/report) | print-bank-prompt arg | staging file | merge command |
|---|---|---|---|
| bs | `bs` | `data/buildSentence/staging/$SESSION.json` | `mergeClaude.mjs bs <file>` |
| discussion | `disc` | `data/academicWriting/staging/$SESSION.json` | `mergeClaude.mjs disc <file>` |
| email | `email` | `data/emailWriting/staging/$SESSION.json` | `mergeClaude.mjs email <file>` |
| reading-ap | `ap` | `data/reading/staging/ap-$SESSION.json` | `MERGE_RUN_ID=$SESSION merge-staging.mjs` |
| reading-ctw | `ctw` | `data/reading/staging/ctw-$SESSION.json` | `MERGE_RUN_ID=$SESSION merge-staging.mjs` |
| reading-rdl-short | `rdl-short` | `data/reading/staging/rdl-$SESSION-short.json` | `MERGE_RUN_ID=$SESSION-short merge-staging.mjs` |
| reading-rdl-long | `rdl-long` | `data/reading/staging/rdl-$SESSION-long.json` | `MERGE_RUN_ID=$SESSION-long merge-staging.mjs` |
| **listening-lat** | `lat` | `data/listening/staging/lat-$SESSION.json` | `MERGE_RUN_ID=$SESSION merge-staging.mjs` |
| **listening-lc** | `lc` | `data/listening/staging/lc-$SESSION.json` | `MERGE_RUN_ID=$SESSION merge-staging.mjs` |
| **listening-la** | `la` | `data/listening/staging/la-$SESSION.json` | `MERGE_RUN_ID=$SESSION merge-staging.mjs` |
| **listening-lcr** | `lcr` | `data/listening/staging/lcr-$SESSION.json` | `MERGE_RUN_ID=$SESSION merge-staging.mjs` |
| **speaking-repeat** | `repeat` | `data/speaking/staging/repeat-$SESSION.json` | `MERGE_RUN_ID=$SESSION merge-staging.mjs` |
| **speaking-interview** | `interview` | `data/speaking/staging/interview-$SESSION.json` | `MERGE_RUN_ID=$SESSION merge-staging.mjs` |

(One `MERGE_RUN_ID=$SESSION merge-staging.mjs` run after all reading/listening/speaking
staging is written merges them all — it scans all three section staging dirs.)

**⚠ R1 trigger update required:** the R1 prompt lives in the remote-agent trigger config
(not this repo). To finish wiring, add the 5 new rows above to the R1 loop. The repo side
(print-bank-prompt handlers, merge-staging, gate, report, R2) is already done.

**⚠ R1 trigger update required (2026-07-09, interview):** speaking-interview was wired
repo-side (print-bank-prompt `interview` handler, merge-staging validator, scoreBatch,
gate thresholds, eval-spec) per QUESTION-PIPELINE-REVIEW §7 P1-11 方案A. To finish, add
the speaking-interview row to the R1 loop in the trigger config: generate 2 sets/night via
`node scripts/print-bank-prompt.mjs interview`, write `data/speaking/staging/interview-$SESSION.json`
(shape `{ "items": [ {id, topic, category, intro, questions[4]} ] }`), merge as above.

## Quality gate decision (`scripts/check-quality-gates.mjs`)

Runs after R1 finishes generation. For each of 13 banks:
- Loads the staging file
- Runs `lib/quality/scoreBatch.mjs` → diversity + quality score (each 0-100)
- Compares against per-bank thresholds:

| Bank | Diversity gate | Quality gate |
|---|---|---|
| bs                  | 90 | 95 |
| discussion          | 80 | 90 |
| email               | 80 | 90 |
| reading-ap          | 85 | 90 |
| reading-ctw         | 85 | 90 |
| reading-rdl-short   | 80 | 85 |
| reading-rdl-long    | 70 | 85 |
| listening-lat       | 70 | 80 |
| listening-lc        | 72 | 80 |
| listening-la        | 72 | 80 |
| listening-lcr       | 75 | 80 |
| speaking-repeat     | 70 | 80 |
| speaking-interview  | 70 | 80 |

Lower per-bank thresholds for small-N banks reflect natural sampling variance.

If a bank fails, writes an entry to `data/.pending-retry.json` with:
- The current score + breakdown
- Specific actionable hints (which axis failed, what TPO target to hit)
- How many items R2 should add

## Scoring axes (`lib/quality/scoreBatch.mjs`)

### BS (6 axes, weighted to total 100)
1. Distinct character names — 20 pts max (target ≥75% distinct)
2. Distinct scenarios — 20 pts max
3. Sentence-type spread — 15 pts max (up to 5 types: indirect-Q, negation, passive, comparative, relative)
4. Opener-type spread — 15 pts max (4 types: what-did-X-ask, wh-Q, yes-no, statement)
5. Prefilled-type spread — 15 pts max (7 TPO types)
6. Prefilled-type uniformity — 15 pts (penalty if any type > 60% of items)

### Discussion (4 axes)
1. Distinct courses — 30 pts
2. Distinct student names — 30 pts
3. Opening style spread — 20 pts
4. Topic distinctness — 20 pts

### Email (3 axes)
1. EMAIL_CATEGORIES coverage — 40 pts
2. Recipient name uniqueness — 30 pts
3. Subject distinctness — 30 pts

### Reading-AP / Reading-CTW (2 axes each)
1. Topic+subtopic combo uniqueness — 50 pts
2. Discipline (top-level topic) uniqueness — 50 pts

### Reading-RDL-short / Reading-RDL-long (2 axes)
1. Subtopic uniqueness — 60 pts
2. Notice/email balance — 40 pts (best at 50/50 split)

### Quality score (separate, per-bank specific)
- BS: chunks valid + distractor present + answer 7-15 words + chunks rebuild answer
- Discussion: professor 200-700 chars + student1 250-700 + student2 250-700
- Email: scenario 30-60 words + 3 distinct goal verbs + "Write an email" format
- Reading: word count in TPO range + paragraph count (for AP)

## Prefilled rules (BS-specific, the main TPO calibration we missed previously)

BS prefilled was previously uniform (95% subject-pronoun at position 0). After injecting `PREFILLED_PROFILE` from `etsProfile.js` into the BS prompt and relaxing the validator's "4+ word fatal" rule, batches now produce 7 distinct prefilled types matching real TPO:

| Type | Real TPO % | Examples |
|---|---|---|
| subject-pronoun | ~30% | "I", "He", "She", "They" |
| subject-np | ~15% | "The desk", "Some colleagues", "Professor Cho" |
| adverb-opener | ~10% | "Unfortunately,", "Yes,", "Yet" |
| prep-phrase | ~13% | "to me", "the local superstore" |
| verb-phrase | ~13% | "wanted to know", "found out" |
| mid-noun-or-adj | ~13% | "fun", "weekends", "most" |
| conjunction-wh | ~6% | "when", "why", "what" |
| empty | ~13% | (no prefilled — student arranges all words) |

## Validator relaxations (Phase A, commit `2b73337`)

| File | Was | Now |
|---|---|---|
| buildSentenceSchema.js prefilled length | ≥4 words fatal | ≥6 words fatal |
| ETS_STYLE_TARGETS.distractorMin | 7 | 6 |
| ETS_STYLE_TARGETS.negationMin | 2 | 1 |
| ctwValidator blank length | 7.0 error / 6.5 warn | 8.0 error / 7.5 warn |
| apValidator option spread | > 12 warn | > 15 warn |

These relaxations let TPO-style items pass without rejection while still catching genuinely bad output.

## File contracts

### `data/.routine-meta.json` (written by R1, augmented by R2)
```json
{
  "session_id": "routine-YYYYMMDD-HHMMSS",
  "completed_at": "ISO-8601",
  "duration_minutes": 18,
  "highlight": "one-line Chinese summary",
  "commit_sha": "abc123...",
  "r2_session_id": "routine-r2-...",   // added by R2 if it ran
  "r2_completed_at": "ISO-8601",       // added by R2 if it ran
  "results": {
    "bs": {
      "generated": 20,
      "accepted": 10,
      "topics": [],
      "favorite": {...},
      "retried_after_fail": false,
      "failure_reason": "",
      "r2_supplemented": true,         // added by R2
      "r2_items_added": 10             // added by R2
    },
    ...
  }
}
```

### `data/.pending-retry.json` (written by R1's quality gate, read by R2)
```json
{
  "session_id": "routine-YYYYMMDD-HHMMSS",
  "generated_at": "ISO-8601",
  "needs_retry": true,
  "overall_scores": { "diversity": 92, "quality": 98 },
  "retry_banks": [
    {
      "bank": "bs",
      "diversity_score": 88,
      "diversity_threshold": 90,
      "quality_score": 99,
      "quality_threshold": 95,
      "failures": ["多样性 88 < 90"],
      "diversity_breakdown": [...],
      "quality_breakdown": [...],
      "hints": [
        "specific actionable hint #1",
        "specific actionable hint #2"
      ],
      "items_to_supplement": 10
    }
  ]
}
```

## Routine configurations

Both routines live on Anthropic's remote-trigger system:

| Name | Trigger ID | Cron | Purpose |
|---|---|---|---|
| nightly-bank-refresh   | trig_01SmJeXr8ySEZRo2dEoohzTP | 0 19 * * *   | R1 generator |
| nightly-bank-refresh-r2 | trig_016m6uqgCvXtFcjYzhq8jyW3 | 30 19 * * *  | R2 retry |

R2 is **polling style**: it fires unconditionally 30 min after R1, but exits immediately if pending-retry.json shows no work. This avoids the GHA→Anthropic API auth complexity.

Manual trigger via:
```
RemoteTrigger(action="run", trigger_id="trig_...")
```

## Email delivery

`.github/workflows/send-nightly-email.yml`:
- Trigger 1: `workflow_dispatch` (manual fallback)
- Trigger 2: `push` to `data/.last-nightly-summary.md` (auto)

So whenever R1 or R2 commits, the email fires. Two-email day = R1 had failures + R2 supplemented. One-email day = R1 succeeded, R2 was a no-op.

## Failure modes & recovery

| Failure | Detection | Recovery |
|---|---|---|
| R1 wall-clock timeout | No bot commit by 03:30 | Cron-scheduled R2 still fires but finds no pending-retry → exits clean. Next-day cron fires R1 fresh. |
| R1 commit, R2 fails | Email shows R1 data with "(retry pending)" status | Manual `RemoteTrigger run` of R2. Or accept R1's data. |
| Both R1 and R2 fail | No commits at all by 04:30 | Manual fallback: run `.github/workflows/nightly-bank-refresh.yml` (deepseek pipeline) |
| Schema bug rejecting valid items | Daily emails show low diversity/quality scores trending downward | Inspect a recent staging file, audit validators against `tpo_source.md` + TPO reference data |
| Prompt drift (Claude ignoring rules) | Scores degrade over time | Update `lib/bsGen/prompts.mjs` etc. with stronger rules; the routine clones latest main each run |

## Quick verify the pipeline

```bash
# 1. Print the prompt R1 sends to Claude for BS
node scripts/print-bank-prompt.mjs bs

# 2. Score the current routine's batch
node scripts/check-quality-gates.mjs
cat data/.pending-retry.json

# 3. Compose the email body
node scripts/compute-quality-report.mjs

# 4. Diff prefilled-type distribution between two batches
node scripts/ops/diff-batch-prefilled.mjs <batch1> <batch2>

# 5. Trigger R1 manually
# (use claude.ai routine UI, or RemoteTrigger MCP API)
```
