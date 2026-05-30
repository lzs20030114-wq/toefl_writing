# Evaluation Spec — Writing · Build a Sentence (`bs`)

**Ground truth:** `data/realExam2026/writing/buildSentence-targets.json` — **504 answer sentences** (341 unique; many dates re-use an item across A/B/C卷), tier = **recalled** (2026改后机经, OCR + DeepSeek-structured). Joined half: `data/realExam2026/writing/buildSentence.json` — **363 items** carrying `prompt_context` + `scrambled_ocr` (the on-screen conversational prompt + jumbled word-pool, both OCR-noisy).
**Raw, highest-fidelity source for the UI-level dimensions** (prompt stem / prefilled / distractor / chunk tiles): `.codex-tmp/ocr/*写作*.txt` (39 writing-screen OCRs) and **rendered PNGs** of 6 writing PDFs at zoom 3.5 (`.codex-tmp/bs_render*/`). These rendered screens are the ground truth for prefilled & distractor — the structured JSON loses prefilled and the scrambled OCR adds garbage tiles.
**Current generated bank:** `data/buildSentence/questions.json` — 86 sets × 10 = **860 items**.
**Generation prompt/profile:** `lib/bsGen/prompts.mjs` → `genPrompt(round, existingAnswers)`; numeric calibrations mirrored in `lib/questionBank/etsProfile.js` (`ETS_STYLE_TARGETS`, `ETS_DIFFICULTY_*`, `TPO_REFERENCE_PROFILE`, `PREFILLED_PROFILE`).
**Measurer:** `scripts/research/bs_measure.mjs` — every detector hand-validated against the recalled items AND the rendered screens; `--dump <dim>` prints per-item output. Iron rule applied: the direct-question detector first conflated "Do you know if…" (a *question-form sentence with an embedded clause*) with plain direct questions; I split the type space into 4 orthogonal classes and re-validated against the 2.8/2.23/2.25 sets read in full → detector fixed, not the number.
**Reliability of inputs:** answer-sentence text / length / sentence-type / negation / relative / passive / register markers = **solid** (504 structured targets, detectors validated). Prompt-stem you/your, ends-?, opener mix = **solid–partial** (363 items; 298 cleanly parsed, 84 too OCR-garbled to classify). Prefilled (presence/position/word-count) = **partial** (OCR layout is noisy; anchored to 14 hand-read rendered items + 40 clean OCR blocks). **Distractor absence** = **solid for the recalled tier** (0 across 14 rendered items from 6 exams) but see Deferred for the official-tier caveat. Chunk multi-word ratio for the *real* bank = **deferred** (cannot recover true tile boundaries from OCR reliably).

> **The task:** a two-person chat screen. Speaker 1 (an avatar) says one conversational line — usually a question addressed to **you** ("Why didn't you go to class yesterday?") or a first-person setup ("I signed up for the painting class next week."). Below, the test-taker's reply bubble is a row of **blank slots** with **one or two words already filled in** (the *prefilled* anchor — a start fragment, a mid word, and/or an end tail like "canceled." or "favorite spot."). A pool of **draggable word-tiles** sits underneath; the student orders them into the blanks to form the one grammatical reply. The instruction is the constant **"Make an appropriate sentence."** The item's job: a natural, short, conversational reply whose words have exactly one valid arrangement.

---

## How the real items actually read (bottom-up)

Reading ~60 items off the rendered screens plus a stratified 90+ of the 504 targets, five things define the real BS item — and four of them are where the generator drifts:

1. **It is campus small-talk, in the first person.** **62.8%** of real prompt+pool text is academic/campus (class, lecture, professor, assignment, workshop, library, roommate); **0.3%** is office/workplace. The reply is a student speaking casually about themselves: **40% start with "I/I'm/My"**, **23% contain a contraction**, **10% open with "Yes,/No,/Sorry,/Unfortunately,"**. The generated bank instead manufactures bureaucratic third-person personas — "The store manager…", "The project supervisor…", "The frustrated customer…" (**6.6% formal 3P subjects vs real 0.4%**) — in a flat, formal register (only 7.8% contractions, 0.3% casual openers).

2. **There is NO distractor tile.** Across **14 items rendered from 6 different exams**, every single word-tile maps into the answer — there is no extra "trap" word. (The "did/oing/Qing/op/p!p" fragments in the OCR are UI-chrome and OCR garbage, not tiles.) The generated bank puts a distractor on **89%** of items, and **160 of them are the single word "did"** — a pattern the real recalled exam simply does not show. *This is the single largest structural gap.*

3. **The dominant sentence is a polite indirect request built as a question.** The signature pattern — **"Do you know if/whether/when …?"** and **"Can you tell me whether/if …?"** — is **17.3%** of all answers (87/504) and is the most distinctive real-exam fingerprint. These are *question-form* (inverted main clause, terminal "?") but carry an *embedded* sub-clause in declarative order. Overall: 58% pure statements, 17% question-with-embedded-clause, 17% plain direct questions, 6% declarative-indirect ("she wanted to know when…", "I don't know who…").

4. **Replies are short.** Mean **9.2 words** (median 9), and **24.6% are ≤7 words** ("it wasn't available online", "which brand are you considering", "I have a conflicting appointment"). The generator runs long (mean **10.7**, median 11) and produces **0.8% short/easy** items — it chronically over-complexifies.

5. **The prefilled anchor is rarely the subject, and is often an END tail.** Real prefill is a start fragment ("She wanted", "Can you", "It has", "I just read"), a mid word ("know", "you", "which", "decided"), and/or a sentence-final tail with punctuation ("canceled.", "favorite spot.", "seafood dishes.", "classmate?", "be?", "yet."). ~21% of items show **two** anchors (start + end). The generator's prefill is almost always a single start segment (1.1% multi-segment).

The relative-clause "the one that…/a place where…" answer is also a real signature (**18.5%**) that the generator barely produces (**2.7%**).

---

## Dimensions

### D1 — Answer length (words) · **solid** · ⚠ TOP-3 GAP (tied)
- **Real (n=504):** mean **9.16**, median **9**, min 4, max 15. Distribution peaks 8–10 words; a fat short tail (5–7w = 24%).
- **Detector:** whitespace word count of the answer, punctuation stripped. `--dump types` shows each with its class.
- **Verbatim real:** short — `"it wasn't available online."` (4w) · `"which brand are you considering?"` (5w) · `"I have a conflicting appointment."` (5w); mid — `"I do not usually go to those events."` (9w); long — `"my professor also asked me how I was able to complete it ahead of time"` (14w).
- **Current (n=860):** mean **10.68**, median **11**, min **7**, max 15. The whole distribution is shifted ~1.5w right; it **never produces a 4–6 word answer** (real has 72 such items, 14%).
- **Gap:** gen is too long and too uniform. Real has a real short band; gen's floor is 7w.
- **Maps to:** prompt *"answer (6-13 words, concentrated 8-10)"* and *"mean ~9 words"* — the mean target is right but the **6-word floor is too high; allow 4–5 word answers** and pull the center down. `TPO_REFERENCE_PROFILE.avgAnswerWords = 9.4` is close (real 9.16); the generator is not hitting it.

### D2 — Difficulty mix (length proxy) · **solid**
- **Real (n=504):** easy(≤7w) **24.6%** · medium(8–11w) **59.5%** · hard(≥12w) **15.9%**.
- **Detector:** word-count bands ≤7 / 8–11 / ≥12 (a proxy; true difficulty also depends on structure — see correlations).
- **Current:** easy **0.8%** · medium **71.0%** · hard **28.1%**.
- **Gap:** gen produces **~1% easy vs 25% real** and **2× the hard** band. It over-complexifies on both ends.
- **Maps to:** `ETS_DIFFICULTY_RATIO {easy:0.22, medium:0.60, hard:0.18}` and the prompt's "2 easy / 6 medium / 2 hard" — **the targets are already correct (22/60/18); the generator is not obeying them.** The prompt even flags this ("chronically under-produces easy ~1%"). Enforce via a post-gen length-band gate.

### D3 — Sentence type (4-way) · **solid** · ⚠ TOP-3 GAP
The real type space, made orthogonal (question-FORM × embedded-clause):
- **Real (n=504):** pure **statement 58.3%** (294) · **question+embedded 18.1%** (91, the "Do you know if…?" signature) · **plain direct question 17.3%** (87) · **declarative-indirect 6.3%** (32).
- **Detector:** `classifyType()` = isQuestionForm (terminal ? or inverted main clause) × hasEmbedded (know/tell/ask/think/wonder/not-sure + if/whether/wh). `--dump types`. Hand-validated against the full 2.8/2.23/2.25 sets.
- **Verbatim real:**
  - *q+embedded* — `"do you know if the due dates have been updated?"` · `"Can you tell me whether it will be online or in-person?"`
  - *plain direct* — `"what time does the game start?"` · `"have you applied for it yet?"`
  - *decl-indirect* — `"He wanted to know how I did my research."` · `"I don't know who arranged the flowers."`
  - *statement* — `"I missed the class this morning."` · `"I worked with a company that aimed to reduce carbon emissions."`
- **Current (n=860):** statement **70.7%** (608) · **declarative-indirect 20.3%** (175) · q+embedded **6.5%** (56) · plain direct **2.4%** (21).
- **Gap:** gen **inverts the question structure**: it makes the embedded clause *declarative* ("She wanted to know if…", 20% vs real 6%) and almost never makes it a *question* ("Do you know if…?", 6.5% vs real **18%**). It also barely produces plain direct questions (2.4% vs **17%**). The real exam's two question types (35% combined) are 9% in gen.
- **Maps to:** prompt's sentence-type block — currently targets "indirect ~21%, direct ~14%" but counts via grammar_points; the **prompt should explicitly target the "Do you know if/whether…?" question-form at ~17%** (it is the #1 real pattern) and lift plain direct questions to ~17%, while cutting declarative "She wanted to know if…" fillers.

### D4 — Q-mark (reply ends with "?") · **solid**
- **Real:** **14.5%** (73/504) of answers end with "?". (Undercounts true questions because many recalled targets dropped the terminal "?"; D3's question-FORM is the truer 35%.)
- **Detector:** `/\?\s*$/`.
- **Current:** **9.0%** (77/860).
- **Gap:** gen slightly low; consistent with D3 (gen under-produces questions).
- **Maps to:** `TPO_REFERENCE_PROFILE.qmarkRatio = 0.14` (correct vs real 14.5%); generator at 9% is under.

### D5 — "Do you know if / Can you tell me whether" signature · **solid** · ⚠ part of TOP-3
- **Real:** **17.3%** (87/504) — the single most recognizable real-exam BS pattern.
- **Detector:** `isSignature()` = `^(do you know|can you tell me|could you tell me|do you think it/that) (if|whether|wh-)`.
- **Verbatim real:** `"do you know if she included the schedule?"` · `"Do you know if the new due date has been announced?"` · `"Can you tell me whether he provided a reason?"` · `"do you know when they will announce the results?"`
- **Current:** **6.0%** (52/860).
- **Gap:** under-produced ~3×. Folded into D3.
- **Maps to:** add an explicit "~1 in 6 items is a polite 'Do you know if…?' / 'Can you tell me whether…?' indirect request" line to `genPrompt`.

### D6 — Negation · **solid**
- **Real:** **24.0%** (121/504). Casual forms dominate: "I haven't…", "I do not…", "I wasn't able to…", "I have no intention…", "no, I…".
- **Detector:** `isNegation()` (not/n't/never/no-X/can't/etc.).
- **Verbatim real:** `"I haven't received any emails today."` · `"I do not usually go to those events."` · `"Unfortunately, I did not have time for a visit."`
- **Current:** **25.5%** (219/860). **Gap: negligible** on rate (but gen's negations skew formal/3P — see D11).
- **Maps to:** prompt "negation ~9%" and `negationRatio 0.2` — **both undershoot the real 24%.** Negation is actually common in the recalled bank (declining an invitation is a stock reply). Raise the target to ~20–24%.

### D7 — Relative clause · **solid** · ⚠ TOP-3 GAP
- **Real:** **18.5%** (93/504). Signature shape: an answer that picks "the one that…" / describes "a place/company/park that…".
- **Detector:** `isRelative()` (that/which/who + verb, or "the one that/where"). Validated by hand-read (all 93 are genuine relatives, e.g. "the topic that has…", "a company that aimed…").
- **Verbatim real:** `"I'm enrolled in the one that covers advanced mathematics."` · `"I worked with a company that aimed to reduce carbon emissions."` · `"the park that has the best trails is my favourite."` · `"it's the one that has the software that I need for my project."`
- **Current:** **2.7%** (23/860).
- **Gap:** **~7× under-produced.** The "the one that…/the place where…" reply (describing a choice among options) is a core real pattern almost entirely missing from gen.
- **Maps to:** prompt currently says "relative … 0-1 each [per set]" — **too low.** Bump relative to ~2/10 and add the "the one that…" exemplar; it pairs naturally with the campus topic (choosing a class/gym/café).

### D8 — Passive voice · **solid** · gap
- **Real:** **8.3%** (42/504) — and almost always LIGHT passive *inside* an embedded clause ("if the due dates have been updated", "whether it will be held again").
- **Detector:** `isPassive()` (be/been/being + past participle).
- **Current:** **18.7%** (161/860) — heavier, standalone passives ("why the new policy was implemented", "whom the overdue books had been returned to").
- **Gap:** gen produces **2× the passive** and in a clunkier, more formal register.
- **Maps to:** prompt "passive 0-1 [per set]" is roughly right per-set, but the generator overshoots; keep passive light and embed it (don't open a sentence with a heavy agentless passive).

### D9 — Register: contractions · **solid** · ⚠ part of register gap
- **Real:** **23.0%** (116/504) of answers contain a contraction (it's, I'm, haven't, wasn't, don't).
- **Detector:** `hasContraction()`.
- **Current:** **7.8%** (67/860).
- **Gap:** gen is **3× less contracted** → reads as written/formal, not spoken/casual.
- **Maps to:** no current prompt line addresses register — **add: "answers are casual spoken replies; use contractions freely (it's, I'm, haven't, don't)."**

### D10 — Register: casual opener · **solid** · gap
- **Real:** **10.1%** (51/504) open with "Yes,/No,/Sorry,/Unfortunately,/That's right,".
- **Detector:** `isCasualOpener()`.
- **Verbatim real:** `"Sorry, but I have not had time to look at it yet."` · `"Unfortunately, I never had a chance to read the book."` · `"No, I haven't had a chance to buy it."` · `"That's right. I am not sure what I want to do in the future."`
- **Current:** **0.3%** (3/860).
- **Gap:** gen essentially never uses a conversational opener (the reply isn't framed as answering someone).
- **Maps to:** **add to prompt:** ~1 in 10 replies opens with Yes/No/Sorry/Unfortunately — it makes the reply feel like a turn in a real conversation. (These openers also tend to become a START prefilled anchor — see D14.)

### D11 — Register: subject person · **solid** · ⚠ part of register gap
- **Real:** first-person answers (start "I/I'm/My/No, I…") **40.3%** (203/504); formal 3rd-person subjects ("The manager/supervisor/customer…") **0.4%** (2/504).
- **Detector:** `isFirstPerson()` / `isFormalSubj()`.
- **Current:** first-person **20.1%**; formal 3P subject **6.6%** (57/860).
- **Gap:** gen halves the first-person voice and **invents bureaucratic 3P personas the real exam never uses.** Counter-examples (gen, never in real): `"The customer didn't know whether the prescription was ready for pickup."` · `"The project supervisor could not locate the budget file."` · `"The frustrated customer wanted to know why the delivery was so late."`
- **Maps to:** prompt names ("Matthew, Mariana, Professor Cho…") drive 3P answer subjects — **the reply should usually be the test-taker speaking ("I…"), not a narrated third party.** Demote invented-persona answers.

### D12 — Distractor presence · **solid (recalled tier)** · ⚠ #1 GAP
- **Real:** **0 distractor tiles** across **14 items rendered from 6 distinct exams** (2.23, 2.25, 2.8, 3.4, 3.18, 4.20, 4.24). Every word-tile in the pool maps into the answer. (Verified visually — the OCR "did/op/Qing/oing/p!p" tokens are UI chrome / OCR noise, not tiles.)
- **Detector (current bank):** `item.distractor` non-empty. (Real bank: visual inspection of rendered pools; the structured JSON has no reliable distractor field.)
- **Current:** **89.0%** (765/860) carry a distractor; **253 distinct words but heavily collapsed** — top is **"did" ×160**, then does 37, open 18, recommend 17. Counter (gen): `chunks:[…,"did","he"]` with `distractor:"did"` recurs across dozens of "he/she needed to find out…" items.
- **Gap:** **THE defining structural gap.** The recalled 2026改后 exam supplies an *exact* tile set (no trap); the generator adds a trap to ~9 of 10 items, often the same word ("did"). A solver of a real item drags every tile; a solver of a gen item must reject one.
- **Maps to:** the entire "Distractor rules" block in `genPrompt` + `ETS_STYLE_TARGETS.distractorMin/Max = 6/10` + `PREFILLED`/`distractorRatio 0.88`. **NOTE the existing in-code decision (etsProfile.js lines 26–33): the team deliberately kept ~88% distractor density, arguing the *tile-level* re-measure of the recalled set is 49/60 = 82%, and that the distractor-free ETS *practice* tests are easier/sparser.** This spec's render-level finding (0/14) **directly contradicts** that 82% and is the highest-priority item to reconcile: either (a) the recalled targets DO ship with distractor tiles that the renders I sampled happened to omit, or (b) the 82% figure counts something else (e.g. multi-word tiles or the prefilled tail) as a "distractor." **Re-measure required before trusting either number** — see Deferred. Until reconciled, treat "distractor on 89% of items, 19% of them 'did'" as a known over-trap regardless.

### D13 — Chunk / tile structure · **partial (real) / solid (current)**
- **Real (rendered, n≈14):** pools carry **multi-word tiles** ("the workshop", "that was", "supposed to", "an individual interview", "will be online or", "park that", "is close", "the call") interleaved with single words. Effective tile count ≈ answer length minus prefilled ≈ **5–7 tiles**. Exact single-word ratio is **not recoverable from OCR** (jumbled spacing) → partial.
- **Detector (current):** effective chunk count = `chunks.length − (distractor?1:0)`; single-word ratio over all chunks.
- **Current:** effective chunks mean **5.87** (hist peaks 5–6), single-word chunk share **59.9%**, mean **1.49** words/chunk.
- **Gap:** effective tile *count* is in range (5.87 vs real ~5–7). The real bank clearly DOES use 2–3-word tiles (the renders confirm), so the prompt's "~77% single-word" target may be too high — but this can't be precisely measured on the real side. Treat count as solid, single-word ratio as directional only.
- **Maps to:** prompt "~6 chunks/item, ~77% single words, max 3 words/chunk" — count is fine; the single-word target is **partial / unverifiable against real** (renders show plenty of 2-word tiles).

### D14 — Prefilled anchor: presence & placement · **partial**
- **Real (clean OCR blocks n=40 + 14 renders):** prefilled **present ~85%**; **~21% have two anchors** (a START fragment + an END tail). Placement is spread across START / MID / END — and END tails are common. Mean segment length **~1.46 words**.
- **Detector:** OCR-block split (prompt = first line; pool = longest jumbled line; remaining lines = prefilled candidates). Anchored to hand-read renders.
- **Verbatim real prefilled (from renders):**
  - START: `"She wanted"` (→ "She wanted to clarify…") · `"Can you"` · `"It has"` · `"I just read"` · `"No, but you"`
  - MID: `"know"` (→ "do you ___ ___ know ___ ?") · `"you"` (→ "did ___ you practice…?") · `"which"` · `"decided"`
  - END tail: `"canceled."` · `"favorite spot."` · `"seafood dishes."` · `"classmate?"` · `"be?"` · `"yet."`
  - TWO anchors: `"Can you"` + `"…?"`; `"I'm sorry, but"` + `"."`
- **Current:** prefilled present **76.6%**; multi-segment **1.1%**; mean **1.64** words/segment; person-pronoun-as-hint **23.2%**; non-zero (mid/end) position **49.5%**.
- **Gap:** (1) gen almost never uses **two anchors** (1.1% vs real ~21%) — it rarely gives both a start and an end-tail. (2) gen's end-position anchors exist (49.5% have a non-zero position) but rarely a punctuation-bearing END TAIL like "canceled." (3) presence slightly low (76.6% vs ~85%).
- **Maps to:** `PREFILLED_PROFILE` (`presenceRatio 0.87` ≈ real; `multiSegmentRatio 0.30` — real renders suggest ~21%, in the ballpark) and the prompt's prefilled block. **Add explicit "END-tail anchor" guidance** ("often the LAST word(s) + terminal punctuation are prefilled: 'canceled.', 'favorite spot.', 'classmate?'") — the renders show this is a primary real pattern the gen schema underuses.

### D15 — Prefilled anchor: NOT the subject · **partial** (corroborates the prompt's #1 rule)
- **Real (renders):** the prefilled hint is usually a verb-phrase / mid word / end-tail, **not** the bare subject pronoun. Of the 14 rendered items, the prefilled was a person-subject in ~2 ("She wanted" counts the subject but bundles the verb; "I was" start). The prompt's stated "TPO gives the person as the hint only 30%" is consistent with the render sample (small n → partial).
- **Detector:** person-pronoun-only prefilled share.
- **Current:** **23.2%** person-pronoun-as-hint — already within the ≤30% target (this earlier-fixed regression is holding).
- **Gap:** small / holding. Keep the rule.
- **Maps to:** the "⚡ THE #1 RULE — anchor a NON-subject word" block in `genPrompt` (currently effective).

### D16 — Prompt stem: addresses "you" · **solid–partial** · ⚠ TOP-3 GAP
- **Real (n=298 of 363 cleanly parsed):** **75.8%** of conversational prompts contain "you/your". The prompt is something said TO the test-taker.
- **Detector:** `pickRealPrompt()` (robust to OCR gluing) → no-space "you/your" test. 84/363 prompts too OCR-garbled to classify (excluded).
- **Verbatim real:** `"Why didn't you go to the class yesterday?"` · `"What is your favorite place to relax?"` · `"Did you submit the assignment on time?"`
- **Current:** **48.1%** of `prompt` fields contain "you/your".
- **Gap:** gen prompts are **detached third-person scene reports** half the time ("What did the store manager report about the incoming goods?") instead of speaking to the student. The prompt file already flags this exact regression.
- **Maps to:** prompt's "⚡ THE #1 RULE — the prompt SPEAKS TO the test-taker" + "~6–7 of 10 must contain you/your" — **correct target (real 76%); generator is at 48% and not obeying it.**

### D17 — Prompt stem: opener mix · **solid–partial** · gap
- **Real (n=298):** **otherWh (Why/Where/When/Which/How/Who) 44.6%** · **yes/no (Did/Do/Are/Have/Will/Can…) 31.2%** · **whatX (What did/does/is…) 9.4%** · **statement setup 8.4%** (rest unknown). Prompts end with "?" **87.6%**.
- **Detector:** `classifyRealOpener()` (no-space opener regex + terminal-? check). The dominant real openers are **"Why didn't you…?"** and **"Where did you get that information?"**
- **Verbatim real:** *otherWh* `"Why didn't you answer your phone?"`; *yes/no* `"Are you planning to attend the workshop on Saturday?"`; *whatX* `"What did the instructor say about the exam format?"`; *statement* `"I'm preparing for my presentation on Friday."`
- **Current:** **whatX 53.9%** (464/860!) · statement 24.5% · otherWh 13.6% · yes/no 7.9%.
- **Gap:** gen **massively over-uses "What did…?"** (54% vs real 9%) and **under-uses other-wh** (14% vs real 45%) and **yes/no** (8% vs real 31%). The opener mix is nearly inverted.
- **Maps to:** prompt's "Opener-type mix (calibrated to TPO 36/24/18/18)" — **this TPO-era target is wrong for 2026改后.** Recalibrate to **otherWh ~45% / yes-no ~31% / whatX ~9% / statement ~8%**, and cap "What did…?" hard.

### D18 — Topic domain · **solid** · gap
- **Real (n=363 prompt+pool):** campus/academic **62.8%**, office/workplace **0.3%**.
- **Detector:** keyword domains on the full prompt+pool blob (real) / answer+prompt (current).
- **Current (n=860, answer+prompt):** campus **23.7%**, office/workplace **9.1%** (broader office lexicon incl. report/client/interview → ~28%). Either framing shows gen carries a meaningful office/workplace presence the real bank lacks.
- **Gap:** real BS is overwhelmingly campus life; gen dilutes it with workplace scenarios (managers, shipments, budget files, reports).
- **Maps to:** topic guidance in `genPrompt` (names + scenarios) — **anchor scenarios to campus/student life** (class, lecture, professor, assignment, workshop, library, club, roommate, café/gym near campus). Drop the office/corporate scenarios that produce the formal personas of D11.

---

## Correlations

1. **Difficulty = length × structure, jointly (not length alone).** The longest real answers are the *q+embedded* and *relative* ones ("Can you tell me whether it will reopen by the end of the month", "my professor also asked me how I was able to complete it ahead of time"); the shortest are plain statements/yes-no replies ("it wasn't available online"). So the easy band (≤7w, 25%) is mostly **plain statements & short direct questions**, and the hard band (≥12w, 16%) is mostly **embedded-question / relative-clause** sentences. *Implication: to hit D2's 25% easy you must generate short PLAIN statements (D3 statement + D11 first-person), and the 18% relative (D7) naturally supplies most of the hard band. The generator misses easy precisely because it avoids short plain statements and over-uses formal multi-clause constructions.*

2. **Register, voice, and topic move together.** First-person (D11) ⇄ contractions (D9) ⇄ casual openers (D10) ⇄ campus topic (D18): a casual student reply about their own class life is contracted, first-person, and often opens "Sorry,/No,". The generator's office personas (D11, D18) are exactly the items that are formal, un-contracted, and third-person. *Implication: fixing topic→campus and voice→first-person will pull contractions and casual openers up for free; they are one underlying "conversational register" knob, not four.*

3. **Casual opener ⇄ START prefilled anchor; relative/embedded ⇄ END tail.** Real items that open "Sorry, but…"/"I'm sorry, but" / "No, but you" tend to give that opener as the START prefilled; items that end in a content noun ("…favorite spot.", "…seafood dishes.", "…classmate?") give that as the END tail. *Implication: the prefilled anchor is chosen to bracket the hard middle — generate the anchor from the sentence's natural opener/closer, which also yields the two-segment pattern (D14) the generator lacks.*

---

## Deferred / needs more data

- **Distractor density — official vs recalled (CRITICAL reconcile).** This spec finds **0 distractor tiles in 14 rendered recalled items**; `etsProfile.js` (lines 26–33) records a deliberate decision to keep ~88% density, citing a tile-level re-measure of the recalled set at **49/60 = 82%** and noting the ETS *Full-Length Practice* tests sit at **2/20 = 10%** (`data/buildSentence/tpo_official.json`). These three numbers (0%, 82%, 10%) cannot all be right. **Action:** render ~20 more recalled BS screens across more dates and count tiles-vs-answer-words per item with `scripts/ops/measure-bs-distractor-bysource.mjs`; settle whether real items ship a trap tile, and if so how often and which words. Until then the distractor target is **deferred** (the strongest single lever on authenticity).
- **Chunk single-word ratio for the REAL bank (deferred).** OCR cannot recover true tile boundaries (spacing is destroyed); the renders show 2–3-word tiles exist but n is too small to put a ratio on it. The current "~77% single-word" target is unverified against real. To harden: hand-transcribe tile boundaries from ~30 rendered pools.
- **Prefilled fine distribution (partial).** Presence (~85%), two-anchor rate (~21%), and END-tail prevalence are anchored to 14 renders + 40 clean OCR blocks; the 7-way word-TYPE distribution in `PREFILLED_PROFILE` is inherited from older TPO analysis and is **not re-measured against the 2026 renders.** More transcribed renders would let us replace it with measured 2026 numbers.
- **Official-tier ground truth (partial).** All 504 targets are recalled-tier (reconstructed by test-takers). Bullet-level UI structure is render-verified, but exact wording, terminal punctuation, and the distractor question above are recalled-quality. Treat type/length/register ratios as strong signal; treat the distractor-absence as strong-for-recalled-but-unconfirmed-for-official.
- **Prompt opener mix precision (partial).** 84/363 prompts were too OCR-garbled to classify; the 298 classified are a clean subset but slightly favors well-OCR'd (often shorter) prompts. Direction (otherWh ≫ whatX) is robust; exact percentages ±3–4pts.
