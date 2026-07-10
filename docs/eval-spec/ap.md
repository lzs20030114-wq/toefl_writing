# Evaluation Spec — Reading · Academic Passage (`ap`)

**Ground truth:** `data/realExam2026/reading/academicPassage.json` — 64 items / 207 questions (recalled 2026改后, tier=recalled, OCR+DeepSeek). After dedup (A/B/C 卷 repeats) = **42 unique passages**; after excluding 3 RIDL-leakage items (a library-renovation notice, a film review, a software-update email) = **39 clean academic passages**. The structured JSON's PASSAGE TEXT is reliable; its QUESTIONS are **under-extracted** (mean 3.2/passage vs true 5). True question structure is **hand-coded from the raw 阅读 OCR** in `.codex-tmp/ocr/*阅读*.txt` (14 fully-read clusters = **70 questions**).
**Current generated bank:** `data/reading/bank/ap.json` — **89 passages / 445 questions** (`{version, items}`, 5 questions each; live node count 2026-07-10; the "156 passages / 780 questions" cited historically was the pre-fix bank). Dimensional `Current:` values below are the **2026-07-10 postfix snapshot** (`reading_ap.gen`, n=88).
**Generation prompt/profile:** `lib/readingGen/apPromptBuilder.js` (`buildAPPrompt`, `TOPIC_POOL`, `RHETORICAL_PATTERNS`, `QUESTION_PLANS`) + `lib/readingBank/readingEtsProfile.js` (`AP_PROFILE`, `ETS_FLAVOR`).
**Reliability of inputs:** passage text + length + lexis + paragraph-1 style = **solid** (clean structured text, hand-validated). Question-type mix + insert_text presence = **solid** (hand-coded from OCR, n=70). Paragraph count = **partial** (JSON lost the breaks; read from OCR). Distractor trap-logic + real answer-position bias = **deferred** (no answer key in the data).

---

## ⚠ The single most important context

**The 2026改后 reading section is NOT classic TOEFL.** It is module-based — **Module 1 = 35 questions, Module 2 = 15 questions** — and on one continuous screen flow it INTERLEAVES three item types:

1. **Complete-the-Words (CTW)** — "Fill in the missing letters", Q1-20 of Module 1, Q1-10 of Module 2 (separate type, code `ctw`).
2. **Read-In-Daily-Life (RIDL)** — signs / notices / receipts / reviews / posters / emails, one or two questions each (separate type, code `ridl`).
3. **Academic Passage (AP)** — *this type* — appears as **clusters of exactly 5 questions** shown **one question per screen** with the full passage on the left, in the Q26-35 band of Module 1 (one or two passages) and the Q11-15 band of Module 2 (one passage).

So an "AP item" = **one ~190-word passage + a 5-question cluster.** Two numbers in the live code are inherited from OLD classic-TOEFL samples and are **wrong for 2026改后**:
- `apPromptBuilder` passage length "mean 317.5, target 280-360" → real 2026 is **~183 words (max ~210)**.
- `ETS_FLAVOR.passageStructure.openingStrategies.received_wisdom_then_revision = 0.46` → real 2026 opens with a **direct topic/definition statement** (received-wisdom = 1/42).

**The three biggest gaps — 2026-07-10 postfix: all substantially CLOSED:** (1) ~~zero insert_text~~ → now **7.95%** of Qs (`insert_text_qshare`; placed as Q5 in 3/5 `QUESTION_PLANS`); (2) ~~passages too long (mean 210, max 322)~~ → now mean **185.25** (`mean_words`, real 181); (3) ~~over-produced paragraph_relationship (13.6%)~~ → now **4.09%** (`paragraph_rel_qshare`, real ~2.9%) and `reference` re-added to a plan.

---

## 2026-07-10 修复记录 (postfix, Batch 3)

**权威快照:** `scripts/research/baselines/paradigm-2026-07-10-postfix.json` (`reading_ap.gen`, n=88)。`Current:` 值全部取自该快照。旧世代题目已清 (`old_cohort` = 0)。

**已闭合的 gap:**
- **passage 过长** → mean **185.25** (real 181.09)；长尾 322w 已消。
- **insert_text 缺失** → `insert_text_qshare` **7.95%**；`QUESTION_PLANS` 现把 `insert_text` 排在 Q5（3/5 计划,≈60%,配 4 个 `[■]` 标记），并重新加回 `reference`。
- **paragraph_relationship 过量** → **4.09%** (was 13.6%)。
- **末句 However 收尾坍缩** (旧库 45.8%) → **`last_sent_however_rate` = 0%** (real 1.56%)。

**新机制 — `ENDING_MOVES`（`apPromptBuilder.js:45-50`, 硬指派轮换 `:118-122`）:** 结尾不再强制 limitation,改为 5 亚型轮换（limitation / application / research / outlook / synthesis）,其中 4 个亚型明写「NO 'However' in the final sentence」。快照:`last_sent_limitation_rate` **22.73%**（限制式收尾仅 ~1/5,real 3.13%,现略偏高但已非坍缩）。

**opener:** `opener_copula_rate` **29.55%**（real 23.44%）——直陈/定义式开头已到位,不再是 received-wisdom 模板。

---

## How the real items actually read (bottom-up)

A real 5-cluster follows a near-fixed **composition recipe**, not a free type draw:
- **~1 vocabulary** question, almost always with **single-word** answer choices ("distributing / acquiring / increasing / tracking").
- **~1 insert_text** question, **always last** (Q5), present in ~57% of clusters (likely more — see deferred). It needs the passage to expose **4 insertion markers [■]**.
- a middle of **factual_detail / inference / rhetorical_purpose / negative_factual**, occasionally **one reference** ("what does 'X' refer to?") or **paragraph_relationship** ("how does paragraph 3 relate to paragraph 2?").

The passage itself: **3 paragraphs (mode), ~190 words**, opening by **naming and defining its subject in sentence 1** ("Value theory investigates…", "Floating wind turbines are a special type of…", "Parallel algorithms, a computing method common in modern computers, solve…"). Body adds a mechanism/example paragraph, then a **forward-looking limitation move** ("However, … faces objections", "Despite these efforts, challenges remain") — never a summary conclusion. Topics skew **contemporary & applied** (AR, cybernetic prosthetics, quantum dots, smart textiles, urban resilience, generational identity) more than the classic natural-history canon.

---

## Dimensions

### D1 — Questions per passage · **solid**
- **Real:** **5** in 14/14 hand-read clusters. (The structured JSON's 1-5 spread is an extraction artifact — ignore it.)
- **Detector:** count single-question screens sharing one passage title within a module block (OCR).
- **Current:** 156/156 = exactly 5. **Gap: none** (the gap is in the TYPE mix below, not the count).
- **Maps to:** `buildAPPrompt` "exactly 5 multiple-choice questions"; `AP_PROFILE.questionsPerPassage = 5`.

### D2 — Passage word count · **solid** · ⚠ BIG GAP
- **Real (clean, n=39):** mean **182.5**, median **189**, min 71, max **209**, p10-p90 = 146-204. 74% fall in 180-220w; **nothing above ~210w**.
- **Detector:** whitespace word count; RIDL-leakage excluded by header/receipt/review regex.
- **Verbatim:** *Thinking Outside the Box* = 200w; *Value Theory* = 190w; *Augmented Reality for Training* = 175-203w.
- **Current (postfix):** mean **185.25** (`mean_words`, real 181.09). **Gap closed** — the 322w long tail is gone; passages now sit in the real 180-200w band. (Prompt/profile length targets were recalibrated off the stale "280-360".)
- **Target:** **150-210 words, center ~190.** Do NOT exceed ~210.
- **Maps to:** `buildAPPrompt` §1 Length ("Target 280-360 … Acceptable 200-440 … Do NOT cap at 250") and `AP_PROFILE.passageWordCount {min:150,max:400,target:250}` — **both must drop to ~150-210, target 190.** The "280-360" and "317.5 mean" comments are stale classic-TOEFL numbers.

### D3 — Paragraph count · **partial**
- **Real (OCR hand-read, n=14):** **3** paragraphs ×11, **4** ×3 → mode **3**, range 2-4. (JSON lost paragraph breaks — its `paragraphs` field is mostly 1 and unusable.)
- **Detector:** OCR paragraph breaks; cross-check hand-read.
- **Current:** 3-4 (mode 3). **Gap: small/none.**
- **Maps to:** `AP_PROFILE.paragraphCount {min:2,max:5,target:3}` — fine; tighten max to 4.

### D4 — Average sentence length · **solid**
- **Real (n=64):** mean **16.6** w/sentence, median 16.9, range 7.9-22.2.
- **Current (n=156):** mean **18.3**, max **29.2**.
- **Gap:** moderate — gen runs ~1.7w longer with a heavier tail (max 29 vs 22). Tracks the over-length passage problem; shrinking D2 will help.
- **Maps to:** `AP_PROFILE.sentenceCount` / difficulty notes ("longer complex sentences" for hard).

### D5 — Question-type distribution · **solid** · ⚠ BIGGEST GAP
- **Real (hand-coded, n=70):** factual_detail **22.9%**, inference **18.6%**, vocabulary **17.1%**, **insert_text 11.4%**, negative_factual **10.0%**, rhetorical_purpose **10.0%**, **reference 4.3%**, paragraph_relationship **2.9%**, sentence_select 1.4%, main_idea 1.4%.
- **Detector:** regex-classify stem (`closest in meaning`=vocab; `four locations / best fit`=insert_text; `refer to`=reference; `EXCEPT / NOT`=negative_factual; `why … mention / purpose of … paragraph`=rhetorical_purpose; `relate to / how does paragraph`=paragraph_relationship; `inferred / suggests`=inference; `main point`=main_idea; `identify the sentence`=sentence_select; `according to / what is`=factual_detail). Hand-validated against 14 clusters.
- **Verbatim examples:**
  - vocab — *"The word \"mitigate\" in the passage is closest in meaning to"*
  - insert_text — *"There are four locations [■] in the passage that indicate where the following sentence could be added… Where would the sentence best fit? Select a location to add the sentence to the passage."*
  - reference — *"What does \"its cautionary implications\" refer to in the passage?"*
  - negative_factual — *"Which of the following is NOT mentioned as a threat to coral reefs in the passage?"*
  - rhetorical_purpose — *"Why does the author mention the \"rarity and historical significance\" of natural diamonds?"*
- **Current (postfix):** **insert_text 7.95%** (`insert_text_qshare`, was 0%) and **paragraph_relationship 4.09%** (`paragraph_rel_qshare`, was 13.6%). **Both gaps closed.** (Full per-type mix not re-measured in the snapshot, but the two anchor defects are fixed.)
- **Gap:** (1) ~~insert_text missing~~ — **CLOSED** (7.95%, real 11.4%; still a touch low). (2) ~~paragraph_relationship over-produced~~ — **CLOSED** (4.09%, real 2.9%). (3) `reference` re-added to a plan; `sentence_select` remains rare/absent (not a staple in real either).
- **Maps to:** `QUESTION_PLANS` in `apPromptBuilder.js:63-65` — **now recalibrated**: `insert_text` is Q5 in 3 of 5 plans (≈60%), `reference` is in ≥1 plan, and `paragraph_relationship` was cut. Also `AP_PROFILE.questionTypeTargets` / `ETS_FLAVOR.distractorByQuestionType`.

### D6 — insert_text present & last · **solid** · ⚠ BIG GAP
- **Real (n=14):** insert_text present in **8/14 (57%)**; **8/8 it is the LAST question (Q5).** (The 6 without may be OCR-truncated last screens — true rate is plausibly higher; see deferred.)
- **Detector:** stem matches `four locations|best fit|could be added`; check index in the 5-cluster.
- **Verbatim inserted sentences (always a concrete extension of an existing point):**
  - *"And because of the controlled conditions in which they are produced, synthetic diamonds are actually preferred for industrial uses, such as in cutting tools and electronic devices."*
  - *"For example, Singapore's Intelligent Transport System incorporates artificial intelligence (AI) to predict real-time traffic conditions, effectively manage road congestion, and optimize routes."*
  - *"Imagine being able to change the appearance of your furnishings depending on your mood or the season."*
- **Current (postfix):** insert_text now present (`insert_text_qshare` **7.95%** of all Qs). **Capability shipped** — `QUESTION_PLANS` place `insert_text` as Q5 in 3/5 plans and the builder emits **4 `[■]` insertion markers** in those passages (`apPromptBuilder.js:140-156`).
- **Target:** generate an insert_text Q5 in ~60% of clusters; this **co-requires** the passage to expose **4 insertion slots** at paragraph/clause boundaries and a removable concrete-elaboration sentence.
- **Maps to:** `apPromptBuilder.js:63-65` (`QUESTION_PLANS` with `insert_text` Q5) + `:140-156` (Q5 slot-letter wiring + the "place exactly FOUR insertion markers `[■]`" passage rule). Was "new capability"; now implemented. See Correlation C2.

### D7 — Vocabulary per passage + option length · **solid**
- **Real:** exactly **1 vocab Q in 12/14 clusters**; vocab answer options mean **1.5 words** (median 1, max 6) — overwhelmingly **single words**.
- **Detector:** count `closest in meaning` stems per cluster; word-count their options.
- **Verbatim:** options *distributing / acquiring / increasing / tracking*; *strength / threat / knowledge / supervision*; *exploit / limit / distribute / release*.
- **Current:** vocab ~1/passage (count OK), but gen vocab options mean **2.9 words** (phrases).
- **Gap:** options too wordy — emit **single-word** synonyms for vocab items.
- **Maps to:** `apPromptBuilder` vocabulary_in_context block (add "answer choices should be single words / shortest possible phrases").

### D8 — Options per question · **solid**
- **Real:** 4 options in 205/207 JSON questions. **Current:** 780/780 = 4. **Gap: none.**

### D9 — Option word length (overall) · **solid**
- **Real:** non-vocab options mean **8.0w**; all-options mean 6.8w (min 1, max **25** — a real long boundary case: *"producing synthetic diamonds is less harmful to the environment than mining natural diamonds is"*, 14w).
- **Current:** non-vocab mean 7.8w; all-options 6.8w. **Gap: none on means.**

### D10 — Option-length spread within a question · **solid** · gap (reverse direction)
- **Real (n=205):** mean spread (max-min words) **2.6**, median **3**; only **69%** of questions have all four options within 3 words.
- **Current (postfix):** mean spread **1.7** (`option_spread_mean`, real 2.63). **Still off** — gen options remain too uniform (this dimension was not part of the paradigm fix). Real ETS tolerates a 3-4 word spread.
- **Gap:** gen options are **TOO uniform** (1.7 vs real 2.63). The OPTION LENGTH RULE ("within 2 words of each other") over-corrects — real tolerates 3-4 words. Over-uniformity is a synthetic tell. **Open — not addressed by the 2026-07-10 batch.**
- **Maps to:** `apPromptBuilder` "All 4 options MUST be within 2 words" and `ETS_FLAVOR.optionRules.optionLengthVarianceMax = 1.5` — **loosen to ~3-4 word spread**; keep only the "correct must not be the unique longest" guard.

### D11 — Correct-is-uniquely-longest rate · **partial**
- **Current (gen):** **18.1%** — under the 25% ceiling. Real not directly measurable (no answer key). **Gap: none** vs the inherited guideline.
- **Maps to:** `GENERATION_QUALITY_GATES.longestOptionIsCorrectMaxRatio = 0.40` / `ETS_FLAVOR.optionRules.correctIsLongestMax = 0.25`.

### D12 — Answer-position balance · **partial**
- **Current (gen, n=780):** A 26% / B 25% / C 25% / D 24% — near-uniform. Real position bias **deferred** (no answer key). **Gap: none.**
- **Maps to:** the pre-assigned balanced positions in `buildAPPrompt`.

### D13 — Passage opening strategy · **solid** · ⚠ BIG GAP (wrong target inherited)
- **Real (unique, n=42):** **direct topic/definition statement dominant**; explicit definition openers (refers to / investigates / is a …) ≥9, plus ~32 direct topic statements; **received-wisdom-then-revision = 1/42**.
- **Detector:** classify sentence 1 — definition markers vs received-wisdom openers (Traditionally / Historically / While early…).
- **Verbatim:** *"Value theory investigates the nature of values and the principles that determine what is worth pursuing…"*; *"Urban green spaces, such as parks, gardens, and green roofs, provide numerous benefits to cities."*; *"Parallel algorithms, a computing method common in modern computers, solve problems faster by dividing a task into smaller parts that run at the same time."*
- **Current (postfix):** `opener_copula_rate` **29.55%** (real 23.44%) — direct topic/definition openers ("X is a…", "X investigates…") are now in place; the received-wisdom template no longer dominates.
- **Gap:** **largely closed** — gen now opens direct-topic/definition close to the real rate. (The stale `openingStrategies.received_wisdom_then_revision = 0.46` profile constant should still be verified/lowered so it can't seed a regression.)
- **Maps to:** `ETS_FLAVOR.passageStructure.openingStrategies`; `apPromptBuilder` structure rules.

### D14 — First sentence defines the subject · **solid**
- **Real (n=64):** **1.23** definition patterns/passage; the defined term is usually the topic itself, often in paragraph 1.
- **Current:** **2.1**/passage — over-produced.
- **Gap:** real introduces ~1 defined term; gen stuffs ~2. Mild over-cooking.
- **Maps to:** `apPromptBuilder` "Include 1 defined term using appositive or 'known as'" (keep at 1) and `ETS_FLAVOR.definitionPatternsPerPassage = 1.4`.

### D15 — Hedging density · **solid** · gap
- **Real:** **1.03** hedges/passage. **Current:** **2.94** (~3×).
- **Detector:** count may/might/could/appear/seem/suggest/tend/often/generally/likely/perhaps/possibly/potentially.
- **Verbatim real:** *"this could be attributed not to generational identity but to life-stage effects"*; *"some assumptions merit scrutiny"*.
- **Gap:** gen over-hedges, and over a shorter passage the density is even higher. Real concentrates hedging in the final limitation move.
- **Maps to:** `apPromptBuilder` "Include 1-2 hedging words" (fine as written; generation overshoots) and `ETS_FLAVOR.hedgeRatio = 0.0093`.

### D16 — Contrast-transition density · **solid** · gap
- **Real:** **1.09** contrast transitions/passage. **Current:** **2.29** (~2×).
- **Detector:** count however/although/though/while/yet/despite/nevertheless/nonetheless/whereas/conversely.
- **Verbatim real:** *"However, this theory faces objections."*; *"Despite these efforts, challenges remain."*
- **Gap:** real has ONE strong pivot near the limitation move; gen sprinkles them.
- **Maps to:** `apPromptBuilder` "Include 1-2 contrast transitions"; `ETS_FLAVOR.transitionsPerPassage = 8.5` (the 8.5 is a stale long-passage number). **Note (2026-07-10):** the *last-sentence* However-collapse (a separate, worse symptom) was fixed by `ENDING_MOVES` — `last_sent_however_rate` is now **0%** (real 1.56%); overall per-passage contrast density (2.29 vs 1.09) was not separately re-measured in the postfix snapshot.

### D17 — Passive-voice density · **solid** · small gap
- **Real:** **0.10** passives/sentence. **Current:** **0.19** (~2×).
- **Gap:** prompt mandates "passive voice in at least 1 sentence" (fine); gen overshoots. Note `ETS_FLAVOR.passivePerSentence = 0.23` is the stale classic-TOEFL number; real 2026 = 0.10.

### D18 — Lexical register · **solid** · small gap
- **Real (n=64):** avg word length **5.63**, long-word(≥7) ratio **0.371**, lexical density **0.709**.
- **Current (n=156):** 5.88 / 0.404 / 0.704.
- **Gap:** gen slightly heavier (long-word ratio 0.404 vs 0.371); density matches. Gen leans a touch more "dense academic" than real.
- **Maps to:** `ETS_FLAVOR.avgWordLength / longWordRatio / lexicalDensityTarget`.

### D19 — Topic diversity & flavor · **partial** · gap
- **Real (unique, n=42):** **39 distinct free-text topics** (~1:1); skewed to **contemporary applied** subjects (computing, materials, biotech, urban/social systems).
- **Current (gen, n=156):** top 5 categories (biology / environmental_science / history / psychology / geology) = **114/156 = 73%** of the bank.
- **Detector:** count distinct topic labels; inspect for applied-vs-natural-history skew.
- **Verbatim real topics:** Value Theory, Plant Communication, Augmented Reality for Training, Radio Astronomy, The Flynn Effect, Sociocybernetics, Floating Wind Turbines, Parallel Algorithms, Quantum Dots, Cybernetic Prosthetics, Generational Identity, Twin Stars.
- **Gap:** gen over-concentrates on the classic natural-history canon; under-represents applied tech / social science. `TOPIC_POOL` already lists 14 topics, but the 5-topic concentration persists — diversify selection and weight applied/contemporary topics up.
- **Maps to:** `TOPIC_POOL` and the topic-selection loop in `buildAPPrompt`.

### D20 — Difficulty markers · **solid** (see Correlation C1)
- Real difficulty rides on **abstraction + density + question-type mix**, NOT passage length. Hardest real passages (Value Theory, Space Debris, Generational Identity) are all ~180-200w but philosophically/technically dense, paired with inference/reference/EXCEPT and longer option text. Easy ones (Plant Communication, Coral Reef) are concrete process descriptions with factual_detail.
- **Maps to:** `apPromptBuilder` difficulty notes — **stop equating "hard" with longer passages**; make "hard" = more abstract topic + more inference/reference/negative questions, while keeping ~190w.

---

## Correlations

- **C1 — Difficulty = abstraction + density, not length.** All real passages cluster at ~190w regardless of difficulty. Control difficulty via topic abstraction and question-type mix; do not lengthen the passage to make it "hard." (The current prompt's "HARD → longer complex sentences" pushes the wrong lever.)
- **C2 — insert_text and passage design are one dimension.** The Q5 insert_text question co-requires the passage to expose **4 candidate insertion points [■]** at paragraph/clause boundaries, plus a removable concrete-elaboration sentence ("And because…", "For example, Singapore's…", "Imagine being able to…"). You cannot add the question without redesigning the passage to carry markers — build them together.
- **C3 — The 5-cluster has a composition recipe.** ~1 vocabulary (single-word options) + ~1 insert_text (last) are the two ANCHOR slots; the middle 3 vary among factual_detail / inference / rhetorical_purpose / negative_factual, with occasional reference or paragraph_relationship. Expect 3-4 distinct types per set (matches `minQuestionTypeDiversity = 3`).
- **C4 — Over-regularity is the synthetic tell.** Individually small gaps compound: gen options are too uniform (spread 1.6 vs 2.6), lexis slightly heavier, and hedging/contrast/passive run 2-3×. The net effect is a "too smooth / too academic-template" read. Loosening option spread and dialing hedging/contrast/passive back toward real per-passage rates matters as much as any single fix.

---

## Deferred / needs more data

- **Real answer-position bias** — structured JSON has no answer key and OCR option order is unreliable; cannot compute real A/B/C/D correct-answer distribution. Keep gen's near-uniform balance as the target.
- **Real correct-is-longest rate** — no real answer key; the ≤25% target is the inherited `ETS_FLAVOR` guideline, not a measured 2026 number (gen 18.1% presumed OK).
- **Distractor trap-logic shares** (opposite / not_mentioned / wrong_detail / misquoted / too_narrow …) — needs correct answer + per-distractor semantic labeling against the passage; not machine-extractable here and not hand-labeled at scale. `apPromptBuilder`'s per-type distractor *recipes* look directionally right; the SHARE numbers in `AP_PROFILE.distractorPatternTargets` are unverified for 2026.
- **sentence_simplification type** (classic TOEFL "which sentence best expresses the essential info of the highlighted sentence") — NOT seen in any of the 14 hand-read 2026 clusters; treat as absent/rare, do not generate as a staple. (A related SELECT-IN-PASSAGE "identify the sentence that…" type *was* seen once — sentence_select.)
- **Exact insert_text frequency** — 8/14 clusters had it as Q5, but the 6 without may be OCR-truncated last screens, so the true rate is plausibly higher than 57% (possibly ~1/passage). Target set conservatively; revisit with more clean clusters.
