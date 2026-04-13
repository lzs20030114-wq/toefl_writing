/**
 * Complete the Words — Prompt builder for passage generation.
 *
 * The AI only generates the passage text. Blanking is done mechanically
 * by cTestBlanker.js — no AI involvement in the blank creation step.
 *
 * Uses ETS flavor data from readingEtsProfile.js to guide generation.
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

  // Difficulty is no longer passed to DeepSeek — it's calculated post-hoc
  // based on the blanked words. All passages use the same quality level.
  const difficultyGuide = {
    easy: "Use a mix of common and mid-frequency academic vocabulary (CEFR B1-B2). Keep sentences clear with standard clause structures. FK grade 9-12.",
    medium: "Use a mix of common and mid-frequency academic vocabulary (CEFR B2-C1). Include 1-2 relative clauses. FK grade 10-12.",
    hard: "Use a mix of common and mid-frequency academic vocabulary (CEFR B2-C1). Include relative clauses and one comparison or conditional. FK grade 10-13.",
  };

  const topicList = selected.map((s, i) => `${i + 1}. Topic: ${s.topic} / ${s.subtopic}`).join("\n");

  let feedback = "";
  if (rejectionFeedback.length > 0) {
    feedback = `\n\nPREVIOUS ITEMS WERE REJECTED. Fix these issues:\n${rejectionFeedback.map(r => `- ${r}`).join("\n")}`;
  }

  return `You are a TOEFL reading passage writer. Generate ${count} short academic passages for the "Complete the Words" task.

## REQUIREMENTS FOR EACH PASSAGE

1. **Length**: 4 sentences. Each sentence 15-20 words. Total 60-80 words.
2. **Template** — copy this structure EXACTLY for every passage:

EXAMPLE PASSAGE (study this carefully):
"Coral reefs are widely recognized as among the most biodiverse ecosystems found in tropical oceans. These complex structures, which are built by colonies of tiny organisms, provide essential habitat for thousands of species. However, rising ocean temperatures may trigger a process known as bleaching that weakens coral health. Consequently, scientists have identified reef conservation as a critical priority for maintaining marine biodiversity."

KEY FEATURES TO COPY:
- Sentence 1 uses passive: "are recognized", "are found"
- Sentence 2 has relative clause: "which are built by..."
- Sentence 3 starts with "However" and has hedge "may"
- Sentence 4 starts with "Consequently"
- Total: 4 sentences, ~65 words

3. **EVERY passage MUST include**:
   ✓ "is/are [past participle]" or "has/have been [past participle]" (passive voice) — put it in sentence 1
   ✓ One of: may, might, often, generally, tend, suggest, appear (hedging) — put it in sentence 3
   ✓ One of: However, Although, While, Yet (contrast) — start sentence 3 with it
   ✓ NO "I", "we", "our", NO questions
4. **Vocabulary**:
   - ${difficultyGuide[difficulty] || difficultyGuide.medium}
   - Include 2-3 words from the Academic Word List (e.g., significant, structure, environment, process, research, identify, complex, fundamental)
   - Average word length should be 5-6 characters
5. **Content**: Must be factually accurate. Do not invent fake studies or statistics.

## CRITICAL C-TEST CONSTRAINT

The passage will be used for a C-test (word completion task). Starting from the 2nd word of the 2nd sentence, EVERY OTHER WORD will have its second half removed. This means:
- The 2nd sentence must NOT start with a 1-letter word (a/I) as its 2nd word
- Words at even positions (2nd, 4th, 6th...) in sentences 2-3 will be blanked
- These blanked words should include a MIX of function words (that, from, with) and content words (research, process, environment)
- Avoid sequences of very short words (is, a, it) at blank positions — they are too easy
- Avoid sequences of very long/rare words at blank positions — they are too hard
- Aim for blanked words averaging 5-6 characters in length

## TOPICS TO WRITE ABOUT

${topicList}

## OUTPUT FORMAT

Return a JSON array. Each element:
\`\`\`json
{
  "topic": "biology",
  "subtopic": "marine biology",
  "passage": "The complete passage text with all four sentences.",
  "difficulty": "${difficulty}"
}
\`\`\`

${excludeSubjects.length > 0 ? `\n## DO NOT WRITE ABOUT THESE SUBJECTS (already generated):\n${excludeSubjects.map(s => `- ${s}`).join("\n")}\nChoose COMPLETELY DIFFERENT subjects for each passage.\n` : ""}
## DIVERSITY RULE
Each passage MUST be about a DIFFERENT specific subject. Do NOT write two passages about the same thing (e.g., two about coral reefs, or two about the printing press). Vary the sentence 1 opening — do not always start with the same pattern.

Return ONLY the JSON array, no markdown fencing, no explanation.${feedback}`;
}

module.exports = { buildCTWPrompt, TOPIC_POOL };
