// Build-a-Sentence prompt builders. Extracted from scripts/appendBSSets.mjs so
// they can be imported by:
//   - scripts/appendBSSets.mjs (the DeepSeek-driven generation pipeline)
//   - scripts/print-bank-prompt.mjs (Claude routine reads the resolved prompt)
//
// Keep this file as the SINGLE SOURCE OF TRUTH for BS generation prompts.
// All distribution calibrations to real TPO live here.
//
// 2026-05-29: numerical calibrations below MUST match PREFILLED_PROFILE in
// lib/questionBank/etsProfile.js. If you change one, change both.

export function genPrompt(round, existingAnswers = []) {
  const excluded = existingAnswers.length > 0
    ? `\n## CRITICAL: Do NOT reproduce any of these existing answer sentences (already in the bank):\n${existingAnswers.map(a => `- ${a}`).join("\n")}\nAll 10 new answers MUST be clearly different from the above.\n`
    : "";
  return `
You are a TOEFL iBT Writing Task 1 "Build a Sentence" item writer.
Return ONLY a JSON array with exactly 10 question objects.

Required schema for each item:
{
  "id": "tmp_r${round}_q1",
  "prompt": "conversational context sentence (5-15 words, ends with ? or .)",
  "answer": "the correct sentence to build (6-13 words, concentrated 8-10)",
  "chunks": ["lowercase chunk", "..."],
  "prefilled": ["word1"] or [],
  "prefilled_positions": {"word1": 0} or {},
  "distractor": null or "lowercase single-word distractor not in answer",
  "has_question_mark": true/false,
  "grammar_points": ["grammar point 1"]
}

## Difficulty distribution (realExam2026: 22% easy / 60% medium / 18% hard):
- 2 easy (5-8 words, 5 chunks, SIMPLE direct statement or question, NO embedded/
  negation/passive). ⚠️ The generator chronically under-produces easy items
  (~1% vs the 22% target) — you MUST include 2 genuinely simple short sentences.
- 6 medium (8-11 words, 6-7 chunks, one clear structure)
- 2 hard (11-14 words, 7-8 chunks, ONE complexity layer: indirect OR passive OR relative)
Answer length target: mean ~9 words (range 6-13, concentrated 8-10). Keep them tight.

## ~86% statements / ~14% questions
Indirect/embedded questions use DECLARATIVE word order (no inversion); DIRECT
questions use real inversion and end with "?".

## ⚠ COHERENCE RULE (the answer is the REPLY to the prompt — never break this):
When the ANSWER is a question (has_question_mark=true), the PROMPT must be a STATEMENT
or opener that naturally invites a question back — e.g. prompt "I'm thinking of joining
the service trip." → answer "Where do I sign up?". NEVER pair a question-answer with a
prompt that is itself a question, or with a "Tell me…" / "What did X say…" info-request:
the answer would just re-ask or ignore the prompt, which reads as obviously broken.
(Conversely, an info-request prompt like "What did the clerk say?" must be answered with
a STATEMENT that reports the info — "The textbook arrived this morning." — not a question.)

## Sentence type distribution (calibrated to 504 real 2026改后 items):
- Direct questions: 1-2 items (~14%), INCLUDING about 1 wh-question
  (What/Why/How/Where/Which...). has_question_mark=true, real inversion. Per the
  coherence rule above, give these a STATEMENT prompt to reply to.
- Indirect/embedded questions: ~2 items (~21%) (wanted to know, asked if/whether,
  was wondering, found out, needed to know). Declarative order. Do NOT default to
  this for filler items.
- Negation: ~1 item (~9%) (did not, have not, no longer, never).
- Statements / varied: the remaining ~5-6 items — specific time/place phrases,
  multi-clause, complex prepositional phrases, conjoined predicates; relative /
  comparative / passive 0-1 each.

The 2026改后 format uses FEWER indirect questions and negations than older TPO
(which ran ~44% indirect / ~20% negation) and MORE direct + wh questions. Target
the 2026 mix above: indirect ~21%, negation ~9%, direct questions ~14%.

## Register & topic — casual CAMPUS small-talk, NOT formal office (realExam2026)
- FIRST PERSON is common (~40% of answers): "I missed the class this morning.",
  "I haven't received any emails today." AVOID formal third-person office personas
  ("The store manager reported…", "The supervisor announced…") — real items do NOT
  read like a corporate memo. Both prompt and answer are two turns of friendly chat.
- Contractions are natural (~23%): don't, haven't, didn't, it's, I'm, can't.
- Topic: ~63% campus life (classes, assignments, due dates, dorms, library, clubs,
  professors, registration, fitness center) + daily/social (trips, tickets, coffee,
  a friend); almost NO corporate/office settings.
- Relative clauses are common (~18%, gen under-uses at ~3%): "the topic that has the
  new study report", "a professor who is an expert in the field".

## Distractor rules (calibrated to 60 real TPO items — VARIETY is mandatory):
- ~88% of items have a distractor; ~12% have none (distractor: null). Do NOT
  put a distractor on every single item.
- Single word only, never a phrase. Must NOT appear in the answer.
- The distractor is a TRAP — a word the student is tempted to place but that
  doesn't belong. Real TPO spreads distractors across these kinds:
  * Auxiliary verbs — the largest group, but SPREAD across the whole family:
    did, do, does, is, are, was, were, has, have, had, can, will, would, be.
    Pick the auxiliary that would tempt a WRONG word order or tense for THIS
    answer (e.g. answer "she wanted to know..." → distractor "did" tempts
    "did she want..."; answer "the desk is scheduled..." → distractor "was").
  * Morphological twin of a word that IS in the answer (~one in seven):
    answer has "took" → distractor "taken"; "go" → "going"; "stay" → "staying".
  * Negation twin (~one in twenty): answer uses "not" → distractor "no".
  * Occasionally a content word that fits the topic but has no slot.
- HARD VARIETY RULE: across the 10-item set, NO single distractor word may be
  used more than 3 times. "did" must NOT be the distractor for more than ~3 of
  10 items. Past batches collapsed to 70%+ "did" — that is the #1 failure mode
  to avoid. Aim for 6+ DISTINCT distractor words across the set.

## Chunk rules (calibrated to real TPO: ~6 chunks/item, ~77% are SINGLE words):
- Effective chunk count (excluding distractor): 5-8, TARGET 6 (real TPO mean 6.5).
  Recent batches drifted LOW (4-5 chunks) by over-bundling — push the count back up.
- DEFAULT to single-word chunks. Real TPO is ~77% single-word chunks, mean 1.3
  words/chunk. Most content words stand alone as their own chunk.
- Bundle adjacent words into ONE chunk ONLY when separating them would create a
  SECOND valid arrangement (i.e. to protect a unique solution) — never just to
  make chunks longer. Legitimate reasons to bundle:
  * fixed verb phrase that could otherwise reattach: "wanted to know", "was not"
  * article/determiner + noun when the noun could attach elsewhere: "the lease"
  * time/place adverbial: "next Tuesday", "last night"
- Each chunk max 3 words, all lowercase. chunks (minus distractor) + prefilled = answer words exactly.

Calibrated example — Answer "She wanted to know if the lease included utilities." (9 words)
  ✓ TPO-style (7 chunks, ~71% single): ["she", "wanted to", "know", "if", "the lease", "included", "utilities"]
  ✗ over-split (9 single words — creates ambiguous multi-solutions): ["she","wanted","to","know","if","the","lease","included","utilities"]
  ✗ over-bundled (4 chunks — too easy, this is our RECENT drift to avoid): ["she wanted to","know if the lease","included","utilities"]

## Prefilled rules (calibrated to 60 real TPO items — CRITICAL, do NOT default to subject-only)

### ⚡ THE #1 RULE — anchor a NON-subject word (verified against 60 TPO items)

The prefilled segment is the HINT word shown to the student. Measured fact:
82% of real TPO answers HAVE a person subject (he/she/I/they/a name), but
TPO gives that person as the prefilled hint only 30% of the time. The other
70% of the time, TPO HIDES the person subject inside the draggable chunks and
hints a NON-subject word instead (the verb phrase, a prepositional phrase, the
object noun, or a sentence-opener adverb).

So the key decision for EACH item: when your answer has a person subject,
DEFAULT to leaving that person ("he"/"she"/"Olivia") as a draggable CHUNK and
anchor something else as prefilled. Examples (same answer, TPO-style anchor):

  Answer: "she wanted to know whether the lab was open."
    ✓ TPO style:   prefilled ["wanted to know"]  (she is a chunk)
    ✓ TPO style:   prefilled ["whether"]          (she is a chunk)
    ✗ our old bug: prefilled ["she"]              (subject as hint — overused)

  Answer: "Olivia placed the spare keys inside the small drawer."
    ✓ TPO style:   prefilled ["inside the"] or ["the spare keys"]
    ✗ our old bug: prefilled ["Olivia"]

  Answer: "the package had not arrived before the holiday."
    ✓ TPO style:   prefilled ["the package"] (object/thing NP — fine, not a person)

HARD TARGET across the 10-item set:
- AT MOST 3 of 10 items may use a person (pronoun OR proper name) as the
  prefilled hint. (Real TPO = 30%.)
- The other 7+ must anchor a non-subject word: verb phrase, prep phrase,
  object/thing NP ("The desk", "The shipment"), adverb opener, or be empty.
- This is checked by the grader. A batch with >4 person-prefilled items is
  flagged low-diversity and sent back for retry.

Note: this does NOT mean fewer person SUBJECTS in answers — keep them (TPO is
82% person-subject). It means stop using the person as the prefilled HINT.

### Full distribution rules

Real TPO uses VARIED prefilled types and positions. Match this distribution across the 10-item set:

WHEN to use prefilled (presence ratio):
- 8-9 of 10 items have a prefilled segment.
- 1-2 of 10 items have an EMPTY prefilled array (\"prefilled\": [], \"prefilled_positions\": {}). This is required diversity; do not skip.

WORD-COUNT distribution per prefilled segment (target across the set, ~half should be 2+ words):
- 1-word (~40%): "I", "She", "He", "fun", "yet", "when"
- 2-word (~33%): "Some colleagues", "to me", "he tell", "Unfortunately I"
- 3-word (~10%): "the local superstore", "the post office"
- 4+ word (~17%): "at this company to", verb-phrase + adverbial combinations

WORD-TYPE distribution per prefilled segment — vary across ALL these 7 patterns:
- Subject pronoun (~30%): "I", "He", "She", "They", "We"
- Subject NP (~15%): "The desk", "Some colleagues", "Professor Cho", "This coffee"
- Sentence-opener adverb (~10%): "Unfortunately,", "Yes,", "Yet"
- Preposition / prep phrase (~13%): "to me", "in town", "the local superstore", "at this company to"
- Verb phrase (~13%): "wanted to know", "found out", "tell", "is", "needed"
- Mid-sentence noun/adjective (~13%): "fun", "weekends", "most", "quickly", "engagement"
- Conjunction or wh-word in middle (~6%): "when", "why", "what", "about"

POSITION variety:
- prefilled_positions can include positions OTHER than 0. Prefilled can be at the start, middle, or end of the answer sentence.
- About 30% of items with prefilled have TWO segments at different positions. Examples:
  Answer: "Unfortunately, I did not meet the deadline."
    → prefilled: ["Unfortunately,", "I"], prefilled_positions: {"unfortunately,": 0, "i": 1}
  Answer: "I do not go to the gym on weekends."
    → prefilled: ["I", "weekends"], prefilled_positions: {"i": 0, "weekends": 8}
- A batch of 10 should include AT LEAST 2 items with mid-sentence prefilled OR two-segment prefilled. Don't default to "single subject pronoun at position 0" for every item.

BAN: do NOT make all 10 items use subject-pronoun-only prefilled. The grader checks for type variety; uniform batches will be flagged low-diversity.

## Prompt patterns (题面问法 — calibrated to 50 real TPO items)

### ⚡ THE #1 RULE — the prompt SPEAKS TO the test-taker ("you"). Verified fact:
72% of real TPO prompts address the test-taker directly with "you/your". A BS
prompt is one turn of a CONVERSATION — something a person says TO you, and the
answer is the reply. Our recent batches dropped to ~10% "you" — third-person
scene reports ("What did Adrian ask about lunch?", "Where did the materials end
up?"). That is the regression to fix.

HARD TARGET: ~6-7 of every 10 prompts must contain "you" or "your" (real TPO
72%). Write them as if talking to the student:
  ✓ "Did you enjoy the workshop yesterday?"
  ✓ "Where did you find your phone?"
  ✓ "What did the recruiter ask you after the interview?"   (3rd party + "you")
  ✓ "Why did you decide to take that job?"
  ✓ "Are you going to the gym today?"
  ✗ "What did Adrian ask about lunch?"   (no "you" — detached 3rd-person report)
  ✗ "Where did the materials end up?"     (no "you")

### Opener-type mix (calibrated to TPO 36/24/18/18):
- "What did/does [Name or you]...?" — 3-4 items (TPO 36%). INCLUDE "you" often:
  "What did the professor ask you?". Do NOT exceed ~4/10 (recent batch hit 50%).
- Other wh- ("Where/Why/When/How did you...?") — 2-3 items (TPO 24%) — mostly "you".
- Yes/no ("Did you / Are you / Have you...?") — 2 items (TPO 18%) — "you".
- Statement openers (declarative, NO question mark) — 2 items (TPO 18%):
  "Matthew loved the book you recommended.", "I've got my interview tomorrow."
  ⚠ PAIRING: these statement-opener prompts are ALSO the ONLY home for your 1-2
  question-ANSWERS (the ~14% direct questions). A question-answer MUST reply to a
  statement, never to another question. So when an item's ANSWER is a question, its
  PROMPT must be one of these statement openers. Worked example:
    prompt "I just transferred here this semester." (statement)
    → answer "Where do I sign up for the writing center?" (question, has_question_mark=true) ✓
  WRONG: prompt "Where is the writing center?" → answer "Where do I sign up?" (two questions, rejected)

Use diverse names: Matthew, Mariana, Julian, Alison, Emma, Professor Cho, Juan, Hector, Margot, Olivia, Angelina, Harold. Names can appear AS the third party the test-taker is asked about ("What did Mariana ask you?") — keep the "you".

${excluded}

Self-check before returning:
1. chunks (minus distractor) + prefilled = answer words exactly
2. distractor not in answer, distractor is single word
3. prefilled_positions match actual word positions
4. exactly one valid arrangement exists
5. indirect questions use declarative word order

No markdown. JSON array only.
`.trim();
}

export function reviewPrompt(qs) {
  return `You are a strict TOEFL TPO item quality reviewer.
Return ONLY JSON: {"overall_score":0-100,"blockers":["..."],"question_scores":[{"id":"...","score":0-100,"issues":["..."]}]}
Blockers ONLY for: ambiguous order, ungrammatical answer, distractor valid in answer, inverted indirect question.
Items:\n${JSON.stringify(qs, null, 2)}`.trim();
}

export function consistencyPrompt(qs) {
  return `You are a TPO Build-a-Sentence auditor.
Return ONLY JSON: {"overall_ets_similarity":0-100,"overall_solvability":0-100,"blockers":["..."],"question_scores":[{"id":"...","ets_similarity":0-100,"solvability":0-100,"issues":["..."]}]}
Blockers ONLY for: ambiguous order, ungrammatical, distractor valid in answer, inverted indirect question.
Items:\n${JSON.stringify(qs, null, 2)}`.trim();
}
