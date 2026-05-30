---
name: calibration-fix
description: Diagnose and fix a question-quality REGRESSION against real TPO ground truth, then lock it so it cannot silently regress again. Use when a generated dimension drifted from real exam style (e.g. "prefilled is all he/she/names", "distractors collapsed to did", "topics too repetitive", "sentence types off"), when output "doesn't feel like real TPO", or when a previously-fixed quality issue came back. Works for any bank (BS / Discussion / Email / Reading).
user-invocable: true
argument-hint: [dimension, e.g. "distractor variety" | "prefilled person-ratio" | "AP topic diversity"]
---

# Calibration Regression Fix — methodology

A quality dimension drifted away from real exam style. This is the disciplined
loop we use to fix it WITHOUT guessing and WITHOUT it silently coming back.
It was hardened over two real fixes in this repo (prefilled person-ratio
60%→15%; distractor "did" 71%→10%). Follow every phase — skipping the
verification or the lock is exactly how these regressions kept returning.

## IRON RULE (overrides convenience)

**Never claim or act on a conclusion before truly verifying it.** Not from
memory, not from the project's own historical bank, not from "it looks like".
A proxy indicator (e.g. the existing bank, a prior calibration comment) does
NOT count as verification. Measure the real thing first.

Corollary proven repeatedly: **the historical bank is NOT ground truth.** It has
itself been miscalibrated — prefilled over-tuned one way, distractors the other.

**Ground truth = real-exam items, in reliability tiers (2026-05 update):**
1. `data/realExam2026/` — the **current 2026改后 format** (OCR/ASR of real 2026
   administrations). This is the PRIMARY target — the app generates for THIS
   format. Per-type dimensions + ratios + examples already distilled into
   `docs/eval-spec/<type>.md` + `data/eval-profiles/<type>.json` (start there).
2. `tpo_source.md` / `real_tpo_reference.json` — **older** TOEFL (different task
   lineup). Use only as a secondary cross-check; do NOT calibrate the 2026 format
   to it where the two diverge (BS answer-length, AD student-post length, etc. all
   shifted between formats).
- Reliability WITHIN realExam2026: clean text (answer keys, listening transcripts)
  > vision-OCR of image PDFs > examword memory-reconstructions. Some structured
  fields are lossy/contaminated (BS scrambled-pool OCR, AP under-extracted
  questions, AD only stored the question) — for those, go to the **rendered image
  / raw OCR / answer key** and read item-by-item (see Phase 0).

---

## Phase 0 — Work from the per-type EVALUATION-DIMENSION SYSTEM (not a single symptom)

Question quality is multi-dimensional and **every type has its OWN characteristic
dimensions** (BS: length / sentence-type / prompt-style / prefilled / distractor /
chunk / topic / difficulty; AD / Email / Reading / Listening / Speaking each
different). Calibrating one symptom in isolation misses the rest and hides
correlated gaps (e.g. BS "difficulty 1% easy" was invisible until measured).

- The dimension map is `docs/type-eval-dimensions.md`. The precise, example-anchored
  per-type spec is `docs/eval-spec/<type>.md` + `data/eval-profiles/<type>.json`
  (dimension × target ratio (with n) × verbatim real examples × detector ×
  current-bank gap × prompt/profile mapping). **Consult these first** — they ARE
  the calibration targets.
- If a type's spec is missing or stale, BUILD it bottom-up before calibrating:
  deep-read the real items (stratified ~50 for large banks; near-all for small),
  discover dimensions from the data (quantitative AND qualitative — tone, register,
  distractor trap-logic, stem phrasing, topic realism), and for UI/mechanic
  dimensions the structured JSON loses, **render the source PDF and read it**
  (`scripts/ops/render-pdf.py` → Read the PNG) or read raw OCR / answer keys.
- **Every detector must be hand-validated** against ~10 real items before its
  number is trusted (IRON RULE at the detector level). A regex that disagrees with
  your reading is wrong — fix it, don't report it.
- Reusable measurers live in `scripts/research/<type>_measure.mjs` and
  `scripts/ops/dev-<type>.mjs` (current-bank vs realExam2026, SAME detector).

Then pick the dimension(s) with the largest, RELIABLE gap to fix this pass.

## Phase 1 — Frame the symptom precisely

State, in one sentence, WHICH dimension drifted and IN WHICH DIRECTION, as a
measurable quantity. Vague ("quality dropped") is not actionable.
- Good: "BS distractor collapsed — 71% of distractors are the single word 'did'."
- Good: "prefilled is 61% person-references (he/she/names) vs an unknown TPO rate."

Pick the metric you will measure on BOTH the real exam and our output.

## Phase 2 — Measure OUR output (fast, reveals the collapse)

Our generated items have explicit fields — measure them first; it's the
equivalent of "our batch = 61%". Read `data/<bank>/...` and the recent
`data/<bank>/staging/<session>.json` files. Tabulate the metric:
- distribution of the value, distinct count, top-value share, presence ratio.
- Compare historical (old pipeline) vs recent (Claude routine) batches — they
  often regressed in DIFFERENT directions; both can be wrong.

Write a throwaway measurement script under `scripts/ops/measure-*.mjs`.

## Phase 3 — Verify the REAL TPO ground truth (the crux)

Measure the SAME metric on `data/buildSentence/tpo_source.md` (60 real BS items)
or the bank's real-reference file (`data/academicWriting/real_tpo_reference.json`,
`data/emailWriting/tpo_reference.json`, `lib/readingBank/readingEtsProfile.js`).

- Use the **same classifier** on TPO and on our output — apples-to-apples, or
  the comparison is meaningless. (Reuse the exact function, e.g. import from
  `lib/quality/scoreBatch.mjs`.)
- Pattern script: `scripts/ops/measure-tpo-*.mjs` (see measure-tpo-prefilled.mjs,
  measure-tpo-distractor.mjs for the parsing template).

**If the TPO sample is too small for this dimension** (e.g. the sub-pattern
appears in only 3-4 of 60 items, or the bank's reference file has < ~30 items):
the measurement is statistically weak — get more authentic data before
calibrating:
- Crawl real ETS/TPO items from third-party sources. Tools: `WebSearch` /
  `WebFetch`; existing crawler patterns in `scripts/crawl-tpo-*.mjs`.
- **FIDELITY IS MANDATORY**: only keep verbatim real ETS items. Reject
  paraphrased, AI-generated, or "TPO-style" imitations — calibrating to fake
  data is worse than a small real sample. Record the source URL per item.
- Append to the real-reference file, re-measure.

## Phase 4 — Quantify the deviation + locate the ROOT CAUSE in code

Put the three numbers side by side: real TPO vs historical vs current. State
the gap in percentage points.

Then trace the ACTUAL code chain to find where the calibration is (or isn't)
enforced — do not assume:
```
prompt builder (lib/bsGen/prompts.mjs, lib/ai/prompts/*, lib/readingGen/*)
   → print-bank-prompt.mjs (what the routine literally receives)
   → generator (Claude routine / DeepSeek)
   → merge + per-item validator (lib/questionBank/*, lib/readingGen/*Validator)
   → batch gate (scripts/check-quality-gates.mjs)
```
Run `node scripts/print-bank-prompt.mjs <bank>` and READ what the model is
actually told. The root cause is usually one of:
- the prompt states the wrong target (e.g. literally "Mainly: did, do, does"), or
- the prompt never injects the calibration at all (soft signal absent), or
- a validator/retry stage that used to enforce it was dropped in a pipeline migration.

## Phase 5 — Prove the fix DIRECTION (falsification, not assertion)

Before building anything, prove the direction is right with a test that COULD
fail:
- Form the hypothesis as something falsifiable (e.g. "TPO keeps the person as a
  draggable chunk and anchors a non-subject word" → measurable: does TPO have
  person-subjects but low person-as-prefilled?).
- Write a one-off check (pattern: `scripts/ops/test-*-hypothesis.mjs`). If the
  data contradicts the hypothesis, the direction is WRONG — stop and rethink.
- Confirm the TARGET value is real and measured, not estimated.

## ⚠️ Two hard-won lessons (read before every fix)

**A. The historical bank AND the stored profile can BOTH be wrong — and stale
profile numbers cause FALSE alarms.** Real case: an audit flagged "embedded-Q
underuse (40-50% vs 63%)". The 63% came from `etsProfile.embeddedRatio`, a
STALE figure the prompt had already been recalibrated away from. Direct
re-measure of tpo_source = 45% → our output was on-target, the "regression" was
fake, and "fixing" it would have RE-INTRODUCED the over-tuning we'd removed.
ALWAYS re-measure ground truth from tpo_source before trusting a stored
constant or a sub-agent's number. After confirming, FIX the stale constant so
it can't mislead the next audit.

**B. Prompt attention budget — soft dimensions oscillate.** Every calibrated
rule you add to the prompt competes for the model's finite attention. When we
added the 2nd-person rule, two SOFT (un-gated) dimensions drifted in the next
batch (person-prefilled 30%→5%, chunk single-word 79%→48%) even though their
prompt text was unchanged. The HARD-gated dimensions (distractor, 2nd-person)
stayed put. Implications:
- Only HARD-gated dimensions are stable. Prompt-only ("soft") dimensions will
  oscillate batch-to-batch as the prompt grows. This is WHY regressions kept
  coming back before gates existed.
- Don't reactively re-gate on ONE low batch — it may be soft-dimension variance
  (check the monitor's multi-day history first).
- Gate the dimensions you truly can't let slip; accept managed variance on the
  rest; let the nightly monitor's TREND (not a single batch) decide when a soft
  dimension has genuinely regressed vs just wobbled.
- Two-sided bands: an over-correction (too LOW) is as wrong as the original
  (too HIGH). person-prefilled at 5% is as far from TPO's 30% as 60% was.

**C. Structured extraction can be UNRELIABLE for the very dimension you measure.**
The realExam2026 JSON is lossy/contaminated for some fields: BS scrambled-pool OCR
destroys tile boundaries; AP question-count is DeepSeek-UNDER-extracted (the "3.2
questions/passage" is an artifact — real clusters are 5); AD stored only the
question, not the full professor post. Calibrating to a lossy field calibrates to
an artifact. When a number is surprising or contradicts the code/comments, go to
the **rendered image / raw OCR / answer key** and read item-by-item before acting.
(This is why BS distractor "0% in real" stayed DEFERRED — only n=14 renders; gating
generation on a possibly-wrong figure would be a large mistake.)

**D. A VALIDATOR / gate can be STRICTER than the real exam.** The current CTW
validator, simulated on REAL exam passages, would reject ~19% of them — it actively
suppresses authentic difficulty the exam has. So when calibrating, also run the
existing gate/validator AGAINST the real items: if it rejects real-exam items, the
GATE is the regression, not the generator. Loosen it to admit the real-exam range.

## Phase 6 — SELF-AUDIT the plan before executing (do not skip)

Adversarially review your own plan. Concrete failure modes that bit us:
- **Measurement bias**: is your TPO classifier accurate? Hand-verify ~6-10
  items. If it has a systematic bias (our distractor detector over-counted
  auxiliaries), you CANNOT hard-code precise TPO percentages — instead gate on
  the robust **collapse signal** (one value dominating / too few distinct),
  which survives measurement noise.
- **Over-correction**: guard BOTH bounds. TPO person-ratio is 30%, not 0% —
  reward a band (e.g. 10-40%), mild-penalize too-low, so the fix doesn't
  overshoot into a new regression.
- **Rule conflict**: will the new rule fight an existing one? (e.g. "use 15
  distinct names" vs "don't anchor the person" — reconcile explicitly.)
- **Gate masking**: a diluted scoring axis can let a collapse pass the overall
  gate. Use a DEDICATED independent gate for the critical dimension.
- **Retry that re-collapses**: will R2 reproduce the same failure? Make the
  hint specific and over-corrective.
State the audit verdict out loud. If you found a flaw, fix the plan, don't
proceed on the flawed one.

## Phase 7 — Implement as LAYERED defense (soft alone always regresses)

The lesson from "I fixed this before and it kept regressing": a prompt-only
fix is soft and silently rots. Build all four layers:

1. **Prompt (soft, ~65-80% compliance)** — `lib/bsGen/prompts.mjs` etc.
   State the calibration with examples; explicitly ban the failure mode; give a
   hard per-batch target.
2. **Scorer axis (measures every night)** — add an axis to
   `lib/quality/scoreBatch.mjs`; expose the raw metric in `detail` for the gate.
3. **Dedicated hard gate (auto-retry)** — `scripts/check-quality-gates.mjs`:
   an INDEPENDENT threshold (not just the diluted overall score) that writes
   `data/.pending-retry.json` with a specific actionable hint so R2 fixes it.
   Export the threshold as a CONSTANT from scoreBatch (single source of truth;
   no hardcoded magic numbers that can desync). Gate on robust signals when
   measurement is noisy (Phase 6).
4. **CI regression test (makes regression LOUD)** —
   `__tests__/*.regression.test.js`, runs in CI on every push. Lock: the
   classifier, the gate detecting a known-bad batch, a known-good batch passing,
   the constant's value, the prompt no longer containing the root-cause line,
   and a loose-band re-measure of the TPO ground truth (so the target can't
   silently move). **Then prove the test has teeth** — temporarily sabotage the
   measurement and confirm the test goes red.
5. **Nightly monitor (catches what per-night gate can't)** — add the metric to
   `scripts/quality-monitor.mjs` history + a DRIFT check (trend across days,
   final-state collapse). It emails an alert on regression.

## Phase 8 — Live-test the execution layer (don't assume the LLM obeys)

The prompt is soft — you cannot conclude it worked until you measure a real
batch. Trigger one generation run (RemoteTrigger `run` on the R1 routine, or
`/bs-produce`), wait for the bot commit, pull it, and re-measure the metric on
the fresh staging file. Report the real before→after number. If it didn't move
enough, the gate+R2 backstops it, but tighten the prompt and re-test.

## Phase 9 — Report with real numbers

Give the before→after table with actual measured values (e.g. "did 71% → 10%,
distinct 6 → 13, gate ✗→✓"). Distinguish what is VERIFIED (measured) vs what is
still soft-dependent (LLM compliance, watched by the gate).

---

## Definition of done

- [ ] Real TPO measured (sample large enough; crawled authentic items if not)
- [ ] Our output measured the same way; deviation quantified
- [ ] Root cause located in the actual code chain
- [ ] Fix direction proven by a falsifiable check
- [ ] Plan self-audited; gating on robust signals if measurement is noisy
- [ ] Prompt + scorer axis + dedicated gate + CI test + monitor all in place
- [ ] CI test verified to have teeth (sabotage → red)
- [ ] Live batch generated and re-measured; before→after reported

A fix is NOT done at "the prompt looks right." It is done when a regression
would be caught loudly (CI red / nightly alert) and auto-retried (R2).

## Key files in this repo

- Ground truth (PRIMARY, 2026改后): `data/realExam2026/` + the distilled
  `docs/eval-spec/<type>.md` & `data/eval-profiles/<type>.json` + dimension map
  `docs/type-eval-dimensions.md`. Secondary (older format): `tpo_source.md`,
  `data/academicWriting/real_tpo_reference.json`, `lib/readingBank/readingEtsProfile.js`
- Extraction tooling (image→text / audio→text, zero LLM tokens): `scripts/ops/
  {render-pdf,ocr-pdf,batch-ocr-all,ocr_sets,audio_transcribe}.py`; structuring via
  cheap DeepSeek `scripts/ops/structure_with_deepseek.py`; folder `data/realExam2026/`.
- Calibration constants: `lib/questionBank/etsProfile.js` (PREFILLED_PROFILE,
  ETS_STYLE_TARGETS), `lib/quality/scoreBatch.mjs` (PERSON_PREFILLED_GATE,
  DISTRACTOR_TOP_FRAC_GATE, …)
- Prompts: `lib/bsGen/prompts.mjs`, `lib/ai/prompts/*`, `lib/readingGen/*PromptBuilder.js`
- What the routine receives: `scripts/print-bank-prompt.mjs <bank>`
- Scorer + gates: `lib/quality/scoreBatch.mjs`, `scripts/check-quality-gates.mjs`
- Monitor: `scripts/quality-monitor.mjs`, `.github/workflows/nightly-quality-monitor.yml`
- Measurement templates: `scripts/ops/measure-tpo-*.mjs`, `scripts/ops/test-*-hypothesis.mjs`
- Regression test pattern: `__tests__/bs-person-prefilled.regression.test.js`
- Routines: R1 generator + R2 retry (RemoteTrigger); per-night flow in `docs/quality-pipeline.md`
