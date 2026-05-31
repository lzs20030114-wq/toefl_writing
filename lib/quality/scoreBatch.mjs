// Scoring module for one nightly batch.
//
// Computes two scores per bank, plus weighted overall:
//   - Diversity (0-100): how varied this batch is across multiple axes
//     (distinct character names, scenarios, sentence types, topics, etc.).
//     100 = "ideal: every item along every axis is distinct or balanced".
//   - Quality (0-100): how well each item adheres to TPO-calibrated targets
//     (word count, paragraph count, chunk count, distractor presence, etc.).
//     Average of per-item pass rate across the bank.
//
// Caller:
//   import { scoreBatch } from "../lib/quality/scoreBatch.mjs";
//   const result = scoreBatch(ROOT, sessionId, meta.results);
//
// Returns:
//   {
//     overall: { diversity: 87, quality: 94 },
//     perBank: {
//       bs: { diversity: { score, breakdown }, quality: { score, breakdown } },
//       ...
//     }
//   }
//
// Reads staging files committed by the routine. Falls back to PASS 1 file
// if a PASS 2 -r2 file is not present.

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const STAGING_TMPL = {
  bs: "data/buildSentence/staging/$SESSION.json",
  discussion: "data/academicWriting/staging/$SESSION.json",
  email: "data/emailWriting/staging/$SESSION.json",
  "reading-ap": "data/reading/staging/ap-$SESSION.json",
  "reading-ctw": "data/reading/staging/ctw-$SESSION.json",
  "reading-rdl-short": "data/reading/staging/rdl-$SESSION-short.json",
  "reading-rdl-long": "data/reading/staging/rdl-$SESSION-long.json",
  // Listening + Speaking — added 2026-05-31 so the Claude routine quality-gates them too.
  "listening-lat": "data/listening/staging/lat-$SESSION.json",
  "listening-lc": "data/listening/staging/lc-$SESSION.json",
  "listening-la": "data/listening/staging/la-$SESSION.json",
  "listening-lcr": "data/listening/staging/lcr-$SESSION.json",
  "speaking-repeat": "data/speaking/staging/repeat-$SESSION.json",
};

function resolveStaging(rootDir, bank, sessionId) {
  const tmpl = STAGING_TMPL[bank];
  if (!tmpl) return null;
  // Prefer PASS 2 file (-r2 suffix) if it exists — that's the one that actually
  // got merged. Otherwise fall back to PASS 1.
  const r2 = resolve(rootDir, tmpl.replace("$SESSION", `${sessionId}-r2`));
  if (existsSync(r2)) return r2;
  const r1 = resolve(rootDir, tmpl.replace("$SESSION", sessionId));
  return existsSync(r1) ? r1 : null;
}

function loadItems(file) {
  if (!file) return [];
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    // speaking-repeat staging uses `sets`; everything else uses `items`.
    if (Array.isArray(j?.items)) return j.items;
    if (Array.isArray(j?.sets)) return j.sets;
    return [];
  } catch {
    return [];
  }
}

function wc(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}

// ── BS: Build Sentence ───────────────────────────────────────────────
export function classifyBSSentenceType(answer) {
  const a = String(answer || "").toLowerCase();
  if (/\b(if|whether)\b/.test(a) && /\b(wonder|wondered|curious|want.* to know|asked|wondering)\b/.test(a)) return "indirect-Q";
  if (/\b(not|no longer|never|nothing|nobody|n't)\b/.test(a)) return "negation";
  if (/\bwas\s+\w+ed\s+by\b|\bwere\s+\w+ed\s+by\b/.test(a)) return "passive";
  if (/\b(more|less)\b.*\bthan\b|\b\w+er\s+than\b/.test(a)) return "comparative";
  if (/\b(who|which|whose|that)\s+\w+s?\b/.test(a)) return "relative";
  return "other";
}

export function classifyBSOpener(prompt) {
  const p = String(prompt || "").trim();
  if (!p.endsWith("?")) return "statement";
  if (/^what did .+ ask\b/i.test(p)) return "what-did-X-ask";
  if (/^(what|when|where|why|how)\b/i.test(p)) return "wh-Q";
  if (/^(did|do|does|is|are|was|were|have|has|will|would|can|could)\b/i.test(p)) return "yes-no";
  return "wh-Q";
}

// ── Person-prefilled calibration constants (single source of truth) ──────
// Verified against 60 real TPO items (scripts/ops/test-anchor-hypothesis.mjs):
// TPO uses a person (pronoun/name) as the prefilled hint ~30% of the time
// even though 82% of answers have a person subject.
// check-quality-gates.mjs imports PERSON_PREFILLED_GATE so the threshold can
// never silently desync between scorer and gate. Regression test locks both.
export const PERSON_PREFILLED_TPO = 0.30;   // real TPO ground-truth ratio
export const PERSON_PREFILLED_GATE = 0.45;  // batch flagged for R2 retry above this
export function isPersonOveruse(frac) {
  return typeof frac === "number" && frac > PERSON_PREFILLED_GATE;
}

// ── Distractor variety gate (single source of truth) ─────────────────────
// Gates on the COLLAPSE signal, not a precise TPO match (TPO distractors
// can't be measured precisely from tpo_source — see measure-tpo-distractor.mjs).
// Robust facts: TPO uses many distinct distractors; "did" is a minority.
// Our regression collapsed to 71% "did", ~3 distinct. Flag a batch if one
// distractor word dominates OR there are too few distinct distractors.
export const DISTRACTOR_TOP_FRAC_GATE = 0.50;  // no single distractor word may exceed this
export const DISTRACTOR_MIN_DISTINCT = 4;      // per 10-item set
export function isDistractorCollapsed(detail) {
  if (!detail) return false;
  const top = detail.topDistractorFrac;
  const distinct = detail.distinctDistractors;
  // only judge if the batch actually has distractors
  if (typeof top !== "number" || typeof distinct !== "number") return false;
  if (distinct === 0) return false;
  return top > DISTRACTOR_TOP_FRAC_GATE || distinct < DISTRACTOR_MIN_DISTINCT;
}

// ── 2nd-person prompt addressing gate ────────────────────────────────────
// Real TPO BS prompts address the test-taker ("you/your") in ~72% of items —
// they are conversational turns. Our batches dropped to ~5-10% (detached
// third-person scene reports). No solvability trade-off, so this is a hard
// gate like person/distractor. Flag a batch whose "you" share falls well below
// TPO (< 45%). Detection is a plain word-boundary regex — zero inference.
export const PROMPT_SECOND_PERSON_TPO = 0.72;   // real TPO ground-truth ratio
export const PROMPT_SECOND_PERSON_GATE = 0.45;  // flag for retry below this
export function isSecondPersonPrompt(prompt) {
  return /\b(you|your|you're|you've|you'd|you'll)\b/i.test(String(prompt || ""));
}
export function isPromptAddressingLow(detail) {
  if (!detail || typeof detail.secondPersonFrac !== "number") return false;
  return detail.secondPersonFrac < PROMPT_SECOND_PERSON_GATE;
}

// Classify a prefilled segment into one of 7 TPO-observed types
// (matches PREFILLED_PROFILE.wordTypeRatio in etsProfile.js).
// Note: input is the RAW segment with case preserved — capitalization is a
// signal for proper-noun detection.
export function classifyPrefilledType(segment) {
  const raw = String(segment || "").trim().replace(/[.,;:'"!?]/g, "");
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const words = raw.split(/\s+/);

  // Single-word patterns (check pronouns/adverbs/conjunctions before falling
  // through to proper-name vs content-word distinction)
  if (words.length === 1) {
    if (/^(i|he|she|they|we|you)$/i.test(raw)) return "subject-pronoun";
    if (/^(unfortunately|yes|yet|no|sure|maybe|perhaps|honestly|frankly|certainly|finally|fortunately|currently)$/i.test(raw)) return "adverb-opener";
    if (/^(when|why|what|where|how|that|which|who|about|because|since|though|although)$/i.test(raw)) return "conjunction-wh";
    // Single proper noun = a subject NP (a single named entity functioning as subject)
    if (/^[A-Z][a-z]+/.test(raw)) return "subject-np";
    return "mid-noun-or-adj"; // single content word like "fun", "weekends", "most", "yet"
  }

  // Multi-word patterns
  if (/^(unfortunately|yes|no|but|however|moreover|consequently|nevertheless|finally|fortunately|certainly|currently)[,\s]/i.test(raw)) return "adverb-opener";
  if (/^(the|a|an|some|this|that|these|those|my|her|his|their|our|professor|mr|ms|mrs|dr)\s+/i.test(raw)) return "subject-np";
  if (/^(some|many|few|several|all|most|every|each)\s+\w+/i.test(raw)) return "subject-np";
  if (/^(to|in|on|at|by|for|with|of|from|about|over|under|behind|near|next)\s+/i.test(lower)) return "prep-phrase";
  if (/^(wanted|needed|tried|found|tell|told|asked|wonder|wondered|hopes|hoped|is|was|are|were|has|have|had|do|does|did|gets|got|tries|knows|knew)\b/i.test(lower)) return "verb-phrase";
  // Capitalized first word = likely proper-noun-led NP
  if (/^[A-Z][a-z]+/.test(raw)) return "subject-np";
  return "verb-phrase";
}

// Detect whether a prefilled segment is a PERSON reference (subject pronoun or
// a proper name). Same methodology as the TPO measurement in
// scripts/ops/test-anchor-hypothesis.mjs so the comparison is apples-to-apples.
// Real TPO uses a person as the prefilled hint only ~30% of the time, even
// though 82% of answers have a person subject — TPO hides the person in the
// draggable chunks. Used to flag person-overuse in a batch.
const _PERSON_COMMON_CAP = new Set([
  "unfortunately", "yes", "no", "some", "the", "this", "that", "these", "those",
  "many", "few", "several", "all", "most", "every", "each", "could", "would",
  "should", "can", "will", "did", "do", "does", "is", "was", "were", "have",
  "has", "yet", "fun", "when", "why", "what", "where", "how", "to", "in", "on", "at",
]);
export function isPersonPrefilled(segment) {
  if (!segment) return false;
  const words = String(segment).trim().split(/\s+/);
  for (const w of words) {
    const c = w.replace(/[^A-Za-z']/g, "");
    if (!c) continue;
    if (/^(i|he|she|they|we)$/i.test(c)) return true; // subject pronoun
    if (/^[A-Z][a-z]+$/.test(c) && !_PERSON_COMMON_CAP.has(c.toLowerCase())) return true; // proper name
  }
  return false;
}

function bsDiversity(items) {
  const N = items.length;
  if (N === 0) return { score: 0, breakdown: ["无 item"] };

  // 1) Distinct names — extract "What did NAME" or "(did|does) NAME" patterns
  const names = items.map((it) => {
    const p = String(it.prompt || "");
    const m1 = p.match(/^What did (\w+)/i);
    if (m1) return m1[1].toLowerCase();
    const m2 = p.match(/\b(?:did|does|do|was|were|have|has)\s+(\w+)/i);
    if (m2) return m2[1].toLowerCase();
    return null;
  }).filter(Boolean);
  const distinctNames = new Set(names).size;
  const nameScore = (distinctNames / N) * 15;

  // 2) Distinct scenarios — first 3 content nouns from prompt
  const STOP = new Set([
    "what", "when", "where", "why", "how", "does", "that", "this", "with",
    "about", "from", "want", "know", "ask", "asked", "wanted", "need", "have",
    "there", "their", "would", "should", "could", "will", "before", "after",
    "today", "morning",
  ]);
  const scenarios = items.map((it) => {
    return String(it.prompt || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w))
      .slice(0, 3)
      .join(" ");
  }).filter(Boolean);
  const distinctScenarios = new Set(scenarios).size;
  const scenarioScore = (distinctScenarios / N) * 15;

  // 3) Sentence-type spread (up to 5 types)
  const types = new Set(items.map((it) => classifyBSSentenceType(it.answer)));
  const typeScore = Math.min(types.size, 5) / 5 * 15;

  // 4) Opener-type spread (up to 4 types)
  const openers = new Set(items.map((it) => classifyBSOpener(it.prompt)));
  const openerScore = Math.min(openers.size, 4) / 4 * 15;

  // 5) Prefilled-type spread — calibrated to PREFILLED_PROFILE in etsProfile.js
  //    Real TPO uses 7 types; a healthy batch hits ≥ 4 types AND no single
  //    type exceeds 60% of items. Empty-prefilled also counts as a "type"
  //    (13% of TPO items have no prefilled).
  const pfTypes = items.map((it) => {
    const pf = Array.isArray(it.prefilled) ? it.prefilled : [];
    if (pf.length === 0) return "empty";
    // Use the FIRST segment's type for classification (sufficient signal)
    return classifyPrefilledType(pf[0]) || "unknown";
  });
  const pfTypeCounts = {};
  for (const t of pfTypes) pfTypeCounts[t] = (pfTypeCounts[t] || 0) + 1;
  const distinctPfTypes = Object.keys(pfTypeCounts).length;
  const maxPfTypeFrac = Math.max(...Object.values(pfTypeCounts)) / N;
  // Score: spread (12) + uniformity (13)
  const pfSpreadScore = Math.min(distinctPfTypes, 4) / 4 * 12;
  const pfUniformityScore = maxPfTypeFrac <= 0.6 ? 13 : (maxPfTypeFrac <= 0.75 ? 7 : 0);

  // 6) Person-as-prefilled ratio — the lever verified against TPO.
  //    Real TPO uses a person (pronoun/name) as the prefilled hint ~30% of
  //    the time. Our old batches hit ~60%. Reward staying near/below TPO,
  //    but DON'T reward dropping to ~0% (unnaturally low — TPO is 30%, not 0).
  // Count an item as person-prefilled if ANY of its prefilled segments is a
  // person (matches the TPO measurement methodology in
  // scripts/ops/test-anchor-hypothesis.mjs, which checks all given segments).
  const personPrefilledCount = items.filter((it) => {
    const pf = Array.isArray(it.prefilled) ? it.prefilled : [];
    return pf.some((seg) => isPersonPrefilled(seg));
  }).length;
  const personFrac = personPrefilledCount / N;
  // Ideal band 0.10–0.40 (TPO 0.30 ± headroom). Penalize above 0.40 hard,
  // mild penalty below 0.10 (over-correction guard).
  let personScore;
  if (personFrac > 0.55) personScore = 0;
  else if (personFrac > 0.40) personScore = 7;
  else if (personFrac >= 0.10) personScore = 13;     // healthy TPO-like band
  else personScore = 9;                               // too low — mild penalty

  // 7) Distractor variety — the lever for the distractor regression.
  //    Gates on the COLLAPSE signal (one word dominating / too few distinct),
  //    NOT a precise TPO match — TPO distractors can't be measured precisely
  //    from tpo_source (which-chunk-is-unused requires inference). Robust facts:
  //    TPO uses many distinct distractors and "did" is a minority (<~35%).
  //    Our regression: 71% "did", only ~3 distinct. So score variety directly.
  const distractors = items.map((it) => (it.distractor == null ? null : String(it.distractor).trim().toLowerCase())).filter(Boolean);
  const distractorCounts = {};
  for (const d of distractors) distractorCounts[d] = (distractorCounts[d] || 0) + 1;
  const distinctDistractors = Object.keys(distractorCounts).length;
  const topDistractorCount = distractors.length ? Math.max(...Object.values(distractorCounts)) : 0;
  const topDistractorFrac = distractors.length ? topDistractorCount / distractors.length : 0;
  const topDistractor = Object.entries(distractorCounts).sort((a, b) => b[1] - a[1])[0];
  // Variety score: reward ≥6 distinct AND no single word >50%.
  let distractorScore;
  if (distractors.length === 0) distractorScore = 7; // no distractors at all — odd but not the failure mode
  else if (topDistractorFrac > 0.5 || distinctDistractors < 4) distractorScore = 0;   // collapsed (today's 71% did)
  else if (topDistractorFrac > 0.35 || distinctDistractors < 6) distractorScore = 7;   // borderline
  else distractorScore = 14;                                                            // healthy spread

  // Chunk granularity — VISIBILITY ONLY (no weighted axis, no gate). TPO uses
  // ~6 chunks/item, ~77% single-word (mean 1.3 words/chunk). Recent batches
  // over-bundled (~48% single, ~4.7 chunks). Tracked in detail + the nightly
  // monitor's trend so over-bundling can't silently creep back. Not a hard gate
  // because tightening chunk granularity has an ambiguity trade-off (over-split
  // creates multi-solution items) better judged by the prompt + schema validator.
  let totalChunks = 0, singleWordChunks = 0, effChunkSum = 0;
  for (const it of items) {
    const chunks = Array.isArray(it.chunks) ? it.chunks : [];
    const eff = chunks.filter((c) => String(c).trim().toLowerCase() !== String(it.distractor || "").trim().toLowerCase());
    effChunkSum += eff.length;
    for (const c of chunks) {
      totalChunks += 1;
      if (String(c).trim().split(/\s+/).length === 1) singleWordChunks += 1;
    }
  }
  const singleWordChunkRatio = totalChunks ? singleWordChunks / totalChunks : 0;
  const avgEffChunks = N ? effChunkSum / N : 0;

  // 2nd-person prompt addressing — TPO ~72%, our regression ~10%. Visibility +
  // dedicated gate (see isPromptAddressingLow). No weighted axis (kept off the
  // score formula to avoid another rebalance); the gate enforces it.
  const secondPersonCount = items.filter((it) => isSecondPersonPrompt(it.prompt)).length;
  const secondPersonFrac = N ? secondPersonCount / N : 0;

  // 8 axes: 15+15+15+13+12+13+13+14 = 110 → normalize to /100
  const rawTotal = nameScore + scenarioScore + typeScore + openerScore + pfSpreadScore + pfUniformityScore + personScore + distractorScore;
  const total = rawTotal / 110 * 100;
  const topPfType = Object.entries(pfTypeCounts).sort((a, b) => b[1] - a[1])[0];
  const topPfTypeStr = topPfType ? `${topPfType[0]} ${topPfType[1]}/${N}` : "—";

  return {
    score: Math.round(total),
    breakdown: [
      `角色名 ${distinctNames}/${N}`,
      `场景 ${distinctScenarios}/${N}`,
      `句型 ${types.size}/5`,
      `开头 ${openers.size}/4`,
      `prefilled类型 ${distinctPfTypes}/4 (top:${topPfTypeStr})`,
      `人物当prefilled ${personPrefilledCount}/${N} (${Math.round(personFrac*100)}%, TPO~30%)`,
      `干扰词 ${distinctDistractors}种 (top:${topDistractor ? topDistractor[0] + " " + Math.round(topDistractorFrac*100) + "%" : "—"})`,
      `chunk颗粒 ${avgEffChunks.toFixed(1)}块/题 单词率${Math.round(singleWordChunkRatio*100)}% (TPO~6块/77%)`,
      `题面对话化 ${secondPersonCount}/${N} (${Math.round(secondPersonFrac*100)}% 含you, TPO~72%)`,
    ],
    // Expose detail so the gate script can decide what hints to emit
    detail: {
      pfTypeCounts,
      pfMaxFrac: maxPfTypeFrac,
      distinctPfTypes,
      distinctNames,
      distinctScenarios,
      personPrefilledCount,
      personFrac,
      distinctDistractors,
      topDistractor: topDistractor ? topDistractor[0] : null,
      topDistractorFrac,
      distractorCounts,
      singleWordChunkRatio,
      avgEffChunks,
      secondPersonFrac,
      secondPersonCount,
      itemCount: N,
    },
  };
}

function bsQuality(items) {
  const N = items.length;
  if (N === 0) return { score: 0, breakdown: ["无 item"] };

  let chunkOK = 0, distractorOK = 0, lenOK = 0, sumOK = 0;
  for (const it of items) {
    const chunks = Array.isArray(it.chunks) ? it.chunks : [];
    const prefilled = Array.isArray(it.prefilled) ? it.prefilled : [];
    const distractor = it.distractor;
    const answer = String(it.answer || "");

    const effectiveChunks = distractor ? chunks.length - 1 : chunks.length;
    if (effectiveChunks >= 4 && effectiveChunks <= 7) chunkOK += 1;
    if (distractor) distractorOK += 1;

    const ansWords = answer.trim().split(/\s+/).filter(Boolean).length;
    if (ansWords >= 7 && ansWords <= 15) lenOK += 1;

    const ansTokens = answer.toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter(Boolean).sort();
    const rebuilt = [
      ...chunks.filter((c) => c !== distractor),
      ...prefilled,
    ].join(" ").toLowerCase().replace(/[^a-z0-9\s']/g, " ").split(/\s+/).filter(Boolean).sort();
    if (ansTokens.join(" ") === rebuilt.join(" ")) sumOK += 1;
  }

  const score = (chunkOK + distractorOK + lenOK + sumOK) / (N * 4) * 100;
  return {
    score: Math.round(score),
    breakdown: [
      `块数 ${chunkOK}/${N}`,
      `干扰词 ${distractorOK}/${N}`,
      `答案长度 ${lenOK}/${N}`,
      `重组正确 ${sumOK}/${N}`,
    ],
  };
}

// ── Discussion ──────────────────────────────────────────────────────
function discDiversity(items) {
  const N = items.length;
  if (N === 0) return { score: 0, breakdown: ["无 item"] };

  const courses = new Set(items.map((it) => String(it.course || "").toLowerCase().trim()));
  const courseScore = (courses.size / N) * 30;

  const names = new Set();
  for (const it of items) {
    for (const s of (it.students || [])) {
      if (s.name) names.add(String(s.name).toLowerCase().trim());
    }
  }
  const idealNames = N * 2;
  const nameScore = Math.min(names.size, idealNames) / idealNames * 30;

  const openerOf = (text) => {
    const t = String(text || "").trim().toLowerCase();
    if (t.startsWith("today")) return "today";
    if (t.startsWith("for this week")) return "this_week";
    if (t.startsWith("as we") || t.startsWith("as i")) return "as_discussed";
    if (t.startsWith("over the")) return "over_weeks";
    if (/^[a-z'’]+[\s,]*\?/.test(t)) return "question-first";
    return "natural";
  };
  const openers = new Set(items.map((it) => openerOf(it?.professor?.text)));
  const openerScore = Math.min(openers.size, 4) / 4 * 20;

  const topics = items.map((it) => {
    return String(it?.professor?.text || "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 5)
      .join(" ");
  });
  const distinctTopics = new Set(topics).size;
  const topicScore = (distinctTopics / N) * 20;

  return {
    score: Math.round(courseScore + nameScore + openerScore + topicScore),
    breakdown: [
      `课程 ${courses.size}/${N}`,
      `学生名 ${names.size}/${idealNames}`,
      `开头 ${openers.size}/4`,
      `主题 ${distinctTopics}/${N}`,
    ],
  };
}

function discQuality(items) {
  const N = items.length;
  if (N === 0) return { score: 0, breakdown: ["无 item"] };
  let profOK = 0, s1OK = 0, s2OK = 0;
  for (const it of items) {
    const pl = String(it?.professor?.text || "").length;
    if (pl >= 200 && pl <= 700) profOK += 1;
    const s1l = String(it?.students?.[0]?.text || "").length;
    const s2l = String(it?.students?.[1]?.text || "").length;
    if (s1l >= 250 && s1l <= 700) s1OK += 1;
    if (s2l >= 250 && s2l <= 700) s2OK += 1;
  }
  const score = (profOK + s1OK + s2OK) / (N * 3) * 100;
  return {
    score: Math.round(score),
    breakdown: [`教授段长 ${profOK}/${N}`, `学生1长 ${s1OK}/${N}`, `学生2长 ${s2OK}/${N}`],
  };
}

// ── Email ───────────────────────────────────────────────────────────
function emailDiversity(items) {
  const N = items.length;
  if (N === 0) return { score: 0, breakdown: ["无 item"] };
  const cats = new Set(items.map((it) => String(it.topic || "").trim()));
  const catScore = (cats.size / N) * 40;
  const tos = new Set(items.map((it) => String(it.to || "").toLowerCase().trim()));
  const toScore = (tos.size / N) * 30;
  const subs = new Set(items.map((it) => String(it.subject || "").toLowerCase().trim().slice(0, 25)));
  const subScore = (subs.size / N) * 30;
  return {
    score: Math.round(catScore + toScore + subScore),
    breakdown: [`类别 ${cats.size}/${N}`, `收件人 ${tos.size}/${N}`, `主题 ${subs.size}/${N}`],
  };
}

function emailQuality(items) {
  const N = items.length;
  if (N === 0) return { score: 0, breakdown: ["无 item"] };
  let lenOK = 0, goalsOK = 0, dirOK = 0;
  for (const it of items) {
    const wnum = wc(it.scenario);
    if (wnum >= 30 && wnum <= 60) lenOK += 1;
    const goals = Array.isArray(it.goals) ? it.goals : [];
    if (goals.length === 3) {
      const verbs = new Set(goals.map((g) => String(g).trim().split(/\s+/)[0]?.toLowerCase()));
      if (verbs.size === 3) goalsOK += 1;
    }
    if (/^Write an email/i.test(String(it.direction || "").trim())) dirOK += 1;
  }
  const score = (lenOK + goalsOK + dirOK) / (N * 3) * 100;
  return {
    score: Math.round(score),
    breakdown: [`场景词数 ${lenOK}/${N}`, `3 个不同动词 ${goalsOK}/${N}`, `格式 ${dirOK}/${N}`],
  };
}

// ── Reading (AP/CTW) ────────────────────────────────────────────────
function readingDiversity(items) {
  const N = items.length;
  if (N === 0) return { score: 0, breakdown: ["无 item"] };
  const combos = new Set(items.map((it) => `${it.topic || ""}/${it.subtopic || ""}`.toLowerCase()));
  const disciplines = new Set(items.map((it) => String(it.topic || "").toLowerCase().trim()));
  const comboScore = Math.min(combos.size, N) / N * 50;
  const disScore = Math.min(disciplines.size, N) / N * 50;
  return {
    score: Math.round(comboScore + disScore),
    breakdown: [`话题组合 ${combos.size}/${N}`, `学科 ${disciplines.size}/${N}`],
  };
}

function rdlDiversity(items) {
  const N = items.length;
  if (N === 0) return { score: 0, breakdown: ["无 item"] };
  const subs = new Set(items.map((it) => {
    const sub = String(it.subtopic || "").trim();
    if (sub) return sub.toLowerCase();
    return String(it.text || "").slice(0, 30).toLowerCase();
  }));
  const subScore = Math.min(subs.size, N) / N * 60;
  let notices = 0, emails = 0;
  for (const it of items) {
    if (it.genre === "notice") notices += 1;
    else if (it.genre === "email") emails += 1;
  }
  const balance = 1 - Math.abs(notices - emails) / N;
  const balanceScore = balance * 40;
  return {
    score: Math.round(subScore + balanceScore),
    breakdown: [`话题 ${subs.size}/${N}`, `notice ${notices} · email ${emails}`],
  };
}

// Word count for a reading item. Prefer the explicit word_count field (added
// at merge time), but FALL BACK to counting the actual text when scoring raw
// staging (which has no word_count yet). Without this, scoring staging gave
// every reading item word_count=0 → quality 0 → the gate falsely retried
// reading every night.
function readingWordCount(it) {
  const explicit = Number(it.word_count) || 0;
  if (explicit > 0) return explicit;
  let text = "";
  if (Array.isArray(it.paragraphs) && it.paragraphs.length) text = it.paragraphs.join(" ");
  else if (typeof it.passage === "string") text = it.passage;
  else if (typeof it.text === "string") text = it.text;
  return wc(text);
}

function readingQuality(items, wordMin, wordMax, paraRange = null) {
  const N = items.length;
  if (N === 0) return { score: 0, breakdown: ["无 item"] };
  let wcOK = 0, paraOK = 0;
  for (const it of items) {
    const wcNum = readingWordCount(it);
    if (wcNum >= wordMin && wcNum <= wordMax) wcOK += 1;
    if (paraRange) {
      const pc = Number(it.paragraph_count) || (Array.isArray(it.paragraphs) ? it.paragraphs.length : 0);
      if (pc >= paraRange[0] && pc <= paraRange[1]) paraOK += 1;
    }
  }
  if (paraRange) {
    const score = (wcOK + paraOK) / (N * 2) * 100;
    return { score: Math.round(score), breakdown: [`词数 ${wcOK}/${N}`, `段落数 ${paraOK}/${N}`] };
  }
  const score = wcOK / N * 100;
  return { score: Math.round(score), breakdown: [`词数 ${wcOK}/${N}`] };
}

// ── Listening + Speaking scorers (added 2026-05-31; calibrated to realExam2026) ──
// Diversity = distinct opening fingerprints (cheap proxy; topic/scenario varies by opener).
function openingDiversity(items, textFn) {
  const N = items.length || 1;
  const seen = new Set();
  for (const it of items) {
    const t = String(textFn(it) || "").trim().toLowerCase().split(/\s+/).slice(0, 4).join(" ");
    if (t) seen.add(t);
  }
  const ratio = seen.size / N;
  return { score: Math.round(ratio * 100), breakdown: [`distinct openings ${seen.size}/${N}`] };
}
// Generic word-count-in-range quality over a text extractor.
function rangeQuality(items, textFn, lo, hi, label = "len") {
  const N = items.length || 1;
  let ok = 0;
  for (const it of items) { const w = wc(textFn(it)); if (w >= lo && w <= hi) ok += 1; }
  return { score: Math.round(ok / N * 100), breakdown: [`${label} ${lo}-${hi}: ${ok}/${N}`] };
}
const lcText = (it) => (it.conversation || it.turns || []).map((t) => t.text || "").join(" ");
function repeatQuality(sets) {
  const N = sets.length || 1;
  let clean = 0;
  const PUN = /\b(will result in|suspension|privileges|incur|penalt|violation)\b/i;
  for (const s of sets) {
    const sents = (s.sentences || []).map((x) => x.sentence || x);
    const okCount = sents.length >= 6 && sents.length <= 8;
    const noQ = !sents.some((x) => /\?/.test(x));
    const noPun = !sents.some((x) => PUN.test(x));
    const lenOK = sents.filter((x) => wc(x) >= 3 && wc(x) <= 18).length >= sents.length - 1;
    if (okCount && noQ && noPun && lenOK) clean += 1;
  }
  return { score: Math.round(clean / N * 100), breakdown: [`clean sets ${clean}/${N} (7 sents, no Q, no threat)`] };
}

// ── Main entry ──────────────────────────────────────────────────────
const BANKS = [
  { key: "bs",                  div: bsDiversity,        qual: bsQuality },
  { key: "discussion",          div: discDiversity,      qual: discQuality },
  { key: "email",               div: emailDiversity,     qual: emailQuality },
  // RECALIBRATED 2026-05-31 to realExam2026 lengths (were stale classic-TOEFL ranges
  // that would FAIL real-length items: AP was 220-320 vs real 182; rdl-long 150-250 vs real 80-150).
  { key: "reading-ap",          div: readingDiversity,   qual: (i) => readingQuality(i, 160, 210, [2, 4]) },
  { key: "reading-ctw",         div: readingDiversity,   qual: (i) => readingQuality(i, 60, 95) },
  { key: "reading-rdl-short",   div: rdlDiversity,       qual: (i) => readingQuality(i, 38, 62) },
  { key: "reading-rdl-long",    div: rdlDiversity,       qual: (i) => readingQuality(i, 80, 150) },
  { key: "listening-lat",       div: (i) => openingDiversity(i, (x) => x.transcript), qual: (i) => rangeQuality(i, (x) => x.transcript, 200, 330, "transcript") },
  { key: "listening-lc",        div: (i) => openingDiversity(i, lcText),              qual: (i) => rangeQuality(i, lcText, 75, 110, "conv words") },
  { key: "listening-la",        div: (i) => openingDiversity(i, (x) => x.announcement), qual: (i) => rangeQuality(i, (x) => x.announcement, 55, 120, "announcement") },
  { key: "listening-lcr",       div: (i) => openingDiversity(i, (x) => x.speaker),    qual: (i) => rangeQuality(i, (x) => x.speaker, 3, 14, "prompt words") },
  { key: "speaking-repeat",     div: (i) => openingDiversity(i, (x) => (x.sentences?.[0]?.sentence || x.scenario)), qual: repeatQuality },
];

export function scoreBatch(rootDir, sessionId, results) {
  const perBank = {};
  let weightedDiv = 0, weightedQual = 0, total = 0;

  for (const bank of BANKS) {
    const accepted = results?.[bank.key]?.accepted || 0;
    if (accepted === 0) {
      perBank[bank.key] = {
        diversity: { score: 0, breakdown: ["未生成"] },
        quality: { score: 0, breakdown: ["未生成"] },
      };
      continue;
    }
    const file = resolveStaging(rootDir, bank.key, sessionId);
    const items = loadItems(file);
    if (items.length === 0) {
      perBank[bank.key] = {
        diversity: { score: 0, breakdown: ["找不到 staging 文件"] },
        quality: { score: 0, breakdown: ["找不到 staging 文件"] },
      };
      continue;
    }
    const diversity = bank.div(items);
    const quality = bank.qual(items);
    perBank[bank.key] = { diversity, quality };
    weightedDiv += diversity.score * items.length;
    weightedQual += quality.score * items.length;
    total += items.length;
  }

  return {
    overall: {
      diversity: total > 0 ? Math.round(weightedDiv / total) : 0,
      quality: total > 0 ? Math.round(weightedQual / total) : 0,
    },
    perBank,
  };
}
