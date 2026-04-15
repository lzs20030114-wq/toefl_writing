/**
 * Prompt builder for Take an Interview question generation.
 *
 * Each set: 4 questions with difficulty progression:
 *   Q1 — personal/factual (easy)
 *   Q2 — descriptive (medium)
 *   Q3 — analytical (medium-hard)
 *   Q4 — evaluative/abstract (hard)
 */

const CATEGORY_SPECS = {
  personal: {
    label: "Personal Experience",
    difficulty: "easy",
    guidance: "Ask about familiar personal experiences, daily routines, or straightforward preferences. Should be answerable by any student regardless of background.",
    examples: [
      "What is your favorite way to spend free time on campus?",
      "Describe a typical weekday morning for you.",
      "What kind of food do you usually eat for lunch?",
    ],
  },
  campus: {
    label: "Campus Life",
    difficulty: "medium",
    guidance: "Ask about campus activities, student organizations, or university experiences that require some description and explanation.",
    examples: [
      "Describe a campus event that you found particularly memorable.",
      "What changes would you suggest to improve your university's library?",
      "How do you balance studying with extracurricular activities?",
    ],
  },
  academic: {
    label: "Academic Topics",
    difficulty: "medium-hard",
    guidance: "Ask about study habits, learning strategies, academic challenges, or educational topics that require analysis.",
    examples: [
      "What are the advantages and disadvantages of online learning compared to in-person classes?",
      "How has technology changed the way students study?",
      "What makes a university course truly engaging for students?",
    ],
  },
  opinion: {
    label: "Opinion / Preference",
    difficulty: "hard",
    guidance: "Ask abstract or evaluative questions that require forming and defending an opinion, considering multiple perspectives, or hypothetical reasoning.",
    examples: [
      "Some people believe that standardized testing is the best way to evaluate students. Do you agree? Why or why not?",
      "If you could redesign the education system, what one change would you make?",
      "Is it more important for young people to develop practical skills or theoretical knowledge?",
    ],
  },
};

const QUESTION_ORDER = ["personal", "campus", "academic", "opinion"];

/**
 * Build a prompt to generate interview question sets.
 *
 * @param {number} count — number of sets (default 1)
 * @param {object} opts — { categories?: string[] }
 * @returns {string} prompt text
 */
function buildInterviewPrompt(count = 1, opts = {}) {
  const categorySpecs = QUESTION_ORDER.map((cat, i) => {
    const spec = CATEGORY_SPECS[cat];
    return `Q${i + 1} — ${spec.label} (${spec.difficulty})
  ${spec.guidance}
  Example: "${spec.examples[0]}"`;
  }).join("\n\n");

  return `Generate ${count} set(s) of TOEFL 2026 "Take an Interview" questions for speaking practice.

## Requirements per set

Each set has exactly 4 questions with progressive difficulty:

${categorySpecs}

## Question guidelines

1. Length: 10-20 words per question. Clear, direct, and natural.
2. Questions must be open-ended (not yes/no) — they should invite a 45-second spoken response.
3. Avoid questions that depend on specific cultural knowledge or niche interests.
4. Each question should be self-contained (no reading passage or context needed).
5. Use natural, conversational tone — as if an interviewer is asking the student directly.
6. Avoid starting multiple questions with the same word.
7. Do not repeat themes across questions within the same set.

## Difficulty progression

- Q1: Factual/simple — one clear topic, personal experience
- Q2: Descriptive — requires elaboration and examples
- Q3: Analytical — requires comparing, contrasting, or explaining reasons
- Q4: Evaluative/abstract — requires forming an opinion, hypothetical thinking, or defending a position

## Output format

Return a JSON array of ${count} set(s):

\`\`\`json
[
  {
    "id": "intv_<timestamp>_<set_number>",
    "topic": "<general theme>",
    "questions": [
      {
        "id": "intv_<timestamp>_<set>_q1",
        "question": "What is your favorite place to study and why do you prefer it?",
        "category": "personal",
        "difficulty": "easy",
        "word_count": 12,
        "expected_topics": ["study habits", "personal preference", "location"]
      },
      ...4 questions total
    ]
  }
]
\`\`\`

Return ONLY valid JSON, no markdown fencing, no explanation.`;
}

module.exports = { buildInterviewPrompt, CATEGORY_SPECS, QUESTION_ORDER };
