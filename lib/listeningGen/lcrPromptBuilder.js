/**
 * Listen and Choose a Response (LCR) — Prompt builder v2
 *
 * Rebuilt from scratch based on deep analysis of 16 ETS reference samples.
 * See: data/listening/profile/lcr-flavor-model.json
 *
 * Key design decisions driven by real ETS data:
 *  - 5 correct-answer paradigms (context_shift/idiomatic/counter_question/marker_led/direct)
 *  - 4 distractor types with manufacturing formulas
 *  - Answer position pre-assignment (prevents B/C clustering)
 *  - Difficulty tier assignment per item (30% easy / 45% medium / 25% hard)
 *  - Speaker sentence type mixing (statements 30%, questions 70%)
 */

// ── Scenario pool (campus-heavy, matching ETS 69% campus rate) ──────

const SCENARIO_POOL = [
  {
    context: "campus_academic",
    weight: 0.375,
    situations: [
      "student asking a librarian about a book or resource",
      "student asking a professor about office hours or assignment",
      "two classmates discussing a group project deadline",
      "student checking with TA about lab report requirements",
      "student asking about course enrollment or prerequisites",
      "classmate asking to borrow lecture notes",
      "student asking about exam format or study materials",
      "student seeking help at the writing center",
      "student discussing a presentation topic with partner",
      "student asking about a reading list for a course",
    ],
  },
  {
    context: "campus_daily",
    weight: 0.3125,
    situations: [
      "student asking about printing or scanning at computer lab",
      "two friends deciding where to get lunch",
      "student asking about a campus event or concert",
      "student checking bus or shuttle schedule",
      "roommate discussing weekend plans",
      "student asking about gym or sports facility hours",
      "student checking lost-and-found at front desk",
      "student asking about dorm maintenance issue",
      "friend inviting another to a study group or social event",
      "student asking about campus shuttle or parking",
    ],
  },
  {
    context: "general_daily",
    weight: 0.1875,
    situations: [
      "asking for directions to a nearby location",
      "calling to check business hours",
      "arranging a ride or carpool with a friend",
      "asking a store clerk about a return or exchange",
      "checking if a service (post office, bank) is open",
      "making or rescheduling an appointment",
      "asking a neighbor about noise or shared space",
      "coordinating airport pickup with a friend",
    ],
  },
  {
    context: "social",
    weight: 0.125,
    situations: [
      "friend sharing news or personal update",
      "acknowledging someone's unavailability or schedule conflict",
      "responding to an invitation or suggestion",
      "expressing concern about a friend's situation",
      "offering help to someone who seems stressed",
    ],
  },
];

// ── Answer paradigms (from flavor model: 5 paradigms with target distribution) ──

const ANSWER_PARADIGMS = [
  {
    name: "context_shift",
    target_pct: 30,
    difficulty: "hard",
    instruction: "The correct answer does NOT answer the literal question. Instead it addresses the UNDERLYING need or solves the real problem behind the words.",
    example: {
      speaker: "What time do I need to pick up Michael from the airport?",
      answer: "Don't worry about it. I'll get him.",
      why: "Instead of giving a time, offers to handle the whole situation.",
    },
  },
  {
    name: "idiomatic",
    target_pct: 25,
    difficulty: "medium-hard",
    instruction: "The correct answer uses a natural English idiom, discourse formula, or conversational shorthand that a native speaker would use.",
    example: {
      speaker: "I have to tell you something.",
      answer: "I'm all ears.",
      why: "Idiom meaning 'I'm ready to listen'. Non-native speakers may not recognize it.",
    },
  },
  {
    name: "counter_question",
    target_pct: 20,
    difficulty: "medium",
    instruction: "The correct answer is itself a QUESTION that advances the conversation forward — proposing an alternative, seeking clarification, or offering advice in question form.",
    example: {
      speaker: "I'm afraid I'm not available this evening.",
      answer: "How about tomorrow night then?",
      why: "Instead of just accepting, proposes an alternative to keep the interaction going.",
    },
  },
  {
    name: "marker_led_indirect",
    target_pct: 20,
    difficulty: "medium",
    instruction: "The correct answer opens with a discourse marker (Actually, Well, Just, Maybe) and then gives an indirect but relevant response.",
    example: {
      speaker: "Are you done with the printer? I need to scan something urgent.",
      answer: "Just one more minute, I'm printing the last page.",
      why: "'Just' signals brief delay, then explains the situation.",
    },
  },
  {
    name: "direct_topical",
    target_pct: 5,
    difficulty: "easy",
    instruction: "The correct answer directly and factually answers the question. Use VERY sparingly — this is the least ETS-like paradigm.",
    example: {
      speaker: "Excuse me, do you know if the library is open on Saturdays?",
      answer: "Yes, it opens at 10 AM on weekends.",
      why: "Straightforward factual response.",
    },
  },
];

// ── Distractor engineering (from flavor model: 4 types with formulas) ──

const DISTRACTOR_TYPES = [
  {
    type: "semantic_association_trap",
    target_pct: 35,
    formula: "Take a CONTENT WORD from the speaker sentence → find an ASSOCIATED concept → build a plausible sentence about that concept.",
    examples: [
      { speaker_word: "library", trap: "The book is on the third floor." },
      { speaker_word: "airport", trap: "The airport has a new snack shop." },
      { speaker_word: "printer", trap: "The printer is new and very fast." },
      { speaker_word: "bus", trap: "I nearly missed the bus." },
      { speaker_word: "chemistry", trap: "Chemistry is a required subject for everyone." },
      { speaker_word: "tell", trap: "I can't tell the difference." },
    ],
  },
  {
    type: "off_topic_but_grammatical",
    target_pct: 35,
    formula: "Write a perfectly grammatical English sentence that a person might say in daily life, but that has ZERO relevance to this conversation.",
    examples: [
      { context: "schedule conflict", trap: "She arrived this afternoon." },
      { context: "presentation outcome", trap: "Despite the rain, I got a quick walk in after lunch." },
      { context: "post office hours", trap: "I think he's come home already." },
    ],
  },
  {
    type: "wrong_question_type",
    target_pct: 20,
    formula: "Answer a DIFFERENT type of question than what was asked. If speaker asks WHERE, answer WHEN. If speaker asks HOW, answer YES/NO.",
    examples: [
      { asked: "where (location)", answered: "when (frequency)", trap: "Every 30 minutes." },
      { asked: "how (method)", answered: "yes/no (permission)", trap: "Yes, you're allowed to do that." },
      { asked: "is it open (yes/no)", answered: "where (location)", trap: "It's just around the corner!" },
    ],
  },
  {
    type: "misinterpretation_or_polysemy",
    target_pct: 10,
    formula: "Misread the speaker's intent, or use a word from the speaker with a DIFFERENT meaning (polysemy).",
    examples: [
      { speaker: "get lunch", misread: "'get' = fetch for someone", trap: "I'll get you a sandwich." },
      { speaker: "tell you something", polysemy: "'tell' = distinguish", trap: "I can't tell the difference." },
    ],
  },
];

// ── Difficulty tiers (30/45/25 split from ETS data) ──

const DIFFICULTY_TIERS = [
  {
    tier: "easy",
    target_pct: 30,
    speaker: "Clear wh-question or polite inquiry with explicit topic",
    correct: "direct_topical or marker_led_indirect",
    traps: "Obvious word traps, clearly off-topic distractors",
  },
  {
    tier: "medium",
    target_pct: 45,
    speaker: "Yes/no question, negative question, or mild statement of feeling/intent",
    correct: "counter_question or marker_led_indirect or idiomatic (common phrases)",
    traps: "Plausible word traps, one wrong-question-type distractor",
  },
  {
    tier: "hard",
    target_pct: 25,
    speaker: "Declarative statement requiring intent inference, or emotional expression",
    correct: "context_shift or idiomatic (less common idioms)",
    traps: "Polysemy traps, very plausible distractors that almost work",
  },
];

// ── Speaker sentence type distribution (from ETS: 30% statements, 70% questions) ──

const SPEAKER_TYPES = [
  { type: "wh_question", pct: 25, pattern: "Where/How/What/When...?", example: "How do I contact customer service?" },
  { type: "yes_no_question", pct: 25, pattern: "Do you/Are you/Can you...?", example: "Do you want to get lunch?" },
  { type: "negative_question", pct: 20, pattern: "Didn't/Isn't/Aren't...?", example: "Didn't I just see you in the library?" },
  { type: "declarative_statement", pct: 30, pattern: "I'm.../I have to.../I'm thinking of...", example: "I'm not available this evening." },
];

// ── Discourse markers for correct answers (37.5% should have one) ──

const DISCOURSE_MARKERS = [
  "Actually", "Well", "As a matter of fact", "Just", "Maybe",
  "How about", "Don't worry", "Let's", "Oh", "Hmm",
];

/**
 * Build the LCR generation prompt.
 *
 * @param {number} count — items to generate (1-12)
 * @param {object} opts
 * @param {string[]} [opts.excludeSpeakers] — speaker sentences to avoid duplicating
 * @param {string} [opts.difficultyOverride] — force all items to one difficulty
 * @returns {string} prompt
 */
function buildLCRPrompt(count = 10, opts = {}) {
  const { excludeSpeakers = [], difficultyOverride = null } = opts;

  // ── 1. Assign answer positions (strict rotation prevents clustering) ──
  const positions = ["A", "B", "C", "D"];
  const answerAssignments = [];
  for (let i = 0; i < count; i++) {
    answerAssignments.push(positions[i % 4]);
  }

  // ── 2. Assign difficulty tiers ──
  const difficulties = [];
  if (difficultyOverride) {
    for (let i = 0; i < count; i++) difficulties.push(difficultyOverride);
  } else {
    // Distribute: 30% easy, 45% medium, 25% hard
    const easyCount = Math.round(count * 0.3);
    const hardCount = Math.round(count * 0.25);
    const medCount = count - easyCount - hardCount;
    for (let i = 0; i < easyCount; i++) difficulties.push("easy");
    for (let i = 0; i < medCount; i++) difficulties.push("medium");
    for (let i = 0; i < hardCount; i++) difficulties.push("hard");
    // Shuffle to avoid clustering
    for (let i = difficulties.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [difficulties[i], difficulties[j]] = [difficulties[j], difficulties[i]];
    }
  }

  // ── 3. Assign answer paradigms (matching difficulty + target distribution) ──
  const paradigmAssignments = difficulties.map(diff => {
    if (diff === "easy") {
      return Math.random() < 0.4 ? "direct_topical" : "marker_led_indirect";
    } else if (diff === "medium") {
      const r = Math.random();
      if (r < 0.35) return "counter_question";
      if (r < 0.7) return "marker_led_indirect";
      return "idiomatic";
    } else {
      return Math.random() < 0.55 ? "context_shift" : "idiomatic";
    }
  });

  // ── 4. Select scenarios (diverse contexts) ──
  const allSituations = [];
  for (const pool of SCENARIO_POOL) {
    for (const sit of pool.situations) {
      allSituations.push({ context: pool.context, situation: sit });
    }
  }
  // Shuffle and pick
  const shuffled = allSituations.sort(() => Math.random() - 0.5);
  const selectedScenarios = shuffled.slice(0, count);

  // ── 5. Build item specs ──
  const itemSpecs = [];
  for (let i = 0; i < count; i++) {
    const sc = selectedScenarios[i] || selectedScenarios[i % selectedScenarios.length];
    itemSpecs.push(
      `Item ${i + 1}:\n` +
      `  Context: ${sc.context}\n` +
      `  Situation: ${sc.situation}\n` +
      `  Difficulty: ${difficulties[i]}\n` +
      `  Correct answer position: ${answerAssignments[i]}\n` +
      `  Answer paradigm: ${paradigmAssignments[i]}`
    );
  }

  // ── 6. Build real ETS examples section ──
  const examplesSection = `## REAL ETS REFERENCE EXAMPLES — Study these carefully

EXAMPLE 1 (context_shift paradigm — HARD):
Speaker: "What time do I need to pick up Michael from the airport?"
A. "Don't worry about it. I'll get him."  ← CORRECT (solves the underlying need instead of answering the time question)
B. "He said he prefers the window seat."  ← WORD TRAP ('airport' → airplane details)
C. "The airport has a new snack shop."    ← WORD TRAP ('airport' → airport facilities)
D. "The flight could be delayed due to weather." ← OFF-TOPIC (partially related but unhelpful)

EXAMPLE 2 (counter_question paradigm — MEDIUM):
Speaker: "I'm afraid I'm not available this evening."
A. "Oh, that's too early."               ← MISINTERPRETATION ('evening' ≠ 'early')
B. "How about tomorrow night then?"      ← CORRECT (proposes alternative, advances conversation)
C. "She arrived this afternoon."          ← OFF-TOPIC (different person, different time)
D. "No, that's not necessary."            ← OFF-TOPIC (dismissive, doesn't address scheduling)

EXAMPLE 3 (idiomatic paradigm — MEDIUM-HARD):
Speaker: "I have to tell you something."
A. "I'm all ears."                        ← CORRECT (idiom meaning "I'm ready to listen")
B. "I already told you."                  ← WORD TRAP ('tell' → 'told')
C. "I can't tell the difference."         ← POLYSEMY TRAP ('tell' meaning 'distinguish')
D. "I can see them now."                  ← OFF-TOPIC

EXAMPLE 4 (marker_led_indirect paradigm — MEDIUM):
Speaker: "Are you done with the printer? I need to scan something urgent."
A. "Thank you for asking, I appreciate it." ← WRONG REGISTER (inappropriate when being asked to hurry)
B. "Just one more minute, I'm printing the last page." ← CORRECT ('Just' signals brief delay + explains)
C. "I'll buy more ink tomorrow."          ← OFF-TOPIC (future unrelated action)
D. "The printer is new and very fast."    ← WORD TRAP ('printer' → describing it instead of acting)

EXAMPLE 5 (direct_topical paradigm — EASY):
Speaker: "Excuse me, do you know if the library is open on Saturdays?"
A. "I don't like going to the library."   ← OFF-TOPIC (personal opinion, not information)
B. "Yes, it opens at 10 AM on weekends."  ← CORRECT (direct factual answer)
C. "The book is on the third floor."      ← WORD TRAP ('library' → 'book/floor')
D. "No, I haven't been there yet."        ← WRONG QUESTION (answers 'have you been' not 'is it open')

EXAMPLE 6 (indirect_refusal — MEDIUM):
Speaker: "Do you want to get lunch?"
A. "I'm not hungry."                      ← CORRECT (indirect decline — explains WHY not, never says 'no')
B. "It's over there."                     ← OFF-TOPIC
C. "I'll get you a sandwich."             ← MISINTERPRETATION ('get' → fetch for someone)
D. "No, I didn't realize that."           ← WRONG CONTEXT ('no' but for wrong purpose)`;

  // ── 7. Build distractor engineering section ──
  const distractorSection = `## DISTRACTOR ENGINEERING — How to build wrong answers

Each item MUST have 3 distractors from AT LEAST 2 different types:

### Type 1: SEMANTIC ASSOCIATION TRAP (target: ≥1 per item)
Formula: Take a CONTENT WORD from the speaker → find a RELATED concept → build a sentence about that concept.
- "library" → "The book is on the third floor." (library associates with books/floors)
- "bus" → "I nearly missed the bus." (reuses 'bus' in unrelated past event)
- "printer" → "The printer is new and very fast." (describes printer instead of acting)
- "chemistry" → "Chemistry is a required subject for everyone." (states fact about chemistry, ignores emotion)

### Type 2: OFF-TOPIC BUT GRAMMATICAL (target: ≥1 per item)
Formula: A normal English sentence that would work in a DIFFERENT conversation. Zero connection to this context.
- For a schedule question: "She arrived this afternoon."
- For a presentation question: "Despite the rain, I got a quick walk in after lunch."

### Type 3: WRONG QUESTION TYPE (target: ~20% of all distractors)
Formula: Answer a DIFFERENT type of question than what was asked.
- Speaker asks WHERE → answer WHEN: "Every 30 minutes."
- Speaker asks HOW → answer YES/NO: "Yes, you're allowed to do that."

### Type 4: POLYSEMY / MISINTERPRETATION (target: ~10%, use in hard items)
Formula: Use the same word but with a different meaning, or misread the speaker's intent.
- "tell" (inform) → "I can't tell the difference." (tell = distinguish)
- "get lunch" → "I'll get you a sandwich." (get = fetch for someone)

### CRITICAL RULES:
- Every distractor MUST be grammatically perfect, natural English
- Every distractor MUST make sense as something a real person would say (in some other context)
- NEVER use nonsense, grammar errors, or obviously absurd options
- Within one item, all 3 distractors should be DIFFERENT types

### AMBIGUITY PREVENTION — THE #1 QUALITY ISSUE (READ CAREFULLY):
The most common fatal flaw: a distractor that ALSO works as a valid response. Before writing each distractor, ask: "If someone said this in real life, would it be a reasonable reply?" If YES → it's a BAD distractor, rewrite it.

REAL FAILURES FROM OUR QUALITY AUDIT (all were removed from the bank):
- Speaker: "Do you know which chapters we're supposed to read?"
  BAD distractor: "I haven't read the chapters yet either." ← THIS IS A NATURAL RESPONSE, not a distractor!
  WHY: It shows empathy and is something a real person would actually say.

- Speaker: "Do you know if this journal is available online?"
  BAD distractor: "I read it online yesterday." ← ALSO VALID, implies it IS online!

- Speaker: "Where's the best place to park for the science building?"
  BAD distractor: "It's on the north side of campus." ← GIVES USEFUL INFO, is a valid partial answer!

- Speaker: "Do you know when the next shuttle leaves?"
  BAD distractor: "Yes, I know the schedule." ← NATURAL conversation opener before giving the time!

- Speaker: "Do you know if the gym is still open?"
  BAD distractor: "Yes, I was there yesterday." ← IMPLIES THE GYM EXISTS AND OPENS!

PATTERN TO AVOID: When the speaker asks "Do you know...?", "Can you...?", "Is the...?":
- Do NOT write a distractor that answers YES/NO + adds relevant info
- Do NOT write a distractor that shares the speaker's concern/situation
- Do NOT write a distractor that gives partial but useful information
- Distractors should address a COMPLETELY DIFFERENT topic/need, or answer a DIFFERENT question entirely

SAFE distractor patterns for "Do you know X?" questions:
- Talk about a RELATED OBJECT but not the answer: "The library has a copy of the textbook." (asks about chapters, answers about textbook)
- Give INFO about the WRONG ASPECT: "The shuttle stop is near the library." (asks about time, answers about location)
- Express an UNRELATED personal fact: "I need to go to the store later."
- Misuse a keyword: "Yes, I know several people there." (know = be acquainted with, not know the answer)`;

  // ── 8. Assemble full prompt ──
  return `You are an ETS-caliber TOEFL question writer for the 2026 "Listen and Choose a Response" task.

## TASK FORMAT
The test-taker hears ONE spoken sentence (~5 seconds), then chooses the most appropriate response from 4 text options. This tests PRAGMATIC understanding — recognizing conversational intent beyond literal words.

${examplesSection}

${distractorSection}

## CORRECT ANSWER PARADIGMS — What makes the right answer "right"

CRITICAL INSIGHT: In real ETS items, only ~6% of correct answers directly answer the literal question. The rest are INDIRECT:

1. **context_shift** (~30%): Don't answer the question — solve the underlying problem instead.
2. **idiomatic** (~25%): Use a natural idiom or conversational formula (I'm all ears, Absolutely, As a matter of fact...).
3. **counter_question** (~20%): Answer with a question that advances the conversation (How about tomorrow? What's a better day?).
4. **marker_led_indirect** (~20%): Open with a discourse marker (Actually, Well, Just, Maybe) then give an indirect response.
5. **direct_topical** (~5%): Directly answer the factual question. Use VERY sparingly.

## SPEAKER SENTENCE RULES
- Length: 5-14 words (target 8-12). Short and spoken.
- Use contractions naturally (I'm, Didn't, Isn't, It's) — at least 60% of items.
- Sentence types: ~30% declarative statements, ~25% wh-questions, ~25% yes/no questions, ~20% negative questions.
- Must contain at least 1 content word that can be reused in a word trap distractor.
- Must sound like SPOKEN English, not written. Casual register.

## CORRECT ANSWER RULES
- Length: 3-10 words (target ~6). NEVER verbose.
- ~37% should open with a discourse marker (Actually, Well, Just, Maybe, How about, Don't worry).
- Tone: neutral-helpful or casual-warm. NEVER cold, formal, or negative.
- Must feel like a NATURAL continuation of the conversation.

## OPTION RULES
- All 4 options: 3-12 words each, similar length (max spread ≤5 words).
- Correct answer must NOT be consistently the longest.
- Options should use DIFFERENT grammatical structures (prevent elimination by form).
- Each option must be a standalone valid English sentence.

## ITEMS TO GENERATE

${itemSpecs.join("\n\n")}

${excludeSpeakers.length > 0 ? `\n## DO NOT REUSE THESE SPEAKER SENTENCES (already in bank):\n${excludeSpeakers.slice(0, 20).map(s => `- "${s}"`).join("\n")}\n` : ""}

## OUTPUT FORMAT

Return a JSON array. Each element:
{
  "context": "campus_academic",
  "situation": "short description",
  "difficulty": "easy|medium|hard",
  "answer_paradigm": "context_shift|idiomatic|counter_question|marker_led_indirect|direct_topical",
  "speaker": "The sentence the test-taker hears.",
  "options": {
    "A": "Response A",
    "B": "Response B",
    "C": "Response C",
    "D": "Response D"
  },
  "answer": "B",
  "explanation": "Why correct is right. Why each distractor is wrong.",
  "distractor_types": {
    "A": "semantic_association_trap",
    "C": "off_topic",
    "D": "wrong_question_type"
  }
}

Generate exactly ${count} items. Return ONLY the JSON array, no markdown fencing, no extra text.`;
}

module.exports = { buildLCRPrompt, SCENARIO_POOL, ANSWER_PARADIGMS, DISTRACTOR_TYPES, DIFFICULTY_TIERS };
