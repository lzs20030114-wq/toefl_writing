# Authentic ETS / TPO Reference Banks — Provenance & Methodology

This document records the **authentic reference questions** the project uses as
calibration ground truth across **all six question types** in the app.

The original audit (the "What changed in this pass" section below) covered the
three **2026 TOEFL iBT Writing** tasks (Build a Sentence, Write an Email, Writing
for an Academic Discussion — live since 2026-01-21). The three remaining
sections — **Reading, Listening, Speaking** — are documented under
[Reading / Listening / Speaking reference banks](#reading--listening--speaking-reference-banks).

### Current reference-bank inventory (last updated 2026-05-30)

| Question type | Reference items | ETS-official (verbatim) | Stored in |
|---------------|----------------:|------------------------:|-----------|
| Build a Sentence | 80 | 20 | `buildSentence/tpo_source.md` (+ structured `tpo_official.json`) |
| Academic Discussion | 129 | 4 | `academicWriting/real_tpo_reference.json` (85) + `recalled_supplement.json` (44) |
| Write an Email | 33 | 2 | `emailWriting/tpo_reference.json` (13) + `practice_supplement.json` (20) |
| Reading | 71 | 2 | `reading/samples/{academicPassage,completeTheWords,readInDailyLife}/` |
| Listening | 52 | 0 | `listening/samples/{la,lat,lc,lcr}-reference.json` |
| Speaking | 10 sets (55 items) | 0 | `speaking/samples/{interview,repeat}-reference.json` |

> **Authenticity at a glance:** Writing has genuine ETS-PDF official items; the
> Reading/Listening/Speaking banks are **predominantly third-party collected**
> (mostly goarno.io), with only **2** ETS-official items total (both Reading).
> See the per-section breakdowns below.

## On "2026 TPO real exams" (asked 2026-05-30)

TPO (TOEFL Practice Online) = ETS-published **retired real exam questions**. There
is **no 2026-format TPO**: the 2026 redesign went live 2026-01-21, so its items are
still in the active pool and none has been retired into a TPO release yet. The
**only** official 2026-format verbatim material ETS has published is what this repo
already holds: **Full-Length Practice Test 1 & 2** (all four sections + answer
keys), the **Writing Practice Sets** (2 Academic Discussions), and the **Reading
Practice Sets** (classic academic passages). Verified exhausted on 2026-05-30:
- Full-length tests 3+ **redirect to the ETS homepage** (don't exist).
- `toefl-ibt-speaking-practice-sets.pdf` exists but is the **retired pre-2026
  Independent/Integrated speaking format** (Explain-a-Choice / Integrated) — not
  the 2026 Listen-and-Repeat / Take-an-Interview tasks, so unused.
- The deepest authentic *recalled* (机经) source is examword.com's dated Academic
  Discussion archive — confirmed to span only **p≈1500–1543** (lower p= are
  generic stub pages with no discussion); all 44 already harvested into
  `recalled_supplement.json`. examword has **no** email/build-sentence/reading/
  listening recalled banks.

Per the project owner's directive, only 2026-format material is collected.
Legacy-format TPO reading/listening is intentionally **NOT** imported — its older
3-passage / long-lecture format would mismatch the 2026 calibration.

These references drive two things:
1. **Statistical calibration** — `lib/questionBank/etsProfile.js` and the stat
   blocks in `lib/ai/prompts/*.js` are derived from them (length/type/opener
   distributions, validation gates).
2. **Few-shot examples** injected into the generation prompts
   (`scripts/generateDiscQuestions.mjs`, etc.).

So authenticity matters: a question wrongly labeled "real" silently corrupts the
calibration. Every item is therefore tagged with a **tier**.

## Authenticity tiers

| tier | meaning | trust |
|------|---------|-------|
| `official` | Published by ETS itself; captured **verbatim** from an official ETS PDF / practice test. | Definitive. |
| `recalled` | Reconstructed from an **actual administered 2026 exam** (real topic + framing, third-party-reconstructed wording), dated & sourced. The 机经 / "真题" standard. | High (topic), medium (exact wording). |
| `uncertain` | Third-party practice prompt faithfully modeled on the task but **not** traceable to a specific ETS administration. | Practice only — NOT real. |

Items with no tier field are **legacy** (collected before this audit; provenance
unverified — treat as `uncertain` for calibration purposes).

## What changed in this pass

### Build a Sentence
- `data/buildSentence/tpo_source.md`: **60 → 80** items. Added **20 `official`**
  items (ETS 2026 Full-Length Practice Tests 1 & 2), each with a verified answer.
- `data/buildSentence/tpo_official.json` (NEW): the 20 official items in
  structured form — `prompt`, `blanks`, `chunks`, **`answer`** (from the test's
  Answer Key), and the identified **`distractors`**.
- Each official answer was machine-verified: every answer is reconstructable
  from its chunk pool + given words (coverage check, see parser).

### Writing for an Academic Discussion
- `data/academicWriting/real_tpo_reference.json`: **81 → 85**. Added **4
  `official`** items (`ad82`–`ad85`):
  - `ad82` Dr. Gupta / political science (education vs. environment) — Writing Practice Sets, Set 2
  - `ad83` Dr. Achebe / economics (most important invention) — Writing Practice Sets, Set 4
  - `ad84` Professor / social studies (mandatory volunteering) — Full-Length Test 1
  - `ad85` Professor / psychology (exercise vs. genetics) — Full-Length Test 2
- `data/academicWriting/recalled_supplement.json` (NEW): **44 `recalled`** items
  from real 2026 administrations (examword.com, `p=1500`–`1543`; 20 carry exam
  dates 2026-03-29 … 2026-05-18). Kept **separate** from the style reference on
  purpose — see "Calibration notes".
- **Total authentic AD stored: 129** (was 81).

### Write an Email
- `data/emailWriting/tpo_reference.json`: 13 items. `tpo1` (Sunshine Poetry) and
  `tpo2` (Kevin restaurant) are now confirmed **`official`** (they appear
  verbatim in ETS's 2026 Full-Length Practice Tests 1 & 2); `tpo2`'s scenario was
  corrected to the exact official wording. `tpo3`–`tpo13` remain legacy/unverified.
- `data/emailWriting/practice_supplement.json` (NEW): **20 `uncertain`** practice
  prompts (toeflresources.com, Magoosh, etc.), clearly labeled NOT real.
- **Honest ceiling:** ETS publishes only **2** official email samples publicly.
  Beyond those two, no verifiable real "Write an Email" prompts could be found
  (Chinese 机经 hubs were access-blocked; one prep site's 100-item "test bank"
  was rejected as AI-generated filler — its goals were tone instructions, not the
  content tasks real ETS email goals always use).

#

---

# Reading / Listening / Speaking (added 2026-05-30)

Same authenticity-first method, applied to the other three sections of the 2026
TOEFL iBT. **Source:** the two official ETS **Full-Length Practice Tests 1 & 2
(2026)** — the only on-format official R/L/S material with answer keys. All added
items are Tier-1 `official`, extracted **verbatim** (passages, transcripts,
prompts). Metadata (genre, difficulty, question type, speaker turns, per-sentence
word counts) is derived mechanically; `explanation` fields are left empty (not
fabricated).

**Answers are best-effort.** For reading/listening MC questions the correct
letter is taken from each module's answer-key table ONLY when the displayed
question number maps to an `[A-E]` row; otherwise it is `null` (never guessed).
The 2026 answer-key tables interleave Complete-the-Words letter fragments with MC
letters and can be number-misaligned, so some answers are null pending manual
confirmation. Passages/transcripts/stems/options themselves are verbatim.

## The project already had curated authentic banks — these were NOT modified
- Reading: `data/reading/samples/<task>/{ets_official,third_party,goarno}.json` (dir is globbed by `analyze-reading-samples.mjs`).
- Listening: `data/listening/samples/{lc,la,lat,lcr}-reference.json` (single-file; analyzers read this exact file).
- Speaking: `data/speaking/samples/{repeat,interview}-reference.json` (single-file).

The full-length-test content was written to **separate, non-destructive files** so
curated data and its calibration profiles are untouched.

## What was added (new files, 32 official items total)
- **Reading** — written into the globbed sample dirs, so `analyze-reading-samples.mjs` picks them up automatically:
  - `readInDailyLife/ets_fulllength.json` — **5** RDL items (curated `ets_official.json`: 1; bulk authentic RDL lives in `third_party.json`/`goarno.json`).
  - `academicPassage/ets_fulllength.json` — **8** AP items (curated `ets_official.json`: 0).
- **Listening** — separate files (per-type analyzers read only the single `*-reference.json`, so NOT auto-consumed yet — see follow-up):
  - `lc-fulllength.json` — **7** conversations · `la-fulllength.json` — **4** announcements · `lat-fulllength.json` — **4** academic talks
- **Speaking** — separate files (same single-file caveat):
  - `repeat-fulllength.json` — **2** Listen-and-Repeat sets · `interview-fulllength.json` — **2** Take-an-Interview sets

## Not added this pass
- **CTW (Complete the Words):** the full-length tests DO contain CTW passages, but the blanks schema (`original_word`/`displayed_fragment`/`position`) was not reverse-engineered here. Curated CTW bank (1) left as-is — a follow-up.
- **LCR (Listen & Choose a Response):** not an official 2026 iBT listening task. Curated lcr-reference left as-is.
- No recalled/practice items for R/L/S: passages/transcripts can't be reconstructed verbatim from exam recall, so authenticity could not be guaranteed (unlike short writing prompts).

## Follow-up to fully wire in (spawned as a background task)
The listening/speaking per-type analyzers consume a single `*-reference.json`.
Merge each `*-fulllength.json` into the matching `*-reference.json` array
(`items`/`samples`/`sets`), aligning the idiosyncratic per-task question sub-keys
first (AP uses `skill`; LC uses `answer`; RDL uses `question_type`/`qid`). Then
re-run the analyzers to regenerate the profiles.

## Reproduce
```
node scripts/research/rls_integrate.mjs   # parses .research/raw/ets-full-*.txt -> the files above; self-validates (exit 1 on any problem)
```
