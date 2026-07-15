/**
 * Score a Listen & Repeat attempt against the ETS official 0-5 holistic rubric.
 *
 * New-format TOEFL iBT (2026) "Listen and Repeat" is scored 0-5 as a holistic
 * band by human/automated raters — NOT as a linear word-match percentage. This
 * scorer approximates the official rubric (data/speakingScoring/officialRubrics
 * .json → listenAndRepeat.levels) deterministically (no AI, no network) from the
 * Whisper STT transcript vs. the original prompt.
 *
 * Rubric anchors (paraphrased from the ETS descriptors; see officialRubrics.json
 * for the verbatim source text):
 *   5 — "fully intelligible and an EXACT repetition of the prompt".
 *   4 — "captures the meaning but not exact": one/two function words missing or
 *       changed, a content word missing (long stimuli) or replaced with a related
 *       word, markers of tense/aspect/number wrong, OR two words transposed.
 *   3 — "essentially FULL sentence but does not accurately capture the meaning":
 *       multiple function words changed/missing; one or more content words
 *       missing or substantively changed — but still a complete sentence.
 *   2 — "missing a significant part and/or highly inaccurate": a large portion of
 *       the prompt is missing (typically repeats the first part then stops); NOT a
 *       self-standing sentence; meaning fragmentary.
 *   1 — "very little of the prompt": a minimal response of a few words.
 *   0 — no response / no English / entirely unconnected to the prompt.
 *
 * Returns (shape is backward compatible with the previous scorer; `score` is now
 * an integer 0-5 official band instead of a 0.5-step linear map):
 *   {
 *     accuracy,        // 0-100 — normalized LCS word overlap (for highlight + trend)
 *     matchedWords,    // UI-normalized ORIGINAL word forms that were reproduced
 *     missedWords,     // UI-normalized ORIGINAL word forms that were missed/changed
 *     extraWords,      // UI-normalized transcript words with no counterpart
 *     score,           // 0-5 integer — official holistic band
 *     officialLevel,   // === score, explicit alias
 *     errorBreakdown: { functionWordErrors, contentWordErrors, transpositions },
 *   }
 *
 * IMPORTANT — highlight alignment: matchedWords/missedWords carry the ORIGINAL
 * word forms normalized exactly the way the UI's WordHighlight normalizes them
 * (`w.toLowerCase().replace(/[^\w]/g,"")`), so display uses the real prompt text
 * while matching uses the normalized/expanded form. Contraction/number normal-
 * ization never introduces word-form mismatch in the highlight.
 */

// ── Normalization constants ───────────────────────────────────────────────────

// Common English contractions → expanded word tokens. Keys are lowercased with a
// straight apostrophe (curly apostrophes are normalized before lookup). Expanding
// on BOTH prompt and transcript means "it's" ≡ "it is" is NOT counted as an error
// (it's a transcription-style difference, not a candidate error). `cannot` and a
// few reductions are included here too even though they have no apostrophe.
const CONTRACTIONS = {
  "i'm": ["i", "am"], "you're": ["you", "are"], "he's": ["he", "is"],
  "she's": ["she", "is"], "it's": ["it", "is"], "we're": ["we", "are"],
  "they're": ["they", "are"], "that's": ["that", "is"], "there's": ["there", "is"],
  "here's": ["here", "is"], "what's": ["what", "is"], "who's": ["who", "is"],
  "where's": ["where", "is"], "when's": ["when", "is"], "how's": ["how", "is"],
  "let's": ["let", "us"],
  "i've": ["i", "have"], "you've": ["you", "have"], "we've": ["we", "have"],
  "they've": ["they", "have"], "could've": ["could", "have"],
  "would've": ["would", "have"], "should've": ["should", "have"],
  "might've": ["might", "have"], "must've": ["must", "have"],
  "i'll": ["i", "will"], "you'll": ["you", "will"], "he'll": ["he", "will"],
  "she'll": ["she", "will"], "it'll": ["it", "will"], "we'll": ["we", "will"],
  "they'll": ["they", "will"], "that'll": ["that", "will"],
  "there'll": ["there", "will"], "this'll": ["this", "will"],
  "i'd": ["i", "would"], "you'd": ["you", "would"], "he'd": ["he", "would"],
  "she'd": ["she", "would"], "it'd": ["it", "would"], "we'd": ["we", "would"],
  "they'd": ["they", "would"], "there'd": ["there", "would"],
  "that'd": ["that", "would"],
  "isn't": ["is", "not"], "aren't": ["are", "not"], "wasn't": ["was", "not"],
  "weren't": ["were", "not"], "don't": ["do", "not"], "doesn't": ["does", "not"],
  "didn't": ["did", "not"], "haven't": ["have", "not"], "hasn't": ["has", "not"],
  "hadn't": ["had", "not"], "won't": ["will", "not"], "wouldn't": ["would", "not"],
  "shouldn't": ["should", "not"], "couldn't": ["could", "not"],
  "can't": ["can", "not"], "cannot": ["can", "not"], "mustn't": ["must", "not"],
  "mightn't": ["might", "not"], "needn't": ["need", "not"], "shan't": ["shall", "not"],
  "ain't": ["is", "not"],
  "gonna": ["going", "to"], "wanna": ["want", "to"], "gotta": ["got", "to"],
  "gimme": ["give", "me"], "lemme": ["let", "me"], "y'all": ["you", "all"],
  "o'clock": ["oclock"],
};

// Single-word cardinal numbers ↔ digits (0-100 that are one English word). Compound
// numbers ("twenty-one") are intentionally out of scope. Both directions canonicalize
// to the digit string so "twenty" ≡ "20".
const CARDINAL_WORDS = (() => {
  const map = {};
  const ones = ["zero", "one", "two", "three", "four", "five", "six", "seven",
    "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen", "nineteen"];
  ones.forEach((w, n) => { map[w] = String(n); });
  const tens = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
  Object.entries(tens).forEach(([w, n]) => { map[w] = String(n); });
  return map;
})();

// Single-word ordinal numbers ↔ digit-ordinal form ("first" ≡ "1st").
const ORDINAL_WORDS = {
  first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th",
  sixth: "6th", seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th",
  eleventh: "11th", twelfth: "12th", thirteenth: "13th", fourteenth: "14th",
  fifteenth: "15th", sixteenth: "16th", seventeenth: "17th", eighteenth: "18th",
  nineteenth: "19th", twentieth: "20th", thirtieth: "30th", fortieth: "40th",
  fiftieth: "50th", sixtieth: "60th", seventieth: "70th", eightieth: "80th",
  ninetieth: "90th", hundredth: "100th",
};

// English function words (grammatical words: articles, prepositions, pronouns,
// auxiliaries/modals, conjunctions, particles, common determiners). Errors on these
// are the "minor" tier in the rubric ("one or two function words may be missing or
// changed"). Content-bearing adverbs/verbs/nouns are deliberately NOT listed.
const FUNCTION_WORDS = new Set([
  // articles / determiners
  "a", "an", "the", "this", "that", "these", "those", "some", "any", "no", "every",
  "each", "either", "neither", "all", "both", "half", "enough", "much", "many",
  "more", "most", "few", "fewer", "less", "least", "other", "another", "such",
  "which", "whose", "what", "whatever", "whichever",
  // pronouns
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "its", "our", "their", "mine", "yours", "hers", "ours",
  "theirs", "myself", "yourself", "himself", "herself", "itself", "ourselves",
  "yourselves", "themselves", "one", "ones", "someone", "somebody", "something",
  "anyone", "anybody", "anything", "everyone", "everybody", "everything", "none",
  "nobody", "nothing", "who", "whom", "whoever",
  // prepositions
  "about", "above", "across", "after", "against", "along", "among", "around", "at",
  "before", "behind", "below", "beneath", "beside", "between", "beyond", "by",
  "down", "during", "except", "for", "from", "in", "inside", "into", "like", "near",
  "of", "off", "on", "onto", "out", "outside", "over", "past", "per", "than",
  "through", "throughout", "to", "toward", "towards", "under", "underneath", "until",
  "till", "up", "upon", "with", "within", "without", "via", "unto",
  // conjunctions
  "and", "but", "or", "nor", "so", "yet", "because", "although", "though", "while",
  "whereas", "if", "unless", "when", "whenever", "where", "wherever", "whether",
  "since", "as", "once", "whilst", "plus", "versus",
  // auxiliary / modal verbs (incl. contraction expansions)
  "be", "am", "is", "are", "was", "were", "been", "being", "do", "does", "did",
  "doing", "done", "have", "has", "had", "having", "will", "would", "shall",
  "should", "can", "could", "may", "might", "must", "ought", "need", "dare",
  "going", "want", "got", "let", "give",
  // particles / negation / light adverbs treated as grammatical
  "not", "there", "here", "then", "too", "also", "just", "only", "even", "still",
  "well", "oh", "um", "uh",
]);

// Filler tokens ignored when they appear as extra (inserted) words.
const FILLERS = new Set(["um", "uh", "er", "ah", "mm", "hmm", "mhm", "uhhuh", "erm"]);

// ── Rubric decision thresholds (referenced by the official descriptors above) ─
// Kept as named constants so the mapping to the ETS levels is auditable.
const COMPLETE_COVERAGE_END = 0.7; // reached ≥70% of the prompt → "a full sentence" (levels 3/4/5)
const MAJORITY_CONTENT = 0.5;      // ≥50% content words retained → "essentially full" (level 3+)
const MINIMAL_WORDS = 3;           // ≤3 words → "a minimal response of a few words" (level 1)
const L4_MAX_FUNCTION_ERRORS = 2;  // "one or two function words may be missing or changed" (level 4)
const L4_MAX_CONTENT_ERRORS = 1;   // "a content word may be missing or replaced with a related word" (level 4)

// ── Token helpers ─────────────────────────────────────────────────────────────

// UI-facing normalization — MUST match WordHighlight's normalizeWord exactly so the
// matched/missed pools line up with each rendered original word.
function uiNorm(word) {
  return String(word || "").toLowerCase().replace(/[^\w]/g, "");
}

// Canonicalize a bare alphanumeric token so number spellings equate.
function canonToken(t) {
  if (!t) return t;
  if (/^\d+$/.test(t)) return t;                 // "20" → "20"
  if (/^\d+(st|nd|rd|th)$/.test(t)) return t;    // "1st" → "1st"
  if (CARDINAL_WORDS[t] != null) return CARDINAL_WORDS[t];
  if (ORDINAL_WORDS[t] != null) return ORDINAL_WORDS[t];
  return t;
}

// Expand one raw (already lowercased, apostrophe-normalized) word into normalized
// scoring tokens: contractions split, numbers canonicalized. Returns [] for a
// punctuation-only word.
function expandWord(rawLower) {
  let clean = String(rawLower || "")
    .replace(/^[^a-z0-9']+/g, "")
    .replace(/[^a-z0-9']+$/g, "");
  if (!clean) return [];
  if (CONTRACTIONS[clean]) return CONTRACTIONS[clean].map(canonToken);
  const t = clean.replace(/[^a-z0-9]/g, "");
  if (!t) return [];
  return [canonToken(t)];
}

// Split text into raw whitespace-delimited words (matching the UI's split), after
// lowercasing and normalizing curly apostrophes.
function rawWords(text) {
  return String(text || "")
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

// Build both the per-word "units" (for highlight) and the flattened expanded token
// stream (for scoring), keeping each expanded token's owning unit index.
function buildUnits(text) {
  const words = rawWords(text);
  const units = [];   // { uiNorm, expandedIdx: number[] }
  const tokens = [];  // normalized scoring tokens
  const owner = [];   // owner[k] = unit index of tokens[k]
  for (const w of words) {
    const un = uiNorm(w);
    const expanded = expandWord(w);
    if (!un && expanded.length === 0) continue; // pure punctuation — drop entirely
    const unit = { uiNorm: un, expandedIdx: [] };
    for (const tok of expanded) {
      unit.expandedIdx.push(tokens.length);
      tokens.push(tok);
      owner.push(units.length);
    }
    units.push(unit);
  }
  return { units, tokens, owner };
}

function isFunction(tok) {
  return FUNCTION_WORDS.has(tok);
}

// ── Morphological (tense/aspect/number-marker) equivalence ───────────────────
// Used to reclassify a substitution like walked→walk as a minor marker error
// (rubric groups tense/aspect/number markers with the function-word tier).

function stripInflection(w) {
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  for (const suf of ["ing", "ed", "es", "s", "d"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      let base = w.slice(0, -suf.length);
      // undo consonant doubling: running→runn→run, stopped→stopp→stop
      if ((suf === "ing" || suf === "ed") && base.length >= 2 &&
          base[base.length - 1] === base[base.length - 2] &&
          !"aeiou".includes(base[base.length - 1])) {
        base = base.slice(0, -1);
      }
      return base;
    }
  }
  return w;
}

// Prefix-based inflection check catches the e-dropping cases stripInflection misses
// (arrive→arrives, arrive→arrived) where the stem keeps a trailing silent 'e'.
function prefixInflection(a, b) {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 3 || !l.startsWith(s)) return false;
  const suffix = l.slice(s.length);
  return ["s", "es", "d", "ed", "ing", "n"].includes(suffix);
}

function sameStem(a, b) {
  if (a === b) return true;
  if (stripInflection(a) === stripInflection(b)) return true;
  return prefixInflection(a, b);
}

// ── Alignment (restricted Damerau / Optimal String Alignment) ─────────────────
// Word-level edit alignment supporting adjacent transposition as a single op, so a
// two-word swap costs 1 (not 2 substitutions). Returns an ordered op list.

function alignOSA(O, T) {
  const m = O.length, n = T.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = O[i - 1] === T[j - 1] ? 0 : 1;
      let v = Math.min(
        d[i - 1][j] + 1,         // deletion (orig token missing)
        d[i][j - 1] + 1,         // insertion (extra transcript token)
        d[i - 1][j - 1] + cost,  // match / substitution
      );
      if (i > 1 && j > 1 && O[i - 1] === T[j - 2] && O[i - 2] === T[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1); // adjacent transposition
      }
      d[i][j] = v;
    }
  }
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 1 && j > 1 && O[i - 1] === T[j - 2] && O[i - 2] === T[j - 1] &&
        d[i][j] === d[i - 2][j - 2] + 1) {
      ops.push({ op: "transpose", oi: i - 1, oj: i - 2, tj1: j - 1, tj2: j - 2 });
      i -= 2; j -= 2; continue;
    }
    if (i > 0 && j > 0) {
      const cost = O[i - 1] === T[j - 1] ? 0 : 1;
      if (d[i][j] === d[i - 1][j - 1] + cost) {
        ops.push({ op: cost === 0 ? "match" : "sub", oi: i - 1, tj: j - 1 });
        i--; j--; continue;
      }
    }
    if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: "del", oi: i - 1 });
      i--; continue;
    }
    ops.push({ op: "ins", tj: j - 1 });
    j--;
  }
  ops.reverse();
  return ops;
}

// Longest common subsequence length on normalized tokens — drives the `accuracy`
// display metric (order-preserving overlap), independent of the rubric alignment.
function lcsLength(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Main scorer ───────────────────────────────────────────────────────────────

function emptyResult(missed, extra) {
  return {
    accuracy: 0,
    matchedWords: [],
    missedWords: missed,
    extraWords: extra,
    score: 0,
    officialLevel: 0,
    errorBreakdown: { functionWordErrors: 0, contentWordErrors: 0, transpositions: 0 },
  };
}

/**
 * @param {string} original   — the original prompt sentence
 * @param {string} transcript — the STT transcript of the candidate's repetition
 */
export function scoreRepeat(original, transcript) {
  const orig = buildUnits(original);
  const trans = buildUnits(transcript);

  // Edge: nothing to score against.
  if (orig.tokens.length === 0) {
    return emptyResult([], trans.units.map((u) => u.uiNorm).filter(Boolean));
  }
  // Edge: empty transcript OR no English (e.g. Chinese-only) → level 0.
  if (trans.tokens.length === 0) {
    return emptyResult(orig.units.map((u) => u.uiNorm).filter(Boolean), []);
  }

  const O = orig.tokens;
  const T = trans.tokens;
  const ops = alignOSA(O, T);

  // Per-orig-token flags.
  const presentOrig = new Array(O.length).fill(false); // reproduced (match/transpose/marker)
  const reachedOrig = new Array(O.length).fill(false); // aligned to something (match/sub/transpose)
  const consumedTrans = new Array(T.length).fill(false); // transcript token aligned to orig

  let fnErr = 0, ctErr = 0, transp = 0;

  for (const op of ops) {
    if (op.op === "match") {
      presentOrig[op.oi] = true;
      reachedOrig[op.oi] = true;
      consumedTrans[op.tj] = true;
    } else if (op.op === "transpose") {
      presentOrig[op.oi] = true; presentOrig[op.oj] = true;
      reachedOrig[op.oi] = true; reachedOrig[op.oj] = true;
      if (op.tj1 != null) consumedTrans[op.tj1] = true;
      if (op.tj2 != null) consumedTrans[op.tj2] = true;
      transp++;
    } else if (op.op === "sub") {
      const a = O[op.oi], b = T[op.tj];
      reachedOrig[op.oi] = true;
      consumedTrans[op.tj] = true;
      if (sameStem(a, b)) {
        // tense/aspect/number marker change — minor (function-word tier); the word
        // was still reproduced, so it counts as present for content retention.
        fnErr++;
        presentOrig[op.oi] = true;
      } else if (isFunction(a) || isFunction(b)) {
        fnErr++; // a function word was changed
      } else {
        ctErr++; // a content word was substituted for an unrelated word
      }
    } else if (op.op === "del") {
      if (isFunction(O[op.oi])) fnErr++; else ctErr++;
    } else if (op.op === "ins") {
      const b = T[op.tj];
      if (FILLERS.has(b)) continue; // ignore filler insertions
      if (isFunction(b)) fnErr++; else ctErr++;
    }
  }

  // Coverage: trailing orig tokens never reached ⇒ truncation.
  let tailDeleted = 0;
  for (let k = O.length - 1; k >= 0 && !reachedOrig[k]; k--) tailDeleted++;
  const coverageEnd = (O.length - tailDeleted) / O.length;

  // Content retention.
  let totalContent = 0, presentContent = 0;
  for (let k = 0; k < O.length; k++) {
    if (!isFunction(O[k])) {
      totalContent++;
      if (presentOrig[k]) presentContent++;
    }
  }
  const contentRetention = totalContent > 0 ? presentContent / totalContent : 1;
  const matchedTotal = presentOrig.filter(Boolean).length;
  const transLen = T.length;

  // ── Official level decision ────────────────────────────────────────────────
  let level;
  if (matchedTotal === 0) {
    // No prompt word reproduced at all — entirely unconnected to the prompt.
    level = 0;
  } else if (transLen <= MINIMAL_WORDS && coverageEnd < COMPLETE_COVERAGE_END) {
    // A few words only, most of the prompt missing.
    level = 1;
  } else {
    const complete =
      coverageEnd >= COMPLETE_COVERAGE_END && contentRetention >= MAJORITY_CONTENT;
    if (!complete) {
      // Significant part missing (truncated) and/or highly inaccurate.
      level = 2;
    } else if (fnErr === 0 && ctErr === 0 && transp === 0) {
      level = 5; // exact repetition
    } else if (fnErr <= L4_MAX_FUNCTION_ERRORS && ctErr <= L4_MAX_CONTENT_ERRORS) {
      level = 4; // meaning captured with minor changes
    } else {
      level = 3; // full sentence but meaning not accurately captured
    }
  }

  // ── Highlight pools (original word forms) ───────────────────────────────────
  const matchedWords = [];
  const missedWords = [];
  for (const unit of orig.units) {
    if (!unit.uiNorm) continue;
    const reproduced = unit.expandedIdx.length > 0 &&
      unit.expandedIdx.every((idx) => presentOrig[idx]);
    (reproduced ? matchedWords : missedWords).push(unit.uiNorm);
  }
  const extraWords = [];
  for (const unit of trans.units) {
    if (!unit.uiNorm) continue;
    const anyConsumed = unit.expandedIdx.some((idx) => consumedTrans[idx]);
    const allFiller = unit.expandedIdx.every((idx) => FILLERS.has(T[idx]));
    if (!anyConsumed && !allFiller) extraWords.push(unit.uiNorm);
  }

  // ── Accuracy (normalized LCS overlap) ───────────────────────────────────────
  const denom = Math.max(O.length, T.length);
  const accuracy = denom > 0 ? Math.round((lcsLength(O, T) / denom) * 100) : 0;

  return {
    accuracy,
    matchedWords,
    missedWords,
    extraWords,
    score: level,
    officialLevel: level,
    errorBreakdown: {
      functionWordErrors: fnErr,
      contentWordErrors: ctErr,
      transpositions: transp,
    },
  };
}
