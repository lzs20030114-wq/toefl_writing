/**
 * AI prompt builders for the BS generation pipeline.
 * Pure string-building functions — no side effects, no API calls.
 */

const { shuffle } = require("./utils");

// ── Constants used by prompt builders ────────────────────────────────────────

const SCENARIO_POOL = [
  "Academic/Lecture: professor's office hours, lecture hall discussion, reading assignment, research findings",
  "Academic/Campus: student study group, campus café, registrar office, internship interview, thesis advisor meeting",
  "Academic/Library: library reserve desk, study room booking, overdue materials, database search, interlibrary loan",
  "Academic/Lab: lab safety orientation, experiment results, data collection, equipment booking, research ethics",
  "Home/Family: grocery shopping, home repair, neighbor interaction, cooking, apartment maintenance",
  "Leisure/Hobbies: local library, community center, sports class, art gallery, bookstore",
  "Service/Retail: restaurant waiter, clothing store, post office, hair salon, auto repair",
  "Health/Wellness: dental appointment, pharmacy, yoga class, medical clinic, health insurance",
  "Nature/Environment: local park, botanical garden, weather forecast, hiking trail, camping trip",
  "Travel/Transport: airport check-in, train delay, hotel reservation, car rental, bus schedule"
];

const PERSONA_POOL = [
  "The flight attendant", "A young architect", "The local librarian", "A frustrated customer",
  "The software developer", "An exchange student", "The elderly neighbor", "The yoga instructor",
  "A travel blogger", "The store clerk", "A delivery driver", "The project supervisor",
  "A volunteer", "The museum curator", "An enthusiastic intern", "The shop owner",
  "The professor", "The teaching assistant", "A graduate student", "The department secretary",
  "A lab technician", "The academic advisor", "A research assistant", "The campus security guard"
];

const TYPE_DIFFICULTY_HINTS = {
  "negation": {
    easy: `ALL answers in this group: simple negative statement, 7-10 words.
Structure: "[Subject] did not [verb]." / "[Subject] could not [verb]." / "[Subject] is not [adj]."
Examples (mix 1st and 3rd person — prefer 3rd person):
- "The student did not have time to finish the report."  prefilled=["the student"]
- "The manager could not find the reservation confirmation."  prefilled=["the manager"]
- "I am not going to sign for the package."  prefilled=["i"]
Prompt: prompt_task_kind="respond", prompt_task_text="How do you respond?" or "What do you say?"
Distractor: "did" or "do" or morphological variant.
SCORER FENCE (easy): Only "did not" / "do not" / "cannot" / "could not" / "am not" / "is not". NO "have not been" (passive). NO "had not" (past perfect). NO comparative. NO relative clause. NO embedded wh-clause.
PREFILLED (easy): Bare pronoun "she"/"he"/"they" or 2-word NP "the student" for 3rd-person. "i" for ~20%.`,

    medium: `ALL answers in this group: negative statement, 9-12 words.
EMBEDDED STRUCTURE REQUIRED: MOST negation/medium items (~80%) MUST use negation + embedded wh/if clause:
  "did not know why/when/whether...", "could not understand what...", "was not sure if..."
  This keeps the embedded rate close to TPO (63%). Only ~20% can be simple negation without embedded clause.
IMPORTANT: Prefer 3rd-person subjects (~80%). Only ~20% should use "I".
Examples WITH correct prefilled (study these carefully):
  answer: "She did not know why the meeting was postponed."  prefilled=["she"] pos=0 ✔ (negation + embedded ✔)
  answer: "The advisor did not understand what the manager explained."  prefilled=["the advisor"] pos=0 ✔ (negation + embedded ✔)
  answer: "He was not sure if the package had arrived."  prefilled=["he"] pos=0 ✔ (negation + embedded ✔)
  answer: "I have not received any confirmation about the schedule."  prefilled=["i"] pos=0 ✔ (simple negation — OK for the ~20% without embedded)
  BAD: answer="I did not attend the interview last week."  prefilled=["not"] ✘ WRONG — "not" cannot be prefilled
Prompt: prompt_task_kind="ask" or "report" or "respond". Distractor: "did"/"do" or morphological variant.
SCORER FENCE (medium): Prefer simple past ("did not") or present perfect ("have not"). AVOID past perfect negation ("had not done" -> HARD). AVOID passive negation ("was not approved", "has not been sent" -> HARD). The embedded wh/if clause should use simple tenses only. At most ONE advanced grammar feature.
PREFILLED: Bare pronoun "she"/"he"/"they" (TPO standard) or 2-word NP. "i" for ~20%. NEVER ["not"] as prefilled.`,

    hard: `ALL answers in this group: negation + advanced grammar complexity, 10-13 words.
Examples:
- "I had not realized how quickly the project deadline was approaching."
- "I did not understand why the meeting had been postponed again."
Hard MUST come from structure: past perfect negation, passive/passive-progressive inside clause, or negation + embedded grammar trap.
Distractor: morphological variant (e.g. "realized/realize", "approaching/approach").
PREFILLED REMINDER: Hard sentences are 10-13 words — effective chunks MUST still be ≤ 8. Give the SUBJECT as prefilled: bare pronoun "she"/"he"/"they" (most common in TPO) or 2-word NP "the professor" — both are valid. "i" for 1st-person only. Target R=7-9. If R>9, add a multi-word chunk or shorten the sentence. Difficulty comes from GRAMMAR STRUCTURE, not from chunk count.`,
  },

  "3rd-reporting": {
    easy: `ALL answers in this group: short third-person reporting, 8-10 words.
Structure: "[Subject] wanted to know if [short clause]." / "[Subject] asked what time..."
Subject MUST be 3rd-person — NEVER "I/my/me".
Examples:
- "She wants to know if you need a ride."  prefilled=["she"] ✔ (bare pronoun)
- "The manager asked me what time the meeting starts."  prefilled=["the manager"] ✔ (2-word NP)
- "They wanted to know if the library was open."  prefilled=["they"] ✔ (bare pronoun)
MID-SENTENCE prefilled example: "She wanted to know if the files were ready."  prefilled=["wanted to know"] pos=mid ✔
Prompt: prompt_task_kind="report", prompt_task_text="What did the manager ask?" or "What does the professor want to know?" Distractor: "did" or "do".
SCORER FENCE (easy): Embedded clause uses simple present or simple past only. NO passive ("was approved"). NO past perfect ("had gone"). NO "whom". NO comparative.`,

    medium: `ALL answers in this group: third-person reporting, 10-13 words.
Structure: "[Subject] [wanted to know / asked / was curious / needed to know] [wh/if clause]"
Subject MUST be 3rd-person — NEVER "I/my/me" (not 1st-person).
Vary subjects: bare "she"/"he"/"they" (most common), or NPs "the manager", "some colleagues", "the professor"
Vary wh-words across the batch: if(3), what(2), where(2), why(2), when(1)
Declarative word order in clause (NO inversion). Distractor: "did"/"do" for most.
SCORER FENCE (medium): Embedded clause uses simple past or simple present ONLY. STRICTLY AVOID past perfect in embedded clause ("had been done", "had gone" -> HARD). STRICTLY AVOID passive voice in embedded clause ("whether it had been approved", "when it would be submitted" -> HARD). AVOID "whom". Maximum ONE advanced grammar feature.
PREFILLED: Bare pronoun "she"/"he"/"they" is the TPO DEFAULT — use it for most items. 2-3 word NP ("the manager", "some colleagues") for variety. Mid-sentence prefilled like ["wanted to know"] or ["found out"] is encouraged (~30% of items).`,

    hard: `ALL answers in this group: third-person reporting with structurally complex embedded clause, 10-13 words.
Complexity options (MUST include at least one):
- Past perfect in clause: "He wanted to know where all the files had gone."
- Passive in clause: "She wanted to know when the report would be submitted."
- whom: "She wanted to know whom I would give the presentation to."
- Two-layer: "The manager wanted to know how we had been able to finish on time."
Hard MUST come from grammar complexity, not from padding the sentence.
Distractor: morphological variant or "whom/who", "where/when" function-word swap.
PREFILLED REMINDER: Hard sentences are 10-13 words — effective chunks MUST still be ≤ 8. Give the SUBJECT as prefilled: bare pronoun "she"/"he"/"they" (most common in TPO) or 2-word NP "the professor" — both are valid. NEVER "i" for 3rd-reporting. Target R=7-9. If R>9, add a multi-word chunk or shorten the sentence. Difficulty comes from GRAMMAR STRUCTURE, not from chunk count.`,
  },

  "1st-embedded": {
    easy: `ALL answers in this group: first-person embedded, 8-10 words, simple structure.
Structure: "I have no idea [wh-clause]." / "I am not sure [wh-clause]."
Examples:
- "I have no idea where they are going."
- "I am not sure what time the event starts."
- "I do not know if the store is open."
Prompt: prompt_task_kind="respond", prompt_task_text="What do you say?" or "How do you respond?"
Distractor: "do" or "did".
SCORER FENCE (easy): Embedded clause uses simple present only. NO passive. NO past perfect. NO comparative. NO "whom".`,

    medium: `ALL answers in this group: first-person embedded, 10-13 words.
Examples:
- "I do not understand why he decided to quit the team."
- "I found out where the new office supplies are kept."
- "I have no idea who will be leading the morning session."
- "I am not sure when the package is going to arrive."
Distractor: "did"/"does" or function-word variant.
SCORER FENCE (medium): Embedded clause uses simple past or simple present only. AVOID past perfect ("had done" -> HARD). AVOID passive voice in embedded clause ("has been approved", "is being processed" -> HARD). AVOID "whom". AVOID combining two advanced grammar features.
PREFILLED (medium/easy): "i" for ~40% of 1st-embedded items. For the rest, use 3rd-person bare pronoun "she"/"he" or 2-word NP "the student". Mid-sentence prefilled is encouraged: ["found out"], ["wanted to know"] at mid position.`,

    hard: `ALL answers in this group: complex first-person embedded, 10-13 words.
Examples:
- "I would love to know which restaurant you enjoyed the most." (superlative)
- "I have not been told who will be responsible for the final report." (passive + embedded)
- "We just found out where the new library equipment is being stored." (passive progressive)
Include passive voice OR superlative/comparative OR perfect aspect in the embedded clause. Hard MUST be signaled by grammar structure rather than answer length.
Distractor: morphological variant (e.g. "enjoyed/enjoy", "stored/store").
PREFILLED REMINDER: Hard sentences are 10-13 words — effective chunks MUST still be ≤ 8. Give the SUBJECT as prefilled: bare pronoun "she"/"he"/"they" (most common in TPO) or 2-word NP "the professor" — both are valid. "i" for 1st-person only. Target R=7-9. If R>9, add a multi-word chunk or shorten the sentence. Difficulty comes from GRAMMAR STRUCTURE, not from chunk count.`,
  },

  "interrogative": {
    easy: `ALL answers in this group use a natural polite question frame, 8-11 words.
Allowed frames (vary across batch):
- "Can you tell me ..."
- "Could you tell me ..."
- "Do you know ..."
Core rule: embedded clause stays in declarative word order.
Examples:
- "Can you tell me what your plans are for tomorrow?"
- "Do you know if the professor covered any new material?"
Prompt: prompt_task_kind="ask", prompt_task_text="What do you ask?" or "How do you ask about it?"
Distractor: "did"/"do" or nearby auxiliary/modal variant.
SCORER FENCE (easy): Embedded clause uses simple present or simple past only. NO passive. NO past perfect. NO comparative.`,

    medium: `ALL answers in this group use a natural interrogative frame, 10-13 words, moderate embedded complexity.
Use 2-4 different polite frames across the batch. Core rule: embedded clause stays declarative.
Examples WITH correct prefilled (the 2-word opener, NEVER the embedded topic noun):
  answer: "Could you tell me how you are feeling about it?"  prefilled=["could you"] pos=0
  answer: "Can you remind me when that event was rescheduled?"  prefilled=["can you"] pos=0
  answer: "Do you know what time it opens on Sundays?"  prefilled=["do you"] pos=0
  CRITICAL: the 2-word opener is ALWAYS prefilled. NEVER a noun phrase inside the clause.
Distractor: morphological variant or nearby auxiliary/modal variant.
SCORER FENCE (medium): AVOID past perfect in embedded clause ("had been done" -> HARD). AVOID passive in embedded clause ("has been approved" -> HARD). Simple past or present tense in embedded clause only.
PREFILLED (medium/easy): ALWAYS use the 2-word opening frame as prefilled: ["could you"], ["can you"], ["do you"], ["would you"]. NEVER any noun phrase from the embedded clause as prefilled.`,

    hard: `ALL answers in this group use a natural interrogative frame with complex embedded question, 10-13 words.
The question frame stays simple. Hardness comes from the embedded clause.
Examples:
- "Could you tell me how the project team managed to finish ahead of schedule?"
- "Do you know why the final report had not been submitted yet?"
Hard MUST come from embedded grammar: tense/aspect mismatch, passive/perfect inside clause, layered embedding.
Distractor: morphological variant (e.g. "decided/decide", "managed/manage").
PREFILLED REMINDER: Hard sentences are 10-13 words — effective chunks MUST still be ≤ 8. Give the SUBJECT as prefilled: bare pronoun "she"/"he"/"they" (most common in TPO) or 2-word NP "the professor" — both are valid. "i" for 1st-person only. Target R=7-9. If R>9, add a multi-word chunk or shorten the sentence. Difficulty comes from GRAMMAR STRUCTURE, not from chunk count.`,
  },

  "direct": {
    medium: `ALL answers in this group: direct declarative statement (no reporting verb, no negation), 9-12 words.
Describe a situation, location, preference, or fact.
Examples:
- "I found the work environment at this company to be much more relaxed."
- "The store next to the post office sells all types of winter apparel."
Prompt: prompt_task_kind="respond", prompt_task_text="What do you say?" or "What do you say about it?"
Distractor: morphological variant (e.g. "relaxed/relax", "sells/sold").
PREFILLED (medium): use the SUBJECT as prefilled. 1st-person: ["i"]. 3rd-person: bare pronoun "she"/"he" or 2-word NP ["the store"]. Mid-sentence also valid: ["in town"], ["the post office"]. NOT the object.`,

    hard: `ALL answers in this group: complex direct statement, 10-13 words, with comparative or structurally dense modification.
Examples:
- "This coffee tastes better than all of the other brands I have tried."
- "I found it in the back of the furniture section at the local superstore."
Prefer comparative/superlative structures, dense modifiers, or other learner-unfamiliar grammar. Do not inflate difficulty by length alone.
Distractor: morphological variant or comparative swap ("better/good", "only/once").
PREFILLED REMINDER: Hard sentences are 10-13 words — effective chunks MUST still be ≤ 8. Give the SUBJECT as prefilled: bare pronoun "she"/"he"/"they" (most common in TPO) or 2-word NP "the professor" — both are valid. "i" for 1st-person only. Target R=7-9. If R>9, add a multi-word chunk or shorten the sentence. Difficulty comes from GRAMMAR STRUCTURE, not from chunk count.`,
  },

  "relative": {
    medium: `ALL answers in this group: contact/relative clause structure, 9-12 words.
"The [noun] [I/you] [verb]..." (contact clause - omitted relative pronoun)
Examples:
- "The bookstore I stopped by had the novel in stock."
- "The diner that opened last week serves many delicious entrees."
Prompt: prompt_task_kind="respond", prompt_task_text="What do you tell your friend?" or "What do you say about it?"
Distractor: morphological variant (e.g. "stopped/stop", "opened/open").
PREFILLED (medium): use the SUBJECT as prefilled. Contact clause: 2-word subject NP like ["the bookstore"], ["the diner"], or mid-sentence anchor ["that opened"], ["in town"]. NOT the object inside the relative clause.`,

    hard: `ALL answers in this group: relative/contact clause with additional complexity, 10-13 words.
Combine relative clause with passive or perfect:
- "The desk you ordered is scheduled to arrive on Friday."
- "The book she recommended had already been checked out."
Distractor: morphological variant (e.g. "ordered/order", "recommended/recommend").
PREFILLED REMINDER: Hard sentences are 10-13 words — effective chunks MUST still be ≤ 8. Give the SUBJECT as prefilled: bare pronoun "she"/"he"/"they" (most common in TPO) or 2-word NP "the professor" — both are valid. "i" for 1st-person only. Target R=7-9. If R>9, add a multi-word chunk or shorten the sentence. Difficulty comes from GRAMMAR STRUCTURE, not from chunk count.`,
  },
};

// ── Prompt builder functions ─────────────────────────────────────────────────

function buildGeneratePrompt(round, spec, rejectFeedback = "", recentTopics = []) {
  const totalCount = spec.reduce((s, x) => s + x.count, 0);

  const pickedScenarios = shuffle(SCENARIO_POOL).slice(0, 3).join("; ");
  const pickedPersonas = shuffle(PERSONA_POOL).slice(0, 5).join(", ");

  let qIndex = 1;
  const groupSections = spec.map((item, i) => {
    const { type, difficulty, count } = item;
    const hints = (TYPE_DIFFICULTY_HINTS[type] || {})[difficulty] || "";
    const diffSpec = difficulty === "easy"
      ? "Answer length: 7-10 words. Chunks: 5-6."
      : difficulty === "medium"
      ? "Answer length: 10-13 words. Chunks: 6-7."
      : "Answer length: usually 10-13 words. Chunks: 6-8. MUST be hard because of advanced grammar structure: e.g. passive, past perfect, relative/contact clause, whom, comparative/superlative, or multi-layer embedding. Do NOT make an item hard by length alone.";
    const ids = Array.from({ length: count }, (_, j) => `tmp_r${round}_q${qIndex + j}`).join(", ");
    qIndex += count;
    return `### GROUP ${i + 1}: ${count} item${count > 1 ? "s" : ""} — ${type.toUpperCase()} / ${difficulty.toUpperCase()}
IDs: ${ids}
${hints}
${diffSpec}
prompt_task_kind: use ask, report, or respond (your choice — vary across the batch).`;
  }).join("\n\n");

  return `You are a TOEFL iBT Writing Task 1 "Build a Sentence" content architect.
Return ONLY a JSON array with exactly ${totalCount} objects.

## ⛔ TOP REJECTION CAUSES — READ FIRST:
These 5 errors cause >60% of all rejections. Check EVERY item against them:
1. DISTRACTOR = ONE WORD ONLY. "did" ✓ "did submit" ✗ "was not" ✗. Multi-word distractors are auto-rejected.
2. NO STANDALONE ADVERBS as chunks. "yesterday"/"today"/"tomorrow"/"recently"/"already"/"finally"/"usually" MUST be bound to verb: "discussed yesterday" ✓ "yesterday" alone ✗.
3. PREFILLED = subject NP or "i". NEVER bare "he"/"she"/"they". Use "the professor"/"the manager"/"the student". Max 3 words.
4. NEGATION = ONE CHUNK. "did not" ✓ ["did","not"] ✗. Always merge aux+not.
5. DISTRACTOR MUST NOT create valid alternative. If inserting the distractor still produces a grammatical sentence, choose a different distractor.
6. DISTRACTOR MUST NOT be an auxiliary/be-verb/modal swap of a word already in the answer. These are AUTO-REJECTED:
   ✗ distractor="is" when answer has "was"  ✗ distractor="was" when answer has "were"
   ✗ distractor="do" when answer has "did"  ✗ distractor="does" when answer has "did"
   ✗ distractor="will" when answer has "would"  ✗ distractor="can" when answer has "could"
   ✗ distractor="have" when answer has "had"  ✗ distractor="has" when answer has "have"
   Regular verb morphological variants ARE encouraged as distractors, BUT ONLY when the substitution produces an UNGRAMMATICAL sentence:
   ✓ answer="did not cancel the meeting" → distractor="canceled" → "did not canceled" = UNGRAMMATICAL → SAFE
   ✓ answer="the cafe that opened last week" → distractor="open" → "the cafe that open last week" = UNGRAMMATICAL → SAFE
   ✓ answer="The garden opens every morning" → distractor="open" → "The garden open" = UNGRAMMATICAL (3sg agreement) → SAFE
   ✗ answer="The store sells fresh produce" → distractor="sold" → "The store sold fresh produce" = GRAMMATICAL → REJECTED!
   ✗ answer="I found it behind the center" → distractor="find" → "I find it behind the center" = GRAMMATICAL → REJECTED!
   ✗ answer="She walks through the park" → distractor="walked" → "She walked through the park" = GRAMMATICAL → REJECTED!
   RULE: In simple declarative sentences (no auxiliary, no negation, no relative clause), swapping present↔past tense almost always produces a GRAMMATICAL alternative. Use a DIFFERENT word class or unrelated form instead.
   SAFE distractor patterns: base form after auxiliary ("did not finished"), wrong agreement ("The shop offer"), different part of speech.

## CORE MISSION:
Generate high-quality conversational sentences. Focus on natural language flow.

## DISTRACTOR ANNOTATION RULES (CRITICAL):
For each item, set "has_distractor" to true/false based on these TPO rules:
1. Set "has_distractor": false ONLY when:
   - Simple Negation: basic negative statement < 9 words.
   - High Complexity: 3+ nested grammar points (e.g. Embedded + Passive + Perfect).
   - Contact Clause: relative pronoun is omitted.
2. Set "has_distractor": true for ALL other cases (~80-90% of batch).
3. A distractor is INVALID if inserting it can still produce a grammatical or semantically plausible answer. Distractors must break the tested grammar point, not act like another acceptable chunk.

## VERB DIVERSITY:
DO NOT use the same reporting verb (e.g., "wanted to know") more than twice in this batch.
BANNED overused frames (auto-rejected if >2 per batch): "wanted to know", "needed to find out", "was not sure".
Use varied alternatives: inquired, wondered, asked, was curious, could not recall, had no idea, was eager to learn, found out, realized, discovered, noticed, remembered, forgot, confirmed, checked, mentioned, explained, pointed out, reminded, clarified.

## DISTRACTOR VARIETY:
At least 50% of distractors must use NON-MORPHOLOGICAL strategies:
  ✓ Wrong preposition: "in" vs "on", "at" vs "to"
  ✓ Confusable pair: "affect" vs "effect", "advice" vs "advise"
  ✓ Semantic near-miss: "borrow" vs "lend", "bring" vs "take"
  ✓ Wrong word form class: noun instead of verb, adjective instead of adverb
  ✗ Avoid: just changing tense of the main verb for >50% of items.

## CONTRACTION SUPPORT:
For negation sentences, 30-50% should use contractions:
  ✓ "didn't understand" as a SINGLE chunk
  ✓ "couldn't find" as a SINGLE chunk
  ✓ "hasn't arrived" as a SINGLE chunk
  Contractions count as single tokens. The apostrophe stays inside the chunk.

## ARTICLE CHUNKING RULE:
NO STANDALONE ARTICLES as chunks. "the", "a", "an" must ALWAYS be merged with their noun:
  ✓ "the library" as one chunk  ✗ ["the", "library"] as separate chunks
  ✓ "a neighbor" as one chunk   ✗ ["a", "neighbor"] as separate chunks
  Standalone articles will be AUTOMATICALLY MERGED by post-processing.

## INTERROGATIVE FRAME DIVERSITY:
- If this batch includes interrogative items, vary the polite opener naturally.
- Do NOT repeat the exact same interrogative opener more than twice in one batch.
- Prefer a small natural family such as "Can you tell me ...", "Could you tell me ...", "Do you know ...", "Would you mind telling me ...", "Can you remind me ...".
- Do NOT use long, theatrical, or overly formal lead-ins just to create fake variety.
- The opener should stay short; the tested difficulty should come from the embedded clause.

## SCENARIO & PERSONA CONTEXT:
- Scenarios: ${pickedScenarios}
- Personas: ${pickedPersonas}
${recentTopics.length > 0 ? `
## TOPIC DIVERSITY — AVOID THESE RECENTLY USED SCENARIOS:
The following topics/scenarios were already used in the current batch. Choose DIFFERENT settings, characters, and situations for this round:
${recentTopics.map((t, i) => `${i + 1}. ${t}`).join("\n")}
Pick fresh scenarios: different location, different relationship, different activity. Do NOT recycle the same topic even with different wording.
` : ""}
${groupSections}

## WARNING — PREFILLED STRATEGY HAS CHANGED:
You may see older questions in context where prefilled=["not"] or prefilled=["the report"] (object noun phrase).
That is the OLD incorrect style. Do NOT imitate it.
CORRECT strategy: use the SUBJECT as prefilled.
  • 1st-person sentences (I did/asked/found...): prefilled=["i"]
  • 3rd-person sentences: ALWAYS a 2-word descriptive NP like ["the professor"], ["the manager"], ["the student"]
  • Interrogative (Could you.../Do you...): prefilled=["could you"] or ["do you"]
  • Negation "not" belongs in CHUNKS, NOT prefilled.
  • Bare pronouns ["he"], ["she"], ["they"] as prefilled — BANNED ✘ (auto-rejected)
    ALWAYS use descriptive NP: ["the professor"], ["the student"], ["some colleagues"].

## GIVEN WORD (PREFILLED) — CRITICAL CONCEPT:
In the real TOEFL exercise, 8-9 out of every 10 questions give the student one word or short phrase already placed in the sentence (a "given word"). This makes the task slightly easier.
- "prefilled": a phrase pre-placed for the student (shown on screen, not draggable)
- "prefilled_positions": its 0-based word index in the answer
- That phrase must be REMOVED from "chunks" — chunks covers only the draggable pieces
- TARGET: about 8-9 out of 10 items should have a non-empty prefilled (~85%, matching real TOEFL). prefilled=[] is acceptable ONLY for short sentences (≤8 words) with no natural subject anchor.
- Every output item must pass a strict WORD-BAG check:
  answer words = (chunks minus distractor) + prefilled words
  no missing words, no extra words, no duplicate coverage

WHAT TO USE AS PREFILLED (TPO authentic):
RULE: prefilled must appear EXACTLY ONCE in the answer.
RULE: Object noun phrases ("the library", "the report") belong in CHUNKS, NOT prefilled.
RULE: prefilled is ≤3 words maximum. A 4-word+ prefilled will be automatically rejected.

CRITICAL TPO DISTRIBUTION for prefilled WORD COUNT (must follow):
  - 1-word (55%): bare subject pronoun "i", "she", "he", "they" — this is the MOST COMMON in real TPO.
    Bare pronouns are ALLOWED and AUTHENTIC. Do NOT inflate to "the professor" when "she" is natural.
  - 2-word (25%): subject NP "the desk", "some colleagues", "this coffee", or verb phrase "found out", "he wants"
  - 3-word (12%): "wanted to know", "the post office", "you tell me", "the managers wanted"
  - No prefilled (8%): short or complex sentences where no anchor is natural — use prefilled=[]

CRITICAL TPO DISTRIBUTION for prefilled POSITION (must follow):
  - Position 0 / sentence start (55%): "i", "she", "the desk", "some colleagues" — subject at the beginning
  - Mid-sentence (30%): "wanted to know", "found out", "the post office", "in town", "when", "what" — embedded verb/phrase/wh-word
  - End of sentence (15%): "yet", "to me", "like that" — anchoring the sentence ending

In a batch of 10 with ~9 prefilled items: roughly 5 use 1-word bare pronouns, 2-3 use 2-word NPs, 1 uses 3-word phrase.
Position mix: ~5 at position 0, ~3 mid-sentence, ~1 at end.

## CHUNK GRANULARITY — CRITICAL:
Real TOEFL data: ~77% single-word chunks, ~23% multi-word. Target 5-6 effective chunks per item (TPO average: 5.8).

MANDATORY multi-word chunks — NEVER atomize these:
- Negation clusters:  "did not", "does not", "do not", "has not", "have not", "had not",
                      "is not", "was not", "were not", "will not", "would not", "could not", "should not"
  HARD RULE: NEVER split aux + not into separate chunks. ["did", "not"] = WRONG ✗. ["did not"] = RIGHT ✓.
- Infinitives:        "to know", "to find", "to check", "to finish", "to attend", "to make"
- Phrasal verbs:      "find out", "pick up", "carry out", "sign up"
- Aux + participle:   "had gone", "had been", "has been", "will be", "been extended", "is scheduled"
- Fixed collocations: "no idea", "what time", "on time", "in stock", "on Friday", "due to"
Target: 1 multi-word chunk per question from the list above. Allow 2 only for negation items that require "did not" etc.

SINGLE-WORD: subject pronouns (i/he/she/they), question words (where/when/if/whether),
standalone auxiliaries (did/was/were used alone — only when NOT followed by "not" in the answer).

THE KEY MATH: R = answer word count − prefilled word count.
- With 1-word prefilled (55% of items): R = answer_words - 1. For 10-word sentence, R=9.
- With 2-word prefilled (25%): R = answer_words - 2. For 10-word sentence, R=8.
- Target: 5-7 effective chunks (TPO avg 5.8). Easy/medium: ≤7 EC. Hard (10+ words): ≤8 EC.
- HARD RULE: R > 9 for easy/medium is too many — shorten or use longer prefilled.
- HARD RULE: prefilled must be ≤3 words. A 4-word+ prefilled will be REJECTED.
- HARD RULE: If R ≤5 (sentence too short): prefilled=[] is acceptable.
- Bare subject pronouns ("she", "he", "they") are ALLOWED and preferred over descriptive NPs for simplicity.

GOOD example (1st-person):
  answer: "I asked whether the library would close early." (8 words)
  prefilled=["i"] → R=7 → chunks=["asked","whether","the library","would","close","early","ask"]
  "the library" stays as a draggable multi-word chunk ✔

GOOD example (3rd-person, subject NP prefilled):
  answer: "The professor mentioned that the deadline had been extended." (9 words)
  prefilled=["the professor"] → R=7 → chunks=["mentioned","that","the deadline","had been","extended","extend"]
  Multi-word: "had been" ✔  Distractor: "extend" (form mismatch)

## UNIQUE-SOLUTION RULE — CRITICAL:
- Every item must have exactly ONE clearly best arrangement.
- Do NOT create items where the distractor can be inserted without obviously breaking grammar.
- Do NOT create items where adverbs, prepositional phrases, or reporting chunks can move around and still sound correct.
- If two arrangements could plausibly be accepted by a careful learner, the item is invalid.
- BAD ambiguous idea:
  chunks: ["he", "asked", "me", "yesterday", "why", "the store closed"]
  problem: "yesterday" may attach in multiple plausible positions.
- GOOD idea:
  use tighter structure chunks so only one order is grammatical, e.g. "asked me", "closed early", "on Friday".
- HARD RULE: NEVER isolate time/place/frequency adverbs as standalone single-word chunks.
  BANNED standalone chunks: "yesterday", "today", "tomorrow", "recently", "finally", "always", "often", "sometimes", "probably", "eventually", "suddenly", "already", "usually".
  Instead, BIND them to the verb they modify: "discussed yesterday", "arrived recently", "finished finally".
  Standalone adverbs will be AUTOMATICALLY REJECTED by the validation system.

HOW PREFILLED WORKS — four TPO-authentic pattern examples:

Pattern A (1st-person sentence, prefilled = subject pronoun "i"):
  answer:            "I asked whether the meeting had been canceled."  [8 words]
  prefilled:         ["i"]
  prefilled_positions: {"i": 0}
  R = 8 - 1 = 7
  chunks:            ["asked", "whether", "the meeting", "had been", "canceled", "cancel"]
  distractor:        "cancel"  (past perfect passive vs base form)
  word bag check:    asked(1)+whether(1)+the meeting(2)+had been(2)+canceled(1)=7 + i(1) = 8 ✓

Pattern B (3rd-person sentence, prefilled = 2-word subject NP "the manager"):
  answer:            "The manager wanted to know if the order was ready."  [10 words]
  prefilled:         ["the manager"]
  prefilled_positions: {"the manager": 0}
  R = 10 - 2 = 8
  chunks:            ["wanted", "to know", "if", "the order", "was", "ready", "prepare"]
  distractor:        "prepare"  (semantic decoy — wrong verb entirely)
  word bag check:    wanted(1)+to know(2)+if(1)+the order(2)+was(1)+ready(1)=8 + the manager(2) = 10 ✓
  NOTE: "is" as distractor would be AUTO-REJECTED (tense swap of "was").

Pattern C (interrogative, prefilled = opening frame "could you"):
  answer:            "Could you tell me what time the library closes?"  [9 words]
  prefilled:         ["could you"]
  prefilled_positions: {"could you": 0}
  R = 9 - 2 = 7
  chunks:            ["tell", "me", "what time", "the library", "closes", "close"]
  distractor:        "close"  (base form vs 3rd-person -s; different morphology of same verb)
  word bag check:    tell(1)+me(1)+what time(2)+the library(2)+closes(1)=7 + could you(2) = 9 ✓
  NOTE: "closed" as distractor would be risky (past tense swap). "close" (base form) is safer.

Pattern D (short sentence ≤8 words, prefilled=[]):
  answer:            "I did not submit the form on time."  [8 words]
  prefilled:         []
  R = 8 (all words draggable)
  chunks:            ["i", "did", "not", "submit", "the form", "on time", "submitted"]
  distractor:        "submitted"  (did not submit vs submitted — tense)
  word bag check:    i(1)+did(1)+not(1)+submit(1)+the form(2)+on time(2)=8 + []=0 → 8 ✓

## Schema:
{
  "id": "tmp_r${round}_q1",
  "has_distractor": boolean,
  "answer_type": "negation" | "3rd-reporting" | "1st-embedded" | "interrogative" | "direct" | "relative",
  "prompt_context": "" (MUST be empty string for every item)",
  "prompt_task_kind": "ask" | "report" | "respond" | "yesno" | "statement",
  "prompt_task_text": "ONE sentence only — ending with ? for ask/report/respond/yesno, or . for statement",
  "prompt": "optional; if provided, it must exactly match prompt_context + prompt_task_text rendered by the app",
  "answer": "full correct sentence (7-13 words)",
  "chunks": ["draggable1", "draggable2", "...and distractor if has_distractor=true"],
  "prefilled": ["pre-placed phrase"] or [],
  "prefilled_positions": {"pre-placed phrase": <0-based word index>} or {},
  "distractor": "wrong-form word" or null,
  "has_question_mark": true or false,
  "grammar_points": ["tag1", "tag2"]
}

## PROMPT CONTRACT - CRITICAL:

### TPO AUTHENTIC STYLE — 4 PROMPT TYPES:
Real TOEFL Build-a-Sentence prompts use 4 types. ALL use single-sentence style with prompt_context = "".

#### TYPE 1: ask/report (target: 3 out of 10)
  "What did X ask/say/mention/want to know/wonder/discover/find out?"
  The answer is indirect/embedded speech.
  TPO: "What did the job recruiter ask you?" → "She wanted to know what I do in my current position."
       "What did Julian ask about your trip to the mountains?" → "He wanted to know what I liked best about it."

#### TYPE 2: respond (target: 3 out of 10)
  "How do you respond?" / "What do you say?" / "What does X tell Y?"
  The answer is your reply to a situation.
  TPO: "How do you respond to the shop owner?" → "I have not received the package that was supposed to arrive."
       "Where did you find your phone?" → "I retraced all of the steps that I took last night."

### PROMPT FIELDS:
- "prompt_context" = ALWAYS empty string ""
- "prompt_task_kind" = ask | report | respond (generator only uses these 3; yesno/statement are added post-assembly)
- "prompt_task_text" = the EXPLICIT prompt shown to the user (required, never empty)
- The visible prompt is just prompt_task_text (prompt_context is always "")

prompt_task_text validation rules (auto-rejected otherwise):
  - ask/report: starts with "What did/does [person] ask/want/say/mention/find out/discover/learn/wonder?"
  - respond:    starts with "How do you respond?" / "What do you say?" / "Where/Why/When did you...?"

${rejectFeedback}
## FINAL CHECKLIST — VERIFY BEFORE OUTPUT:
1. WORD BAG: chunks (minus distractor) + prefilled words must equal EXACTLY the words in answer — no extras, no missing. Verify every item.
2. DISTRACTOR: The distractor word must NOT appear anywhere in the answer string.
3. PREFILLED COUNT: Count your non-empty prefilled items. You MUST have 8-9 items with prefilled in this batch. If you have fewer than 8, go back and add prefilled (subject pronoun or subject NP) to more items before outputting.
4. PREFILLED CORRECTNESS: The prefilled word/phrase must appear EXACTLY in the answer string, at the stated index. Remove it from chunks — never include it in both prefilled and chunks. chunks + prefilled reconstruct the answer exactly once.
5. CHUNK GRANULARITY & R-VALUE: R = answer_words − prefilled_words. Target R=7-8 (yields 5-6 effective chunks). prefilled is ≤3 words max (4-word+ = REJECTED). Object noun phrases belong in CHUNKS, not prefilled. 1-2 multi-word chunks per question (up to 3 for hard 10+ word sentences): infinitives ("to know"), phrasal verbs ("find out"), aux+participle ("had been"). Easy/medium: max 7 effective chunks. Hard: max 8.
   NEGATION RULE: aux+not is ALWAYS one chunk. ["did not"] ✓  ["did","not"] ✗. Scan every negation item before output.
6. VERB DIVERSITY: No single reporting verb may appear more than twice in this batch.
7. HARD DIFFICULTY: Hard items must be justified by advanced grammar signals, not by extra words. Valid hard signals include passive/passive-progressive, past perfect, relative/contact clause, whom, comparative/superlative, or multi-layer embedding.
8. UNIQUE SOLUTION: Reject any item in your own internal check if the distractor could still fit grammatically or if more than one chunk order seems plausible.
9. INTERROGATIVE QUALITY: For interrogative items, the answer MUST be a direct question ending with "?". Use a polite frame ("Can you tell me...", "Do you know...", "Could you explain..."). Vary the opener across the batch. The embedded clause stays in declarative order. prompt_task_kind MUST be "ask" for these items.
10. PROMPT STYLE: ALL items use prompt_context="". prompt_task_text MUST be a SINGLE sentence.
    WRONG ✗: prompt_task_text = "The student needed help with her paper. What did she ask the professor?"
    RIGHT ✓: prompt_task_text = "What did the student ask the professor about her paper?"
    Use ONLY these task kinds: ask, report, respond. "tell", "explain", "yesno", "statement" are not allowed at generation time.

Output JSON array only. No markdown.`.trim();
}

function buildTrapSpecialistPrompt(questions) {
  const itemsToTrap = questions.filter(q => q.has_distractor === true);

  return `You are a TOEFL iBT Writing Task 1 Trap Specialist.
Your goal is to add a single lowercase distractor word to items where "has_distractor" is true.

## THE TACTICAL PLAYBOOK (Apply based on grammar_points):
1. EMBEDDED QUESTIONS:
   - Preferred: Wh-word swap (e.g., where -> which, if -> that) OR Tense mismatch within the clause (e.g., goes -> went).
   - Fallback: Use "did/do" only if the clause verb is a simple base form.
2. RELATIVE/CONTACT CLAUSES:
   - Preferred: Relative pronoun swap (e.g., that -> which, who -> whom) OR Clause verb agreement.
   - NEVER use "did" for these items.
3. PERFECT/PASSIVE/PROGRESSIVE:
   - Mandatory: Use morphological variants (e.g., chosen -> chose, taking -> taken, built -> build).
   - NEVER use "did" for these items.
4. NEGATION:
   - Preferred: Verb form variant (e.g., attend -> attending) OR Modal swap (e.g., could -> can).

## PHILOSOPHY:
Search for the "Evil Twin" of a word in the sentence — a word that looks plausible but breaks the tested rule.
Keep "distractor": null for items where "has_distractor" is false.

## SAFETY CHECK:
- The distractor must NOT create another grammatical answer if inserted.
- The distractor must NOT behave like an optional modifier.
- If the sentence still sounds acceptable with the distractor inserted, choose a different distractor.

## INPUT ITEMS:
${JSON.stringify(questions, null, 2)}

## FINAL CHECK — VERIFY BEFORE OUTPUT:
- PASSIVE / PERFECT / PROGRESSIVE items: distractor MUST be a morphological variant (e.g., chosen→chose, taking→taken). NEVER "did" or "do".
- PASSIVE / PERFECT / PROGRESSIVE items: distractor MUST be a morphological variant. NEVER "did" or "do".
- RELATIVE / CONTACT CLAUSE items: use pronoun swap or verb agreement. NEVER "did".
- has_distractor=false items: distractor field must remain null.

Return ONLY a JSON array.`.trim();
}

function buildPlannerPrompt(poolState, difficultyTargets, globalTypeTargets, typeList, styleTargets = null, targetTotal = 10) {
  const diffRows = ["easy", "medium", "hard"]
    .map((diff) => {
      const have = typeList.reduce((sum, type) => sum + ((poolState[diff] || {})[type] || 0), 0);
      const need = difficultyTargets?.[diff] || 0;
      return { diff, have, need, gap: Math.max(0, need - have) };
    })
    .sort((a, b) => b.gap - a.gap);

  const typeRows = typeList
    .map((type) => {
      const have = (poolState.typeTotals || {})[type] || 0;
      return { type, have };
    })
    .sort((a, b) => a.have - b.have);

  const diffLines = diffRows.map((r) =>
    `  ${r.diff.padEnd(8)} have=${String(r.have).padStart(3)}  need=${String(r.need).padStart(3)}  gap=${String(r.gap).padStart(3)}`
  );
  const typeLines = typeRows.map((r) => `  ${r.type.padEnd(16)} have=${String(r.have).padStart(3)}`);

  const style = poolState.style || { total: 0, embedded: 0, negation: 0, distractor: 0, qmark: 0 };
  const styleSection = styleTargets
    ? `

Style coverage needed to assemble the remaining target sets:
  embedded questions   have=${String(style.embedded).padStart(3)}  need>=${String(styleTargets.embeddedMin).padStart(3)}  gap=${String(Math.max(0, styleTargets.embeddedMin - style.embedded)).padStart(3)}
  negation items       have=${String(style.negation).padStart(3)}  need>=${String(styleTargets.negationMin).padStart(3)}  gap=${String(Math.max(0, styleTargets.negationMin - style.negation)).padStart(3)}
  distractor items     have=${String(style.distractor).padStart(3)}  need>=${String(styleTargets.distractorMin).padStart(3)}  gap=${String(Math.max(0, styleTargets.distractorMin - style.distractor)).padStart(3)}
  question-mark items  have=${String(style.qmark).padStart(3)}  max<=${String(styleTargets.qmarkMax).padStart(3)}
`
    : "";

  return `You are a TOEFL Build-a-Sentence generation planner.

Difficulty coverage needed for the remaining usable pool:
  difficulty have  need  gap
${diffLines.join("\n")}

Current type mix (SOFT diversity reference only; do not optimize this aggressively):
  type             have
${typeLines.join("\n")}
${styleSection}

Design the next generation batch (exactly ${targetTotal} questions total) to most efficiently improve near-term set assembly.
Rules:
- Sum of all count fields must equal exactly ${targetTotal}.
- First satisfy the largest difficulty gaps (easy / medium / hard), especially medium and hard.
- Prioritize what is most likely to help assemble the next one or two sets.
- Treat global type balance as a SOFT tie-breaker only. Do NOT optimize for global type quotas.
- Skip categories with no near-term assembly value unless needed to support style coverage.
- Prioritize style-feature shortages that can block final set assembly, especially non-embedded capacity, distractor coverage, and necessary negation coverage.
- If diversity conflicts with assembly repair, repair assembly first.
- Ensure the batch includes enough embedded-capable / negation-capable cells when those style gaps are positive.
- Minimum 1, maximum 8 questions per included cell.
- Valid types: negation, 3rd-reporting, 1st-embedded, interrogative, direct, relative
- Valid difficulties: easy, medium, hard
- Avoid over-producing any single type just to satisfy diversity.
- TPO type targets: negation ~20%, interrogative ~8%. HARD LIMIT: max 1 negation per batch (to prevent over-production). Include interrogative only when pool qmark ratio is below 8% — do NOT force interrogative in every batch.
- In boost mode, prioritize precision over breadth: target the single most blocking gap first.
- If all difficulty/style gaps are small, return a practical batch that still helps assemble the next set.

Return ONLY a JSON array. No markdown. No explanation.
[{"type":"...","difficulty":"...","count":N},...]`.trim();
}

function buildPromptReformatterPrompt(questions) {
  const items = questions.map(q => ({
    id: q.id,
    prompt_context: q.prompt_context || "",
    prompt_task_kind: q.prompt_task_kind || "",
    prompt_task_text: q.prompt_task_text || "",
  }));
  return `You are a TOEFL prompt style editor. Your ONLY job: rewrite prompts so that every item has a SINGLE self-contained sentence (question for ask/report/respond/yesno, declarative for statement).

## TWO CASES TO FIX:

### CASE 1: Separate context + short question
prompt_context is non-empty AND prompt_task_text is a short question → merge them.
Set prompt_context = "" and prompt_task_text = merged single question.

  IN:  context="The yoga instructor is speaking with a student about the schedule."
       task="What does she ask?"
  OUT: context=""
       task="What did the yoga instructor ask the student about the schedule?"

  IN:  context="A customer is at the front desk of a clothing store."
       task="What did the shop owner ask?"
  OUT: context=""
       task="What did the shop owner at the clothing store ask the customer?"

  IN:  context="Some colleagues are discussing a project deadline."
       task="What did they need to know?"
  OUT: context=""
       task="What did the colleagues need to know about the project deadline?"

### CASE 2: Multi-sentence prompt_task_text (context is already empty)
prompt_context is "" AND prompt_task_text contains 2+ sentences → collapse into one question.
Keep prompt_context = "" and rewrite prompt_task_text as a single question with context embedded.

  IN:  context=""
       task="The student was studying late for an exam. What did she want to know about the schedule?"
  OUT: context=""
       task="What did the student studying late for an exam want to know about the schedule?"

  IN:  context=""
       task="Your coworker is having trouble with the printer. What does he ask?"
  OUT: context=""
       task="What does your coworker ask about the printer problem?"

  IN:  context=""
       task="The manager called a meeting about the budget. What did she need to know?"
  OUT: context=""
       task="What did the manager need to know about the budget for the meeting?"

## DO NOT CHANGE:
- "tell" or "explain" items: leave BOTH fields exactly as-is.
- Items that already have a single self-contained question in prompt_task_text (context is "" and task is one sentence): return them unchanged.

## CONSTRAINTS:
- The output task_text MUST be ONE sentence. No period in the middle.
- The output task_text MUST be a natural, grammatical question (for ask/report/respond).
- Do NOT change the person, invent new details, or alter the grammar point being tested.
- Return ONLY a JSON array with objects containing: id, prompt_context, prompt_task_text.
- Do NOT include any other fields.

## ITEMS TO PROCESS:
${JSON.stringify(items, null, 2)}

Return ONLY a JSON array. No markdown.`.trim();
}

function buildReviewPrompt(questions) {
  return `
You are a strict TOEFL TPO item quality reviewer.
Review the Build a Sentence items and return ONLY JSON:
{
  "overall_score": 0-100,
  "blockers": ["critical issue..."],
  "question_scores": [
    {"id":"...", "score":0-100, "issues":["..."]}
  ]
}

Blockers (ONLY use for these critical issues — ALWAYS prefix with the item ID like "tmp_r1_q3: ..."):
- tmp_rN_qM: multiple valid chunk orders (ambiguous arrangement)
- tmp_rN_qM: grammar incorrect in the answer sentence
- tmp_rN_qM: distractor DIRECTLY replaces one word to form a valid sentence (SIMPLE substitution only — do NOT consider rearranging other chunks)
- tmp_rN_qM: prompt/answer mismatch (answer doesn't respond to prompt)
- tmp_rN_qM: indirect question clause uses inverted word order (MUST be declarative)
IMPORTANT: Each blocker must start with the specific item ID it applies to. Do NOT write batch-level blockers without item IDs.

DISTRACTOR BLOCKER RULE — READ VERY CAREFULLY (most common false-positive source):
A distractor is a blocker ONLY IF replacing exactly one word produces a FULLY GRAMMATICAL English sentence.
If the substitution is UNGRAMMATICAL in ANY way, it is NOT a blocker — it is a GOOD distractor.

CRITICAL: Verb morphology distractors (base↔past↔3sg) are almost always SAFE because:
- "did not" + past form = UNGRAMMATICAL (double past marking)
- base form in 3sg slot = UNGRAMMATICAL (subject-verb disagreement)
- past form in relative clause present = UNGRAMMATICAL (tense error)

Examples of NOT blockers (do NOT flag these):
✓ answer="did not finish the report", distractor="finished" → "did not finished" = UNGRAMMATICAL → GOOD distractor
✓ answer="did not receive feedback", distractor="received" → "did not received" = UNGRAMMATICAL → GOOD distractor
✓ answer="The garden opens every morning", distractor="open" → "The garden open every morning" = UNGRAMMATICAL (3sg) → GOOD distractor
✓ answer="the trail that opened last week", distractor="open" → "the trail that open last week" = UNGRAMMATICAL → GOOD distractor
✓ answer="The shop owner offered a discount", distractor="offer" → "The shop owner offer a discount" = UNGRAMMATICAL (3sg) → GOOD distractor

Examples of REAL blockers (DO flag these):
✗ answer="The trail winds through the forest", distractor="wound" → "The trail wound through the forest" = GRAMMATICAL → BLOCKER
✗ answer="I enjoy the class", distractor="enjoyed" → "I enjoyed the class" = GRAMMATICAL → BLOCKER
✗ answer="accepts my insurance", distractor="accepted" → "accepted my insurance" = GRAMMATICAL → BLOCKER

The test: mentally substitute the distractor. Read the full sentence. Is it grammatical? If NO → not a blocker. If YES → blocker.
Do NOT flag if it requires REARRANGING, REMOVING, or ADDING other chunks.

NOT blockers (deduct points instead):
- chunk composition style
- grammar_points label format
- scene variety
- distractor that requires chunk rearrangement to form valid sentence (deduct 2-3 points, not a blocker)

TPO-specific scoring:
- >=85 means production ready
- <78 means reject
- Verify that indirect questions use declarative word order (no auxiliary inversion)
- Deduct 3-5 points if answer is a direct question when the item type is NOT interrogative (interrogative items SHOULD have question-mark answers like "Can you tell me...?" or "Do you know...?")
- Deduct 3-5 points if an interrogative item uses a stiff, formulaic, or overlong polite opener
- Deduct 3-5 points if a batch of interrogative items repeats the same opener too often

Items:
${JSON.stringify(questions, null, 2)}
`.trim();
}

function buildConsistencyPrompt(questions) {
  return `
You are a TPO Build-a-Sentence auditor.
Evaluate each item against real TPO exam standards.

TPO key characteristics:
- 92% of answers are STATEMENTS (declarative sentences); ~8% are QUESTIONS (interrogative frames like "Can you tell me...?", "Do you know...?") — both are valid TPO formats
- 63% test indirect/embedded questions with declarative word order
- 88% have distractors, mainly extra single-word auxiliary verbs (did/do/does)
- ~77% of chunks are single words; multi-word chunks only for natural collocations
- Core test: "indirect questions do NOT invert" and distractor did/do tests this.
- Interrogative items (answer is a polite question) are a normal TPO pattern — do NOT penalize for being a question.

Return ONLY JSON:
{
  "overall_ets_similarity": 0-100,
  "overall_solvability": 0-100,
  "blockers": ["critical issue..."],
  "question_scores": [
    {"id":"...", "ets_similarity":0-100, "solvability":0-100, "issues":["..."]}
  ]
}

Blockers (ONLY for critical issues — ALWAYS prefix with the item ID like "tmp_r1_q3: ..."):
- tmp_rN_qM: clearly ambiguous order (multiple valid answers)
- tmp_rN_qM: ungrammatical answer
- tmp_rN_qM: distractor DIRECTLY replaces one word to form a valid sentence (simple 1:1 substitution ONLY)
- tmp_rN_qM: indirect question uses inverted word order
IMPORTANT: Each blocker must start with the specific item ID it applies to.

DISTRACTOR RULE — MOST COMMON FALSE POSITIVE:
Only flag as blocker if substituting the distractor for one word produces a FULLY GRAMMATICAL sentence.
Verb morphology distractors are almost always SAFE:
✓ "did not finished" = UNGRAMMATICAL → NOT a blocker (good distractor)
✓ "The shop offer a discount" = UNGRAMMATICAL (3sg agreement) → NOT a blocker
✗ "I enjoyed the class" replacing "I enjoy the class" = GRAMMATICAL → IS a blocker
The test: substitute, read the FULL sentence, check grammar. Ungrammatical = not a blocker.
Do NOT flag if it requires removing, adding, or rearranging other chunks — just deduct 2-3 points.

NOT blockers (reflect in score):
- chunk style, grammar labels, scene variety
- distractor that requires rearrangement to produce valid sentence

Items:
${JSON.stringify(questions, null, 2)}
`.trim();
}

function buildRejectFeedbackHints(rejectReasons) {
  const entries = Object.entries(rejectReasons || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  if (entries.length === 0) return "";

  const hints = [];
  entries.forEach(([reason]) => {
    const r = String(reason).toLowerCase();
    if (r.includes("chunks (minus distractor) + prefilled words")) {
      hints.push("Strictly ensure chunks(+prefilled) exactly reconstruct answer words, no missing or extra words.");
    }
    if (r.includes("effective chunks count")) {
      hints.push("Keep effective chunk count in the allowed range and avoid too few chunks.");
    }
    if (r.includes("must be at most 3 words")) {
      hints.push("Every chunk must be at most 3 words. Split long chunks.");
    }
    if (r.includes("distractor must not appear in answer")) {
      hints.push("Distractor tokens must never appear in answer.");
    }
    if (r.includes("distractor must be a single word")) {
      hints.push("CRITICAL: Distractor MUST be exactly ONE word (e.g. 'did', 'gone', 'open'). NEVER two words like 'did submit' or 'was not'. This is the #1 rejection cause.");
    }
    if (r.includes("question mark")) {
      hints.push("Maintain question/statement ratio within set-level target.");
    }
    if (r.includes("embedded")) {
      hints.push("Include 6-8 embedded-question items in DECLARATIVE form (not questions). Use wanted to know, asked, was curious. Ensure 7-9 items have single-word distractors.");
    }
    if (r.includes("floating adverb") || r.includes("isolated")) {
      hints.push("CRITICAL: NEVER use standalone time/frequency adverbs as single-word chunks. BANNED: yesterday, today, tomorrow, recently, already, finally, usually, always, often, sometimes. ALWAYS bind to verb: 'discussed yesterday', 'arrived recently', 'finished finally'.");
    }
    if (r.includes("banned bare word") || r.includes("bare pronoun")) {
      hints.push("CRITICAL: NEVER use bare pronouns he/she/they as prefilled. Use a 2-word descriptive subject NP: 'the professor', 'the manager', 'the student'. For 1st-person use 'i'.");
    }
    if (r.includes("negation must be a single chunk")) {
      hints.push("CRITICAL: Negation clusters MUST be ONE chunk: 'did not' ✓, ['did','not'] ✗. Always merge aux+not.");
    }
    if (r.includes("review:blocker") || r.includes("solvability")) {
      hints.push("Avoid ambiguous chunk order; each item should have one clearly best arrangement. Distractor must NOT create a valid alternative sentence.");
    }
    if (r.includes("prompt_task_text") || r.includes("prompt must include an explicit task")) {
      hints.push("prompt_task_text MUST be an explicit question, NOT background. Use ONLY ask/report/respond patterns such as 'What did [person] ask?', 'What did [person] want to know?', 'How do you respond?', or 'What do you say?'.");
    }
    if (r.includes("must be a single sentence")) {
      hints.push("prompt_task_text for ask/report/respond MUST be ONE sentence only. NEVER start with a background sentence. WRONG: 'A student is at the office. What did she ask?' RIGHT: 'What did the student at the registrar's office ask?'");
    }
    if (r.includes("prompt_task_kind")) {
      hints.push("Use ONLY these prompt_task_kind values: ask, report, respond. Do NOT use tell or explain.");
    }
    if (r.includes("prefilled too long")) {
      hints.push("Prefilled must be ≤3 words. Use 1-word 'i' or 2-word subject NP like 'the professor'. Never 4+ word phrases.");
    }
    if (r.includes("inverted word order") || r.includes("prompt/answer mismatch")) {
      hints.push("For 'What did X ask/want to know' prompts, the answer MUST be a DECLARATIVE statement (e.g. 'The manager wanted to know...'), NOT a question. Only interrogative-type items produce question answers.");
    }
  });

  const uniq = [...new Set(hints)];
  if (uniq.length === 0) return "";
  return `\nRecent rejection feedback (must fix):\n- ${uniq.join("\n- ")}\n`;
}

module.exports = {
  SCENARIO_POOL,
  PERSONA_POOL,
  TYPE_DIFFICULTY_HINTS,
  buildGeneratePrompt,
  buildTrapSpecialistPrompt,
  buildPlannerPrompt,
  buildPromptReformatterPrompt,
  buildReviewPrompt,
  buildConsistencyPrompt,
  buildRejectFeedbackHints,
};
