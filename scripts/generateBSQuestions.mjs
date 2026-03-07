/**
 * Robust Build a Sentence generator pipeline:
 * 1) online candidate generation
 * 2) hard validation (schema/runtime)
 * 3) AI quality scoring filter
 * 4) pool-based set assembly with TPO difficulty mix (1/7/2)
 *
 * Usage:
 *   node scripts/generateBSQuestions.mjs
 *
 * Env:
 *   DEEPSEEK_API_KEY=...
 *   DEEPSEEK_PROXY_URL=http://127.0.0.1:10808   (optional)
 *   BS_TARGET_SETS=6                              (optional)
 *   BS_CANDIDATE_ROUNDS=40                        (optional)
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { callDeepSeekViaCurl, resolveProxyUrl, formatDeepSeekError } = require("../lib/ai/deepseekHttp.js");
const { validateQuestionSet, validateQuestion } = require("../lib/questionBank/buildSentenceSchema.js");
const { hardFailReasons, warnings: qualityWarnings } = require("../lib/questionBank/qualityGateBuildSentence.js");
const {
  normalizeRuntimeQuestion,
  validateRuntimeQuestion,
} = require("../lib/questionBank/runtimeModel.js");
const {
  estimateQuestionDifficulty,
  evaluateSetDifficultyAgainstTarget,
  ETS_2026_TARGET_COUNTS_10,
} = require("../lib/questionBank/difficultyControl.js");
const { isEmbeddedQuestion } = require("../lib/questionBank/etsProfile.js");
const { validateAllSets } = require("./validate-bank.js");

const OUTPUT_PATH = resolve(__dirname, "..", "data", "buildSentence", "questions.json");
const RESERVE_PATH = resolve(__dirname, "..", "data", "buildSentence", "reserve_pool.json");
const TARGET_SET_COUNT = Number(process.env.BS_TARGET_SETS || 6);
const CANDIDATE_ROUNDS = Number(process.env.BS_CANDIDATE_ROUNDS || 40);
const ADAPTIVE_BOOST_ROUNDS = Number(process.env.BS_ADAPTIVE_BOOST_ROUNDS || 80);
const MIN_REVIEW_SCORE = Number(process.env.BS_MIN_REVIEW_SCORE || 78);
const MIN_REVIEW_OVERALL = Number(process.env.BS_MIN_REVIEW_OVERALL || 84);
const MIN_ETS_SIMILARITY = Number(process.env.BS_MIN_ETS_SIMILARITY || 72);
const MIN_SOLVABILITY = Number(process.env.BS_MIN_SOLVABILITY || 78);

function loadEnv() {
  const paths = [
    resolve(__dirname, "..", ".env.local"),
    resolve(__dirname, "..", ".env"),
  ];
  for (const p of paths) {
    try {
      const txt = readFileSync(p, "utf8");
      txt.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
        if (!m) return;
        if (process.env[m[1]]) return;
        process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
      });
    } catch (_) {
      // ignore missing env file
    }
  }
}

function normalizeText(s) {
  return String(s || "").trim();
}

function endsWithQuestionMark(answer) {
  return normalizeText(answer).endsWith("?");
}

function uniqBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function parseJsonArray(text) {
  const body = String(text || "");
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error("no JSON array in model output");
  }
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Split a chunk that has more than maxWords into sub-chunks.
 * Strategy: split into ceil and floor halves to keep collocations natural.
 */
function autoSplitChunk(chunk, maxWords = 3) {
  const words = chunk.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [chunk];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

/**
 * Ensure effective chunk count is at least minCount by splitting longest chunks.
 */
function ensureMinChunkCount(chunks, distractor, minCount = 4) {
  let result = [...chunks];
  let maxIter = 10;
  while (maxIter-- > 0) {
    const effective = result.filter((c) => c !== distractor);
    if (effective.length >= minCount) break;
    // find longest effective chunk to split
    let longestIdx = -1;
    let longestLen = 0;
    result.forEach((c, i) => {
      if (c === distractor) return;
      const wLen = c.split(/\s+/).length;
      if (wLen > longestLen) { longestLen = wLen; longestIdx = i; }
    });
    if (longestIdx < 0 || longestLen < 2) break;
    const words = result[longestIdx].split(/\s+/);
    const mid = Math.ceil(words.length / 2);
    result.splice(longestIdx, 1, words.slice(0, mid).join(" "), words.slice(mid).join(" "));
  }
  return result;
}

function normalizeQuestion(raw, tempId) {
  const q = raw && typeof raw === "object" ? raw : {};

  // Fix 1: lowercase chunks and distractor BEFORE intermediate processing
  // so ensureMinChunkCount's `c !== distractor` comparison is always case-consistent.
  let chunks = Array.isArray(q.chunks)
    ? q.chunks.map((c) => normalizeText(c).toLowerCase()).filter(Boolean)
    : [];
  const prefilled = Array.isArray(q.prefilled)
    ? q.prefilled.map((c) => normalizeText(c)).filter(Boolean)
    : [];
  const rawPositions = (q.prefilled_positions && typeof q.prefilled_positions === "object" && !Array.isArray(q.prefilled_positions))
    ? q.prefilled_positions
    : {};

  const distractor = normalizeText(q.distractor)?.toLowerCase() || null;
  const answer = normalizeText(q.answer);
  const answerWords = answer.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);

  // Auto-fix: Split any chunk with >3 words
  chunks = chunks.flatMap((c) => autoSplitChunk(c, 3));

  // Auto-fix: Remove prefilled coverage from chunks.
  // AI often duplicates prefilled words into chunks in two ways:
  //   (a) exact phrase match: prefilled=["the report"], chunks includes "the report"
  //   (b) split words: prefilled=["the report"], chunks includes "the" and "report" separately
  // Strategy: greedily consume prefilled words from chunks (single-word first).
  if (prefilled.length > 0) {
    // Build a word-level budget of what prefilled covers
    const prefilledWordBudget = [];
    prefilled.forEach((pf) => {
      pf.toLowerCase().split(/\s+/).filter(Boolean).forEach((w) => prefilledWordBudget.push(w));
    });
    // Remove exact-phrase matches first
    const prefilledPhraseSet = new Set(prefilled.map((p) => p.toLowerCase()));
    chunks = chunks.filter((c) => !prefilledPhraseSet.has(c.toLowerCase()));
    // Then remove single-word chunks that are covered by the prefilled budget
    const budget = [...prefilledWordBudget];
    chunks = chunks.filter((c) => {
      const cWords = c.toLowerCase().split(/\s+/);
      if (cWords.length === 1) {
        const idx = budget.indexOf(cWords[0]);
        if (idx !== -1) { budget.splice(idx, 1); return false; }
      }
      return true;
    });
  }

  // Auto-fix: Ensure at least 4 effective chunks
  chunks = ensureMinChunkCount(chunks, distractor, 4);

  // Auto-fix: Correct prefilled_positions based on actual answer text.
  // Fix 2: fallback lookup is case-insensitive so AI key-case mismatches don't lose positions.
  const rawPositionsLower = Object.fromEntries(
    Object.entries(rawPositions).map(([k, v]) => [k.toLowerCase(), v])
  );
  const correctedPositions = {};
  prefilled.forEach((pf) => {
    const pfWords = pf.toLowerCase().replace(/[.,!?;:]/g, "").split(/\s+/).filter(Boolean);
    if (pfWords.length === 0) return;

    let found = false;
    for (let i = 0; i <= answerWords.length - pfWords.length; i++) {
      const slice = answerWords.slice(i, i + pfWords.length);
      if (slice.every((w, idx) => w === pfWords[idx])) {
        correctedPositions[pf] = i;
        found = true;
        break;
      }
    }
    // Fallback: case-insensitive key lookup on original AI-provided positions
    if (!found) {
      const fallback = rawPositionsLower[pf.toLowerCase()];
      if (fallback !== undefined) correctedPositions[pf] = fallback;
    }
  });

  // Auto-fix: drop any prefilled item that couldn't be located in the answer.
  // If AI invents a prefilled phrase not present in answer, discard it silently
  // (question becomes harder but word bag stays valid).
  const validPrefilled = prefilled.filter((pf) => correctedPositions[pf] !== undefined);

  return {
    id: normalizeText(q.id) || tempId,
    prompt: normalizeText(q.prompt),
    answer,
    chunks,
    prefilled: validPrefilled,
    prefilled_positions: correctedPositions,
    distractor,
    has_question_mark: endsWithQuestionMark(answer),
    grammar_points: Array.isArray(q.grammar_points)
      ? q.grammar_points.map((g) => normalizeText(g)).filter(Boolean)
      : [],
  };
}

function stableAnswerKey(q) {
  return normalizeText(q.answer).toLowerCase();
}

/**
 * Classify a question's answer into one of 6 TPO structural types.
 * Used for quota tracking and targeted generation.
 */
function classifyAnswerType(q) {
  const a = String(q.answer || "").toLowerCase();
  const gps = (Array.isArray(q?.grammar_points) ? q.grammar_points : []).map((x) => String(x || "").toLowerCase()).join(" | ");
  // Interrogative frame: answer starts with Can/Could you tell me
  if (/^(can you tell me|could you tell me)/i.test(q.answer)) return "interrogative";
  // 3rd-person reporting
  if (
    /\b(wanted to know|asked|inquired|was curious|were curious|needed to know|was wondering|were wondering|wants to know|needs to know|curious about)\b/.test(a) ||
    /\b(3rd-reporting|reporting verb|indirect question)\b/.test(gps)
  )
    return "3rd-reporting";
  // 1st-person embedded
  if (
    /\b(have no idea|had no idea|don't understand|didn't understand|couldn't understand|found out|would love to know|can't decide|don't know|didn't know|do not know|did not know|does not know)\b/.test(a) ||
    /\b(1st-embedded)\b/.test(gps)
  )
    return "1st-embedded";
  // Relative/contact clause
  if (
    /\bthe \w+.*(?: i | you | he | she | we | they )|\b(?:that|which|who|whom) (?:i |you |he |she |we |they )/i.test(a) ||
    /\b(relative clause|contact clause)\b/.test(gps)
  )
    return "relative";
  // Negation
  if (/\b(did not|didn't|have not|haven't|could not|couldn't|was not|wasn't|is not|isn't|am not|are not|aren't|has not|hasn't|do not|don't|no longer|not able|were not|weren't)\b/.test(a))
    return "negation";
  return "direct";
}

/**
 * Per-set quota: how many questions of each type × difficulty per 10-question set.
 * Derived from statistical analysis of 60 real TPO questions across 6 sets.
 * Difficulty distribution per set: easy=1, medium=7, hard=2.
 * Type distribution within each difficulty: from TPO analysis.
 *
 * easy  (1/set):  negation�?5%, 3rd-reporting�?8%, interrogative�?8%, 1st-embedded�?%
 * medium (7/set): 3rd-reporting�?8%, negation�?2%, 1st-embedded�?2%, interrogative�?%, direct�?%, relative�?%
 * hard  (2/set):  3rd-reporting�?5%, 1st-embedded�?5%, relative�?9%, interrogative�?3%, direct�?3%, negation�?%
 */
const TYPE_LIST = ["negation", "3rd-reporting", "1st-embedded", "interrogative", "direct", "relative"];
const TPO_TYPE_TARGET_RATIO = Object.freeze({
  "negation": 0.183,
  "3rd-reporting": 0.417,
  "1st-embedded": 0.15,
  "interrogative": 0.1,
  "direct": 0.067,
  "relative": 0.083,
});

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
    if (r.includes("question mark")) {
      hints.push("Maintain question/statement ratio within set-level target.");
    }
    if (r.includes("embedded")) {
      hints.push("Include 6-8 embedded-question items in DECLARATIVE form (not questions). Use wanted to know, asked, was curious. Ensure 7-9 items have single-word distractors.");
    }
    if (r.includes("review:blocker") || r.includes("solvability")) {
      hints.push("Avoid ambiguous chunk order; each item should have one clearly best arrangement.");
    }
  });

  const uniq = [...new Set(hints)];
  if (uniq.length === 0) return "";
  return `\nRecent rejection feedback (must fix):\n- ${uniq.join("\n- ")}\n`;
}

// Type × difficulty specific instructions for targeted generation
const TYPE_DIFFICULTY_HINTS = {
  "negation": {
    easy: `ALL answers in this group: simple negative statement, 7-10 words.
Structure: "I did not [verb]�? / "I could not [verb]�? / "I am not [adj]�? / "I have not [past-p] yet."
NO embedded questions. NO relative clauses. Direct and clear.
Prompt: YES/NO question ("Did you attend�?", "Have you�?", "Are you going�?")
Distractor: "did" or "do" or morphological variant (e.g. "going" for "go").`,
    medium: `ALL answers in this group: negative statement 9-12 words, optionally with short embedded element.
Examples:
- "Unfortunately, I could not attend due to a prior commitment."
- "I did not understand what the manager explained."
- "I have not received the workshop details yet."
Prompt: direct question or narrative context. Distractor: "did"/"do" or morphological variant.`,
    hard: `ALL answers in this group: negation + advanced grammar complexity, usually 10-13 words.
Examples:
- "I had not realized how quickly the project deadline was approaching."
- "I did not understand why the meeting had been postponed again."
Hard MUST be created by structure, not by extra length alone. Prefer past perfect negation, passive/passive-progressive inside the clause, or negation + embedded grammar traps. Hard MUST be created by structure, not by extra length alone. Prefer past perfect negation, passive/passive-progressive inside the clause, or negation + embedded grammar traps.
Distractor: morphological variant (e.g. "realized/realize", "approaching/approach").`,
  },
  "3rd-reporting": {
    easy: `ALL answers in this group: short third-person reporting, 8-10 words.
Structure: "[Name] wanted to know if [short clause]." / "[Name] asked me what time�?
Examples:
- "He wants to know if you need a ride."
- "She asked me what time the meeting starts."
Prompt: "What did [Name] ask/want?" Distractor: "did" or "do".`,
    medium: `ALL answers in this group: third-person reporting, 10-13 words.
Structure: "[Name/They] [wanted to know / asked / was curious / needed to know] [wh/if clause]"
Vary subjects: he / she / they / the manager / the professor / some colleagues
Vary wh-words across the batch: if(3), what(2), where(2), why(2), when(1)
Declarative word order in clause (NO inversion). Distractor: "did"/"do" for most.`,
    hard: `ALL answers in this group: third-person reporting with structurally complex embedded clause, usually 10-13 words.
Complexity options:
- Past perfect in clause: "He wanted to know where all the files had gone."
- Passive in clause: "She wanted to know when the report would be submitted."
- whom: "She wanted to know whom I would give the presentation to."
- Two-layer: "The manager wanted to know how we had been able to finish on time."
Hard MUST come from grammar complexity, not from padding the sentence. Hard MUST come from grammar complexity, not from padding the sentence.
Distractor: morphological variant or "whom/who", "where/when" function-word swap.`,
  },
  "1st-embedded": {
    easy: `ALL answers in this group: first-person "no idea" structure, 8-10 words.
Examples:
- "I have no idea where they are going."
- "I have no idea what time the event starts."
Prompt: direct question the speaker can't answer ("Do you know�?", "Where is�?")
Distractor: "do" or "did".`,
    medium: `ALL answers in this group: first-person embedded, 10-13 words.
Examples:
- "I don't understand why he decided to quit the team."
- "I found out where the new office supplies are kept."
- "I can't decide which project topic is the most important."
- "I have no idea who will be leading the committee."
Distractor: "did"/"does" or function-word variant.`,
    hard: `ALL answers in this group: complex first-person embedded, usually 10-13 words.
Examples:
- "I would love to know which restaurant you enjoyed the most." (superlative)
- "I have not been told who will be responsible for the final report." (passive + embedded)
- "We just found out where the new library equipment is being stored." (passive progressive)
Include passive voice OR superlative/comparative OR perfect aspect in the embedded clause. Hard MUST be signaled by grammar structure rather than answer length. Include passive voice OR superlative/comparative OR perfect aspect in the embedded clause. Hard MUST be signaled by grammar structure rather than answer length.
Distractor: morphological variant (e.g. "enjoyed/enjoy", "stored/store").`,
  },
  "interrogative": {
    easy: `ALL answers in this group use "Can you tell me�?" or "Could you tell me�?" frame, 8-11 words.
Examples:
- "Can you tell me what your plans are for tomorrow?"
- "Can you tell me if the professor covered any new material?"
Prompt: conversational comment that leads to a question.
Distractor: "did"/"do" or "can".`,
    medium: `ALL answers in this group use interrogative frame, 10-13 words, moderate embedded complexity.
Examples:
- "Could you tell me how you are feeling about the new policy?"
- "Can you tell me what you did not enjoy about the presentation?"
Distractor: morphological variant or "can"/"could" swap.`,
    hard: `ALL answers in this group use interrogative frame with complex embedded question, usually 10-13 words.
Examples:
- "Can you tell me why you decided to choose this particular research topic?"
- "Could you tell me how the project team managed to finish ahead of schedule?"
- "Did he ask you why you chose this particular career path?"
Hard MUST come from the embedded grammar challenge: tense/aspect mismatch risk, double-layer reporting, or other learner-unfamiliar clause structure. Do not make it hard just by adding length. Hard MUST come from the embedded grammar challenge: tense/aspect mismatch risk, double-layer reporting, or other learner-unfamiliar clause structure. Do not make it hard just by adding length.
Distractor: morphological variant (e.g. "decided/decide", "managed/manage").`,
  },
  "direct": {
    medium: `ALL answers in this group: direct declarative statement (no reporting verb, no negation), 9-12 words.
Describe a situation, location, preference, or fact.
Examples:
- "I found the work environment at this company to be much more relaxed."
- "The store next to the post office sells all types of winter apparel."
Prompt: direct question about what happened or what the speaker did.
Distractor: morphological variant (e.g. "relaxed/relax", "sells/sold").`,
    hard: `ALL answers in this group: complex direct statement, usually 10-13 words, with comparative or structurally dense modification.
Examples:
- "This coffee tastes better than all of the other brands I have tried."
- "I found it in the back of the furniture section at the local superstore."
- "The library is only temporarily closed in town for major structural renovations."
Prefer comparative/superlative structures, dense modifiers, or other learner-unfamiliar grammar. Do not inflate difficulty by length alone. Prefer comparative/superlative structures, dense modifiers, or other learner-unfamiliar grammar. Do not inflate difficulty by length alone.
Distractor: morphological variant or comparative swap ("better/good", "only/once").`,
  },
  "relative": {
    medium: `ALL answers in this group: contact/relative clause structure, 9-12 words.
"The [noun] [I/you] [verb]�? (contact clause �?omitted relative pronoun, object only)
Examples:
- "The bookstore I stopped by had the novel in stock."
- "The diner that opened last week serves many delicious entrees."
Prompt: question about where/what the speaker found.
Distractor: morphological variant (e.g. "stopped/stop", "opened/open").`,
    hard: `ALL answers in this group: relative/contact clause with additional complexity, usually 10-13 words.
Combine relative clause with:
- Passive: "The desk you ordered is scheduled to arrive on Friday."
- Comparative: "This coffee tastes better than all the other brands I've tried."
- Long modifier: "The store I found near the post office sells winter apparel at a discount."
Hard MUST come from the relative/contact-clause structure plus one extra grammatical challenge, not from sentence length alone. Hard MUST come from the relative/contact-clause structure plus one extra grammatical challenge, not from sentence length alone.
Distractor: passive helper swap or morphological variant ("scheduled/schedule", "ordered/order").`,
  },
};

const SCENARIO_POOL = [
  "Airport/Travel: check-in counter, flight delay, customs, tour guide",
  "Technology/Digital: software update, lost password, tech support, social media",
  "Home/Family: grocery shopping, home repair, neighbor interaction, cooking",
  "Leisure/Hobbies: local library, cinema, gym trainer, art gallery, bookstore",
  "Service/Retail: restaurant waiter, clothing store, post office, hair salon",
  "Education/Academic: student study group, campus cafe, registrar office, internship interview",
  "Health/Wellness: dental appointment, pharmacy, yoga class, medical clinic",
  "Nature/Environment: local park, botanical garden, weather forecast, hiking trail"
];

const PERSONA_POOL = [
  "The flight attendant", "A young architect", "The local librarian", "A frustrated customer",
  "The software developer", "An exchange student", "The elderly neighbor", "The yoga instructor",
  "A travel blogger", "The store clerk", "A delivery driver", "The project supervisor",
  "A volunteer", "The museum curator", "An enthusiastic intern", "The shop owner"
];

function buildGeneratePrompt(round, spec, rejectFeedback = "") {
  // spec: [{type, difficulty, count}, ...]
  const totalCount = spec.reduce((s, x) => s + x.count, 0);

  // Pick 3 random scenarios and 5 random personas to prime the AI
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
      : "Answer length: usually 10-13 words. Chunks: 6-8. MUST be hard because of advanced grammar structure: e.g. passive, past perfect, relative/contact clause, whom, comparative/superlative, or multi-layer embedding. Do NOT make an item hard by length alone. Answer length: usually 10-13 words. Chunks: 6-8. MUST be hard because of advanced grammar structure: e.g. passive, past perfect, relative/contact clause, whom, comparative/superlative, or multi-layer embedding. Do NOT make an item hard by length alone.";
    const ids = Array.from({ length: count }, (_, j) => `tmp_r${round}_q${qIndex + j}`).join(", ");
    qIndex += count;
    return `### GROUP ${i + 1}: ${count} item${count > 1 ? "s" : ""} �?${type.toUpperCase()} / ${difficulty.toUpperCase()}
IDs: ${ids}
${hints}
${diffSpec}`;
  }).join("\n\n");

  return `You are a TOEFL iBT Writing Task 1 "Build a Sentence" content architect.
Return ONLY a JSON array with exactly ${totalCount} objects.

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
Vary with: inquired, wondered, asked, was curious, needed to find out, was not sure.

## SCENARIO & PERSONA CONTEXT:
- Scenarios: ${pickedScenarios}
- Personas: ${pickedPersonas}

${groupSections}

## GIVEN WORD (PREFILLED) �?CRITICAL CONCEPT:
In the real TOEFL exercise, 6-7 out of every 10 questions give the student one word or short phrase already placed in the sentence (a "given word"). This makes the task slightly easier.
- "prefilled": a phrase pre-placed for the student (shown on screen, not draggable)
- "prefilled_positions": its 0-based word index in the answer
- That phrase must be REMOVED from "chunks" �?chunks covers only the draggable pieces
- 3-4 questions per batch have prefilled=[] (no given word, harder)
- Every output item must pass a strict WORD-BAG check:
  answer words = (chunks minus distractor) + prefilled words
  no missing words, no extra words, no duplicate coverage

## CHUNK GRANULARITY �?CRITICAL:
- Effective chunk count (excluding distractor) MUST be 4-8. Never output 9+ effective chunks.
- Do NOT split almost every word into a separate chunk.
- Prefer meaningful 2-3 word structure chunks when needed:
  - "wanted to know"
  - "had gone"
  - "would be submitted"
  - "the desk"
  - "on Friday"
- BAD over-split example:
  answer: "He wanted to know where all the accountants had gone."
  bad chunks: ["he", "wanted", "to", "know", "where", "all", "the accountants", "had", "gone"]  -> 9 effective chunks -> REJECT
- GOOD chunking example:
  answer: "He wanted to know where all the accountants had gone."
  good chunks: ["he", "wanted to know", "where", "all the accountants", "had gone"] -> 5 effective chunks -> ACCEPTABLE
- Another BAD over-split example:
  answer: "The desk you ordered is scheduled to arrive on Friday."
  bad chunks: ["the", "desk", "you", "ordered", "is", "scheduled", "to", "arrive", "on", "Friday"] -> 10 effective chunks -> REJECT
- GOOD chunking example:
  answer: "The desk you ordered is scheduled to arrive on Friday."
  good chunks: ["the desk", "you ordered", "is scheduled", "to arrive", "on Friday"] -> 5 effective chunks -> ACCEPTABLE

## UNIQUE-SOLUTION RULE �?CRITICAL:
- Every item must have exactly ONE clearly best arrangement.
- Do NOT create items where the distractor can be inserted without obviously breaking grammar.
- Do NOT create items where adverbs, prepositional phrases, or reporting chunks can move around and still sound correct.
- If two arrangements could plausibly be accepted by a careful learner, the item is invalid.
- BAD ambiguous idea:
  chunks: ["he", "asked", "me", "yesterday", "why", "the store closed"]
  problem: "yesterday" may attach in multiple plausible positions.
- GOOD idea:
  use tighter structure chunks so only one order is grammatical, e.g. "asked me", "closed early", "on Friday".

HOW PREFILLED WORKS �?two pattern examples:

Pattern A (negation, prefilled = single function word):
  answer:            "I did not finish the assignment on time."
  word indices:       I(0) did(1) not(2) finish(3) the(4) assignment(5) on(6) time(7)  �?8 words
  prefilled:         ["not"]
  prefilled_positions: {"not": 2}
  chunks:            ["I", "did", "finish", "the", "assignment", "on", "time", "never"]
  distractor:        "never"
  word bag check:    effective chunks = I+did+finish+the+assignment+on+time = 7 words
                     prefilled = not = 1 word  �? 7 + 1 = 8 �?
  chunk style:       all single-word �?distractor "never" is morphological trap (not vs never)

Pattern B (3rd-reporting, prefilled = noun phrase):
  answer:            "She asked whether the deadline had been extended."
  word indices:       She(0) asked(1) whether(2) the(3) deadline(4) had(5) been(6) extended(7)  �?8 words
  prefilled:         ["the deadline"]
  prefilled_positions: {"the deadline": 3}
  chunks:            ["she", "asked", "whether", "had", "been", "extended", "have"]
  distractor:        "have"
  word bag check:    effective chunks = she+asked+whether+had+been+extended = 6 words
                     prefilled = the+deadline = 2 words  �? 6 + 2 = 8 �?
  chunk style:       "the deadline" kept as unit (semantic noun phrase); all others single-word
                     distractor "have" is morphological trap (have vs had)

## Schema:
{
  "id": "tmp_r${round}_q1",
  "has_distractor": boolean,
  "answer_type": "negation" | "3rd-reporting" | "1st-embedded" | "interrogative" | "direct" | "relative",
  "prompt": "...",
  "answer": "full correct sentence (7-13 words)",
  "chunks": ["draggable1", "draggable2", "...and distractor if has_distractor=true"],
  "prefilled": ["pre-placed phrase"] or [],
  "prefilled_positions": {"pre-placed phrase": <0-based word index>} or {},
  "distractor": "wrong-form word" or null,
  "has_question_mark": true or false,
  "grammar_points": ["tag1", "tag2"]
}

${rejectFeedback}
## FINAL CHECKLIST �?VERIFY BEFORE OUTPUT:
1. WORD BAG: chunks (minus distractor) + prefilled words must equal EXACTLY the words in answer �?no extras, no missing. Verify every item.
2. DISTRACTOR: The distractor word must NOT appear anywhere in the answer string.
3. PREFILLED: Use prefilled when it serves as a natural fixed anchor, including in hard items when TPO-style phrasing supports it. The prefilled word/phrase must NOT appear in chunks �?remove it from chunks first. chunks + prefilled cover the answer exactly once.
4. CHUNK GRANULARITY: Effective chunk count (chunks minus distractor) MUST be 4-8. Never output 9+ effective chunks. If a sentence would exceed 8 chunks, merge words into natural structure chunks such as "wanted to know", "had gone", "the desk", "you ordered", "on Friday". Do NOT over-split almost every word into a separate chunk.
5. VERB DIVERSITY: No single reporting verb may appear more than twice in this batch.
6. HARD DIFFICULTY: Hard items must be justified by advanced grammar signals, not by extra words. Valid hard signals include passive/passive-progressive, past perfect, relative/contact clause, whom, comparative/superlative, or multi-layer embedding.
7. UNIQUE SOLUTION: Reject any item in your own internal check if the distractor could still fit grammatically or if more than one chunk order seems plausible.

Output JSON array only. No markdown.`.trim();
}

function buildTrapSpecialistPrompt(questions) {
  const itemsToTrap = questions.filter(q => q.has_distractor === true);
  const total = itemsToTrap.length;

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
   - Preferred: Verb form辨析 (e.g., attend -> attending) OR Modal swap (e.g., could -> can).

## PHILOSOPHY:
Search for the "Evil Twin" of a word in the sentence—a word that looks plausible but breaks the tested rule. 
Keep "distractor": null for items where "has_distractor" is false.

## SAFETY CHECK:
- The distractor must NOT create another grammatical answer if inserted.
- The distractor must NOT behave like an optional modifier.
- If the sentence still sounds acceptable with the distractor inserted, choose a different distractor.

## INPUT ITEMS:
${JSON.stringify(questions, null, 2)}

## FINAL CHECK �?VERIFY BEFORE OUTPUT:
- PASSIVE / PERFECT / PROGRESSIVE items: distractor MUST be a morphological variant (e.g., chosen→chose, taking→taken). NEVER "did" or "do".
- PASSIVE / PERFECT / PROGRESSIVE items: distractor MUST be a morphological variant. NEVER "did" or "do".
- RELATIVE / CONTACT CLAUSE items: use pronoun swap or verb agreement. NEVER "did".
- has_distractor=false items: distractor field must remain null.

Return ONLY a JSON array.`.trim();
}
/**
 * Brute-force check for multiple valid arrangements of chunks.
 * Only practical for small number of chunks (<= 8).
 */
function hasAmbiguousArrangements(q) {
  const effectiveChunks = q.chunks.filter(c => c !== q.distractor);
  if (effectiveChunks.length > 8) return false; // Too expensive to check exhaustively

  // Simple heuristic: if there are multiple adverbs or mobile prepositional phrases,
  // there's a higher risk. This is a placeholder for a more complex permutation check.
  // For now, we rely on the AI Reviewer for semantic ambiguity,
  // but we can catch exact word-order collisions here if we implement full permutations.
  return false; 
}

/**
 * Improved classification using the AI-provided answer_type, 
 * falling back to regex if missing.
 */
function getAnswerType(q) {
  if (q.answer_type && q.answer_type !== "unknown") return q.answer_type;
  return classifyAnswerType(q);
}

/**
 * Compute current pool type×difficulty counts plus style-feature coverage.
 */
function computePoolState(pool) {
  const state = {};
  for (const diff of ["easy", "medium", "hard"]) {
    state[diff] = {};
    for (const type of TYPE_LIST) {
      state[diff][type] = 0;
    }
  }
  state.typeTotals = Object.fromEntries(TYPE_LIST.map((type) => [type, 0]));
  state.style = {
    total: 0,
    embedded: 0,
    negation: 0,
    distractor: 0,
    qmark: 0,
  };
  for (const q of pool) {
    const meta = attachMeta(q)._meta || {};
    const type = meta.answerType || classifyAnswerType(q);
    const diff = (estimateQuestionDifficulty(q) || {}).bucket || "medium";
    if (state[diff] && type in state[diff]) {
      state[diff][type]++;
    }
    if (type in state.typeTotals) state.typeTotals[type] += 1;
    state.style.total += 1;
    if (meta.isEmbedded) state.style.embedded += 1;
    if (type === "negation") state.style.negation += 1;
    if (meta.hasDistractor) state.style.distractor += 1;
    if (meta.hasQuestionMark) state.style.qmark += 1;
  }
  return state;
}

/**
 * Build planner prompt: AI analyzes pool gaps and outputs a mixed batch spec.
 */
function chooseGapWeightedType(poolState, globalTypeTargets, candidates, fallback) {
  const totals = poolState?.typeTotals || {};
  const ranked = (Array.isArray(candidates) ? candidates : []).map((type) => ({
    type,
    gap: Math.max(0, (globalTypeTargets?.[type] || 0) - (totals[type] || 0)),
    have: totals[type] || 0,
  })).sort((a, b) => {
    if (b.gap !== a.gap) return b.gap - a.gap;
    return a.have - b.have;
  });
  return ranked[0]?.type || fallback;
}

function buildBoostBacklog(poolState, pool, difficultyTargets, globalTypeTargets, styleTargets) {
  const tasks = [];
  const pushTask = (task, repeat = 1) => {
    for (let i = 0; i < repeat; i += 1) tasks.push({ ...task });
  };
  const totals = poolState?.typeTotals || {};
  const diffTargets = difficultyTargets || {};
  const diffGaps = {
    easy: Math.max(0, (diffTargets.easy || 0) - (pool.easy?.length || 0)),
    medium: Math.max(0, (diffTargets.medium || 0) - (pool.medium?.length || 0)),
    hard: Math.max(0, (diffTargets.hard || 0) - (pool.hard?.length || 0)),
  };

  const perSetNeeds = ETS_2026_TARGET_COUNTS_10;
  const embeddedCounts = {
    easy: (pool.easy || []).filter((q) => q._meta?.isEmbedded).length,
    medium: (pool.medium || []).filter((q) => q._meta?.isEmbedded).length,
    hard: (pool.hard || []).filter((q) => q._meta?.isEmbedded).length,
  };
  const distractorCounts = {
    easy: (pool.easy || []).filter((q) => q._meta?.hasDistractor).length,
    medium: (pool.medium || []).filter((q) => q._meta?.hasDistractor).length,
    hard: (pool.hard || []).filter((q) => q._meta?.hasDistractor).length,
  };

  for (const diff of ['medium', 'hard', 'easy']) {
    const missing = Math.max(0, (perSetNeeds[diff] || 0) - Math.min(perSetNeeds[diff] || 0, embeddedCounts[diff] || 0));
    if (missing > 0) {
      pushTask({
        priority: 100,
        kind: 'assembly_embedded',
        type: chooseGapWeightedType(poolState, globalTypeTargets, diff === 'easy' ? ['3rd-reporting', '1st-embedded'] : ['1st-embedded', '3rd-reporting'], '1st-embedded'),
        difficulty: diff,
        hint: 'BOOST TARGET: generate exactly one embedded-capable item that helps the next set satisfy the embedded-question minimum. Avoid interrogative inversion errors. Prefer a safe single-word distractor if natural.',
      }, missing);
    }
  }

  for (const diff of ['medium', 'easy', 'hard']) {
    const missing = Math.max(0, (perSetNeeds[diff] || 0) - Math.min(perSetNeeds[diff] || 0, distractorCounts[diff] || 0));
    if (missing > 0) {
      pushTask({
        priority: 95,
        kind: 'assembly_distractor',
        type: chooseGapWeightedType(poolState, globalTypeTargets, diff === 'easy' ? ['3rd-reporting', 'negation'] : ['3rd-reporting', '1st-embedded', 'relative'], '3rd-reporting'),
        difficulty: diff,
        hint: 'BOOST TARGET: generate exactly one item with a valid single-word distractor. The distractor must not appear in the answer and must not create another valid sentence.',
      }, missing);
    }
  }

  for (const diff of ['medium', 'easy', 'hard']) {
    const gap = diffGaps[diff] || 0;
    if (gap > 0) {
      const fallback = diff === 'easy' ? 'negation' : diff === 'hard' ? '3rd-reporting' : '3rd-reporting';
      const candidates = diff === 'easy'
        ? ['negation', '3rd-reporting']
        : diff === 'hard'
        ? ['3rd-reporting', '1st-embedded', 'relative']
        : ['3rd-reporting', '1st-embedded', 'relative', 'negation'];
      pushTask({
        priority: 80,
        kind: 'difficulty_gap',
        type: chooseGapWeightedType(poolState, globalTypeTargets, candidates, fallback),
        difficulty: diff,
        hint: 'BOOST TARGET: generate exactly one ' + diff + ' item. Do not change the intended difficulty by using abnormal answer length; rely on the correct grammar profile.',
      }, gap);
    }
  }

  const style = poolState?.style || { embedded: 0, negation: 0, distractor: 0 };
  const embeddedGap = Math.max(0, (styleTargets?.embeddedMin || 0) - style.embedded);
  if (embeddedGap > 0) {
    pushTask({
      priority: 70,
      kind: 'style_embedded',
      type: chooseGapWeightedType(poolState, globalTypeTargets, ['1st-embedded', '3rd-reporting'], '1st-embedded'),
      difficulty: diffGaps.hard > 0 ? 'hard' : 'medium',
      hint: 'BOOST TARGET: generate exactly one embedded-question item with declarative word order inside the clause. Do not invert the embedded clause.',
    }, embeddedGap);
  }
  const negationGap = Math.max(0, (styleTargets?.negationMin || 0) - style.negation);
  if (negationGap > 0) {
    pushTask({
      priority: 68,
      kind: 'style_negation',
      type: 'negation',
      difficulty: diffGaps.hard > 0 ? 'hard' : 'medium',
      hint: 'BOOST TARGET: generate exactly one negation item. Verify the word bag carefully so every answer word is covered exactly once.',
    }, negationGap);
  }
  const distractorGap = Math.max(0, (styleTargets?.distractorMin || 0) - style.distractor);
  if (distractorGap > 0) {
    pushTask({
      priority: 66,
      kind: 'style_distractor',
      type: chooseGapWeightedType(poolState, globalTypeTargets, ['3rd-reporting', '1st-embedded', 'relative'], '3rd-reporting'),
      difficulty: 'medium',
      hint: 'BOOST TARGET: generate exactly one item with a safe single-word distractor. Avoid optional adverbs or words that could also fit the sentence.',
    }, distractorGap);
  }

  for (const type of TYPE_LIST) {
    const gap = Math.max(0, (globalTypeTargets?.[type] || 0) - (totals[type] || 0));
    if (gap <= 0) continue;
    if (type === 'interrogative') continue;
    pushTask({
      priority: type === '3rd-reporting' ? 60 : 55,
      kind: 'type_gap',
      type,
      difficulty: type === 'negation' ? 'medium' : type === 'relative' ? 'medium' : diffGaps.hard > 0 && type === '3rd-reporting' ? 'hard' : 'medium',
      hint: 'BOOST TARGET: generate exactly one ' + type + ' item that clearly matches its declared type and remains TPO-like.',
    }, gap);
  }

  return tasks.sort((a, b) => b.priority - a.priority);
}

function buildBoostTaskHint(task) {
  if (!task) return '';
  return [
    task.hint || '',
    'BOOST TASK TYPE: ' + task.type,
    'BOOST TASK DIFFICULTY: ' + task.difficulty,
    'Return exactly one item for this task. Do not hedge by mixing multiple target structures.',
  ].filter(Boolean).join('\n');
}

function buildBoostShortageRanking(poolState, pool, difficultyTargets, globalTypeTargets, styleTargets) {
  const shortages = [];
  const diffGaps = {
    easy: Math.max(0, (difficultyTargets?.easy || 0) - (pool?.easy?.length || 0)),
    medium: Math.max(0, (difficultyTargets?.medium || 0) - (pool?.medium?.length || 0)),
    hard: Math.max(0, (difficultyTargets?.hard || 0) - (pool?.hard?.length || 0)),
  };
  const style = poolState?.style || { embedded: 0, negation: 0, distractor: 0, qmark: 0 };
  const styleGaps = {
    embedded: Math.max(0, (styleTargets?.embeddedMin || 0) - style.embedded),
    negation: Math.max(0, (styleTargets?.negationMin || 0) - style.negation),
    distractor: Math.max(0, (styleTargets?.distractorMin || 0) - style.distractor),
  };
  const typeTotals = poolState?.typeTotals || Object.fromEntries(TYPE_LIST.map((type) => [type, 0]));
  const typeGaps = Object.fromEntries(
    TYPE_LIST.map((type) => [type, Math.max(0, (globalTypeTargets?.[type] || 0) - (typeTotals[type] || 0))]),
  );

  if (styleGaps.embedded > 0) {
    shortages.push({
      key: 'embedded',
      category: 'style',
      gap: styleGaps.embedded,
      priority: 100,
      guidance: 'Generate embedded-capable items only. Prefer 1st-embedded or interrogative. Use 3rd-reporting only if it clearly contains an indirect question clause.',
    });
  }
  if (styleGaps.negation > 0) {
    shortages.push({
      key: 'negation',
      category: 'style',
      gap: styleGaps.negation,
      priority: 95,
      guidance: 'Generate negation items only. Prefer medium negation unless the main difficulty gap is hard.',
    });
  }
  if (diffGaps.hard > 0) {
    shortages.push({
      key: 'hard',
      category: 'difficulty',
      gap: diffGaps.hard,
      priority: 90,
      guidance: 'Generate hard items only, and make them hard through advanced grammar rather than length.',
    });
  }
  if (diffGaps.medium > 0) {
    shortages.push({
      key: 'medium',
      category: 'difficulty',
      gap: diffGaps.medium,
      priority: 70,
      guidance: 'Generate medium items only. Do not spend this patch on easy or hard unless that is the blocking gap.',
    });
  }
  if (diffGaps.easy > 0) {
    shortages.push({
      key: 'easy',
      category: 'difficulty',
      gap: diffGaps.easy,
      priority: 60,
      guidance: 'Generate easy items only. Keep syntax simple and avoid over-engineering.',
    });
  }

  for (const [type, gap] of Object.entries(typeGaps)) {
    if (gap <= 0) continue;
    const priority = type === '3rd-reporting' ? 55 : type === 'direct' ? 25 : 45;
    shortages.push({
      key: type,
      category: 'type',
      gap,
      priority,
      guidance: 'Prefer ' + type + ' items when no higher-priority style or difficulty shortage is still open.',
    });
  }

  if (styleGaps.distractor > 0) {
    shortages.push({
      key: 'distractor',
      category: 'style',
      gap: styleGaps.distractor,
      priority: 20,
      guidance: 'Only use this as a secondary objective. Prefer item types that naturally support a safe single-word distractor.',
    });
  }

  return shortages.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.gap - a.gap;
  });
}

function determineBoostGoals(shortages, targetTotal = 3) {
  const ordered = Array.isArray(shortages) ? shortages : [];
  const primary = ordered[0] || null;
  let secondary = null;
  if (!primary || targetTotal <= 1) return { primary, secondary };

  const find = (predicate) => ordered.find((item, index) => index > 0 && predicate(item)) || null;

  if (primary.key === 'embedded') {
    secondary = find((item) => item.key === 'negation' || item.key === 'hard');
  } else if (primary.key === 'negation') {
    secondary = find((item) => item.key === 'embedded' || item.key === 'hard');
  } else if (primary.key === 'hard') {
    secondary = find((item) => item.key === 'embedded' || item.key === 'negation');
  } else if (primary.key === 'medium' || primary.key === 'easy') {
    secondary = find((item) => item.category === 'style');
  } else if (primary.category === 'type') {
    secondary = find((item) => item.category === 'style' || item.category === 'difficulty');
  } else {
    secondary = find((item) => item.category === 'style');
  }

  return { primary, secondary };
}

function getGoalAllowedTypes(goal) {
  if (!goal) return TYPE_LIST.slice();
  if (goal.key === 'embedded') return ['1st-embedded', 'interrogative', '3rd-reporting'];
  if (goal.key === 'negation') return ['negation'];
  if (goal.category === 'type') return [goal.key];
  return TYPE_LIST.slice();
}

function getGoalAllowedDifficulties(goal) {
  if (!goal) return ['easy', 'medium', 'hard'];
  if (goal.key === 'hard') return ['hard'];
  if (goal.key === 'medium') return ['medium'];
  if (goal.key === 'easy') return ['easy'];
  return ['easy', 'medium', 'hard'];
}

function buildBoostPlannerPrompt(poolState, pool, difficultyTargets, globalTypeTargets, styleTargets, targetTotal = 3, goals = null) {
  const shortages = buildBoostShortageRanking(poolState, pool, difficultyTargets, globalTypeTargets, styleTargets);
  const chosenGoals = goals || determineBoostGoals(shortages, targetTotal);
  const primary = chosenGoals?.primary || null;
  const secondary = chosenGoals?.secondary || null;
  const primaryTypes = getGoalAllowedTypes(primary);
  const primaryDifficulties = getGoalAllowedDifficulties(primary);
  const secondaryTypes = getGoalAllowedTypes(secondary);
  const secondaryDifficulties = getGoalAllowedDifficulties(secondary);

  const goalLines = [
    'Primary goal: ' + (primary ? (primary.category + ':' + primary.key + ' gap=' + primary.gap) : 'none'),
    'Secondary goal: ' + (secondary ? (secondary.category + ':' + secondary.key + ' gap=' + secondary.gap) : 'none'),
  ];

  return `You are a TOEFL Build-a-Sentence BOOST planner.

This is not a normal batch-planning task.
You are patching the pool with a tiny surgical batch to fix the single most blocking shortage.

Chosen goals:
${goalLines.join("\n")}

Allowed planning space:
- Primary allowed types: ${primaryTypes.join(', ')}
- Primary allowed difficulties: ${primaryDifficulties.join(', ')}
- Secondary allowed types: ${secondaryTypes.join(', ')}
- Secondary allowed difficulties: ${secondaryDifficulties.join(', ')}

Rules for this boost patch:
- Return a JSON array totaling exactly ${targetTotal} question(s).
- Use at most 2 cells. One cell is preferred.
- At least ${Math.max(1, targetTotal - (secondary ? 1 : 0))} question(s) must satisfy the primary goal.
- If you use a secondary cell at all, it must satisfy the secondary goal shown above.
- Do not plan any type or difficulty outside the allowed planning space.
- Do not try to balance the whole pool.
- Avoid direct items unless direct is explicitly listed in the chosen goals.
- Keep the patch precise. This is a repair batch, not a broad exploration batch.

Return ONLY a JSON array. No markdown. No explanation.
[{"type":"...","difficulty":"...","count":N}, ...]`.trim();
}

function buildPlannerPrompt(poolState, difficultyTargets, globalTypeTargets, styleTargets = null, targetTotal = 10, mode = "normal") {
  const diffRows = ["easy", "medium", "hard"]
    .map((diff) => {
      const have = TYPE_LIST.reduce((sum, type) => sum + ((poolState[diff] || {})[type] || 0), 0);
      const need = difficultyTargets?.[diff] || 0;
      return { diff, have, need, gap: Math.max(0, need - have) };
    })
    .sort((a, b) => b.gap - a.gap);

  const typeRows = TYPE_LIST
    .map((type) => {
      const have = (poolState.typeTotals || {})[type] || 0;
      const need = globalTypeTargets?.[type] || 0;
      return { type, have, need, gap: Math.max(0, need - have) };
    })
    .sort((a, b) => b.gap - a.gap);

  const diffLines = diffRows.map((r) =>
    `  ${r.diff.padEnd(8)} have=${String(r.have).padStart(3)}  need=${String(r.need).padStart(3)}  gap=${String(r.gap).padStart(3)}`
  );
  const typeLines = typeRows.map((r) =>
    `  ${r.type.padEnd(16)} have=${String(r.have).padStart(3)}  need=${String(r.need).padStart(3)}  gap=${String(r.gap).padStart(3)}`
  );

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

Difficulty coverage needed for the whole pool:
  difficulty have  need  gap
${diffLines.join("\n")}

Global type coverage needed for the whole pool:
  type             have  need  gap
${typeLines.join("\n")}
${styleSection}

Design the next generation batch (exactly ${targetTotal} questions total) to most efficiently fill the largest GLOBAL gaps.
Rules:
- Sum of all count fields must equal exactly ${targetTotal}.
- First satisfy the largest difficulty gaps (easy / medium / hard).
- Then satisfy the largest GLOBAL TYPE gaps across the whole pool. Do NOT assume every set needs the same fixed type recipe.
- Skip categories with gap <= 0 unless needed to support style coverage.
- ALSO prioritize style-feature shortages that can block final set assembly, especially embedded-question and negation shortages.
- If global-type optimization conflicts with style-gap repair, repair the style gaps first.
- Ensure the batch includes enough embedded-capable / negation-capable cells when those style gaps are positive.
- Minimum 1, maximum 8 questions per included cell.
- Valid types: negation, 3rd-reporting, 1st-embedded, interrogative, direct, relative
- Valid difficulties: easy, medium, hard
- Avoid over-producing direct items when direct gap is already filled.
- In boost mode, prioritize precision over breadth: target the single most blocking gap first.
- If all gaps are <= 0, return a balanced mixed batch that does not overproduce direct items.

Return ONLY a JSON array. No markdown. No explanation.
[{"type":"...","difficulty":"...","count":N},...]`.trim();
}

/**
 * Parse planner AI output into a validated spec array totaling exactly 10 questions.
 */
function parsePlannerSpec(text, targetTotal = 10) {
  try {
    const arr = parseJsonArray(text);
    if (!Array.isArray(arr) || arr.length === 0) throw new Error("empty");
    const valid = arr
      .filter((x) => x && typeof x.type === "string" && typeof x.difficulty === "string" && Number(x.count) > 0)
      .map((x) => ({ type: String(x.type), difficulty: String(x.difficulty), count: Number(x.count) }));
    if (valid.length === 0) throw new Error("no valid items");
    if (targetTotal <= 1) {
      const top = valid.sort((a, b) => b.count - a.count)[0];
      return [{ type: top.type, difficulty: top.difficulty, count: 1 }];
    }

    const ranked = valid.sort((a, b) => b.count - a.count);
    if (ranked.length >= targetTotal) {
      return ranked.slice(0, targetTotal).map((x) => ({ type: x.type, difficulty: x.difficulty, count: 1 }));
    }

    const normalized = ranked.map((x) => ({ ...x, count: 1 }));
    let remaining = targetTotal - normalized.length;
    let cursor = 0;
    while (remaining > 0 && normalized.length > 0) {
      normalized[cursor % normalized.length].count += 1;
      remaining -= 1;
      cursor += 1;
    }
    return normalized;
  } catch (_) {
    return [{ type: "3rd-reporting", difficulty: "medium", count: targetTotal }];
  }
}

function enforcePlannerStyleGaps(spec, poolState, styleTargets, globalTypeTargets = null, difficultyTargets = null, targetTotal = 10) {
  const out = Array.isArray(spec) ? spec.map((x) => ({ ...x })) : [];
  if (out.length === 0) return out;

  const style = poolState?.style || { embedded: 0, negation: 0, distractor: 0, qmark: 0 };
  const typeTotals = poolState?.typeTotals || Object.fromEntries(TYPE_LIST.map((type) => [type, 0]));
  const embeddedGap = Math.max(0, (styleTargets?.embeddedMin || 0) - style.embedded);
  const negationGap = Math.max(0, (styleTargets?.negationMin || 0) - style.negation);
  const typeGaps = Object.fromEntries(
    TYPE_LIST.map((type) => [type, Math.max(0, (globalTypeTargets?.[type] || 0) - (typeTotals[type] || 0))])
  );

  const total = out.reduce((sum, x) => sum + x.count, 0);
  if (total !== targetTotal) return out;

  const difficultyGapOrder = ["easy", "medium", "hard"].sort((a, b) => {
    const aHave = TYPE_LIST.reduce((sum, type) => sum + ((poolState?.[a] || {})[type] || 0), 0);
    const bHave = TYPE_LIST.reduce((sum, type) => sum + ((poolState?.[b] || {})[type] || 0), 0);
    const aGap = Math.max(0, (difficultyTargets?.[a] || 0) - aHave);
    const bGap = Math.max(0, (difficultyTargets?.[b] || 0) - bHave);
    return bGap - aGap;
  });

  const replaceOne = (preferredType, preferredDifficulty = null) => {
    const donor = out
      .filter((x) => x.count > 1)
      .sort((a, b) => {
        const aPenalty = (typeGaps[a.type] || 0) === 0 ? 1 : 0;
        const bPenalty = (typeGaps[b.type] || 0) === 0 ? 1 : 0;
        if (aPenalty !== bPenalty) return bPenalty - aPenalty;
        return b.count - a.count;
      })[0];
    if (!donor) {
      if (out.length === 1 && targetTotal === 1) {
        out[0] = { type: preferredType, difficulty: preferredDifficulty || difficultyGapOrder[0] || "medium", count: 1 };
      }
      return;
    }
    donor.count -= 1;
    const targetDifficulty = preferredDifficulty || difficultyGapOrder[0] || "medium";
    const existing = out.find((x) => x.type === preferredType && x.difficulty === targetDifficulty);
    if (existing) {
      existing.count += 1;
    } else {
      out.push({ type: preferredType, difficulty: targetDifficulty, count: 1 });
    }
  };

  if (embeddedGap > 0) {
    const embeddedPlanned = out
      .filter((x) => x.type === "3rd-reporting" || x.type === "1st-embedded" || x.type === "interrogative")
      .reduce((sum, x) => sum + x.count, 0);
    if (embeddedPlanned < Math.min(6, embeddedGap)) {
      replaceOne("1st-embedded", "medium");
      replaceOne("interrogative", "medium");
    }
  }

  if (negationGap > 0) {
    const negPlanned = out
      .filter((x) => x.type === "negation")
      .reduce((sum, x) => sum + x.count, 0);
    if (negPlanned < Math.min(2, negationGap)) {
      replaceOne("negation", embeddedGap > 0 ? "hard" : "medium");
    }
  }

  const scarceTypes = TYPE_LIST
    .filter((type) => !["3rd-reporting", "direct", "negation"].includes(type))
    .sort((a, b) => (typeGaps[b] || 0) - (typeGaps[a] || 0));

  for (const type of scarceTypes) {
    const gap = typeGaps[type] || 0;
    if (gap <= 0) continue;
    const planned = out.filter((x) => x.type === type).reduce((sum, x) => sum + x.count, 0);
    if (planned > 0) continue;
    replaceOne(type, difficultyGapOrder[0] || "medium");
  }

  return out.filter((x) => x.count > 0);
}

function tightenBoostSpec(spec, shortages, targetTotal = 3) {
  const out = Array.isArray(spec) ? spec.map((x) => ({ ...x })) : [];
  if (out.length === 0 || !Array.isArray(shortages) || shortages.length === 0) return out;

  const { primary, secondary } = determineBoostGoals(shortages, targetTotal);
  if (!primary) return out;
  const primaryAllowedTypes = getGoalAllowedTypes(primary);
  const primaryAllowedDifficulties = getGoalAllowedDifficulties(primary);

  const preferred = [];
  const pushCell = (type, difficulty, count = 1) => {
    if (count <= 0) return;
    const existing = preferred.find((x) => x.type === type && x.difficulty === difficulty);
    if (existing) existing.count += count;
    else preferred.push({ type, difficulty, count });
  };

  const rankedPrimaryTypes = primaryAllowedTypes.filter(Boolean);
  const primaryDifficulty = primaryAllowedDifficulties[0] || 'medium';
  pushCell(rankedPrimaryTypes[0] || '3rd-reporting', primaryDifficulty, targetTotal);

  if (targetTotal > 1 && secondary) {
    const secondaryAllowedType = secondary.key === 'embedded'
      ? '1st-embedded'
      : secondary.key === 'negation'
      ? 'negation'
      : secondary.category === 'type'
      ? secondary.key
      : rankedPrimaryTypes[Math.min(1, Math.max(0, rankedPrimaryTypes.length - 1))] || rankedPrimaryTypes[0] || '3rd-reporting';
    const secondaryDifficulty = secondary.key === 'hard'
      ? 'hard'
      : secondary.key === 'easy'
      ? 'easy'
      : secondary.key === 'medium'
      ? 'medium'
      : primaryDifficulty;
    preferred[0].count = Math.max(1, preferred[0].count - 1);
    pushCell(secondaryAllowedType, secondaryDifficulty, 1);
  }

  const focused = [];
  let remaining = targetTotal;
  for (const cell of preferred) {
    if (remaining <= 0) break;
    const take = Math.min(cell.count, remaining);
    focused.push({ type: cell.type, difficulty: cell.difficulty, count: take });
    remaining -= take;
  }
  return focused;
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

Blockers (ONLY use for these critical issues):
- multiple valid chunk orders (ambiguous arrangement)
- grammar incorrect in the answer sentence
- distractor could be a valid answer chunk (inserting it creates another valid sentence)
- prompt/answer mismatch (answer doesn't respond to prompt)
- indirect question clause uses inverted word order (MUST be declarative)

NOT blockers (deduct points instead):
- chunk composition style
- grammar_points label format
- scene variety

TPO-specific scoring:
- >=85 means production ready
- <78 means reject
- Verify that indirect questions use declarative word order (no auxiliary inversion)
- Verify that distractor did/do/does CANNOT be inserted into the correct answer
- Deduct 3-5 points if answer is a direct question when it should be a statement

Items:
${JSON.stringify(questions, null, 2)}
`.trim();
}

function buildConsistencyPrompt(questions) {
  return `
You are a TPO Build-a-Sentence auditor.
Evaluate each item against real TPO exam standards.

TPO key characteristics:
- 92% of answers are STATEMENTS (declarative sentences)
- 63% test indirect/embedded questions with declarative word order
- 88% have distractors, mainly extra single-word auxiliary verbs (did/do/does)
- ~77% of chunks are single words; multi-word chunks only for natural collocations
- Core test: "indirect questions do NOT invert" and distractor did/do tests this.

Return ONLY JSON:
{
  "overall_ets_similarity": 0-100,
  "overall_solvability": 0-100,
  "blockers": ["critical issue..."],
  "question_scores": [
    {"id":"...", "ets_similarity":0-100, "solvability":0-100, "issues":["..."]}
  ]
}

Blockers (ONLY for critical issues):
- clearly ambiguous order (multiple valid answers)
- ungrammatical answer
- distractor likely valid in answer
- indirect question uses inverted word order

NOT blockers (reflect in score):
- chunk style, grammar labels, scene variety

Items:
${JSON.stringify(questions, null, 2)}
`.trim();
}

function parseReviewJson(text) {
  const body = String(text || "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("no JSON object in review output");
  }
  const parsed = JSON.parse(body.slice(start, end + 1));
  return {
    overall_score: Number(parsed?.overall_score || 0),
    blockers: Array.isArray(parsed?.blockers) ? parsed.blockers.map((x) => String(x || "")) : [],
    question_scores: Array.isArray(parsed?.question_scores) ? parsed.question_scores : [],
  };
}

function parseConsistencyJson(text) {
  const body = String(text || "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("no JSON object in consistency output");
  }
  const parsed = JSON.parse(body.slice(start, end + 1));
  return {
    overall_ets_similarity: Number(parsed?.overall_ets_similarity || 0),
    overall_solvability: Number(parsed?.overall_solvability || 0),
    blockers: Array.isArray(parsed?.blockers) ? parsed.blockers.map((x) => String(x || "")) : [],
    question_scores: Array.isArray(parsed?.question_scores) ? parsed.question_scores : [],
  };
}

function hardValidateQuestion(q) {
  const v = validateQuestion(q);
  if (v.fatal.length > 0) return { ok: false, reason: `fatal: ${v.fatal.join("; ")}` };
  // format and content issues are soft warnings, not hard fails
  if (v.format.length > 0) return { ok: false, reason: `format: ${v.format.join("; ")}` };

  // hardFailReasons delegates to validateQuestion().fatal, already checked above
  // Skip redundant call

  try {
    const rq = normalizeRuntimeQuestion(q);
    validateRuntimeQuestion(rq);
  } catch (e) {
    return { ok: false, reason: `runtime: ${e.message}` };
  }

  return { ok: true };
}

async function callModel(userPrompt) {
  return callDeepSeekViaCurl({
    apiKey: process.env.DEEPSEEK_API_KEY,
    proxyUrl: resolveProxyUrl(),
    timeoutMs: 120000,
    payload: {
      model: "deepseek-chat",
      temperature: 0.35,
      max_tokens: 5000,
      messages: [{ role: "user", content: userPrompt }],
    },
  });
}

function errMsg(e) {
  const msg = formatDeepSeekError ? formatDeepSeekError(e) : String(e?.message || e || "");
  return msg || String(e?.code || "unknown_error");
}

async function generateCandidateRound(round, spec, rejectFeedback = "") {
  // spec: [{type, difficulty, count}, ...]
  const totalCount = spec.reduce((s, x) => s + x.count, 0);
  const out = {
    generated: 0,
    accepted: 0,
    rejected: 0,
    rejectReasons: {},
    questions: [],
  };

  const generatedRaw = await callModel(buildGeneratePrompt(round, spec, rejectFeedback));
  const arr = parseJsonArray(generatedRaw);
  if (!Array.isArray(arr) || arr.length < Math.floor(totalCount * 0.7)) {
    throw new Error(`round ${round}: model returned ${arr?.length ?? 0} questions, expected ~${totalCount}`);
  }

  const normalized = arr.map((q, i) => normalizeQuestion(q, `tmp_r${round}_q${i + 1}`));
  out.generated = normalized.length;

  // hard filter first
  const hardPassed = [];
  for (const q of normalized) {
    const hv = hardValidateQuestion(q);
    if (!hv.ok) {
      out.rejected += 1;
      out.rejectReasons[hv.reason] = (out.rejectReasons[hv.reason] || 0) + 1;
      continue;
    }
    hardPassed.push(q);
  }

  if (hardPassed.length === 0) return out;

  // AI review score
  const reviewRaw = await callModel(buildReviewPrompt(hardPassed));
  const review = parseReviewJson(reviewRaw);
  const scoreMap = new Map(
    review.question_scores.map((qs) => [String(qs?.id || ""), Number(qs?.score || 0)]),
  );
  const consistencyRaw = await callModel(buildConsistencyPrompt(hardPassed));
  const consistency = parseConsistencyJson(consistencyRaw);
  const cMap = new Map(
    consistency.question_scores.map((qs) => [
      String(qs?.id || ""),
      {
        ets: Number(qs?.ets_similarity || 0),
        solvability: Number(qs?.solvability || 0),
      },
    ]),
  );

  for (const q of hardPassed) {
    const score = scoreMap.has(q.id) ? scoreMap.get(q.id) : 0;
    const c = cMap.get(q.id) || { ets: 0, solvability: 0 };
    const blocked = (
      (review.blockers.length > 0 && review.overall_score < MIN_REVIEW_OVERALL) ||
      (consistency.blockers.length > 0 && (
        consistency.overall_ets_similarity < MIN_ETS_SIMILARITY ||
        consistency.overall_solvability < MIN_SOLVABILITY
      ))
    );
    if (blocked || score < MIN_REVIEW_SCORE || c.ets < MIN_ETS_SIMILARITY || c.solvability < MIN_SOLVABILITY) {
      out.rejected += 1;
      let r = "";
      if (blocked) {
        const b = [...review.blockers, ...consistency.blockers].filter(Boolean).join("|");
        r = `review:blocker:${b}`;
      } else if (score < MIN_REVIEW_SCORE) {
        r = `review:score<${MIN_REVIEW_SCORE}`;
      } else if (c.ets < MIN_ETS_SIMILARITY) {
        r = `review:ets<${MIN_ETS_SIMILARITY}`;
      } else {
        r = `review:solvability<${MIN_SOLVABILITY}`;
      }
      out.rejectReasons[r] = (out.rejectReasons[r] || 0) + 1;
      continue;
    }
    out.accepted += 1;
    out.questions.push(q);
  }

  return out;
}

// Pre-compute per-question style metadata once so profileStyle() is O(n) sums
// instead of re-splitting strings on every retry attempt.
function attachMeta(q) {
  if (q._meta) return q; // already computed
  const wordCount = String(q.answer || "")
    .replace(/[.,!?;:]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  const effectiveChunks = Array.isArray(q.chunks)
    ? q.chunks.filter((c) => c !== q.distractor).length
    : 0;
  q._meta = {
    wordCount,
    effectiveChunks,
    hasDistractor: q.distractor != null,
    isEmbedded: isEmbeddedQuestion(q.grammar_points),
    hasQuestionMark: q.has_question_mark === true,
    answerType: getAnswerType(q),
  };
  return q;
}

function splitPoolByDifficulty(questions) {
  const pool = { easy: [], medium: [], hard: [] };
  questions.forEach((q) => {
    const est = estimateQuestionDifficulty(q);
    pool[est.bucket].push(attachMeta(q));
  });
  pool.easy = shuffle(uniqBy(pool.easy, stableAnswerKey));
  pool.medium = shuffle(uniqBy(pool.medium, stableAnswerKey));
  pool.hard = shuffle(uniqBy(pool.hard, stableAnswerKey));
  return pool;
}

function cloneQuestion(q) {
  const c = JSON.parse(JSON.stringify(q));
  delete c._meta; // _meta is internal; don't persist to output JSON
  return c;
}

/**
 * Per-set assembly no longer uses hard type templates.
 * We keep only difficulty counts and prefer light type diversity within each difficulty bucket.
 */
const SET_TYPE_TARGETS = {
  easy: [
    { type: "any", count: 1 },
  ],
  medium: [
    { type: "any", count: 7 },
  ],
  hard: [
    { type: "any", count: 2 },
  ],
};

/**
 * Pick items from a difficulty pool while respecting type quotas.
 * Falls back to any type in the same pool if a specific type is unavailable.
 */
function pickDiversified(pool, targets) {
  const result = [];
  const usedIds = new Set();
  const totalNeeded = targets.reduce((sum, t) => sum + t.count, 0);
  const typeCounts = {};

  while (result.length < totalNeeded) {
    const remaining = pool.filter((q) => !usedIds.has(q.id));
    if (remaining.length === 0) break;

    const ranked = shuffle(remaining).sort((a, b) => {
      const ta = (a._meta || {}).answerType || "unknown";
      const tb = (b._meta || {}).answerType || "unknown";
      const ca = typeCounts[ta] || 0;
      const cb = typeCounts[tb] || 0;
      if (ca !== cb) return ca - cb;
      return 0;
    });

    const picked = ranked[0];
    result.push(picked);
    usedIds.add(picked.id);
    const type = (picked._meta || {}).answerType || "unknown";
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }

  return result;
}
function composeOneSet(pool, setId, maxRetries = 500) {
  const { easy: eN, medium: mN, hard: hN } = ETS_2026_TARGET_COUNTS_10;

  // Use pre-computed _meta for cheap O(n) profile �?no string splitting per attempt
  function profileStyle(items) {
    const total = items.length || 1;
    let qmark = 0, distractor = 0, embedded = 0, sumWords = 0, sumChunks = 0;
    const typeCounts = {};

    for (const q of items) {
      const m = q._meta;
      if (m.hasQuestionMark) qmark++;
      if (m.hasDistractor) distractor++;
      if (m.isEmbedded) embedded++;
      sumWords += m.wordCount;
      sumChunks += m.effectiveChunks;
      const t = m.answerType || "unknown";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    return { total, qmark, distractor, embedded, avgWords: sumWords / total, avgChunks: sumChunks / total, typeCounts, items };
  }

  // TPO style gates: 92% statements, 88% distractors, 63% embedded
  function stylePassStrict(p) {
    // Type monopoly check: no single type should exceed 6 items (3rd-reporting avg is 5.4)
    const maxTypeCount = Math.max(...Object.values(p.typeCounts));
    
    // Prompt uniqueness check: no identical prompts within a 10-item set
    const prompts = p.items.map(q => q.prompt.toLowerCase().trim());
    const uniquePrompts = new Set(prompts);
    const hasDuplicatePrompts = uniquePrompts.size < prompts.length;

    return (
      !hasDuplicatePrompts &&
      p.qmark >= 0 && p.qmark <= 2 &&
      p.distractor >= 7 && p.distractor <= 10 &&
      p.embedded >= 5 && p.embedded <= 8 &&
      p.avgWords >= 9.0 && p.avgWords <= 13.0 &&
      p.avgChunks >= 4.5 && p.avgChunks <= 7.5 &&
      maxTypeCount <= 6
    );
  }

  function stylePassRelaxed(p) {
    const maxTypeCount = Math.max(...Object.values(p.typeCounts));
    const prompts = p.items.map(q => q.prompt.toLowerCase().trim());
    const uniquePrompts = new Set(prompts);
    const hasManyDuplicatePrompts = uniquePrompts.size < prompts.length - 1; // Allow max 1 duplicate in relaxed mode

    return (
      !hasManyDuplicatePrompts &&
      p.qmark >= 0 && p.qmark <= 3 &&
      p.distractor >= 6 && p.distractor <= 10 &&
      p.embedded >= 4 && p.embedded <= 9 &&
      p.avgWords >= 8.5 && p.avgWords <= 14.0 &&
      p.avgChunks >= 4.0 && p.avgChunks <= 8.0 &&
      maxTypeCount <= 8
    );
  }

  // Pre-flight feasibility check: bail early if style gate can never be satisfied.
  // Compute the best-case embedded/distractor counts achievable from this pool.
  function isFeasible() {
    if (
      pool.easy.length < eN ||
      pool.medium.length < mN ||
      pool.hard.length < hN
    ) return false;

    const maxEmbedded =
      Math.min(eN, pool.easy.filter((q) => q._meta.isEmbedded).length) +
      Math.min(mN, pool.medium.filter((q) => q._meta.isEmbedded).length) +
      Math.min(hN, pool.hard.filter((q) => q._meta.isEmbedded).length);
    if (maxEmbedded < 4) return false; // relaxed gate minimum

    const maxDistractor =
      Math.min(eN, pool.easy.filter((q) => q._meta.hasDistractor).length) +
      Math.min(mN, pool.medium.filter((q) => q._meta.hasDistractor).length) +
      Math.min(hN, pool.hard.filter((q) => q._meta.hasDistractor).length);
    if (maxDistractor < 6) return false; // relaxed gate minimum

    return true;
  }

  if (!isFeasible()) {
    console.warn(`  [assembly set ${setId}] isFeasible=false: easy=${pool.easy.length}/${eN} medium=${pool.medium.length}/${mN} hard=${pool.hard.length}/${hN} embedded_max=${
      Math.min(eN, pool.easy.filter(q=>q._meta.isEmbedded).length) +
      Math.min(mN, pool.medium.filter(q=>q._meta.isEmbedded).length) +
      Math.min(hN, pool.hard.filter(q=>q._meta.isEmbedded).length)
    } distractor_max=${
      Math.min(eN, pool.easy.filter(q=>q._meta.hasDistractor).length) +
      Math.min(mN, pool.medium.filter(q=>q._meta.hasDistractor).length) +
      Math.min(hN, pool.hard.filter(q=>q._meta.hasDistractor).length)
    }`);
    return null;
  }

  const diag = { styleStrict: 0, styleRelaxed: 0, schemaOk: 0, diffOk: 0, runtimeOk: 0 };

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    if (
      pool.easy.length < eN ||
      pool.medium.length < mN ||
      pool.hard.length < hN
    ) return null;

    const picked = [
      ...pickDiversified(pool.easy, SET_TYPE_TARGETS.easy),
      ...pickDiversified(pool.medium, SET_TYPE_TARGETS.medium),
      ...pickDiversified(pool.hard, SET_TYPE_TARGETS.hard),
    ];

    // Safety check
    if (picked.length !== 10) continue;

    // 1. Style gate first �?cheap, uses pre-computed _meta, no clone needed
    const style = profileStyle(picked);
    const isStrict = attempt < Math.floor(maxRetries * 0.6);
    const styleGate = isStrict ? stylePassStrict : stylePassRelaxed;
    if (!styleGate(style)) {
      if (isStrict) diag.styleStrict++; else diag.styleRelaxed++;
      continue;
    }

    // 2. Clone + re-id only after style passes (avoids wasted deep-clones)
    const merged = shuffle(picked).map(cloneQuestion);
    merged.forEach((q, i) => { q.id = `ets_s${setId}_q${i + 1}`; });

    // 3. Schema + difficulty validation (rare failures; done after cheap gate)
    const set = { set_id: setId, questions: merged };
    const schemaResult = validateQuestionSet(set);
    const diff = evaluateSetDifficultyAgainstTarget(merged);
    if (!schemaResult.ok || !diff.ok || !diff.meetsTargetCount10) {
      diag.schemaOk++;
      continue;
    }

    // 4. Runtime strict check
    let runtimeOk = true;
    for (const q of merged) {
      try {
        const rq = normalizeRuntimeQuestion(q);
        validateRuntimeQuestion(rq);
      } catch (_) {
        runtimeOk = false;
        break;
      }
    }
    if (!runtimeOk) { diag.runtimeOk++; continue; }

    // Consume used questions from pool (by answer key)
    const usedKeys = new Set(picked.map(stableAnswerKey));
    pool.easy = pool.easy.filter((q) => !usedKeys.has(stableAnswerKey(q)));
    pool.medium = pool.medium.filter((q) => !usedKeys.has(stableAnswerKey(q)));
    pool.hard = pool.hard.filter((q) => !usedKeys.has(stableAnswerKey(q)));

    return set;
  }

  // Log detailed failure breakdown
  const negationItems = [...pool.easy, ...pool.medium, ...pool.hard]
    .filter(q => (q._meta || {}).answerType === "negation").length;
  const embeddedItems = [...pool.easy, ...pool.medium, ...pool.hard]
    .filter(q => (q._meta || {}).isEmbedded).length;
  const poolTotal = pool.easy.length + pool.medium.length + pool.hard.length;
  console.warn(`  [assembly set ${setId}] FAILED after ${maxRetries} retries`);
  console.warn(`    pool: easy=${pool.easy.length} medium=${pool.medium.length} hard=${pool.hard.length} total=${poolTotal}`);
  console.warn(`    pool stats: negation=${negationItems} embedded=${embeddedItems} (${Math.round(embeddedItems/poolTotal*100)}%)`);
  console.warn(`    fail breakdown: styleStrict=${diag.styleStrict} styleRelaxed=${diag.styleRelaxed} schema/diff=${diag.schemaOk} runtime=${diag.runtimeOk}`);

  // Sample a failed schema check to show actual errors
  const samplePicked = [
    ...pickDiversified(pool.easy, SET_TYPE_TARGETS.easy),
    ...pickDiversified(pool.medium, SET_TYPE_TARGETS.medium),
    ...pickDiversified(pool.hard, SET_TYPE_TARGETS.hard),
  ];
  if (samplePicked.length === 10) {
    const sampleMerged = shuffle(samplePicked).map(cloneQuestion);
    sampleMerged.forEach((q, i) => { q.id = `sample_q${i + 1}`; });
    const sampleSchema = validateQuestionSet({ set_id: 0, questions: sampleMerged });
    const sampleDiff = evaluateSetDifficultyAgainstTarget(sampleMerged);
    const sampleStyle = profileStyle(samplePicked);
    console.warn(`    sample pick: qmark=${sampleStyle.qmark} distractor=${sampleStyle.distractor} embedded=${sampleStyle.embedded} avgWords=${sampleStyle.avgWords.toFixed(1)} avgChunks=${sampleStyle.avgChunks.toFixed(1)} maxType=${Math.max(...Object.values(sampleStyle.typeCounts))}`);
    if (!sampleSchema.ok) console.warn(`    schema errors: ${sampleSchema.errors.join(" | ")}`);
    if (!sampleDiff.meetsTargetCount10) console.warn(`    diff counts: easy=${sampleDiff.profile.counts.easy} medium=${sampleDiff.profile.counts.medium} hard=${sampleDiff.profile.counts.hard}`);
  }

  return null;
}

function buildFinalSetsFromPool(pool, targetCount) {
  const sets = [];
  for (let i = 1; i <= targetCount; i += 1) {
    const set = composeOneSet(pool, i);
    if (!set) {
      console.warn(`  [assembly] set ${i} could not be assembled �?continuing to next`);
      continue;
    }
    sets.push(set);
  }
  return sets;
}

function summarizeRejectReasons(map) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
}

function flushPoolCheckpoint(pool) {
  try {
    const snapshot = uniqBy(pool, stableAnswerKey).map((q) => {
      const c = cloneQuestion(q);
      delete c._meta;
      return c;
    });
    writeFileSync(RESERVE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    console.log(`[checkpoint] saved ${snapshot.length} questions to reserve_pool.json`);
  } catch (_) {
    // non-fatal
  }
}

async function main() {
  loadEnv();
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("ERROR: DEEPSEEK_API_KEY missing");
    process.exit(1);
  }

  console.log("Build Sentence Robust Generator");
  console.log("==============================");
  console.log(`Target sets: ${TARGET_SET_COUNT}`);
  console.log(`Candidate rounds: ${CANDIDATE_ROUNDS}`);
  console.log(`Proxy: ${resolveProxyUrl() || "(direct)"}`);

  // Seed pool from questions.json (active bank) + reserve_pool.json (leftovers)
  const acceptedPool = [];
  for (const [label, filePath] of [["questions.json", OUTPUT_PATH], ["reserve_pool.json", RESERVE_PATH]]) {
    try {
      const data = JSON.parse(readFileSync(filePath, "utf8"));
      // questions.json stores sets; reserve_pool.json stores a flat array
      const seeded = Array.isArray(data)
        ? data
        : (data.question_sets || []).flatMap((s) => s.questions || []);
      if (seeded.length > 0) {
        acceptedPool.push(...seeded);
        console.log(`Seeded ${seeded.length} questions from ${label}`);
      }
    } catch (_) {
      // file missing or invalid �?skip
    }
  }

  const rejectReasons = {};
  let rollingRejectFeedback = "";
  const easyTarget = ETS_2026_TARGET_COUNTS_10.easy * TARGET_SET_COUNT;
  const mediumTarget = ETS_2026_TARGET_COUNTS_10.medium * TARGET_SET_COUNT;
  const hardTarget = ETS_2026_TARGET_COUNTS_10.hard * TARGET_SET_COUNT;
  const styleTargets = {
    embeddedMin: 5 * TARGET_SET_COUNT,
    negationMin: 2 * TARGET_SET_COUNT,
    distractorMin: 7 * TARGET_SET_COUNT,
    qmarkMax: 2 * TARGET_SET_COUNT,
  };

  const BUFFER = 1.5;
  const difficultyTargets = {
    easy: Math.ceil(easyTarget * BUFFER),
    medium: Math.ceil(mediumTarget * BUFFER),
    hard: Math.ceil(hardTarget * BUFFER),
  };
  const boostDifficultyTargets = {
    easy: easyTarget,
    medium: mediumTarget,
    hard: hardTarget,
  };
  const globalTypeTargetTotal = TARGET_SET_COUNT * 10;
  const globalTypeTargets = Object.fromEntries(
    TYPE_LIST.map((type) => [type, Math.max(1, Math.ceil(globalTypeTargetTotal * TPO_TYPE_TARGET_RATIO[type]))]),
  );

  function computeCoverageGaps(poolState, pool) {
    return {
      diff: {
        easy: Math.max(0, difficultyTargets.easy - pool.easy.length),
        medium: Math.max(0, difficultyTargets.medium - pool.medium.length),
        hard: Math.max(0, difficultyTargets.hard - pool.hard.length),
      },
      style: {
        embedded: Math.max(0, styleTargets.embeddedMin - poolState.style.embedded),
        negation: Math.max(0, styleTargets.negationMin - poolState.style.negation),
        distractor: Math.max(0, styleTargets.distractorMin - poolState.style.distractor),
      },
      type: Object.fromEntries(TYPE_LIST.map((type) => [type, Math.max(0, (globalTypeTargets[type] || 0) - (poolState.typeTotals[type] || 0))])),
    };
  }

  function selectBoostBatchSize(poolState, pool) {
    const gaps = computeCoverageGaps(poolState, pool);
    const diffUnits = gaps.diff.easy + gaps.diff.medium + gaps.diff.hard;
    const styleUnits = gaps.style.embedded + gaps.style.negation + gaps.style.distractor;
    const activeTypeGaps = TYPE_LIST.filter((type) => gaps.type[type] > 0).length;
    const activeGapKinds = [
      diffUnits > 0 ? 1 : 0,
      gaps.style.embedded > 0 ? 1 : 0,
      gaps.style.negation > 0 ? 1 : 0,
      gaps.style.distractor > 0 ? 1 : 0,
      activeTypeGaps > 0 ? 1 : 0,
    ].reduce((sum, x) => sum + x, 0);

    if (diffUnits <= 1 && styleUnits <= 1 && activeTypeGaps <= 1 && activeGapKinds <= 2) return 1;
    return 3;
  }

  function hasSufficientPoolCoverage(poolState, pool) {
    const diffOk =
      pool.easy.length >= difficultyTargets.easy &&
      pool.medium.length >= difficultyTargets.medium &&
      pool.hard.length >= difficultyTargets.hard;
    const styleOk =
      poolState.style.embedded >= styleTargets.embeddedMin &&
      poolState.style.negation >= styleTargets.negationMin &&
      poolState.style.distractor >= styleTargets.distractorMin &&
      poolState.style.qmark <= styleTargets.qmarkMax;
    const typeOk = TYPE_LIST.every((type) => (poolState.typeTotals[type] || 0) >= (globalTypeTargets[type] || 0));
    return diffOk && styleOk && typeOk;
  }

  for (let round = 1; round <= CANDIDATE_ROUNDS; round += 1) {
    try {
      // Planner: AI analyzes pool gaps and decides the mixed batch composition
      const poolState = computePoolState(acceptedPool);
      const plannerRaw = await callModel(
        buildPlannerPrompt(poolState, difficultyTargets, globalTypeTargets, styleTargets, 10, "normal"),
      );
      const spec = enforcePlannerStyleGaps(
        parsePlannerSpec(plannerRaw, 10),
        poolState,
        styleTargets,
        globalTypeTargets,
        difficultyTargets,
        10,
      );
      const specLabel = spec.map((s) => `${s.count}×${s.type}/${s.difficulty}`).join(", ");
      console.log(`round ${round}: planner �?[${specLabel}]`);

      const res = await generateCandidateRound(round, spec, rollingRejectFeedback);
      acceptedPool.push(...res.questions);
      Object.entries(res.rejectReasons).forEach(([k, v]) => {
        rejectReasons[k] = (rejectReasons[k] || 0) + v;
      });
      rollingRejectFeedback = buildRejectFeedbackHints(rejectReasons);
      const pool = splitPoolByDifficulty(acceptedPool);
      console.log(
        `round ${round}: generated=${res.generated} accepted=${res.accepted} rejected=${res.rejected} | pool easy=${pool.easy.length} medium=${pool.medium.length} hard=${pool.hard.length}`,
      );
      if (res.rejected > 0) {
        const topReasons = Object.entries(res.rejectReasons).sort((a, b) => b[1] - a[1]).slice(0, 3);
        topReasons.forEach(([r, n]) => console.log(`  reject: ${r} (×${n})`));
      }

      // Persist pool after every round so progress survives failures
      flushPoolCheckpoint(acceptedPool);

      const currentState = computePoolState(acceptedPool);
      if (hasSufficientPoolCoverage(currentState, pool)) {
        console.log(
          `pool sufficient (easy=${pool.easy.length}/${difficultyTargets.easy} medium=${pool.medium.length}/${difficultyTargets.medium} hard=${pool.hard.length}/${difficultyTargets.hard}), stopping early`,
        );
        break;
      }
    } catch (e) {
      console.log(`round ${round}: failed -> ${errMsg(e)}`);
      flushPoolCheckpoint(acceptedPool);
    }
    // Brief pause between rounds to avoid proxy rate limiting
    await new Promise((r) => setTimeout(r, 3000));
  }

  let boostedPool = splitPoolByDifficulty(acceptedPool);
  if (ADAPTIVE_BOOST_ROUNDS > 0) {
    const initialBoostState = computePoolState(acceptedPool);
    if (!hasSufficientPoolCoverage(initialBoostState, boostedPool)) {
      console.log(
        `pool insufficient (easy ${boostedPool.easy.length}/${difficultyTargets.easy}, medium ${boostedPool.medium.length}/${difficultyTargets.medium}, hard ${boostedPool.hard.length}/${difficultyTargets.hard}), starting adaptive boost rounds...`,
      );
      for (let i = 1; i <= ADAPTIVE_BOOST_ROUNDS; i += 1) {
        boostedPool = splitPoolByDifficulty(acceptedPool);
        const boostState = computePoolState(acceptedPool);
        if (hasSufficientPoolCoverage(boostState, boostedPool)) break;
        try {
          const boostBacklog = buildBoostBacklog(
            boostState,
            boostedPool,
            boostDifficultyTargets,
            globalTypeTargets,
            styleTargets,
          );
          const boostTask = boostBacklog[0];
          if (!boostTask) break;
          const boostSpec = [{ type: boostTask.type, difficulty: boostTask.difficulty, count: 1 }];
          const boostLabel = boostSpec.map((s) => `${s.count}?${s.type}/${s.difficulty}`).join(', ');
          const boostFeedback = [rollingRejectFeedback, buildBoostTaskHint(boostTask)].filter(Boolean).join('\n');
          const res = await generateCandidateRound(3000 + i, boostSpec, boostFeedback);
          acceptedPool.push(...res.questions);
          Object.entries(res.rejectReasons).forEach(([k, v]) => {
            rejectReasons[k] = (rejectReasons[k] || 0) + v;
          });
          rollingRejectFeedback = buildRejectFeedbackHints(rejectReasons);
          boostedPool = splitPoolByDifficulty(acceptedPool);
          console.log(
            `boost ${i} [${boostLabel}]: accepted=${res.accepted} rejected=${res.rejected} | pool easy=${boostedPool.easy.length} medium=${boostedPool.medium.length} hard=${boostedPool.hard.length}`,
          );
          if (hasSufficientPoolCoverage(computePoolState(acceptedPool), boostedPool)) {
            break;
          }
        } catch (e) {
          console.log(`boost ${i}: failed -> ${errMsg(e)}`);
          flushPoolCheckpoint(acceptedPool);
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  const dedupedPool = uniqBy(acceptedPool, stableAnswerKey);
  const poolByDiff = splitPoolByDifficulty(dedupedPool);
  console.log(`final pool: easy=${poolByDiff.easy.length} medium=${poolByDiff.medium.length} hard=${poolByDiff.hard.length}`);

  const finalSets = buildFinalSetsFromPool(poolByDiff, TARGET_SET_COUNT);
  if (finalSets.length === 0) {
    console.error("No sets assembled at all �?aborting.");
    process.exit(1);
  }
  if (finalSets.length < TARGET_SET_COUNT) {
    console.warn(
      `Warning: only assembled ${finalSets.length}/${TARGET_SET_COUNT} sets. Writing partial output.`,
    );
    console.warn(`Pool snapshot: easy=${poolByDiff.easy.length} medium=${poolByDiff.medium.length} hard=${poolByDiff.hard.length}`);
    console.warn("Top reject reasons:");
    summarizeRejectReasons(rejectReasons).forEach(([k, v]) => console.warn(`- ${k}: ${v}`));
  }

  const output = {
    version: "1.2",
    generated_at: new Date().toISOString(),
    question_sets: finalSets,
  };

  // global strict validation
  const check = validateAllSets(output, { strict: true });
  if (!check.ok) {
    console.error("Final output failed strict validation.");
    check.failures.forEach((x) => console.error(x));
    check.strictHardFails.forEach((x) => console.error(`${x.label}: ${x.reasons.join("; ")}`));
    check.strictWarnings.forEach((x) => console.error(`${x.label}: ${x.reasons.join("; ")}`));
    process.exit(1);
  }

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Saved ${finalSets.length} set(s) to ${OUTPUT_PATH}`);
  finalSets.forEach((s) => {
    const diff = evaluateSetDifficultyAgainstTarget(s.questions);
    console.log(
      `- set ${s.set_id}: easy=${diff.profile.counts.easy} medium=${diff.profile.counts.medium} hard=${diff.profile.counts.hard}`,
    );
  });

  // Save leftover questions (passed quality gates but not assembled into sets) to reserve pool
  const usedAnswers = new Set(
    finalSets.flatMap((s) => s.questions.map((q) => stableAnswerKey(q)))
  );
  const reserve = uniqBy(
    [...poolByDiff.easy, ...poolByDiff.medium, ...poolByDiff.hard]
      .filter((q) => !usedAnswers.has(stableAnswerKey(q)))
      .map((q) => { const c = cloneQuestion(q); delete c._meta; return c; }),
    stableAnswerKey
  );
  writeFileSync(RESERVE_PATH, `${JSON.stringify(reserve, null, 2)}\n`, "utf8");
  console.log(`Reserve pool: ${reserve.length} questions saved to reserve_pool.json`);

  console.log("Top reject reasons:");
  summarizeRejectReasons(rejectReasons).forEach(([k, v]) => console.log(`- ${k}: ${v}`));
}

main().catch((e) => {
  console.error(`Fatal: ${errMsg(e)}`);
  process.exit(1);
});











