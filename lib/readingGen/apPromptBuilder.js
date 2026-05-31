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
  // Added based on real ETS profile (materials_science 15%, business 8% observed in samples)
  { topic: "materials_science", subtopics: ["ceramics", "alloys", "polymer composites", "glass technology", "metallurgy", "concrete chemistry", "textile fibers"] },
  { topic: "business", subtopics: ["market dynamics", "consumer behavior", "supply chains", "economic history", "trade networks", "labor economics", "industrial organization"] },
];

// ── Rhetorical patterns ──

const RHETORICAL_PATTERNS = [
  { name: "general_to_specific", weight: 0.31, template: "Start with a broad concept or established fact, then progressively narrow to specific mechanisms, examples, or implications." },
  { name: "definition_elaboration", weight: 0.23, template: "Define a concept/term in paragraph 1, explain how it works in paragraph 2, discuss its significance or applications in paragraph 3." },
  { name: "chronological", weight: 0.23, template: "Follow a timeline: primitive/early stage → intermediate/flawed stage → breakthrough/modern stage with lasting impact." },
  { name: "problem_solution", weight: 0.15, template: "Present a problem/challenge in paragraph 1, introduce the solution in paragraph 2, discuss outcomes and limitations in paragraph 3." },
];

// Question-type plans RECALIBRATED 2026-05-31 to realExam2026 (hand-coded from 14
// fully-read OCR clusters, n=70 questions — docs/eval-spec/ap.md D5):
//   factual_detail 22.9%  inference 18.6%  vocabulary 17.1%  insert_text 11.4%
//   negative_factual 10%  rhetorical_purpose 10%  reference 4.3%
//   paragraph_relationship 2.9%  main_idea 1.4%
// The OLD plans had THREE big errors vs real: (1) ZERO insert_text (real 11.4%, and
// it is always the LAST question of ~60% of clusters); (2) ZERO reference; (3)
// paragraph_relationship in 4/5 plans = 13.6% generated vs 2.9% real (4.7× over).
// insert_text is placed as Q5 in 3 of 5 plans (≈60%, matches real); vocab is Q1.
const QUESTION_PLANS = [
  ["vocabulary_in_context", "factual_detail", "inference",            "rhetorical_purpose", "insert_text"],
  ["vocabulary_in_context", "factual_detail", "negative_factual",     "inference",          "insert_text"],
  ["vocabulary_in_context", "factual_detail", "reference",            "inference",          "insert_text"],
  ["vocabulary_in_context", "factual_detail", "inference",            "rhetorical_purpose", "negative_factual"],
  ["main_idea",             "factual_detail", "paragraph_relationship", "inference",        "factual_detail"],
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

  // Select diverse topics — shuffle TOPIC_POOL each call so all 12 topics get
  // rotation across batches. Previous `i % POOL.length` always started at
  // index 0, meaning count=4 always picked topics[0..3] = biology/env_sci/
  // psych/history, never reaching art/sociology/chemistry/physics. Real ETS
  // has 8+ distinct topics; bank was stuck on 5 because of this bug.
  const usedSubs = new Set();
  const selected = [];
  const shuffledPool = [...TOPIC_POOL];
  for (let i = shuffledPool.length - 1; i > 0; i--) {
    const k = Math.floor(Math.random() * (i + 1));
    [shuffledPool[i], shuffledPool[k]] = [shuffledPool[k], shuffledPool[i]];
  }
  for (let i = 0; i < count; i++) {
    const t = shuffledPool[i % shuffledPool.length];
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
    const letterToSlot = { A: 1, B: 2, C: 3, D: 4 };
    const qSpecs = plan.map((type, qi) =>
      type === "insert_text"
        ? `Q${qi + 1}=insert_text(correct_answer="${posPool[qi]}" — the [■] at slot ${letterToSlot[posPool[qi]]}; options A/B/C/D label the four [■] slots in order, correct_answer is the LETTER)`
        : `Q${qi + 1}=${type}(answer=${posPool[qi]})`);
    const hasInsert = plan.includes("insert_text");
    const diffNote = s.difficulty === "easy"
      ? "   Difficulty: EASY — concrete process/description topic, explicit reasoning, mostly factual_detail. Still ~190 words."
      : s.difficulty === "hard"
        ? "   Difficulty: HARD — MORE ABSTRACT topic + subtler inference/reference, NOT a longer passage. Keep ~190 words (real hard passages are the same length, just denser)."
        : "   Difficulty: MEDIUM — standard academic register, ~190 words";
    const insertNote = hasInsert
      ? `\n   ⚠ INSERT_TEXT passage: place exactly FOUR insertion markers [■] at sentence/clause
   boundaries across the body paragraphs (slots 1-4). Write the passage so that one
   removable concrete-elaboration sentence (an "And because…", "For example,…", or
   "Imagine…" sentence) fits best at the assigned slot — that removed sentence becomes
   the Q5 prompt. The other 3 slots must be plausible-but-wrong.`
      : "";
    return `${i + 1}. Topic: ${s.topic} / ${s.subtopic}
   Rhetorical pattern: ${s.rhetorical.name} — ${s.rhetorical.template}
${diffNote}${insertNote}
   Questions: ${qSpecs.join(", ")}`;
  }).join("\n\n");

  let feedback = "";
  if (rejectionFeedback.length > 0) {
    feedback = `\n\nPREVIOUS ITEMS WERE REJECTED:\n${rejectionFeedback.map(r => `- ${r}`).join("\n")}`;
  }

  return `You are a TOEFL academic reading passage writer. Generate ${count} passages, each with exactly 5 multiple-choice questions.

## PASSAGE REQUIREMENTS (each passage)

1. **Length** (RECALIBRATED 2026-05-31 to realExam2026: 39 clean real 2026改后 AP
   passages, mean **182.5**, median 189, range 71-209; nothing above ~210):
   - Target: **190-210 words across 3 SUBSTANTIAL paragraphs of ~68 words each.**
   - ⚠️ Models SYSTEMATICALLY UNDERSHOOT badly here: at a stated "~190" DeepSeek wrote
     only ~100 words (measured 2026-05-31). So AIM for the TOP — three full ~68-word
     paragraphs (~205 words total). A passage UNDER 150 words is a hard FAILURE.
   - Hard ceiling **210 words** (real max 209). The old "280-360 / mean 317.5" was a
     STALE classic-TOEFL number; the 2026改后 AP passage is shorter — but NOT ~100.
   - Difficulty is NOT length: hard passages are ALSO ~190 words (just more abstract
     topic + more inference/reference questions). Never lengthen to make it "hard".
2. **Structure rules** (MANDATORY):
   - **Sentence 1 MUST directly name and define the subject** — like a textbook entry,
     not a hook. Real 2026改后 examples: "Value theory investigates the nature of
     values…", "Floating wind turbines are a special type of…", "Parallel algorithms,
     a computing method common in modern computers, solve…". (RECALIBRATED: ~90% of
     real passages open this way.)
   - **Do NOT open with received-wisdom-then-revision** ("Traditionally…", "Historically…",
     "While early scientists believed…", "For centuries it was thought…"). That opener
     is <5% of the real 2026改后 exam (it was over-weighted in the old profile).
   - Every paragraph MUST start with a topic sentence
   - Non-first paragraphs MUST reference the previous paragraph in their opening sentence (use "This...", "These...", "However...", "Beyond...", "Despite...")
   - NO conclusion/summary paragraph — end with a forward-looking LIMITATION move
     ("However, … faces objections", "Despite these efforts, challenges remain").
   - Follow the assigned rhetorical pattern below
3. **Academic style** (RECALIBRATED — real 2026改后 is SPARING, not lardered; the
   generator over-produces all three of these 2-3×, which reads as a synthetic tell):
   - Passive voice in ~1 sentence (real ~0.10/sentence, i.e. 1-2 per passage) — not more.
   - **About ONE** hedging word total (may/might/suggest/appear/tend), concentrated in
     the final limitation move. Do NOT sprinkle hedges through every sentence.
   - **Exactly ONE** strong contrast pivot (However/Despite), placed at the
     limitation move. Real has ONE pivot per passage, not 2-3.
   - Include 1 defined term using appositive or "known as" (keep at ONE, not two).
   - NO first person (I/we), NO rhetorical questions
4. **Vocabulary**: B2 base with SOME C1 academic words — but do not lard every sentence.
   Real long-word(≥7 letters) ratio is ~0.37; the generator drifts heavier (~0.40).
   Use a couple of AWL words (significant, structure, process, complex) where natural,
   not 2-3 forced into each paragraph.
5. **Content**: Factually accurate. No invented studies or statistics.

## QUESTION REQUIREMENTS (5 per passage)

### General rules:
- 4 options (A/B/C/D), all grammatically parallel (same start structure)
- **OPTION LENGTH RULE (RECALIBRATED — do NOT over-uniform):**
  - A SPREAD of ~3-4 words across the four options is normal and GOOD. Real ETS
    options vary (mean spread 2.6 words; only ~69% of questions fit within 3 words).
    Making all four options identical length is a synthetic tell — the old "within
    2 words" rule over-corrected. Let lengths vary naturally.
  - The ONLY hard rule: the correct answer must NOT be the UNIQUE longest option
    (a 12-word correct vs 6-7-word distractors is a dead giveaway). If it ends up
    longest, lengthen one distractor to match.
- Correct answer position: MUST match the assigned position below
- Correct answer must NEVER copy 4+ consecutive words from the passage — always paraphrase

### Per-type distractor engineering (CRITICAL):

**vocabulary_in_context**:
- Stem: "The word X in paragraph N is closest in meaning to"
- Pick a word with clear contextual clue nearby (appositive, definition)
- 85% should test the PRIMARY dictionary meaning
- Correct: synonym that fits the specific context
- Distractors: 3 real English words, same part of speech, could superficially fit but semantically wrong
- **OPTIONS MUST BE SINGLE WORDS** (or the shortest possible phrase). Real ETS vocab
  options average 1.5 words: e.g. "distributing / acquiring / increasing / tracking",
  "strength / threat / knowledge / supervision". Do NOT write multi-word glosses here.

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

**paragraph_relationship** (use SPARINGLY — only when the plan assigns it; real = ~3% of questions):
- Stem: "How does paragraph N relate to paragraph M?" or "What is the function of paragraph N?"
- Correct: accurately describes the structural role
- Distractors: 3 "wrong_detail" — describe plausible but incorrect structural relationships

**insert_text** (ALWAYS the last question Q5 when assigned; real = ~11% of questions):
- Stem (use this near-verbatim): "There are four locations [■] in the passage that indicate where the following sentence could be added. **'<the removed sentence>'** Where would the sentence best fit? Select a location to add the sentence to the passage."
- The passage MUST contain four [■] markers (see the passage scaffolding note). The
  removed sentence is a CONCRETE elaboration of an existing point — it must start with
  a back-reference cue and only make sense after a specific prior sentence. Real examples:
  - "And because of the controlled conditions in which they are produced, synthetic diamonds are actually preferred for industrial uses, such as in cutting tools and electronic devices."
  - "For example, Singapore's Intelligent Transport System incorporates artificial intelligence to predict real-time traffic conditions and optimize routes."
- options A/B/C/D = the four marker slots (1=A, 2=B, 3=C, 4=D); correct = the assigned slot.
- The other 3 slots must be grammatically possible but break the logical flow.

**reference** (use only when assigned; real = ~4% of questions):
- Stem: "What does \"<pronoun/phrase>\" refer to in paragraph N?" (e.g. *What does "its cautionary implications" refer to?*)
- Pick a real pronoun or demonstrative phrase in the passage with a clear antecedent.
- Correct: the actual antecedent noun phrase. Distractors: 3 other nearby noun phrases (single words / short phrases — keep options short).

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
