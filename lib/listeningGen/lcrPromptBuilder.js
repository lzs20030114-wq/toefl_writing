/**
 * Listen and Choose a Response (LCR) — Prompt builder
 *
 * 2026 TOEFL Listening Task 1:
 * - Test-taker hears ONE sentence
 * - Chooses the most appropriate RESPONSE from 4 options
 * - Tests pragmatic language understanding (implied meaning, context)
 * - Responses are "not so direct" — tests understanding of real conversation
 *
 * This is the simplest listening task: shortest audio, MCQ response.
 * Perfect as the first listening task to implement.
 */

const SCENARIO_POOL = [
  {
    context: "campus_life",
    situations: [
      "asking a librarian for help finding a book",
      "asking a professor about office hours",
      "talking to a classmate about a group project",
      "asking a residence advisor about a maintenance issue",
      "talking to a lab partner about an experiment",
      "asking the registrar about course enrollment",
      "discussing a cafeteria meal with a friend",
      "asking about a campus event at the student center",
      "talking to a tutor about writing help",
      "checking in at the campus health center",
      "discussing a study group meeting time",
      "asking about printing at the computer lab",
      "talking to a financial aid counselor",
      "asking about intramural sports sign-up",
      "discussing a campus shuttle schedule",
    ],
  },
  {
    context: "classroom",
    situations: [
      "asking the professor to repeat a point",
      "responding to a discussion question in class",
      "asking about an assignment deadline extension",
      "clarifying instructions for a lab report",
      "discussing a reading with a classmate before class",
      "asking about the grading rubric for an essay",
      "responding to a professor's feedback on a draft",
      "asking a question about the lecture material",
      "discussing a presentation topic with a partner",
      "asking about missing a class for a field trip",
    ],
  },
  {
    context: "daily_life",
    situations: [
      "ordering coffee at a campus café",
      "asking for directions on campus",
      "making a doctor's appointment by phone",
      "talking to a store clerk about a return",
      "asking a neighbor to keep the noise down",
      "discussing weekend plans with a roommate",
      "calling to check business hours",
      "asking about a lost item at the front desk",
      "talking to a landlord about a lease renewal",
      "arranging a ride with a friend",
    ],
  },
];

/**
 * Pragmatic functions to test — the key challenge of this task type.
 * Responses should require understanding the speaker's INTENT, not just words.
 */
const PRAGMATIC_FUNCTIONS = [
  "indirect_request",      // "It's really cold in here..." → offer to close window
  "suggestion",            // "Have you tried the writing center?" → suggesting help
  "polite_refusal",        // "I'd love to, but I have a deadline..." → declining
  "expressing_surprise",   // "You haven't started yet?!" → surprise at delay
  "seeking_confirmation",  // "So the exam is on Friday, right?" → double-checking
  "expressing_concern",    // "That doesn't look right..." → worried about something
  "offering_help",         // "Do you need a hand with that?" → volunteering
  "giving_advice",         // "If I were you, I'd talk to the professor" → recommending
  "expressing_agreement",  // "That's exactly what I was thinking" → concurring
  "making_an_excuse",      // "I would have come, but my car broke down" → explaining
  "changing_topic",        // "By the way, did you hear about..." → shifting
  "expressing_gratitude",  // "I really appreciate you staying late" → thanking
];

/**
 * Build prompt for generating LCR items.
 *
 * @param {number} count — items to generate (1-10)
 * @param {object} opts
 * @param {string[]} [opts.excludeIds] — IDs to avoid duplicating
 * @returns {string} prompt
 */
function buildLCRPrompt(count = 5, opts = {}) {
  const { excludeIds = [] } = opts;

  // Select diverse scenarios
  const selected = [];
  for (let i = 0; i < count; i++) {
    const ctx = SCENARIO_POOL[i % SCENARIO_POOL.length];
    const sit = ctx.situations[Math.floor(Math.random() * ctx.situations.length)];
    const pf = PRAGMATIC_FUNCTIONS[Math.floor(Math.random() * PRAGMATIC_FUNCTIONS.length)];
    selected.push({ context: ctx.context, situation: sit, pragmatic: pf });
  }

  const scenarioList = selected
    .map((s, i) => `${i + 1}. Context: ${s.context} | Situation: ${s.situation} | Pragmatic function: ${s.pragmatic}`)
    .join("\n");

  return `You are a TOEFL listening question writer for the 2026 format "Listen and Choose a Response" task.

## TASK DESCRIPTION

The test-taker hears ONE spoken sentence, then chooses the most appropriate response from 4 options. This tests PRAGMATIC understanding — the ability to understand what a speaker really means, not just the literal words.

## EXAMPLES (ETS-style)

EXAMPLE 1:
Speaker: "I thought you said the meeting was at three."
A. "Yes, it starts at three o'clock."
B. "Oh, sorry — it was moved to four. I should have told you."
C. "I don't usually go to meetings."
D. "Three is my favorite number."
Answer: B
Why: The speaker is expressing mild frustration/confusion about a schedule change. B acknowledges the misunderstanding.

EXAMPLE 2:
Speaker: "It's getting really stuffy in here, don't you think?"
A. "I stuffed it in my backpack."
B. "The weather forecast says rain tomorrow."
C. "Should I open a window?"
D. "I think the room is big enough."
Answer: C
Why: The speaker is making an INDIRECT REQUEST for fresh air. C responds to the implied meaning.

## REQUIREMENTS

1. **Speaker sentence**: Natural spoken English, 8-20 words. Must sound like real conversation — contractions, casual register, NOT formal writing.
2. **Pragmatic function**: The sentence should have an IMPLIED meaning beyond its literal words (indirect request, polite refusal, suggestion, etc.)
3. **Correct answer**: The ONLY response that appropriately addresses the speaker's intent.
4. **Distractors (3 wrong answers)**: Each must be wrong for a DIFFERENT reason:
   - One responds to the LITERAL meaning instead of the implied meaning
   - One is a plausible conversation line but IGNORES the speaker's point
   - One contains a word from the speaker's sentence but is irrelevant (word trap)
5. **All 4 options**: 5-15 words each, similar length, natural spoken register.
6. **Answer position**: CRITICAL — distribute A/B/C/D EVENLY across the batch. For ${count} items, assign answers in rotation: item 1→A, item 2→B, item 3→C, item 4→D, item 5→A, etc. Do NOT cluster answers on B or any single letter.

## SCENARIOS TO WRITE

${scenarioList}

## OUTPUT FORMAT

Return a JSON array:
\`\`\`json
[
  {
    "context": "campus_life",
    "situation": "asking a librarian for help",
    "speaker": "The sentence the test-taker will hear.",
    "pragmatic_function": "indirect_request",
    "options": {
      "A": "Response A text",
      "B": "Response B text",
      "C": "Response C text",
      "D": "Response D text"
    },
    "answer": "B",
    "explanation": "Why B is correct and why each other option is wrong.",
    "distractor_types": {
      "A": "literal_meaning",
      "C": "off_topic",
      "D": "word_trap"
    }
  }
]
\`\`\`

Generate exactly ${count} items. Return ONLY the JSON array, no markdown fencing.`;
}

module.exports = { buildLCRPrompt, SCENARIO_POOL, PRAGMATIC_FUNCTIONS };
