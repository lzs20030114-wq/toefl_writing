// 错题池的「从练习记录派生错题」层（纯函数，零题库 import —— 首页侧栏计数也走这里）。
//
// 输入：loadHist().sessions（本地 50 条 / 云端最近 200 条，顺序不定）。
// 输出：entries[]，一条 = 某次练习里答错的一道题（或填词的一空），带：
//   key      跨练习去重用的题 key（规则见 mistakeKey，文档 docs/mistake-notebook-redesign-2026-10-06.md §3.1）
//   brief    渲染一张错题卡所需的小快照（沿用 lib/readingMistakes / lib/listeningMistakes 的 mistake 形状；
//            拼句是 { qid, prompt, userAnswer, correctAnswer, grammar_points }）
//   item     篇级快照（阅读文章 / 听力原文 / 应答单题），按 itemKey 在池里只存一份
//   source   { sid, date, mode, real, mock } —— sid 用 session 的 date（本地记录没有 id，
//            云端乐观插入前也没有；date 从本地到云端保持不变）
//
// 解析逻辑复用现有两个 extractor（它们的字段名与各科 saveSession 是隐式契约，
// 见 2026-05-14 CTW「你的答案」事故）；模考的逐题结果在 details.m1/m2.tasks[] 或 details.tasks[]，
// 这里先展开成「伪练习记录」再喂给同一套 extractor。

import { extractReadingMistakes } from "../readingMistakes";
import { extractListeningMistakes } from "../listeningMistakes";

export const MISTAKE_SUBJECTS = ["bs", "reading", "listening"];

export const SUBTYPE_META = {
  bs: { subject: "bs", label: "拼句", long: "Build a Sentence", unit: "题", quick: true },
  lcr: { subject: "listening", label: "听力应答", long: "Choose a Response", unit: "题", quick: true },
  ctw: { subject: "reading", label: "阅读填词", long: "Complete the Words", unit: "空", quick: false },
  rdl: { subject: "reading", label: "日常阅读", long: "Read in Daily Life", unit: "题", quick: false },
  ap: { subject: "reading", label: "学术阅读", long: "Academic Passage", unit: "题", quick: false },
  la: { subject: "listening", label: "听公告", long: "Announcement", unit: "题", quick: false },
  lc: { subject: "listening", label: "听对话", long: "Conversation", unit: "题", quick: false },
  lat: { subject: "listening", label: "听讲座", long: "Academic Talk", unit: "题", quick: false },
};

export const SUBJECT_META = {
  bs: { label: "拼句", color: "#087355", soft: "#ecfdf5" },
  reading: { label: "阅读", color: "#3B82F6", soft: "#EFF6FF" },
  listening: { label: "听力", color: "#8B5CF6", soft: "#F3E8FF" },
};

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

/** djb2 → base36。老记录缺 id 时给题 key 兜底用，不追求密码学强度。 */
export function shortHash(text) {
  const s = String(text || "");
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function isRealId(id) {
  return typeof id === "string" && id.startsWith("real_");
}

function sourceOf(session, extra = {}) {
  const date = session?.date || null;
  return {
    sid: `${session?.type || "?"}@${date || session?.id || ""}`,
    date,
    mode: session?.mode || null,
    real: !!extra.real,
    mock: !!extra.mock,
  };
}

/* ── 拼句 ─────────────────────────────────────────────── */

export function bsKey(detail) {
  const qid = String(detail?.qid || "").trim();
  if (qid) return `bs:${qid}`;
  return `bs:h:${shortHash(`${detail?.prompt || ""}|${detail?.correctAnswer || ""}`)}`;
}

function bsEntriesFromDetails(details, session, extra = {}) {
  const out = [];
  safeArray(details).forEach((d) => {
    if (!d || d.isCorrect) return;
    const qid = String(d.qid || "").trim();
    out.push({
      key: bsKey(d),
      subject: "bs",
      subtype: "bs",
      itemKey: null,
      index: null,
      brief: {
        qid: qid || null,
        prompt: d.prompt || "",
        userAnswer: d.userAnswer || "",
        correctAnswer: d.correctAnswer || "",
        grammar_points: safeArray(d.grammar_points),
      },
      item: null,
      source: sourceOf(session, { real: isRealId(qid), ...extra }),
    });
  });
  return out;
}

/* ── 阅读 ─────────────────────────────────────────────── */

/** 填词错题卡只给「这个空所在的那一句」当语境，而不是整篇（整篇在「重做这篇」里看）。 */
export function sentenceAround(passage, blank) {
  const text = String(passage || "");
  const word = String(blank?.original_word || "").trim();
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
  if (Number.isInteger(blank?.position)) {
    let count = 0;
    for (const sen of sentences) {
      const n = sen.trim().split(/\s+/).filter(Boolean).length;
      if (blank.position < count + n) {
        if (!word || sen.toLowerCase().includes(word.toLowerCase())) return sen.trim();
        break;
      }
      count += n;
    }
  }
  const hit = word ? sentences.find((sen) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sen)) : null;
  return (hit || text).trim();
}

function readingItemKey(subtype, itemId, passage) {
  return `${subtype}:${itemId || `h${shortHash(String(passage || "").slice(0, 400))}`}`;
}

function readingEntries(session, extra = {}) {
  const groups = extractReadingMistakes([session]);
  if (groups.length === 0) return [];
  const g = groups[0];
  const details = session.details || {};
  const subtype = g.subtype;
  const itemKey = readingItemKey(subtype, g.itemId, details.passage);
  const item = {
    itemKey,
    subject: "reading",
    subtype,
    itemId: g.itemId || null,
    topic: details.topic || details.genre || "",
    genre: details.genre || "",
    passage: details.passage || "",
    blanks: subtype === "ctw" ? safeArray(details.blanks) : undefined,
    questions: subtype !== "ctw" ? safeArray(details.questions) : undefined,
  };
  const real = isRealId(g.itemId) || !!extra.real;
  return g.mistakes.map((m) => {
    const blank = subtype === "ctw" ? (details.results?.[m._index]?.blank || safeArray(details.blanks)[m._index]) : null;
    const pos = subtype === "ctw" ? (Number.isFinite(blank?.position) ? blank.position : m._index) : m._index;
    const { _index, ...brief } = m;
    if (subtype === "ctw" && blank && brief.sentenceContext && brief.sentenceContext === details.passage) {
      brief.sentenceContext = sentenceAround(details.passage, blank);
    }
    return {
      key: subtype === "ctw" ? `${itemKey}#b${pos}` : `${itemKey}#q${m._index}`,
      subject: "reading",
      subtype,
      itemKey,
      index: m._index,
      brief,
      item,
      source: sourceOf(session, { ...extra, real }),
    };
  });
}

/* ── 听力 ─────────────────────────────────────────────── */

function listeningEntries(session, extra = {}) {
  const groups = extractListeningMistakes([session]);
  if (groups.length === 0) return [];
  const g = groups[0];
  const details = session.details || {};
  const subtype = g.subtype;
  const real = !!details.real || isRealId(safeArray(details.itemIds)[0]) || !!extra.real;

  if (subtype === "lcr") {
    const items = safeArray(details.items);
    return g.mistakes.map((m) => {
      const raw = items[m._index] || {};
      const result = safeArray(details.results)[m._index] || {};
      const id = raw.id || result.itemId || safeArray(details.itemIds)[m._index] || null;
      const itemKey = `lcr:${id || `h${shortHash(raw.speaker || m.stem)}`}`;
      const { _index, ...brief } = m;
      return {
        key: itemKey,
        subject: "listening",
        subtype: "lcr",
        itemKey,
        index: null,
        brief,
        item: {
          itemKey,
          subject: "listening",
          subtype: "lcr",
          itemId: id,
          speaker: raw.speaker || m.stem || "",
          options: raw.options || m.options || null,
          answer: raw.answer || m.correctKey || null,
          explanation: raw.explanation || m.explanation || "",
          pragmatic_function: raw.pragmatic_function || null,
          audio_url: raw.audio_url || null,
        },
        source: sourceOf(session, { ...extra, real }),
      };
    });
  }

  const itemId = safeArray(details.itemIds)[0] || null;
  const itemKey = `${subtype}:${itemId || `h${shortHash(String(g.contextText || "").slice(0, 400))}`}`;
  const item = {
    itemKey,
    subject: "listening",
    subtype,
    itemId,
    topic: details.topic || "",
    transcript: details.transcript || "",
    conversation: Array.isArray(details.conversation) ? details.conversation : null,
    questions: safeArray(details.questions),
    audio_url: details.audio_url || null,
    sentence_timings: details.sentence_timings || null,
  };
  return g.mistakes.map((m) => {
    const { _index, ...brief } = m;
    return {
      key: `${itemKey}#q${m._index}`,
      subject: "listening",
      subtype,
      itemKey,
      index: m._index,
      brief,
      item,
      source: sourceOf(session, { ...extra, real }),
    };
  });
}

/* ── 模考展开 ──────────────────────────────────────────── */

const READING_TASKS = new Set(["ctw", "rdl", "ap"]);
const LISTENING_TASKS = new Set(["lcr", "la", "lc", "lat"]);

export function isMockSession(s) {
  if (!s) return false;
  if (s.type === "adaptive-reading" || s.type === "adaptive-listening") return true;
  return (s.type === "reading" || s.type === "listening") && (s.details?.subtype === "mock" || s.mode === "mock");
}

function answeredMcq(r) {
  return r && r.selected != null && r.selected !== "";
}

/** 把一场阅读/听力模考展开成若干条「伪练习记录」，形状对齐各科 saveSession。 */
export function expandMockSession(session) {
  const d = session?.details || {};
  const tasks = [
    ...safeArray(d.m1?.tasks),
    ...safeArray(d.m2?.tasks),
    ...safeArray(d.tasks),
  ];
  const out = [];
  tasks.forEach((t) => {
    if (!t || t.unreached) return;
    const type = t.taskType;
    const results = safeArray(t.results);
    if (results.length === 0) return;
    const base = { type: null, mode: "mock", date: session.date, id: session.id };
    if (READING_TASKS.has(type)) {
      if (type === "ctw") {
        const blanks = safeArray(t.blanks);
        const mapped = results.map((r, i) => {
          const blank = blanks[i] || null;
          const frag = String(blank?.displayed_fragment || "");
          const full = String(r?.userAnswer || "");
          const typed = full.startsWith(frag) ? full.slice(frag.length) : full;
          // 超时自动交卷的空：一个字母没填，不算「做错」。
          if (t.timedOut && !typed.trim()) return { blank, userAnswer: "", fullWord: "", isCorrect: true };
          return { blank, userAnswer: typed, fullWord: typed ? full : "", isCorrect: r?.isCorrect !== false };
        });
        out.push({ ...base, type: "reading", details: { subtype: "ctw", itemId: t.itemId, topic: t.topic, passage: t.passage || "", blanks, results: mapped } });
      } else {
        const mapped = results.map((r, i) => (t.timedOut && !answeredMcq(r) ? { ...r, qIndex: i, isCorrect: true } : { ...r, qIndex: i }));
        out.push({ ...base, type: "reading", details: { subtype: type, itemId: t.itemId, topic: t.topic, passage: t.text || t.passage || "", questions: safeArray(t.questions), results: mapped } });
      }
    } else if (LISTENING_TASKS.has(type)) {
      if (type === "lcr") {
        const mapped = results.map((r) => (t.timedOut && !answeredMcq(r) ? { ...r, itemId: t.itemId, isCorrect: true } : { ...r, itemId: t.itemId }));
        out.push({
          ...base,
          type: "listening",
          details: {
            subtype: "lcr",
            itemIds: [t.itemId],
            items: [{ id: t.itemId, speaker: t.speaker, options: t.options, answer: t.answer, explanation: t.explanation, audio_url: t.audio_url }],
            results: mapped.slice(0, 1),
          },
        });
      } else {
        const mapped = results.map((r, i) => (t.timedOut && !answeredMcq(r) ? { ...r, qIndex: i, isCorrect: true } : { ...r, qIndex: i }));
        out.push({
          ...base,
          type: "listening",
          details: {
            subtype: type,
            itemIds: [t.itemId],
            topic: t.topic || "",
            transcript: t.transcript || t.announcement || t.lecture || t.text || "",
            conversation: t.conversation || null,
            questions: safeArray(t.questions),
            audio_url: t.audio_url || null,
            sentence_timings: t.sentence_timings || null,
            results: mapped,
          },
        });
      }
    }
  });
  return out;
}

/* ── 总入口 ───────────────────────────────────────────── */

/**
 * sessions → entries（按 session 日期从旧到新）。
 * 只认有客观对错的题：拼句、阅读三型、听力四型；写作模考里内嵌的拼句（details.tasks[].meta.details）一并收。
 */
export function extractMistakeEntries(sessions) {
  const list = safeArray(sessions)
    .filter((s) => s && typeof s === "object")
    .slice()
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const out = [];
  for (const s of list) {
    try {
      if (s.type === "bs" && Array.isArray(s.details)) {
        out.push(...bsEntriesFromDetails(s.details, s));
      } else if (s.type === "mock") {
        // 写作模考：拼句逐题在 details.tasks[taskId=bs].meta.details[]
        safeArray(s.details?.tasks).forEach((t) => {
          if (t?.taskId === "bs" && Array.isArray(t?.meta?.details)) {
            out.push(...bsEntriesFromDetails(t.meta.details, s, { mock: true, real: !!s.details?.realMock }));
          }
        });
      } else if (isMockSession(s)) {
        const real = !!(s.details?.realMock || s.details?.real || s.realMock);
        expandMockSession(s).forEach((ps) => {
          if (ps.type === "reading") out.push(...readingEntries(ps, { mock: true, real }));
          else out.push(...listeningEntries(ps, { mock: true, real }));
        });
      } else if (s.type === "reading") {
        out.push(...readingEntries(s));
      } else if (s.type === "listening") {
        out.push(...listeningEntries(s));
      }
    } catch {
      // 单条历史形状异常不能拖垮整本错题本
    }
  }
  return out;
}
