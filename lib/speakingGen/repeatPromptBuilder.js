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
  // RECALIBRATED 2026-05-31: real bank has a PROCEDURE/how-to family (sequence of
  // imperative steps, no welcome/location) and everyday-commerce settings — the old
  // pool was 100% campus orientation and had zero of these.
  { scenario: "Bike Tire Repair (how-to)", role: "workshop instructor", setting: "campus bike shop", type: "procedure" },
  { scenario: "Cookie Baking (how-to)", role: "cooking class instructor", setting: "teaching kitchen", type: "procedure" },
  { scenario: "Watercolor Painting (how-to)", role: "art class instructor", setting: "art studio", type: "procedure" },
  { scenario: "Salad Making (how-to)", role: "cooking demonstrator", setting: "teaching kitchen", type: "procedure" },
  { scenario: "Travel Booking", role: "travel agent", setting: "travel agency", type: "procedure" },
  { scenario: "Grocery Store Help", role: "store associate", setting: "grocery store" },
  { scenario: "Hardware Store Help", role: "store associate", setting: "hardware store" },
  { scenario: "Botanical Garden Tour", role: "garden guide", setting: "botanical garden" },
];

// ── Sentence structure rules per difficulty ──

// RECALIBRATED 2026-05-31 to realExam2026 (351 real sentences). Removed two pure
// synthetic tells the old lists seeded: yes/no QUESTIONS (real 0/351) and PUNITIVE
// consequence clauses ("late returns will result in suspension…", real 0/351). Added
// the bare-declarative LOCATING opener (real 53% of S1) and the map/schedule wayfinding
// closer (real 33% of last sentences).
const STRUCTURE_RULES = {
  easy: {
    word_range: [4, 7],
    structures: [
      "bare declarative locating/announcing something (e.g., 'Laptops are located in this aisle.', 'Soccer matches take place here.')",
      "bare imperative (e.g., 'Check your inbox for new messages.', 'Please step inside.')",
      "simple declarative (e.g., 'The library is open daily.')",
    ],
    constraints: "Single clause only. No subordination. Common vocabulary. Maximum 7 words. NEVER a yes/no question (the Repeat task has zero question marks).",
  },
  medium: {
    word_range: [8, 12],
    structures: [
      "declarative with prepositional phrase (e.g., 'We can replace your laptop charger at the front counter.')",
      "imperative with adverbial (e.g., 'Please pay attention to your blocking during the opening scene.')",
      "passive voice (e.g., 'Software updates are installed automatically every Friday evening.')",
      "compound subject or object (e.g., 'The digital catalog can be accessed from any campus computer.')",
    ],
    constraints: "One main clause. May include one prepositional phrase or participial extension. 8-12 words. No questions.",
  },
  hard: {
    word_range: [13, 20],
    structures: [
      "fronted conditional/temporal clause + wayfinding pointer (e.g., 'If you need help getting around, check the map for specific areas and facilities.', 'When you are ready, simply select Print from your computer.')",
      "fronted Before/After/Lastly clause (e.g., 'Before you leave the classroom, be sure you put all your tools back in the toolbox.')",
      "compound sentence with and/or (e.g., 'Make sure to bring a water bottle and wear comfortable clothing for our stage exercises.')",
      "relative clause (e.g., 'Students who arrive late will need to wait until the next available session.')",
    ],
    constraints: "Usually a comma-split clause (~75% of long sentences have one). May reach 16-18 words. NEVER a punitive 'will result in / suspension / penalty / fine' threat — real items have none. NEVER a question.",
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

  // Per-set length signature [easy, medium, hard] — RECALIBRATED to realExam2026.
  // Real is MEDIUM-DOMINANT and varies set-to-set (2/3/2 is only 6% of real sets);
  // dominant signatures are 2/4/1, 3/3/1, 1/4/2, 1/5/1 — usually just ONE hard sentence.
  const SIGNATURES = [[2, 4, 1], [2, 4, 1], [3, 3, 1], [3, 3, 1], [1, 4, 2], [1, 5, 1], [2, 3, 2]];

  // Build per-set specs
  const setSpecs = selectedScenarios.map((sc, i) => {
    // Pick phonetic focus areas for medium and hard
    const mediumChallenges = [...PHONETIC_CHALLENGES.medium]
      .sort(() => Math.random() - 0.5).slice(0, 2);
    const hardChallenges = [...PHONETIC_CHALLENGES.hard]
      .sort(() => Math.random() - 0.5).slice(0, 2);
    const sig = SIGNATURES[Math.floor(Math.random() * SIGNATURES.length)];
    const flow = sc.type === "procedure"
      ? "PROCEDURE/how-to: a sequence of imperative steps (First… Next… Then… Lastly…). NO 'Welcome', NO location-listing. The last step is the long finish."
      : "ORIENTATION: open with a bare DECLARATIVE locating/announcing something (NOT 'Welcome…'); cover what's here and what you can do; end on a long, comma-split wayfinding pointer ('…check the map/schedule/guide…').";

    return `Set ${i + 1}:
  Scenario: ${sc.scenario}
  Speaker role: ${sc.role}
  Setting: ${sc.setting}
  Set type & flow: ${flow}
  Length mix for THIS set: ${sig[0]} easy + ${sig[1]} medium + ${sig[2]} hard (do NOT default to 2/3/2)
  The LAST sentence must be the longest in the set.
  Phonetic focus (medium): ${mediumChallenges.join("; ")}
  Phonetic focus (hard): ${hardChallenges.join("; ")}`;
  });

  const prompt = `You are an ETS-caliber TOEFL content writer for the 2026 "Listen and Repeat" speaking task.

## TASK FORMAT
The test-taker hears a sentence spoken by a staff/authority figure, then repeats it. Score is computed by word-matching (not AI). The task tests pronunciation, listening accuracy, and spoken fluency.

## REAL ETS REFERENCE EXAMPLES — Study these carefully
## (Note the bare-declarative openers, the ZERO questions, the ZERO punitive threats,
##  the long comma-split wayfinding finish, and the 2/4/1 length mix — NOT a 2/3/2 staircase.)

EXAMPLE SET 1 — Campus computer lab (orientation; technician speaking) [2 easy / 4 medium / 1 hard]:
  S1 (easy):   "Printers are located near the entrance." (6 words)        ← bare declarative, NOT "Welcome…"
  S2 (easy):   "Check your inbox for new messages." (6 words)             ← bare imperative, NOT a question
  S3 (medium): "We can replace your laptop charger at the front counter." (10 words)
  S4 (medium): "Software updates are installed automatically every Friday evening." (8 words)
  S5 (medium): "You will need to restart your device after the update is complete." (12 words)
  S6 (medium): "The digital catalog can be accessed from any campus computer." (10 words)
  S7 (hard):   "If you are unsure how to connect, check the help guide posted by the main desk." (16 words)  ← long, comma-split, wayfinding closer

EXAMPLE SET 2 — Bike-tire repair (PROCEDURE/how-to; instructor speaking) [2 easy / 4 medium / 1 hard]:
  S1 (easy):   "First, remove the rear wheel." (5 words)                  ← step, no welcome, no location
  S2 (easy):   "Next, let the air out." (5 words)
  S3 (medium): "Carefully locate the puncture hole in the inner tube." (9 words)
  S4 (medium): "Mark the spot and apply a thin layer of glue." (10 words)
  S5 (medium): "Press the patch down firmly for about one minute." (9 words)
  S6 (medium): "Once the glue is dry, fit the tube back inside the tire." (12 words)
  S7 (hard):   "Before you ride away, pump the tire up and check that the patch holds." (14 words)  ← fronted Before-clause finish

## SENTENCE RULES PER DIFFICULTY TIER

NOTE: tiers are LENGTH buckets, not fixed positions. Use the per-set length mix given
above (often 2/4/1 or 3/3/1, medium-dominant). Do NOT put all hard sentences last in a
clean staircase — the middle is "bumpy" and only the FINAL sentence must be the longest.

### EASY: ${STRUCTURE_RULES.easy.word_range[0]}-${STRUCTURE_RULES.easy.word_range[1]} words
Structures: ${STRUCTURE_RULES.easy.structures.join(", ")}
Constraints: ${STRUCTURE_RULES.easy.constraints}
Timing budget: 8 seconds

### MEDIUM (the bulk of every set): ${STRUCTURE_RULES.medium.word_range[0]}-${STRUCTURE_RULES.medium.word_range[1]} words
Structures: ${STRUCTURE_RULES.medium.structures.join(", ")}
Constraints: ${STRUCTURE_RULES.medium.constraints}
Timing budget: 10 seconds

### HARD (usually just ONE, the closing sentence): ${STRUCTURE_RULES.hard.word_range[0]}-${STRUCTURE_RULES.hard.word_range[1]} words
Structures: ${STRUCTURE_RULES.hard.structures.join(", ")}
Constraints: ${STRUCTURE_RULES.hard.constraints}
Timing budget: 12 seconds

## PHONETIC CHALLENGE EMBEDDING

Each sentence should naturally include pronunciation challenges appropriate to its difficulty:
- Easy: ${PHONETIC_CHALLENGES.easy.join("; ")}
- Medium: ${PHONETIC_CHALLENGES.medium.join("; ")}
- Hard: ${PHONETIC_CHALLENGES.hard.join("; ")}

## SCENARIO COHERENCE RULES

1. All 7 sentences in a set must plausibly come from the SAME speaker at the SAME location (or the same how-to procedure).
2. The speaker is always a staff/authority figure or a how-to narrator (never a student or customer).
3. Follow the set's flow (above): orientation ends on a wayfinding pointer; procedure is a step sequence. There are NO "rules → warnings" endings — real items have ZERO punitive threats.
4. Direct address ("you", "your") in about 1 of 3 sentences (≈2-3 of the 7; do NOT drop to zero, do NOT use it in every sentence) — the rest describe the PLACE/OBJECTS/STEPS, not the listener.
5. Contractions are incidental (real items are ~2% contracted); mostly use full forms ("you will", "do not"). Do not force contractions.
6. Avoid proper nouns, brand names, or culturally specific references.
7. Each sentence must be self-contained, and contain NO question marks (the whole set is statements/imperatives).

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
        "sentence": "Towels are located by the entrance.",
        "difficulty": "easy",
        "word_count": 6,
        "structure": "bare declarative",
        "phonetic_focus": "clear word-final consonants",
        "timing_seconds": 8
      },
      ...7 sentences total, following THIS set's length mix (above) — NOT a fixed 2/3/2;
      the last sentence is the longest; zero questions; zero punitive warnings
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
