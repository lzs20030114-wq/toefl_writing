// Build-a-Sentence prompt builders. Extracted from scripts/appendBSSets.mjs so
// they can be imported by:
//   - scripts/appendBSSets.mjs (the DeepSeek-driven generation pipeline)
//   - scripts/print-bank-prompt.mjs (Claude routine reads the resolved prompt)
//
// Keep this file as the SINGLE SOURCE OF TRUTH for BS generation prompts.
// All distribution calibrations to real TPO live here.

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
  "answer": "the correct sentence to build (7-15 words, concentrated 9-13)",
  "chunks": ["lowercase chunk", "..."],
  "prefilled": ["word1"] or [],
  "prefilled_positions": {"word1": 0} or {},
  "distractor": null or "lowercase single-word distractor not in answer",
  "has_question_mark": true/false,
  "grammar_points": ["grammar point 1"]
}

## Difficulty distribution (TPO standard):
- 0-1 easy (7-9 words, 5-6 chunks, simple structure)
- 7-8 medium (9-13 words, 6-7 chunks, embedded question or negation)
- 2-3 hard (11-15 words, 7-8 chunks, multi-layer: indirect+passive+perfect / indirect+negation)

## 92% of answers are STATEMENTS (has_question_mark=false)
Indirect/embedded questions use DECLARATIVE word order (no inversion).

## Sentence type distribution (calibrated to 50 real TPO items: 44/22/24/2/4/4):
- Indirect/embedded questions: 4-5 items (wanted to know, asked if/whether/what, was curious, was wondering, found out, needed to know, was unable to figure out)
- Negation: 2 items (did not, have not, could not, no longer, have no idea, never)
- Other varied composition: 2-3 items — declarative structures combining specific time/place phrases, multi-clause constructions, complex prepositional phrases, conjoined predicates. NOT formulaic indirect questions.
- Relative clause: 0-1 items (with or without omitted relative pronoun)
- Comparative: 0-1 items ("more X than", "the same as", "as X as")
- Passive voice answer: 0-1 items ("was scheduled", "is stored", "has been moved")

The previous distribution (60-80% indirect-Q) was over-tuned. Real TPO has only ~44% indirect-Q. The remaining ~56% spans negation, varied structures, comparative, passive, and relative — DO NOT default to indirect-Q for "filler" items.

## Distractor rules:
- 88% of items have a distractor (single word only, never a phrase)
- Mainly: did, do, does (extra auxiliary to tempt direct-question word order)
- Distractor must NOT appear in answer

## Chunk rules (CRITICAL — must use MULTI-WORD semantic chunks, not single words):
- Effective chunk count (excluding distractor): 4-8, TARGET 5-7
- Each chunk max 3 words, all lowercase
- chunks (minus distractor) + prefilled = all answer words exactly
- Group adjacent words into a single chunk when they form a semantic unit. Examples of CORRECT chunking:
  Answer "She wanted to know if the lease included utilities."
  → chunks: ["she", "wanted to", "know if", "the lease", "included", "utilities"]   (6 chunks ✓)
  Answer "The desks are scheduled to be delivered by next Tuesday."
  → chunks: ["the desks", "are scheduled", "to be", "delivered", "by", "next Tuesday"]   (6 chunks ✓)
  Answer "He was not sure when the new shipment would arrive."
  → chunks: ["he", "was not", "sure", "when", "the new shipment", "would arrive"]   (6 chunks ✓)
- INCORRECT (do NOT split every word):
  ["she", "wanted", "to", "know", "if", "the", "lease", "included", "utilities"]   (9 single-word chunks ✗)

## Prompt patterns (calibrated to real TPO: 30/32/18/18%):
- "What did [Name] ask...?" — 3 items
- Other wh-questions ("Where/Why/When/How/Who did/do/are/were/will...?") — 3 items
- Yes/no questions ("Did/Are/Were/Can/Do/Have/Were you...?") — 2 items
- Statement openers (declarative context, NO question mark) — 2 items
  Examples: "Matthew loved the book you recommended.", "Your brother's explanation was confusing.", "I've got my interview tomorrow."

The previous prompt under-weighted wh-questions (10-20% but real TPO has 32%). DO NOT cluster on "What did X ask" — that pattern caps at 3 items per set.

Use diverse names: Matthew, Mariana, Julian, Alison, Emma, Professor Cho, Juan, Hector, Margot, Olivia, Angelina, Harold.

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
