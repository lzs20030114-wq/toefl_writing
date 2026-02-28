import sentenceEngine from "./questionBank/sentenceEngine";

export function fmt(s) {
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

export function formatLocalDateTime(value) {
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value || "");
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  } catch {
    return String(value || "");
  }
}

export function wc(t) {
  return t.trim() ? t.trim().split(/\s+/).length : 0;
}

export function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function norm(s) {
  return s.toLowerCase().replace(/[.,!?]/g, "").trim();
}

const GP_EXACT = {
  "contact clause": "接触从句（省略关系代词）",
  "contact clause (omitted relative pronoun)": "接触从句（省略关系代词）",
  "indirect question": "间接疑问句",
  "passive progressive": "被动进行时",
  "passive voice (progressive)": "被动进行时",
  "passive-style predicate": "被动式谓语",
  "past perfect passive negation": "过去完成时被动否定",
  "past perfect passive": "过去完成时被动",
  "past perfect": "过去完成时",
  "present perfect": "现在完成时",
  "future form": "将来时",
  "simple past statement": "一般过去时陈述句",
  "reported speech": "间接引语",
  "make + object + complement": "make + 宾语 + 补语",
};

const GP_PREFIX = [
  ["embedded question", "间接疑问句"],
  ["passive voice", "被动语态"],
  ["negation", "否定结构"],
  ["modal verb", "情态动词"],
];

export function translateGrammarPoint(tag) {
  const s = String(tag || "").trim();
  const lower = s.toLowerCase();
  if (GP_EXACT[lower]) return GP_EXACT[lower];
  for (const [prefix, zh] of GP_PREFIX) {
    if (lower.startsWith(prefix)) {
      const suffix = s.slice(prefix.length);
      return suffix.trim() ? zh + suffix : zh;
    }
  }
  return s;
}

/**
 * Evaluate Build a Sentence answer.
 */
export function evaluateBuildSentenceOrder(question, userChunks) {
  const q = question || {};
  const { answerWords, slots } = sentenceEngine.buildWordSlots(q, userChunks, { lowercase: true });
  const normAnswer = answerWords.map((w) => w.toLowerCase()).join(" ");
  const normUser = slots.filter(Boolean).join(" ");
  const isCorrect = normUser === normAnswer;
  return { isCorrect, alternateAccepted: false, acceptedReason: null };
}
