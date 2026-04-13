/**
 * Read in Daily Life — Prompt builder for text + question generation.
 *
 * Unlike CTW (where blanking is mechanical), RDL needs the AI to generate
 * both the passage text AND the multiple-choice questions.
 *
 * Uses ETS flavor data to constrain style, register, and question patterns.
 */

const { RDL_PROFILE, ETS_FLAVOR } = require("../readingBank/readingEtsProfile");

// ── Genre templates with register guidance ──

const GENRE_SPECS = {
  email: {
    label: "Email",
    register: "Semi-formal to informal depending on context. Include greeting (Dear/Hi) and sign-off (Best regards/Thanks). Use 1-2 contractions naturally.",
    structure: "Subject line + greeting + 2-3 body paragraphs + sign-off + sender name",
    metadata_fields: "from, to, subject",
    scenarios: [
      "Welcome email from a campus makerspace/community center",
      "Roommate email about apartment maintenance or shared errand",
      "Shift swap request between student employees",
      "Event invitation from a student organization",
      "Campus bicycle maintenance clinic invitation",
      "Tool library or community resource introduction",
      "Urban sketching walk or photography event invitation",
      "Dormitory checkout procedures from resident advisor",
      "Study group formation for an upcoming exam",
      "Tutoring center appointment confirmation",
      "Internship application deadline reminder from career services",
      "Campus parking permit renewal notice",
      "Health clinic flu shot appointment confirmation",
      "Campus radio station volunteer recruitment",
      "Library overdue book reminder email",
      "Lab partner coordination for a chemistry experiment",
      "Career fair RSVP confirmation with booth map",
      "Campus bookstore order pickup notification",
    ],
  },
  notice: {
    label: "Notice / Announcement",
    register: "Formal. Use passive voice (1-2 instances). Include specific dates, times, locations, and dollar amounts. Use bullet points for lists.",
    structure: "Title/header + date/time/location + body paragraphs + rules/guidelines (often as bullet list) + contact info",
    metadata_fields: "issuer, type",
    scenarios: [
      "Campus locker clean-out and renewal deadline",
      "Library or recreation center policy update",
      "Textbook buyback event with location change",
      "Campus bicycle rental program spring guide",
      "Package delivery procedure change",
      "Wi-Fi security certificate update notice",
      "E-waste recycling drive announcement",
      "Water shutoff and maintenance notification",
      "Printing quota and kiosk changes",
      "Community garden plot registration",
      "Green commute initiative with rewards",
      "Laundry room renovation and temporary closure",
      "Lost and found policy update",
      "Fire drill schedule and evacuation procedures",
      "Campus mailroom holiday hours change",
      "Study room reservation system update",
      "New campus app launch announcement",
      "Dining hall allergen policy update",
      "Elevator maintenance schedule for residence hall",
      "Campus vending machine refund procedure",
      "Course evaluation deadline and instructions",
    ],
  },
  social_media: {
    label: "Social Media Post",
    register: "Informal. Use 2-3 exclamation marks, casual language. May include hashtags. Writer shares personal experience or creation.",
    structure: "Username/handle + post body (2-3 paragraphs) + call to action or question to followers",
    metadata_fields: "author, platform",
    scenarios: [
      "Student sharing a DIY project or creative work",
      "Student reviewing a local farmers market",
      "Developer showing off a student-built app",
      "Artist sharing a stop-motion animation process",
      "Student recommending a campus event",
    ],
  },
  schedule: {
    label: "Schedule / Timetable",
    register: "Formal, data-dense. Use tables or structured lists with times, days, locations. Include policy notes.",
    structure: "Header + schedule entries with times/days/locations + policies (cancellation, late arrival, etc.)",
    metadata_fields: "issuer, type",
    scenarios: [
      "Recreation center group fitness class schedule",
      "Library study room reservation hours",
      "Campus shuttle service timetable changes",
    ],
  },
  menu: {
    label: "Menu / Price List",
    register: "Mix of casual marketing language and factual pricing. Include item names, descriptions, prices, and special offers.",
    structure: "Café/restaurant name + menu items with prices + specials/discounts + payment policies",
    metadata_fields: "establishment, type",
    scenarios: [
      "Student union café menu with study-hour specials",
      "Campus food truck weekly specials",
    ],
  },
  syllabus: {
    label: "Course Syllabus (excerpt)",
    register: "Formal academic. Include grading breakdown, policies, deadlines. Use specific percentages and dates.",
    structure: "Course title + grading breakdown + key policies (late work, attendance) + important dates",
    metadata_fields: "course, instructor",
    scenarios: [
      "Creative writing course syllabus with peer critique policy",
      "Introduction to Biology lab component grading",
    ],
  },
};

// Question type templates with stem patterns
const QUESTION_TYPE_TEMPLATES = {
  detail: {
    weight: 0.55,
    stem_patterns: [
      "According to the {genre}, what {action}?",
      "What must {person} do before {event}?",
      "According to the {genre}, which item {constraint}?",
      "Where will {event} take place?",
      "What will happen if {condition}?",
    ],
    distractor_guide: "Use 'not_mentioned' (fabricate plausible but absent details) and 'wrong_detail' (borrow real terms but attach wrong relationships).",
  },
  inference: {
    weight: 0.28,
    stem_patterns: [
      "What can be inferred about {subject} from the {genre}?",
      "What can be inferred about {subject}?",
      "What is implied about {aspect}?",
      "What is suggested about the {subject}?",
    ],
    distractor_guide: "Use 'opposite' (reverse the implied logic) and 'not_mentioned' (plausible but unsupported).",
  },
  main_idea: {
    weight: 0.12,
    stem_patterns: [
      "What is the main purpose of this {genre}?",
      "What is the primary purpose of the {genre}?",
      "Why was this {genre} written?",
    ],
    distractor_guide: "Use 'too_narrow' (capture only one detail, not the whole point) and 'wrong_detail' (wrong purpose).",
  },
  vocabulary_in_context: {
    weight: 0.05,
    stem_patterns: [
      "In the {genre}, the word \"{word}\" is closest in meaning to",
      "The word \"{word}\" in the passage most nearly means",
    ],
    distractor_guide: "Offer 3 real English words of the same part of speech that could superficially fit but don't match the contextual meaning.",
  },
};

/**
 * Build a prompt to generate N Read in Daily Life items.
 *
 * @param {number} count — items to generate (1-10)
 * @param {object} opts
 * @param {string[]} [opts.genres] — specific genres to use (random if empty)
 * @param {string[]} [opts.excludeScenarios] — scenarios already generated
 * @param {string[]} [opts.rejectionFeedback] — reasons previous items were rejected
 * @returns {string} prompt
 */
function buildRDLPrompt(count = 5, opts = {}) {
  const { genres = [], excludeScenarios = [], rejectionFeedback = [] } = opts;

  // Select genres
  const genreKeys = Object.keys(GENRE_SPECS);
  const selected = [];
  for (let i = 0; i < count; i++) {
    let g;
    if (genres.length > 0) {
      g = genres[i % genres.length];
    } else {
      // Weighted selection matching profile
      const r = Math.random();
      if (r < 0.40) g = "email";
      else if (r < 0.80) g = "notice";
      else if (r < 0.88) g = "social_media";
      else if (r < 0.92) g = "schedule";
      else if (r < 0.96) g = "menu";
      else g = "syllabus";
    }
    const spec = GENRE_SPECS[g];
    const avail = spec.scenarios.filter(s => !excludeScenarios.includes(s));
    const scenario = avail[Math.floor(Math.random() * avail.length)] || spec.scenarios[0];
    selected.push({ genre: g, spec, scenario });
  }

  // Select question types for each item (3 questions per item)
  const questionPlans = selected.map(() => {
    const types = [];
    // Always include 1 detail
    types.push("detail");
    // 2nd question: weighted random
    const r2 = Math.random();
    if (r2 < 0.50) types.push("inference");
    else if (r2 < 0.75) types.push("detail");
    else if (r2 < 0.90) types.push("main_idea");
    else types.push("vocabulary_in_context");
    // 3rd question: fill gap
    if (!types.includes("inference")) types.push("inference");
    else if (!types.includes("main_idea")) types.push("main_idea");
    else types.push("detail");
    return types;
  });

  // Assign answer positions (force balance across the batch)
  const posPool = [];
  for (let i = 0; i < count * 3; i++) {
    posPool.push(["A", "B", "C", "D"][i % 4]);
  }
  // Shuffle
  for (let i = posPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [posPool[i], posPool[j]] = [posPool[j], posPool[i]];
  }

  const itemSpecs = selected.map((s, i) => {
    const qTypes = questionPlans[i];
    const positions = posPool.splice(0, 3);
    // ~33% of items must include a dollar amount
    const mustHaveMoney = (i % 3 === 0);
    const moneyNote = mustHaveMoney
      ? "\n   MUST INCLUDE at least one dollar amount (e.g., $5 fee, $2.00 entry, $10 deposit, $45 pass)"
      : "";
    return `${i + 1}. Genre: ${s.genre} (${s.spec.label})
   Scenario: ${s.scenario}
   Register: ${s.spec.register}
   Structure: ${s.spec.structure}${moneyNote}
   Questions: Q1=${qTypes[0]}(answer=${positions[0]}), Q2=${qTypes[1]}(answer=${positions[1]}), Q3=${qTypes[2]}(answer=${positions[2]})`;
  }).join("\n\n");

  let feedback = "";
  if (rejectionFeedback.length > 0) {
    feedback = `\n\nPREVIOUS ITEMS WERE REJECTED. Fix these issues:\n${rejectionFeedback.map(r => `- ${r}`).join("\n")}`;
  }

  return `You are a TOEFL "Read in Daily Life" question writer. Generate ${count} complete items, each with a passage and 3 multiple-choice questions.

## PASSAGE REQUIREMENTS

1. **Length**: 100-180 words (campus emails/notices are NOT short tweets — they contain real operational detail).
2. **Setting**: 75% should be campus/university contexts. Include specific details:
   - Dates and months (e.g., "May 15", "September 12") — 60% of passages should have these
   - Specific times (e.g., "9:00 AM to 4:00 PM") — 69% should have these
   - Dollar amounts (e.g., "$2.00 entry fee", "$5 penalty", "$10 late fee", "$45 pass") — at least 3 out of every 10 passages MUST include a dollar amount. This is currently missing from generation.
3. **Structure**: Use the structure template for each genre. 37% of passages should include bullet-point lists.
4. **Register**: Follow the register guidance for each genre. Emails use contractions (1-2 per text). Notices are more formal with passive voice.
5. **Content**: Must feel like a REAL campus communication — specific names, room numbers, building names, deadlines. Never generic or vague.
6. **Information density** (critical for question quality):
   - Emails should contain ~11 extractable facts (names, dates, rules, locations, conditions)
   - Notices should contain ~17 extractable facts
   - Schedules/menus should be data-rich (~29-34 facts: prices, times, rules)
   - Social media should be experience-rich with opinions, not data-heavy (~1-3 facts)
   - The passage must contain enough factual detail to support 3 questions with 4 plausible options each
7. **Top vocabulary**: Naturally use campus words like "please", "campus", "student(s)", "must", "semester", "hours", "free", "safety", "access", "portal", "receive", "maintenance", "online"
8. **Opening/closing patterns**:
   - 75% of texts open with a direct statement (not greeting). Only emails start with "Dear/Hi"
   - 33% end with contact info, 27% with sign-off, 19% with call-to-action, 13% with deadline reminder

## QUESTION REQUIREMENTS

1. **4 options (A/B/C/D)** per question.
   - **GRAMMATICAL PARALLELISM IS MANDATORY**: All 4 options MUST start with the same grammatical structure. Examples:
     ✓ All start with "To + verb": "To register...", "To submit...", "To complete...", "To attend..."
     ✓ All start with "A/An + noun": "A deposit...", "A penalty...", "A refund...", "A meeting..."
     ✓ All start with "It/They + verb": "It is located...", "It will be closed...", "It requires...", "It charges..."
     ✗ WRONG: "Pay a fee" / "Provide a deposit" / "Visit the library" / "Complete a form" — each starts differently!
2. **Option balance**: All 4 options should be similar length (within 3 words of each other). The correct answer must NOT consistently be the longest option.
3. **Correct answer position**: MUST match the assigned position below. This ensures uniform distribution.
4. **Question types**:
   - detail: Tests specific factual information stated in the text. Stem: "According to the email, what..." / "What must X do..."
   - inference: Tests what is implied but not directly stated. Stem: "What can be inferred about..."
   - main_idea: Tests overall purpose. Stem: "What is the main purpose of this email/notice?"
   - vocabulary_in_context: Tests word meaning. Stem: "The word X is closest in meaning to..."
5. **Distractor engineering** (CRITICAL — this is what separates good from bad questions):

   QUANTIFIED RULES FROM REAL TOEFL DATA:
   - For DETAIL questions: correct answers share ~60% of content words with the passage. Distractors must ALSO share ~50% of content words with the passage (gap is only 9 percentage points!). This means distractors MUST borrow real passage vocabulary and attach it to wrong relationships. Do NOT write distractors that are obviously unrelated to the passage.
   - For INFERENCE questions: correct answers and distractors have the SAME level of passage word overlap (~36%). The only difference is logical direction. One distractor must reverse the implied logic (opposite), others should be plausible but not supported.
   - For MAIN_IDEA questions: distractors should capture only one detail (too_narrow) or state a plausible but wrong purpose.

   DISTRACTOR CONSTRUCTION RECIPE (for each wrong option):
   a) "plausible_generic" (use for ~49% of distractors): Write something that sounds reasonable given the topic but is not stated in the passage. Use moderate vocabulary overlap with the passage.
   b) "uses_passage_words" (use for ~31% of distractors): Take 2-3 real terms from the passage and construct a statement that CHANGES their relationship. Example: if passage says "volunteers receive early access," a distractor could say "volunteers are required to arrive early" — same words ("volunteers", "early"), wrong relationship.
   c) "introduces_new_terms" (use for ~20% of distractors): Fabricate something topically related but completely absent from the passage. Use zero passage vocabulary.

6. **Correct answer paraphrase strategy** (match real TOEFL patterns):
   - 44% of correct answers SYNTHESIZE information from multiple sentences (not just one sentence)
   - 28% use synonym substitution (swap key words with synonyms)
   - 17% are near-verbatim (close to passage wording but restructured)
   - Correct answers should NEVER copy 4+ consecutive words from the passage verbatim

7. **Question coverage rules** (CRITICAL):
   - 3 questions MUST target 3 different parts of the text (90% of real items do this)
   - 58% of items have questions ordered by text position — follow text order when possible
   - 42% of answers require reading multiple sentences, 36% single sentence, 21% whole text
   - 22% of questions test temporal/conditional understanding ("before", "if", "deadline")

8. **Option construction rules** (from 608 options analyzed):
   - 99% of questions have strong grammatical parallelism (all options start the same way)
   - Option starts: noun phrase (36%), infinitive "To..." (23%), pronoun "It/They..." (21%), gerund "-ing" (6%)
   - Avg pairwise overlap between options is only 3.5% — options must use DIFFERENT vocabulary from each other
   - Options are 94.9% unique words — almost no word repetition across the 4 choices

9. **Distractor trap techniques** (use these to create believable wrong answers):
   - Entity swap (8%): mention a real name/place from the text but in the wrong context
   - Exaggeration (5%): use absolute words (all, always, never, only, completely, exclusively) — the text rarely uses absolutes
   - Date/time swap (3%): use a real date/time from the text but associate it with the wrong event
   - For schedule/syllabus/menu genres: 50-78% of distractors borrow passage words (data-rich texts make word-borrowing easy)
   - For social_media: only 11% borrow passage words, 36% introduce completely new terms (opinion texts have less borrowable vocabulary)

10. **NOT questions** (11% of all questions):
    - 3 options are TRUE (paraphrase real facts from the text), 1 option is FALSE (the correct answer)
    - Stem patterns: "Which is NOT mentioned", "Which is NOT accepted", "Which is NOT a benefit"

11. **Stem specificity**:
    - 34% of stems reference the genre ("According to the email/notice...")
    - 16% name a specific person ("What must Ms. Lin do...")
    - 18% include a conditional ("if", "before", "after", "when")
    - Only 3% quote a specific word — vocab-in-context questions
    - Stems share 45% of their content words with the passage (helps locate the answer)
    - 18% of stems quote a 3+ word phrase directly from the passage

12. **Q-position formula** (CRITICAL for realistic feel):
    - Q1: 60% detail, 31% main_idea — Q1 is usually a factual or purpose question
    - Q2: 58% detail, 35% inference — Q2 adds inference
    - Q3: 48% detail, 44% inference — Q3 is the deepest thinking question
    - Most common sequence: main_idea→detail→detail (23%), detail→inference→inference (17%)
    - NEVER put 3 main_idea questions or 3 inference questions in one item

13. **Option semantic category** (CRITICAL — AI often breaks this):
    - 74% of questions have all 4 options in the SAME semantic category (all actions, all reasons, all times, etc.)
    - Only 2% have 3+ different categories — avoid mixing "a price", "a location", "a time", and "a reason" in one question
    - If Q asks "What must X do?", ALL 4 options must be actions, not a mix of actions and descriptions

14. **Absolute language trap** (CRITICAL — biggest AI tell):
    - Correct answers use absolute words (all/always/never/only) only 3% of the time
    - Distractors use them 5% — this is a TELL that smart students exploit
    - In AI generation, NEVER put absolutes in distractors unless the correct answer also uses one
    - Correct answers are 90% neutral, 7% hedged, 3% absolute — match this

15. **Passage actionability**: 96% of RDL texts tell the reader to DO something (register, bring, submit, contact). Include at least 2-3 imperative instructions per passage.

16. **Concrete detail density**: Avg 6.2 proper noun phrases + 6.5 numeric values per passage. AI must generate specific names (Anderson Hall, Ms. Chen, Room 204), dates (May 15), times (9:00 AM), and amounts ($5.00).

## ITEMS TO GENERATE

${itemSpecs}

## OUTPUT FORMAT

Return a JSON array. Each element:
\`\`\`json
{
  "genre": "email",
  "text": "Subject: ...\\n\\nDear ...\\n\\n...",
  "format_metadata": { "from": "...", "to": "...", "subject": "..." },
  "questions": [
    {
      "question_type": "detail",
      "stem": "According to the email, what must...",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "correct_answer": "B",
      "explanation": "The email states that..."
    }
  ],
  "difficulty": "easy"
}
\`\`\`

Return ONLY the JSON array, no markdown fencing, no explanation.${feedback}`;
}

module.exports = { buildRDLPrompt, GENRE_SPECS, QUESTION_TYPE_TEMPLATES };
