/**
 * Listen to an Academic Talk (LAT) -- Prompt builder v2
 *
 * Rebuilt from scratch based on deep analysis of 11 reference samples.
 * See: data/listening/profile/lat-flavor-model.json
 *
 * Key design decisions driven by real sample data:
 *  - Single speaker (professor) delivering a 150-250 word lecture
 *  - Conversational academic register (contractions, "you", rhetorical questions)
 *  - Structure: hook -> concept defined -> example/experiment -> significance
 *  - 4 questions: Q1=main_idea, Q2-Q3=detail/function, Q4=inference/predict_next
 *  - 5 distractor types: wrong_detail, topic_adjacent, over_generalization, reversed_logic, surface_word_trap
 *  - Answer position pre-assignment (prevents B-clustering seen in reference data)
 *  - Difficulty tiers: easy 30% / medium 45% / hard 25%
 *  - 3-layer ambiguity defense
 */

// -- Topic pool (academic subjects, matching TOEFL distribution) -----------

const TOPIC_POOL = [
  {
    subject: "biology",
    weight: 0.12,
    topics: [
      "how certain plants use mimicry to attract pollinators",
      "the role of bioluminescence in deep-sea organisms",
      "how tardigrades survive extreme environments",
      "convergent evolution in unrelated species",
      "how coral reefs respond to ocean acidification",
      "the symbiosis between cleaner fish and larger marine animals",
    ],
  },
  {
    subject: "ecology",
    weight: 0.12,
    topics: [
      "how invasive species disrupt native food webs",
      "the concept of ecological succession after a wildfire",
      "how urban heat islands affect local ecosystems",
      "the role of wetlands in flood prevention",
      "biological magnification of toxins in food chains",
      "rewilding efforts to restore degraded habitats",
    ],
  },
  {
    subject: "psychology",
    weight: 0.15,
    topics: [
      "the bystander effect in emergency situations",
      "how confirmation bias influences decision-making",
      "the mere exposure effect in advertising",
      "cognitive dissonance and attitude change",
      "the spacing effect in long-term memory retention",
      "anchoring bias in numerical judgments",
      "the peak-end rule in how people remember experiences",
    ],
  },
  {
    subject: "social_psychology",
    weight: 0.10,
    topics: [
      "how group polarization affects committee decisions",
      "the diffusion of responsibility in large groups",
      "stereotype threat and academic performance",
      "the fundamental attribution error in everyday judgments",
      "how social facilitation affects performance on simple vs complex tasks",
    ],
  },
  {
    subject: "cognitive_psychology",
    weight: 0.08,
    topics: [
      "the cocktail party effect and selective attention",
      "how chunking improves working memory capacity",
      "inattentional blindness in everyday perception",
      "the tip-of-the-tongue phenomenon and memory retrieval",
      "how dual-process theory explains fast and slow thinking",
    ],
  },
  {
    subject: "neuroscience",
    weight: 0.06,
    topics: [
      "how mirror neurons relate to empathy and imitation",
      "neuroplasticity and the brain's ability to rewire itself",
      "the role of the hippocampus in spatial navigation",
      "how sleep consolidates memories in the brain",
    ],
  },
  {
    subject: "history",
    weight: 0.08,
    topics: [
      "how the printing press changed the spread of scientific ideas",
      "the unexpected origins of the modern fire department",
      "how ice harvesting shaped nineteenth-century commerce",
      "the role of coffee houses in the European Enlightenment",
      "how wartime rationing led to food innovation",
    ],
  },
  {
    subject: "anthropology",
    weight: 0.06,
    topics: [
      "how gift-giving rituals reinforce social bonds across cultures",
      "the role of oral traditions in preserving cultural knowledge",
      "how different cultures conceptualize time as linear vs cyclical",
      "the anthropology of food taboos across societies",
    ],
  },
  {
    subject: "art_history",
    weight: 0.05,
    topics: [
      "how the camera obscura influenced Renaissance painting techniques",
      "the role of patronage in shaping Baroque art",
      "why Impressionists painted outdoors and what that meant for color theory",
      "how Japanese woodblock prints influenced European modern art",
    ],
  },
  {
    subject: "geology",
    weight: 0.05,
    topics: [
      "how geologists use ice cores to reconstruct ancient climates",
      "the role of plate tectonics in forming mountain ranges",
      "how stalactites and stalagmites record environmental changes",
    ],
  },
  {
    subject: "astronomy",
    weight: 0.05,
    topics: [
      "how astronomers detect exoplanets using the transit method",
      "the role of dark matter in galaxy formation",
      "why some moons in our solar system may harbor liquid water",
    ],
  },
  {
    subject: "environmental_science",
    weight: 0.05,
    topics: [
      "how microplastics enter the food chain from ocean to plate",
      "the concept of carbon sequestration in forests and soils",
      "how green roofs reduce urban stormwater runoff",
    ],
  },
  {
    subject: "linguistics",
    weight: 0.03,
    topics: [
      "how language shapes the way we perceive color",
      "the process of pidgin languages developing into creoles",
    ],
  },
];

// -- Question type rules (from reference: Q1=main_idea, Q2-Q3=detail/function, Q4=inference) --

const Q_TYPE_RULES = {
  Q1: [{ type: "main_idea", weight: 1.0 }],
  Q2: [
    { type: "detail", weight: 0.80 },
    { type: "function", weight: 0.20 },
  ],
  Q3: [
    { type: "detail", weight: 0.55 },
    { type: "function", weight: 0.45 },
  ],
  Q4: [
    { type: "inference", weight: 0.70 },
    { type: "predict_next", weight: 0.10 },
    { type: "function", weight: 0.10 },
    { type: "detail", weight: 0.10 },
  ],
};

// -- Distractor engineering (lecture-specific) -------------------------

const DISTRACTOR_FORMULAS = {
  detail: [
    {
      type: "wrong_detail",
      description: "Uses words/concepts from lecture but changes a key fact",
      example: "A blue pigment found only in tropical species (wrong: no pigment at all)",
    },
    {
      type: "topic_adjacent",
      description: "Plausible for the academic field but NOT stated in lecture",
      example: "Chemical reactions caused by UV light exposure (plausible but not stated)",
    },
    {
      type: "reversed_logic",
      description: "Inverts the relationship described in the lecture",
      example: "They break down more quickly than pigment-based colors (opposite)",
    },
  ],
  main_idea: [
    {
      type: "too_narrow",
      description: "Focuses on one detail instead of the overall topic",
      example: "How factory lighting affects worker productivity (too specific)",
    },
    {
      type: "wrong_topic",
      description: "Related academic topic but not THIS lecture",
      example: "The chemical composition of mycorrhizal fungi (not the focus)",
    },
    {
      type: "surface_word_trap",
      description: "Uses keywords from the lecture in wrong context",
      example: "Why car designers make vehicles look like faces (uses keywords misleadingly)",
    },
  ],
  inference: [
    {
      type: "over_generalization",
      description: "Takes a specific point and makes it too broad",
      example: "It was disproved entirely by recent research (too strong)",
    },
    {
      type: "reversed_logic",
      description: "Inverts what can be inferred",
      example: "It is always proportional to the species' population size (opposite)",
    },
    {
      type: "topic_adjacent",
      description: "Valid inference but about wrong aspect",
      example: "It is more common in children than in adults (no evidence for this)",
    },
  ],
  function: [
    {
      type: "wrong_purpose",
      description: "Misidentifies why the professor mentioned something",
      example: "To explain how elevator manufacturers use proxemics research (wrong reason)",
    },
    {
      type: "over_inference",
      description: "Assigns an argument the professor didn't make",
      example: "To argue that people should avoid using elevators (not professor's intent)",
    },
    {
      type: "literal_restatement",
      description: "Restates what was said rather than explaining why",
      example: "To describe what happened in the experiment (restates, not explains purpose)",
    },
  ],
  predict_next: [
    {
      type: "wrong_topic",
      description: "Plausible academic topic but not what the professor said",
    },
    {
      type: "too_narrow",
      description: "Focuses on a detail from this lecture rather than the next topic",
    },
    {
      type: "reversed_logic",
      description: "Inverts or confuses the preview statement",
    },
  ],
  attitude: [
    {
      type: "too_extreme",
      description: "Makes the professor's view sound more extreme than stated",
    },
    {
      type: "reversed_attitude",
      description: "Opposite of the professor's expressed view",
    },
    {
      type: "topic_adjacent",
      description: "Plausible attitude but not supported by the lecture",
    },
  ],
};

// -- Difficulty tiers (30% easy / 45% medium / 25% hard) --

const DIFFICULTY_TIERS = [
  {
    tier: "easy",
    target_pct: 30,
    transcript: "150-180 words, single clear concept, one straightforward example",
    questions: "Q1: main_idea (obvious). Q2-Q3: detail (directly stated). Q4: inference (straightforward)",
  },
  {
    tier: "medium",
    target_pct: 45,
    transcript: "180-220 words, concept with nuance, experiment or study with clear findings",
    questions: "Q1: main_idea (requires understanding beyond first sentence). Q2-Q3: detail or function. Q4: inference (requires connecting ideas)",
  },
  {
    tier: "hard",
    target_pct: 25,
    transcript: "200-250 words, complex concept, multiple examples or layers, broader significance",
    questions: "Q1: main_idea (not obvious from opener alone). Q2-Q3: detail/function (requires distinguishing similar info). Q4: inference (requires synthesizing multiple parts)",
  },
];

// -- Stem patterns (from reference samples) ---------------------------------

const STEM_PATTERNS = {
  main_idea: [
    "What is the lecture mainly about?",
  ],
  detail: [
    "According to the professor, what is/are {concept}?",
    "What does the professor say about {topic}?",
    "What did the {study/experiment} show?",
    "What happened when {event}?",
    "What does the professor say about {concept} and {topic}?",
  ],
  function: [
    "Why does the professor mention {specific detail}?",
    "Why does the professor describe {scenario}?",
  ],
  inference: [
    "What does the professor imply about {topic}?",
    "What can be inferred about {topic}?",
    "What attitude does the professor express toward {topic}?",
  ],
  predict_next: [
    "What will the class most likely discuss in the next session?",
  ],
};

// -- Reference examples section (2 complete examples from our reference data) --

function buildReferenceExamples() {
  return `## REAL REFERENCE EXAMPLES -- Study these carefully

EXAMPLE 1 (ecology, MEDIUM):
Subject: Keystone species and sea otters
Transcript:
"Okay, so today let's talk about a concept in ecology that really changed how we think about ecosystems: keystone species. The term was coined by Robert Paine in 1969, and he borrowed it from architecture. In a stone arch, the keystone is the single stone at the very top that holds the whole structure together. Remove it, and the arch collapses. A keystone species works the same way in an ecosystem. It's an organism whose impact is disproportionately large relative to its population size. Let me give you the classic example: sea otters along the Pacific coast. Sea otters feed on sea urchins. Now, sea urchins, if left unchecked, will devour kelp forests. And kelp forests are critical habitat for hundreds of marine species. When sea otter populations were nearly wiped out by fur hunters in the eighteenth and nineteenth centuries, sea urchin populations exploded, and the kelp forests were decimated. This is what ecologists call a trophic cascade, where removing one species triggers a chain reaction through the food web. When conservation efforts brought otters back, the kelp forests recovered. So even though otters are relatively small and not especially numerous, their role in the ecosystem is enormous."

Q1 (main_idea): What is the lecture mainly about?
  A. The history of fur hunting along the Pacific coast <- too_narrow
  B. The concept of keystone species and their outsized ecological impact <- CORRECT
  C. How kelp forests provide food for marine animals <- too_narrow
  D. Architectural principles used in ecology research <- surface_word_trap
Q2 (function): Why does the professor mention a stone arch?
  A. To describe how sea otters build shelters <- wrong_purpose
  B. To explain the origin of the term 'keystone species' <- CORRECT
  C. To compare the strength of different ecosystem structures <- wrong_purpose
  D. To illustrate how architecture influences marine biology <- over_inference
Q3 (detail): What happened when sea otter populations declined?
  A. Kelp forests grew thicker without otters disturbing them <- reversed_logic
  B. Sea urchin populations increased and destroyed kelp forests <- CORRECT
  C. Other predators replaced otters in controlling sea urchins <- topic_adjacent
  D. Marine species migrated to deeper ocean waters <- topic_adjacent
Q4 (inference): What does the professor imply about the importance of a species?
  A. It is always proportional to the species' population size <- reversed_logic
  B. It can only be measured through laboratory experiments <- topic_adjacent
  C. It may be far greater than its numbers would suggest <- CORRECT
  D. It depends primarily on the species' physical size <- reversed_logic

EXAMPLE 2 (cognitive_psychology, MEDIUM):
Subject: The doorway effect
Transcript:
"Have you ever walked into a room and completely forgotten why you went there? You're standing in the kitchen thinking, what did I come here for? Well, you're not alone. This is actually a well-documented phenomenon in cognitive psychology called the doorway effect. The idea is that our brains organize memories into what researchers call event models. Each event model is tied to a particular environment. When you pass through a doorway, your brain essentially closes one event file and opens a new one for the new room. And in that transition, some information from the previous event model can get lost. A team at the University of Notre Dame tested this using virtual environments. They had participants carry objects through doorways in a virtual building and found that people were significantly more likely to forget what they were carrying after passing through a doorway than after walking the same distance within a single room. Now, this isn't a sign of a bad memory. It's actually your brain being efficient. Rather than holding onto every detail from every room, your brain prunes and organizes information by location. It's a feature, not a bug."

Q1 (main_idea): What is the lecture mainly about?
  A. Common causes of memory loss in older adults <- wrong_topic
  B. A cognitive phenomenon related to walking through doorways <- CORRECT
  C. How virtual reality is used to treat memory disorders <- surface_word_trap
  D. The difference between short-term and long-term memory <- wrong_topic
Q2 (detail): According to the professor, what are 'event models'?
  A. Physical maps of a building stored in memory <- wrong_detail
  B. Mental files that the brain ties to particular environments <- CORRECT
  C. Programs used in virtual reality experiments <- surface_word_trap
  D. Lists of tasks that people carry from room to room <- wrong_detail
Q3 (detail): What did the University of Notre Dame study find?
  A. People remembered more in virtual environments than in real ones <- reversed_logic
  B. Walking long distances caused more memory loss than short distances <- wrong_detail
  C. Participants forgot objects more often after passing through doorways <- CORRECT
  D. Carrying objects improved participants' overall memory performance <- reversed_logic
Q4 (inference): What does the professor imply about the doorway effect?
  A. It indicates a serious memory problem that should be treated <- over_generalization
  B. It is a normal and efficient way the brain manages information <- CORRECT
  C. It only occurs in virtual environments, not in real life <- reversed_logic
  D. It affects older adults more severely than younger people <- topic_adjacent`;
}

// -- Anti-patterns section --

function buildAntiPatterns() {
  return `## ANTI-PATTERNS -- Items with these flaws will be REJECTED

1. Transcript sounds like a WRITTEN ARTICLE read aloud -- must sound like a professor speaking
2. NO contractions used -- every lecture must have contractions (don't, it's, that's, you're, etc.)
3. Transcript doesn't address students -- must use "you" at least once
4. NO discourse markers -- must include "so", "now", "actually", etc.
5. No clear concept/term defined or named
6. No example, experiment, or real-world illustration
7. All 4 questions test the exact same piece of information
8. A distractor repeats lecture text VERBATIM -- too easy to spot
9. Questions can be answered using general knowledge alone (no listening needed)
10. Lecture opener is dry and academic ("Today we will examine the phenomenon of...")

AMBIGUITY PREVENTION -- THE #1 QUALITY ISSUE:
Before finalizing each distractor, ask yourself: "Could a careful student who listened well reasonably select this?" If the distractor states something that IS true or implied by the lecture, it is NOT a valid distractor.

REAL FAILURES FROM SIMILAR PIPELINES:
- Lecture explains "structural coloration doesn't use pigment"
  BAD distractor for detail Q: "A process that creates color without chemical dyes" <- TOO CLOSE to correct answer
  WHY: "no pigment" and "no chemical dyes" are essentially the same thing.

- Professor says "this is what ecologists call a trophic cascade"
  BAD distractor: "A chain reaction in the food web" <- THIS IS THE DEFINITION, not a distractor
  WHY: A trophic cascade IS a chain reaction in the food web.

- Professor mentions "implications well beyond factories"
  BAD inference distractor: "The effect applies to many settings" <- DIRECTLY STATED
  WHY: "well beyond factories" = "applies to many settings"

SAFE distractor patterns:
- For detail Qs: Change ONE key fact (the WHAT, not the framing)
- For function Qs: Misidentify the PURPOSE (why) not the content (what)
- For inference Qs: Go slightly too far, or invert the direction
- For main_idea Qs: Pick a detail that's mentioned but isn't the MAIN point`;
}

/**
 * Build the LAT generation prompt.
 *
 * @param {number} count -- items to generate (1-3, lectures are very token-heavy with 4Qs)
 * @param {object} opts
 * @param {string[]} [opts.excludeTopics] -- topic descriptions to avoid
 * @param {string} [opts.difficultyOverride] -- force all items to one difficulty
 * @returns {string} prompt
 */
function buildLATPrompt(count = 2, opts = {}) {
  const { excludeTopics = [], difficultyOverride = null } = opts;

  // -- 1. Assign answer positions (strict rotation across 4 questions) --
  const positions = ["A", "B", "C", "D"];
  const qPositions = [];
  for (let i = 0; i < count; i++) {
    qPositions.push([
      positions[i % 4],
      positions[(i + 1) % 4],
      positions[(i + 2) % 4],
      positions[(i + 3) % 4],
    ]);
  }

  // -- 2. Assign difficulty tiers --
  const difficulties = [];
  if (difficultyOverride) {
    for (let i = 0; i < count; i++) difficulties.push(difficultyOverride);
  } else {
    const easyCount = Math.max(1, Math.round(count * 0.3));
    const hardCount = Math.max(0, Math.round(count * 0.25));
    const medCount = count - easyCount - hardCount;
    for (let i = 0; i < easyCount; i++) difficulties.push("easy");
    for (let i = 0; i < medCount; i++) difficulties.push("medium");
    for (let i = 0; i < hardCount; i++) difficulties.push("hard");
    // Shuffle
    for (let i = difficulties.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [difficulties[i], difficulties[j]] = [difficulties[j], difficulties[i]];
    }
  }

  // -- 3. Assign Q types per item --
  function pickType(rules) {
    const r = Math.random();
    let cumul = 0;
    for (const rule of rules) {
      cumul += rule.weight;
      if (r < cumul) return rule.type;
    }
    return rules[rules.length - 1].type;
  }

  const qTypeAssignments = difficulties.map(() => ({
    q1Type: "main_idea",
    q2Type: pickType(Q_TYPE_RULES.Q2),
    q3Type: pickType(Q_TYPE_RULES.Q3),
    q4Type: pickType(Q_TYPE_RULES.Q4),
  }));

  // Ensure no 3 questions have the same type
  for (const qt of qTypeAssignments) {
    const types = [qt.q1Type, qt.q2Type, qt.q3Type, qt.q4Type];
    const counts = {};
    types.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    if ((counts.detail || 0) >= 3) {
      qt.q3Type = "function";
    }
  }

  // -- 4. Select topics (weighted, diverse) --
  const allTopics = [];
  for (const pool of TOPIC_POOL) {
    for (const topic of pool.topics) {
      allTopics.push({ subject: pool.subject, topic, weight: pool.weight });
    }
  }
  const shuffled = allTopics.sort(() => Math.random() - 0.5);
  const selected = [];
  const subjectCount = {};
  for (const t of shuffled) {
    if (selected.length >= count) break;
    if (excludeTopics.some(ex => t.topic.includes(ex) || ex.includes(t.topic))) continue;
    const c = subjectCount[t.subject] || 0;
    if (c < 1) { // max 1 per subject per batch for diversity
      selected.push(t);
      subjectCount[t.subject] = c + 1;
    }
  }
  // Fill remaining if needed
  while (selected.length < count) {
    const t = shuffled[selected.length % shuffled.length];
    selected.push(t);
  }

  // -- 5. Build item specs --
  const itemSpecs = [];
  for (let i = 0; i < count; i++) {
    const t = selected[i];
    const qt = qTypeAssignments[i];
    const qp = qPositions[i];

    itemSpecs.push(
      `Item ${i + 1}:\n` +
      `  Subject: ${t.subject}\n` +
      `  Topic: ${t.topic}\n` +
      `  Difficulty: ${difficulties[i]}\n` +
      `  Q1 type: main_idea | Q1 correct answer: ${qp[0]}\n` +
      `  Q2 type: ${qt.q2Type} | Q2 correct answer: ${qp[1]}\n` +
      `  Q3 type: ${qt.q3Type} | Q3 correct answer: ${qp[2]}\n` +
      `  Q4 type: ${qt.q4Type} | Q4 correct answer: ${qp[3]}`
    );
  }

  // -- 6. Reference examples --
  const examplesSection = buildReferenceExamples();

  // -- 7. Distractor section --
  const distractorSection = `## DISTRACTOR ENGINEERING -- How to build wrong answers

Each question MUST have 3 distractors. Use the type-specific formulas below.

### For MAIN_IDEA questions (Q1):
1. **too_narrow**: Focuses on one detail from the lecture, missing the overall topic
2. **wrong_topic**: Related academic topic but not what THIS lecture covers
3. **surface_word_trap**: Uses keywords from the lecture in a misleading context

### For DETAIL questions (Q2/Q3):
1. **wrong_detail**: Uses words from the lecture but changes a key fact
2. **topic_adjacent**: Plausible for the academic field but NOT stated in the lecture
3. **reversed_logic**: Inverts the relationship described (cause/effect, increase/decrease)

### For FUNCTION questions (Q2/Q3):
1. **wrong_purpose**: Misidentifies WHY the professor mentioned something
2. **over_inference**: Assigns an argument or intent the professor didn't express
3. **literal_restatement**: Restates WHAT was said rather than explaining WHY

### For INFERENCE questions (Q4):
1. **over_generalization**: Takes a specific point and makes it too broad/strong
2. **reversed_logic**: Inverts what can be logically inferred
3. **topic_adjacent**: Related inference but not supported by the lecture

### For PREDICT_NEXT questions (Q4 -- only when transcript ends with a preview):
1. **wrong_topic**: Plausible academic topic but not what the professor said
2. **too_narrow**: Focuses on a detail from THIS lecture rather than the NEXT topic
3. **reversed_logic**: Inverts or confuses the preview statement

### CRITICAL DISTRACTOR RULES:
- Every distractor MUST be grammatically perfect
- NEVER make a distractor that is also a valid answer
- Within one question, use at least 2 different distractor types
- Option word count: 6-12 words each, similar length across all 4
- Correct answer must NOT consistently be the longest
- In each item, no more than 1 question should have the correct answer as the longest option`;

  // -- 8. Anti-patterns --
  const antiPatternsSection = buildAntiPatterns();

  // -- 9. Assemble full prompt --
  return `You are an ETS-caliber TOEFL question writer for the 2026 "Listen to an Academic Talk" task.

## TASK FORMAT
The test-taker hears a SHORT academic lecture by a professor, then answers 4 multiple-choice questions. This tests COMPREHENSION of a spoken academic lecture -- main ideas, details, professor's purpose, and inferences.

## LECTURE TRANSCRIPT DESIGN RULES

### Structure (hook -> concept -> example -> significance):
1. Opening hook: Engage students with a question, relatable scenario, or "So..." opener (1-2 sentences)
2. Key concept: Explicitly name and define the academic concept/term (2-3 sentences)
3. Example/experiment: Give a concrete example, study, or real-world illustration (3-5 sentences)
4. Significance: Connect to broader implications, applications, or contrast with traditional view (2-3 sentences)

### Format:
- Single speaker: a professor delivering a lecture to a class
- 150-250 words total (target 180-220)
- Academic but CONVERSATIONAL register -- this is SPOKEN, not written

### Spoken register (CRITICAL -- must sound like a real professor talking):
- Use contractions FREELY: don't, it's, that's, here's, what's, you're, can't, won't, didn't, doesn't, I'm, we're, there's
- Include 4+ discourse markers: "So", "Now", "Actually", "Here's the thing", "Here's the key", "What's interesting", "Let me give you"
- Address students directly: "you've probably", "you might think", "if you've ever", "think about"
- Include at least 1 rhetorical question ("right?", "does that make sense?")
- Use casual academic phrases: "here's the thing", "what's really interesting", "it turns out", "in other words"
- Mix sentence lengths: short punchy statements with longer explanatory ones
- DO NOT sound like a textbook or journal article

### Must-have elements:
- A CLEAR academic concept/term that is explicitly named
- At least one concrete example, experiment, or analogy
- Information density -- enough specific facts to support 4 questions
- A conclusion or takeaway (significance, implication, or preview of next topic)

${examplesSection}

${distractorSection}

${antiPatternsSection}

## ITEMS TO GENERATE

${itemSpecs.join("\n\n")}

${excludeTopics.length > 0 ? `\n## DO NOT REUSE THESE TOPICS (already in bank):\n${excludeTopics.slice(0, 20).map(t => `- "${t}"`).join("\n")}\n` : ""}

## OUTPUT FORMAT

Return a JSON array. Each element:
{
  "subject": "ecology",
  "topic": "short topic description",
  "difficulty": "easy|medium|hard",
  "transcript": "The full lecture text as a single string. Must be 150-250 words. Must sound like spoken English with contractions and discourse markers.",
  "questions": [
    {
      "type": "main_idea",
      "stem": "What is the lecture mainly about?",
      "options": {
        "A": "Option A text",
        "B": "Option B text",
        "C": "Option C text",
        "D": "Option D text"
      },
      "answer": "B",
      "explanation": "用中文解释为什么正确答案对，每个干扰项为什么错。",
      "distractor_types": {
        "A": "too_narrow",
        "C": "wrong_topic",
        "D": "surface_word_trap"
      }
    },
    {
      "type": "detail",
      "stem": "According to the professor, what is X?",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "answer": "C",
      "explanation": "...",
      "distractor_types": { "A": "wrong_detail", "B": "topic_adjacent", "D": "reversed_logic" }
    },
    {
      "type": "function",
      "stem": "Why does the professor mention X?",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "answer": "D",
      "explanation": "...",
      "distractor_types": { "A": "wrong_purpose", "B": "over_inference", "C": "literal_restatement" }
    },
    {
      "type": "inference",
      "stem": "What does the professor imply about X?",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "answer": "A",
      "explanation": "...",
      "distractor_types": { "B": "over_generalization", "C": "reversed_logic", "D": "topic_adjacent" }
    }
  ]
}

IMPORTANT: The "explanation" field in each question MUST be written in Chinese (中文). Explain why the correct answer is right and why each distractor is wrong, all in Chinese.

Generate exactly ${count} items. Return ONLY the JSON array, no markdown fencing, no extra text.`;
}

module.exports = {
  buildLATPrompt,
  TOPIC_POOL,
  DIFFICULTY_TIERS,
  DISTRACTOR_FORMULAS,
  Q_TYPE_RULES,
  STEM_PATTERNS,
};
