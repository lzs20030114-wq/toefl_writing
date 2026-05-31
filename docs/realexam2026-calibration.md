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

**Deeper pass (eval-spec docs/eval-spec/bs.md) — register + relative-clause fixed 2026-05-31:**
- **Register/topic** (the student first-impression knob): real is casual CAMPUS
  first-person small-talk; the bank was formal third-person OFFICE personas ("The
  store manager reported…"). Added a Register&Topic block: first-person ~40%,
  contractions ~23%, ~63% campus, NO office personas.
- **Relative clauses** real ~18% vs bank ~3% → added to the block.
- distractor (real ~0 vs bank 89% "did") DEFERRED — only n=14 renders, contradicts
  code note; not gutting generation until ~20 more screens confirm (Lesson C).
- **Test batch** `calib-bs-20260531` (Claude, tagged): formal-office persona 0% (was
  pervasive), first-person 60%, campus 70%, relative 20%, embedded 20%, negation 10%,
  easy 20%, length 8.4 — verified the register flip + sentence-type mix.

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

**First-pass decision:** the realExam2026 AP *question COUNT* is a DeepSeek
under-extraction artifact (real ~5/cluster) — DO NOT calibrate to 3.2 (IRON RULE).

**Deeper pass (eval-spec docs/eval-spec/ap.md — the count is the ONLY unreliable dim;
everything else hand-validated from 14 OCR clusters / 39 clean passages) — fixed 2026-05-31:**
The first pass under-sold AP: the eval-spec found the richest gap set of any type.
- **Length (D2, user-mandated):** gen 210 [max 322] vs real **182.5 [max 209]** — the
  "280-360 / mean 317.5" target was a STALE classic-TOEFL number. → `apPromptBuilder`
  §1 + `AP_PROFILE.passageWordCount` → **150-210, center 190**; "hard ≠ longer" (C1).
- **Opening (D13):** received-wisdom opener was weighted **0.46**; real is **1/42 (~2%)**.
  → `openingStrategies` received-wisdom 0.46→0.05, direct_definition 0.31→**0.90**; prompt
  rule "sentence 1 directly names+defines the subject; no Historically/While-early opener".
- **Question-type mix (D5):** gen had **0% insert_text** (real 11.4%, the Q5 of ~60% of
  clusters), **0% reference** (real 4.3%), and **13.6% paragraph_relationship** (real 2.9%).
  → `QUESTION_PLANS` rewritten to the real mix; insert_text added as Q5 in 3/5 plans with
  **[■]×4 passage scaffolding** (D6/C2); reference type added; paragraph_relationship cut to 1/5.
- **vocab options (D7):** gen 2.9 words → rule "single words" (real 1.5).
- **option over-uniformity (D10):** "within 2 words" → loosened to ~3-4 spread (real 2.6;
  gen was 1.6 = synthetic tell). `optionLengthVarianceMax` 1.5→3.5.
- **over-smoothing (D15/16/17):** hedging/contrast/passive ran 2-3× real → dialed to ~1 each.
- **Test batch** `calib-ap-20260531` (Claude, n=2): passage **182w** (real 182.5), opening
  direct-definition 2/2, insert_text + [■]×4 present, reference present, vocab options **1.0w**,
  option spread **2.50** (real 2.6), hedges **1.0** (real 1.03), contrast **1.0** (real 1.09) — all verified.

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

**Deeper pass (eval-spec docs/eval-spec/ctw.md) — LEXICAL DIFFICULTY (the user's
mandated vocab knob) fixed 2026-05-31:**
- **Blank-word difficulty** is the gap: real CTW blanks avg **5.77 chars / 25.6% ≥8
  letters** (B2-C1: characterized, advantageous, conversely, vegetation); old gen
  blanks **5.13 / 15.2%** — too easy. Root cause: the prompt forced **CEFR A2-B1,
  avg word 4.5-5.5, "NO sophisticated/fundamental"** AND told the model to "put
  interesting vocab in VISIBLE positions, common words in blanks" — actively easing
  the blanks below the real exam.
- **Fix A (prompt)**: register → popular-science/intro-textbook "not dumbed-down";
  avg word length 4.5-5.5 → **~5.3-6.0 (real 5.7)**; vocab A2-B1/max-1-2-B2 → **B1-B2
  base, several B2-C1 normal**, with the real blank-word list as exemplars.
- **Fix B (validator, Lesson D)**: `ctwValidator.js` rare-blank gate rejected ~19% /
  warned ~54% of REAL items — it was suppressing authentic difficulty. Loosened
  error 0.5→0.7, warn 0.3→0.5.
- **Test batch** `calib-ctw-20260531` (Claude, tagged, n=3): blank avg word length
  **5.80** (real 5.77, was 5.13), blank **%≥8 = 30** (real 25.6, was 15.2), passage
  **66.3 words** (real 69.3) — lexical difficulty + length both verified on-target.

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

**Fix applied 2026-05-31 (first pass):** `latPromptBuilder.js` transcript tiers
150/180/200 → 200/240/280 (max 330) toward real 258.
- [x] bump lecture length target to realExam2026

**Deeper pass (eval-spec docs/eval-spec/listening.md — 18 solid dims across 4 subtypes;
the #1 tell is the register ladder) — fixed 2026-05-31:**
- **LAT lecture** — (1) the output-schema STILL said "150-250 words" (the header fix never
  reached it → bank stayed ~167, below real min 192); fixed to **200-330 (~258)**.
  (2) Register was forced CHATTY ("contractions FREELY", mandatory "you"+rhetorical-Q) →
  bank 5.0 contractions/100w; real is **1.2** → rewrote to declarative opening + occasional
  contractions; softened the reject rules. (3) Domain was ~64% science; real is **~40%
  arts+humanities** (art history #1) → reweighted `TOPIC_POOL`, added music/architecture/
  physics, and made the picker **weight-aware** (the old plain-random shuffle IGNORED weight).
- **LC conversation** — length 100-180→**68-102** (real 89), turns 8-12→**4-7** (real 6),
  speakers first-names→**Man/Woman**, and `SCENARIO_POOL` flipped from 50% student↔staff
  SERVICE desks to **~90% peer/social** chats (music/food/movies/plans/dorm) — the biggest LC gap.
- **LA announcement** — opener "64% Attention" (FALSE vs real 21%) → spread across
  Attention 21 / Good-morning 17 / direct 13 / **professor-first-person 9** / Due-to 9 /…;
  register contractions 0.40→**~1.9/100w** (was bureaucratic).
- **LCR short-response** — **wh-questions 7%→~49%** (the dominant real form, biggest gap);
  prompt length target 8-12→**~8** (real median 8).
- **Test batch** `calib-listening-20260531` (Claude): LAT 245w/contr 1.2/art-history/declarative;
  LC 71-73w/6-turn/peer/Man-Woman; LA contr 2.6/professor+due-to openers; LCR wh 67%/7.8w — all verified.
- Deferred (Lesson C, image-PDF data): MCQ distractor trap-logic, stem-type ratios, difficulty split.

## Speaking · repeat — Listen & Repeat   `dev-speaking.mjs`   ✅ calibrated (deeper pass)

Current = `data/speaking/bank/repeat.json` (n=11). Target = realExam2026 repeat (n=51).

| dimension | current | realExam2026 | deviation |
|-----------|--------:|-------------:|----------:|
| sentences / set | 7 | 6.9 | 0 |
| sentence words | 9.2 | 9.6 | −0.4 |
| difficulty easy (4-7w) % | 32% | 30% | +2 |
| difficulty medium (8-12w) % | 48% | 54% | −6 |
| difficulty hard (13+w) % | 19% | 16% | +3 |

**First-pass read (INCOMPLETE):** sentences/set + aggregate length/difficulty matched,
so the first pass concluded "no change". **The deep eval-spec REVERSED this** — the
stat-comparison missed the register/structure tells.

**Deeper pass (eval-spec docs/eval-spec/speaking_repeat.md) — fixed 2026-05-31:**
Per Correlation 3, the synthetic register = greeting + question + threat, all seeded by
the prompt's two worked examples + the easy/hard structure lists. Fixed all at once:
- **Punitive-threat trope (D12, strongest tell):** "late returns will result in suspension
  of your privileges" — bank **10.4%**, real **0/351**. Seeded verbatim by example S7 →
  removed from `STRUCTURE_RULES.hard` + examples; validator now flags `punitive_warning`.
- **Yes/no questions (D7):** bank 5.2%, real **0/351** → removed from `easy` structures +
  example S2; validator flags `question_mark`.
- **Rigid 2/3/2 (D3, biggest gap):** bank 100%, real only **6%** (real is medium-dominant,
  usually ONE hard) → per-set length signature now varies (2/4/1, 3/3/1, 1/4/2…); validator
  `difficulty_progression` rewards medium-dominant + long-finish, not the 2/3/2 staircase.
- **Over-"Welcome" openers (D5):** bank 64%, real **16%**; bank had 0 bare-declarative
  openers (real 53%) → examples + rules switched to bare-declarative locating openers.
- **Missing map/schedule closer (D13):** bank 0%, real **33%** → added as the hard closer.
- **Missing procedure/how-to family (D14):** bank 0, real ~6/51 → added (cooking/repair/craft/booking) with step-sequence flow.
- **Over-address (D9):** bank 53% you/your, real 37% → rule capped to ~1-in-3; validator targets 0.37.
- **Test batch** `calib-repeat-20260531` (Claude, 1 orientation + 1 procedure): questions
  **0**, punitive **0**, Welcome **0**, signatures 3/3/1 + 2/4/1, last-longest 2/2, map-closer
  present, mean 9.0w (real 9.56), address 43% (real 37) — all tells fixed; validator scores 0.77 / 0.89.

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
| Reading AP | **calibrated (deeper pass)** | length 210→190, opening received-wisdom 46%→5%, +insert_text/reference (were 0%), −paragraph_relationship 13.6%→3%, single-word vocab opts, loosened option spread, dialed back over-smoothing. Only question-COUNT held (extraction artifact). |
| Reading CTW | **calibrated** | length 56→69 + LEXICAL: blanks too easy 5.13→5.80 chars (real 5.77), B2-C1 vocab allowed, validator loosened (Lesson D) |
| Listening | **calibrated (deeper, 4 subtypes)** | register ladder (lecture 5.0→1.2 contr, announcement 0.40→1.9), lecture domain 64%-sci→40%-arts (art-history #1, +weight-aware picker), conversation 138w/9t/service→89w/6t/peer + Man/Woman, LA opener Attention-64→21 +professor/Due-to, LCR wh 7%→49% + len→8 |
| Speaking repeat | **calibrated (deeper pass)** | first-pass "on-target" was incomplete — deep read found synthetic register tells: punitive threats 10.4%→0, yes/no Qs 5.2%→0, rigid 2/3/2 100%→varied, Welcome 64%→bare-declarative, +map-closer +procedure family, address 53%→37% |
| Speaking interview | insufficient | n=14, below calibration bar |

Re-run each `dev-<type>.mjs` after the next nightly batch to confirm convergence.
