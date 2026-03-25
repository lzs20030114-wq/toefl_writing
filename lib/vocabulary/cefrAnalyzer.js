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

/* ── upgrade suggestions map: low-level word → higher alternative ── */
const UPGRADES = [
  ["good", "A1", "beneficial / favorable", "B2"],
  ["bad", "A1", "detrimental / adverse", "B2"],
  ["big", "A1", "substantial / significant", "B2"],
  ["small", "A1", "minimal / negligible", "B2"],
  ["get", "A1", "obtain / acquire", "B2"],
  ["give", "A1", "provide / furnish", "B2"],
  ["use", "A1", "utilize / employ", "B2"],
  ["show", "A1", "demonstrate / illustrate", "B2"],
  ["help", "A1", "facilitate / assist", "B2"],
  ["make", "A1", "construct / generate", "B2"],
  ["think", "A1", "consider / contemplate", "B2"],
  ["say", "A1", "assert / contend", "B2"],
  ["tell", "A1", "convey / communicate", "B1"],
  ["keep", "A1", "maintain / preserve", "B2"],
  ["start", "A1", "initiate / commence", "B2"],
  ["end", "A1", "conclude / terminate", "B2"],
  ["try", "A1", "attempt / endeavor", "B2"],
  ["ask", "A1", "inquire / request", "B1"],
  ["need", "A1", "require / necessitate", "B2"],
  ["want", "A1", "desire / aspire", "B2"],
  ["like", "A1", "appreciate / favor", "B2"],
  ["look", "A1", "examine / inspect", "B2"],
  ["find", "A1", "discover / identify", "B1"],
  ["go", "A1", "proceed / advance", "B2"],
  ["come", "A1", "arrive / emerge", "B1"],
  ["put", "A1", "place / position", "B1"],
  ["take", "A1", "undertake / assume", "B2"],
  ["lot", "A1", "abundance / multitude", "C1"],
  ["thing", "A1", "aspect / element", "B2"],
  ["way", "A1", "approach / method", "B1"],
  ["important", "A1", "crucial / pivotal", "B2"],
  ["different", "A1", "distinct / diverse", "B2"],
  ["change", "A1", "transform / modify", "B2"],
  ["problem", "A1", "issue / challenge", "B1"],
  ["part", "A1", "component / element", "B2"],
  ["place", "A1", "environment / setting", "B2"],
  ["very", "fn", "exceedingly / remarkably", "C1"],
  ["really", "A1", "genuinely / substantially", "B2"],
  ["many", "fn", "numerous / a multitude of", "B2"],
  ["also", "fn", "furthermore / moreover", "B2"],
  ["but", "fn", "however / nevertheless", "B2"],
  ["so", "fn", "therefore / consequently", "B2"],
  ["because", "fn", "due to / owing to", "B2"],
  ["about", "fn", "regarding / concerning", "B2"],
  ["hard", "A1", "arduous / strenuous", "C1"],
  ["easy", "A1", "straightforward / feasible", "B2"],
  ["fast", "A1", "rapid / swift", "B2"],
  ["old", "A1", "antiquated / longstanding", "C1"],
  ["new", "A1", "novel / innovative", "B2"],
  ["wrong", "A1", "erroneous / flawed", "B2"],
];

/**
 * Analyze vocabulary in an essay text.
 * Returns distribution, per-word results, and upgrade suggestions.
 */
export function analyzeVocabulary(text) {
  if (!text || typeof text !== "string") {
    return { words: [], distribution: {}, counts: {}, totalWords: 0, totalCounted: 0, upgradeSuggestions: [], summary: "" };
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

  // upgrade suggestions: find low-level words actually used
  const usedLower = new Set();
  for (const w of words) {
    usedLower.add(w.word.toLowerCase());
  }
  const upgradeSuggestions = [];
  for (const [orig, origLevel, upgrade, upgradeLevel] of UPGRADES) {
    if (usedLower.has(orig) && upgradeSuggestions.length < 5) {
      upgradeSuggestions.push({ original: orig, level: origLevel, upgrade, upgradeLevel });
    }
  }

  // summary sentence
  const basicPct = (distribution.A1 || 0) + (distribution.A2 || 0);
  const advancedPct = (distribution.B2 || 0) + (distribution.C1 || 0) + (distribution.C2 || 0);
  let summary = "";
  if (totalCounted === 0) {
    summary = "未检测到可分析的英文词汇。";
  } else if (basicPct >= 70) {
    summary = `你的词汇主要集中在基础水平（A1+A2 占 ${basicPct}%），建议在写作中更多使用 B2 及以上词汇来提升表达的学术性。`;
  } else if (advancedPct >= 40) {
    summary = `词汇水平较高（B2+ 占 ${advancedPct}%），继续保持高级词汇的使用，注意词汇的准确性和多样性。`;
  } else {
    summary = `词汇水平中等（A1+A2 占 ${basicPct}%，B2+ 占 ${advancedPct}%），有提升空间，可以尝试用更高级的词替换基础词汇。`;
  }

  return { words, distribution, counts, totalWords: words.length, totalCounted, upgradeSuggestions, summary };
}

export { LEVELS };
