# Listening — Evaluation Spec (2026改后)

Foundational rubric for generating authentic TOEFL Listening items across four subtypes:
**LC** (Listen to a Conversation), **LA** (Listen to an Announcement), **LAT** (Listen to a Talk/Lecture),
and **short-response** (Listen and Choose a Response). Every target below is a *measured* number from the
real 2026改后 recalled bank, not an a-priori guess.

## Ground truth & a critical data caveat

| Subtype | File | n |
|---|---|---|
| Conversations | `data/realExam2026/listening/conversations.json` | 155 |
| Announcements | `data/realExam2026/listening/announcements.json` | 78 |
| Lectures | `data/realExam2026/listening/lectures.json` | 113 |
| Short-response | `data/realExam2026/listening/shortResponse.json` | 44 sets / **178 prompts** |
| Answer keys (letters) | `.codex-tmp/exam_txt/*参考答案*` | 658 listening answers |
| Recovered question stems | `.codex-tmp/exam_txt/*听力原文*` | 32 conv / 18 ann / 86 lec |

**Two data populations + ASR merge artifacts (read this before trusting any raw stat):**
- Only a minority of JSON items are clean OCR'd module items with multi-turn structure + 2 questions
  (conversations: 5 multi-turn, 15 with questions). The majority are **single-blob ASR transcripts** with
  no speaker labels and no questions (conversations 94/155; all announcements; all lectures).
- ASR sometimes **concatenates adjacent audio clips into one item**. These show up as length outliers:
  lectures >330w (6 items — verified to be 2–3 lectures glued, e.g. `2026-04-06_audio_talk7` = a Louis-Latimer
  history podcast + a Kandinsky art lecture + a glacier fragment), conversations >150w
  (`2026-03-20_audio_conversation8` = chess club + archaeology podcast), announcements >150w
  (`audio_announcement4/5` high-index items). **All length targets below use clean filters that drop these.**
- Question stems & all MCQ options live in the 听力 **image PDFs**, not the audio JSON. Stem *phrasings* are
  recoverable from OCR; reliable stem *type ratios* and option/distractor logic are **deferred** (see end).

Reliability of the 20 dimensions: **18 solid, 1 partial, 1 deferred.**

---

## A. Conversation (LC) dimensions

### A1. Conversation length — `solid`
- **What**: total words across all turns.
- **Target**: median **89**, mean 90, band **68–102** (p10–p90), range 53–110. n=155 (OCR-module and audio-ASR
  subsets agree at median 89).
- **Detector**: sum words in `conversation[].text`; exclude >150w as ASR merges.
- **Verbatim real examples**:
  - `2026-01-21_m1_conversation1` (71w): *"Man: Hi. I need to return this sweater. I bought it yesterday, but it's too small for me. Woman: Sure. Do you have the receipt? … Woman: No problem. I will get another in that color for you from our stock. Man: Thank you."*
  - `2026-02-10_m1_conversation2` (96w, peer): *"A: Did you end up seeing that movie yesterday…? B: …There were lots of unexpected twists, but it was too long. … B: I'm not sure I'd pay money to see it in the theater. Just wait a few months and it will be out on streaming."*
  - **Counter (EXCLUDE)**: `2026-03-20_audio_conversation8` (323w) — two unrelated audio clips merged by ASR.
- **Current bank**: median **138**, mean 142, min 100, max 188 (n=23).
- **Gap**: generated is ~55% too long; generated *minimum* (100w) exceeds the real *median*.
- **Maps to**: `lcPromptBuilder.js:9` & `:496` ("100–180 words"); `DIFFICULTY_TIERS:161–176`.

### A2. Conversation turn count — `solid`
- **What**: content turns (speaker exchanges), excluding the "Listen to a conversation" lead-in.
- **Target**: median **6**, mean 5.6, band **4–7**. Histogram {3:1, 4:9, 5:14, 6:21, 7:14}, n=59. Exactly 2 speakers,
  strictly alternating; **no third speaker ever observed**.
- **Detector**: count `Man:`/`Woman:` tags per OCR block minus 1 lead-in; cross-checked vs 5 JSON multi-turn items (5,6,7,7,7).
- **Current bank**: median **9**, mean 9.1, max 10 (n=23); generated min (7) sits at real p90.
- **Gap**: too many turns. Prompt says "8–12 turns"; real is 3–7.
- **Maps to**: `lcPromptBuilder.js:9` & `:494` ("8–12 turns total").

### A3. Conversation relationship — `solid`
- **What**: peer/social vs service-transaction vs advising.
- **Target**: **peer/social 78–97% (overwhelming majority)**; service-transaction 3–12%; advising ~5–10%.
  (Two heuristics bracket the true value; either way peer dominates massively.)
- **Detector**: service signals (receipt/refund/return/front-desk/booking/appointment/office-hours) vs peer
  (recommendations, plans, opinions, shared experience).
- **Verbatim real examples**:
  - PEER: `2026-01-27_m1_conversation1-B` — *"I've been thinking about getting a new couch for my dorm room. Do you have any recommendations?"*
  - PEER: `2026-04-13_audio_conversation10` — *"Have you checked out the new restaurant downtown? The sushi is made by an award-winning chef…"*
  - SERVICE (minority): `2026-01-21_m1_conversation1` — sweater return at a store counter.
- **Current bank**: **52% service-transaction**, 48% peer (n=23).
- **Gap**: **Biggest LC authenticity gap.** Generated leans on student↔staff service desks (library/IT/transport/
  dining/mail/security). Real is the opposite — casual peer chats about food, music, hobbies, plans, dorm life.
- **Maps to**: `lcPromptBuilder.js:20–71` `SCENARIO_POOL` (library .25 + campus_services .25 are mostly student_staff service).

### A4. Conversation topic domain — `partial`
- **What**: topic realism.
- **Target**: everyday/social topics dominate — shopping & returns, food/dining & cooking tips, music & arts,
  hobbies/clubs, travel/plans, transport schedules, roommate/dorm life, part-time jobs, errands. Mix of campus-set
  and general-life; **not** dominated by campus-service problems.
- **Verbatim real examples**: music recs (`audio_conversation9`: *"I'm getting bored listening to the same old pop
  singers. Any recommendations?"*); cooking tips (`audio_conversation9`: *"I want to buy some cheese for the dinner
  party… Parmesan if you're serving pasta"*); part-time job (`2026-05-06_audio_conversation1`: potato-chip factory).
- **Current bank**: campus-service problems (noise complaint, parking permit, broken printer, missing package, WiFi).
- **Maps to**: `lcPromptBuilder.js:20–71` situations.

### A5. Conversation register (contractions) — `solid`
- **Target**: **~4.5 contractions / 100w**, 99% of items contain ≥1.
- **Detector**: regex over ~40 common contractions / words (verified on physics lecture: 5/249).
- **Current bank**: **6.2 / 100w** — slightly over-casual but acceptable.
- **Maps to**: `lcPromptBuilder.js:500–502`.

### A6. Speaker label convention — `solid`
- **Target**: generic **`Man` / `Woman`** (exactly 2, alternating); no names, no roles in the transcript. Question
  stems refer to "the man"/"the woman".
- **Current bank**: first names (Casey, Sarah, Avery…).
- **Gap**: format/convention mismatch (minor for TTS, but stems should say "the man"/"the woman").
- **Maps to**: `lcPromptBuilder.js:75–83` + `:493`.

---

## B. Announcement (LA) dimensions

### B1. Announcement length — `solid`
- **Target**: median **83**, mean 82, band **71–88**, range 46–150. n=68 clean (exclude >150w merges).
- **Verbatim real examples**:
  - `2026-01-21_m1_announcement3-B` (83w, campus radio): *"Due to yesterday's heavy rainstorms, a major leak has
    developed in the roof of the library… the library will be closed until noon on Wednesday…"*
  - Classroom: *"I'm pleased to announce that we'll have a guest speaker next week as part of our unit on
    environmental policy. Dr. Maya Tan will join us on Thursday…"*
  - **Counter (EXCLUDE)**: `2026-03-20_audio_announcement4` (249w) — two announcements glued.
- **Current bank**: median **92**, mean 90 (n=31) — closest-matching length of all four subtypes; slightly long.
- **Maps to**: `laPromptBuilder.js:8`, `:505`, `:533` ("80–120 words").

### B2. Announcement opener pattern — `solid`
- **Target**: **Attention… 21%**; Good morning/afternoon… 17%; Direct statement ~12%; first-person professor
  (I'm pleased / I have / I want) ~6%; Thank you… 6%; Due to/Since (cause) 6%; We… (institutional) 5%; Hello/Welcome
  + rhetorical-question hooks present. **No opener exceeds ~21%.**
- **Detector**: strip `Man:/Woman:` AND embedded setting lead-in, classify first 45 chars (~10% residual noise).
- **Verbatim real examples**: *"Attention students, faculty, and staff. Due to the upcoming Spring Alumni
  Weekend…"* · *"Good morning, students. Before we get started today…"* · *"Due to yesterday's heavy rainstorms…"*
- **Current bank**: **Attention 48%**, Good morning 19%, reminder 10% (n=31).
- **Gap**: generated over-uses "Attention" (48% vs 21%). **The prompt's "64% Attention" claim is FALSE** against
  real 2026 data. First-person-professor and "Due to…" cause-openers are entirely missing from the bank.
- **Maps to**: `laPromptBuilder.js:111–148` `OPENING_PATTERNS` (rate:64); `:516–520`.

### B3. Announcement context / purpose — `solid`
- **Target**: **classroom/course 36%** (professor: guest speaker, syllabus, assignment); campus_event/activity 29%;
  facility/logistics 12%; tour/exhibit 9% (art-exhibit walkthrough). **Campus/university radio** is a recurring
  *setting* (~9 of 35 specified). Settings are richly specified in real data (75/78 non-generic).
- **Verbatim real settings**: *"Listen to an announcement in a university classroom."* · *"…at a school art
  exhibit."* · *"…on a campus radio station."* · *"…at a university gym."* · *"…at a university club meeting."*
- **Current bank**: `CONTEXT_POOL` = facility_change 21% / academic_event 21% / campus_activity 14% / others 7%.
  **No classroom/course type, no art-exhibit type, no campus-radio setting.**
- **Gap**: real's #1 context (classroom professor announcements) is absent; generated over-indexes facility_change.
- **Maps to**: `laPromptBuilder.js:21–109` `CONTEXT_POOL`.

### B4. Announcement register (contractions) — `solid`
- **Target**: **~1.9 / 100w**, 71% contain ≥1 — semi-formal, lightly contracted.
- **Current bank**: **0.40 / 100w** — ~5× too few; reads bureaucratic.
- **Gap**: generated announcements are too stiff; real ones (esp. classroom) contract naturally ("we'll", "we're").
- **Maps to**: `laPromptBuilder.js:531`.

---

## C. Lecture / Talk (LAT) dimensions

### C1. Lecture length — `solid`
- **Target**: median **250**, mean 246, band **220–258**, range 192–279. Very tight single peak.
  Histogram (25w bins) {200:10, 225:40, 250:51, 275:5}. n=107 clean (exclude >330w merges; clean ceiling ~280).
- **Verbatim real examples**:
  - `2026-01-27_m1_lecture1-B` (245w, art history): *"Expressionism is an influential modernist art movement that
    emerged in the early 20th century. This movement is characterized by its focus on representing emotional
    experience rather than physical reality…"*
  - `2026-01-21_m1_lecture1` (249w, physics): *"We've been talking about the law of inertia… The key is to lean in.
    Weight needs to shift in the direction of the turn…"*
  - **Counter (EXCLUDE)**: `2026-04-06_audio_talk7` (505w) — three clips concatenated.
- **Current bank**: median **167**, mean 159, min 123, **max 189** (n=14).
- **Gap**: **LARGEST GAP.** Every generated lecture (max 189) is *below* the real *minimum* (192). ~33% too short.
  (The prompt header was corrected 2026-05-31 to "200–330 mean 258", but the May-14 bank predates the fix and must
  be regenerated.)
- **Maps to**: `latPromptBuilder.js:8` (header now correct; bank stale).

### C2. Lecture academic domain — `solid`
- **Target**: **arts_humanities 30%** (art/art-history/music/architecture/literature/creative-writing);
  social_sci 20% (psych/econ/business/marketing/sociology); phys_earth_sci 17%; life_sci 16%;
  history_humanities 10%. **Arts + humanities combined ≈ 40%.** Single most common specific field = **art history
  (12%, 13/113)**, then psychology 9, physics 8, biology 8, music 7, architecture 6.
- **Detector**: extract explicit field label ("in a/at a/on a X class/podcast") → broad domain (verified: 13
  art-history all explicitly labeled).
- **Verbatim real examples**: *"Listen to a talk in an art history class. Last week we talked about realism…"* ·
  *"…at a music class. If you're familiar with ancient Greece…"* · *"…in an architecture class. Have you ever
  thought about how ancient concrete structures…"*
- **Current bank** (n=14): bio 2, psych 2, social_psych 2, cog_psych 1, neuro 1, eco 1, env_sci 1, anthro 1,
  history 1, geology 1, art_history 1 → **~64% sciences/psychology, ~14% arts/humanities**.
- **Gap**: generated is science/psych-dominated; only 1 art_history, **0 music, 0 architecture, 0 literature**. Real's
  largest bucket is arts/humanities. Major topic-domain gap.
- **Maps to**: `latPromptBuilder.js:19+` `TOPIC_POOL` (biology/ecology/psych families heavily weighted).

### C3. Lecture register (contractions) — `solid`
- **Target**: **~1.2 / 100w** — academic, lightly conversational (far below conversation's 4.5).
- **Current bank**: **5.0 / 100w** — 4× too casual. Generated openings read like chat
  (*"Okay, so today we're diving into… Now, you might think… And here's the thing… Actually…"*).
- **Maps to**: `latPromptBuilder.js:9` ("Conversational academic register") — over-applied.

### C4. Lecture 2nd-person address & rhetorical opener — `solid`
- **Target**: "you/your" in opener ~**21%**; rhetorical-question opener ~**14%** — occasional hooks, not the default.
  Most real lectures open declaratively ("Expressionism is…", "Migratory birds travel…").
- **Verbatim real hook**: *"When you think of 19th century inventors, what comes to mind?"*
- **Current bank**: you-address **86%**, rhetorical-Q opener **43%** (n=14) — systematically too chatty.
- **Maps to**: `latPromptBuilder.js:9` + structure/reference examples.

### C5. Lecture question count — `solid`
- **Target**: **4 questions** per lecture (mode 4 across 23 OCR blocks; lower counts are OCR truncation).
- **Current bank**: 4 per item — matches. No gap.
- **Maps to**: `latPromptBuilder.js:11`.

---

## D. Short-response (Listen and Choose a Response) dimensions

### D1. Prompt length — `solid`
- **Target**: median **8**, mean 7.9, band **6–11**, range 3–14. n=178.
- **Verbatim real examples**: *"Where can I find the class notes?"* (6w) · *"Can you turn down the volume?"* (6w) ·
  *"I don't know how many people will join us tonight for study group."* (13w).
- **Current bank (LCR `speaker`)**: median **10**, mean 10.2 (n=113) — ~25% too long.
- **Maps to**: `lcrPromptBuilder.js` speaker-sentence construction (no length cap toward 8w).

### D2. Prompt sentence type — `solid`
- **Target**: **questions 74%** (wh-questions **49%**, yes/no-questions **24%**); statements **26%**; imperatives ~1%.
- **Detector**: ends-with-`?`→question; first word who/what/where/when/why/how/which/whose→wh; else yes/no.
  **Must strip leaked `Man:/Woman:` labels first** (pre-strip badly undercounts wh). Hand-verified first 12 (6 wh / 3 y-n / 3 stmt).
- **Verbatim real examples**: wh — *"Who is the guest lecturer today?"*, *"Why is the air conditioner in the dorm
  not working?"*; yes/no — *"Did you enjoy the gardening class?"*; statement — *"Peter said he would look for
  supplies."*, *"Maybe the power went out for this whole area."*
- **Current bank**: questions 68% (**wh 7%**, yes/no 61%), statements 32% (n=113).
- **Gap**: question/statement ratio is fine, but **wh-questions = 7% vs real 49%** — the bank almost never opens with
  Who/Where/Why/How, losing the dominant real prompt form.
- **Maps to**: `lcrPromptBuilder.js:12` ("statements 30%, questions 70%" — ratio right; wh/yn balance unspecified, drifted to yes/no).

### D3. Prompt campus vs general — `solid`
- **Target**: ~**40% campus/academic**, ~60% general everyday.
- **Verbatim real examples**: campus — *"Who is the tutor in the student success center today?"*; general —
  *"Can you turn down the volume?"*, *"Maybe the power went out for this whole area."*
- **Current bank**: **65% campus** (n=113) — too campus-heavy; real has more domestic/general-life prompts.
- **Maps to**: `lcrPromptBuilder.js:17–70` `SCENARIO_POOL` (campus_academic .375 + campus_daily .3125 ≈ 69%).

### D4. Distractor trap-logic (short-response) — `partial`
- **Target**: dominant trap for a wh-prompt = distractors that answer a **different wh-dimension**.
- **Verbatim exemplar** (1.21A M1 Q1, options from OCR, correct from key=B):
  - Prompt: *"Where can I find the class notes?"*
  - A. *After my class.* (answers **When**) · **B. *Check on the class website.* ✓** · C. *They are 36 pages long.*
    (answers length) · D. *They use the standard format.* (answers format)
- **Current bank LCR**: encodes paradigms (`context_shift/idiomatic/counter_question/marker_led/direct`) +
  distractor types (`semantic_association_trap/off_topic/wrong_question_type`). The real "wrong-wh-dimension" trap
  maps to `wrong_question_type` — present, but cannot measure its real *frequency* from structured data.

---

## E. Cross-subtype dimensions

### E1. Answer-position distribution — `solid`
- **Target**: **A 24% / B 28% / C 28% / D 20%** (mild middle-bias, D rarest). n=658 listening answers.
- **Detector**: parse single-letter answers from listening sections of all `*参考答案*` files.
- **Current bank**: over-clusters on B (LAT B=44%, LC B=37% vs real 28%) and starves D (LC D=11% vs real 20%); the
  strict position pre-assignment isn't fully obeyed by the model.
- **Note**: real ETS is itself mildly B/C-biased — target ~A24/B28/C28/D20 rather than forcing 25/25/25/25.
- **Maps to**: "Answer position pre-assignment" in all builders (`lc:331–338`, `la:364–371`, lat/lcr headers).

### E2. Question count per item — `solid`
- **Target**: conversation **2**, announcement **2**, lecture **4**; short-response = standalone 1-prompt + 4-option item.
- **Current bank**: matches (2/2/4). No gap.

### E3. Question stem phrasing — `deferred`
- **Verbatim real stems** (recovered from OCR; *type* ratios unreliable):
  - Conversation: *"Why is the man returning the sweater?"*, *"What will the woman most likely do next?"*,
    *"What are the man and the woman talking about?"*, *"What is the man's problem?"*,
    ***"What does the man imply when he says, '…'?"*** (replay/quote), **"What is the man's attitude toward …?"**
  - Lecture: *"What is the purpose/main topic of the talk?"*, *"What does the speaker mainly discuss?"*,
    *"What does the speaker suggest/imply about X?"*, **"Why does the speaker mention X?"** (hallmark function Q).
  - Announcement: *"What is the purpose of the announcement?"*, *"What will the speaker probably do next?"*,
    *"What can be inferred about X?"*, *"What … does the speaker emphasize/stress?"*
- **Gap**: LC prompt lacks the **quote-replay** ("What does the man imply when he says, '…'?") and **attitude** stem
  types. LAT should foreground "Why does the speaker mention X?" function stems.
- **Maps to**: `lc:182–204`, `la:249–272`, lat STEM patterns.

---

## Correlations

1. **Register tracks subtype, and the bank collapses the gradient.** Real contraction density is a clean ladder:
   **conversation 4.5 > announcement 1.9 > lecture 1.2** per 100w. The bank inverts it: LAT 5.0 (too chatty) and
   LA 0.40 (too stiff). A lecture that sounds like a chat — or an announcement that sounds like a memo — is the #1
   register tell.
2. **Length, turns, relationship, and casualness co-define a real conversation.** Real conv is jointly short (89w),
   few-turn (6), peer/social (78–97%), contraction-rich (4.5). The bank drifts every dimension the same way (138w /
   9 turns / 52% service). **Fixing the topic→peer-chat will naturally pull length and turns down** — they are one
   underlying variable, not four.
3. **Arts/humanities dominance is the lecture-domain authenticity signal.** Real lectures are ~40% arts+humanities
   (art history alone 12%, the single most frequent field), only ~33% sciences. The bank is ~64% sciences/psychology.
   "Feels like real TOEFL" ⇒ over-weight art history, music, architecture, history — not biology/psychology.
4. **Short-response difficulty = wh-question with cross-dimension distractors.** Real short-response is 49%
   wh-questions; the trap is options that answer a *different* wh-word (Where → When/How-long/Format). The bank is
   61% yes/no with only 7% wh, losing the dominant real difficulty mechanism.

---

## Deferred / needs more data

- **Question stem TYPE distribution** (main_idea/detail/inference/function/attitude/replay ratios per subtype):
  stems live in image PDFs; JSON carries questions for only ~15% of items. OCR recovers *verbatim* stems (32 conv /
  18 ann / 86 lec) but type-classification is noisy (short-response prompts leak into section blocks). Needs a
  dedicated clean OCR pass on the question PDFs.
- **MCQ option text & distractor trap-logic for LC/LA/LAT**: options are image-rendered, absent from audio JSON.
  `.codex-tmp/ocr/` contains option text for short-response (and could be mined) but parsing is messy (no A/B/C/D
  labels; artifacts like "I'mnotsure"). Distractor-type *frequencies* can't be measured reliably yet.
- **Difficulty-tier split (easy/medium/hard)**: real items carry no difficulty label and length is unimodal (no
  easy/medium/hard clusters). The prompts' 30/45/25 split is **unverifiable** — do not treat it as evidence-based.
- **Exact conversation peer-vs-service ratio**: bracketed at 78–97% peer by two heuristics; the precise number is
  partial (the direction — "large majority peer" — is solid).
