# Evaluation Spec — Speaking · Listen-and-Repeat (`speaking_repeat`)

**Ground truth:** `data/realExam2026/speaking/repeat.json` — 51 sets / 351 sentences (recalled 2026改后, tier=recalled) + `data/realExam2026/speaking/repeat-from-audio.json` — 13 sets / 91 sentences (ASR, untruncated, with `setting`). Raw audio framing read from `.codex-tmp/asr/*Speaking*.txt`.
**Current generated bank:** `data/speaking/bank/repeat.json` — 11 sets / 77 sentences.
**Generation profile/prompt:** `lib/speakingGen/repeatPromptBuilder.js` (the live builder; `lib/ai/prompts/speaking.js` is the *scoring* prompt for the Interview task only and does NOT generate Repeat). Validator: `lib/speakingGen/speakingValidator.js`. Legacy stat model: `data/speaking/profile/repeat-flavor-model.json`.
**Reliability of inputs:** sentence text + length = solid (structured). Per-set `difficulty` labels in the real file are *auto-derived from word count* (length buckets, not hand-tagged structure) — treat them as length tiers, not syntactic difficulty. Speaker role + setting = partial (ASR-recovered for 13/51 sets only). Per-sentence timing budget = deferred (see below).

> The task: the test-taker hears one sentence spoken by a staff/authority figure (or a how-to narrator), then repeats it once. Scoring is by word-match, not AI. So the item's job is to be a *naturally-spoken, hearable, repeatable* sentence at a controlled length — NOT to test reading or grammar knowledge.

---

## How the real items actually read (bottom-up)

Two structural families exist in the real bank, both absent-by-omission from the generator:

1. **Orientation/briefing sets** (majority): a staff member walks you through a *place* — library, store, gym, computer lab, garden/museum, dining hall, stadium. Flow ≈ (optional welcome) → locate things → what you can do → a soft closing pointer ("check the map / schedule"). Sentences are mostly bare declaratives ("Laptops are located in this aisle.") and bare imperatives ("Check your inbox for new messages.").
2. **Procedure / how-to sets** (~6 of 51: bike-tire repair `2026-03-18`, cookie baking `2026-03-27`, salad making `2026-04-06`, watercolor painting `2026-03-29`, travel-agent booking `2026-04-18`/`2026-05-03`): a sequence of imperative steps ("first, select the right tool to remove the wheel", "next, deflate the tire", "carefully locate the puncture hole"). No "welcome", no location. **The generated bank has zero of these.**

The single most important contrast: the generator produces a polished, uniform "campus front-desk receptionist" voice with a Welcome opener, a yes/no question, a rigid 2/3/2 difficulty staircase, and a punitive rule ("late returns will result in suspension of your privileges"). The real exam has **no yes/no questions, no question marks at all, almost no punitive rules, a medium-heavy (not 2/3/2) length mix, and bare-declarative openers far more often than "Welcome".**

---

## Dimensions

### D1 — Sentences per set · **solid**
- **Real:** 7 sentences in 47/51 sets (92%); outliers are truncated recalls (4,4,6,8). Treat **7** as the target; accept 6–8.
- **Detector:** count `sentences[]` length, distribution.
- **Current:** 11/11 sets = exactly 7. **Gap: none.**
- **Maps to:** `repeatPromptBuilder.js` "7 sentences total"; validator `validateRepeatSet` (`sentences.length !== 7`).

### D2 — Sentence length (words), overall · **solid**
- **Real (n=351):** min 4, max 17, mean **9.56**, median **9**. Audio-clean (n=91, untruncated): mean 9.86, median 9, max 18.
- **Detector:** whitespace word count per sentence; mean/median/min/max.
- **Current (n=77):** mean 9.21, median 9, max 15. Close on center, but **truncated at the top** — real has a genuine 16–18-word tail that gen never reaches (gen hard max = 15).
- **Verbatim real long-tail:** "If you want to know what is being offered, just check the daily menu for special dishes" (17w); "When you are ready, simply select Print from your computer and retrieve your document." (14w); "before you leave the classroom, be sure you got all your tools back into the toolbox" (16w).
- **Maps to:** `STRUCTURE_RULES.hard.word_range = [13,20]` (range is fine; gen under-fills it).

### D3 — Difficulty/length-tier MIX per set · **solid** · ⚠ BIGGEST GAP
- **Real:** the 2/3/2 staircase the generator enforces is **rare — only 3/47 sets (6.4%)**. Dominant signatures (e/m/h by the file's own labels): `2/4/1` ×12, `3/3/1` ×10, `1/4/2` ×8, `1/5/1` ×6. Tier totals across 47 sets: easy 91 / medium 182 / hard 56 → **~26% / ~52% / ~16% (+ ~6% extra-easy)**. Audio-clean mix agrees (`2/4/1`,`1/4/2`,`3/3/1` lead; **no** `2/3/2`). **The real exam is medium-dominant with usually only ONE hard sentence; two-hard sets exist but are a minority.**
- **Detector:** per-7-set count of easy/medium/hard; signature histogram. Hand-validated against full arrays of 3 sets — exact match.
- **Current:** **11/11 sets = exactly 2/3/2 (100%)**. Over-rigid; over-produces hard (2 every set) and under-produces medium.
- **Target:** medium ≈ 50–52% of sentences; easy ≈ 25–30%; hard ≈ 15–18%. At the *set* level, vary the signature — most sets should be `2/4/1`, `3/3/1`, `1/4/2`, or `1/5/1`; reserve exact `2/3/2` and any 2-hard set for a minority.
- **Maps to:** `repeatPromptBuilder.js` "2 easy + 3 medium + 2 hard" (hard-coded in prompt AND in the OUTPUT FORMAT comment); validator warns when `easy!==2||medium!==3||hard!==2`. **Both should be loosened to a distribution, not a fixed 2/3/2.**

### D4 — Length progression within a set · **solid**
- **Real:** strictly non-decreasing S1→S7 in only 9/49 (18%) — sentences do NOT climb monotonically. BUT the **last sentence is the longest (or tied) in 45/49 = 91.8%**. So the real signature is "**bumpy middle, long finish**", not a clean staircase. (E.g. `2026-01-21`: 5,7,8,10,12,9,14 — S6 dips before the long S7.)
- **Detector:** monotonic-non-decreasing check; "is last == max length" check.
- **Current:** monotonic 2/11 (18%) — matches; last=longest 9/11 (82%) — slightly low.
- **Target:** do NOT enforce monotonic growth; DO make S7 the longest sentence (~92%).
- **Maps to:** implicit in `repeatPromptBuilder` difficulty-by-position; no explicit rule — the "hard sentences are positions 6–7" assumption creates a cleaner staircase than reality.

### D5 — S1 opener type · **solid** · big gap
- **Real (n=51):** "Welcome to…/Let's…" greeting = **8 (16%)**; bare **imperative** ("Check your inbox…", "Enter your name and student ID number", "begin by mixing the butter and sugar") = 14 (27%); bare **declarative locating/announcing** something ("Laptops are located in this aisle.", "The library books are located here.", "Soccer matches and practice take place here.", "This area shows early sailing ships.") = 27 (53%); "You can…" = 2.
- **Detector:** regex-classify first sentence; hand-verified by reading all 51 S1 (listed in scratch run).
- **Current (n=11):** "Welcome…" = **7 (64%)**, imperative = 4, bare declarative = **0**. Massively over-greets and never opens with a plain locating declarative.
- **Verbatim real S1:** `"Laptops are located in this aisle."` · `"The library books are located here."` · `"begin by mixing the butter and sugar"` · counter-example (greeting, the minority): `"Welcome to our campus tour."`
- **Maps to:** prompt examples both open "Welcome to…" / "Please step inside…"; the OUTPUT FORMAT sample sentence is "Welcome to the campus fitness center." → anchors the model on greetings.

### D6 — Sentence mood mix · **solid**
- **Real (n=351):** imperative ≈ **38.5%**, plain declarative ≈ **51%**, "you-can/we-have" statement ≈ 10.5%, question **0%**.
- **Current:** imperative 35%, declarative 49%, you-stmt 10%, question **5.2%**. Mood balance is otherwise close; the only defect is the questions (see D7).
- **Detector:** first-token + end-punctuation classifier.
- **Maps to:** prompt "imperative mood common" + "direct address" — roughly right.

### D7 — Yes/no questions · **solid** · clear gap
- **Real:** **0 / 351** sentences contain a question mark. None. The Repeat task never asks the test-taker to repeat a question.
- **Current:** 4 / 77 (5.2%) are yes/no questions: `"Do you have your insurance card?"`, `"Are you here for math help?"`, `"Do you have a reservation?"`, `"Do you have your safety goggles?"`.
- **Detector:** `?`-ending or aux-verb-initial. Validated: 0 `?` anywhere in real.
- **Target:** **0% questions.**
- **Maps to:** prompt EXAMPLE SET 1 S2 = "Do you have your student ID?" and `STRUCTURE_RULES.easy.structures` lists "short yes/no question". **Remove yes/no questions from the easy structures and from both worked examples.**

### D8 — Contraction rate · **solid**
- **Real:** 6/351 = **1.7%** (audio-clean 1.1%). Despite being "spoken", the sentences are overwhelmingly written-full-form ("you will", "do not"→rare). Contractions are incidental, not a flavor marker.
- **Current:** 1/77 = 1.3%. **Gap: none** — but note the validator's `natural_spoken_register` score *rewards* contractions (`contractRate*0.5`), which is mis-calibrated against reality. Low priority.
- **Detector:** contraction-token regex.
- **Maps to:** prompt "Contractions are OK"; validator `natural_spoken_register`. The validator over-weights a feature real items barely use.

### D9 — Direct address (you/your) rate · **solid**
- **Real:** **37.3%** of sentences contain you/your. Audio-clean similar. Many sentences are about the *place/objects* ("The pond is a popular spot…", "Bread is freshly baked on site every day."), not the listener.
- **Current:** **53.2%** — over-addresses the listener.
- **Detector:** `\byou(r)?\b` rate.
- **Target:** ~37%, i.e. roughly 1 in 3 sentences, not every other one.
- **Maps to:** prompt "Use direct address ('you','your') naturally" → model over-applies it; validator `natural_spoken_register` rewards `addrRate` (pushes it higher still).

### D10 — Hard-sentence multi-clause (comma) rate · **partial**
- **Real:** of the 57 hard (≥13w) sentences, **43 have a comma/semicolon (75.4%)** — long sentences usually have a clause break ("If you need help getting around, check the map…", "When you are ready, simply select Print…").
- **Current:** 11/22 = **50%** — gen's hard sentences are under-punctuated / more often single long clauses.
- **Detector:** comma/semicolon presence in hard-tier sentences. (Partial: "hard" here = the file's length label; structural complexity not separately verified.)
- **Target:** ~75% of the longest sentences carry a comma-separated clause (fronted `if/when/before` clause, or `…, so …`).
- **Maps to:** validator `validateRepeatSentenceProfile` already flags `hard_no_clause_break`, and `sentence_structure_match` rewards hard-with-comma — directionally correct; the *generator* just doesn't hit it.

### D11 — Conditional / fronted-clause sentences · **solid**
- **Real:** 35/351 = **10%** use `if you…` (typically the long closing sentence: "If you are unsure when the lab is open, you can check the weekly schedule here."). Real also heavily uses fronted `When/Before/After/Lastly` clauses for the finish.
- **Current:** 11/77 = 14.3% — slightly high, and concentrated as the engineered "hard" structure.
- **Detector:** `^if`/`if you` regex.
- **Maps to:** `STRUCTURE_RULES.hard.structures` leads with "conditional if-clause" → model defaults to `if`; real distributes across `if / when / before / lastly`.

### D12 — Punitive-warning trope · **solid** · clear gap (synthetic tell)
- **Real:** **0 / 351**. There is no "violations will result in suspension of your privileges" register anywhere. (4 keyword hits are false positives: "free of **charge**", "**fine** details".) The closest real "rule" sentences are gentle: "We hope everyone will ensure that books are returned on time.", "Use only what is needed so that your supplies last all quarter."
- **Current:** **8 / 77 (10.4%)**: "…will result in a rescheduled appointment and a possible fee.", "…temporary suspension of your tutoring privileges.", "If you return the car late, you will incur an extra daily charge.", "Overdue books will result in fines…". This is the strongest synthetic fingerprint.
- **Detector:** `/will result in|suspension|privileges|incur|penalt|violation/i`; validated by broad punitive grep on raw text.
- **Target:** **~0%.** Replace consequence/threat sentences with neutral logistics or soft encouragement.
- **Maps to:** `STRUCTURE_RULES.hard.structures` includes "result/consequence clause (e.g., 'Late returns will result in an extra daily charge…')" AND prompt example S7 = "Late equipment returns will result in a temporary suspension of your borrowing privileges." → **this seeded the trope directly. Remove it.**

### D13 — Closing-sentence "wayfinding" trope · **solid** (positive signature gen lacks)
- **Real:** the last sentence references a **map / schedule / guide / directory / floor plan / catalog in 17/51 (33%)** ("If you need help getting around, check the map for specific areas and facilities", "…check the weekly schedule here", "…you can download the map for free"); another 20% close on help/staff/questions.
- **Current:** **0 / 11** last sentences mention map/schedule/guide. Gen instead closes on punitive rules (D12).
- **Detector:** keyword scan of final sentence per set.
- **Target:** ~1/3 of orientation sets should end on a "check the map/schedule/directory" pointer.
- **Maps to:** prompt SCENARIO COHERENCE rule 3 ("welcome → instructions → rules → warnings") — its "rules → warnings" ending is wrong; real endings are "→ wayfinding pointer / offer of help".

### D14 — Scenario / setting domain mix · **partial**
- **Real (keyword hits, overlapping):** gym/sports 42, library 29, store/retail 27, lab/IT/computer 21, procedure/how-to 21, tour/garden-museum 17. Settings recovered from ASR include: campus library printing, grocery store, student help desk, university open house, course registration, university library, wildlife sanctuary, community center, sporting event, weather report for university radio, tech store, woodworking class, botanical garden. **Heavy real-world/community skew** (grocery, hardware store, amusement park, travel agency, bike repair, baking) alongside campus settings.
- **Current scenario pool (18):** IT Help Desk, Library, Planetarium, Car Rental, Theater Rehearsal, Gym, Health Center, Chem Lab, Dining Hall, Bookstore, Residence Hall, Tutoring Center, Career Services, Art Gallery, Recycling Center, Radio Station, Swimming Pool, Photography Darkroom. **All campus/institutional; missing the procedure/how-to family entirely and the everyday-retail/cooking/repair settings that are common in the real bank.**
- **Detector:** keyword domain tagger (partial — overlapping, content-based).
- **Maps to:** `SCENARIO_POOL` in `repeatPromptBuilder.js`. Add procedure/how-to sets (cooking, repair, craft, booking) and everyday-commerce settings; reduce the "campus office" monoculture.

### D15 — Speaker role + setting framing text · **partial** · structural gap
- **Real (ASR, 13 sets):** every set is introduced by a fixed second-person frame, then a fixed instruction. Two opener templates: **"You are working/volunteering/learning … Your manager is training/teaching you to assist …"** and **"You are being trained to …"**. Then verbatim: **"Listen to the [speaker|manager] and repeat what [he|she|the manager] says. Repeat only once."** Speaker pronoun where ASR labels it: **she ×5, he ×3** (voiced gender varies). `repeat-from-audio.json` carries the `setting` string per set (e.g. "You're being trained to show students how to use the campus library's printing services.").
- **Verbatim frames:** `"You are being trained to assist customers at a university tech store."` · `"You are learning how to give the weather report for the University radio station."` · `"You have an internship at a wildlife sanctuary. Your manager is teaching you how to assist visitors there."`
- **Current:** bank stores only `scenario` + `speaker_role` (e.g. "Tutoring Center" / "tutoring center coordinator"). **No second-person `setting` sentence and no "Listen and repeat… Repeat only once." instruction text** — so a generated item cannot be presented with the authentic framing the real test shows.
- **Detector:** field presence (`setting`); ASR pattern match on framing templates.
- **Reliability:** partial — role/setting known for 13/51 sets only; gender pattern from 8 labeled sets.
- **Maps to:** `SCENARIO_POOL` has `setting` internally but the OUTPUT schema drops it; add a second-person `setting` sentence + standard instruction to the generated record.

---

## Correlations (cross-dimension)

1. **"Difficulty" ≈ word count, full stop.** The real per-sentence `difficulty` label tracks length almost perfectly (easy ≤7w, medium 8–12w, hard ≥13w) and is *not* a syntactic judgment — e.g. `2026-04-29` S1 "we serve coffee and tea at the main counter" (9w) is labeled medium while a 7w sentence is easy. **Implication:** the generator should control the *length distribution* (D2/D3) and stop treating "hard = conditional/consequence syntax". A long simple sentence is the real "hard".
2. **The long finish carries the clause break.** D4 (S7 = longest, 92%) + D10 (75% of long sentences have a comma) + D11/D13 (closing uses `if/when/lastly … + map/schedule pointer`) describe ONE thing: the authentic set ends with a single long, comma-split, wayfinding sentence — not a staircase of two engineered "hard" rules. Generating one long fronted-clause closer (and a shorter S6) would fix D4, D10, and D13 simultaneously.
3. **Synthetic register = greeting + question + threat.** D5 (over-Welcome), D7 (yes/no Qs), D9 (over-"you"), D12 (punitive rules) co-occur and all trace to the two worked examples + `STRUCTURE_RULES` in the prompt. They cluster into a recognizable "polished campus-receptionist" voice that the medium-dominant, bare-declarative, rule-free real bank simply does not have. Fixing the prompt's two examples and the easy/hard structure lists removes all four at once.

---

## Biggest current-vs-real gaps (priority order)

1. **Difficulty mix is rigidly 2/3/2 (D3)** — real is medium-dominant (~26/52/16) and varies set-to-set; exact 2/3/2 is only 6% of real sets and gen is 100%. Loosen the prompt and the validator from a fixed count to a distribution; cut hard from "always 2" to "usually 1".
2. **Punitive-warning trope (D12)** — 10.4% in gen, 0% in real; seeded verbatim by the prompt's S7 example. Plus yes/no questions (D7) 5.2% vs 0%. Both are pure synthetic tells; delete the seeding example/structure lines.
3. **Opener & address register (D5+D9)** — gen opens "Welcome…" 64% (real 16%) with 0 bare-declarative openers (real 53%) and addresses "you/your" 53% (real 37%). Plus gen lacks the **procedure/how-to set family and the map/schedule closer (D13)** entirely.

---

## Deferred / needs more data

- **Per-sentence timing budget (seconds).** The generator stamps `timing_seconds` 8/10/12 by tier, but the real value is unverified. ASR timestamps give only *playback* gaps between consecutive sentences within the audio (e.g. `2026-01-21`: 4,2,9,6,3,10,6 s) — these are speak-then-pause intervals, not the response window, and several sentences are batched into one timestamp. **Cannot derive a reliable per-sentence response-time target from current data; do not invent one.** Would need the on-screen countdown values from a video capture.
- **Structural syntax taxonomy (passive / relative / conditional split).** Real "difficulty" is length-based, so the validator's structure percentages (`passive_voice 0.2`, `relative_clause 0.2`, etc. in `repeat-flavor-model.json`) are not anchored to measured real frequencies — they came from the 5 third-party `goarno.io` reference sets, not the 51-set real bank. Treat those sub-percentages as unvalidated.
- **Speaker gender / voice target.** ASR shows she ×5 / he ×3 across 8 labeled sets — suggestive of a mixed/slightly-female-leaning voice pool, but n is too small and gender is irrelevant to text generation. Recorded for completeness only.
- **Exact scenario frequency weights (D14).** Domain tagging is overlapping/keyword-based and settings are ASR-known for only 13/51 sets, so the gym/library/store ordering is indicative, not a precise target distribution.
