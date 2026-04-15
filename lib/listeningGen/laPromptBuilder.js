/**
 * Listen to an Announcement (LA) — Prompt builder
 *
 * 2026 TOEFL Listening Task:
 * - Test-taker hears a campus/classroom announcement (50-120 words)
 * - Answers 2-3 MCQ with 4 options each
 * - Tests detail, inference, and main idea comprehension
 *
 * Announcements are short, informational, and delivered by one speaker
 * (professor, librarian, administrator, etc.)
 */

const SCENARIO_POOL = [
  {
    context: "campus",
    situations: [
      "library hours change due to renovation",
      "building closure for maintenance",
      "event cancellation due to weather",
      "schedule change for shuttle bus",
      "parking notice about lot closure",
      "emergency drill announcement",
      "cafeteria menu change for the week",
      "registration deadline reminder",
      "guest lecturer visiting campus",
      "club meeting location change",
      "new printing policy at computer lab",
      "campus gym holiday hours",
      "student ID replacement procedure",
      "campus bookstore sale announcement",
      "dormitory quiet hours reminder",
    ],
  },
  {
    context: "classroom",
    situations: [
      "exam format change from essay to multiple choice",
      "assignment due date extension",
      "field trip logistics and meeting point",
      "guest speaker joining next class",
      "office hours change for the week",
      "grading policy update for late submissions",
      "project group assignments posted",
      "textbook edition update",
      "lab safety protocol reminder",
      "reading assignment for next week",
      "midterm review session announcement",
      "peer review workshop details",
      "class cancellation and makeup session",
      "research paper topic deadline",
      "extra credit opportunity announcement",
    ],
  },
];

/**
 * Question types for announcement comprehension.
 */
const QUESTION_TYPES = [
  "detail",       // What specific information was given?
  "inference",    // What can be inferred from the announcement?
  "main_idea",    // What is the main purpose of the announcement?
];

/**
 * Build prompt for generating LA items.
 *
 * @param {number} count — items to generate (1-10)
 * @param {object} opts
 * @param {string[]} [opts.excludeIds] — IDs to avoid duplicating
 * @returns {string} prompt
 */
function buildLAPrompt(count = 5, opts = {}) {
  const { excludeIds = [] } = opts;

  // Select diverse scenarios
  const selected = [];
  for (let i = 0; i < count; i++) {
    const ctx = SCENARIO_POOL[i % SCENARIO_POOL.length];
    const sit = ctx.situations[Math.floor(Math.random() * ctx.situations.length)];
    // Assign 2 or 3 questions per item, alternating
    const numQ = (i % 2 === 0) ? 2 : 3;
    selected.push({ context: ctx.context, situation: sit, num_questions: numQ });
  }

  const scenarioList = selected
    .map((s, i) => `${i + 1}. Context: ${s.context} | Situation: ${s.situation} | Questions: ${s.num_questions}`)
    .join("\n");

  return `You are a TOEFL listening question writer for the 2026 format "Listen to an Announcement" task.

## TASK DESCRIPTION

The test-taker hears a short campus or classroom ANNOUNCEMENT (50-120 words), then answers 2-3 multiple-choice questions. The announcement is delivered by one speaker (a professor, librarian, administrator, etc.) and conveys practical information.

## EXAMPLES (ETS-style)

EXAMPLE:
Announcement: "Attention students. The library will be closing early this Friday at 5 PM instead of the usual 10 PM due to electrical maintenance. All study rooms must be vacated by 4:45 PM. The library will resume normal hours on Saturday morning. If you need to access reserved materials over the weekend, please check them out before Thursday evening. We apologize for any inconvenience."

Q1 (detail): Why is the library closing early on Friday?
A. A staff training event
B. Electrical maintenance work
C. A holiday celebration
D. Budget cuts to operating hours
Answer: B

Q2 (inference): What should students who need reserved materials do?
A. Wait until Saturday to get them
B. Ask a librarian to deliver them
C. Check them out before Thursday evening
D. Request digital copies online
Answer: C

## REQUIREMENTS

1. **Announcement text**: 50-120 words. Natural spoken English — sounds like a real announcement. Include specific details (times, dates, locations, names) that questions can target. The speaker should be identifiable by role (professor, librarian, dean, etc.)
2. **Speaker role**: Specify who is making the announcement (e.g., "librarian", "Professor Johnson", "campus security officer")
3. **Questions**: 2-3 MCQ per announcement. Each question tests a DIFFERENT skill:
   - **detail**: Asks about a specific fact stated in the announcement
   - **inference**: Requires reasoning about what is implied but not directly stated
   - **main_idea**: Asks about the overall purpose or main point
4. **Options**: 4 choices (A/B/C/D) per question, 5-15 words each, similar length
5. **Distractors**: Plausible but clearly wrong. One should use words from the announcement misleadingly.
6. **Answer position**: Distribute A/B/C/D answers EVENLY across all questions in the batch. Rotate: Q1->A, Q2->B, Q3->C, Q4->D, etc.
7. **Explanation**: Brief explanation for each question's correct answer.

## SCENARIOS TO WRITE

${scenarioList}

## OUTPUT FORMAT

Return a JSON array:
\`\`\`json
[
  {
    "context": "campus",
    "situation": "library hours change due to renovation",
    "speaker_role": "librarian",
    "announcement": "The full announcement text here, 50-120 words.",
    "questions": [
      {
        "question_type": "detail",
        "question": "The question text?",
        "options": {
          "A": "Option A text",
          "B": "Option B text",
          "C": "Option C text",
          "D": "Option D text"
        },
        "answer": "B",
        "explanation": "Why B is correct."
      }
    ]
  }
]
\`\`\`

Generate exactly ${count} items. Return ONLY the JSON array, no markdown fencing.`;
}

module.exports = { buildLAPrompt, SCENARIO_POOL, QUESTION_TYPES };
