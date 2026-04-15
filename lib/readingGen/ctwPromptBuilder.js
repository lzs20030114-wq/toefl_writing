/**
 * Complete the Words — Prompt builder for passage generation.
 *
 * The AI only generates the passage text. Blanking is done mechanically
 * by cTestBlanker.js — no AI involvement in the blank creation step.
 *
 * v2: Calibrated to match real ETS CTW difficulty. Key insight: real ETS
 * passages use mostly common, concrete vocabulary (CEFR A2-B1), so the
 * mechanical C-test blanking naturally lands on easy words like "that",
 * "people", "trees", "from". Our earlier prompt was too academic.
 */

const { CTW_PROFILE, ETS_FLAVOR } = require("../readingBank/readingEtsProfile");

// Topics calibrated to TOEFL academic passages — expanded for breadth
const TOPIC_POOL = [
  { topic: "biology", subtopics: ["animal behavior", "ecosystems", "cell biology", "genetics", "marine biology", "plant biology", "evolution", "microbiology", "pollination", "symbiosis", "bioluminescence", "photosynthesis", "animal migration", "camouflage", "insect colonies", "deep sea organisms", "seed dispersal", "coral reefs", "immune system", "hibernation"] },
  { topic: "environmental_science", subtopics: ["climate change", "conservation", "pollution", "renewable energy", "deforestation", "ocean acidification", "biodiversity", "wetlands", "soil erosion", "urban heat islands", "water purification", "permafrost melting", "carbon cycle", "invasive species", "desertification", "ozone layer", "green architecture", "sustainable agriculture"] },
  { topic: "psychology", subtopics: ["cognitive development", "memory", "decision making", "social behavior", "perception", "learning", "emotion", "sleep psychology", "motivation", "attention", "language acquisition", "color perception", "group dynamics", "cognitive bias", "stress response", "creativity", "placebo effect", "habit formation"] },
  { topic: "history", subtopics: ["ancient civilizations", "industrial revolution", "exploration", "trade routes", "technological inventions", "cultural exchange", "silk road", "ancient Egypt", "Roman engineering", "medieval guilds", "maritime navigation", "agricultural revolution", "colonial trade", "telegraph history", "early medicine", "ancient astronomy"] },
  { topic: "geology", subtopics: ["plate tectonics", "volcanism", "erosion", "minerals", "fossils", "earthquakes", "rock formation", "ice ages", "geysers", "cave formation", "river deltas", "mountain formation", "ocean floor", "meteor impacts", "soil composition", "gemstone formation"] },
  { topic: "astronomy", subtopics: ["solar system", "star formation", "space exploration", "comets", "black holes", "exoplanets", "lunar geology", "asteroid belts", "nebulae", "gravitational waves", "Mars exploration", "satellite technology", "cosmic radiation", "planetary atmospheres", "dwarf planets"] },
  { topic: "anthropology", subtopics: ["early humans", "language origins", "cultural rituals", "tool development", "migration patterns", "cave art", "ancient pottery", "burial customs", "early agriculture", "oral traditions", "kinship systems", "tattooing history", "stone age trade", "ancient textiles", "fire use"] },
  { topic: "technology", subtopics: ["telecommunications", "computing", "materials science", "engineering", "transportation", "bridge design", "water treatment", "refrigeration", "glass making", "paper manufacturing", "clock mechanisms", "steam power", "electrical grids", "battery technology", "3D printing", "textile machinery"] },
  { topic: "art", subtopics: ["Renaissance", "photography history", "architecture", "sculpture", "music theory", "cinema history", "impressionism", "Japanese woodblock prints", "mosaic art", "fresco techniques", "calligraphy", "stained glass", "street art", "pottery glazing", "theater history", "dance anthropology"] },
  { topic: "sociology", subtopics: ["urbanization", "education systems", "inequality", "globalization", "community development", "social media effects", "public health", "immigration patterns", "labor movements", "housing policy", "food security", "disaster response", "public transportation", "aging populations", "cooperative economics"] },
  { topic: "chemistry", subtopics: ["molecular bonding", "chemical reactions", "organic compounds", "crystal structures", "catalysis", "fermentation", "corrosion", "dye chemistry", "polymer science", "water chemistry"] },
  { topic: "physics", subtopics: ["thermodynamics", "electromagnetic waves", "fluid dynamics", "optics", "acoustics", "magnetism", "gravity", "nuclear physics", "friction", "superconductivity"] },
];

/**
 * Build a prompt to generate N academic passages for Complete the Words.
 *
 * @param {number} count — number of passages to generate (1-10)
 * @param {object} opts
 * @param {string[]} [opts.excludeTopics] — topics already covered
 * @param {string} [opts.difficulty] — easy/medium/hard
 * @param {string[]} [opts.rejectionFeedback] — reasons previous items were rejected
 * @returns {string} prompt
 */
function buildCTWPrompt(count = 5, opts = {}) {
  const { excludeTopics = [], excludeSubjects = [], difficulty = "medium", rejectionFeedback = [] } = opts;

  // Select topics ensuring diversity — never repeat a subtopic within same batch
  const available = TOPIC_POOL.filter(t => !excludeTopics.includes(t.topic));
  const usedSubtopics = new Set();
  const selected = [];
  for (let i = 0; i < count; i++) {
    // Cycle through topics to ensure diversity (don't repeat same topic in one batch)
    const topicIdx = i % available.length;
    const t = available[topicIdx];
    // Pick a subtopic that hasn't been used in this batch AND isn't in excludeSubjects
    const availSubs = t.subtopics.filter(s =>
      !usedSubtopics.has(t.topic + "/" + s) &&
      !excludeSubjects.some(ex => ex.toLowerCase().includes(s.toLowerCase()))
    );
    const st = availSubs.length > 0
      ? availSubs[Math.floor(Math.random() * availSubs.length)]
      : t.subtopics[Math.floor(Math.random() * t.subtopics.length)];
    usedSubtopics.add(t.topic + "/" + st);
    selected.push({ topic: t.topic, subtopic: st });
  }

  const topicList = selected.map((s, i) => `${i + 1}. Topic: ${s.topic} / ${s.subtopic}`).join("\n");

  let feedback = "";
  if (rejectionFeedback.length > 0) {
    feedback = `\n\nPREVIOUS ITEMS WERE REJECTED. Fix these issues:\n${rejectionFeedback.map(r => `- ${r}`).join("\n")}`;
  }

  return `You are a TOEFL reading passage writer. Generate ${count} short passages for the "Complete the Words" (C-test) task.

## REAL ETS EXAMPLES — Study these carefully

EXAMPLE 1 (ETS official — anthropology, 46 words):
"We know from drawings that have been preserved in caves for over 10,000 years that early humans performed dances as a group activity. We might think that prehistoric people concentrated only on basic survival. However, it is clear from the record that dancing was important to them."

Words that get blanked (every other word from sentence 2 onward):
→ might, that, people, only, basic, However, is, from, record, dancing
Notice: 7 out of 10 blanks are common everyday words (might, that, people, only, is, from, dancing). Only "basic" and "record" require slightly more thought.

EXAMPLE 2 (third party — physics, 74 words):
"Rainbows are beautiful arcs of color that appear after rain. They form when sunlight passes through water droplets and splits into bright colors across the sky. Each color has its own wavelength that creates the rainbow's pattern. People often see rainbows as symbols of hope and beauty in art and culture, inspiring creativity and joy."

Blanked words:
→ They, sunlight, through, and, bright, across, sky, has, own, creates
Notice: 8 out of 10 are simple words (They, through, and, bright, across, sky, has, own). Only "sunlight" and "creates" are slightly harder.

EXAMPLE 3 (third party — biology, 71 words):
"Giraffes are the tallest animals on land, known for their long necks and gentle nature. The majority of their day is spent feeding on leaves from tall trees. Their height allows them to reach leaves that other animals cannot. Their powerful legs help them defend against predators, and they can escape danger by running at high speeds when necessary."

Blanked words:
→ majority, their, spent, on, from, trees, height, reach, that, animals
Notice: 7 out of 10 are everyday words (their, spent, on, from, trees, that, animals). "majority", "height", "reach" are the harder ones.

## KEY PATTERN FROM REAL EXAMS

The blanking algorithm removes the second half of every other word starting from sentence 2. This means:
- ~70% of blanks naturally land on SHORT, COMMON words (3-6 letters)
- ~30% land on content words that require more thought
- The passage should read like a POPULAR SCIENCE article, NOT an academic paper

## REQUIREMENTS FOR EACH PASSAGE

1. **Length**: 4-5 sentences, **MINIMUM 65 words, target 70-85 words**. Passages shorter than 55 words will be IMMEDIATELY REJECTED — this is the #1 rejection reason. Write LONGER than you think is necessary. After writing each passage, COUNT the words and add another sentence if under 65 words.
2. **First sentence**: Always kept intact (never blanked). Make it an interesting, clear topic sentence.
3. **Register**: Write like National Geographic or a science textbook for high school students — NOT like a journal abstract.
   - Use CONCRETE nouns: animals, places, objects, events (not "mechanisms", "paradigms", "phenomena")
   - Use COMMON verbs: know, find, help, make, grow, live, move, build (not "facilitate", "demonstrate", "constitute")
   - Average word length should be 4.5-5.5 characters
4. **Vocabulary level**: CEFR A2-B1 as the base. You may include 1-2 B2 words per passage, no more.
   - YES: trees, animals, water, caves, people, dance, grow, build, bright, reach, spent
   - SPARINGLY: majority, observations, preserved, civilization, effectively
   - NO: meticulously, sophisticated, fundamental, cellular, unprecedented, paradigm
5. **Sentence structure**: Natural and varied.
   - Include at least one of: passive voice, relative clause, or contrast word (however/but/although) — but NOT all three forced into every passage
   - Keep sentences 12-20 words each
   - No first-person (I/we/our), no rhetorical questions
6. **Factual accuracy**: Content must be true. No invented studies or statistics.

## C-TEST WORD FREQUENCY CONSTRAINT (CRITICAL)

After the first sentence, look at the words in EVEN positions (2nd, 4th, 6th... — these will become blanks):
- At least 7 out of 10 blank-position words should be COMMON words: function words (that, from, with, their, is, are) or everyday content words (people, trees, water, help, make, find, grow, used, known)
- At most 2-3 blank-position words should be longer academic words (8+ characters)
- Avoid putting rare or domain-specific words at blank positions — put them at ODD positions (which stay intact) instead

Think of it this way: the INTERESTING vocabulary goes in the visible positions; the COMMON vocabulary goes in the blanked positions.

## TOPICS TO WRITE ABOUT

${topicList}

## OUTPUT FORMAT

Return a JSON array. Each element:
\`\`\`json
{
  "topic": "biology",
  "subtopic": "animal migration",
  "passage": "The complete passage text."
}
\`\`\`

${excludeSubjects.length > 0 ? `\n## DO NOT WRITE ABOUT THESE SUBJECTS (already generated):\n${excludeSubjects.map(s => `- ${s}`).join("\n")}\nChoose COMPLETELY DIFFERENT subjects for each passage.\n` : ""}
## DIVERSITY RULE
Each passage MUST be about a DIFFERENT specific subject. Vary sentence 1 openings — do not always start with the same pattern. Mix active and passive voice across passages.

Return ONLY the JSON array, no markdown fencing, no explanation.${feedback}`;
}

module.exports = { buildCTWPrompt, TOPIC_POOL };
