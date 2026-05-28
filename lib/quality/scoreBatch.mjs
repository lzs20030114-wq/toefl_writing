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
    return Array.isArray(j?.items) ? j.items : [];
  } catch {
    return [];
  }
}

function wc(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}

// ── BS: Build Sentence ───────────────────────────────────────────────
function classifyBSSentenceType(answer) {
  const a = String(answer || "").toLowerCase();
  if (/\b(if|whether)\b/.test(a) && /\b(wonder|wondered|curious|want.* to know|asked|wondering)\b/.test(a)) return "indirect-Q";
  if (/\b(not|no longer|never|nothing|nobody|n't)\b/.test(a)) return "negation";
  if (/\bwas\s+\w+ed\s+by\b|\bwere\s+\w+ed\s+by\b/.test(a)) return "passive";
  if (/\b(more|less)\b.*\bthan\b|\b\w+er\s+than\b/.test(a)) return "comparative";
  if (/\b(who|which|whose|that)\s+\w+s?\b/.test(a)) return "relative";
  return "other";
}

function classifyBSOpener(prompt) {
  const p = String(prompt || "").trim();
  if (!p.endsWith("?")) return "statement";
  if (/^what did .+ ask\b/i.test(p)) return "what-did-X-ask";
  if (/^(what|when|where|why|how)\b/i.test(p)) return "wh-Q";
  if (/^(did|do|does|is|are|was|were|have|has|will|would|can|could)\b/i.test(p)) return "yes-no";
  return "wh-Q";
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
  const nameScore = (distinctNames / N) * 20;

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
  const scenarioScore = (distinctScenarios / N) * 20;

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
  // Score: spread (10) + uniformity (10)
  const pfSpreadScore = Math.min(distinctPfTypes, 4) / 4 * 15;
  const pfUniformityScore = maxPfTypeFrac <= 0.6 ? 15 : (maxPfTypeFrac <= 0.75 ? 8 : 0);

  // Per-bank-pre fix this used 4×25 (=100). Now 5 axes: 20+20+15+15+15+15=100
  const total = nameScore + scenarioScore + typeScore + openerScore + pfSpreadScore + pfUniformityScore;
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
    ],
    // Expose detail so the gate script can decide what hints to emit
    detail: {
      pfTypeCounts,
      pfMaxFrac: maxPfTypeFrac,
      distinctPfTypes,
      distinctNames,
      distinctScenarios,
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

function readingQuality(items, wordMin, wordMax, paraRange = null) {
  const N = items.length;
  if (N === 0) return { score: 0, breakdown: ["无 item"] };
  let wcOK = 0, paraOK = 0;
  for (const it of items) {
    const wcNum = Number(it.word_count) || 0;
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

// ── Main entry ──────────────────────────────────────────────────────
const BANKS = [
  { key: "bs",                  div: bsDiversity,        qual: bsQuality },
  { key: "discussion",          div: discDiversity,      qual: discQuality },
  { key: "email",               div: emailDiversity,     qual: emailQuality },
  { key: "reading-ap",          div: readingDiversity,   qual: (i) => readingQuality(i, 220, 320, [3, 4]) },
  { key: "reading-ctw",         div: readingDiversity,   qual: (i) => readingQuality(i, 50, 130) },
  { key: "reading-rdl-short",   div: rdlDiversity,       qual: (i) => readingQuality(i, 35, 80) },
  { key: "reading-rdl-long",    div: rdlDiversity,       qual: (i) => readingQuality(i, 150, 250) },
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
