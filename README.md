# TOEFL iBT Writing Practice (Next.js)

This project is a TOEFL Writing practice tool with 3 tasks:

- Task 1: Build a Sentence
- Task 2: Write an Email
- Task 3: Academic Discussion

It includes timed practice, AI scoring, structured feedback reports, progress history, and question bank quality gates.

## Features

### Task 1 (Build a Sentence, ETS-aligned v2)

- Set-based delivery: one set = **10 questions**
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
  - Task 1 interaction logic (drag/click chunks, timer, scoring, report)
- `lib/questionSelector.js`
  - Selects valid BS question set and rotates by set id
- `lib/questionBank/buildSentenceSchema.js`
  - BS schema validation (`validateQuestion`, `validateQuestionSet`)
- `lib/questionBank/qualityGateBuildSentence.js`
  - Quality gate wrapper for hard-fail + warning checks
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

## AI scoring calibration

- Calibration script:
  - `npm run calibration:test`
- Requires:
  - `DEEPSEEK_API_KEY` in environment
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
- Calibration: `npm run calibration:test`

## Notes

- This is a practice tool, not an official ETS system.
- AI scoring is for learning guidance, not an official TOEFL score.
