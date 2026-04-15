/**
 * Listen to a Conversation (LC) -- Prompt builder v2
 *
 * Rebuilt from scratch based on deep analysis of 11 reference samples.
 * See: data/listening/profile/lc-flavor-model.json
 *
 * Key design decisions driven by real sample data:
 *  - 2 speakers with names and defined roles
 *  - 8-12 turns, 100-180 words
 *  - Natural spoken register (contractions, fillers, discourse markers)
 *  - Structure: problem/question -> discussion -> resolution
 *  - Q1: detail or main_idea, Q2: inference or detail
 *  - 4 distractor types per question type
 *  - Answer position pre-assignment (prevents B-clustering)
 *  - Difficulty tiers: easy 30% / medium 45% / hard 25%
 */

// -- Scenario pool (campus-heavy, matching reference distribution) ----------

const SCENARIO_POOL = [
  {
    context: "library",
    weight: 0.25,
    situations: [
      { desc: "student asking about study room booking", relationship: "student_staff", roles: ["student", "library_staff"] },
      { desc: "student inquiring about new quiet study pods", relationship: "student_staff", roles: ["student", "library_staff"] },
      { desc: "student reporting an issue with self-checkout machine", relationship: "student_staff", roles: ["student", "library_staff"] },
      { desc: "two students discussing a problem with library printers", relationship: "student_student", roles: ["student", "student"] },
      { desc: "student asking about interlibrary loan process", relationship: "student_staff", roles: ["student", "library_staff"] },
      { desc: "two students figuring out how to use the reserve desk", relationship: "student_student", roles: ["student", "student"] },
    ],
  },
  {
    context: "campus_services",
    weight: 0.25,
    situations: [
      { desc: "student visiting transportation office about parking permit", relationship: "student_staff", roles: ["student", "transportation_staff"] },
      { desc: "student asking IT help desk about WiFi connection issue", relationship: "student_staff", roles: ["student", "IT_staff"] },
      { desc: "student inquiring about bicycle registration at campus security", relationship: "student_staff", roles: ["student", "campus_security"] },
      { desc: "student asking dining hall staff about meal plan options", relationship: "student_staff", roles: ["student", "dining_staff"] },
      { desc: "student checking with mail room about a missing package", relationship: "student_staff", roles: ["student", "mail_staff"] },
      { desc: "student asking recreation center staff about gym hours", relationship: "student_staff", roles: ["student", "rec_staff"] },
    ],
  },
  {
    context: "campus_life",
    weight: 0.30,
    situations: [
      { desc: "two students discussing a new campus bike-share program", relationship: "student_student", roles: ["student", "student"] },
      { desc: "two students talking about a problematic study room assignment", relationship: "student_student", roles: ["student", "student"] },
      { desc: "two students discussing an issue with a campus sustainability program", relationship: "student_student", roles: ["student", "student"] },
      { desc: "friends figuring out where to meet for a group project", relationship: "student_student", roles: ["student", "student"] },
      { desc: "two students talking about a new vending machine or campus facility", relationship: "student_student", roles: ["student", "student"] },
      { desc: "roommates discussing a dorm maintenance request", relationship: "student_student", roles: ["student", "student"] },
      { desc: "two students debating whether to use a new campus app feature", relationship: "student_student", roles: ["student", "student"] },
      { desc: "friends discussing an unexpected campus policy change", relationship: "student_student", roles: ["student", "student"] },
    ],
  },
  {
    context: "daily_errands",
    weight: 0.20,
    situations: [
      { desc: "student dealing with a device repair at a shop", relationship: "student_student", roles: ["student", "student"] },
      { desc: "friends coordinating dinner plans after a scheduling mix-up", relationship: "student_student", roles: ["student", "student"] },
      { desc: "student asking a lab assistant about a broken piece of equipment", relationship: "student_staff", roles: ["student", "lab_assistant"] },
      { desc: "student checking with a receptionist about an appointment", relationship: "student_staff", roles: ["student", "receptionist"] },
      { desc: "two students discussing a problem with the campus shuttle", relationship: "student_student", roles: ["student", "student"] },
      { desc: "student returning a defective item at the campus store", relationship: "student_staff", roles: ["student", "store_clerk"] },
    ],
  },
];

// -- Speaker name pools (gender-specific for TTS voice assignment) ---------

const FEMALE_NAMES = [
  "Sarah", "Emily", "Lisa", "Maria", "Rachel", "Jessica", "Amy",
  "Nicole", "Anna", "Katie", "Laura", "Megan", "Ashley", "Karen",
];

const MALE_NAMES = [
  "David", "Michael", "James", "Kevin", "Brian", "Mark", "Alex",
  "Tom", "Ryan", "Chris", "Daniel", "Jason", "Eric", "Nathan",
];

// -- Question type distribution (from reference: Q1=detail/main_idea, Q2=inference/detail) --

const Q_TYPE_RULES = {
  Q1: [
    { type: "main_idea", weight: 0.55 },
    { type: "detail", weight: 0.45 },
  ],
  Q2: [
    { type: "inference", weight: 0.73 },
    { type: "detail", weight: 0.27 },
  ],
};

// -- Distractor engineering (conversation-specific) -------------------------

const DISTRACTOR_FORMULAS = {
  detail: [
    {
      type: "wrong_detail",
      description: "Uses words/concepts from conversation but changes a key fact",
      example: "They'll send her an email (wrong: they said they'd text)",
    },
    {
      type: "related_but_not_stated",
      description: "Plausible campus action but NOT mentioned in conversation",
      example: "Print it at the campus copy center (never discussed)",
    },
    {
      type: "misattributed",
      description: "Takes info from one speaker and attributes to wrong context",
      example: "The woman will fix the printer (wrong: she warned against it)",
    },
  ],
  main_idea: [
    {
      type: "wrong_topic",
      description: "Plausible campus topic but not THIS conversation",
      example: "To report a stolen bicycle (he came about a warning sticker)",
    },
    {
      type: "too_narrow",
      description: "Addresses one detail but misses the overall purpose",
      example: "To ask about campus shuttle routes (too specific, not the main point)",
    },
    {
      type: "reversed_situation",
      description: "Opposite or misread of the actual situation",
      example: "To extend her reservation (she's resolving a booking conflict)",
    },
  ],
  inference: [
    {
      type: "over_inference",
      description: "Goes too far beyond what's stated",
      example: "File a formal complaint with the dean (too extreme for the situation)",
    },
    {
      type: "rejected_option",
      description: "Something speaker considered but decided against",
      example: "Go to the student union building (he explicitly chose NOT to)",
    },
    {
      type: "unrelated_next_step",
      description: "Plausible action but not connected to conversation",
      example: "Call a friend for help (not mentioned or relevant)",
    },
  ],
};

// -- Difficulty tiers (30% easy / 45% medium / 25% hard) --------------------

const DIFFICULTY_TIERS = [
  {
    tier: "easy",
    target_pct: 30,
    conversation: "Short (80-120 words), 6-8 turns, clear single problem and resolution",
    Q1: "detail -- answer directly stated in conversation",
    Q2: "detail -- another directly stated fact",
  },
  {
    tier: "medium",
    target_pct: 45,
    conversation: "Medium (120-160 words), 8-10 turns, information exchange with suggestions",
    Q1: "main_idea or detail -- requires understanding overall situation",
    Q2: "inference -- what happens next based on discussion",
  },
  {
    tier: "hard",
    target_pct: 25,
    conversation: "Long (150-200 words), 10-14 turns, multiple topics or complications",
    Q1: "main_idea -- purpose not obvious from first turn alone",
    Q2: "inference -- requires connecting multiple conversation pieces",
  },
];

// -- Stem patterns (from reference samples) ---------------------------------

const STEM_PATTERNS = {
  main_idea: [
    "What is the conversation mainly about?",
    "Why does the {speaker} approach the {other}?",
    "Why does the {speaker} visit the {location}?",
    "What is the {speaker}'s main problem?",
  ],
  detail: [
    "What will the {speaker} use/need to {action}?",
    "What is the {speaker}'s problem?",
    "How will the {speaker} know when {event}?",
    "What does the {speaker} think should change?",
    "Why is the {thing} problematic?",
    "What was the {speaker}'s problem with {thing}?",
  ],
  inference: [
    "What will the {speaker} most likely do next?",
    "What will the {speaker} likely do differently next time?",
    "What is an advantage of the {thing}?",
    "Why does the {speaker} mention {detail}?",
    "What can be inferred about {topic}?",
  ],
};

// -- Reference examples section ---------------------------------------------

function buildReferenceExamples() {
  return `## REAL REFERENCE EXAMPLES -- Study these carefully

EXAMPLE 1 (student_staff, library, MEDIUM):
Speakers: Woman (student), Man (library_staff)
Conversation:
Woman: "Hi, I was hoping to reserve one of the small study rooms on the second floor for tomorrow afternoon. I have a virtual interview for my linguistics thesis, and I need a quiet place."
Man: "Well, the standard study rooms on the second floor aren't actually soundproof. If you're doing an interview, you'll probably want to use one of the new acoustic pods on the ground floor instead."
Woman: "Acoustic pods? I didn't even know we had those."
Man: "We just installed them over the weekend. They're entirely enclosed and specifically designed to block out background noise for video calls and language testing."
Woman: "That sounds perfect! How do I book one? Do I just write my name on the clipboard outside the door like with the regular rooms?"
Man: "Not for the pods. They're managed through the university's main facility app. You just log in with your student credentials, select 'Ground Floor Pods', and pick an available time slot."
Woman: "Okay, I'll download the app right now. Is there a time limit? My interview will probably run for about an hour and a half."
Man: "The maximum booking is two hours per day, so you'll be completely fine. Just be sure to bring your phone with you; the app generates a digital key to unlock the pod door."

Q1 (main_idea): Why does the woman approach the man?
  A. To complain about noise in the library <- wrong_topic
  B. To ask for help finding a quiet space <- CORRECT
  C. To report a broken study room door <- wrong_topic
  D. To return an overdue library book <- wrong_topic
Q2 (detail): What will the woman need to enter the pod?
  A. A physical key from the front desk <- wrong_detail
  B. Her student ID card <- related_but_not_stated
  C. A digital key from a mobile application <- CORRECT
  D. A reservation confirmation email <- related_but_not_stated

EXAMPLE 2 (student_student, campus, MEDIUM):
Speakers: Woman (student), Man (student)
Conversation:
Woman: "Hey Mark, you look out of breath. Did you run all the way to the science building?"
Man: "Almost! I actually took one of those new green e-bikes from the dorms. The ride itself was fantastic, really fast. But returning it was a nightmare."
Woman: "Really? I thought the whole point of the bike-share program was convenience."
Man: "It is, until you get to your destination and the docking station is completely full. I couldn't lock the bike anywhere near the science building."
Woman: "Oh, right. Everyone heads to the science quad at this time of day. What did you do?"
Man: "I had to pedal all the way to the library to find an empty dock, and then sprint back here. I barely made it to my lab on time."
Woman: "You know the campus mobility app has a live map, right? It shows exactly how many bikes and empty docks are at each station in real time."
Man: "Wait, seriously? I only used the app to unlock the bike. I didn't even look at the other features."
Woman: "Yeah! Next time, check the map before you leave. It'll save you a lot of running around."

Q1 (detail): What was the man's problem with the bike-share program?
  A. The e-bike ran out of battery <- wrong_detail
  B. He could not unlock the bike <- wrong_detail
  C. There were no available spots to return the bike <- CORRECT
  D. The docking station was too far from the dorms <- related_but_not_stated
Q2 (inference): What will the man likely do differently next time?
  A. Walk to the science building instead <- over_inference
  B. Check the app for dock availability before departing <- CORRECT
  C. Ask a friend for a ride <- unrelated_next_step
  D. Leave earlier to find parking <- related_but_not_stated

EXAMPLE 3 (student_student, computer_lab, EASY):
Speakers: Man (student), Woman (student)
Conversation:
Man: "Excuse me, do you know if this printer is working? I hit print on my sociology paper a few minutes ago, but nothing has happened yet."
Woman: "Oh, that one is really temperamental. Is there an error message on the small screen?"
Man: "It says 'Tray 2 Empty,' but I opened the drawer and there is plenty of paper inside."
Woman: "That usually means the sensor is jammed or broken. I wouldn't try to fix it yourself."
Man: "Yikes, I definitely don't want that. I have class in twenty minutes."
Woman: "You could try the printer in the student union building next door, or just ask the lab assistant at the front desk to take a look."
Man: "I think I'll just ask the assistant. I don't want to run all the way to the student union and find out that printer is busy too. Thanks for the warning!"

Q1 (detail): What is the man's problem?
  A. He cannot find the computer lab <- wrong_topic
  B. He is unable to print his paper <- CORRECT
  C. He lost his sociology assignment <- wrong_topic
  D. He does not have enough paper <- wrong_detail (tray has paper)
Q2 (inference): What will the man most likely do next?
  A. Try to fix the printer himself <- rejected_option (warned against it)
  B. Go to the student union building <- rejected_option (decided against it)
  C. Ask the lab assistant for help <- CORRECT
  D. Print the paper at home instead <- unrelated_next_step`;
}

// -- Anti-patterns section --------------------------------------------------

function buildAntiPatterns() {
  return `## ANTI-PATTERNS -- Items with these flaws will be REJECTED

1. Conversation is too short (<80 words) -- not enough material for 2 meaningful questions
2. Only ONE speaker talks significantly -- both must contribute (3+ turns each, not just "yeah" / "okay")
3. Conversation sounds SCRIPTED or FORMAL -- must sound like real spoken English
4. NO contractions used -- every conversation must have contractions (don't, I'm, it's, they'll)
5. Both questions test the exact same piece of information
6. Correct answer for BOTH questions is the same letter
7. A distractor repeats conversation text VERBATIM -- too easy to spot
8. Questions can be answered using common sense alone (no listening needed)
9. Speaker names are inconsistent between speakers array and conversation turns
10. Turns are all the same length -- real conversations have short reactions ("Really?", "Wow", "Oh no!") mixed with longer explanations

AMBIGUITY PREVENTION -- THE #1 QUALITY ISSUE:
Before finalizing each distractor, ask: "Could a careful student reasonably select this?" If the distractor states something that IS true or implied by the conversation, it is NOT a valid distractor.

REAL FAILURES FROM SIMILAR PIPELINES:
- Conversation says "I'll ask the lab assistant"
  BAD distractor for inference Q: "Ask someone for help" <- TOO CLOSE to correct answer
  WHY: "Ask the assistant" IS asking someone for help -- just paraphrased.

- Conversation mentions "the app shows a live map"
  BAD distractor: "Use a mobile app to check" <- ALSO TRUE from the conversation!
  WHY: The app IS mobile and it DOES allow checking.

- Speaker says "I lost my token twice last semester"
  BAD inference distractor: "He has had problems with the token system before" <- DIRECTLY STATED
  WHY: Losing tokens twice IS having problems -- this is restatement, not inference.

SAFE distractor patterns:
- For inference Qs: Use something the speaker CONSIDERED but REJECTED
- For detail Qs: Change ONE key fact (text vs email, library vs union, Friday vs Monday)
- For main_idea Qs: Pick a completely different campus topic`;
}

/**
 * Build the LC generation prompt.
 *
 * @param {number} count -- items to generate (1-5, conversations are token-heavy)
 * @param {object} opts
 * @param {string[]} [opts.excludeSituations] -- situation descriptions to avoid
 * @param {string} [opts.difficultyOverride] -- force all items to one difficulty
 * @returns {string} prompt
 */
function buildLCPrompt(count = 3, opts = {}) {
  const { excludeSituations = [], difficultyOverride = null } = opts;

  // -- 1. Assign answer positions (strict rotation, Q1 != Q2) --
  const positions = ["A", "B", "C", "D"];
  const q1Positions = [];
  const q2Positions = [];
  for (let i = 0; i < count; i++) {
    q1Positions.push(positions[i % 4]);
    q2Positions.push(positions[(i + 2) % 4]); // offset by 2
  }

  // -- 2. Assign difficulty tiers --
  const difficulties = [];
  if (difficultyOverride) {
    for (let i = 0; i < count; i++) difficulties.push(difficultyOverride);
  } else {
    const easyCount = Math.max(1, Math.round(count * 0.3));
    const hardCount = Math.max(1, Math.round(count * 0.25));
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
      q1Type = "detail";
      q2Type = Math.random() < 0.6 ? "detail" : "inference";
    } else if (diff === "medium") {
      q1Type = Math.random() < 0.55 ? "main_idea" : "detail";
      q2Type = "inference";
    } else { // hard
      q1Type = "main_idea";
      q2Type = "inference";
    }
    // Ensure Q1 != Q2 type
    if (q1Type === q2Type) {
      q2Type = q1Type === "inference" ? "detail" : "inference";
    }
    return { q1Type, q2Type };
  });

  // -- 4. Select scenarios (weighted, diverse) --
  const allSituations = [];
  for (const pool of SCENARIO_POOL) {
    for (const sit of pool.situations) {
      allSituations.push({ context: pool.context, ...sit });
    }
  }
  const shuffled = allSituations.sort(() => Math.random() - 0.5);
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
  while (selected.length < count) {
    selected.push(shuffled[selected.length % shuffled.length]);
  }

  // -- 5. Assign speaker names --
  const usedFemale = new Set();
  const usedMale = new Set();

  function pickName(pool, used) {
    const available = pool.filter(n => !used.has(n));
    const name = available[Math.floor(Math.random() * available.length)] || pool[0];
    used.add(name);
    return name;
  }

  // -- 6. Build item specs --
  const itemSpecs = [];
  for (let i = 0; i < count; i++) {
    const sc = selected[i];
    const qt = qTypeAssignments[i];

    // Assign names: first speaker female, second male (for TTS differentiation)
    const name1 = pickName(FEMALE_NAMES, usedFemale);
    const name2 = pickName(MALE_NAMES, usedMale);

    itemSpecs.push(
      `Item ${i + 1}:\n` +
      `  Context: ${sc.context}\n` +
      `  Situation: ${sc.desc}\n` +
      `  Relationship: ${sc.relationship}\n` +
      `  Speaker 1: ${name1} (${sc.roles[0]})\n` +
      `  Speaker 2: ${name2} (${sc.roles[1]})\n` +
      `  Difficulty: ${difficulties[i]}\n` +
      `  Q1 type: ${qt.q1Type} | Q1 correct answer: ${q1Positions[i]}\n` +
      `  Q2 type: ${qt.q2Type} | Q2 correct answer: ${q2Positions[i]}`
    );
  }

  // -- 7. Build reference examples --
  const examplesSection = buildReferenceExamples();

  // -- 8. Build distractor section --
  const distractorSection = `## DISTRACTOR ENGINEERING -- How to build wrong answers

Each question MUST have 3 distractors. Use the type-specific formulas below.

### For DETAIL questions:
1. **wrong_detail**: Uses words/concepts from conversation but changes a KEY fact
   - "They'll send an email" (wrong: they said text message)
   - "The sensor needs batteries" (wrong: it's jammed, not dead)
2. **related_but_not_stated**: Plausible action/thing but NOT mentioned in conversation
   - "Use the campus computer lab" (never discussed)
   - "Print it at the copy center" (not mentioned)
3. **misattributed**: Takes info from one part and misapplies it
   - "The woman will fix the printer" (wrong: she warned against it)
   - "The shop will call him" (wrong: they'll text HER)

### For MAIN_IDEA questions:
1. **wrong_topic**: Plausible campus topic but not THIS conversation
   - "To report a stolen bicycle" (he came about a warning sticker)
2. **too_narrow**: Addresses one detail but misses the big picture
   - "To ask about secure lockers" (that was a secondary topic)
3. **reversed_situation**: Opposite or misread of the actual situation
   - "To extend her study room time" (she's dealing with a booking error)

### For INFERENCE questions:
1. **over_inference**: Goes beyond what conversation supports
   - "File a complaint with the university president" (way too extreme)
2. **rejected_option**: Something explicitly NOT chosen by the speaker
   - "Go to the student union" (speaker said "I don't want to run all the way there")
3. **unrelated_next_step**: Plausible but not connected to conversation
   - "Call a friend for advice" (no basis in the conversation)

### CRITICAL DISTRACTOR RULES:
- Every distractor MUST be grammatically perfect
- NEVER make a distractor that is also a valid answer
- Within one question, use at least 2 different distractor types
- Option word count: 4-10 words each, similar length across all 4
- Correct answer must NOT consistently be the longest`;

  // -- 9. Build anti-patterns --
  const antiPatternsSection = buildAntiPatterns();

  // -- 10. Assemble full prompt --
  return `You are an ETS-caliber TOEFL question writer for the 2026 "Listen to a Conversation" task.

## TASK FORMAT
The test-taker hears a SHORT campus/everyday conversation between exactly 2 people, then answers 2 multiple-choice questions. This tests COMPREHENSION of spoken conversational English -- details, main ideas, and inferences.

## CONVERSATION DESIGN RULES

### Structure (problem -> discussion -> resolution):
1. Opening: One speaker presents a problem, question, or situation (1-2 turns)
2. Discussion: Speakers exchange information, ask clarifying questions, offer suggestions (4-8 turns)
3. Resolution: Conversation ends with a plan, decision, or next step (1-2 turns)

### Format:
- Exactly 2 speakers with first names and roles
- 8-12 turns total (each speaker gets 4-6 turns minimum)
- 100-180 words total across all turns
- Turns vary in length: short reactions (1-5 words: "Really?", "Oh no!", "That sounds great!")
  mixed with longer informational turns (15-40 words)

### Dialogue register (CRITICAL -- must sound like real speech):
- Use contractions FREELY: don't, I'm, it's, they'll, won't, I'd, I've, you're, we're, can't, didn't
- Include 1-2 discourse markers: Actually, Well, Oh, Hmm, Right, Okay, Exactly
- Include 1-2 fillers/reactions: Really?, Wow, Yikes, Oh no!, Huh?, Wait, seriously?
- Casual vocabulary: sounds great, good call, no worries, I'll definitely do that
- Short informal sentences mixed with longer ones
- Staff can be slightly more formal but still conversational (not scripted)

### Must-have elements:
- A CLEAR problem or question that drives the conversation
- Both speakers contribute MEANINGFULLY (no "Yeah" "Okay" "Right" fillers-only turns)
- Specific concrete details (room numbers, app names, times, locations)
- A resolution or plan at the end

${examplesSection}

${distractorSection}

${antiPatternsSection}

## ITEMS TO GENERATE

${itemSpecs.join("\n\n")}

${excludeSituations.length > 0 ? `\n## DO NOT REUSE THESE SITUATIONS (already in bank):\n${excludeSituations.slice(0, 15).map(s => `- "${s}"`).join("\n")}\n` : ""}

## OUTPUT FORMAT

Return a JSON array. Each element:
{
  "context": "library",
  "situation": "short description",
  "difficulty": "easy|medium|hard",
  "speakers": [
    { "name": "Sarah", "role": "student", "gender": "female" },
    { "name": "David", "role": "library_staff", "gender": "male" }
  ],
  "conversation": [
    { "speaker": "Sarah", "text": "Hi, I was hoping to..." },
    { "speaker": "David", "text": "Well, actually..." }
  ],
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
      "explanation": "Why B is correct and why each distractor is wrong.",
      "distractor_types": {
        "A": "wrong_topic",
        "C": "too_narrow",
        "D": "reversed_situation"
      }
    },
    {
      "type": "inference",
      "stem": "What will Sarah most likely do next?",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "answer": "D",
      "explanation": "...",
      "distractor_types": { "A": "over_inference", "B": "rejected_option", "C": "unrelated_next_step" }
    }
  ]
}

Generate exactly ${count} items. Return ONLY the JSON array, no markdown fencing, no extra text.`;
}

module.exports = {
  buildLCPrompt,
  SCENARIO_POOL,
  DIFFICULTY_TIERS,
  DISTRACTOR_FORMULAS,
  Q_TYPE_RULES,
  STEM_PATTERNS,
  FEMALE_NAMES,
  MALE_NAMES,
};
