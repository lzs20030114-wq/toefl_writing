/**
 * Prompt builder for Listen & Repeat sentence generation.
 *
 * Each set: 7 sentences with difficulty progression (easy -> medium -> hard).
 * Sentences test pronunciation, intonation, and listening accuracy.
 */

const TOPIC_POOLS = {
  campus: [
    "registering for classes", "campus bookstore", "library hours",
    "dormitory rules", "student ID card", "cafeteria options",
    "campus tour", "orientation week", "parking permit",
    "study groups", "office hours", "campus shuttle",
  ],
  daily: [
    "grocery shopping", "weather forecast", "weekend plans",
    "restaurant reservation", "apartment lease", "public transit",
    "phone plan", "fitness routine", "cooking at home",
    "laundry schedule", "neighborhood park", "pet care",
  ],
  academic: [
    "research paper deadline", "lab experiment results",
    "lecture discussion", "textbook chapter", "thesis proposal",
    "peer review feedback", "conference presentation", "field study",
    "statistical analysis", "literature review", "grant application",
    "academic journal submission",
  ],
};

const PHONETIC_CHALLENGES = [
  "consonant clusters (str-, spl-, -nths, -lpts)",
  "minimal pairs (ship/sheep, bed/bad, think/sink)",
  "reduced vowels in unstressed syllables (comfortable, vegetable, temperature)",
  "linking and connected speech (pick_it_up, not_at_all)",
  "sentence-level stress and rhythm (content words stressed, function words reduced)",
  "intonation patterns (rising for yes/no questions, falling for statements)",
  "th sounds (both voiceless /θ/ and voiced /ð/)",
  "final consonant clusters (-sts, -sks, -mpts)",
  "syllable stress shifts (PHOtograph vs phoTOGraphy)",
  "weak forms of common words (can/kən/, have/həv/)",
];

/**
 * Build a prompt to generate one set of 7 Listen & Repeat sentences.
 *
 * @param {number} count — number of sets to generate (default 1)
 * @param {object} opts — { topics?: string[] }
 * @returns {string} prompt text
 */
function buildRepeatPrompt(count = 1, opts = {}) {
  const topics = opts.topics && opts.topics.length > 0
    ? opts.topics
    : Object.keys(TOPIC_POOLS);

  // Pick random phonetic challenges to emphasize
  const shuffled = [...PHONETIC_CHALLENGES].sort(() => Math.random() - 0.5);
  const focusChallenges = shuffled.slice(0, 4);

  const topicExamples = topics.flatMap(t => (TOPIC_POOLS[t] || []).slice(0, 4)).join(", ");

  return `Generate ${count} set(s) of TOEFL 2026 "Listen and Repeat" sentences for speaking practice.

## Requirements per set

Each set has exactly 7 sentences with progressive difficulty:
- Sentences 1-2: EASY (8-10 words, simple grammar, common vocabulary)
- Sentences 3-5: MEDIUM (10-13 words, compound/complex structures, academic vocabulary)
- Sentences 6-7: HARD (12-15 words, embedded clauses, challenging pronunciation)

## Sentence guidelines

1. Length: 8-15 words per sentence. Natural spoken English.
2. Topics: ${topicExamples}
3. Each sentence must sound like something a real person would say on a university campus.
4. Use natural contractions where appropriate (I'll, we've, they're).
5. Avoid proper nouns, brand names, or culturally specific references.
6. Include a mix of statement and question forms.

## Phonetic focus areas (incorporate naturally)

${focusChallenges.map((c, i) => `${i + 1}. ${c}`).join("\n")}

## Output format

Return a JSON array of ${count} set(s). Each set:

\`\`\`json
[
  {
    "id": "rpt_<timestamp>_<set_number>",
    "topic": "<campus|daily|academic>",
    "sentences": [
      {
        "id": "rpt_<timestamp>_<set>_s1",
        "sentence": "The library closes at ten o'clock tonight.",
        "difficulty": "easy",
        "word_count": 8,
        "phonetic_focus": "linking (at_ten, o'clock_tonight)"
      },
      ...7 sentences total
    ]
  }
]
\`\`\`

Return ONLY valid JSON, no markdown fencing, no explanation.`;
}

module.exports = { buildRepeatPrompt, TOPIC_POOLS, PHONETIC_CHALLENGES };
