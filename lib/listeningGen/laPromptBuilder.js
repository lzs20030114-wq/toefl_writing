/**
 * Listen to an Announcement (LA) -- Prompt builder v2
 *
 * Rebuilt from scratch based on deep analysis of 14 ETS reference samples.
 * See: data/listening/profile/la-flavor-model.json
 *
 * Key design decisions driven by real ETS data:
 *  - Announcement: 80-120 words, 5-7 sentences, semi-formal register
 *  - Opening: 64% "Attention...", 21% "Good morning/afternoon..."
 *  - Must contain: date (93%), location (79%), time (57%), requirement (57%)
 *  - Exactly 2 questions per announcement
 *  - Q1: main_idea (50%) or detail (43%), Q2: detail (50%) or inference (43%)
 *  - 7 context types weighted by ETS distribution
 *  - Distractor engineering with 3 type-specific formulas
 *  - Answer position pre-assignment (prevents A-clustering bias)
 *  - Difficulty tiers: easy 30% / medium 45% / hard 25%
 */

// -- Context pool (weighted to match ETS distribution) --------------------

const CONTEXT_POOL = [
  {
    context: "facility_change",
    weight: 0.21,
    speaker_roles: ["campus_admin", "department_head", "recreation_staff"],
    situations: [
      "grand reopening of renovated gallery or performance hall",
      "student lounge or study area closing for pipe/ceiling repair",
      "recreation center extending hours during finals week",
      "campus dining hall switching to summer hours",
      "new fitness equipment installation at recreation center",
      "building wing closure for asbestos removal",
      "computer lab relocating to a different floor",
      "campus bookstore moving to a new building",
    ],
  },
  {
    context: "academic_event",
    weight: 0.21,
    speaker_roles: ["department_staff", "department_head", "society_president"],
    situations: [
      "undergraduate research symposium abstract submission deadline",
      "spring academic symposium with limited seats and prerequisites",
      "honors thesis oral defense schedule announcement",
      "annual essay competition with faculty judges",
      "interdisciplinary conference call for papers",
      "senior capstone presentation schedule",
      "student research poster session open to all majors",
      "end-of-semester academic showcase with awards",
    ],
  },
  {
    context: "campus_activity",
    weight: 0.14,
    speaker_roles: ["club_leader", "activity_coordinator", "program_coordinator"],
    situations: [
      "community garden spring cleanup volunteer event",
      "winter gear swap with voucher system",
      "campus sustainability cleanup day",
      "annual outdoor movie night with blanket seating",
      "student art market in the quad",
      "cultural food festival organized by international club",
    ],
  },
  {
    context: "logistics",
    weight: 0.07,
    speaker_roles: ["campus_admin"],
    situations: [
      "parking lot closure for alumni weekend with shuttle alternative",
      "campus shuttle route change due to construction",
      "temporary road closure and detour instructions",
      "new bike-share station locations",
    ],
  },
  {
    context: "career_services",
    weight: 0.07,
    speaker_roles: ["career_advisor", "program_coordinator"],
    situations: [
      "professional wardrobe pop-up and free headshot clinic",
      "career fair preparation workshop with resume review",
      "mock interview sessions with alumni volunteers",
      "LinkedIn profile photo day at career center",
    ],
  },
  {
    context: "guest_speaker",
    weight: 0.07,
    speaker_roles: ["professor", "department_head"],
    situations: [
      "renowned scientist giving a guest lecture on campus",
      "visiting author reading and book signing event",
      "industry professional speaking about career paths",
      "alumnus sharing research experience at public talk",
    ],
  },
  {
    context: "info_session",
    weight: 0.07,
    speaker_roles: ["advisor", "program_coordinator"],
    situations: [
      "study abroad information session with returned students",
      "new student orientation schedule and requirements",
      "health insurance enrollment information session",
      "financial aid office workshop on scholarship applications",
    ],
  },
];

// -- Opening patterns (from ETS: 64% Attention, 21% Good morning/afternoon) --

const OPENING_PATTERNS = [
  {
    type: "attention",
    rate: 64,
    templates: [
      "Attention students, faculty, and staff.",
      "Attention students.",
      "Attention all undergraduate students.",
      "Attention members of the {{audience}}.",
    ],
  },
  {
    type: "greeting",
    rate: 21,
    templates: [
      "Good morning, campus community.",
      "Good afternoon, everyone.",
      "Good morning.",
      "Good afternoon.",
    ],
  },
  {
    type: "reminder",
    rate: 8,
    templates: [
      "This is a reminder that...",
    ],
  },
  {
    type: "direct",
    rate: 7,
    templates: [
      "The {{facility}} will be {{action}}...",
    ],
  },
];

// -- Question type distribution (from ETS data) --------------------------

const Q_TYPE_RULES = {
  Q1: [
    { type: "main_idea", weight: 0.50 },
    { type: "detail", weight: 0.43 },
    { type: "inference", weight: 0.07 },
  ],
  Q2: [
    { type: "detail", weight: 0.50 },
    { type: "inference", weight: 0.43 },
    { type: "main_idea", weight: 0.07 },
  ],
};

// -- Distractor engineering (type-specific formulas from flavor model) ----

const DISTRACTOR_FORMULAS = {
  detail: [
    {
      type: "wrong_detail",
      description: "Uses real words/concepts from announcement but changes a key fact",
      example: "Given to first fifty people who apply (wrong: it's a lottery, not first-come)",
    },
    {
      type: "related_but_not_stated",
      description: "Plausible campus action but NOT mentioned in this announcement",
      example: "Register for university career fair (not mentioned)",
    },
    {
      type: "misattributed_detail",
      description: "Takes a detail from one part and applies it to the wrong context",
      example: "Closed for maintenance starting Friday (wrong entity/time)",
    },
  ],
  main_idea: [
    {
      type: "too_narrow",
      description: "Correct about one detail but misses the overall purpose",
      example: "Advertise new photography class (too specific)",
    },
    {
      type: "wrong_purpose",
      description: "Plausible announcement purpose but not THIS one",
      example: "Apologize for delayed renovation (not the purpose)",
    },
    {
      type: "reversed_intent",
      description: "Opposite of what's being announced",
      example: "Encourage students to use the lounge more (it's being CLOSED)",
    },
  ],
  inference: [
    {
      type: "over_inference",
      description: "Goes too far beyond what's stated",
      example: "Changes weekly for security (not inferable)",
    },
    {
      type: "literal_restatement",
      description: "Just repeats what's stated, not an inference",
      example: "Located adjacent to Lots C and D (this is directly stated, not inferred)",
    },
    {
      type: "unrelated_inference",
      description: "Valid inference but about wrong topic",
      example: "Funded by student ID card fee (no evidence for this)",
    },
  ],
};

// -- Difficulty tiers (30% easy / 45% medium / 25% hard) -----------------

const DIFFICULTY_TIERS = [
  {
    tier: "easy",
    target_pct: 30,
    announcement: "Short (40-70 words), single topic, clear structure",
    Q1: "main_idea -- purpose is obvious from first sentence",
    Q2: "detail -- answer is directly stated with keywords matching",
  },
  {
    tier: "medium",
    target_pct: 45,
    announcement: "Medium (80-120 words), 2-3 pieces of info, one rule/requirement",
    Q1: "main_idea or detail with slight paraphrase",
    Q2: "detail requiring attention to specific conditions/exceptions",
  },
  {
    tier: "hard",
    target_pct: 25,
    announcement: "Long (100-150 words), multiple details/rules/exceptions, embedded inference",
    Q1: "detail about an exception or condition (NOT the main info)",
    Q2: "inference -- 'What can be inferred' or 'Why does the speaker mention'",
  },
];

// -- Stem patterns (from ETS reference) ----------------------------------

const STEM_PATTERNS = {
  main_idea: [
    "What is the main purpose of this announcement?",
    "What is the primary purpose of this announcement?",
    "What is the announcement about?",
  ],
  detail: [
    "What must students do to...?",
    "What is required in order to...?",
    "What are students advised to...?",
    "How are [X] distributed?",
    "Which facilities will...?",
    "What is a specific requirement for...?",
    "What is true about...?",
    "Who will be...?",
    "How can students get...?",
  ],
  inference: [
    "What can be inferred about...?",
    "Why does the speaker mention...?",
    "Why does the speaker recommend...?",
    "What should students do during...?",
  ],
};

// -- Real ETS reference examples (curated from la-reference.json) --------

function buildReferenceExamples() {
  return `## REAL ETS REFERENCE EXAMPLES -- Study these carefully

EXAMPLE 1 (facility_change, campus_admin, MEDIUM):
Announcement: "Attention students, faculty, and staff. Due to the upcoming Spring Alumni Weekend, several parking areas on the east side of campus will be temporarily closed starting this Friday at 6:00 p.m. Specifically, Lots C and D will be reserved exclusively for alumni event parking. Any unauthorized vehicles remaining in these lots after 6:00 p.m. on Friday will be towed at the owner's expense. To help accommodate the displaced parking, the university will be offering expanded shuttle service from the overflow lot near the football stadium, with buses running every ten minutes. Additionally, the main campus loop road will operate as a one-way street on Saturday to help manage the increased traffic flow."
Q1 (detail): "What must students do to avoid having their vehicles towed?"
  A. Move vehicles from Lots C and D before Friday at 6:00 p.m. <- CORRECT
  B. Register vehicles on campus transportation website <- related_but_not_stated
  C. Park on main campus loop road <- misattributed_detail
  D. Pay special event parking fee <- related_but_not_stated
Q2 (inference): "What can be inferred about the overflow lot near the football stadium?"
  A. Reserved exclusively for visiting alumni <- wrong_detail
  B. Serves as alternative parking for displaced drivers <- CORRECT
  C. Closed for maintenance starting Friday <- wrong_detail
  D. Located adjacent to Lots C and D <- over_inference

EXAMPLE 2 (academic_event, department_staff, MEDIUM):
Announcement: "This is a reminder that the deadline to submit abstracts for the Annual Undergraduate Research Symposium is approaching this Friday at 5 p.m. We want to emphasize that this event is open to students from all disciplines, including the humanities and social sciences, not just the hard sciences. You do not need to have a completed manuscript to apply; a 250-word summary of your work-in-progress is sufficient. Participating in the poster session is a great way to gain public speaking experience and strengthen your resume for future academic pursuits. Submissions should be uploaded directly to the portal on the university research website."
Q1 (main_idea): "What is the main purpose of this announcement?"
  A. Explain judging criteria for competition <- wrong_purpose
  B. Remind of submission deadline and clarify eligibility <- CORRECT
  C. Announce symposium winners <- wrong_purpose
  D. Recruit faculty supervisors <- wrong_purpose
Q2 (detail): "What is true about submission requirements?"
  A. Students must submit completed research paper <- wrong_detail (opposite)
  B. Only hard science majors may participate <- wrong_detail (opposite)
  C. Summary of ongoing research acceptable <- CORRECT
  D. Abstracts submitted in person at office <- wrong_detail

EXAMPLE 3 (campus_activity, club_leader, EASY):
Announcement: "Attention students. The Campus Sustainability Club is looking for volunteers to assist with our annual spring cleanup of the community garden this Saturday. We will be clearing winter debris and planting new vegetable beds starting at 9 a.m. behind the Science Center. While we provide all necessary tools and gloves, we ask that you wear sturdy shoes and clothes that can get dirty. No prior gardening experience is required to participate. If you are interested, please sign up on the club's website by Thursday so we can order enough pizza for lunch."
Q1 (main_idea): "What is the main purpose of this announcement?"
  A. Announce change in Science Center hours <- too_narrow
  B. Recruit volunteers for gardening event <- CORRECT
  C. Advertise new sustainability course <- wrong_purpose
  D. Remind students to register for club membership <- wrong_purpose
Q2 (detail): "What are participants asked to wear?"
  A. Protective gloves <- wrong_detail (gloves are provided, not worn from home)
  B. Club t-shirt <- related_but_not_stated
  C. Formal attire <- reversed_intent
  D. Sturdy shoes <- CORRECT`;
}

// -- Anti-patterns section -----------------------------------------------

function buildAntiPatterns() {
  return `## ANTI-PATTERNS -- Items with these flaws will be REJECTED

1. Announcement is too short (<40 words) -- not enough info for 2 meaningful questions
2. Announcement is just a single sentence -- real announcements have 5-7 sentence structure
3. No specific date/time/location -- feels generic, not like a real campus announcement
4. Both questions ask about the same piece of information
5. Correct answer for BOTH questions is the same letter
6. Distractor repeats a phrase from the announcement verbatim -- too easy to spot
7. Announcement uses casual conversational tone (Hey guys!, What's up) -- this is a FORMAL announcement
8. Questions can be answered without listening to the announcement (too obvious)
9. A distractor is also a valid/reasonable answer -- FATAL FLAW (will be caught by auditor)
10. Correct answer is always the longest option -- pattern exploitation

AMBIGUITY PREVENTION -- THE #1 QUALITY ISSUE:
Before finalizing each option, ask: "Could a well-prepared student reasonably select this distractor?" If a distractor states something that IS true or inferable from the announcement, it is NOT a valid distractor.

REAL FAILURE EXAMPLES:
- Announcement says "the library will close early this Friday"
  BAD distractor for main_idea: "To inform students about a library schedule" <- THIS IS PARTIALLY CORRECT
  WHY: The announcement IS about a schedule change -- too close to the truth.

- Announcement says "please sign up on the club's website by Thursday"
  BAD distractor: "Register online before the event" <- TOO CLOSE to the correct answer
  WHY: Signing up online IS registering online -- just paraphrased.

- Announcement mentions "expanded shuttle service from the overflow lot"
  BAD distractor for inference: "Additional transportation is available" <- THIS IS DIRECTLY STATED
  WHY: This is a restatement, not an inference question distractor.`;
}

/**
 * Build the LA generation prompt.
 *
 * @param {number} count -- items to generate (1-10)
 * @param {object} opts
 * @param {string[]} [opts.excludeAnnouncements] -- announcement snippets to avoid duplicating
 * @param {string} [opts.difficultyOverride] -- force all items to one difficulty
 * @returns {string} prompt
 */
function buildLAPrompt(count = 5, opts = {}) {
  const { excludeAnnouncements = [], difficultyOverride = null } = opts;

  // -- 1. Assign answer positions (strict rotation prevents A-clustering) --
  const positions = ["A", "B", "C", "D"];
  const q1Positions = [];
  const q2Positions = [];
  for (let i = 0; i < count; i++) {
    q1Positions.push(positions[i % 4]);
    q2Positions.push(positions[(i + 2) % 4]); // offset by 2 to ensure Q1 != Q2
  }

  // -- 2. Assign difficulty tiers --
  const difficulties = [];
  if (difficultyOverride) {
    for (let i = 0; i < count; i++) difficulties.push(difficultyOverride);
  } else {
    const easyCount = Math.round(count * 0.3);
    const hardCount = Math.round(count * 0.25);
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

  // -- 3. Assign Q1/Q2 types per difficulty --
  const qTypeAssignments = difficulties.map(diff => {
    let q1Type, q2Type;
    if (diff === "easy") {
      q1Type = "main_idea";
      q2Type = "detail";
    } else if (diff === "medium") {
      const r1 = Math.random();
      q1Type = r1 < 0.50 ? "main_idea" : "detail";
      const r2 = Math.random();
      q2Type = r2 < 0.50 ? "detail" : "inference";
      // Ensure diversity: Q1 and Q2 must test different skills
      if (q1Type === q2Type) {
        q2Type = q1Type === "detail" ? "inference" : "detail";
      }
    } else { // hard
      q1Type = Math.random() < 0.5 ? "detail" : "main_idea";
      q2Type = "inference";
      if (q1Type === q2Type) q1Type = "detail";
    }
    return { q1Type, q2Type };
  });

  // -- 4. Select contexts (weighted, diverse) --
  const allContextSituations = [];
  for (const pool of CONTEXT_POOL) {
    for (const sit of pool.situations) {
      allContextSituations.push({
        context: pool.context,
        situation: sit,
        speaker_roles: pool.speaker_roles,
      });
    }
  }
  const shuffled = allContextSituations.sort(() => Math.random() - 0.5);
  // Ensure context diversity: no more than 2 of same context
  const selected = [];
  const contextCount = {};
  for (const s of shuffled) {
    if (selected.length >= count) break;
    const c = contextCount[s.context] || 0;
    if (c < 2) {
      selected.push(s);
      contextCount[s.context] = c + 1;
    }
  }
  // Fill remaining if needed
  while (selected.length < count) {
    selected.push(shuffled[selected.length % shuffled.length]);
  }

  // -- 5. Build item specs --
  const itemSpecs = [];
  for (let i = 0; i < count; i++) {
    const sc = selected[i];
    const role = sc.speaker_roles[Math.floor(Math.random() * sc.speaker_roles.length)];
    const qt = qTypeAssignments[i];
    itemSpecs.push(
      `Item ${i + 1}:\n` +
      `  Context: ${sc.context}\n` +
      `  Situation: ${sc.situation}\n` +
      `  Speaker role: ${role}\n` +
      `  Difficulty: ${difficulties[i]}\n` +
      `  Q1 type: ${qt.q1Type} | Q1 correct answer: ${q1Positions[i]}\n` +
      `  Q2 type: ${qt.q2Type} | Q2 correct answer: ${q2Positions[i]}`
    );
  }

  // -- 6. Build reference examples section --
  const examplesSection = buildReferenceExamples();

  // -- 7. Build distractor engineering section --
  const distractorSection = `## DISTRACTOR ENGINEERING -- How to build wrong answers

Each question MUST have 3 distractors. Use the type-specific formulas below.

### For DETAIL questions:
1. **wrong_detail**: Uses real words/concepts from announcement but changes a key fact
   - "Given to first fifty people who apply" (wrong: it's a lottery, not first-come)
2. **related_but_not_stated**: Plausible campus action but NOT in this announcement
   - "Register for university career fair" (not mentioned anywhere)
3. **misattributed_detail**: Takes a detail from one part and applies to wrong context
   - "Closed for maintenance starting Friday" (wrong entity/time)

### For MAIN_IDEA questions:
1. **too_narrow**: Correct about one detail but misses the overall purpose
   - "Advertise new photography class" (too specific, announcement is about gallery reopening)
2. **wrong_purpose**: Plausible announcement purpose but not THIS one
   - "Apologize for delayed renovation" (not the purpose at all)
3. **reversed_intent**: Opposite of what's being announced
   - "Encourage students to use the lounge more" (it's being CLOSED)

### For INFERENCE questions:
1. **over_inference**: Goes too far beyond what's stated
   - "Changes weekly for security" (not inferable from the announcement)
2. **literal_restatement**: Just repeats what's stated -- not a valid inference option
   - "Located adjacent to Lots C and D" (this is directly stated)
3. **unrelated_inference**: Valid inference but about wrong topic
   - "Funded by student ID card fee" (no evidence whatsoever)

### CRITICAL RULES:
- Every distractor MUST be grammatically perfect, natural English
- Each distractor must be plausible for a campus announcement context
- Within one question, all 3 distractors should use DIFFERENT distractor types
- Option word count: 4-8 words each, similar length across all 4 options
- Correct answer must NOT consistently be the longest option (target: longest <= 30% of time)`;

  // -- 8. Build anti-patterns section --
  const antiPatternsSection = buildAntiPatterns();

  // -- 9. Assemble full prompt --
  return `You are an ETS-caliber TOEFL question writer for the 2026 "Listen to an Announcement" task.

## TASK FORMAT
The test-taker hears a campus ANNOUNCEMENT (80-120 words, 5-7 sentences), then answers exactly 2 multiple-choice questions. This tests COMPREHENSION of practical information delivered in semi-formal spoken English.

## ANNOUNCEMENT DESIGN RULES

### Structure (5-part pattern):
1. Greeting/attention-getter (e.g., "Attention students, faculty, and staff.")
2. Main news (WHAT is happening)
3. Details (WHEN, WHERE, HOW)
4. Requirements/rules (MUST do, PLEASE note, required to)
5. Call to action or deadline

### Opening pattern (CRITICAL -- match ETS distribution):
- 64% start with "Attention..." (e.g., "Attention students.", "Attention all undergraduate students.")
- 21% start with "Good morning/afternoon..." (e.g., "Good afternoon, everyone.")
- 8% start with "This is a reminder..."
- 7% direct statement (e.g., "The student lounge will be closed...")

### Must-contain information (from 14 ETS samples):
- Specific date or day: 93% of items (e.g., "this Friday", "next Monday", "by March 15th") -- REQUIRED
- Location: 79% of items (e.g., "behind the Science Center", "in Waldman Auditorium") -- REQUIRED
- Time: 57% (e.g., "at 2 PM", "from 10 a.m. to 2 p.m.") -- STRONGLY RECOMMENDED
- Requirement/rule: 57% (e.g., "you are required to complete", "please bring your student ID") -- STRONGLY RECOMMENDED
- Deadline: 43% (e.g., "must be submitted by March 15th")
- Action channel: 29% (e.g., "sign up on the club's website")

### Register:
Semi-formal. NOT casual conversation. Uses: "We are thrilled to announce", "Please note", "Please be aware", "We want to emphasize". But NOT stiff bureaucratic -- uses contractions occasionally (don't miss, we're offering).

### Word count: 80-120 words, 5-7 sentences. Not shorter, not longer.

## QUESTION DESIGN RULES

- Exactly 2 questions per announcement
- Q1 and Q2 must test DIFFERENT skills
- Q1 is typically about the BIG PICTURE (main_idea 50%, detail 43%)
- Q2 is typically about a SPECIFIC DETAIL or INFERENCE (detail 50%, inference 43%)

### Stem patterns (use these exact patterns from ETS):
Main idea: "What is the main purpose of this announcement?", "What is the primary purpose?", "What is the announcement about?"
Detail: "What must students do to...?", "What is required in order to...?", "What are students advised to...?", "How are [X] distributed?", "What is true about...?"
Inference: "What can be inferred about...?", "Why does the speaker mention...?", "Why does the speaker recommend...?"

${examplesSection}

${distractorSection}

${antiPatternsSection}

## ITEMS TO GENERATE

${itemSpecs.join("\n\n")}

${excludeAnnouncements.length > 0 ? `\n## DO NOT REUSE THESE ANNOUNCEMENT TOPICS (already in bank):\n${excludeAnnouncements.slice(0, 20).map(s => `- "${s}"`).join("\n")}\n` : ""}

## OUTPUT FORMAT

Return a JSON array. Each element:
{
  "context": "facility_change",
  "situation": "short description",
  "speaker_role": "campus_admin",
  "difficulty": "easy|medium|hard",
  "announcement": "Full announcement text, 80-120 words, 5-7 sentences.",
  "questions": [
    {
      "type": "main_idea|detail|inference",
      "stem": "The question text?",
      "options": {
        "A": "Option A",
        "B": "Option B",
        "C": "Option C",
        "D": "Option D"
      },
      "answer": "B",
      "explanation": "用中文解释为什么正确答案对，每个干扰项为什么错。",
      "distractor_types": {
        "A": "too_narrow",
        "C": "wrong_purpose",
        "D": "reversed_intent"
      }
    },
    {
      "type": "detail",
      "stem": "What must students do to...?",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "answer": "C",
      "explanation": "...",
      "distractor_types": { "A": "wrong_detail", "B": "related_but_not_stated", "D": "misattributed_detail" }
    }
  ]
}

IMPORTANT: The "explanation" field in each question MUST be written in Chinese (中文). Explain why the correct answer is right and why each distractor is wrong, all in Chinese.

Generate exactly ${count} items. Return ONLY the JSON array, no markdown fencing, no extra text.`;
}

module.exports = {
  buildLAPrompt,
  CONTEXT_POOL,
  DIFFICULTY_TIERS,
  DISTRACTOR_FORMULAS,
  Q_TYPE_RULES,
  STEM_PATTERNS,
};
