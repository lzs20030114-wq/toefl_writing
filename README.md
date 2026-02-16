# TOEFL iBT Writing Practice (Next.js)

This project is a TOEFL Writing practice tool with 3 tasks:

- Task 1: Build a Sentence
- Task 2: Write an Email
- Task 3: Academic Discussion

It includes timed practice, AI scoring, structured feedback reports, progress history, and question bank quality gates.

## Features

### Task 1 (Build a Sentence, ETS-aligned v2)

- Set-based delivery: one set = **10 questions**
- Difficulty profile control for each 10-question set (ETS-like target mix)
- Chunk-based sentence building (multi-word chunks, not single-word tokens)
- Supports prefilled locked chunks (`prefilled`, `prefilled_positions`)
- Supports optional distractor chunk (`distractor`)
- Answer checking by normalized text match against `answer`
- Grammar point tagging (`grammar_points[]`) for weak-point summary
- Set rotation tracking with `localStorage` key: `toefl-bs-done-sets`

### Task 2/3 (Email / Discussion)

- Timed writing UI
- AI scoring with ETS-aligned prompts
- Structured report pipeline:
  - `===SCORE===`
  - `===GOALS===` (Email only)
  - `===ANNOTATION===`
  - `===PATTERNS===`
  - `===COMPARISON===`
  - `===ACTION===`
- Section-level fallback parsing (one section fails, others still render)

### Progress and Storage

- Session history persisted in browser `localStorage`
- Stores score details and grammar weakness traces
- Supports delete/clear history operations
- SSR-safe storage guards in `lib/sessionStore.js`

## Architecture

## App routes

- `app/page.js`: home menu
- `app/build-sentence/page.js`: Task 1
- `app/email-writing/page.js`: Task 2
- `app/academic-writing/page.js`: Task 3
- `app/progress/page.js`: progress page
- `app/api/ai/route.js`: AI proxy endpoint

## Core modules

- `components/buildSentence/BuildSentenceTask.js`
  - Task 1 UI rendering (instruction / active / review)
- `components/buildSentence/useBuildSentenceSession.js`
  - Task 1 runtime state machine (init, timer, drag/drop, submit, auto-submit)
- `lib/questionSelector.js`
  - Selects valid BS question set and rotates by set id
- `lib/questionBank/buildSentenceSchema.js`
  - BS schema validation (`validateQuestion`, `validateQuestionSet`)
- `lib/questionBank/qualityGateBuildSentence.js`
  - Quality gate wrapper for hard-fail + warning checks
- `lib/questionBank/sentenceEngine.js`
  - Shared sentence assembly engine used by render + scoring
- `lib/questionBank/renderResponseSentence.js`
  - Renders correct/user sentence from `answer + prefilled + user chunks`
- `lib/utils.js`
  - `evaluateBuildSentenceOrder` normalized answer matching
- `lib/ai/parse.js`
  - Parses structured AI report sections with fallbacks

## Build a Sentence v2 Data Schema

Question file: `data/buildSentence/questions.json`

Top-level:

```json
{
  "question_sets": [
    {
      "set_id": 1,
      "questions": []
    }
  ]
}
```

## Build Sentence Runtime Invariants

- Runtime question model is normalized to:
  - `answerOrder` (movable chunks)
  - `bank` (same members as `answerOrder`, shuffled for display)
  - optional fixed segment (`given/givenIndex`) for legacy items
- Slot count is always initialized as:
  - `slotCount = q.answerOrder.length`
- Runtime guards (in `useBuildSentenceSession`) enforce:
  - `q.bank.length === q.answerOrder.length`
  - `0 <= givenIndex <= q.answerOrder.length` (if given exists)
  - `answerOrder` is a permutation of `bank` (no duplicates / no missing)
- If a question violates invariants:
  - development: throw immediately with `id`
  - production: block invalid item and show data-error message instead of broken UI

This prevents the historical bug where all chunks could be placed while empty slots still remained.

## Build Sentence Difficulty Control (ETS 2026-aligned)

- Target ratio per 10-question set:
  - `easy`: 20%
  - `medium`: 50%
  - `hard`: 30%
- A heuristic estimator (`lib/questionBank/difficultyControl.js`) computes per-question difficulty from:
  - answer length
  - effective chunk count
  - distractor presence
  - embedded-question signal
  - prefilled-token reduction
- Strict validation fails on large ratio drift:
  - `npm run validate:bank -- --strict`
- Extended repeated check (50 rounds):
  - `node scripts/validate-bank-50.js`
- Generation pipeline (`scripts/generateBSQuestions.mjs`) retries when a generated set drifts too far from target ratio.
- Generator enforces exact 10-question mix before accepting a set:
  - `easy=2, medium=5, hard=3`
- You can rebuild balanced sets from an existing pooled bank:
  - `npm run rebuild:balanced:bank`

Each question:

```json
{
  "id": "ets_s1_q1",
  "prompt": "context shown to user",
  "answer": "Do you know ...?",
  "chunks": ["do", "you know", "what time", "..."],
  "prefilled": [],
  "prefilled_positions": {},
  "distractor": null,
  "has_question_mark": true,
  "grammar_points": ["indirect question", "passive voice"]
}
```

## Validation and generation

- Validate question bank:
  - `npm run validate:bank`
  - `npm run validate:bank -- --strict`
- Generate BS sets via API script:
  - `node scripts/generateBSQuestions.mjs`
  - optional envs:
    - `BS_TARGET_SETS` (default `6`)
    - `BS_CANDIDATE_ROUNDS` (default `40`)
    - `BS_EASY_BOOST_ROUNDS` (default `16`)
    - `BS_MIN_REVIEW_SCORE` (default `78`)
    - `BS_MIN_REVIEW_OVERALL` (default `84`)
  - generation pipeline:
    - online candidate generation
    - hard schema/runtime gate
    - AI quality scoring
    - difficulty-balanced assembly (`2 easy + 5 medium + 3 hard`)

## Legacy Input Compatibility (Testing Only)

- Runtime Task 1 uses only: `data/buildSentence/questions.json` (v2 set-based schema).
- `scripts/save-build-sentence-bank.js` still accepts some legacy fields for migration/testing:
  - `response` / `correctSentence` / `correctChunks(+responseSuffix)` -> `responseSentence`
  - `alternateAnswerOrders` / `alternateOrders` -> `acceptedAnswerOrders`
  - `alternateReasons` -> `acceptedReasons`
- When legacy fields are detected, the script prints a warning line starting with `[legacy-input]`.
- Recommendation:
  - New data should use the current schema directly.
  - Keep legacy input only for temporary backfill/regression tests.

## AI scoring calibration

- Calibration script:
  - `npm run calibration:test`
- Requires:
  - `DEEPSEEK_API_KEY` in environment
- Optional proxy for restricted networks:
  - `DEEPSEEK_PROXY_URL` (preferred), e.g. `http://127.0.0.1:10809`
  - fallback envs: `HTTPS_PROXY` / `HTTP_PROXY`
  - Note: current Node transport expects an `http://` or `https://` proxy URL.
    If you only have SOCKS (`socks5://`), enable an HTTP proxy port in your proxy client first.
- Purpose:
  - Re-run anchor samples and check score stability against expected ranges

## Local development

1. Install

```bash
npm install
```

2. Create `.env.local`

```bash
DEEPSEEK_API_KEY=your_key_here
```

3. Start dev server

```bash
npm run dev
```

4. Build

```bash
npm run build
```

## Test commands

- Unit tests: `npm run test:unit`
- E2E tests: `npm run test:e2e`
- Bank validation: `npm run validate:bank`
- Strict bank + difficulty profile validation: `npm run validate:bank -- --strict`
- Rebuild balanced 10-question sets: `npm run rebuild:balanced:bank`
- Calibration: `npm run calibration:test`

## Notes

- This is a practice tool, not an official ETS system.
- AI scoring is for learning guidance, not an official TOEFL score.
