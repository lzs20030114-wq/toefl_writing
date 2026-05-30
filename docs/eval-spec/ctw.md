# Evaluation Spec — Reading · Complete the Words (`ctw`)

**Ground truth:** `data/realExam2026/reading/completeTheWords.json` — 75 cloze paragraphs (recalled 2026改后, tier=recalled, `source_kind=ocr`). 55 are unique by topic (20 are repeats of recurring passages across exam dates). Blanked words recovered from the answer keys in `.codex-tmp/exam_txt/*答案*.txt` / `*参考答案*.txt`: **48 unique passages with full clean 10-word blank lists = 481 real blanks** (3 OCR-garbled answer lists dropped; the rest of the 51 raw answer-key blocks were either fragment-OCR or duplicate passages).
**Current generated bank:** `data/reading/bank/ctw.json` — 191 items (`passage`, `blanks[]`, `word_count`, `topic`, `subtopic`, `difficulty`, `blanked_text`). ⚠ 25/191 items are missing the `blanks[]` array entirely (data-integrity bug — see D11).
**Generation profile/prompt:** `lib/readingGen/ctwPromptBuilder.js` (writes the passage only) + `lib/readingBank/readingEtsProfile.js` (`CTW_PROFILE` + `ETS_FLAVOR.ctwBlankProfile`). Blanker: `lib/readingGen/cTestBlanker.js` (mechanical). Difficulty: `lib/readingGen/ctwDifficulty.js`. Validator: `lib/readingGen/ctwValidator.js`.

> **The task & where quality lives.** The test-taker reads a short passage in which the first sentence is intact, then every-other-word in the body has its second half deleted (a *C-test*); they type the missing letters. **Blanking is 100% mechanical and is already implemented correctly** (see D7 — the `floor(len/2)`-shown rule matches the real exam OCR 17/19 = 89%, the misses being OCR artifacts). Therefore the AI's *only* lever is the **passage text**: its length, sentence rhythm, and — above all — the lexical richness of the words that happen to fall in even (blanked) positions. Everything that makes a CTW item feel real or synthetic flows from the passage, not from the blank algorithm.

---

## How the real items actually read (bottom-up)

Every authentic CTW paragraph has the same three-part **shape**, dictated by the C-test rule interacting with a ~70-word, 4–5-sentence passage:

1. **Intact topic sentence** (sentence 1, ~17 words) — a clear, sometimes sophisticated definition/claim. *"Glaciers are massive, slow-moving bodies of ice that form in areas where snow accumulates over time and compresses into ice."*
2. **The blanked body** (sentences 2–3) — the 10 blanks land here, ~20–22 words deep. *"Th__ [They] can cha__ [change] landscapes thr__ [through] processes li__ [like] erosion a__ [and] deposition. A__ [As] glaciers mo__ [move], they ca__ [cut/carve] out val__ [valleys] and fjords, lea__ [leaving] behind…"*
3. **Intact tail** (sentences 4–5) — fully un-blanked, gives closure. *"Scientists study glaciers to understand past climate conditions… impacting coastal communities worldwide."*

Traced precisely on Grasshoppers (`2026-03-16_ctw2`): S1 intact → S2 holds 4 blanks (have, ways, protect, against) → S3 holds 6 blanks (they, powerful, legs, allow, to, away) → S4+S5 fully intact. This **"10 blanks packed into sentences 2–3, intact bookends front and back"** is the signature. A 3-sentence / 56-word passage (the generator's center of mass) cannot produce it — it has no intact tail, so the blanks run to the very end and the item reads thinner than a real one.

The single most important contrast: the generator was tuned to a "popular-science, CEFR A2–B1, average word length 4.5–5.5, no *fundamental*/*sophisticated*" target. **The real exam is markedly richer**: ~70–72 words (gen 56), first sentences averaging 5.89-char words with 39% long words (gen 5.09 / 25%), and blanks that routinely include B2–C1 academic vocabulary — *advantageous, characterized, conversely, systematically, redistribute, frequency, populations, eruptions, vegetation, encompass*. The current validator would **reject 9/48 (19%) and warn on 26/48 (54%) of real exam passages** as "too many rare blanks." The generator is calibrated easier than the test.

---

## Dimensions

### D1 — Blank count per passage · **solid**
- **What:** number of deleted words. The C-test rule produces exactly 10.
- **Real:** **exactly 10** in 48/48 unique passages (the answer keys are numbered 1–10 per passage, 1–20 when two passages share a module). No variation.
- **Detector:** `blanks.length` / count of numbered fill tokens per passage segment.
- **Current:** 166/191 = 10; **25/191 have no `blanks` array** (missing/undefined). **Gap: data-integrity — 13% of bank is un-blanked.** (D11.)
- **Maps to:** `cTestBlanker.applyBlanking` (`blanks.length < 10` → error); `CTW_PROFILE.blankCount = 10`.

### D2 — Passage length (words) · **solid** (real undercount corrected)
- **What:** total words in the passage.
- **Real:** OCR whitespace-token mean **69.3** (median 71, range 31–94, sd 12.7). OCR *undercounts* because it glues words ("totra", "fora", "incaves"); a glue-repair estimate puts the true mean at **~71.8** (worst cases +11 to +15 words). Treat **~70–72 words, 4–5 sentences** as the target; the bulk sit 60–85. The 31-word floor and a few <50 are truncated partial-recalls, not real short passages.
- **Verbatim (intact, well-OCR'd):** Glaciers `2026-01-21_ctw2` (~78w); Crop rotation `2026-02-23_ctw1` (~68w); Tigers `2026-03-06_ctw2` (~62w).
- **Detector:** `passage.trim().split(/\s+/).length`; for real, also a glue-repair estimate (split tokens >12 chars / internal-caps).
- **Current (n=191):** mean **56.3**, median 57, range 45–80, sd 7.9. Distribution: 45–50 ×51, 50–60 ×74, 60–70 ×56, 70+ ×10. **Gap: generated runs ~15 words too short and never reaches the real 85–94 top.** The prompt itself flags this ("generator tends to UNDERSHOOT … averaged only 56 words"). The shortfall is what kills the intact-tail shape (D6).
- **Maps to:** `ctwPromptBuilder` "65–78 words, hard min 62"; `CTW_PROFILE.passageWordCount {min45,max100,target70}`; validator `wc < 45` error / `> 120` warn (so the validator does not actually enforce the 62-word floor — the prompt asks for it but nothing rejects a 50-word passage).

### D3 — Blank POS mix: function vs content words · **solid**
- **What:** of the 10 blanked words, share that are function words (det/prep/pron/conj/aux/etc.) vs content words.
- **Real (481 blanks):** **33.9% function / 66.1% content.** Per-passage distribution centers on **3 function words** (mode 19/48 passages = 3 fn; 2 fn ×9, 4 fn ×12, mean 3.4/10). Almost never <2 or >6 function blanks.
- **Verbatim:** Camels `in[F] desert[C] have[F] travel[C] long[C] without[F] any[F] or[F] so[F] camels[C]` (6 fn / 4 C); Sanitation `sewage[C] and[F] water[C] developed[C] the[F] awareness[C] connection[C] poor[C] illness[C] spread[C]` (2 fn / 8 C — boundary, content-heavy).
- **Detector:** lowercase blank word ∈ FUNCTION set (closed-class list). Hand-validated on 5 passages — exact match to my reading.
- **Current (1660 blanks):** **38.2% function / 61.8% content.** Slightly function-heavy vs real. **Gap: small (+4pp function) but in the wrong direction** — the prompt's "INTERESTING vocab in visible positions, COMMON vocab in blanked positions" rule biases blanks toward easy function words; the real exam blanks *more content* words.
- **Maps to:** `ETS_FLAVOR.ctwBlankProfile.functionWordRatio = 0.35` (≈ right); prompt §"C-TEST WORD FREQUENCY CONSTRAINT" ("≥7/10 blank-position words should be COMMON … put rare words at ODD positions").

### D4 — Blank word length · **solid**
- **What:** character length of each blanked word (drives how much is shown and how hard it is to complete).
- **Real:** mean **5.77**, median 5, range 2–14. Buckets: 2–3ch 23%, 4–5ch 28%, 6–7ch 23%, 8–9ch 14%, 10+ch 11%. **25.6% of blanks are ≥8 chars = 2.56 long blanks per passage.**
- **Detector:** length of letters-only blank word; bucket histogram; count ≥8.
- **Current:** mean **5.13**, median 5; **only 15.2% ≥8 chars = 1.32 long blanks per passage.** **Gap: generated blanks are ~0.6 chars shorter and have roughly half the long-word density of the real exam.** Direct consequence of the simpler passages (D8).
- **Maps to:** `CTW_PROFILE.blankAvgLength {target 5.5}` & `ETS_FLAVOR.ctwBlankProfile.avgBlankWordLength = 5.5` (targets are ~right; the *generator* misses them low); validator `maxLongBlanks = 3` + warns at avg >7.5 (the cap is consistent with real, but combined with short passages it pushes generation toward the easy floor, not the 5.77 real mean).

### D5 — Fragment ratio (how much of the word is shown) · **solid** · *fully determined by D4 + the rule*
- **What:** shown letters ÷ word length. Rule: `floor(len/2)` shown.
- **Real:** mean **0.453** (range 0.33–0.50, since floor(len/2)/len → 0.5 for even, →0.33–0.49 for odd). **22.9% of blanks show ≤1 letter** (len ≤3 words like "as", "is", "to", "and"→"an"), which are the high-ambiguity blanks.
- **Validation:** the `floor(len/2)`-shown rule matches the literal OCR fragment on 17/19 hand-paired cases (change→cha, through→thr, like→li, valleys→val, population→popul, increase→incr, powerful→powe, legs→le, allow→al…). The 2 misses are OCR truncation artifacts. **The blank-display mechanic is confirmed correct.**
- **Detector:** `floor(len/2)/len` per blank; share with floor(len/2) ≤ 1.
- **Current:** mean ratio ~0.45 (same rule); **27.7% show ≤1 char** vs real 22.9%. **Gap: generated has slightly more 1-letter-fragment (ambiguous) blanks**, because it blanks more short function words (D3). Validator already warns at ≥4 single-char fragments/passage.
- **Maps to:** `cTestBlanker.computeFragment` (`Math.floor(len/2)`); `CTW_PROFILE.fragmentRatio {mean 0.4}` — note the stored target 0.40 is slightly **below** the true 0.453 (cosmetic; the rule is what matters).

### D6 — Passage shape: intact head + blanked body + intact tail · **solid** (derived structurally + hand-traced)
- **What:** where the 10 blanks fall. Real shape = S1 intact, 10 blanks packed into sentences 2–3, sentences 4–5 fully intact.
- **Real:** hand-traced on Grasshoppers, Glaciers, Art+Religion, Camels: in every case the 10 blanks occupy ~20–22 words inside sentences 2–3, and ≥1 trailing sentence is fully intact. With a 70-word / 5-sentence passage, 10 every-other-word blanks (~21 words) cannot reach the last sentence(s) → guaranteed intact tail. *(A direct OCR detector for "which sentence is blanked" is unreliable because OCR glue mimics fragments — measured structurally instead.)*
- **Detector:** structural — `(passage_words − sentence1_words) ÷ 2 ≥ 10` *and* the cumulative word index of the 10th blank ends before the final sentence boundary. Equivalent: a 70-word/5-sentence passage yields it; a 56-word/3–4-sentence one does not.
- **Current:** mean 56 words / 4.3 sentences, mean first sentence 12.9 words → blanks frequently run into the final sentence; **no reliable intact tail.** **Gap: the generator's short passages structurally cannot reproduce the real intact-bookend shape.** This is the qualitative "feels synthetic" gap and is downstream of D2.
- **Maps to:** `ctwPromptBuilder` "4–5 FULL sentences", "sentences 2–5 combined need ≥20 words" (necessary but not sufficient — needs the *tail* to survive un-blanked, i.e. ≥70 words).

### D7 — First (topic) sentence richness · **solid**
- **What:** the always-intact sentence 1 — length and lexical level. It is the reader's only fully-given context, so its register sets the passage's feel.
- **Real (55 unique, intact → reliable):** mean **16.7 words**; avg word length **5.89**; **38.9% long words (≥7ch)**; ~4.0 abstract-noun-suffix words per 100. Often a formal definition: *"Human cognition refers to the mental processes involved in acquiring, processing, storing, and using knowledge."* / *"Oceanography is the study of the physical, chemical, and biological aspects of the ocean."*
- **Detector:** sentence-1 word count; avg char length; ≥7-char share.
- **Current:** mean **12.9 words**; avg word length **5.09**; **25.5% long words.** **Gap: generated topic sentences are ~4 words shorter and lexically a full register simpler.** The prompt's "average word length 4.5–5.5" instruction is **below** the real 5.89 and directly produces this gap.
- **Maps to:** prompt §"First sentence" ("interesting, clear topic sentence" — no length/richness floor) and §Register ("Average word length should be 4.5-5.5 characters" — **mis-calibrated low**; real is 5.7–5.9).

### D8 — Blank difficulty / vocabulary ceiling · **partial** (direction solid; absolute "rare" inflated by an incomplete word list)
- **What:** how hard the blanked words are (frequency tier + length).
- **Real (481 blanks):** by the project's own `ctwDifficulty` sets — easy 49.3% / medium 7.7% / **rare 43.0%**, mean blank score **3.65/10**, **4.31 rare blanks/passage, 73% of passages have >3 rare blanks.** ⚠ The 43% "rare" is **inflated**: the EASY/MEDIUM word lists omit ordinary words (*like, blue, loss, desert, eggs, colony, tiny, usually, any*), so genuinely-common blanks get mislabeled rare. The *length-based* signal is list-independent and solid: real blanks are longer (D4) and the true B2–C1 ceiling is real — verbatim hard blanks: **advantageous, characterized, conversely, fundamental, geological, acquisition, systematically, redistribute, vegetation, eruptions, frequency, perceive, encompass, populations**.
- **Detector:** `ctwDifficulty.scoreBlank` + freq-class via `wordInSet(EASY/MEDIUM)`; per-passage rare count.
- **Current:** easy 62.7% / medium 4.0% / **rare 33.3%**, mean score **2.85/10**, **2.90 rare/passage, only 35% of passages have >3 rare.** **Gap: generated is a clear notch easier — fewer and shorter hard blanks.** And the *validator* (`rareRatio>0.5`→reject, `>0.3`→warn; using the same incomplete list) would reject 9/48 and warn on 26/48 **real** passages, i.e. it is stricter than the exam and actively suppresses authentic difficulty.
- **Maps to:** `ETS_FLAVOR.ctwBlankProfile {easyBlankRatio 0.50, maxRareWordRatio 0.20}`, `CTW_PROFILE.blankWordFrequency {easy.50,medium.30,hard.20}`; validator `too_many_rare_blanks` gate; prompt §Vocabulary ("CEFR A2–B1 base, 1–2 B2 max, NO meticulously/sophisticated/fundamental"). **All three under-shoot the real ceiling** and should be loosened (and the EASY/MEDIUM lists expanded so the gate stops flagging common words).

### D9 — Blank morphology (inflection mix) · **solid**
- **What:** share of blanks that are inflected (-ing / -ed / -ly) vs simple/root forms.
- **Real:** **-ing 4%, -ed 3%, -ly 2%, plural -s 17%.** ~91% are simple root or plural forms; inflected verb forms are rare at blank positions.
- **Detector:** suffix match on blank word.
- **Current:** -ing 2%, -ed 3%, -ly 2%. **Gap: negligible** — both match `ETS_FLAVOR.ctwBlankProfile.simpleFormRatio = 0.85`. (Real plural -s slightly higher; not material.)
- **Maps to:** `ETS_FLAVOR.ctwBlankProfile.simpleFormRatio = 0.85` (accurate).

### D10 — Topic / domain distribution · **solid**
- **What:** subject mix across passages.
- **Real (55 unique):** environmental/climate **29%** (climate change, weather, clouds, ocean currents, crop rotation, sanitation, sustainability), history/anthropology **15%** (pottery, Middle Ages, South Pacific, bone tools, bicycle), geology/earth **13%** (glaciers, tectonics, fossils, extinctions), biology-animals **13%** (camels, tigers, grasshoppers, macaw, tortoise, spider silk, insects), psychology/cognition **9%**, arts/culture 5%, human-body/biochem 5%, biology-plants 5%, economics 4%, astronomy/space 2%. **Skews concrete & earth/life-science; abstract domains (econ, pure physics/chem) are rare.**
- **Detector:** keyword classifier over the passage; dedupe by first-sentence.
- **Current (191):** environmental_science 31, biology 31, psychology 25, geology 25, astronomy 22, history 22, anthropology 11, technology 10, art 7, sociology 5, physics 1 (+ 2 mis-keyed buckets). **Gap: roughly aligned on the big buckets, but generated over-weights astronomy (12% vs real 2%) and under-weights the environmental/earth-life cluster that dominates the real exam (~55% combined real vs ~45% gen).** Topic realism itself is fine — the *subjects* (glaciers, camels, photosynthesis) are exactly the kind the real exam uses.
- **Maps to:** `ctwPromptBuilder.TOPIC_POOL` (12 topics, evenly cycled — hence astronomy is over-represented vs the real exam's environmental skew); `CTW_PROFILE.topicDiversityMin = 4`.

### D11 — Bank integrity: every item must carry its blanks · **solid** (generated-side defect)
- **What:** each stored item should have a 10-element `blanks[]` array (so the app can render the cloze).
- **Real:** N/A (ground truth).
- **Current:** **25/191 items have `blanks` undefined / missing**, and `blank_count` is `undefined` for them. These cannot be served as cloze items. **Gap: ~13% of the bank is unusable.** Likely passages that failed `applyBlanking` (too few words / too many 1-letter words → fewer than 10 blanks) but were retained without blanks.
- **Detector:** `Array.isArray(item.blanks) && item.blanks.length === 10`.
- **Maps to:** `cTestBlanker.processPassage` (returns error when <10 blanks) — the pipeline should drop these, not store them.

---

## Correlations

1. **Length → difficulty is *indirect*, mediated by lexical richness, not word count.** Within the generated bank, passage word-count vs mean blank length is essentially flat (r = **−0.16**) and vs rare-blank count r = **+0.09**. Because blanking is mechanical, you do **not** get harder blanks just by writing longer; you get them by writing a *lexically richer* passage so that the even-position words are themselves substantial. The real exam achieves its 5.77-char / 25.6%-long-blank profile (D4) precisely because its passages are richer (D7: 5.89-char first sentences, 38.9% long words), not because they are long. **Lever for generation: raise passage lexical level (D7/D8), not just word count.**

2. **Passage length gates the authentic *shape*.** Length (D2) and the intact-tail shape (D6) are causally linked: a passage must exceed ~65–70 words / 5 sentences for the 10 every-other-word blanks to stop before the final sentence and leave an intact tail. The generator's 56-word center of mass simultaneously explains the short-passage gap (D2), the missing tail (D6), and part of the easy-blank gap (D8) — they are one root cause: **the passage is too small and too plain.**

3. **Function-word share, single-char fragments, and easiness co-vary.** Passages that blank more function words (D3) automatically produce more ≤1-letter fragments (D5) and lower blank difficulty (D8). The prompt's explicit "put common words in blank positions" instruction is the upstream cause of all three drifting easy together; the real exam's 34% function / 66% content split with longer content blanks is the target to hit.

---

## Deferred / needs more data

- **Per-blank context predictability / ambiguity** (can the missing word be uniquely recovered from context?) — not measurable from word lists alone; would require rendering each blank in its sentence and a solvability check. The ≤1-letter-fragment rate (D5, real 22.9%) is the best available proxy.
- **Exact "which sentence is blanked" per passage** — measured structurally and hand-traced (D6) but **not** machine-countable from the OCR, because OCR glue produces false fragment tokens inside intact sentences. Marked partial; relied on close reading of 4 items.
- **True passage word-count for the real bank** — OCR undercounts (glued words). Corrected via a glue-repair *estimate* (~71.8 mean) rather than an exact count; the per-item true length is approximate. The 31-word minimum and a handful of <50-word "passages" are **truncated partial recalls**, not genuine short items — exclude from any min-length target.
- **Absolute easy/medium/rare blank percentages (D8)** — the *direction* (real harder than gen) is solid and dictionary-independent (confirmed by D4 lengths), but the absolute 43%-rare figure is inflated by gaps in `ctwDifficulty`'s EASY/MEDIUM word lists. A clean frequency tier would need an external frequency list (e.g., SUBTLEX / COCA band) rather than the hand-maintained sets.
- **First-sentence opening-strategy taxonomy** (definition vs claim vs "X is the study of…") — visible in the data (definitions dominate) but not yet quantified into target ratios; lower priority than D2/D7/D8.
