# Evaluation Spec — Writing · Academic Discussion (`ad`)

**Ground truth:** `data/realExam2026/writing/academicDiscussion.json` — 50 items (recalled 2026改后, tier=recalled). **Caveat:** this structured file only extracted `professor_question` (the final question), NOT the full professor post. The full posts (opener + two-sided framing + question) were hand-transcribed from the OCR image dumps in `.codex-tmp/ocr/*写作*.txt` into `scripts/research/ad_eval/prof_posts_real.json` (n=36 recoverable full posts) — this is the source for the highest-value style dimensions.
**Current generated bank:** `data/academicWriting/prompts.json` — 144 items (ids ad61–ad204), 288 student posts.
**Generation profile/prompt:** `lib/ai/prompts/academicWriting.js` — `buildDiscGenSystemPrompt` / `buildDiscGenUserPrompt`, plus the exported pools `DISC_OPENING_STYLES`, `DISC_COURSE_LIST`, `DISC_STUDENT_NAMES`.
**Measurer:** `scripts/research/ad_eval/measure.mjs` + `measure2.mjs`; detectors hand-validated in `validate.mjs` / `validate2.mjs`.
**Reliability of inputs:** student text + length = solid (structured). Full professor post (opener/framing/contraction/name) = solid but n=36 (the 36 items with a recoverable full OCR post; the ~14 earliest Jan/Feb items had the post buried in noisy full-exam dumps). Per-item difficulty = deferred (no label; task is human-scored on the test-taker's essay).

> **The task:** the test-taker sees a professor's discussion-board post (a mini-lecture that stages a two-sided debate and asks a question) and two classmates' short replies, then writes their own ≥100-word reply. The item's job is to read **exactly like a real ETS 2026改后 discussion board**: a `Dr. <Surname>` professor, a `We've been discussing…` opener, a balanced `Some… / Others…` frame, a `Why?`-tagged question, and two short, formulaic, cleanly-opposed student replies named from a four-name pool.

---

## How the real items actually read (bottom-up)

Every real 2026改后 item is built from a rigid, recognizable template that the current generator reproduces almost none of by default:

```
Dr. Gupta                                              ← name is "Dr. <Surname>", NOT "Professor"
We've been discussing the impact of cultural           ← opener: 1st-person-plural class recap
globalization on local traditions. Some anthropologists ← two-sided frame: "Some X argue A,
argue that cultural globalization leads to the loss       while others believe B"
of unique and diverse cultural identities, while
others believe it promotes cultural exchange and
understanding. What is your perspective on the          ← question (often + "Why?" / "Why or why not?")
impact of cultural globalization on local traditions?

Kelly:  I believe cultural globalization can lead to    ← S1 opens "I believe/think", ≈40 words,
         the loss of unique cultural identities. ...        3 sentences, abstract reasoning
Andrew:  In my opinion, cultural globalization promotes  ← S2 opens "In my opinion", opposed stance,
         cultural exchange ...                              does NOT name Kelly
```

The single most important contrast: **the generated bank produces a `"Professor"` named poster that opens with abstract factual background (`"Many countries have experienced…"`), rarely stages a two-sided frame, asks without a `Why?` tag, and produces long (≈72-word, 4–5-sentence) anecdote-heavy students drawn from a 50-name pool, with Student 2 frequently addressing Student 1 by name.** Real 2026改后 is the opposite on every one of those axes.

A second structural fact: **real ETS re-uses a small topic pool.** Only 33/50 items have a distinct question core; "cultural globalization → local traditions" recurs 5×, "globalization → local economies" 4×, "nature vs nurture" 3×, "role of government in the economy" 3×. The generator instead *maximizes* topic novelty (it dedupes against `existingTopics`).

---

## Dimensions

Grouped: **Professor post** (D1–D9) · **Student posts** (D10–D18) · **Pools** (D19–D21).

### D1 — Professor name format · **solid** · ⚠ TOTAL MISMATCH
- **What:** the name label shown above the post.
- **Real:** `Dr. <Surname>`, 49/50 (the 1 blank is an OCR drop). The surname comes from a **three-name pool: Dr. Gupta ×32, Dr. Diaz ×9, Dr. Achebe ×8.**
- **Detector:** `/^Dr\. /`; tally surnames.
- **Verbatim:** `Dr. Gupta` · `Dr. Achebe` · `Dr. Diaz`.
- **Current gap:** 144/144 = literal `"Professor"`, 0% `Dr. X`.
- **Maps to:** `buildDiscGenSystemPrompt` "Use \"Professor\" as the name (94% of real TPO uses this exact string)" and the output-format `"name": "Professor"`. That 94% figure is **old TPO**; for 2026改后 it is wrong — emit `Dr. <Surname>` from {Gupta, Diaz, Achebe}.

### D2 — Professor opener style · **solid** · ⚠ BIGGEST STYLE GAP
- **What:** the opening clause class.
- **Real (n=36):** `We've been discussing/talking/exploring` **22 (61%)** · `This week we (have been)` 5 (14%) · `Today we'll / Today's` 4 (11%) · `We often discuss` 2 · `These days` 1 · topic-first/definition 2.
- **Detector:** regex on first clause (`profOpener`); hand-verified line-by-line across all 36.
- **Verbatim:** `"We've been discussing the impact of cultural globalization on local traditions."` · `"This week, we have been exploring the effects of globalization on local economies."` · `"We often discuss the impact of government intervention in the economy."`
- **Current gap:** gen `"We've been discussing"` = **1/144 (0.7%)**. Gen's biggest bucket is `other/topic-first` 93/144 (65%) — i.e. the abstract factual leads `"Many countries have experienced…"`, `"In recent decades…"`, `"The practice of tipping…"` — which is exactly the **BAD** opener the system prompt itself warns against. Plus `Today` 26, `As we discussed` 15, `Over the next few weeks` 6.
- **Maps to:** `DISC_OPENING_STYLES` — the 52%-weighted `"natural"` bucket gives the model permission to write abstract openers, and **no template encodes the real signature `"We've been discussing <topic>."`** Add it as the dominant (~60%) opener.

### D3 — Professor two-sided framing · **solid** · ⚠ MAJOR
- **What:** does the post lay out BOTH sides before asking?
- **Real (n=36):** any explicit contrast device **29/36 (81%)**; the canonical `Some X argue A … Others believe B` adjacency **20/36 (56%)**. The 7 without an explicit device still embed the tension in the question (`"…mostly beneficial, or should we be more cautious…"`).
- **Detector:** `hasContrast()` — `Some <experts>` present AND (`Others` | `while others` | `On the other hand` | `However, some` | `But critics`). Canonical = `/Some[^.]*\.\s*Others/` or `/Some…, while others/`.
- **Verbatim:**
  - `"Some economists argue that globalization leads to economic growth … Others hold that it can harm local businesses and lead to job losses …"`
  - `"Some experts believe that genetics play the most significant role … while others argue that our environment and experiences are more important."`
- **Boundary (no explicit frame, tension in the question):** `"We've been exploring how social media platforms influence public opinion … Do you think its influence is mostly beneficial, or should we be more cautious about its reach and impact?"`
- **Current gap:** gen broad contrast 42/144 (29%); canonical 35/144 (24%). Most generated posts give one-directional background then a question.
- **Maps to:** `buildDiscGenSystemPrompt` "Provide concrete context" — should be upgraded to mandate the `Some… / Others…` balanced staging in ~80% of posts.

### D4 — Professor contractions · **solid**
- **What:** share of posts with ≥1 true contraction (possessives excluded).
- **Real (n=36):** **72%** have ≥1; mean 0.7/post — almost entirely the opener `We've`.
- **Detector:** `/\b(we've|it's|i'm|don't|we're|let's|that's|we'll|you're|can't|won't|doesn't|isn't|aren't)\b/gi`.
- **Verbatim:** `"We've been discussing…"` · `"Today we'll discuss…"` · `"I'm curious to learn your thoughts."`
- **Current gap:** gen 24% / mean 0.3. **Mostly a side-effect of D2** — fixing the opener brings this along.
- **Maps to:** the prompt's contraction guidance is already reasonable ("about 1 in 3 posts"); the real rate is higher (72%) because of the `We've` opener.

### D5 — Professor final question stem · **partial**
- **What:** type of the final question.
- **Real (structured n=50):** binary-or (`X or Y?`) ~26% · open (`What do you think / your view / perspective`) ~28% · binary (`Do you think X?`) ~few · which-choice ~6% · plus many varied. (Transcribed n=36 agrees.)
- **Detector:** `questionType()` on the last `?`-clause.
- **Verbatim:** `"Do you think globalization has a positive or negative impact on local economies? Why?"` · `"What do you think is the most effective role of government in the economy?"` · `"Which do you think has a greater impact on human development: nature or nurture? Why?"`
- **Current gap:** small — the generator already varies stem type via the `questionType` param. The real issue is the wrapper (D6), not the type mix.

### D6 — Professor `Why?` tag · **solid**
- **What:** share of questions ending with `Why?` / `Why or why not?` / `Why do you think so?` / `Explain your views`.
- **Real (n=36):** **53%**.
- **Detector:** `/Why(\?| or why not\?| do you think so\?)|Explain your (views|reasoning)|Give reasons/i`.
- **Verbatim:** `"…on local traditions? Why?"` · `"…in shaping societal values? Why or why not?"` · `"…mostly negative? Explain your views."`
- **Current gap:** gen 18%. Cheap, high-authenticity fix — append a `Why?`/`Why or why not?` tag ~half the time.

### D7 — Professor defines/glosses the key term · **partial**
- **What:** share of posts that gloss the central term in a sentence.
- **Real (n=36):** **~30%** (11/36).
- **Detector:** `/refers to|are unwritten rules|, which includes|includes novels|involves the ability/i`.
- **Verbatim:** `"Globalization refers to businesses and economies becoming interconnected and interdependent worldwide."` · `"Social norms are unwritten rules that dictate how individuals should act."` · `"Emotional intelligence involves the ability to recognize, understand, and manage our own emotions …"`
- **Current gap:** not instructed. Adding an optional one-sentence gloss (~⅓ of posts) increases mini-lecture realism.

### D8 — Professor post length · **solid**
- **What:** length in words / chars.
- **Real (n=36):** mean **65w / 450ch**, median 71w/472ch, range 46–80w (322–650ch), p25 53w, p75 77w.
- **Detector:** whitespace word count of the full post.
- **Current gap:** gen mean 73w/500ch, max 108w/723ch — ~8w longer on average with a long tail the real bank never reaches (real cap ~80w). Tighten target to ~65w (≈450ch), hard-max ~80w.
- **Maps to:** `buildDiscGenSystemPrompt` "Target ~420 chars … do NOT artificially cap at 400" — the 420 target is fine; the issue is the long tail (cap it).

### D9 — Professor post sentences · **solid**
- **Real (n=36):** mean **4.7**, median 4, range 3–7.
- **Current gap:** gen mean 4.1 — minor; rises naturally once opener + frame + Why-tag are added.

### D10 — Students per item · **solid**
- **Real:** 2 (47/50; the 1/0 cases are OCR truncations). **Current:** 144/144 = 2. **Gap: none.**

### D11 — Student post length · **solid** · ⚠ STILL OFF
- **What:** length in words / chars.
- **Real (n=96):** mean **42.7w / 293ch**, median 40w/275ch, range 17–77w (116–586ch), p25 35w, p75 50w.
- **Detector:** whitespace word count per student post.
- **Verbatim:** `"They provide a platform for dialogue and cooperation between countries and can help mediate conflicts before they escalate."` (short, 1 sentence) · the canonical full-length one: `"I think nurture has a greater impact on human development. Our environment and experiences shape our beliefs, behaviors, and personalities. While genetics provide a foundation, it is our interactions and experiences that truly define who we become."`
- **Current gap:** gen mean **72w / 463ch** — ~1.7× too long; gen MIN (45w) is above the real MEDIAN (40w). The system prompt was annotated "recalibrated 2026-05-31 to ~40-45 words", but **the live bank predates that and was never regenerated** (or the instruction isn't being honored). Regenerate, or audit why the instruction isn't taking.
- **Maps to:** `buildDiscGenSystemPrompt` STUDENT RESPONSES "~40–45 words each … Keep them TIGHT."

### D12 — Student post sentences · **solid**
- **Real (n=96):** mean **3**, median 3 (p25=p75=3), range 1–6. = stance + 1 reason (+ maybe 1 elaboration).
- **Current gap:** gen 4.2. Same root cause as length.

### D13 — Student opener · **solid** · ⚠ big gap
- **What:** opener-class share.
- **Real (n=96):** `I believe/think` **54 (56%)** · `In my opinion` **20 (21%)** · bare-thesis (no I-frame) 17 (18%) · `While/Although` 3 · `Yes/No`/`I oppose` 2.
- **Detector:** `openerClass()`; the 17 "other" hand-verified to be bare thesis statements.
- **Verbatim:** `"I believe living alone is beneficial because…"` · `"In my opinion, certain information should be confidential…"` · bare-thesis: `"Customer feedback is essential for product development. It helps companies understand…"`
- **Current gap:** gen barely uses `In my opinion` (2/288 vs real 21%); gen's 48% "other" bucket is varied/creative openers (`In my view`, `Honestly`, `Actually`, `I strongly support`, `I hold a different view from <Name>`) instead of the plain bare-thesis. Real students are **formulaic** — ~77% are `I believe/think` + `In my opinion`.
- **Maps to:** `buildDiscGenSystemPrompt` STUDENT VOICES "occasional filler phrases like 'I mean,', 'honestly,'" — this pushes the wrong way for 2026改后. Constrain S1→`I believe/think`, S2→`In my opinion` more often.

### D14 — Student canonical opener pairing · **solid**
- **What:** items where S1 opens `I believe/think` AND S2 opens `In my opinion`.
- **Real (n=47):** **38%** (18/47).
- **Detector:** S1 `/^I (believe|think)/` AND S2 `/^In my opinion/`.
- **Verbatim:** S1 `"I think nurture has a greater impact…"` / S2 `"In my opinion, nature has a more significant role."`
- **Current gap:** ~0% (gen S2 opens with a named concession instead). Strong authenticity tell the generator never produces.

### D15 — Student 2 references Student 1 by name · **solid** · ⚠ PURE ARTIFACT
- **What:** share of items where S2 names S1.
- **Real (n=47):** **0%** — cross-checked against ALL student names, zero hits. Real students post independent stances as if they hadn't read each other.
- **Detector:** S1 name as `\bword\b` in S2 text.
- **Counter-example (what NOT to do — from the generated bank):** `"I hold a different view from Claire. While interactive whiteboards are useful…"` · `"While Sarah makes a good point about increasing participation, I hold a different view."`
- **Current gap:** **52/144 = 36%** of gen items have S2 name S1.
- **Maps to:** `buildDiscGenUserPrompt` has an explicit `s2ReferencesS1 === true` branch ("Student 2 MUST reference Student 1 by name") calibrated to old TPO ("37% of real TPO does this"). For 2026改后 force `s2ReferencesS1 = false` always.

### D16 — Student stance contrast type · **solid**
- **What:** clean opposing vs peer-directed nuance.
- **Real (n=47):** clean opposing stances **35 (74%)**; 12 contain a `While/Although` hedge — but on inspection **all 12 are intra-argument hedges against the abstract counter-view, not acknowledgment of the other student; 0 name the peer.**
- **Detector:** `concessiveRe` on either student; clause context hand-inspected to confirm intra-argument vs peer-directed.
- **Verbatim (intra-argument hedge, the only allowed kind):** `"While transparency is important, businesses need to safeguard proprietary information and strategic plans to stay competitive."` · `"While genetics provide a foundation, it is our interactions and experiences that truly define who we become."`
- **Current gap:** gen 50% nuanced, and gen's concessions are frequently **peer-directed** ("I see the point about X but…", "While Sarah makes a good point"). Push generator toward clean opposing stances; allow only abstract `While X, Y` hedges, never peer-named ones.

### D17 — Student concrete/personal example · **solid** · ⚠ INVERTED vs prompt intent
- **What:** share of student posts with a concrete/personal example.
- **Real (n=96):** **9.4%** (9/96); first-person pronoun mean 1.3/post. Real student posts are mostly **abstract principle-level reasoning.**
- **Detector:** `/my (cousin|uncle|parents|family|friend|hometown|old school)|For example|for instance|I remember|when I|At my/i`.
- **Verbatim (the rare personal one):** `"My parents own a store and have difficulty competing with global delivery services."` · `"I remember the time when I played volleyball in my first year of college…"`
- **Current gap:** gen **30%** with concrete/personal example; first-person mean 2.2. The system prompt pushes hard for anecdote (`"At my old school…"`, `"My cousin works in retail…"`), producing the opposite of the real abstract/expository voice.
- **Maps to:** `buildDiscGenSystemPrompt` STUDENT VOICES "Use personal experience and concrete examples" — overweighted for 2026改后. The authentic voice is general/expository.

### D18 — Student length differential · **solid** (low priority)
- **Real (n=47):** ≤30ch 55% · 31–100ch 28% · 100+ch 11%; mean 36ch.
- **Current gap:** gen leans equal (≤30ch 51%, 31–100ch 49%, **0 items >100ch**). Real allows an occasional clearly-longer student; gen caps the gap. The prompt's "35/43/22" differential note is old-TPO; 2026改后 leans more equal.

### D19 — Student name pool · **solid** · ⚠ STRONG CHEAP TELL
- **What:** share of student names from the 2026改后 closed pool.
- **Real (n=94):** **100% from exactly four names — Claire ×31, Andrew ×25, Paul ×21, Kelly ×17.** (One OCR artifact `"I think"` as a name — ignore.)
- **Detector:** tally `student[].name`; membership in {Claire, Paul, Andrew, Kelly}.
- **Current gap:** gen uses a 50-name diverse pool (Emily, Olivia, Ryan, Cameron, Sarah, Joe, Steve, Mia, David…); Claire/Paul present but diluted.
- **Maps to:** `DISC_STUDENT_NAMES` (50 names, old-TPO diversity). For 2026改后 restrict to {Claire, Paul, Andrew, Kelly}.

### D20 — Course area pool · **solid**
- **What:** course-area distribution.
- **Real (n=50):** narrow social-science/business/humanities band — economics 6, psychology 5, marketing 5, education 5, anthropology 5, business ethics 4, sociology 4, educational psychology 3, literature 2, then single instances (international relations, ethics, business management, technology, advertising, social psychology, history, art history, communications, life skills).
- **Detector:** course tally (lowercased).
- **Current gap:** gen uses **66 distinct courses**, many never seen in real (marine biology, robotics, paleontology, fashion design, veterinary science, game design, real estate, dance, forestry, oceanography, pharmacy…). The `DISC_COURSE_LIST` was trimmed to 13 to match old TPO, but the live bank predates that trim and still contains the sprawl. Real 2026改后 stays in the band above.
- **Maps to:** `DISC_COURSE_LIST` (13 entries — already closer; the live bank needs regenerating against it, and even it could be re-weighted toward economics/psychology/marketing/education/anthropology).

### D21 — Topic recurrence · **solid**
- **What:** does the bank re-use a small topic pool (real) or maximize novelty (gen)?
- **Real:** only **33/50 distinct question cores (66% unique); 35/50 distinct question strings.** Top recurring topics: cultural globalization→local traditions **5×**, globalization→local economies **4×**, nature vs nurture **3×**, role of government in economy **3×**, corporate transparency 2×, project-based learning 2×, EI vs technical skills 2×, advertising impact 2×, social media & public opinion 2×.
- **Detector:** cluster `professor_question` by content-word signature.
- **Verbatim:** `"Do you think globalization has a positive or negative impact on local economies? Why?"` recurs at 3.21, 3.23, 4.1, 5.10.
- **Current gap:** gen forces topic UNIQUENESS via `existingTopics` avoidance in `buildDiscGenUserPrompt`. For drilling realism, **weighting toward the recurring real topics is more authentic than maximizing variety** — a student who has done 10 of these should keep seeing globalization/nature-nurture/government, because that is what the real exam keeps asking.

---

## Correlations

1. **The authenticity bundle (professor post).** The single strongest "feels like 2026改后" signal is the four-part professor template that co-occurs in the majority of real items and co-*fails* in the generated bank: **`Dr. Gupta` (D1) + `We've been discussing <topic>.` (D2) + `Some <experts> argue A; Others believe B.` (D3) + question ending `Why?` (D6).** Fixing the opener (D2) also drags contractions (D4) up for free, because the contraction *is* `We've`. A generated post can match every numeric length target and still read as fake if it misses this bundle.

2. **Student formulaicity.** Real student posts cluster tightly: short (≈43w / 3 sentences, D11/D12), opener `I believe/think` (S1) paired with `In my opinion` (S2) 38% of the time (D14), abstract reasoning with only 9% personal example (D17), clean opposing stances (D16), no peer naming (D15), names from four (D19). The generator's "sound like a real college student with personal anecdotes, varied openers, occasional 'honestly,'" instruction pushes the **opposite** direction on D11, D13, D15, D16, D17 simultaneously. For 2026改后 the authentic student voice is a **short, formulaic, expository model-answer**, not a lively forum poster.

3. **Difficulty ≠ length.** Unlike Build-a-Sentence or Listen-and-Repeat, there is no length→difficulty signal here. Item "difficulty" is carried by the **question framing** (a `Which of these two approaches…` / `X or Y? Why?` that forces a genuine choice between two articulated positions) and by how cleanly the two student stances oppose — not by post length. Longer posts are not harder.

---

## Deferred / needs more data

- **Per-item difficulty rating.** Real items carry no difficulty label, and the task is human-scored on the test-taker's essay, so item difficulty can't be derived from the prompt alone. No ground-truth signal.
- **Exact opener-frequency precision.** The opener split (D2: 61/14/11) is from n=36 transcribed posts (the items with a recoverable full post), not all 50; the ~14 earliest Jan/early-Feb items had the post buried in noisy full-exam OCR dumps. Direction is unambiguous (`We've been` dominates) but the precise percentages are ±a few points.
- **Whether bare `"Professor"` ever appears in 2026改后.** Across 36 transcribed + 50 structured items it never did (always `Dr. <Surname>`). High confidence it should be banned, but 0% can't be *proven* from a 50-item sample.
- **Student surface-grammar imperfection rate.** The prompt allows "1 mild imperfection per student." Real recalled posts are reconstructed (OCR+DeepSeek), so their surface grammar is not a reliable witness to what the on-screen posts actually contained. Source can't support this dimension.
