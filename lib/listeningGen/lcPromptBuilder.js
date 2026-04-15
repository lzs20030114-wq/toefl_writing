/**
 * Listen to a Conversation (LC) — Prompt builder
 *
 * 2026 TOEFL Listening Task:
 * - Test-taker hears a short campus/everyday conversation (8-12 turns, ~100-200 words)
 * - Two speakers with defined roles
 * - Answers 2 MCQ with 4 options each
 * - Tests understanding of conversational details and implied meaning
 */

const SCENARIO_POOL = [
  {
    context: "campus",
    situations: [
      { desc: "student asking professor about office hours", speakers: [{ role: "student" }, { role: "professor" }] },
      { desc: "student asking librarian for research help", speakers: [{ role: "student" }, { role: "librarian" }] },
      { desc: "student meeting academic advisor about course selection", speakers: [{ role: "student" }, { role: "advisor" }] },
      { desc: "student asking TA about assignment requirements", speakers: [{ role: "student" }, { role: "teaching_assistant" }] },
      { desc: "two students forming a study group", speakers: [{ role: "student" }, { role: "student" }] },
      { desc: "student asking admin staff about registration", speakers: [{ role: "student" }, { role: "admin_staff" }] },
      { desc: "student calling IT help desk about login issue", speakers: [{ role: "student" }, { role: "it_staff" }] },
      { desc: "student talking to dorm RA about noise complaint", speakers: [{ role: "student" }, { role: "resident_advisor" }] },
      { desc: "student discussing internship with career counselor", speakers: [{ role: "student" }, { role: "career_counselor" }] },
      { desc: "student asking lab technician about equipment", speakers: [{ role: "student" }, { role: "lab_technician" }] },
    ],
  },
  {
    context: "daily_life",
    situations: [
      { desc: "roommates discussing apartment chores", speakers: [{ role: "roommate" }, { role: "roommate" }] },
      { desc: "friends deciding where to eat at cafeteria", speakers: [{ role: "student" }, { role: "student" }] },
      { desc: "student returning an item at campus store", speakers: [{ role: "student" }, { role: "store_clerk" }] },
      { desc: "student discussing lease renewal with landlord", speakers: [{ role: "student" }, { role: "landlord" }] },
      { desc: "friends planning a weekend trip", speakers: [{ role: "student" }, { role: "student" }] },
      { desc: "student checking in at campus health center", speakers: [{ role: "student" }, { role: "receptionist" }] },
    ],
  },
];

// Common first names for speaker assignment
const SPEAKER_NAMES = [
  "Alex", "Jordan", "Sam", "Taylor", "Morgan",
  "Casey", "Jamie", "Riley", "Quinn", "Avery",
  "Emily", "David", "Sarah", "Michael", "Lisa",
  "James", "Maria", "Kevin", "Rachel", "Brian",
];

/**
 * Build prompt for generating LC items.
 *
 * @param {number} count — items to generate (1-10)
 * @param {object} opts
 * @param {string[]} [opts.excludeIds] — IDs to avoid duplicating
 * @returns {string} prompt
 */
function buildLCPrompt(count = 5, opts = {}) {
  const { excludeIds = [] } = opts;

  // Select diverse scenarios with random speaker names
  const selected = [];
  const usedNames = new Set();
  for (let i = 0; i < count; i++) {
    const ctx = SCENARIO_POOL[i % SCENARIO_POOL.length];
    const sit = ctx.situations[Math.floor(Math.random() * ctx.situations.length)];

    // Assign unique names to speakers
    const names = [];
    for (const sp of sit.speakers) {
      let name;
      do {
        name = SPEAKER_NAMES[Math.floor(Math.random() * SPEAKER_NAMES.length)];
      } while (usedNames.has(name) || names.includes(name));
      names.push(name);
    }
    usedNames.clear(); // Reset per item to allow reuse

    selected.push({
      context: ctx.context,
      situation: sit.desc,
      speakers: sit.speakers.map((sp, j) => ({ name: names[j], role: sp.role })),
    });
  }

  const scenarioList = selected
    .map((s, i) => `${i + 1}. Context: ${s.context} | Situation: ${s.situation} | Speaker 1: ${s.speakers[0].name} (${s.speakers[0].role}) | Speaker 2: ${s.speakers[1].name} (${s.speakers[1].role})`)
    .join("\n");

  return `You are a TOEFL listening question writer for the 2026 format "Listen to a Conversation" task.

## TASK DESCRIPTION

The test-taker hears a SHORT everyday/campus conversation between exactly 2 people (8-12 turns, approximately 100-200 words total). Then answers 2 multiple-choice questions about the conversation.

## EXAMPLES (ETS-style)

EXAMPLE:
Speakers: Lisa (student), Professor Adams (professor)
Conversation:
Lisa: "Professor Adams, do you have a minute? I wanted to ask about the research paper."
Prof Adams: "Sure, Lisa. Come on in. What's on your mind?"
Lisa: "Well, I'm having trouble narrowing down my topic. I started with climate change, but that's too broad."
Prof Adams: "That's a common issue. What aspect interests you most?"
Lisa: "I've been reading about coral reef bleaching. Could I focus on that?"
Prof Adams: "Absolutely. That's specific enough. Just make sure you find at least five peer-reviewed sources."
Lisa: "Got it. Is the library database the best place to look?"
Prof Adams: "Yes, try the biology section. And come to office hours if you need help with the outline."

Q1 (detail): What problem does Lisa have with her research paper?
A. She cannot find enough sources
B. Her topic is too broad
C. She missed the submission deadline
D. She does not understand the assignment
Answer: B

Q2 (inference): What will Lisa likely do next?
A. Change her topic to climate change
B. Drop the course
C. Search for sources about coral reef bleaching
D. Ask another professor for help
Answer: C

## REQUIREMENTS

1. **Conversation**: 8-12 turns total between exactly 2 named speakers. Each turn is one speaker's line. Total word count: 100-200 words (across all turns).
2. **Natural dialogue**: Use contractions, hesitations, casual register. Speakers should sound like real people — NOT scripted or formal.
3. **Speaker roles**: Each speaker has a name and role. The conversation should reflect the power dynamic (student-professor vs friends).
4. **Questions**: Exactly 2 MCQ per conversation.
   - One should test a specific **detail** from the conversation
   - One should test **inference** — what is implied or what will happen next
5. **Options**: 4 choices (A/B/C/D) per question, 5-15 words each, similar length
6. **Answer position**: Distribute A/B/C/D answers EVENLY across all questions in the batch.
7. **Explanation**: Brief explanation for each question's correct answer.

## SCENARIOS TO WRITE

${scenarioList}

## OUTPUT FORMAT

Return a JSON array:
\`\`\`json
[
  {
    "context": "campus",
    "situation": "student asking professor about office hours",
    "speakers": [
      { "name": "Lisa", "role": "student" },
      { "name": "Professor Adams", "role": "professor" }
    ],
    "conversation": [
      { "speaker": "Lisa", "text": "Professor Adams, do you have a minute?" },
      { "speaker": "Professor Adams", "text": "Sure, come on in." }
    ],
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

module.exports = { buildLCPrompt, SCENARIO_POOL, SPEAKER_NAMES };
