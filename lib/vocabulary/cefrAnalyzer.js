import cefrData from "../../data/vocabulary/cefr.json";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;

/* ── stemming: strip common English suffixes to find base form ── */
const SUFFIXES = [
  [/ies$/, "y"],   // countries → country
  [/ves$/, "f"],   // lives → life
  [/ves$/, "fe"],  // wives → wife
  [/ses$/, "s"],   // buses → bus
  [/zes$/, "z"],   // quizzes → quiz
  [/ches$/, "ch"],
  [/shes$/, "sh"],
  [/xes$/, "x"],
  [/s$/, ""],      // cats → cat
  [/ied$/, "y"],   // studied → study
  [/ed$/, "e"],    // used → use
  [/ed$/, ""],     // walked → walk
  [/ing$/, "e"],   // making → make
  [/ing$/, ""],    // walking → walk
  [/ly$/, ""],     // quickly → quick
  [/ness$/, ""],   // happiness → happy (after -ily strip)
  [/ment$/, ""],   // development → develop
  [/tion$/, "te"], // creation → create
  [/er$/, ""],     // bigger → big (rough)
  [/est$/, ""],    // biggest → big (rough)
];

function lookupWord(word) {
  const w = word.toLowerCase().replace(/^'|'$/g, "");
  if (w.length <= 1) return "fn";

  // direct lookup
  const direct = cefrData[w];
  if (direct) return direct;

  // try stripping suffixes
  for (const [re, repl] of SUFFIXES) {
    if (re.test(w)) {
      const stem = w.replace(re, repl);
      if (stem.length >= 2 && cefrData[stem]) return cefrData[stem];
    }
  }

  // try doubled-consonant removal: running → run
  const doubled = w.replace(/(.)(\1)(ing|ed|er|est)$/, "$1$3");
  if (doubled !== w) {
    for (const [re, repl] of SUFFIXES) {
      if (re.test(doubled)) {
        const stem = doubled.replace(re, repl);
        if (stem.length >= 2 && cefrData[stem]) return cefrData[stem];
      }
    }
  }

  return null; // unknown
}

// NOTE (2026-07): A context-blind "upgrade" table that mapped common words to
// rarer CEFR-B2+ synonyms (use→utilize, very→exceedingly, many→a multitude of,
// but→however, ...) was intentionally REMOVED. The official ETS TOEFL Writing
// rubrics reward "precise, idiomatic, appropriate word choice" and vocabulary
// RANGE in service of meaning — never rarity/difficulty. Mechanically swapping a
// correct simple word for a rarer one is exactly the failure mode ETS penalizes
// (inappropriate word choice / non-idiomatic usage). Word-choice suggestions
// should come from the AI grader with sentence context and a precision rationale,
// not from a static common→rare lookup. This module now only DESCRIBES the CEFR
// distribution as neutral reference; it no longer tells users to use harder words.

/**
 * Analyze vocabulary in an essay text.
 * Returns the CEFR-level distribution and per-word results as neutral,
 * descriptive reference — NOT a score to maximize.
 */
export function analyzeVocabulary(text) {
  if (!text || typeof text !== "string") {
    return { words: [], distribution: {}, counts: {}, totalWords: 0, totalCounted: 0, distinctLevels: 0, summary: "" };
  }

  const words = [];
  let match;
  const re = new RegExp(WORD_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const level = lookupWord(raw);
    words.push({ word: raw, level: level || "other", index: match.index });
  }

  // count levels (exclude fn and other)
  const counts = {};
  LEVELS.forEach((l) => (counts[l] = 0));
  let totalCounted = 0;
  for (const w of words) {
    if (w.level !== "fn" && w.level !== "other" && counts[w.level] !== undefined) {
      counts[w.level]++;
      totalCounted++;
    }
  }

  // distribution as percentage
  const distribution = {};
  LEVELS.forEach((l) => {
    distribution[l] = totalCounted > 0 ? Math.round((counts[l] / totalCounted) * 100) : 0;
  });
  // fix rounding to sum to 100
  const sum = LEVELS.reduce((s, l) => s + distribution[l], 0);
  if (sum !== 100 && totalCounted > 0) {
    const maxLevel = LEVELS.reduce((a, b) => (distribution[a] >= distribution[b] ? a : b));
    distribution[maxLevel] += 100 - sum;
  }

  // Neutral, range-aware summary. Framing follows the ETS rubric: word
  // difficulty/CEFR level is NOT a scoring criterion, so we never tell users to
  // "use more advanced words". What IS a real ETS signal is lexical RANGE in
  // service of meaning — a narrow, repetitive lexicon is capped by the "limited
  // range of vocabulary" descriptor — so for a narrow spread we nudge toward
  // more precise/varied word choice, without pushing rarer words for their own sake.
  const distinctLevels = LEVELS.filter((l) => (counts[l] || 0) > 0).length;
  let summary = "";
  if (totalCounted === 0) {
    summary = "未检测到可分析的英文词汇。";
  } else if (distinctLevels <= 2) {
    summary = `你的用词集中在少数几个等级，跨度较窄。词汇等级本身不计入评分——在意思确实需要时选用更准确、更贴切的词即可增加表达层次，不必刻意堆砌难词。`;
  } else {
    summary = `你的用词覆盖了 ${distinctLevels} 个等级，跨度不错。词汇等级本身不计入评分：继续以「准确、地道、贴合语境」为选词标准，避免同一个词反复出现即可。`;
  }

  return { words, distribution, counts, totalWords: words.length, totalCounted, distinctLevels, summary };
}

export { LEVELS };
