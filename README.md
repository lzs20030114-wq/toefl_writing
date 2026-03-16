# TreePractice — TOEFL iBT Writing 2026 Practice Platform

Full-stack TOEFL iBT 2026 Writing Section practice tool with AI scoring, covering all three tasks of the new format. Built with Next.js, deployed on Vercel, backed by Supabase.

**Live:** [treepractice.com](https://treepractice.com)

## Three Tasks

| Task | Type | Description |
|------|------|-------------|
| **Task 1** | Build a Sentence | Drag-and-drop word chunks to form grammatically correct sentences. 10 questions per set, timed. Supports prefilled words, distractors, and back-navigation. |
| **Task 2** | Write an Email | Read a scenario, write an email addressing 3 goals. AI scores on task completion, organization, and language (0–5 scale). |
| **Task 3** | Academic Discussion | Read a professor's prompt and two student responses, then contribute your own position. AI scores on argument quality and language (0–5 scale). |

## Core Features

- **AI Scoring & Feedback** — DeepSeek-powered evaluation with structured reports: score + band, line-by-line annotations (grammar/spelling/expression), pattern analysis, model essay comparison, and actionable improvement suggestions.
- **Mock Exam** — Full 3-task timed simulation (Task 1 → 2 → 3) with unified scoring and CEFR band mapping.
- **Practice Mode** — Untimed, topic-selectable practice for Pro users. Grammar-point categories for Task 1, free topic choice for Task 2/3.
- **Progress Tracking** — Cloud-synced session history (Supabase) with score trends, grammar weakness analysis, and per-task breakdowns. Falls back to localStorage when offline.
- **Mobile-First** — Full `100dvh` flex layouts, touch drag-and-drop for Task 1, optimized overlays with scroll containment.
- **Monetization** — Free tier (3 sessions/day) and Pro tier (unlimited, full reports, practice mode). Afdian payment integration with tab-switch polling.

## AI Scoring Report Sections

Task 2/3 reports are parsed from structured AI output into independent sections, each with fallback rendering:

| Section | Content |
|---------|---------|
| `SCORE` | 0–5 score, band label, summary |
| `GOALS` | Per-goal completion status (Email only) |
| `ANNOTATION` | Line-by-line markup — red (grammar/spelling), orange (expression), blue (advanced) |
| `PATTERNS` | Recurring error patterns with frequency |
| `COMPARISON` | Model essay with side-by-side comparison points |
| `ACTION` | Top 2 weakness cards with importance + concrete action |

Free users see full annotations and macro feedback. Model essay comparison is Pro-only (blurred).

## Tech Stack

- **Frontend:** Next.js 14 (App Router), React, inline styles
- **Backend:** Next.js API routes, Supabase (PostgreSQL + Auth)
- **AI:** DeepSeek V3.2 for scoring and question generation
- **Hosting:** Vercel
- **Payment:** Afdian (Chinese sponsor platform)
- **CI/CD:** GitHub Actions for automated question generation (all 3 tasks)

## Question Generation Pipelines

Automated via GitHub Actions (`workflow_dispatch`):

| Workflow | Script | Model | Notes |
|----------|--------|-------|-------|
| `generate-bs.yml` | `generateBSQuestions.mjs` | DeepSeek (gen) + Claude Sonnet (review) | Multi-AI pipeline: planner → generator → 2x reviewer. ETS-aligned difficulty control. |
| `generate-email.yml` | `generateEmailQuestions.mjs` | DeepSeek | Category-forced distribution (6 categories), name diversity pool, validation gates. |
| `generate-disc.yml` | `generateDiscQuestions.mjs` | DeepSeek | Few-shot from real TPO examples, course-weighted distribution, 4 question types. |

## Project Structure

```
app/
  build-sentence/       Task 1 page
  email-writing/        Task 2 page
  academic-writing/     Task 3 page
  mock-exam/            Mock exam shell
  progress/             History & progress
  admin*/               Admin dashboard pages
  api/
    ai/                 AI proxy endpoint
    usage/              Daily usage tracking
    auth/               Login code verification
    admin/              Admin APIs (codes, feedback, errors, users)

components/
  buildSentence/        Task 1 UI + session hook
  writing/              Task 2/3 shared: WritingTask, FeedbackPanel, ScoringReport
  mockExam/             Mock exam orchestration
  home/                 Homepage (desktop + mobile)
  history/              Progress views
  shared/               UI primitives, modals, gates

lib/
  ai/                   AI client, prompts, response parsing
  annotations/          Annotation parser (markup → segments)
  questionBank/         BS schema, runtime model, difficulty control
  mockExam/             Mock state machine, planner, storage
  history/              View model transforms

scripts/
  generateBSQuestions.mjs       Task 1 generation
  generateEmailQuestions.mjs    Task 2 generation
  generateDiscQuestions.mjs     Task 3 generation
  validate-bank.js              BS question bank validation

data/
  buildSentence/        Question sets + reserve pool
  emailWriting/         Email prompts
  academicWriting/      Discussion prompts
```

## Local Development

```bash
npm install
cp .env.example .env.local   # fill in API keys
npm run dev                   # http://localhost:3000
```

Required env vars — see `.env.example` for full list:

```
DEEPSEEK_API_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_DASHBOARD_TOKEN=...
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run test:unit` | Unit tests |
| `npm run test:e2e` | E2E tests |
| `npm run validate:bank` | Validate BS question bank |
| `npm run validate:bank -- --strict` | Strict validation with difficulty check |
| `npm run calibration:test` | AI scoring calibration |

## Admin

- `/admin` — Hub (requires `ADMIN_DASHBOARD_TOKEN`)
- `/admin-codes` — Login code management
- `/admin-users` — User growth & activity stats
- `/admin-feedback` — User feedback review
- `/admin-api-errors` — API failure logs
- `/admin-questions` — Question bank browser
- `/admin-generate` / `/admin-generate-bs` — Manual question generation triggers

Database setup: run `scripts/sql/login-code-management.sql` in Supabase SQL Editor.

## Notes

- This is a practice tool, not an official ETS product.
- AI scoring is for learning guidance, not an official TOEFL score.
