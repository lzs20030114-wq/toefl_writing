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
  // 间接疑问句 / 嵌入从句（各种写法）
  "embedded": "间接疑问句",
  "embedded clause": "间接疑问句",
  "embedded interrogative": "间接疑问句",
  "embedded question": "间接疑问句",
  "embedded-question": "间接疑问句",
  "embedded_question": "间接疑问句",
  "1st-embedded": "第一人称间接疑问句",
  "indirect question": "间接疑问句",
  // 接触从句
  "contact clause": "接触从句（省略关系代词）",
  "contact_clause": "接触从句（省略关系代词）",
  "contact clause (omitted relative pronoun)": "接触从句（省略关系代词）",
  // 间接引语
  "reported speech": "间接引语",
  "reporting": "间接引语",
  "reporting verb": "引述动词",
  "3rd-reporting": "第三人称间接引语",
  // 被动语态
  "passive": "被动语态",
  "passive voice": "被动语态",
  "passive progressive": "被动进行时",
  "passive voice (progressive)": "被动进行时",
  "passive-style predicate": "被动式谓语",
  "past passive": "过去时被动语态",
  "past perfect passive": "过去完成时被动",
  "past perfect passive negation": "过去完成时被动否定",
  // 时态
  "simple past": "一般过去时",
  "simple-past": "一般过去时",
  "simple_past": "一般过去时",
  "simple past statement": "一般过去时陈述句",
  "past tense": "一般过去时",
  "past_tense": "一般过去时",
  "simple present": "一般现在时",
  "simple_present": "一般现在时",
  "present_tense": "一般现在时",
  "simple future": "一般将来时",
  "future tense": "将来时",
  "future form": "将来时",
  "future progressive": "将来进行时",
  "past perfect": "过去完成时",
  "past-perfect": "过去完成时",
  "past_perfect": "过去完成时",
  "present perfect": "现在完成时",
  "tense agreement": "时态一致",
  // 从句 / 句式
  "relative": "关系从句",
  "relative clause": "关系从句",
  "relative_pronoun": "关系代词",
  "if": "if 条件从句",
  "if-clause": "if 条件从句",
  "wh-clause": "wh- 从句",
  "whether-clause": "whether 从句",
  "interrogative": "疑问句",
  "direct": "直接语序",
  "3rd person singular": "第三人称单数",
  // 否定
  "negation": "否定结构",
  // 情态动词
  "modal verb": "情态动词",
  // 其他
  "make + object + complement": "make + 宾语 + 补语",
};

const GP_PREFIX = [
  ["embedded question", "间接疑问句"],
  ["embedded", "间接疑问句"],
  ["passive voice", "被动语态"],
  ["passive", "被动语态"],
  ["negation", "否定结构"],
  ["modal verb", "情态动词"],
  ["relative", "关系从句"],
  ["simple past", "一般过去时"],
  ["simple present", "一般现在时"],
  ["simple future", "一般将来时"],
  ["past perfect", "过去完成时"],
  ["present perfect", "现在完成时"],
  ["future", "将来时"],
  ["reported", "间接引语"],
  ["if", "if 条件从句"],
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

  if (normUser === normAnswer) {
    return { isCorrect: true, alternateAccepted: false, acceptedReason: null };
  }

  // Check accepted alternate chunk orderings
  const altOrders = Array.isArray(q.acceptedAnswerOrders) ? q.acceptedAnswerOrders : [];
  const altReasons = Array.isArray(q.acceptedReasons) ? q.acceptedReasons : [];
  for (let i = 0; i < altOrders.length; i++) {
    const { slots: altSlots } = sentenceEngine.buildWordSlots(q, altOrders[i], { lowercase: true });
    const normAlt = altSlots.filter(Boolean).join(" ");
    if (normUser === normAlt) {
      return { isCorrect: true, alternateAccepted: true, acceptedReason: altReasons[i] || null };
    }
  }

  return { isCorrect: false, alternateAccepted: false, acceptedReason: null };
}
