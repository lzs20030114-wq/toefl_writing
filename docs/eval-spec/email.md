# Evaluation Spec — Writing · Write an Email (`email`)

**Ground truth:** `data/realExam2026/writing/email.json` — 51 items (33 unique scenarios; many dates re-use a prompt), tier = **recalled** (2026改后机经, OCR + DeepSeek-structured). Bullets/recipient/subject are **verbatim-faithful** to the live exam: OCR of the actual on-screen writing prompts (`.codex-tmp/ocr/{2.23,2.25,3.16,3.30,4.20} 写作.txt`) matches `email.json` bullets word-for-word. Scenario *prose* in the JSON is lightly expanded vs the terser on-screen text.
**Current generated bank:** `data/emailWriting/prompts.json` — **196 items** (live node count 2026-07-10; "139 items" was the pre-fix count). Dimensional `Current:` values below are the **2026-07-10 postfix snapshot** (`writing_email.gen`, n=196).
**Generation prompt/profile:** `lib/ai/prompts/emailWriting.js` → `buildEmailGenPrompt(category, avoid)` + `EMAIL_CATEGORIES` (the 6-category A–F weighting). Scoring prompt (separate concern): `EMAIL_SYS_BASE` + `inferPowerRelationship`.
**Measurer:** `scripts/research/email_measure.mjs` — every detector below was hand-validated against the 51 real items; `--dump <dim>` prints per-item output. Iron rule applied: where a detector first disagreed with hand-reading (role on bakery/yoga/hotel cases; topic on gym/hotel/party cases; coherence false-positives on "moved-into-apartment + bought-product"; dangling on direction-established roles), the **detector was fixed**, not the number.
**Reliability of inputs:** bullet text / verb / count / recipient form / subject = **solid** (structured + OCR-confirmed). Macro function + topic setting = **partial** (qualitative, ~2-3/51 fuzzy boundary calls). Scenario length = **partial** (recalled prose is expanded vs on-screen). Register-as-a-ratio = **deferred** (no email body in the prompt to measure).

> **The task:** the test-taker reads a short scenario + a fixed recipient (To:) + subject + **exactly 3 bullet goals**, then writes one email. Direction is always *"Write an email to [recipient]. In your email, do the following:"* and the screen appends the fixed instruction *"Write as much as you can and in complete sentences."* The item's job is to set up a realistic everyday situation and three clear communicative goals at a controlled register.

> **2026-07-10 postfix — SPLIT STATE (read before calibrating).** Batch 4 fixed the Email *prompt* levers; the live *bank* is partly caught up:
> - **Closed in the bank:** recipient surface form — `recipient_title_share` **84.69%** (real 82.35%) and **`recipient_bad_count` 0** (the invented "First Last" names and bare-org addressees are gone); scenario length `scenario_words_mean` **38.92** (real 39.45).
> - **Prompt fixed, bank NOT yet regenerated (don't read as a live regression):** subject `subject_words_mean` **6.74** / `subject_ge8_count` **50** (real 4.14 / 0); opener `opener_you_other_verb` **39.29%** (real 0); verbs `verb_ask` **24.49%** (real 10%) / `verb_inquire` **0** (real 5.9%); `verbs_all_distinct_share` **1.0** (real 0.90). These move only when the bank is regenerated against the fixed `emailWriting.js`.

---

## How the real items actually read (bottom-up)

The single biggest realization from reading all 51: **the real Email task lives in "student-as-customer-of-everyday-services" life, not corporate or civic life.** Two thirds of items are about a **gym / hotel / restaurant / concert / trip / party / campus club event / print shop** — places you pay for, attend, or organize. The recipient is almost always **a manager/owner/staff member you address as "Mr./Ms. Surname"** and don't know personally.

Three recurring *shapes* dominate:

1. **Plan/coordinate an event** (31%) — to a peer or a venue: "describe your idea → explain why it'll work → suggest a time / offer to help / ask their input." (fundraiser with Jasmine, Europe trip with John, resort booking with Ms. Taylor, surprise party with Mr. Lee.)
2. **Complain & request a fix** (27%) — to a service manager: "describe the problem → explain its impact → request repair/replacement/compensation." (apartment repairs, slow dorm internet, broken gym equipment, hotel room issues, damaged furniture.)
3. **Mixed feedback — praise → problem → suggest** (20%) — to a venue/organizer: "describe what you enjoyed → explain the issue → suggest an improvement." (orchestra sound, restaurant service, bakery cake, career workshop, hotel stay.) This "soften before the ask" arc is a real-exam signature.

The bullet **arc** is highly stereotyped: **slot 1 = Describe (or warm opener), slot 2 = Explain (impact/reason), slot 3 = an action verb (Suggest / Request / Inquire / Ask)**. Verbs are plain — **Explain (29%) and Describe (27%) alone are over half of all bullets**; adjectives/adverbs in goals are rare.

The generated bank is recognizably the same task but drifts in five measurable ways (see gaps): wrong topic mix (corporate/civic instead of services/leisure), invented recipient forms (full "First Last" names; bare org addressees), over-long email-client-style subjects, under-use of the relational planning/feedback shapes, and a cluster of hard defects (recipient↔scenario mismatch; dangling names in bullets) that the real bank never exhibits.

---

## Dimensions

### D1 — Bullet count · **solid**
- **Real:** exactly **3** bullets, 51/51. **Current:** 3/3, 139/139. **Gap: none.**
- **Detector:** `len(item.bullets)`.

### D2 — Bullet lead-verb distribution · **solid** · gap
- **Real (n=153 bullets):** Explain **29.4%**, Describe **26.8%**, Suggest 11.1%, Ask 10.5%, Request 7.2%, **Inquire 5.9%**, Thank 3.3%, Provide 2%, Offer/Mention 1.3% each, Discuss/Reiterate 1 each. Explain+Describe = **56%** of all bullets.
- **Detector:** first token → canonical verb (`VERB_MAP`); `--dump verb`.
- **Verbatim real (the canonical triad):** `"Describe the issues you have encountered in the apartment." / "Explain how conditions negatively affect your studies." / "Request that he make arrangements to address these issues soon."`
- **Current (postfix):** Explain 22.8%, Ask **24.49%**, Describe 21.3%, Suggest 11.4%, Request 7.1%, **Inquire 0%**. **Still off — bank pending regeneration.** Ask is still over-used (24.5% vs real 10%) and Inquire is still 0 (real 5.9%).
- **Gap:** shape flatter than real; over-uses "Ask", zero "Inquire". **Prompt fixed, bank pending.**
- **Maps to:** `emailWriting.js:245` `SLOT3_VERBS = ["Suggest","Suggest","Request","Request","Inquire","Ask"]` — **now adds Inquire and demotes Ask** in the slot-3 action verb. Takes effect on regeneration.

### D3 — Bullet verb by slot (the arc) · **solid**
- **Real:** slot1 = **Describe 29 / Explain 15** (+ a few Thank/Mention/Reiterate); slot2 = **Explain 23 / Describe 12 / Ask 11**; slot3 = **Suggest 17 / Request 10 / Inquire 9** (then Explain/Ask).
- **Detector:** `leadVerb` per position; `--dump verb`.
- **Current:** slot1 Describe-led (matches); **slot3 splits Ask 45 / Suggest 45** — gen pushes "Ask" into the action slot where real prefers Suggest/Request/Inquire. Real uses **zero** "Ask" in slot1; gen has some.
- **Maps to:** implicit in the goal-ordering the model learns; reinforce "slot3 = Suggest/Request/Inquire, not Ask" and "never open with Ask".

### D4 — Distinct-verbs-per-item · **solid**
- **Real:** 3 distinct lead verbs in **46/51 (90.2%)** — **a repeated verb is authentic ~10% of the time** (e.g. `2026-01-27`: Describe / Describe / Explain).
- **Detector:** `Set(3 verbs).size===3`; `--dump verb`.
- **Current (postfix):** `verbs_all_distinct_share` **1.0** (real 0.90). Still rigidly 100% all-distinct — minor, bank pending regen.
- **Gap:** the prompt rule *"each starting with a DIFFERENT verb"* is **slightly too strict** — allow ~1-in-10 items to repeat a verb (esp. Describe/Describe).
- **Maps to:** `buildEmailGenPrompt` *"Exactly 3 goals, each starting with a DIFFERENT verb."*

### D5 — Macro communicative function · **partial** · ⚠ TOP-3 GAP
- **Real (n=51):** planning/coordination **31.4%**, complaint+request-fix **27.5%**, mixed-feedback (praise+problem+suggest) **19.6%**, advice-seeking 7.8%, information-request 5.9%, problem+suggestion 3.9%, appreciation 2%.
- **Detector:** `classifyMacro()` blends bullet verbs + scenario keywords; `--dump macro`. ~3/51 boundary calls fuzzy (appreciation vs advice) → **partial**.
- **Verbatim real exemplars:**
  - *mixed-feedback* (`2026-04-06`, Cozy Corner): `"Describe what you enjoyed about your dining experience. / Explain the issues you faced with the service and your order. / Suggest ways to improve the service for future customers."`
  - *planning* (`2026-01-21-C`, Jasmine): `"Describe the ideas you have for the fundraising event. / Explain why you think these activities will be successful. / Suggest a time to meet and discuss the plans in more detail."`
  - *advice-seeking* (`2026-01-28`, Alex): `"Describe to Alex what you have recently noticed about him. / Explain why it is important to maintain good health. / Suggest some specific strategies Alex can use to manage his stress and workload."`
- **Current:** complaint+fix **28.8%** (over), information-request **20.1%** (3× over), problem+suggestion 14.4%, planning **10.8%** (3× under), proposal 10.1%, mixed-feedback **6.5%** (3× under).
- **Gap:** real's signature blend = **planning (31%) + mixed-feedback (20%) make up HALF the bank**; gen under-produces both and over-produces dry complaint+fix and pure info-request. Gen feels transactional; real feels relational + event-driven.
- **Maps to:** `EMAIL_CATEGORIES` `tones` fields — currently lead with "complaint + request" / "information request" everywhere. **Add explicit "plan/coordinate an event" and "praise → problem → suggest" tones and weight them up.**

### D6 — Recipient surface form · **solid** · ⚠ TOP-3 GAP
- **Real (n=51):** only **two** forms — **Title + Surname 82.4%** ("Mr. Thompson", "Ms. Taylor", "Dr. Smith", "Professor Patel") and **first-name-only 17.6%** ("Julia", "Alex", "Maria", "John").
- **Detector:** `recipientForm()`; `--dump form`.
- **Current (postfix):** `recipient_title_share` **84.69%** (real 82.35%), `recipient_bad_count` **0**. **Gap closed** — the invented "First Last" names and bare-org addressees are gone; the bank is now the two real forms only.
- **Maps to:** `buildEmailGenPrompt` (`emailWriting.js:290`) — now: *"NEVER use forms the real exam does not use: NO full \"First Last\" names … NO bare role/org addressees"*. Fix landed and is reflected in the bank.

### D7 — Recipient role / power relationship · **solid** · gap
- **Real (n=51):** **staff/service/authority 74.5%** (gym manager, landlord, hotel manager, sound engineer, librarian, catering manager, restaurant owner), **peer 17.6%** (friend, classmate, club leader), **professor/instructor only 7.8%** (just 4 items: Dr. Smith group-project ×, advisor Prof. Patel).
- **Detector:** `recipientRole()` — **recipient-anchored** (reads the appositive role-noun bound to the recipient name; does NOT fire on loose scenario keywords). Hand-validated: bakery-owner Ms. Lopez / yoga-instructor Ms. Martinez / hotel-staff Mr. Carter all = **staff**, not professor. `--dump role`.
- **Current:** staff 59%, peer 24.5%, **professor/instructor 16.5% (2× over)**.
- **Gap:** gen skews too campus-academic — **double the professor emails** and fewer service-provider emails. The real exam overwhelmingly wants "write to a manager/venue you don't know personally."
- **Maps to:** `EMAIL_CATEGORIES` weights: Academic 0.30 is too high; the implicit "professor" pull should drop. Boost the services/venue scenarios.

### D8 — Scenario opener · **solid** · gap
- **Real (n=51):** four patterns only — **"You are…" 49%**, **"You recently…" 33.3%**, **"Your [person/thing]…" 13.7%**, **"You and your…" 3.9%**.
- **Detector:** `opener()`; `--dump opener`.
- **Verbatim real:** `"You are a university student who has recently moved into a new apartment."` · `"You recently attended a university orchestra concert."` · `"Your professor, Dr. Smith, recently assigned a group project…"` · `"You and your friend, Jasmine, are planning to host a fundraising event…"`
- **Current (postfix):** "You are…" 32.65%, "You recently…" 17.86%, **"You [other verb]…" 39.29%** (real 0), "Your…" 8.16%, third-person 1.53%. **Still leaks the 5th opener heavily — bank pending regeneration.**
- **Gap:** real uses only four openers (96%); gen still over-produces "You [other verb]…" (39%). **Prompt fixed, bank pending.**
- **Maps to:** `emailWriting.js:228-232` — the four-opener block (`"You are…" 0.49 / "You recently…" 0.33 / "Your…" 0.14 / "You and your…" 0.04`) now replaces the old "You [other verb] 8% / third-person 8%" allowances. Takes effect on regeneration.

### D9 — Scenario word count · **partial** (recalled prose expanded)
- **Real:** min 26, max 58, mean **39.5**, median 39 (p10 29, p90 49). **Current (postfix):** mean **38.92** (`scenario_words_mean`) — **now matches real**; the old ~3w-long gap is closed.
- **Detector:** whitespace word count.

### D10 — Scenario sentence count · **partial**
- **Real:** mean **3.4** sentences (3-sent ×22, 4-sent ×23 = 88% are 3-4 sentences). **Current:** mean **2.5** (mostly 2-3).
- **Detector:** count `[.!?]` terminators.
- **Gap:** gen scenarios are **fewer, denser sentences** (more words packed into 2-3 sentences) where real **spreads setup across 3-4 shorter sentences** (role → triggering event → concrete detail). Caveat: recalled prose likely inflates real sentence count somewhat → partial.

### D11 — Bullet word length · **solid**
- **Real (n=153):** min 5, max 17, mean **9.2**, median 9. **Current:** mean 9.7, median 10. **Gap: negligible** (~0.5w longer).
- **Detector:** whitespace word count per bullet.

### D12 — Subject word count · **solid** · ⚠ TOP-3 GAP (tied)
- **Real:** min 2, max 7, mean **4.1**, median 4 (p10 3, p90 5). Short noun phrases.
- **Detector:** whitespace word count of subject.
- **Verbatim real:** `"Damaged library book"` (3w) · `"Resort Inquiry"` (2w) · `"Career Workshop"` (2w) · `"Request for apartment repairs"` (4w) · `"Feedback on dining experience"` (4w).
- **Current (postfix):** mean **6.74** (`subject_words_mean`, real 4.1); **50 items ≥8 words** (`subject_ge8_count`, real 0). **Still 60% too long — bank pending regeneration.**
- **Gap:** gen subjects are still ~60% longer and stuff in order numbers / course codes. **Prompt fixed, bank pending.**
- **Maps to:** `emailWriting.js:295` — now: *"'subject' must be a SHORT noun phrase of 2-5 words, like a real inbox line"*. Takes effect on regeneration.

### D13 — Scenario specificity (named brand/venue) · **solid**
- **Real:** **29.4%** of scenarios quote a brand/place ('Home Essentials', 'Coastal Retreat', 'Cozy Corner', Fitness Zone). All items include ≥1 concrete anchor (place/time/event/object). **Current:** 24.5%. **Gap: minor** — both banks like named anchors.
- **Detector:** quote-char presence.

### D14 — Topic setting · **partial** · ⚠ BIGGEST GAP
- **Real (n=51):** **events/services/leisure 64.7%** (gyms, hotels, restaurants, concerts, trips, parties, retreats, print shops, campus club events), academic/campus-study **19.6%**, consumer/retail 7.8%, housing **3.9%** (2 items), community/civic 2%, workplace/internship 2%.
- **Detector:** `topicDomain()` mutually-exclusive precedence on the scenario's core noun; `--dump topic`. Hand-validated all 51 (only fuzzy edge = "career fair/workshop" events-vs-workplace, ~2 items) → **partial**.
- **Verbatim real exemplars:** *events/services* — gym equipment (Ms. Taylor), hotel-stay feedback (Mr. Rodriguez), restaurant feedback (Ms. Lee), concert sound (Mr. Bridges); *academic* — group project (Dr. Smith), missed-lecture notes (Maria); *housing* (rare) — apartment repairs (Mr. Thompson).
- **Current:** academic 20.1%, **workplace/internship 18.7%**, **community/civic 18%**, consumer/retail 18%, housing 10.1%, **events/services/leisure only 6.5%**, peer/social 3.6%.
- **Gap:** **THE defining gap.** Real is dominated by everyday services/leisure (65%); gen produces almost none (6.5%) and instead manufactures a heavy **corporate workplace** presence (sprints, brand managers, sales-territory handoffs, IT migrations) and a heavy **civic** presence (city council, neighborhood association, parks dept) that the real exam barely has. Gen also over-weights consumer/retail product complaints.
- **Maps to:** `EMAIL_CATEGORIES` (`emailWriting.js:218`) — **recalibrated 2026-07-10**: a dominant **"G" Services & Events** category at **weight 0.55** (gyms/hotels/restaurants/concerts/trips/parties/campus events) was added and Workplace/Community cut. (Topic-setting share was not re-measured in the postfix snapshot; the weighting fix is in-prompt and takes effect on regeneration.)

### D15 — Recipient↔topic coherence · **solid** · ⚠ HARD DEFECT
- **Real:** **0/51** mismatches. **Current:** **5/139 (3.6%)** nonsensical recipients.
- **Detector:** `recipientCoherence()` (scenario domain vs recipient-org domain); `--dump coh`. 0 false positives after fixing the "moved-into-apartment + bought-product" confound.
- **BUG exemplars (gen):** em79 tablet-warranty complaint → `"City Council Office"`; em81 smart-thermostat Wi-Fi issue → `"Campus Dining Services"`; em83 air-cooler malfunction → `"Hotel Reservations"`; em85 blender warranty → `"Building Management"`; em89 cutting-board engraving error → `"Library Services"`.
- **Gap:** **auto-rejectable.** A consumer/product complaint sent to a totally unrelated institution. Likely the `to` field was filled from a category template decoupled from the scenario.
- **Maps to:** generation post-validation — add a coherence check that the recipient org plausibly owns the scenario problem.

### D16 — Dangling reference in bullets · **solid** · ⚠ HARD DEFECT
- **Real:** **0/51**. **Current:** **4/139 (2.9%)**.
- **Detector:** `danglingRefs()` — bullet `"Thank/Tell <Name>"` or `"the <role>"` not present in recipient + scenario + direction; `--dump dang`. Validated: em104 ("the coordinator" is established in the direction line) correctly NOT flagged.
- **BUG exemplars (gen):** em80 recipient `"Student Housing Office"` but bullet `"Thank Jordan for prompt attention"` (Jordan undefined); em90 bullet `"Thank Deanor for prompt attention"` ("Deanor" is not even a valid name); em79 `"Tell the coordinator…"` to `"City Council Office"`; em89 `"Thank the specialist…"` to `"Library Services"`.
- **Gap:** **auto-rejectable.** Real bullets always refer to the recipient by pronoun ("her"/"him") or an already-named person. Gen leaks orphan names/roles from a different template.
- **Maps to:** generation post-validation — every name/role in a bullet must equal the recipient or appear in the scenario.

### D17 — Direction-line format · **solid** (constant)
- **Real (OCR-verified) & Current:** both use *"Write an email to [recipient]. In your email, do the following:"* — **Gap: none.**
- **NOTE:** the live screen also fixes `To:`/`Subject:` fields and appends *"Write as much as you can and in complete sentences."* — neither JSON stores this (harness-level). Confirmed in `.codex-tmp/ocr/3.30 写作.txt` etc.

---

## Correlations

1. **Recipient role ⇄ macro function (tight).** PEER recipients → planning/coordination (9/16 planning items) + advice-seeking; STAFF recipients → complaint+request-fix (11/14) and mixed-feedback (8/10); PROFESSOR → group-project complaint or appreciation. *Implication: draw role and function JOINTLY — peer ⇒ plan-an-event / ask-advice; service-manager ⇒ report-problem-then-suggest, or praise→critique→suggest. Generating them independently is what produces the off-distribution mixes.*

2. **First-bullet positive opener ⇄ mixed-feedback/appreciation arc.** When bullet 1 opens Thank / Mention-enjoyment / Describe-what-you-enjoyed / Reiterate-interest (12/51), 10/12 are mixed-feedback/appreciation/advice. *Implication: implement the 20% mixed-feedback target as the explicit arc bullet1=warm/relational → bullet2=problem (Describe/Explain) → bullet3=Suggest.*

3. **Complaint+request-fix ⇄ staff recipient + venue/product setting.** complaint+fix items (14) almost always go to a staff/service recipient (11/14) about a SERVICE/VENUE the writer is a customer/member of (gym, hotel, internet, appliance, library, catering) — not a corporate process. *Implication: authenticity = the complaint targets a service you paid for / attended, addressed to its manager.*

---

## Deferred / needs more data

- **Scenario exact length & sentence-count fidelity (partial):** real scenario *prose* in `email.json` is DeepSeek-expanded from a terser on-screen prompt (confirmed by `email.json` vs `.codex-tmp/ocr/*写作.txt`). D9/D10 targets are directional. To harden, OCR the literal on-screen scenario text for all 51 and re-measure.
- **Register/tone as a measured ratio (deferred):** the prompt bank contains no email *body*, so register (deferential vs polite vs casual) can only be inferred from recipient role (D7), not measured from text. True register calibration belongs to the SCORING prompt (`EMAIL_SYS_BASE` power-relationship rules) and would need graded student responses to validate.
- **Official-tier ground truth (partial):** only ~2 verifiable ETS-official email prompts exist publicly (poetry-magazine, Kevin-restaurant — see `data/REFERENCE_BANKS.md` / memory). All 51 here are recalled-tier; bullet wording is verbatim-faithful per OCR, but distributions are "real 2026 topics as recalled," not ETS-published. Treat ratios as strong signal, not gospel.
- **Subject capitalization style (deferred):** real mixes Title Case ('Request for Lecture Notes') and sentence case ('Feedback on dining experience') seemingly at random across recalls — likely a transcription artifact, not a controllable feature. No target.
