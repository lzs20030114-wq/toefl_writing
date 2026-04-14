/**
 * Academic Passage — Prompt builder for passage + 5 question generation.
 *
 * The most complex reading prompt: generates ~200-word academic passage
 * with 5 MC questions covering 7 possible question types, each with
 * type-specific distractor engineering strategies.
 *
 * Uses ETS flavor data from readingEtsProfile.js + passageStructure.json
 */

const { AP_PROFILE, ETS_FLAVOR } = require("../readingBank/readingEtsProfile");

// ── Topic pool (shared with CTW, expanded) ──

const TOPIC_POOL = [
  { topic: "biology", subtopics: ["animal behavior", "ecosystems", "cell biology", "genetics", "marine biology", "plant biology", "evolution", "microbiology", "pollination", "symbiosis", "bioluminescence", "photosynthesis", "animal migration", "camouflage", "insect colonies", "deep sea organisms", "immune system", "hibernation"] },
  { topic: "environmental_science", subtopics: ["climate change", "conservation", "pollution", "renewable energy", "deforestation", "ocean acidification", "biodiversity", "wetlands", "soil erosion", "urban heat islands", "water purification", "carbon cycle", "invasive species", "desertification", "green architecture"] },
  { topic: "psychology", subtopics: ["cognitive development", "memory", "decision making", "social behavior", "perception", "learning", "emotion", "sleep psychology", "motivation", "attention", "language acquisition", "cognitive bias", "stress response", "creativity", "placebo effect", "habit formation"] },
  { topic: "history", subtopics: ["ancient civilizations", "industrial revolution", "exploration", "trade routes", "technological inventions", "cultural exchange", "silk road", "ancient Egypt", "Roman engineering", "medieval guilds", "maritime navigation", "agricultural revolution", "early medicine", "ancient astronomy"] },
  { topic: "geology", subtopics: ["plate tectonics", "volcanism", "erosion", "minerals", "fossils", "earthquakes", "rock formation", "ice ages", "geysers", "cave formation", "river deltas", "mountain formation", "ocean floor", "meteor impacts", "soil composition"] },
  { topic: "astronomy", subtopics: ["solar system", "star formation", "space exploration", "comets", "black holes", "exoplanets", "lunar geology", "asteroid belts", "nebulae", "gravitational waves", "planetary atmospheres"] },
  { topic: "anthropology", subtopics: ["early humans", "language origins", "cultural rituals", "tool development", "migration patterns", "cave art", "ancient pottery", "burial customs", "early agriculture", "oral traditions"] },
  { topic: "technology", subtopics: ["telecommunications", "computing", "materials science", "engineering", "bridge design", "water treatment", "refrigeration", "glass making", "clock mechanisms", "steam power", "battery technology"] },
  { topic: "art", subtopics: ["Renaissance", "photography history", "architecture", "sculpture", "music theory", "cinema history", "impressionism", "mosaic art", "fresco techniques", "calligraphy", "theater history"] },
  { topic: "sociology", subtopics: ["urbanization", "education systems", "inequality", "globalization", "community development", "public health", "immigration patterns", "labor movements", "housing policy", "aging populations"] },
  { topic: "chemistry", subtopics: ["molecular bonding", "chemical reactions", "organic compounds", "crystal structures", "catalysis", "fermentation", "corrosion", "polymer science", "water chemistry"] },
  { topic: "physics", subtopics: ["thermodynamics", "electromagnetic waves", "fluid dynamics", "optics", "acoustics", "magnetism", "gravity", "friction", "superconductivity"] },
];

// ── Rhetorical patterns ──

const RHETORICAL_PATTERNS = [
  { name: "general_to_specific", weight: 0.31, template: "Start with a broad concept or established fact, then progressively narrow to specific mechanisms, examples, or implications." },
  { name: "definition_elaboration", weight: 0.23, template: "Define a concept/term in paragraph 1, explain how it works in paragraph 2, discuss its significance or applications in paragraph 3." },
  { name: "chronological", weight: 0.23, template: "Follow a timeline: primitive/early stage → intermediate/flawed stage → breakthrough/modern stage with lasting impact." },
  { name: "problem_solution", weight: 0.15, template: "Present a problem/challenge in paragraph 1, introduce the solution in paragraph 2, discuss outcomes and limitations in paragraph 3." },
];

// ── Question type distribution plans (5 questions each) ──

const QUESTION_PLANS = [
  ["vocabulary_in_context", "factual_detail", "inference", "rhetorical_purpose", "paragraph_relationship"],
  ["vocabulary_in_context", "factual_detail", "negative_factual", "inference", "paragraph_relationship"],
  ["factual_detail", "factual_detail", "inference", "rhetorical_purpose", "vocabulary_in_context"],
  ["main_idea", "factual_detail", "vocabulary_in_context", "inference", "rhetorical_purpose"],
  ["vocabulary_in_context", "factual_detail", "inference", "negative_factual", "rhetorical_purpose"],
];

function pickRhetorical() {
  const r = Math.random();
  let cum = 0;
  for (const p of RHETORICAL_PATTERNS) {
    cum += p.weight;
    if (r < cum) return p;
  }
  return RHETORICAL_PATTERNS[0];
}

/**
 * Build prompt to generate N academic passages with 5 questions each.
 *
 * @param {number} count — passages to generate (1-5, keep small due to token budget)
 * @param {object} opts
 * @param {string[]} [opts.excludeSubjects] — already generated subjects
 * @param {string[]} [opts.rejectionFeedback] — reasons for previous rejections
 * @returns {string}
 */
function buildAPPrompt(count = 3, opts = {}) {
  const { excludeSubjects = [], rejectionFeedback = [] } = opts;

  // Select diverse topics
  const usedSubs = new Set();
  const selected = [];
  for (let i = 0; i < count; i++) {
    const t = TOPIC_POOL[i % TOPIC_POOL.length];
    const avail = t.subtopics.filter(s =>
      !usedSubs.has(t.topic + "/" + s) &&
      !excludeSubjects.some(ex => ex.toLowerCase().includes(s.toLowerCase()))
    );
    const st = avail.length > 0 ? avail[Math.floor(Math.random() * avail.length)] : t.subtopics[0];
    usedSubs.add(t.topic + "/" + st);
    // Assign difficulty: ~15% easy, ~46% medium, ~38% hard
    const dr = Math.random();
    const difficulty = dr < 0.15 ? "easy" : dr < 0.61 ? "medium" : "hard";
    selected.push({ topic: t.topic, subtopic: st, rhetorical: pickRhetorical(), difficulty });
  }

  // Pre-assign question types and answer positions for each passage
  const passageSpecs = selected.map((s, i) => {
    const plan = QUESTION_PLANS[i % QUESTION_PLANS.length];
    // Balanced answer positions: 5 questions, near-uniform A/B/C/D
    const base = ["A", "B", "C", "D"];
    const extra = base[Math.floor(Math.random() * 4)]; // random 5th position
    const posPool = [...base, extra];
    // Shuffle
    for (let j = posPool.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [posPool[j], posPool[k]] = [posPool[k], posPool[j]];
    }
    const qSpecs = plan.map((type, qi) => `Q${qi + 1}=${type}(answer=${posPool[qi]})`);
    const diffNote = s.difficulty === "easy"
      ? "   Difficulty: EASY — use B2 vocabulary, shorter sentences, more explicit reasoning in passage"
      : s.difficulty === "hard"
        ? "   Difficulty: HARD — use C1 vocabulary, longer complex sentences, subtle inferences required"
        : "   Difficulty: MEDIUM — standard academic register";
    return `${i + 1}. Topic: ${s.topic} / ${s.subtopic}
   Rhetorical pattern: ${s.rhetorical.name} — ${s.rhetorical.template}
${diffNote}
   Questions: ${qSpecs.join(", ")}`;
  }).join("\n\n");

  let feedback = "";
  if (rejectionFeedback.length > 0) {
    feedback = `\n\nPREVIOUS ITEMS WERE REJECTED:\n${rejectionFeedback.map(r => `- ${r}`).join("\n")}`;
  }

  return `You are a TOEFL academic reading passage writer. Generate ${count} passages, each with exactly 5 multiple-choice questions.

## PASSAGE REQUIREMENTS (each passage)

1. **Length**: 180-250 words, 3-4 paragraphs. Each paragraph 50-80 words.
2. **Structure rules** (MANDATORY):
   - Every paragraph MUST start with a topic sentence
   - Non-first paragraphs MUST reference the previous paragraph in their opening sentence (use "This...", "These...", "However...", "Beyond...", "Despite...")
   - NO conclusion/summary paragraph — end with implication, limitation, or forward-looking statement
   - Follow the assigned rhetorical pattern below
3. **Academic style**:
   - Use passive voice in at least 1 sentence ("is considered", "has been identified", "are formed")
   - Include 1-2 hedging words (may, might, suggest, appear, tend, often, generally)
   - Include 1-2 contrast transitions (However, Although, While, Yet, Despite)
   - Include 1 defined term using appositive or "known as" (e.g., "X, a process known as Y")
   - NO first person (I/we), NO rhetorical questions
4. **Vocabulary**: Mix of B2-C1 academic words. Include 2-3 words from AWL (significant, structure, environment, process, research, complex, fundamental, etc.)
5. **Content**: Factually accurate. No invented studies or statistics.

## QUESTION REQUIREMENTS (5 per passage)

### General rules:
- 4 options (A/B/C/D), all grammatically parallel (same start structure)
- **OPTION LENGTH RULE (CRITICAL — AI often violates this):**
  - All 4 options MUST be within 2 words of each other in length
  - The correct answer must NOT be the longest option. If anything, make distractors slightly longer
  - WRONG: correct=12 words, distractors=6-7 words (this is a dead giveaway)
  - RIGHT: all options 7-9 words, correct answer is 7 or 8 words
  - After writing options, COUNT THE WORDS and adjust if the correct answer is longest
- Correct answer position: MUST match the assigned position below
- Correct answer must NEVER copy 4+ consecutive words from the passage — always paraphrase

### Per-type distractor engineering (CRITICAL):

**vocabulary_in_context**:
- Stem: "The word X in paragraph N is closest in meaning to"
- Pick a word with clear contextual clue nearby (appositive, definition)
- 85% should test the PRIMARY dictionary meaning
- Correct: synonym that fits the specific context
- Distractors: 3 real English words, same part of speech, could superficially fit but semantically wrong

**factual_detail**:
- Stem: "According to paragraph N, what/how/why..."
- Correct: paraphrase of a specific passage sentence (~58% content word overlap with source)
- Distractor 1: "wrong_detail" — borrow 2-3 real passage terms but CHANGE their relationship
- Distractor 2: "not_mentioned" — topically related but NOT in the passage
- Distractor 3: "plausible_but_unsupported" — reasonable from world knowledge but not stated

**inference**:
- Stem: "What can be inferred from paragraph N about..."
- Correct: logical conclusion from 1-2 sentences, NOT directly stated (~32% word overlap)
- Distractor 1: "opposite" — reverses the implied logic
- Distractor 2: "not_mentioned" — plausible but unsupported
- Distractor 3: "too_broad" or "wrong_detail"

**main_idea**:
- Stem: "What is the passage mainly about?"
- Correct: captures the FULL scope using meta-language
- Distractor 1: "too_narrow" — captures only one paragraph's detail
- Distractor 2: "too_narrow" — captures a different single detail
- Distractor 3: "wrong_detail" — plausible but mischaracterizes the focus

**negative_factual**:
- Stem: "According to the passage, all of the following are true EXCEPT"
- Correct: the one statement NOT supported by the passage
- Distractors: 3 statements that ARE true (paraphrased from passage — "misquoted" type)

**rhetorical_purpose**:
- Stem: "Why does the author mention X in paragraph N?"
- Correct: describes the communicative intent using meta-language ("to illustrate...", "to provide evidence for...")
- Distractor 1: "not_mentioned" — wrong purpose
- Distractor 2: "opposite" — reverses the rhetorical intent
- Distractor 3: "too_narrow" — correct action but wrong scope

**paragraph_relationship**:
- Stem: "How does paragraph N relate to paragraph M?" or "What is the function of paragraph N?"
- Correct: accurately describes the structural role
- Distractors: 3 "wrong_detail" — describe plausible but incorrect structural relationships

### Explanation:
Each question MUST include an explanation (1-2 sentences) that quotes or references the specific passage text supporting the correct answer.

## PASSAGES TO GENERATE

${passageSpecs}

${excludeSubjects.length > 0 ? `\n## DO NOT WRITE ABOUT:\n${excludeSubjects.slice(0, 10).map(s => `- ${s}`).join("\n")}\n` : ""}
## OUTPUT FORMAT

Return a JSON array. Each element:
{
  "topic": "biology",
  "subtopic": "animal behavior",
  "passage": "Full passage text...",
  "paragraphs": ["Paragraph 1...", "Paragraph 2...", "Paragraph 3..."],
  "difficulty": "medium",
  "questions": [
    {
      "question_type": "vocabulary_in_context",
      "stem": "The word X is closest in meaning to",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "correct_answer": "B",
      "explanation": "In context, X refers to..."
    }
  ]
}

Return ONLY the JSON array, no markdown fencing.${feedback}`;
}

module.exports = { buildAPPrompt, TOPIC_POOL, RHETORICAL_PATTERNS, QUESTION_PLANS };
