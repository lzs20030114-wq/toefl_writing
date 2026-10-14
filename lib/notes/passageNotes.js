// 原文批注提问：选中原文一处 → 提问 → 回答留成笔记，原文上留高亮。纯函数层（定位 / 切段 / 合并）。
// 设计见 /mnt/project-files/rag/passage-notes-design.md。
//
// 笔记挂在「文章」上（原文签名），不挂在哪次练习记录上：同一篇重做、换入口回看都能看到。
// 原文一个字不改：高亮只存「选中的原文 + 大致位置」，渲染时按文字在原文里重新找，
// 找不到（原文改过）就不画高亮、笔记照样能看。

import { shortHash } from "../mistakes/extract";

export const NOTE_MAX_TURNS = 3;
export const NOTE_MAX_QUOTE = 600;
export const NOTE_MAX_QUESTION = 500;
export const NOTES_MAX_PER_ACCOUNT = 300;
// 选中 ≤ 这么多词按「词 / 短语」处理（和划词词典的门槛一致），更长按「句子」处理。
export const NOTE_PHRASE_MAX_WORDS = 6;

const ws = (s) => String(s || "").replace(/\s+/g, " ").trim();

/** 文章签名：空白归一后整篇的哈希 + 长度。不用题目 id，真题与练习库、模考里的同一篇也认得出来。 */
export function passageKey(passage) {
  const t = ws(passage);
  if (!t) return "";
  return `p${shortHash(t)}-${t.length.toString(36)}`;
}

export function isPhrase(quote) {
  const words = ws(quote).split(" ").filter(Boolean);
  return words.length > 0 && words.length <= NOTE_PHRASE_MAX_WORDS;
}

/** 快捷问题：选的是词 / 短语和选的是句子，问法不一样。 */
export const NOTE_PRESETS = {
  phrase: [
    { id: "forms", label: "列出所有词形", text: "列出这个词的所有词形（词性变化、动词变形、派生词），用词形表列出，各配一个简短例子。" },
    { id: "collocations", label: "常见搭配", text: "这个词 / 短语有哪些常见的固定搭配？原文里用的是哪一种？" },
    { id: "meaning", label: "这里什么意思", text: "它在这句话里是什么意思？" },
  ],
  sentence: [
    { id: "parse", label: "拆解这句", text: "拆解这句：先给主干，再说明各个修饰成分修饰谁，最后给一句通顺的中文意思。" },
    { id: "role", label: "在段里起什么作用", text: "这一处在本段 / 全文的论证里起什么作用？和前后句是什么关系？" },
    { id: "simpler", label: "讲简单点", text: "用最简单的话说说这一处讲了什么。" },
  ],
};

export function presetsFor(quote) {
  return isPhrase(quote) ? NOTE_PRESETS.phrase : NOTE_PRESETS.sentence;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 选中的文字在原文里的位置 { start, end }。先精确找，找不到再放宽空白（选区跨段时浏览器给的换行
 * 和原文不一定一致）。有多处时：落在 sentenceText 那句里的优先，其次离 hint 最近的。
 */
export function locateQuote(passage, quote, { sentenceText = "", hint = null } = {}) {
  const src = String(passage || "");
  const q = String(quote || "").trim();
  if (!src || !q) return null;
  const hits = [];
  const re = new RegExp(q.split(/\s+/).map(escapeRe).join("\\s+"), "g");
  for (const m of src.matchAll(re)) {
    hits.push({ start: m.index, end: m.index + m[0].length });
    if (hits.length > 50) break;
  }
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0];
  const sent = ws(sentenceText);
  if (sent) {
    const inSentence = hits.filter((h) => {
      // 命中处前后各取一句的长度，看能不能拼出那句
      const around = ws(src.slice(Math.max(0, h.start - sent.length), h.end + sent.length));
      return around.includes(sent);
    });
    if (inSentence.length === 1 || (inSentence.length && hint == null)) return inSentence[0];
    if (inSentence.length) hits.splice(0, hits.length, ...inSentence);
  }
  if (hint == null) return hits[0];
  return hits.reduce((best, h) => (Math.abs(h.start - hint) < Math.abs(best.start - hint) ? h : best));
}

/** 原文按空行分段，返回每段（去掉首尾空白后）的文字和在原文里的起点。 */
export function paragraphSpans(passage) {
  const src = String(passage || "");
  const out = [];
  const re = /[^\n]*\S[^\n]*(?:\n(?!\s*\n)[^\n]*)*/g;
  for (const m of src.matchAll(re)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) out.push({ text, start: m.index + lead, end: m.index + lead + text.length });
  }
  return out;
}

/** 当前有效（没删、能在原文里找到）的笔记 → 带位置，按出现顺序编号 1、2、3…。 */
export function placeNotes(passage, notes) {
  const placed = [];
  for (const n of notes || []) {
    if (!n || n.deletedAt) continue;
    const loc = locateQuote(passage, n.quote, { sentenceText: n.sentenceText, hint: n.start });
    placed.push({ note: n, start: loc ? loc.start : null, end: loc ? loc.end : null });
  }
  placed.sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || String(a.note.createdAt).localeCompare(String(b.note.createdAt)));
  return placed.map((p, i) => ({ ...p, index: i + 1 }));
}

/**
 * 把一段文字（在原文里从 textStart 开始）按高亮切开：[{ text, marks: [index…] , first: index|null }]。
 * first：这一小段是某条笔记高亮的结尾 → 在它后面画序号。
 */
export function highlightSegments(text, textStart, placed) {
  const s = String(text || "");
  const end = textStart + s.length;
  const ranges = (placed || []).filter((p) => p.start != null && p.start < end && p.end > textStart);
  if (!ranges.length) return [{ text: s, marks: [], endsNote: [] }];
  const cuts = new Set([0, s.length]);
  for (const r of ranges) {
    cuts.add(Math.max(0, r.start - textStart));
    cuts.add(Math.min(s.length, r.end - textStart));
  }
  const pts = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a === b) continue;
    const absA = textStart + a;
    const absB = textStart + b;
    const covering = ranges.filter((r) => r.start <= absA && r.end >= absB);
    out.push({
      text: s.slice(a, b),
      marks: covering.map((r) => r.index),
      endsNote: covering.filter((r) => r.end === absB).map((r) => r.index),
    });
  }
  return out;
}

/** 笔记卡放在哪一段下面：高亮结尾所在的段；找不到位置的放最后一段。 */
export function notesByParagraph(paragraphs, placed) {
  const by = new Map();
  for (const p of placed || []) {
    let idx = paragraphs.length - 1;
    if (p.end != null) {
      const hit = paragraphs.findIndex((para) => p.end <= para.end + 1);
      if (hit >= 0) idx = hit;
    }
    if (!by.has(idx)) by.set(idx, []);
    by.get(idx).push(p);
  }
  return by;
}

export function newNoteId(now = Date.now()) {
  return `n${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function makeNote({ passage, quote, sentenceText = "", start = null, source = "reading" }, now = new Date()) {
  const iso = now.toISOString();
  return {
    id: newNoteId(now.getTime()),
    passageKey: passageKey(passage),
    quote: String(quote || "").trim().slice(0, NOTE_MAX_QUOTE),
    sentenceText: ws(sentenceText).slice(0, 800),
    start,
    source,
    turns: [],
    createdAt: iso,
    updatedAt: iso,
    deletedAt: null,
  };
}

const time = (v) => {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** 按 id 合并两份笔记：updatedAt 新的赢（删除也带 updatedAt，删除能同步）。 */
export function mergeNotes(a, b) {
  const by = new Map();
  for (const n of [...(a || []), ...(b || [])]) {
    if (!n || !n.id) continue;
    const cur = by.get(n.id);
    if (!cur || time(n.updatedAt) > time(cur.updatedAt)) by.set(n.id, n);
  }
  return [...by.values()];
}

/** 总量封顶：先丢最旧的已删记录，再丢最旧的笔记。 */
export function capNotes(notes, max = NOTES_MAX_PER_ACCOUNT) {
  const list = [...(notes || [])];
  if (list.length <= max) return list;
  list.sort((x, y) => {
    const dx = x.deletedAt ? 0 : 1;
    const dy = y.deletedAt ? 0 : 1;
    return dx - dy || time(x.updatedAt) - time(y.updatedAt);
  });
  return list.slice(list.length - max);
}
