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
| **difficulty easy %** | **1%** | **22%** | **−21pp** (almost no easy!) |
| difficulty medium % | 71% | 60% | +11pp |
| difficulty hard % | 28% | 18% | +10pp |
| topic campus % | 14% | 19% | −5pp (minor) |
| topic daily % | 9% | 6% | +3pp (minor) |

**Read (full dimension set):** the generator **over-complexifies** — it produces
almost no easy items (1% vs 22%), runs long, over-uses embedded + negation, and
omits direct/wh questions. All five point the same way: rebalance toward the real,
more-balanced 2026改后 mix (more easy/short/direct, fewer embedded/negation/hard).
M~ dims (prefilled / distractor / chunk / prompt-style) stay on the cleaner
hand-transcribed `tpo_source` calibration — realExam2026 OCR of the scrambled
word-pool is too noisy to override them (cross-check deferred).

**Fix applied 2026-05-31:** `lib/bsGen/prompts.mjs` sentence-type block rewritten
to the 2026改后 mix (answer ~9 words / concentrated 8-10; ~14% direct questions
incl ~1 wh-question; embedded ~21% / 2 items; negation ~9% / 1 item; was
44%/20%). **Difficulty** distribution → 2 easy / 6 medium / 2 hard with an explicit
"you MUST include 2 genuinely simple short sentences" warning (gen produced ~1%
easy). `etsProfile.js`: qmarkRatio 0.08→0.14, avgAnswerWords 10.6→9.4,
ETS_DIFFICULTY 10/70/20 → 22/60/18.
- [x] calibrate prompt + profile (length, sentence-type, embedded, negation, difficulty)
- [ ] re-measure next nightly batch with `dev-bs.mjs` (expect easy↑ to ~22%,
      length↓, qmark↑, wh↑, embedded↓, negation↓)

---
## AD — Academic Discussion   `dev-ad.mjs`

Current bank = `data/academicWriting/prompts.json` (n=144). Target = realExam2026 AD (n=50).

| dimension | current bank | realExam2026 target | deviation |
|-----------|-------------:|--------------------:|----------:|
| **student post words** | **71.9** | **42.7** | **+29 (≈70% too long)** |
| professor question words | 13.8 | 15.4 | −1.6 (minor) |
| course reuse (items/course) | 2.2 | 2.5 | −0.3 (fine) |
| exactly-2-students % | 100% | 94% | +6 (fine) |

**Read:** the one real gap is student-post LENGTH — the prompt targeted old-TPO
~430 chars / 4-5 sentences, but 2026改后 student posts are ~43 words / ~250 chars /
2-3 sentences. Everything else (course diversity, 2-student structure, prof
question length) already matches.

**Fix applied 2026-05-31:** `academicWriting.js` STUDENT RESPONSES block → ~40-45
words / 2-3 sentences (was ~430 chars / 4-5 sentences). Professor-post length not
recalibrated (realExam2026 stored only the question, not the full post; the
question length 13.8 vs 15.4 is already close).
- [x] calibrate prompt
- [ ] re-measure next batch with `dev-ad.mjs` (expect student words 72→~43)

## Email — Write an Email   `dev-email.mjs`   ✅ already on-target

Current bank = `data/emailWriting/prompts.json` (n=139). Target = realExam2026 Email (n=51).

| dimension | current bank | realExam2026 target | deviation |
|-----------|-------------:|--------------------:|----------:|
| scenario words | 42.4 | 39.5 | +2.9 (within 33–55 range) |
| bullets / task points | 3 | 3 | 0 |
| exactly-3-bullets % | 100% | 100% | 0 |

**Read (first pass):** scenario length + bullet count already on-target.

**Deeper pass (eval-spec docs/eval-spec/email.md) — two real gaps fixed 2026-05-31:**
- **Topic category**: real is ~65% Services&Events/leisure (gyms/hotels/restaurants/
  concerts/trips/events), gen only ~6.5% (it over-produced Workplace 0.20 + Community
  0.15 the real exam barely has). → `EMAIL_CATEGORIES` rebalanced: new "Services &
  Events" 0.42, Academic 0.20, Workplace 0.20→0.04, Community 0.15→0.03.
- **Recipient form**: 32% of gen used forms the real exam NEVER uses (full "First
  Last", bare org "Customer Service"). → recipient rule → Title+surname ~82% /
  friend-first-name ~18% ONLY, banned First-Last + org addressees.
- length + vocab already on-target (scenario 42w/4.94 char vs real 39w/4.83) — no change.

**Test batch** `calib-email-20260531` (Claude, tagged): Title+surname 5/6, banned-form
0, 3-bullet 6/6, services topic 5/6, subject 4.2w — verified. (scenario 32w slightly
short — nudge later.)

## Reading · AP — Academic Passage   `dev-reading.mjs`   ⚠️ data caveat

Current = `data/reading/bank/ap.json` (n=156). Target = realExam2026 AP (n=64).

| dimension | current bank | realExam2026 | note |
|-----------|-------------:|-------------:|------|
| passage words | 210.9 [125–322] | 181.1 [48–209] | current a bit long; max 322 vs 209 |
| **questions / passage** | **5** | **3.2** | ⚠️ **UNRELIABLE** — DeepSeek under-extracted AP questions (the real reading section has ~20 MC; 3.2 is an extraction artifact). DO NOT calibrate to it. |
| options / question | — | 4 | (4 confirmed) |

**Decision:** AP NOT recalibrated — the realExam2026 AP question count is a DeepSeek
under-extraction artifact, and the passage may be truncated, so the target is
unreliable (IRON RULE). Only safe signal: max passage length looks high (322) vs
real ~209; left for a later cautious cap. No change this pass.

## Reading · CTW — Complete the Words   `dev-reading.mjs`

Current = `data/reading/bank/ctw.json` (n=191). Target = realExam2026 CTW (n=75).

| dimension | current bank | realExam2026 | prompt target | deviation |
|-----------|-------------:|-------------:|--------------:|----------:|
| passage words | 56.3 [45–80] | 69.3 [47–94] | 60–75 (mean 66) | **−13 (gen undershoots its OWN target)** |

**Read:** the prompt target (mean ~66) is CORRECT — realExam2026 confirms 69. The
GENERATOR undershoots it (produces 56). Compliance issue, not a target issue.
(blank count M✗ — answer words live in the answer key, not the CTW json.)

**Fix applied 2026-05-31:** `ctwPromptBuilder.js` length → target 65-78 words / hard
min 62 / "write full 4-5 sentences, generator tends to undershoot". Calibration
source updated to realExam2026 (75 passages, mean 69).
- [x] tighten CTW length floor
- [ ] re-measure next batch (expect 56→~68)

## Listening (lc / la / lat)   `dev-listening.mjs`

Current = `data/listening/bank/{lc,la,lat}.json`. Target = realExam2026 listening.

| sub-type | current words | realExam2026 words | deviation |
|----------|--------------:|-------------------:|----------:|
| 对话 lc | 142 [100–188] | 90 [53–323] | +52 (current long-ish; real median lower) |
| 通知 la | 90 [70–106] | 98 [46–300] | −8 (fine) |
| **讲座 lat** | **124–141 (full items)** | **258 [192–505]** | **−120+ (lectures too short)** |

| type mix | current | realExam2026 |
|---|---|---|
| 对话 / 通知 / 讲座 | 34% / 46% / 21% | 45% / 23% / 33% |

**Read:** (1) lectures are the big gap — the prompt targeted 150-250 words but real
2026改后 lectures are ~258 [192-505]; generated full lectures only hit 124-141, and
9/14 lat items were broken stubs (<20 words). (2) conversations run a bit long
(142 vs 90). (3) type mix over-weights announcements (46% vs 23%), under-weights
conversations + lectures.

**Fix applied 2026-05-31:** `latPromptBuilder.js` transcript tiers 150/180/200 →
200/240/280 (max 330) toward real 258. Broken lat stubs will be replaced on
regeneration. Conversation length + type-mix noted (secondary; not changed this pass).
- [x] bump lecture length target to realExam2026
- [ ] re-measure next batch (expect lat→~250); consider lc trim + mix rebalance

## Speaking · repeat — Listen & Repeat   `dev-speaking.mjs`   ✅ already on-target

Current = `data/speaking/bank/repeat.json` (n=11). Target = realExam2026 repeat (n=51).

| dimension | current | realExam2026 | deviation |
|-----------|--------:|-------------:|----------:|
| sentences / set | 7 | 6.9 | 0 |
| sentence words | 9.2 | 9.6 | −0.4 |
| difficulty easy (4-7w) % | 32% | 30% | +2 |
| difficulty medium (8-12w) % | 48% | 54% | −6 |
| difficulty hard (13+w) % | 19% | 16% | +3 |

**Read:** no calibration needed — sentences/set, length, and the 2-easy/3-med/2-hard
difficulty gradient all match within a few pp. No change (IRON RULE).

## Speaking · interview   — insufficient data
realExam2026 interview n=14 (< the n≥30 calibration bar). Not calibrated this pass;
revisit when more speaking audio is transcribed.

---

## Summary (2026-05-31 pass)

| type | verdict | main deviation found & fixed |
|------|---------|------------------------------|
| BS | **calibrated** | over-complexified: 1% easy→22%, answers long, embedded/negation high, no wh-Q |
| AD | **calibrated** | student posts 72→43 words (old-TPO 430 chars → 2026 ~250) |
| Email | on-target | scenario 42 vs 39, 3 bullets — already matched |
| Reading AP | **held (data caveat)** | question-count target unreliable (DeepSeek under-extraction) |
| Reading CTW | **calibrated** | gen undershoots length 56 vs 69 (target was correct) |
| Listening | **calibrated** | lectures 124-141 → target 258; +broken stubs to regen |
| Speaking repeat | on-target | difficulty gradient already matched |
| Speaking interview | insufficient | n=14, below calibration bar |

Re-run each `dev-<type>.mjs` after the next nightly batch to confirm convergence.
