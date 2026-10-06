// 「练错题」的纯函数层：错题池 → 可抽取单位 → 按条件抽题 → 拆成若干「组」(stage) → 判分回写。
// 不 import 任何题库；拼句按 qid 回查原题在 components/mistakes/MistakeDrill.js 里做（只在 /mistake-drill 路由加载）。
//
// 抽取单位（docs/mistake-notebook-redesign-2026-10-06.md §0）：
//   拼句 / 听力应答  → 一题一个单位，可任意混组
//   阅读填词         → 一篇一个单位（整篇重做，只统计错过的空）
//   阅读选择 / 听力选择 → 一篇一个单位（只问错过的题）

import { activeCards } from "./pool";

export const DRILL_TYPES = [
  { id: "bs", label: "拼句", subtypes: ["bs"], unit: "题", pro: false, hint: "一题一题做" },
  { id: "lcr", label: "听力应答", subtypes: ["lcr"], unit: "题", pro: true, hint: "一题一题做" },
  { id: "ctw", label: "阅读填词", subtypes: ["ctw"], unit: "篇", pro: true, hint: "整篇重做，只统计错过的空" },
  { id: "read", label: "阅读选择", subtypes: ["rdl", "ap"], unit: "篇", pro: true, hint: "按篇做，只问错过的题" },
  { id: "listen", label: "听力选择", subtypes: ["la", "lc", "lat"], unit: "篇", pro: true, hint: "按篇听，只问错过的题" },
];

export const DRILL_SOURCES = [
  { id: "all", label: "全部错题" },
  { id: "starred", label: "只练收藏" },
  { id: "undrilled", label: "还没重做过" },
  { id: "recent7", label: "最近 7 天错的" },
  { id: "repeated", label: "错过 2 次以上" },
  { id: "lastWrong", label: "上次重做又错的" },
];

export const DRILL_COUNTS = [5, 10, 20, 0]; // 0 = 全部
export const DRILL_ORDERS = [
  { id: "random", label: "随机" },
  { id: "recent", label: "最近错的优先" },
  { id: "most", label: "错得多的优先" },
];

const TYPE_BY_SUBTYPE = {};
DRILL_TYPES.forEach((t) => t.subtypes.forEach((st) => { TYPE_BY_SUBTYPE[st] = t.id; }));
export function drillTypeOf(subtype) {
  return TYPE_BY_SUBTYPE[subtype] || null;
}

const PASSAGE_SUBTYPES = new Set(["ctw", "rdl", "ap", "la", "lc", "lat"]);

function laterIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(b) > new Date(a) ? b : a;
}

/**
 * 池 → 单位。篇章题按 itemKey 合成一个单位；快照被配额精简过的篇不能重做（available=false）。
 * blockedKeys：调用方核对过、原题已经找不到的卡（拼句按 qid 回查失败）—— 不进可抽范围，
 * 这样「抽 10 题」抽出来的就是 10 道能做的题，而不是抽完再悄悄丢掉几道。
 */
export function buildUnits(pool, { blockedKeys } = {}) {
  const units = [];
  const byItem = new Map();
  const blocked = blockedKeys instanceof Set ? blockedKeys : new Set(blockedKeys || []);
  for (const c of activeCards(pool)) {
    if (blocked.has(c.key)) continue;
    const type = drillTypeOf(c.subtype);
    if (!type) continue;
    if (!PASSAGE_SUBTYPES.has(c.subtype)) {
      const lcrItem = c.subtype === "lcr" ? pool.items?.[c.itemKey] : null;
      units.push({
        id: c.key,
        type,
        subtype: c.subtype,
        cardKeys: [c.key],
        size: 1,
        lastWrongAt: c.lastWrongAt,
        firstWrongAt: c.firstWrongAt,
        wrongCount: c.wrongCount || 1,
        starred: !!c.starred,
        undrilled: !c.lastDrill,
        lastDrillWrong: !!(c.lastDrill && !c.lastDrill.correct),
        available: c.subtype === "bs" ? true : !!(lcrItem && lcrItem.options && !lcrItem.pruned),
      });
      continue;
    }
    const k = c.itemKey || c.key;
    let u = byItem.get(k);
    if (!u) {
      const item = pool.items?.[k];
      u = {
        id: k,
        type,
        subtype: c.subtype,
        itemKey: k,
        cardKeys: [],
        size: 0,
        lastWrongAt: null,
        firstWrongAt: null,
        wrongCount: 0,
        starred: false,
        undrilled: false,
        lastDrillWrong: false,
        topic: item?.topic || "",
        available: !!(item && !item.pruned && (c.subtype === "ctw" ? Array.isArray(item.blanks) && item.blanks.length > 0 && item.passage : Array.isArray(item.questions) && item.questions.length > 0)),
      };
      byItem.set(k, u);
      units.push(u);
    }
    u.cardKeys.push(c.key);
    u.size += 1;
    u.lastWrongAt = laterIso(u.lastWrongAt, c.lastWrongAt);
    u.firstWrongAt = u.firstWrongAt && c.firstWrongAt && new Date(u.firstWrongAt) < new Date(c.firstWrongAt) ? u.firstWrongAt : (c.firstWrongAt || u.firstWrongAt);
    u.wrongCount = Math.max(u.wrongCount, c.wrongCount || 1);
    u.starred = u.starred || !!c.starred;
    u.undrilled = u.undrilled || !c.lastDrill;
    u.lastDrillWrong = u.lastDrillWrong || !!(c.lastDrill && !c.lastDrill.correct);
  }
  return units;
}

export function filterUnits(units, { types, source = "all", now = Date.now() } = {}) {
  const typeSet = types ? new Set(types) : null;
  const weekAgo = now - 7 * 86400000;
  return (units || []).filter((u) => {
    if (!u.available) return false;
    if (typeSet && !typeSet.has(u.type)) return false;
    switch (source) {
      case "starred": return u.starred;
      case "undrilled": return u.undrilled;
      case "recent7": return new Date(u.lastWrongAt || 0).getTime() >= weekAgo;
      case "repeated": return u.wrongCount >= 2;
      case "lastWrong": return u.lastDrillWrong;
      default: return true;
    }
  });
}

/** 可复现的伪随机（mulberry32），「换一批」换 seed 即可。 */
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 按「题数」抽：快练单位每个算 1 题，篇章单位算它错过的题数（整篇不拆）。
 * count=0 表示全部。至少抽 1 个单位。
 */
export function pickUnits(units, { count = 10, order = "random", seed = 1 } = {}) {
  const list = (units || []).slice();
  if (order === "recent") {
    list.sort((a, b) => new Date(b.lastWrongAt || 0) - new Date(a.lastWrongAt || 0));
  } else if (order === "most") {
    list.sort((a, b) => (b.wrongCount - a.wrongCount) || (new Date(b.lastWrongAt || 0) - new Date(a.lastWrongAt || 0)));
  } else {
    const r = rng(seed);
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(r() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  if (!count) return list;
  const out = [];
  let total = 0;
  for (const u of list) {
    if (total >= count) break;
    // 篇章单位会让总题数超出很多时，先看后面有没有更小的单位能补齐
    if (out.length > 0 && total + u.size > count + Math.max(2, Math.round(count * 0.3))) continue;
    out.push(u);
    total += u.size;
  }
  if (out.length === 0 && list.length > 0) out.push(list[0]);
  return out;
}

export function unitsQuestionCount(units) {
  return (units || []).reduce((n, u) => n + (u.size || 0), 0);
}

const LISTENING_TITLES = {
  la: "Listen to an Announcement",
  lc: "Listen to a Conversation",
  lat: "Listen to an Academic Talk",
};

export const DRILL_ID_SUFFIX = "__drill";

/**
 * 单位 → 组。拼句一组（题目由调用方按 qid 回查后填进 stage.questions）、应答一组、每篇一组。
 * 篇章组的 item 换新 id（`${itemId}__drill`），不和常规练习的草稿串。
 */
export function buildStages(units, pool, { bsQuestions = {} } = {}) {
  const cards = pool?.cards || {};
  const items = pool?.items || {};
  const bsUnits = units.filter((u) => u.subtype === "bs");
  const lcrUnits = units.filter((u) => u.subtype === "lcr");
  const passageUnits = units.filter((u) => PASSAGE_SUBTYPES.has(u.subtype));
  const stages = [];

  if (bsUnits.length > 0) {
    // bsQuestions：{ 卡 key → 题库原题 }，由调用方按 qid / 题面回查好；回查不到的单位在 buildUnits 时就被挡掉了
    const questions = [];
    const keyByQid = {};
    bsUnits.forEach((u) => {
      const key = u.cardKeys[0];
      const q = bsQuestions[key];
      if (!q || keyByQid[String(q.id)]) return;
      keyByQid[String(q.id)] = key;
      questions.push(q);
    });
    if (questions.length > 0) {
      stages.push({ kind: "bs", label: "拼句", questions, keyByQid, cardKeys: Object.values(keyByQid) });
    }
  }

  if (lcrUnits.length > 0) {
    const lcrItems = [];
    const keyByItemId = {};
    lcrUnits.forEach((u) => {
      const card = cards[u.cardKeys[0]];
      const it = items[card?.itemKey];
      if (!it) return;
      const baseId = it.itemId || card.itemKey;
      const id = `${baseId}${DRILL_ID_SUFFIX}`;
      keyByItemId[id] = card.key;
      lcrItems.push({
        id,
        speaker: it.speaker,
        options: it.options,
        answer: it.answer,
        explanation: it.explanation,
        pragmatic_function: it.pragmatic_function,
        audio_url: it.audio_url || null,
      });
    });
    if (lcrItems.length > 0) {
      stages.push({ kind: "lcr", label: "听力应答", items: lcrItems, keyByItemId, cardKeys: Object.values(keyByItemId) });
    }
  }

  passageUnits.forEach((u) => {
    const it = items[u.itemKey];
    if (!it) return;
    const unitCards = u.cardKeys.map((k) => cards[k]).filter(Boolean);
    const baseId = `${it.itemId || u.itemKey}${DRILL_ID_SUFFIX}`;
    if (u.subtype === "ctw") {
      const blanks = Array.isArray(it.blanks) ? it.blanks : [];
      // 每个错过的空 → 它在 blanks 里的下标（按 position 对，老数据退回下标）
      const keyByIndex = {};
      unitCards.forEach((c) => {
        const m = String(c.key).match(/#b(\d+)$/);
        const pos = m ? Number(m[1]) : c.index;
        let idx = blanks.findIndex((b) => Number(b?.position) === pos);
        if (idx < 0 && Number.isInteger(c.index) && c.index < blanks.length) idx = c.index;
        if (idx >= 0) keyByIndex[idx] = c.key;
      });
      stages.push({
        kind: "ctw",
        label: "阅读填词",
        item: { id: baseId, passage: it.passage, blanks, topic: it.topic || "" },
        keyByIndex,
        cardKeys: Object.values(keyByIndex),
      });
      return;
    }
    const questions = Array.isArray(it.questions) ? it.questions : [];
    const picked = unitCards
      .filter((c) => Number.isInteger(c.index) && questions[c.index])
      .sort((a, b) => a.index - b.index);
    if (picked.length === 0) return;
    const keyByIndex = {};
    picked.forEach((c, i) => { keyByIndex[i] = c.key; });
    const qs = picked.map((c) => questions[c.index]);
    if (u.subtype === "rdl" || u.subtype === "ap") {
      stages.push({
        kind: "rdl",
        subtype: u.subtype,
        label: u.subtype === "ap" ? "学术阅读" : "日常阅读",
        title: u.subtype === "ap" ? "Academic Passage" : "Read in Daily Life",
        item: { id: baseId, text: it.passage, passage: it.passage, genre: it.genre || it.topic || "", topic: it.topic || "", questions: qs },
        keyByIndex,
        cardKeys: Object.values(keyByIndex),
      });
    } else {
      stages.push({
        kind: "listen",
        subtype: u.subtype,
        label: u.subtype === "la" ? "听公告" : u.subtype === "lc" ? "听对话" : "听讲座",
        title: LISTENING_TITLES[u.subtype],
        item: {
          id: baseId,
          topic: it.topic || "",
          transcript: it.transcript || "",
          conversation: it.conversation || null,
          audio_url: it.audio_url || null,
          sentence_timings: it.sentence_timings || null,
          questions: qs,
        },
        keyByIndex,
        cardKeys: Object.values(keyByIndex),
      });
    }
  });
  return stages;
}

function optionAnswer(options, selected) {
  if (selected == null || selected === "") return "";
  const text = options && typeof options === "object" ? options[selected] : null;
  return text ? `${selected}. ${text}` : String(selected);
}

/**
 * 一组的作答结果 → [{ key, correct, answer, selected }]（只回报这组里「错过的那几题 / 空」）。
 * answer / selected 是这一次的作答，结算页拿它和错题本里记的上次错答比「是不是又犯同一个错」。
 */
export function scoreStage(stage, result) {
  if (!stage || !result) return [];
  if (stage.kind === "bs") {
    const details = Array.isArray(result.details) ? result.details : [];
    const keyByQid = stage.keyByQid || {};
    return details
      .map((d) => {
        const key = keyByQid[String(d?.qid || "")];
        if (!key) return null;
        const ans = String(d?.userAnswer || "");
        // 一块词都没放：组件给的是 "(no answer)"，或者只剩题目预填的词（如 "Dorms."）—— 都算没作答
        const q = (stage.questions || []).find((x) => String(x?.id) === String(d?.qid));
        const onlyPrefilled = q && Array.isArray(q.prefilled) && q.prefilled.length > 0 && normAns(ans) === normAns(q.prefilled.join(" "));
        return { key, correct: !!d.isCorrect, answer: ans === "(no answer)" || onlyPrefilled ? "" : ans, selected: null };
      })
      .filter(Boolean);
  }
  const results = Array.isArray(result.results) ? result.results : [];
  if (stage.kind === "lcr") {
    return results
      .map((r, i) => {
        const item = stage.items?.find((it) => it.id === r?.itemId) || stage.items?.[i];
        const key = stage.keyByItemId?.[r?.itemId] || stage.keyByItemId?.[item?.id];
        if (!key) return null;
        return { key, correct: !!r?.isCorrect, answer: optionAnswer(item?.options, r?.selected), selected: r?.selected ?? null };
      })
      .filter(Boolean);
  }
  if (stage.kind === "ctw") {
    return Object.entries(stage.keyByIndex || {}).map(([idx, key]) => {
      const r = results[Number(idx)] || {};
      const typed = String(r.userAnswer || "").trim();
      return { key, correct: !!r.isCorrect, answer: typed ? String(r.fullWord || typed) : "", selected: null };
    });
  }
  const qs = stage.item?.questions || [];
  return Object.entries(stage.keyByIndex || {}).map(([idx, key]) => {
    const r = results[Number(idx)] || {};
    return { key, correct: !!r.isCorrect, answer: optionAnswer(qs[Number(idx)]?.options, r.selected), selected: r.selected ?? null };
  });
}

/** 只留给定错题的单位（「再练没拿下的 N 题」）：篇章单位收窄到这几问。 */
export function restrictUnits(units, keys) {
  const set = new Set(keys || []);
  return (units || [])
    .map((u) => {
      const cardKeys = u.cardKeys.filter((k) => set.has(k));
      return cardKeys.length > 0 ? { ...u, cardKeys, size: cardKeys.length } : null;
    })
    .filter(Boolean);
}

function normAns(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** 这次又错、而且错得和错题本里记的上一次一模一样（同一个选项 / 同一个拼法）—— 说明是顽固的误解，不是手滑。 */
export function isSameMistake(card, r) {
  if (!card || !r || r.correct) return false;
  const b = card.brief || {};
  if (r.selected != null && b.selected != null) return String(r.selected) === String(b.selected);
  const now = normAns(r.answer);
  return !!now && now === normAns(b.userAnswer);
}

/**
 * 结算页的核心口径：这组错题里纠正了几道、还剩几道、其中几道是「同样的错又犯一次」。
 * 不算 band —— 自选的一组错题没有分数意义。
 */
export function classifyDrill(results, cardsByKey) {
  const fixed = [];
  const still = [];
  let sameMistake = 0;
  let unanswered = 0;
  for (const r of results || []) {
    const card = cardsByKey?.[r.key];
    if (!card) continue;
    if (r.correct) {
      fixed.push({ card, r });
      continue;
    }
    // 没作答（跳过 / 超时）单独算：既不是「同样的错」，也不能说「换了个错法」
    const blank = (r.selected == null || r.selected === "") && !normAns(r.answer);
    const same = !blank && isSameMistake(card, r);
    if (blank) unanswered += 1;
    else if (same) sameMistake += 1;
    still.push({ card, r, same, blank });
  }
  // 没拿下的里：同样的错 → 换了错法 → 没作答，同档按错得多的排前
  const rank = (x) => (x.same ? 0 : x.blank ? 2 : 1);
  still.sort((a, b) => (rank(a) - rank(b)) || ((b.card.wrongCount || 1) - (a.card.wrongCount || 1)));
  return { fixed, still, sameMistake, unanswered, changed: still.length - sameMistake - unanswered };
}

/** 汇总报告的数字：总题数 / 答对 / 分题型。 */
export function summarizeDrill(stageResults, cardsByKey) {
  const byType = {};
  let total = 0;
  let correct = 0;
  for (const r of stageResults || []) {
    const card = cardsByKey?.[r.key];
    const type = drillTypeOf(card?.subtype) || "other";
    if (!byType[type]) byType[type] = { total: 0, correct: 0 };
    byType[type].total += 1;
    total += 1;
    if (r.correct) {
      byType[type].correct += 1;
      correct += 1;
    }
  }
  return { total, correct, byType };
}
