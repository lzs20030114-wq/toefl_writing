/**
 * Listen & Repeat — Prompt builder v2
 *
 * Rebuilt from scratch based on analysis of 5 ETS reference sets (35 sentences).
 * See: data/speaking/profile/repeat-flavor-model.json
 *      data/speaking/samples/repeat-reference.json
 *
 * Key design decisions driven by real ETS data:
 *  - 7 sentences per set: 2 easy (4-7 words) + 3 medium (8-12) + 2 hard (13-20)
 *  - All sentences spoken by a staff/authority figure in a specific location
 *  - Progressive difficulty within each set (scenario orientation)
 *  - Phonetic challenges scale with difficulty tier
 *  - Timing: easy 8s, medium 10s, hard 12s
 */

// ── Scenario pool (15+ campus/community scenarios) ──

const SCENARIO_POOL = [
  { scenario: "IT Help Desk", role: "IT support technician", setting: "campus technology center" },
  { scenario: "Library Orientation", role: "librarian", setting: "university library" },
  { scenario: "Planetarium Visit", role: "planetarium guide", setting: "campus planetarium" },
  { scenario: "Car Rental Agency", role: "rental agent", setting: "car rental counter" },
  { scenario: "Theater Rehearsal", role: "theater director", setting: "campus theater" },
  { scenario: "Campus Gym Induction", role: "fitness center coordinator", setting: "campus gym" },
  { scenario: "Student Health Center", role: "health center receptionist", setting: "student health clinic" },
  { scenario: "Chemistry Lab Safety", role: "lab safety officer", setting: "chemistry lab" },
  { scenario: "Dining Hall Tour", role: "dining services manager", setting: "campus dining hall" },
  { scenario: "Campus Bookstore", role: "bookstore clerk", setting: "university bookstore" },
  { scenario: "Residence Hall Move-In", role: "resident advisor", setting: "dormitory lobby" },
  { scenario: "Tutoring Center", role: "tutoring center coordinator", setting: "academic tutoring center" },
  { scenario: "Career Services Workshop", role: "career advisor", setting: "career services office" },
  { scenario: "Art Gallery Opening", role: "gallery curator", setting: "campus art gallery" },
  { scenario: "Recycling Center Tour", role: "sustainability coordinator", setting: "campus recycling center" },
  { scenario: "Campus Radio Station", role: "station manager", setting: "campus radio studio" },
  { scenario: "Swimming Pool Orientation", role: "pool lifeguard supervisor", setting: "campus aquatic center" },
  { scenario: "Photography Darkroom", role: "darkroom technician", setting: "photography lab" },
];

// ── Sentence structure rules per difficulty ──

const STRUCTURE_RULES = {
  easy: {
    word_range: [4, 7],
    structures: [
      "imperative (e.g., 'Please step inside the dome.')",
      "simple declarative (e.g., 'The library is open daily.')",
      "short yes/no question (e.g., 'Do you have your student ID?')",
    ],
    constraints: "Single clause only. No subordination. Common vocabulary. Maximum 7 words.",
  },
  medium: {
    word_range: [8, 12],
    structures: [
      "declarative with prepositional phrase (e.g., 'We can replace your laptop charger at the front counter.')",
      "imperative with adverbial (e.g., 'Please pay attention to your blocking during the opening scene.')",
      "passive voice (e.g., 'Software updates are installed automatically every Friday evening.')",
      "compound subject or object (e.g., 'The digital catalog can be accessed from any campus computer.')",
    ],
    constraints: "One main clause. May include one prepositional phrase or participial extension. 8-12 words.",
  },
  hard: {
    word_range: [13, 20],
    structures: [
      "conditional if-clause (e.g., 'If you experience any issues with the campus Wi-Fi, please submit a support ticket online.')",
      "result/consequence clause (e.g., 'Late returns will result in an extra daily charge added to your credit card.')",
      "compound sentence with and/or (e.g., 'Make sure to bring a water bottle and wear comfortable clothing for our stage exercises.')",
      "relative clause (e.g., 'Students who arrive late will need to wait until the next available session.')",
    ],
    constraints: "Two clauses required. Conditional logic, consequence structures, or multiple coordinated parts. 13-20 words.",
  },
};

// ── Phonetic challenge types per difficulty ──

const PHONETIC_CHALLENGES = {
  easy: [
    "clear word-final consonants (desk, help, step)",
    "basic vowel distinctions (open/close, daily/freely)",
  ],
  medium: [
    "consonant clusters (str-, -nts, -lts, -cts, -mps)",
    "reduced syllables in multi-syllable words (automatically, comfortable, Wednesday)",
    "stress placement in compound nouns (study room, front counter, costume fitting)",
    "linking between words (is_included, can_be_accessed, run_through)",
  ],
  hard: [
    "linked speech across clause boundaries (if you_experience, result_in_an)",
    "stress-timing across long sentences (maintaining rhythm over 15+ words)",
    "final consonant clusters at phrase boundaries (-nts in, -lts will, -ges to)",
    "reduced function words in rapid sequences (for our, to your, about the)",
    "conditional intonation pattern (rising in if-clause, falling in main clause)",
  ],
};

/**
 * Build a prompt to generate one set of 7 Listen & Repeat sentences.
 *
 * @param {number} count — number of sets to generate (default 1)
 * @param {object} opts
 * @param {string[]} [opts.excludeScenarios] — scenario names to avoid
 * @returns {{ prompt: string, scenarios: string[] }}
 */
function buildRepeatPrompt(count = 1, opts = {}) {
  const { excludeScenarios = [] } = opts;

  // Pick scenarios (avoid repeats and excluded ones)
  const available = SCENARIO_POOL.filter(
    s => !excludeScenarios.includes(s.scenario)
  );
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  const selectedScenarios = shuffled.slice(0, count);

  // Build per-set specs
  const setSpecs = selectedScenarios.map((sc, i) => {
    // Pick phonetic focus areas for medium and hard
    const mediumChallenges = [...PHONETIC_CHALLENGES.medium]
      .sort(() => Math.random() - 0.5).slice(0, 2);
    const hardChallenges = [...PHONETIC_CHALLENGES.hard]
      .sort(() => Math.random() - 0.5).slice(0, 2);

    return `Set ${i + 1}:
  Scenario: ${sc.scenario}
  Speaker role: ${sc.role}
  Setting: ${sc.setting}
  Phonetic focus (medium): ${mediumChallenges.join("; ")}
  Phonetic focus (hard): ${hardChallenges.join("; ")}`;
  });

  const prompt = `You are an ETS-caliber TOEFL content writer for the 2026 "Listen and Repeat" speaking task.

## TASK FORMAT
The test-taker hears a sentence spoken by a staff/authority figure, then repeats it. Score is computed by word-matching (not AI). The task tests pronunciation, listening accuracy, and spoken fluency.

## REAL ETS REFERENCE EXAMPLES — Study these carefully

EXAMPLE SET 1 — IT Help Desk (technician speaking):
  S1 (easy):   "Welcome to the IT help desk." (6 words)
  S2 (easy):   "Do you have your student ID?" (7 words)
  S3 (medium): "We can replace your laptop charger at the front counter." (10 words)
  S4 (medium): "Software updates are installed automatically every Friday evening." (8 words)
  S5 (medium): "You'll need to restart your device after the update is complete." (12 words)
  S6 (hard):   "If you experience any issues with the campus Wi-Fi, please submit a support ticket online." (16 words)
  S7 (hard):   "Late equipment returns will result in a temporary suspension of your borrowing privileges." (14 words)

EXAMPLE SET 2 — Planetarium (guide speaking):
  S1 (easy):   "Please step inside the dome." (5 words)
  S2 (easy):   "The show begins in five minutes." (6 words)
  S3 (medium): "Tonight we will explore the constellations of the winter sky." (10 words)
  S4 (medium): "The projector will simulate a journey through the solar system." (10 words)
  S5 (medium): "Please silence your phones before the presentation starts." (8 words)
  S6 (hard):   "You may notice the ceiling lights dimming slowly as the stars begin to appear." (14 words)
  S7 (hard):   "Afterward, a guest astronomer will be available to answer all your questions." (12 words)

## SENTENCE RULES PER DIFFICULTY TIER

### EASY (Sentences 1-2): ${STRUCTURE_RULES.easy.word_range[0]}-${STRUCTURE_RULES.easy.word_range[1]} words
Structures: ${STRUCTURE_RULES.easy.structures.join(", ")}
Constraints: ${STRUCTURE_RULES.easy.constraints}
Timing budget: 8 seconds

### MEDIUM (Sentences 3-5): ${STRUCTURE_RULES.medium.word_range[0]}-${STRUCTURE_RULES.medium.word_range[1]} words
Structures: ${STRUCTURE_RULES.medium.structures.join(", ")}
Constraints: ${STRUCTURE_RULES.medium.constraints}
Timing budget: 10 seconds

### HARD (Sentences 6-7): ${STRUCTURE_RULES.hard.word_range[0]}-${STRUCTURE_RULES.hard.word_range[1]} words
Structures: ${STRUCTURE_RULES.hard.structures.join(", ")}
Constraints: ${STRUCTURE_RULES.hard.constraints}
Timing budget: 12 seconds

## PHONETIC CHALLENGE EMBEDDING

Each sentence should naturally include pronunciation challenges appropriate to its difficulty:
- Easy: ${PHONETIC_CHALLENGES.easy.join("; ")}
- Medium: ${PHONETIC_CHALLENGES.medium.join("; ")}
- Hard: ${PHONETIC_CHALLENGES.hard.join("; ")}

## SCENARIO COHERENCE RULES

1. All 7 sentences in a set must plausibly come from the SAME speaker at the SAME location.
2. The speaker is always a staff/authority figure (never a student or customer).
3. Sentences should follow a logical information flow (welcome → instructions → rules → warnings).
4. Use direct address ("you", "your") naturally.
5. Contractions are OK where a real person would use them (you'll, we're, it's).
6. Avoid proper nouns, brand names, or culturally specific references.
7. Each sentence must be self-contained (understandable without the others).

## SETS TO GENERATE

${setSpecs.join("\n\n")}

## OUTPUT FORMAT

Return a JSON array of ${count} set(s):

[
  {
    "id": "rpt_<timestamp>_001",
    "scenario": "${selectedScenarios[0]?.scenario || "Campus Gym"}",
    "speaker_role": "${selectedScenarios[0]?.role || "fitness coordinator"}",
    "sentences": [
      {
        "id": "rpt_<timestamp>_001_s1",
        "sentence": "Welcome to the campus fitness center.",
        "difficulty": "easy",
        "word_count": 6,
        "structure": "imperative",
        "phonetic_focus": "clear word-final consonants",
        "timing_seconds": 8
      },
      ...7 sentences total (2 easy + 3 medium + 2 hard)
    ]
  }
]

Return ONLY valid JSON, no markdown fencing, no explanation.`;

  return {
    prompt,
    scenarios: selectedScenarios.map(s => s.scenario),
  };
}

module.exports = { buildRepeatPrompt, SCENARIO_POOL, STRUCTURE_RULES, PHONETIC_CHALLENGES };
