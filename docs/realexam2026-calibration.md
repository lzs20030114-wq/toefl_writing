# realExam2026 Calibration Log

Recalibrating each generation prompt to the **2026 改后 (current) format**, using
the `data/realExam2026/` real-exam bank (OCR/ASR of real 2026 administrations) as
ground truth — the data gap that previously blocked this is now closed.

**Method (per type):** measure the CURRENT generated bank and the realExam2026
target with the **same detectors** (apples-to-apples), record the deviation as a
BEFORE baseline, calibrate the prompt/profile to close it, then re-measure the
next generated batch to confirm improvement.

Baselines recorded 2026-05-31. Re-run `scripts/ops/dev-<type>.mjs` after the next
nightly batch to see movement.

---

## BS — Build a Sentence   `dev-bs.mjs`

Current bank = `data/buildSentence/questions.json` answers (n=860).
Target = realExam2026 BS target sentences (n=504).

| dimension | current bank | realExam2026 target | deviation |
|-----------|-------------:|--------------------:|----------:|
| answer words (mean) | 10.7 [9–13] | 9.4 [6–12] | **+1.3** (too long) |
| direct question % | 9% | 14% | **−5pp** |
| wh-opener % | 0% | 7% | **−7pp** (none generated) |
| embedded/indirect % | 34% | 21% | **+13pp** (over-used) |
| negation % | 19% | 9% | **+10pp** (over-used) |

**Read:** the generator over-indexes on "complex" structures (embedded, negation)
and runs long, while under-producing direct/wh questions. Rebalance toward the
real mix: shorter answers (~9 words), more direct + wh questions, fewer
embedded/negation.

**Fix applied 2026-05-31:** `lib/bsGen/prompts.mjs` sentence-type block rewritten
to the 2026改后 mix (answer ~9 words / concentrated 8-10; ~14% direct questions
incl ~1 wh-question; embedded ~21% / 2 items; negation ~9% / 1 item; was
44%/20%). `etsProfile.js` qmarkRatio 0.08→0.14, avgAnswerWords 10.6→9.4.
- [x] calibrate prompt + profile
- [ ] re-measure next nightly batch with `dev-bs.mjs` (expect length↓, qmark↑,
      wh↑, embedded↓, negation↓ toward target)

---
<!-- next types appended below as they are calibrated -->
