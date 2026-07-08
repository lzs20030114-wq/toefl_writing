"use strict";
/**
 * contentDedup.js — 合库层通用内容去重（零依赖 CJS）
 *
 * 背景：阅读/听力/写作各 live 库此前只按 `id` 去重（merge-staging.mjs 甚至给无 id
 * 的 staging 条目现场铸造新 id），导致同一份内容被合两次必然重复（实锤：AP
 * ap_mpveuehi_0 ≡ ap_mq45tobz_23 逐字相同）。本模块提供一层「内容指纹 + 模糊近重复」
 * 检测，供 merge-staging.mjs / mergeClaude.mjs 在入库前拦截。
 *
 * 设计要点：
 *   - contentKey：同一份内容 → 同一指纹（词集去重排序），exact 命中 O(1)。
 *   - jaccard：词集相似度，跨条线性扫描做 near 近重复判定。
 *   - extractText：按题型取「正文」；未知题型走 fallback(JSON.stringify 去易变字段)，
 *     保证未来新增题型自动被覆盖，不会因为漏配字段而静默漏检。
 *   - 任何字段缺失 / 空文本都不 throw：返回 { dup:false, warning }，绝不阻断合库。
 *
 * 用法（check-then-add，务必先 check 再 add，避免自匹配）：
 *   const idx = createDedupIndex(bank.items, type);
 *   for (const item of newItems) {
 *     const r = checkDuplicate(idx, item, type);
 *     if (r.dup) { skip & count; continue; }
 *     addToIndex(idx, item, type);
 *     merge(item);
 *   }
 */

// ── 小停用词表（~30 词）───────────────────────────────────────────────
// normalizeWords 已先过滤 len<=2 的词，故这里只需列 3+ 字母的高频功能词。
const STOPWORDS = new Set([
  "the", "and", "are", "was", "were", "been", "being",
  "have", "has", "had", "will", "would", "could", "should", "does", "did",
  "that", "this", "with", "from", "about", "into", "than", "then",
  "they", "them", "their", "not", "but", "for", "your", "you",
]);

// fallback 指纹前先删掉这些「易变/非内容」字段，保证同内容不同 id/配音 → 同指纹。
const FALLBACK_STRIP = ["id", "audio_url", "_audit", "created_at", "generated_at"];

// 各题型默认近重复阈值；未列出的题型统一用 DEFAULT_THRESHOLD。
// BS 0.75 对齐 scripts/generateBSQuestions.mjs 既有的 ANSWER_SIMILARITY_THRESHOLD。
const DEFAULT_THRESHOLDS = { bs: 0.75, discussion: 0.8, email: 0.8 };
const DEFAULT_THRESHOLD = 0.85;

function asText(v) {
  return v == null ? "" : String(v);
}

/**
 * normalizeWords(text) → 词数组：小写 → 去非字母数字 → split → 过滤 len<=2 与停用词。
 */
function normalizeWords(text) {
  if (text == null) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * contentKey(text) → 内容指纹：normalizeWords 去重 → 排序 → join("|")。
 * 同一词集（无视词序 / 标点 / 大小写）→ 同一 key。
 */
function contentKey(text) {
  const uniq = Array.from(new Set(normalizeWords(text))).sort();
  return uniq.join("|");
}

/**
 * jaccard(setA, setB) → 交集/并集。接受 Set 或数组（数组会内部转 Set）。
 * 任一为空 → 0（空文本不误判为重复）。
 */
function jaccard(setA, setB) {
  const a = setA instanceof Set ? setA : new Set(setA);
  const b = setB instanceof Set ? setB : new Set(setB);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * fallback 指纹：浅拷贝 item、删掉 FALLBACK_STRIP 字段后 JSON.stringify。
 * 保证未来新增题型（未在 extractText 显式配字段）也能按整条内容去重，
 * 且 id/audio_url 等易变字段不影响指纹。
 */
function fallbackText(item) {
  const copy = {};
  for (const k of Object.keys(item)) {
    if (FALLBACK_STRIP.includes(k)) continue;
    copy[k] = item[k];
  }
  try {
    return JSON.stringify(copy);
  } catch (_) {
    return "";
  }
}

/**
 * extractText(type, item) → 该题型的「正文」文本。字段表见 CLAUDE.md / 任务描述。
 * 未知 type 走 fallbackText。任何缺字段都安全返回 ""，绝不 throw。
 */
function extractText(type, item) {
  if (!item || typeof item !== "object") return "";
  switch (type) {
    case "ap":
    case "ctw":
      return asText(item.passage);

    case "rdl":
    case "rdl-short":
    case "rdl-long":
      return asText(item.text);

    case "la":
      return asText(item.announcement);

    case "lat":
      return asText(item.transcript);

    case "lc": {
      // conversation: [{ speaker, text }, ...] → 拼各 text
      const conv = Array.isArray(item.conversation) ? item.conversation : [];
      return conv.map((t) => asText(t && t.text)).join(" ");
    }

    case "lcr": {
      // speaker + 全部 options 值（A-D 对象）拼接
      const opts =
        item.options && typeof item.options === "object"
          ? Object.values(item.options).map(asText)
          : [];
      return [asText(item.speaker), ...opts].join(" ");
    }

    case "repeat":
    case "rpt": {
      // sentences: [{ sentence, ... }, ...] → 拼各 sentence
      const sents = Array.isArray(item.sentences) ? item.sentences : [];
      return sents.map((s) => asText(s && s.sentence)).join(" ");
    }

    case "interview":
    case "intv": {
      // intro + 各 question
      const qs = Array.isArray(item.questions) ? item.questions : [];
      return [asText(item.intro), ...qs.map((q) => asText(q && q.question))].join(" ");
    }

    case "discussion":
    case "disc": {
      // professor 可能是 { text } 对象或裸字符串
      const p = item.professor;
      if (p && typeof p === "object") return asText(p.text);
      return asText(p);
    }

    case "email":
      return asText(item.scenario);

    case "bs":
      return asText(item.answer);

    default:
      return fallbackText(item);
  }
}

function idOf(item) {
  return item && item.id != null ? item.id : null;
}

/**
 * createDedupIndex(items, type) → { type, keyToId:Map, entries:[{id, wordSet}] }
 * keyToId 用于 exact O(1) 命中；entries 用于 near 线性 jaccard 扫描。
 */
function createDedupIndex(items, type) {
  const index = { type, keyToId: new Map(), entries: [] };
  const list = Array.isArray(items) ? items : [];
  for (const it of list) addToIndex(index, it, type);
  return index;
}

/**
 * addToIndex(index, item, type) → 把 item 收进 index（先 check 再 add）。
 * 空文本条目不登记 keyToId（避免两条空文本互判重复），但仍入 entries（jaccard 恒 0，无害）。
 */
function addToIndex(index, item, type) {
  const t = type || (index && index.type);
  const text = extractText(t, item);
  const key = contentKey(text);
  const id = idOf(item);
  const wordSet = new Set(normalizeWords(text));
  if (key !== "" && !index.keyToId.has(key)) index.keyToId.set(key, id);
  index.entries.push({ id, wordSet });
  return index;
}

/**
 * checkDuplicate(index, item, type, opts) → 判定 item 是否与 index 内容重复。
 *   { dup:true, reason:"exact", matchId, score:1 }
 *   { dup:true, reason:"near", score, matchId }
 *   { dup:false, score:maxScore }               // 未命中
 *   { dup:false, score:0, warning:"empty-text" } // 空/缺字段，永不判重、永不 throw
 * 先查 exact key（O(1)），再线性 jaccard。threshold = opts.threshold ?? DEFAULT_THRESHOLDS[type] ?? 0.85。
 */
function checkDuplicate(index, item, type, opts) {
  opts = opts || {};
  const t = type || (index && index.type);
  const text = extractText(t, item);

  // 空文本 / 字段缺失：不判重、不 throw
  if (!text || !text.trim()) {
    return { dup: false, score: 0, warning: "empty-text" };
  }

  // 1) exact 指纹命中 — O(1)
  const key = contentKey(text);
  if (key !== "" && index.keyToId.has(key)) {
    return { dup: true, reason: "exact", matchId: index.keyToId.get(key), score: 1 };
  }

  // 2) near 近重复 — 线性 jaccard
  const threshold =
    opts.threshold != null
      ? opts.threshold
      : DEFAULT_THRESHOLDS[t] != null
        ? DEFAULT_THRESHOLDS[t]
        : DEFAULT_THRESHOLD;

  const wordSet = new Set(normalizeWords(text));
  let best = 0;
  let bestId = null;
  for (const e of index.entries) {
    if (e.wordSet.size === 0) continue;
    const s = jaccard(wordSet, e.wordSet);
    if (s > best) {
      best = s;
      bestId = e.id;
    }
  }
  if (best >= threshold) {
    return { dup: true, reason: "near", score: best, matchId: bestId };
  }
  return { dup: false, score: best };
}

module.exports = {
  normalizeWords,
  contentKey,
  jaccard,
  extractText,
  createDedupIndex,
  checkDuplicate,
  addToIndex,
  DEFAULT_THRESHOLDS,
  DEFAULT_THRESHOLD,
};
