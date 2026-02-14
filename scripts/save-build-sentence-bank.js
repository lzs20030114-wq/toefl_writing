const fs = require("fs");
const path = require("path");
const {
  DIFFICULTIES,
  validateBuildSentenceBank,
} = require("../lib/questionBank/buildSentenceSchema");
const {
  hardFailReasons,
  warnings: qualityWarnings,
} = require("../lib/questionBank/qualityGateBuildSentence");
const { renderResponseSentence } = require("../lib/questionBank/renderResponseSentence");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "buildSentence");

const FUNCTION_WORDS = new Set([
  "the", "a", "an", "to", "of", "and", "or", "but", "from", "that", "this", "it",
  "in", "on", "at", "for", "with", "by", "as", "if", "then", "than", "so", "be",
  "is", "are", "was", "were", "am", "do", "does", "did", "have", "has", "had",
  "before", "after", "about", "into", "over", "under", "already", "please",
]);

const PREP_START_WORDS = new Set([
  "to", "in", "on", "at", "for", "with", "from", "about", "into", "over", "under", "before", "after", "by",
]);

const DETERMINERS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "my", "your", "our", "his", "her", "their",
]);

const TIME_WORDS = new Set([
  "today", "tonight", "tomorrow", "yesterday", "now", "later", "soon", "already", "currently", "recently",
  "immediately", "eventually", "week", "month", "semester", "morning", "afternoon", "evening", "midnight",
]);

const EASY_TEMPLATES = [
  /^(could|can)\s+you\s+\w+/i,
  /^please\s+\w+/i,
  /^i\s+(can|will|should)\s+\w+/i,
  /^we\s+(can|should|need to)\s+\w+/i,
  /^don'?t\s+forget\s+to\s+\w+/i,
];

const ALLOWED_ALT_REASONS = new Set([
  "adverbial_shift",
  "article_optional",
  "possessive_optional",
]);

function parseArgs(argv) {
  const out = {
    input: null,
    allowWarnings: false,
    shuffleRetries: 30,
    maxBuildAttempts: 50,
    ambiguityThreshold: 0.35,
    maxAcceptableOrders: 2,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input" || argv[i] === "-i") {
      out.input = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (argv[i] === "--allow-warnings") {
      out.allowWarnings = true;
      continue;
    }
    if (argv[i] === "--shuffle-retries") {
      out.shuffleRetries = Number(argv[i + 1] || 30) || 30;
      i += 1;
      continue;
    }
    if (argv[i] === "--max-build-attempts") {
      out.maxBuildAttempts = Number(argv[i + 1] || 50) || 50;
      i += 1;
      continue;
    }
    if (argv[i] === "--ambiguity-threshold") {
      out.ambiguityThreshold = Number(argv[i + 1] || 0.35) || 0.35;
      i += 1;
      continue;
    }
    if (argv[i] === "--max-acceptable-orders") {
      out.maxAcceptableOrders = Number(argv[i + 1] || 2) || 2;
      i += 1;
      continue;
    }
  }
  return out;
}

function readInput(inputPath) {
  if (!inputPath) throw new Error("Missing --input <json-file>");
  const abs = path.isAbsolute(inputPath) ? inputPath : path.join(ROOT, inputPath);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function normalizeChunk(v) {
  return String(v || "").trim();
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function samePositionCount(a, b) {
  const n = Math.min(a.length, b.length);
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    if (a[i] === b[i]) count += 1;
  }
  return count;
}

function sameMembers(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

function isLeakyOrder(bank, answerOrder) {
  if (bank.join("||") === answerOrder.join("||")) return true;
  return samePositionCount(bank, answerOrder) >= Math.ceil(answerOrder.length / 2);
}

function shuffleBankSafely(answerOrder, retries = 30) {
  for (let i = 0; i < retries; i += 1) {
    const candidate = shuffle(answerOrder);
    if (!isLeakyOrder(candidate, answerOrder)) return candidate;
  }
  return null;
}

function mergeContentNounPhrases(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const cur = tokens[i];
    const lower = cur.toLowerCase();
    if (!DETERMINERS.has(lower)) {
      out.push(cur);
      continue;
    }

    const phrase = [cur];
    let j = i + 1;
    while (j < tokens.length && phrase.length < 3) {
      const next = tokens[j];
      const nextLower = next.toLowerCase();
      if (FUNCTION_WORDS.has(nextLower)) break;
      if (/^[a-zA-Z][a-zA-Z'-]*$/.test(next) === false) break;
      phrase.push(next);
      j += 1;
    }

    if (phrase.length >= 2) {
      out.push(phrase.join(" "));
      i = j - 1;
    } else {
      out.push(cur);
    }
  }
  return out;
}

function tokenizeResponseSentence(responseSentence) {
  const raw = normalizeChunk(responseSentence);
  if (!raw) return { tokens: [], suffix: "." };

  const m = raw.match(/([.!?])$/);
  const suffix = m ? m[1] : ".";
  const body = m ? raw.slice(0, -1).trim() : raw;

  const rough = body.split(/\s+/).filter(Boolean);
  const tokens = [];

  for (let i = 0; i < rough.length; i += 1) {
    let t = rough[i]
      .replace(/^["'(\[]+/, "")
      .replace(/["'),;:]+$/g, "")
      .trim();
    if (!t) continue;
    if (/^(?:[A-Za-z]\.){2,}$/.test(t)) {
      tokens.push(t);
      continue;
    }
    t = t.replace(/\.$/, "");
    if (!t) continue;
    tokens.push(t);
  }

  const mergedProper = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const cur = tokens[i];
    const next = tokens[i + 1] || "";
    if (/^[A-Z][a-z]+$/.test(cur) && /^[A-Z][a-z]+$/.test(next)) {
      mergedProper.push(`${cur} ${next}`);
      i += 1;
      continue;
    }
    mergedProper.push(cur);
  }

  return { tokens: mergeContentNounPhrases(mergedProper), suffix };
}

function isValidGivenSpan(spanTokens) {
  if (!Array.isArray(spanTokens) || spanTokens.length < 1 || spanTokens.length > 3) return false;
  if (spanTokens.some((t) => /[.,!?;:]/.test(t))) return false;
  if (spanTokens.length === 1) {
    const w = spanTokens[0].toLowerCase();
    if (FUNCTION_WORDS.has(w)) return false;
  }
  const first = String(spanTokens[0] || "").toLowerCase();
  if (PREP_START_WORDS.has(first)) return false;
  const joined = spanTokens.join(" ").toLowerCase();
  if (/^(to|in|on|at|for|with|from|about|into|over|under|before|after|by)\s+(a|an|the)$/.test(joined)) {
    return false;
  }
  return true;
}

function pickStartByDistribution(tokensLength) {
  const maxStart = Math.max(0, tokensLength - 2);
  if (maxStart <= 0) return 0;

  const frontEnd = Math.max(0, Math.floor(maxStart * 0.2));
  const backStart = Math.max(0, Math.floor(maxStart * 0.8));

  const front = [];
  const mid = [];
  const back = [];
  for (let i = 0; i <= maxStart; i += 1) {
    if (i <= frontEnd) front.push(i);
    else if (i >= backStart) back.push(i);
    else mid.push(i);
  }

  const roll = Math.random();
  const bucket = roll < 0.2 ? front : roll < 0.8 ? mid : back;
  const usable = bucket.length > 0 ? bucket : Array.from({ length: maxStart + 1 }, (_, i) => i);
  return usable[Math.floor(Math.random() * usable.length)];
}

function chooseGivenSpan(tokens) {
  if (!Array.isArray(tokens) || tokens.length < 2) return null;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const start = pickStartByDistribution(tokens.length);
    const maxLen = Math.min(3, tokens.length - 1 - start);
    if (maxLen < 1) continue;
    const possibleLens = [];
    for (let len = 1; len <= maxLen; len += 1) {
      const remainder = tokens.length - len;
      if (remainder >= 8 && remainder <= 12) possibleLens.push(len);
    }
    if (possibleLens.length === 0) continue;
    const len = possibleLens[Math.floor(Math.random() * possibleLens.length)];
    const span = tokens.slice(start, start + len);
    if (!isValidGivenSpan(span)) continue;
    return { start, end: start + len - 1, tokens: span };
  }
  return null;
}

function deriveFromResponseSentence(responseSentence) {
  const { tokens, suffix } = tokenizeResponseSentence(responseSentence);
  if (tokens.length < 9 || tokens.length > 15) {
    return { error: `tokenized response length must be 9-15 (got ${tokens.length})` };
  }

  const span = chooseGivenSpan(tokens);
  if (!span) return { error: "cannot find valid given span" };

  const answerOrder = tokens.filter((_, i) => i < span.start || i > span.end);
  return {
    given: span.tokens.join(" "),
    givenIndex: span.start,
    answerOrder,
    responseSuffix: suffix,
  };
}

function countMovableAdverbialChunks(chunks) {
  if (!Array.isArray(chunks)) return 0;
  return chunks.reduce((count, chunk) => {
    const ws = String(chunk || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (ws.length === 0) return count;
    if (TIME_WORDS.has(ws[ws.length - 1]) || TIME_WORDS.has(ws[0])) return count + 1;
    if (PREP_START_WORDS.has(ws[0]) && ws.length >= 2) return count + 1;
    return count;
  }, 0);
}

function matchesEasyTemplate(responseSentence) {
  const raw = normalizeChunk(responseSentence).replace(/[.!?]$/, "");
  if (!raw) return false;
  return EASY_TEMPLATES.some((re) => re.test(raw));
}

function heuristicAmbiguityAssessment(question) {
  const q = question || {};
  const bank = Array.isArray(q.bank) ? q.bank : [];
  const answerOrder = Array.isArray(q.answerOrder) ? q.answerOrder : [];
  const seen = new Map();
  bank.forEach((chunk) => {
    const key = String(chunk || "").toLowerCase();
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  const duplicateChunks = [...seen.values()].filter((n) => n > 1).length;

  const functionLike = answerOrder.filter((chunk) => {
    const ws = String(chunk || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (ws.length !== 1) return false;
    return FUNCTION_WORDS.has(ws[0]);
  }).length;

  const prepStarts = answerOrder.filter((chunk) => {
    const ws = String(chunk || "").toLowerCase().split(/\s+/).filter(Boolean);
    return ws.length > 0 && PREP_START_WORDS.has(ws[0]);
  }).length;

  let score = 0.05;
  score += duplicateChunks * 0.22;
  score += Math.max(0, functionLike - 3) * 0.05;
  score += Math.max(0, prepStarts - 1) * 0.12;

  let numAcceptableOrders = 1;
  if (score >= 0.25) numAcceptableOrders = 2;
  if (score >= 0.45) numAcceptableOrders = 3;

  const reasons = [];
  if (duplicateChunks > 0) reasons.push("duplicate_chunks");
  if (prepStarts > 1) reasons.push("multiple_preposition_starts");
  if (functionLike > 5) reasons.push("too_many_function_tokens");

  return {
    score: Number(Math.min(1, score).toFixed(3)),
    numAcceptableOrders,
    reasons,
  };
}

function buildAlternativeOrder(question) {
  const order = Array.isArray(question?.answerOrder) ? [...question.answerOrder] : [];
  if (order.length < 3) return null;
  for (let i = 0; i < order.length - 1; i += 1) {
    const a = order[i].toLowerCase();
    const b = order[i + 1].toLowerCase();
    if (!FUNCTION_WORDS.has(a) && !FUNCTION_WORDS.has(b)) {
      const alt = [...order];
      [alt[i], alt[i + 1]] = [alt[i + 1], alt[i]];
      return alt;
    }
  }
  return null;
}

function shouldRejectForAmbiguity(question, opts = {}) {
  const directScore = Number.isFinite(Number(question.ambiguityScore)) ? Number(question.ambiguityScore) : null;
  const directOrders = Number.isFinite(Number(question.numAcceptableOrders))
    ? Number(question.numAcceptableOrders)
    : null;

  const assessed = heuristicAmbiguityAssessment(question);
  const ambiguityScore = directScore != null ? directScore : assessed.score;
  const numAcceptableOrders = directOrders != null ? directOrders : assessed.numAcceptableOrders;

  const maxAcceptableOrders = Number(opts.maxAcceptableOrders || 2);
  const ambiguityThreshold = Number(opts.ambiguityThreshold || 0.35);

  const tooManyOrders = numAcceptableOrders > maxAcceptableOrders;
  const overThreshold = ambiguityScore > ambiguityThreshold;

  return {
    reject: tooManyOrders || overThreshold,
    ambiguityScore,
    numAcceptableOrders,
    reasons: [
      ...(tooManyOrders ? ["num_acceptable_orders_exceeded"] : []),
      ...(overThreshold ? ["ambiguity_score_exceeded"] : []),
      ...assessed.reasons,
    ],
  };
}

function normalizeAlternateSources(item) {
  const altOrders = item?.acceptedAnswerOrders || item?.alternateAnswerOrders || item?.alternateOrders || [];
  const altReasons = item?.acceptedReasons || item?.alternateReasons || [];
  return {
    orders: Array.isArray(altOrders) ? altOrders : [],
    reasons: Array.isArray(altReasons) ? altReasons : [],
  };
}

function isWellFormattedSentence(text) {
  const sentence = String(text || "");
  if (!sentence.trim()) return false;
  if (/\s+[,.!?;:]/.test(sentence)) return false;
  if (/\s{2,}/.test(sentence)) return false;
  return true;
}

function sanitizeAlternateOrders(candidate, sourceOrders, sourceReasons, recordDiscard) {
  const sanitizedOrders = [];
  const sanitizedReasons = [];
  const bank = Array.isArray(candidate.bank) ? candidate.bank.map(normalizeChunk) : [];

  for (let i = 0; i < sourceOrders.length && sanitizedOrders.length < 1; i += 1) {
    const order = sourceOrders[i];
    const reason = String(sourceReasons[i] || "").trim();
    if (!Array.isArray(order)) {
      recordDiscard("alternate_invalid_shape");
      continue;
    }
    const normalizedAlt = order.map(normalizeChunk);
    if (normalizedAlt.length !== bank.length || !sameMembers(normalizedAlt, bank)) {
      recordDiscard("alternate_invalid_permutation");
      continue;
    }
    if (!ALLOWED_ALT_REASONS.has(reason)) {
      recordDiscard("alternate_reason_not_allowed");
      continue;
    }
    const rendered = renderResponseSentence(candidate, normalizedAlt, { givenInsertIndex: candidate.givenIndex });
    if (!isWellFormattedSentence(rendered.userSentenceFull)) {
      recordDiscard("alternate_bad_format");
      continue;
    }
    sanitizedOrders.push(normalizedAlt);
    sanitizedReasons.push(reason);
  }

  return { sanitizedOrders, sanitizedReasons };
}

function normalizeItem(
  item,
  {
    shuffleRetries = 30,
    maxBuildAttempts = 50,
    ambiguityThreshold = 0.35,
    maxAcceptableOrders = 2,
    stats,
  } = {}
) {
  const out = { ...item };
  const { orders: sourceAltOrders, reasons: sourceAltReasons } = normalizeAlternateSources(out);

  let responseSentence = "";
  if (isNonEmptyString(out.responseSentence)) responseSentence = out.responseSentence;
  if (!responseSentence && isNonEmptyString(out.response)) responseSentence = out.response;
  if (!responseSentence && isNonEmptyString(out.correctSentence)) responseSentence = out.correctSentence;
  if (!responseSentence && Array.isArray(out.correctChunks) && out.correctChunks.length > 0) {
    responseSentence = `${out.correctChunks.join(" ")}${out.responseSuffix || "."}`;
  }

  const recordDiscard = (reason) => {
    if (!stats) return;
    stats.discarded += 1;
    stats.discardReasons[reason] = (stats.discardReasons[reason] || 0) + 1;
  };

  for (let attempt = 0; attempt < maxBuildAttempts; attempt += 1) {
    const candidate = { ...out };

    if (responseSentence) {
      const derived = deriveFromResponseSentence(responseSentence);
      if (derived.error) {
        recordDiscard(derived.error);
        continue;
      }
      candidate.given = derived.given;
      candidate.givenIndex = derived.givenIndex;
      candidate.answerOrder = derived.answerOrder;
      candidate.responseSuffix = candidate.responseSuffix || derived.responseSuffix || ".";
    }

    if (!Array.isArray(candidate.answerOrder) || candidate.answerOrder.length === 0) {
      throw new Error(`${out.id || "(unknown id)"}: missing answerOrder`);
    }
    if (!Number.isInteger(candidate.givenIndex) || candidate.givenIndex < 0 || candidate.givenIndex > candidate.answerOrder.length) {
      throw new Error(`${out.id || "(unknown id)"}: invalid givenIndex`);
    }

    const cleanOrder = candidate.answerOrder.map(normalizeChunk);

    if (candidate.difficulty === "easy" && responseSentence && !matchesEasyTemplate(responseSentence)) {
      recordDiscard("easy_template_mismatch");
      continue;
    }

    if (countMovableAdverbialChunks(cleanOrder) > 1) {
      recordDiscard("too_many_movable_adverbials");
      continue;
    }

    const safeBank = shuffleBankSafely(cleanOrder, shuffleRetries);
    if (!safeBank) {
      recordDiscard(`cannot build non-leaky bank after ${shuffleRetries} retries`);
      continue;
    }

    candidate.answerOrder = cleanOrder;
    candidate.bank = safeBank;

    const ambiguity = shouldRejectForAmbiguity(candidate, {
      ambiguityThreshold,
      maxAcceptableOrders,
    });
    candidate.ambiguityScore = ambiguity.ambiguityScore;
    candidate.numAcceptableOrders = ambiguity.numAcceptableOrders;

    if (ambiguity.reject) {
      ambiguity.reasons.forEach((reason) => recordDiscard(reason));
      continue;
    }

    if (candidate.numAcceptableOrders === 2) {
      const generatedAlt = buildAlternativeOrder(candidate);
      const generatedAltOrders = generatedAlt ? [...sourceAltOrders, generatedAlt] : sourceAltOrders;
      const generatedReasons = generatedAlt ? [...sourceAltReasons, "adverbial_shift"] : sourceAltReasons;
      const { sanitizedOrders, sanitizedReasons } = sanitizeAlternateOrders(
        candidate,
        generatedAltOrders,
        generatedReasons,
        recordDiscard
      );
      candidate.acceptedAnswerOrders = sanitizedOrders;
      candidate.acceptedReasons = sanitizedReasons;
    } else {
      const { sanitizedOrders, sanitizedReasons } = sanitizeAlternateOrders(
        candidate,
        sourceAltOrders,
        sourceAltReasons,
        recordDiscard
      );
      candidate.acceptedAnswerOrders = sanitizedOrders;
      candidate.acceptedReasons = sanitizedReasons;
    }

    delete candidate.correctChunks;
    delete candidate.responseSentence;
    delete candidate.response;
    delete candidate.correctSentence;
    return candidate;
  }

  throw new Error(`${out.id || "(unknown id)"}: failed to generate valid question after ${maxBuildAttempts} attempts`);
}

function normalizeItemsForSave(items, opts = {}) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => normalizeItem(item, opts));
}

function writeBuckets(items) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const buckets = { easy: [], medium: [], hard: [] };
  items.forEach((item) => {
    if (DIFFICULTIES.has(item.difficulty)) buckets[item.difficulty].push(item);
  });
  Object.keys(buckets).forEach((difficulty) => {
    const outFile = path.join(OUT_DIR, `${difficulty}.json`);
    fs.writeFileSync(outFile, `${JSON.stringify(buckets[difficulty], null, 2)}\n`, "utf8");
  });
}

function collectHardFails(items) {
  const out = [];
  items.forEach((item, index) => {
    const id = item?.id || `item[${index}]`;
    const reasons = hardFailReasons(item || {});
    if (reasons.length > 0) out.push({ id, reasons });
  });
  return out;
}

function collectWarnings(items) {
  const out = [];
  items.forEach((item, index) => {
    const id = item?.id || `item[${index}]`;
    const reasons = qualityWarnings(item || {});
    if (reasons.length > 0) out.push({ id, reasons });
  });
  return out;
}

function evaluateForSave(items, { allowWarnings = false } = {}) {
  const schemaResult = validateBuildSentenceBank(items);
  if (!schemaResult.ok) {
    return {
      ok: false,
      kind: "schema",
      errors: schemaResult.errors,
      hardFails: [],
      warnings: [],
    };
  }

  const hardFails = collectHardFails(items);
  if (hardFails.length > 0) {
    return {
      ok: false,
      kind: "hard_fail",
      errors: [],
      hardFails,
      warnings: [],
    };
  }

  const warnings = collectWarnings(items);
  if (warnings.length > 0 && !allowWarnings) {
    return {
      ok: false,
      kind: "warning_blocked",
      errors: [],
      hardFails: [],
      warnings,
    };
  }

  return {
    ok: true,
    kind: "ok",
    errors: [],
    hardFails: [],
    warnings,
  };
}

function summarizeBatch(items, stats) {
  const total = Array.isArray(items) ? items.length : 0;
  const multiAnswerCount = (items || []).filter((q) => (q.numAcceptableOrders || 1) > 1).length;
  const bankTokenCount = (items || []).reduce((sum, q) => sum + (Array.isArray(q.bank) ? q.bank.length : 0), 0);
  return {
    totalGenerated: total,
    multiAnswerCount,
    multiAnswerRatio: total > 0 ? Number((multiAnswerCount / total).toFixed(3)) : 0,
    avgBankTokenCount: total > 0 ? Number((bankTokenCount / total).toFixed(2)) : 0,
    discarded: stats?.discarded || 0,
    discardReasons: stats?.discardReasons || {},
  };
}

function main() {
  const {
    input,
    allowWarnings,
    shuffleRetries,
    maxBuildAttempts,
    ambiguityThreshold,
    maxAcceptableOrders,
  } = parseArgs(process.argv.slice(2));
  const rawItems = readInput(input);
  const stats = { discarded: 0, discardReasons: {} };

  let items;
  try {
    items = normalizeItemsForSave(rawItems, {
      shuffleRetries,
      maxBuildAttempts,
      ambiguityThreshold,
      maxAcceptableOrders,
      stats,
    });
  } catch (e) {
    console.error(`Input transform failed: ${e.message}`);
    process.exit(1);
  }

  const evalResult = evaluateForSave(items, { allowWarnings });

  if (!evalResult.ok) {
    if (evalResult.kind === "schema") {
      console.error("Input question bank is invalid:");
      evalResult.errors.forEach((e) => console.error(`- ${e}`));
      process.exit(1);
    }
    if (evalResult.kind === "hard_fail") {
      console.error("Input question bank failed quality gate:");
      evalResult.hardFails.forEach((v) => console.error(`- ${v.id}: ${v.reasons.join("; ")}`));
      console.error(`ids: ${evalResult.hardFails.map((v) => v.id).join(", ")}`);
      process.exit(1);
    }
    if (evalResult.kind === "warning_blocked") {
      console.warn("Input question bank warnings:");
      evalResult.warnings.forEach((w) => console.warn(`- ${w.id}: ${w.reasons.join("; ")}`));
      console.warn(`ids: ${evalResult.warnings.map((w) => w.id).join(", ")}`);
      console.error("Warnings are blocked by default. Re-run with --allow-warnings to save anyway.");
      process.exit(1);
    }
  }

  if (evalResult.warnings.length > 0) {
    console.warn("Input question bank warnings:");
    evalResult.warnings.forEach((w) => console.warn(`- ${w.id}: ${w.reasons.join("; ")}`));
    console.warn(`ids: ${evalResult.warnings.map((w) => w.id).join(", ")}`);
  }

  writeBuckets(items);
  console.log("Saved build_sentence question bank:");
  console.log(path.join("data", "buildSentence", "easy.json"));
  console.log(path.join("data", "buildSentence", "medium.json"));
  console.log(path.join("data", "buildSentence", "hard.json"));

  const summary = summarizeBatch(items, stats);
  console.log(`Stats: multi-answer ratio=${summary.multiAnswerRatio} (${summary.multiAnswerCount}/${summary.totalGenerated})`);
  console.log(`Stats: avg bank token count=${summary.avgBankTokenCount}`);
  console.log(`Stats: discarded=${summary.discarded}`);
  if (Object.keys(summary.discardReasons).length > 0) {
    console.log("Stats: discard reason distribution:");
    Object.entries(summary.discardReasons)
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => console.log(`- ${reason}: ${count}`));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  collectHardFails,
  collectWarnings,
  evaluateForSave,
  normalizeItemsForSave,
  tokenizeResponseSentence,
  chooseGivenSpan,
  isLeakyOrder,
  heuristicAmbiguityAssessment,
  countMovableAdverbialChunks,
  summarizeBatch,
};
