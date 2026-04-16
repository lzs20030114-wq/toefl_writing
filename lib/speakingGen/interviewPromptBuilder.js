/**
 * Take an Interview — Prompt builder v2
 *
 * Rebuilt from scratch based on analysis of 5 ETS reference sets (20 questions).
 * See: data/speaking/profile/interview-flavor-model.json
 *      data/speaking/samples/interview-reference.json
 *
 * Key design decisions driven by real ETS data:
 *  - 4 questions per set, all on the same topic
 *  - Difficulty progression: Q1 personal → Q2 comparative → Q3 opinion → Q4 predictive
 *  - Scenario intro: "You have agreed to participate in a [study/survey] about [topic]."
 *  - Q1 always opens with "Thank you for participating"
 *  - Q3 presents a debatable claim ("Some people/experts argue that...")
 *  - Q4 asks about future trends or policy recommendations
 *  - 45 seconds response time, no prep time
 */

// ── Topic pool (20+ diverse topics) ──

const TOPIC_POOL = [
  // Technology
  { topic: "Digital Subscription Services", category: "technology" },
  { topic: "Social Media and Personal Relationships", category: "technology" },
  { topic: "Online Learning Platforms", category: "technology" },
  { topic: "Smartphone Usage Habits", category: "technology" },
  { topic: "Artificial Intelligence in Daily Life", category: "technology" },
  // Education
  { topic: "Adult Learning and Hobbies", category: "education" },
  { topic: "Public Speaking Experiences", category: "education" },
  { topic: "Study Habits and Productivity", category: "education" },
  { topic: "Student Assessment Methods", category: "education" },
  // Food & Health
  { topic: "Meal Planning and Grocery Shopping", category: "food_health" },
  { topic: "Exercise and Fitness Routines", category: "food_health" },
  { topic: "Sleep Habits and Quality", category: "food_health" },
  { topic: "Healthy Eating on a Budget", category: "food_health" },
  // Work & Career
  { topic: "Workplace Schedules and Flexibility", category: "work_career" },
  { topic: "Remote Work and Productivity", category: "work_career" },
  { topic: "Career Transitions and Job Changes", category: "work_career" },
  { topic: "Work-Life Balance Strategies", category: "work_career" },
  // Environment
  { topic: "Recycling and Waste Reduction", category: "environment" },
  { topic: "Public Transportation Usage", category: "environment" },
  { topic: "Energy Conservation at Home", category: "environment" },
  // Social Life
  { topic: "Community Volunteering", category: "social_life" },
  { topic: "Travel Planning and Budgeting", category: "social_life" },
  { topic: "Neighborhood Relationships", category: "social_life" },
  // Media & Entertainment
  { topic: "Reading Habits and Book Choices", category: "media" },
  { topic: "News Consumption and Media Literacy", category: "media" },
  { topic: "Podcast and Audio Content Habits", category: "media" },
  // Personal Growth
  { topic: "Time Management Strategies", category: "personal_growth" },
  { topic: "Financial Literacy and Budgeting", category: "personal_growth" },
  { topic: "Goal Setting and Self-Improvement", category: "personal_growth" },
  { topic: "Stress Management Techniques", category: "personal_growth" },
];

// ── Question progression rules ──

const PROGRESSION_RULES = {
  Q1: {
    type: "personal_factual",
    opener: "Thank you for participating",
    target_words: { min: 25, max: 40 },
    instruction: "Ask about the respondent's PERSONAL experience or current habits related to the topic. Start with 'Thank you for participating in our [study/survey/research].' then ask about their direct experience.",
    question_forms: [
      "What types of X do you currently use/do, and how did you first start?",
      "Can you describe your typical X routine or habits?",
      "Have you recently [done X]? Please describe your experience.",
      "How do you usually [approach X]? Do you [method A] or [method B]?",
    ],
    anti_patterns: ["Do not ask yes/no questions", "Do not ask about opinions or predictions yet"],
  },
  Q2: {
    type: "descriptive_comparative",
    target_words: { min: 25, max: 45 },
    instruction: "Ask the respondent to COMPARE approaches, describe CHALLENGES, or analyze DIFFERENCES related to the topic. Ask for examples where possible.",
    question_forms: [
      "How does X compare to Y in terms of [aspect]? What are the trade-offs?",
      "What are some advantages and disadvantages of [approach]?",
      "What challenges do people typically face when [doing X]?",
      "How do you decide between [option A] and [option B]? What factors matter most?",
    ],
    anti_patterns: ["Do not ask for personal experience alone", "Do not introduce a debatable claim yet"],
  },
  Q3: {
    type: "analytical_opinion",
    target_words: { min: 25, max: 45 },
    instruction: "Present a DEBATABLE CLAIM using 'Some [people/experts/educators] [argue/believe/claim] that [assertion].' Then ask the respondent whether they agree or disagree and why.",
    question_forms: [
      "Some people argue that X. What is your perspective on this?",
      "Some experts believe that X leads to Y. Do you agree or disagree?",
      "Some educators claim that X should be [mandatory/changed]. What is your opinion?",
      "Some companies have adopted [policy X]. Do you think this approach is effective? Why or why not?",
    ],
    anti_patterns: ["The claim must be genuinely debatable, not a settled fact", "Do not embed the expected answer", "Do not use leading language"],
  },
  Q4: {
    type: "evaluative_predictive",
    target_words: { min: 30, max: 50 },
    instruction: "Ask about FUTURE TRENDS or POLICY RECOMMENDATIONS related to the topic. This should be the most complex question, requiring forward thinking.",
    question_forms: [
      "Looking ahead, how do you think X will change in the next [5-10] years?",
      "If a [government/company/university] wanted to [goal], what programs would you suggest?",
      "How do you think [trend X] will impact [aspect] in the future?",
      "As [trend X] becomes more common, what impact will this have on [group]?",
    ],
    anti_patterns: ["Must reference a future time horizon", "Do not ask about personal plans only", "Must invite policy-level or societal-level thinking"],
  },
};

// ── Intro templates ──

const INTRO_TEMPLATES = [
  "You have agreed to participate in a survey about {topic}.",
  "You have agreed to participate in a research project about {topic}.",
  "You have agreed to participate in a study about {topic}.",
];

/**
 * Build a prompt to generate interview question sets.
 *
 * @param {number} count — number of sets (default 1)
 * @param {object} opts
 * @param {string[]} [opts.excludeTopics] — topic names to avoid
 * @returns {{ prompt: string, topics: string[] }}
 */
function buildInterviewPrompt(count = 1, opts = {}) {
  const { excludeTopics = [] } = opts;

  // Pick topics (diverse categories, avoid excluded)
  const available = TOPIC_POOL.filter(
    t => !excludeTopics.includes(t.topic)
  );

  // Try to pick from different categories
  const byCategory = {};
  for (const t of available) {
    if (!byCategory[t.category]) byCategory[t.category] = [];
    byCategory[t.category].push(t);
  }
  const categories = Object.keys(byCategory).sort(() => Math.random() - 0.5);
  const selected = [];
  let catIdx = 0;
  while (selected.length < count && catIdx < categories.length * 3) {
    const cat = categories[catIdx % categories.length];
    const pool = byCategory[cat];
    if (pool && pool.length > 0) {
      const pick = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      selected.push(pick);
    }
    catIdx++;
  }

  // Build per-set specs
  const setSpecs = selected.map((t, i) => {
    const intro = INTRO_TEMPLATES[i % INTRO_TEMPLATES.length].replace("{topic}", t.topic.toLowerCase());
    return `Set ${i + 1}:
  Topic: ${t.topic}
  Category: ${t.category}
  Intro: "${intro}"`;
  });

  // Build progression section
  const progressionSection = Object.entries(PROGRESSION_RULES).map(([pos, rule]) => {
    return `### ${pos} — ${rule.type} (${rule.target_words.min}-${rule.target_words.max} words)
${rule.instruction}
Question forms:
${rule.question_forms.map(f => `  - "${f}"`).join("\n")}
Anti-patterns:
${rule.anti_patterns.map(a => `  - ${a}`).join("\n")}`;
  }).join("\n\n");

  const prompt = `You are an ETS-caliber TOEFL content writer for the 2026 "Take an Interview" speaking task.

## TASK FORMAT
The test-taker participates in a simulated interview. They hear 4 questions on the same topic, each requiring a 45-second spoken response. No preparation time. This tests fluency, coherence, and the ability to develop ideas on the spot.

## REAL ETS REFERENCE EXAMPLES — Study these carefully

EXAMPLE SET 1 — Digital Subscription Services:
Intro: "You have agreed to participate in a survey about digital subscription services."

Q1 (personal): "Thank you for participating in our survey. What types of digital subscription services do you currently use, and how did you first start using them?"
  → Asks about personal experience. Easy entry point.

Q2 (comparative): "How do you decide whether to continue paying for a subscription service or cancel it? What factors matter most to you?"
  → Asks for comparison of factors. Requires structured thinking.

Q3 (opinion): "Some people argue that subscription services save money in the long run, while others feel they lead to overspending. What is your perspective on this?"
  → Presents debatable claim. Requires position + reasoning.

Q4 (predictive): "Looking ahead, how do you think the growth of digital subscriptions will change the way people consume entertainment and information in the next decade?"
  → Future-oriented. Requires prediction + societal analysis.

EXAMPLE SET 2 — Public Speaking Experiences:
Intro: "You have agreed to participate in a survey about public speaking experiences."

Q1 (personal): "Thank you for participating in our survey. Can you describe a recent situation where you had to speak in front of a group? How did it go?"
Q2 (comparative): "What do you think are the biggest differences between people who feel comfortable speaking publicly and those who find it very stressful?"
Q3 (opinion): "Some educators argue that public speaking skills should be a required part of every student's education. What is your opinion on this proposal?"
Q4 (predictive): "With the increasing use of virtual meetings and online presentations, how do you think public speaking skills and expectations will change in the future?"

## QUESTION PROGRESSION RULES

${progressionSection}

## CRITICAL REQUIREMENTS

1. All 4 questions in a set MUST be about the SAME topic. No topic drift.
2. Q1 MUST start with "Thank you for participating in our [study/survey/research]."
3. Q3 MUST use the "Some [people/experts] [argue/believe] that..." pattern.
4. Q4 MUST reference a future time horizon or ask for policy recommendations.
5. EVERY question must be open-ended. NEVER answerable with just "yes" or "no."
6. Questions should be answerable by anyone regardless of background — no specialized knowledge required.
7. Avoid culturally biased topics (specific holidays, religions, regional customs).
8. Do NOT start Q2, Q3, and Q4 with the same word.
9. Each question should be a single flowing question (or at most two closely related parts).
10. Questions must feel conversational and direct, not academic or stiff.

## SETS TO GENERATE

${setSpecs.join("\n\n")}

## OUTPUT FORMAT

Return a JSON array of ${count} set(s):

[
  {
    "id": "intv_<timestamp>_001",
    "topic": "${selected[0]?.topic || "Topic Name"}",
    "category": "${selected[0]?.category || "category"}",
    "intro": "${INTRO_TEMPLATES[0].replace("{topic}", (selected[0]?.topic || "topic").toLowerCase())}",
    "questions": [
      {
        "id": "intv_<timestamp>_001_q1",
        "position": "Q1",
        "question": "Thank you for participating in our survey. What types of...",
        "difficulty": "personal",
        "word_count": 28,
        "expected_response_topics": ["personal experience", "current habits"]
      },
      ...4 questions total (Q1 personal, Q2 comparative, Q3 opinion, Q4 predictive)
    ]
  }
]

Return ONLY valid JSON, no markdown fencing, no explanation.`;

  return {
    prompt,
    topics: selected.map(s => s.topic),
  };
}

module.exports = { buildInterviewPrompt, TOPIC_POOL, PROGRESSION_RULES, INTRO_TEMPLATES };
