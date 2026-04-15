/**
 * Listen to an Academic Talk (LAT) — Prompt builder
 *
 * 2026 TOEFL Listening Task:
 * - Test-taker hears a short academic lecture (100-250 words)
 * - Answers 3-5 MCQ with 4 options each
 * - Tests main idea, detail, inference, function, organization, attitude
 * - Lecture should sound spoken (contractions, discourse markers)
 *
 * Topic pool mirrors the Academic Passage (AP) reading topics
 * for consistency across the test.
 */

const TOPIC_POOL = [
  {
    subject: "biology",
    subtopics: [
      "animal migration patterns",
      "plant defense mechanisms",
      "symbiotic relationships in ecosystems",
      "genetic adaptation to environments",
      "cellular communication processes",
      "deep-sea organism survival strategies",
      "pollination and co-evolution",
      "circadian rhythms in animals",
    ],
  },
  {
    subject: "environmental_science",
    subtopics: [
      "coral reef conservation efforts",
      "urban heat island effect",
      "deforestation and carbon cycles",
      "microplastics in ocean ecosystems",
      "renewable energy transition challenges",
      "permafrost thawing and methane release",
      "water scarcity and desalination",
      "invasive species management",
    ],
  },
  {
    subject: "psychology",
    subtopics: [
      "cognitive bias in decision making",
      "childhood language acquisition stages",
      "effects of sleep deprivation on memory",
      "social conformity experiments",
      "the placebo effect in clinical trials",
      "motivation and reward systems in the brain",
      "emotional intelligence development",
      "attention and multitasking limitations",
    ],
  },
  {
    subject: "history",
    subtopics: [
      "the Silk Road trade networks",
      "ancient Roman engineering innovations",
      "the printing press and information revolution",
      "maritime exploration in the 15th century",
      "the industrial revolution and urbanization",
      "ancient Egyptian agricultural techniques",
      "medieval guild systems",
      "the development of writing systems",
    ],
  },
  {
    subject: "geology",
    subtopics: [
      "plate tectonics and earthquake prediction",
      "formation of volcanic islands",
      "sedimentary rock and fossil records",
      "glacial erosion and landscape formation",
      "mineral formation deep underground",
      "the water cycle and groundwater systems",
      "cave formation and speleothem growth",
      "soil composition and fertility",
    ],
  },
  {
    subject: "astronomy",
    subtopics: [
      "exoplanet detection methods",
      "the life cycle of stars",
      "dark matter evidence and theories",
      "the formation of our solar system",
      "black holes and gravitational waves",
      "the search for extraterrestrial life",
      "lunar geology and exploration",
      "cosmic microwave background radiation",
    ],
  },
  {
    subject: "anthropology",
    subtopics: [
      "early human tool-making techniques",
      "cultural rituals and social bonding",
      "the spread of agriculture from Mesopotamia",
      "language diversity and endangerment",
      "kinship systems in different cultures",
      "archaeological dating methods",
      "prehistoric art and symbolism",
      "human migration out of Africa",
    ],
  },
  {
    subject: "technology",
    subtopics: [
      "the development of the internet",
      "artificial intelligence and machine learning basics",
      "3D printing in manufacturing",
      "blockchain technology applications",
      "robotics in healthcare",
      "cybersecurity threat evolution",
      "quantum computing fundamentals",
      "the impact of social media on communication",
    ],
  },
  {
    subject: "art",
    subtopics: [
      "the Renaissance and perspective in painting",
      "Impressionism as a reaction to photography",
      "architecture and sustainability",
      "the role of patronage in art history",
      "abstract expressionism movement",
      "music theory and cultural identity",
      "documentary filmmaking techniques",
      "digital art and new media",
    ],
  },
  {
    subject: "sociology",
    subtopics: [
      "urbanization and community formation",
      "social media and identity construction",
      "income inequality and social mobility",
      "education systems and social stratification",
      "globalization and cultural homogenization",
      "collective behavior and social movements",
      "healthcare access disparities",
      "the changing nature of work",
    ],
  },
  {
    subject: "chemistry",
    subtopics: [
      "catalysis and reaction rates",
      "polymer chemistry and plastics",
      "photosynthesis at the molecular level",
      "water purification chemical processes",
      "battery chemistry and energy storage",
      "food chemistry and preservation",
      "atmospheric chemistry and ozone",
      "biochemistry of enzymes",
    ],
  },
  {
    subject: "physics",
    subtopics: [
      "wave behavior and interference patterns",
      "thermodynamics and entropy",
      "electromagnetism in everyday life",
      "fluid dynamics and aerodynamics",
      "the physics of sound and acoustics",
      "nuclear energy principles",
      "optics and light behavior",
      "relativity in simple terms",
    ],
  },
];

/**
 * Question types for academic talk comprehension.
 */
const QUESTION_TYPES = [
  "main_idea",     // What is the lecture mainly about?
  "detail",        // What specific fact is mentioned?
  "inference",     // What can be inferred?
  "function",      // Why does the professor mention X?
  "organization",  // How does the professor organize the information?
  "attitude",      // What is the professor's attitude toward X?
];

/**
 * Build prompt for generating LAT items.
 *
 * @param {number} count — items to generate (1-10)
 * @param {object} opts
 * @param {string[]} [opts.excludeIds] — IDs to avoid duplicating
 * @returns {string} prompt
 */
function buildLATPrompt(count = 5, opts = {}) {
  const { excludeIds = [] } = opts;

  // Select diverse topics
  const selected = [];
  for (let i = 0; i < count; i++) {
    const topic = TOPIC_POOL[i % TOPIC_POOL.length];
    const sub = topic.subtopics[Math.floor(Math.random() * topic.subtopics.length)];
    // 3-5 questions, rotating
    const numQ = 3 + (i % 3); // 3, 4, 5, 3, 4, ...
    // Select question types for this item
    const qTypes = [];
    qTypes.push("main_idea"); // Always include main_idea
    const remaining = QUESTION_TYPES.filter(t => t !== "main_idea");
    for (let q = 1; q < numQ; q++) {
      qTypes.push(remaining[(i + q) % remaining.length]);
    }
    selected.push({ subject: topic.subject, subtopic: sub, num_questions: numQ, question_types: qTypes });
  }

  const scenarioList = selected
    .map((s, i) => `${i + 1}. Subject: ${s.subject} | Topic: ${s.subtopic} | Questions: ${s.num_questions} (types: ${s.question_types.join(", ")})`)
    .join("\n");

  return `You are a TOEFL listening question writer for the 2026 format "Listen to an Academic Talk" task.

## TASK DESCRIPTION

The test-taker hears a short academic LECTURE (100-250 words) delivered by a professor. Then answers 3-5 multiple-choice questions. The lecture covers an academic topic and should sound like natural spoken English — NOT like a textbook.

## SPOKEN STYLE REQUIREMENTS

The lecture MUST sound like a real professor talking to students:
- Use discourse markers: "so", "now", "actually", "let me explain", "what's interesting is", "you might think that...", "here's the thing"
- Use contractions: "it's", "don't", "that's", "we're", "they've"
- Include brief asides: "and this is really cool", "which surprised researchers"
- Use rhetorical questions: "So why does this matter?", "What do you think happened?"
- Occasionally address students: "as you read in chapter 5", "remember last week when we discussed..."

## EXAMPLES (ETS-style)

EXAMPLE:
Subject: Biology
Lecture: "So today I want to talk about something really fascinating — how plants defend themselves. Now, you might think plants are just sitting there, right? But actually, they've developed some pretty sophisticated defense mechanisms. Take the acacia tree, for instance. When a giraffe starts eating its leaves, the tree releases a chemical into the air. And here's what's interesting — nearby acacia trees pick up that chemical signal and start producing bitter-tasting compounds in their leaves BEFORE the giraffe even gets to them. It's basically a warning system. So the giraffe has to keep moving to find trees that haven't gotten the message yet. Pretty clever for something without a brain, right?"

Q1 (main_idea): What is the lecture mainly about?
A. How giraffes find food in the wild
B. Chemical communication among plants
C. The evolution of acacia trees
D. Plant defense mechanisms against herbivores
Answer: D

Q2 (detail): According to the professor, what happens when an acacia tree is being eaten?
A. It drops its leaves to the ground
B. It releases a chemical signal into the air
C. It grows thorns on its branches
D. It attracts predators of the giraffe
Answer: B

Q3 (function): Why does the professor mention the giraffe?
A. To compare animal and plant intelligence
B. To illustrate how the plant defense mechanism works in practice
C. To explain why giraffes are endangered
D. To introduce the topic of animal migration
Answer: B

## REQUIREMENTS

1. **Lecture text**: 100-250 words. MUST sound spoken, not written. Include discourse markers, contractions, and a conversational tone.
2. **Academic content**: Should teach a real concept from the subject area. Factually accurate.
3. **Questions**: 3-5 MCQ per lecture. Each tests a DIFFERENT comprehension skill:
   - **main_idea**: The overall topic or purpose
   - **detail**: A specific fact stated in the lecture
   - **inference**: What is implied but not directly stated
   - **function**: Why the professor mentions a particular example or point
   - **organization**: How information is structured (comparison, chronological, cause-effect)
   - **attitude**: The professor's opinion or feeling about the topic
4. **Options**: 4 choices (A/B/C/D) per question, 5-15 words each, similar length
5. **Answer position**: Distribute A/B/C/D answers EVENLY across all questions in the batch.
6. **Explanation**: Brief explanation for each question's correct answer.

## TOPICS TO WRITE

${scenarioList}

## OUTPUT FORMAT

Return a JSON array:
\`\`\`json
[
  {
    "subject": "biology",
    "subtopic": "plant defense mechanisms",
    "lecture": "The full lecture text here, 100-250 words, spoken style.",
    "questions": [
      {
        "question_type": "main_idea",
        "question": "What is the lecture mainly about?",
        "options": {
          "A": "Option A text",
          "B": "Option B text",
          "C": "Option C text",
          "D": "Option D text"
        },
        "answer": "D",
        "explanation": "Why D is correct."
      }
    ]
  }
]
\`\`\`

Generate exactly ${count} items. Return ONLY the JSON array, no markdown fencing.`;
}

module.exports = { buildLATPrompt, TOPIC_POOL, QUESTION_TYPES };
