// 「真题练习记录」逐题回顾的纯函数层：把一条真题记录（session）整理成
//   { kind, units[], score }
// 供概览行的「错题速览」、详情页的编号导航 / 左栏进度点 / 筛选条共用。
//
// units 是记录里「可逐个回看的最小单位」——填词的一个空、选择题的一道题、造句的一句、
// 口语的一句 / 一题、写作的一处批注、模考的一个题组。每个 unit：
//   { idx, n, lv, label, text, hint }
//   idx   在原数组里的下标（写作是 annotationSegments 的下标，用来定位 `mark-err{idx}`）
//   n     展示编号（1 起；口语访谈是 "Q1"）
//   lv    "ok" | "mid" | "bad" | "none"（none = 没录 / 跳过 / 无分）
// 得分口径一律走 realBankHistory.realSessionScore（与后台统计、首页入口卡同一把尺子），
// 本文件不另算分。纯函数，不碰 DOM / storage，jest 直接测（__tests__/real-bank-review.test.js）。

import { realSessionScore } from "./realBankHistory";
import { insertStemParts } from "./reading/insertSentence";

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const str = (v) => (v == null ? "" : String(v));

export const REVIEW_KINDS = ["ctw", "mcq", "bs", "repeat", "interview", "writing", "unscored", "mock"];

/** 这条记录该用哪种逐题回顾。 */
export function reviewKind(session, subtype) {
  const d = session?.details;
  if (d?.realMock === true) return "mock";
  if (subtype === "ctw") return "ctw";
  if (["rdl", "ap", "lc", "la", "lat", "lcr"].includes(subtype)) return "mcq";
  if (subtype === "bs") return "bs";
  if (subtype === "repeat") return "repeat";
  if (subtype === "interview") return "interview";
  if (subtype === "email" || subtype === "discussion") {
    return obj(d).feedback && Array.isArray(obj(d).feedback.annotationSegments) ? "writing" : "unscored";
  }
  return "";
}

const lvOfCount = (ok) => (ok ? "ok" : "bad");

function ctwUnits(session) {
  const d = obj(session?.details);
  const blanks = arr(d.blanks);
  return arr(d.results).map((r, i) => {
    const b = obj(r?.blank || blanks[i]);
    const frag = str(b.displayed_fragment);
    const full = str(b.original_word);
    const userFull = r?.fullWord || `${frag}${r?.userAnswer ?? ""}`;
    const ok = !!r?.isCorrect;
    return { idx: i, n: i + 1, lv: lvOfCount(ok), label: `第 ${i + 1} 空`, text: `${frag}____`, hint: ok ? full : `你填 ${userFull} · 应为 ${full}` };
  });
}

function mcqUnits(session, subtype) {
  const d = obj(session?.details);
  const results = arr(d.results);
  const items = arr(d.items);
  const questions = arr(d.questions);
  return results.map((r, i) => {
    const q = obj(subtype === "lcr" ? items[i] : questions[i]);
    const ok = !!r?.isCorrect;
    const sel = r?.selected || "—";
    const correct = r?.correct || q.answer || q.correct_answer || "—";
    // 阅读插入句题（question_type: insert_text）：stem 是「指令 + 待插入句 + 提问」揉在一起，
    // 速览里只放待插入句（拆法与做题页 / 复盘页同一份 lib/reading/insertSentence）。
    const insert = subtype === "lcr" ? null : insertStemParts(q);
    const text = subtype === "lcr"
      ? str(q.speaker || q.stem || r?.stem)
      : insert ? `插入句：${insert.sentence}` : str(q.stem || r?.stem);
    return { idx: i, n: i + 1, lv: lvOfCount(ok), label: `第 ${i + 1} 题`, text, hint: ok ? `${sel} ✓` : `你选 ${sel} · 正确 ${correct}` };
  });
}

function bsUnits(session) {
  const d = arr(session?.details);
  return d.map((it, i) => {
    const ok = !!it?.isCorrect;
    return { idx: i, n: i + 1, lv: lvOfCount(ok), label: `第 ${i + 1} 题`, text: str(it?.correctAnswer), hint: arr(it?.grammar_points).join(" · ") };
  });
}

function repeatUnits(session) {
  return arr(obj(session?.details).items).map((it, i) => {
    const acc = Number(it?.score?.accuracy);
    const recorded = !!it?.recorded && Number.isFinite(acc);
    const lv = !recorded ? "none" : acc >= 80 ? "ok" : acc >= 60 ? "mid" : "bad";
    return { idx: i, n: i + 1, lv, label: `第 ${i + 1} 句`, text: str(it?.sentence), hint: recorded ? `${acc}%` : "未录制" };
  });
}

function interviewUnits(session) {
  return arr(obj(session?.details).items).map((it, i) => {
    const sc = it?.aiScore;
    const has = !!it?.recorded && sc && !sc.error && Number.isFinite(Number(sc.score));
    const score = has ? Number(sc.score) : null;
    const lv = score == null ? "none" : score >= 4 ? "ok" : score >= 3 ? "mid" : "bad";
    return { idx: i, n: `Q${i + 1}`, lv, label: `Q${i + 1}`, text: str(it?.question), hint: score != null ? `${score}/5` : it?.recorded ? "未评分" : "已跳过" };
  });
}

function writingCategory(level, errorType) {
  if (level === "red") return String(errorType || "").toLowerCase() === "spelling" ? "拼写错误" : "语法错误";
  if (level === "orange") return "表达建议";
  return "拔高建议";
}

function writingUnits(session) {
  const segs = arr(obj(obj(session?.details).feedback).annotationSegments);
  const out = [];
  segs.forEach((sg, i) => {
    if (sg?.type !== "mark") return;
    out.push({
      idx: i, n: out.length + 1, lv: sg.level === "red" ? "bad" : "mid",
      label: writingCategory(sg.level, sg.errorType), text: str(sg.text), hint: `→ ${str(sg.fix)}`,
      level: sg.level, errorType: sg.errorType || "",
    });
  });
  return out;
}

/** 真题模考里一个任务（题组）→ 一份可交给普通回顾组件的「子记录」。 */
export function adaptMockTask(session, task, index = 0) {
  const d = obj(session?.details);
  const type = str(task?.taskType || task?.type);
  const itemId = str(task?.itemId || task?.id || arr(task?.itemIds)[0]);
  const sourceItem = arr(d.items).find((item) => item?.id === itemId) || arr(task?.items)[0] || {};
  const base = {
    ...sourceItem, ...task, itemId, itemIds: arr(task?.itemIds).length ? task.itemIds : [itemId],
    results: arr(task?.results), items: type === "lcr" ? [sourceItem] : arr(task?.items),
    questions: arr(task?.questions).length ? task.questions : arr(sourceItem.questions),
    blanks: arr(task?.blanks).length ? task.blanks : arr(sourceItem.blanks),
    passage: task?.passage || sourceItem.passage || sourceItem.text || "",
  };
  const childType = ["bs", "email", "discussion"].includes(type) ? type
    : ["repeat", "interview"].includes(type) ? "speaking"
    : ["ctw", "rdl", "ap"].includes(type) ? "reading" : "listening";
  let details = base;
  if (type === "bs") details = arr(task?.meta?.details);
  else if (type === "email" || type === "discussion") {
    const feedback = task?.meta?.feedback || null;
    details = {
      promptId: str(sourceItem.id), promptData: sourceItem, promptSummary: str(task?.meta?.response?.promptSummary),
      userText: str(task?.meta?.response?.userText), feedback, scoringFailed: !feedback,
    };
  } else if (type === "repeat") details = { items: arr(task?.items).length ? task.items : arr(d.repeatItems), total: 7, attempted: arr(task?.items).length };
  else if (type === "interview") details = { items: arr(task?.items).length ? task.items : arr(d.interviewItems), total: 4, attempted: arr(task?.items).length };
  else details = { ...base, subtype: type };
  const child = {
    ...session, type: childType, score: Number.isFinite(Number(task?.score)) ? Number(task.score) : null,
    details, correct: task?.correct, total: task?.total,
  };
  delete child.band;
  return { index, type, itemId, task, sourceItem, session: child };
}

function mockLv(pct) {
  if (!Number.isFinite(pct)) return "none";
  return pct >= 99 ? "ok" : pct >= 60 ? "mid" : "bad";
}

/** 真题模考的各题组：每组一个 { type, itemId, session(子记录), model(逐题模型) }。 */
export function buildMockTasks(session) {
  return arr(obj(session?.details).tasks).map((task, i) => {
    const t = adaptMockTask(session, task, i);
    return { ...t, model: buildReviewModel(t.session, t.type) };
  });
}

function mockUnits(session, shortOf) {
  return buildMockTasks(session).map((t, i) => {
    const short = shortOf ? shortOf(t.type) : t.type;
    const subtitle = str(t.task?.title || t.task?.topic || t.itemId);
    return {
      idx: i, n: i + 1, lv: mockLv(t.model.score.pct), label: `第 ${i + 1} 题组`,
      text: [short, subtitle].filter(Boolean).join(" · "), hint: t.model.score.label,
    };
  });
}

/**
 * 一条记录的逐题模型。subtype 用 entry.subtype（题库重建后的当前题型）；
 * 模考记录的 subtype 是 mock-*。shortOf(type) 给模考题组拼「填词 · …」用，不传就用 type 本身。
 */
export function buildReviewModel(session, subtype, { shortOf } = {}) {
  const kind = reviewKind(session, subtype);
  const score = realSessionScore(session);
  let units = [];
  if (kind === "ctw") units = ctwUnits(session);
  else if (kind === "mcq") units = mcqUnits(session, subtype);
  else if (kind === "bs") units = bsUnits(session);
  else if (kind === "repeat") units = repeatUnits(session);
  else if (kind === "interview") units = interviewUnits(session);
  else if (kind === "writing") units = writingUnits(session);
  else if (kind === "mock") units = mockUnits(session, shortOf);
  return { kind, units, score };
}

/** 左栏进度点 / 行尾小方块用的平铺 unit（写作 / 未评分没有，模考摊平所有题组的逐题）。 */
export function stripUnits(session, model) {
  if (model.kind === "writing" || model.kind === "unscored") return [];
  if (model.kind === "mock") {
    return buildMockTasks(session).flatMap((t) => (t.model.kind === "writing" || t.model.kind === "unscored" ? [] : t.model.units));
  }
  return model.units;
}

/** 概览行展开后的「错题速览」。 */
export function buildPreview(model, { limit = 4 } = {}) {
  const speaking = model.kind === "repeat" || model.kind === "interview";
  const bad = model.units.filter((u) => u.lv !== "ok");
  const list = model.kind === "mock" ? model.units : bad;
  let title;
  if (model.kind === "writing") title = `批改要点 · ${bad.length} 处`;
  else if (model.kind === "unscored") title = "批改状态";
  else if (model.kind === "mock") title = `题组得分 · 共 ${model.units.length} 组`;
  else if (speaking) title = `待提高 · ${bad.length} 项`;
  else title = `错题速览 · ${bad.length} 题`;
  const none = (bad.length === 0 && model.kind !== "mock") || model.kind === "unscored";
  return {
    title, items: list.slice(0, limit), more: model.kind !== "mock" && bad.length > limit, moreCount: Math.max(0, bad.length - limit),
    none, noneKind: model.kind === "unscored" ? "unscored" : "clean",
    noneText: model.kind === "unscored" ? "AI 评分未完成，作答原文已保存。可以直接重试评分。" : "本次全部答对，可以直接再练一套。",
    cta: model.kind === "writing" ? "查看批改报告" : model.kind === "unscored" ? "查看作答" : model.kind === "mock" ? "查看模考报告" : "逐题回顾",
  };
}

/* ── 日期 ─────────────────────────────────────────────────────────── */

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const pad = (n) => String(n).padStart(2, "0");
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export const formatHM = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const formatMD = (d) => `${d.getMonth() + 1}月${d.getDate()}日`;

/** 列表分组标题：今天 / 昨天 / 本周早些时候（本周一至前天）/ 更早。 */
export function dayGroupLabel(date, now = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "更早";
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 864e5);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  if (diff <= (now.getDay() + 6) % 7) return "本周早些时候";
  return "更早";
}

/** 「今天 10:42」/「10月1日 周四 18:30」。 */
export function whenLabel(date, now = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const l = dayGroupLabel(d, now);
  return l === "今天" || l === "昨天" ? `${l} ${formatHM(d)}` : `${formatMD(d)} ${WEEK[d.getDay()]} ${formatHM(d)}`;
}

/** 行内时间：今天 / 昨天只显示时分，其余带月日。 */
export function rowTimeLabel(date, now = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const l = dayGroupLabel(d, now);
  return l === "今天" || l === "昨天" ? formatHM(d) : `${formatMD(d)} ${formatHM(d)}`;
}

/** 按日分组（保持入参顺序；入参已按时间倒序）。 */
export function groupEntriesByDay(entries, now = new Date()) {
  const groups = [];
  for (const e of entries) {
    const label = dayGroupLabel(e.session?.date, now);
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, entries: [] }));
    g.entries.push(e);
  }
  return groups;
}

/** 平均得分率（忽略无分记录）；没有可算的返回 null。 */
export function averagePct(entries) {
  const v = entries.map((e) => realSessionScore(e.session).pct).filter(Number.isFinite);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

/* ── 造句：你的答案 vs 正确答案的词级对比 ─────────────────────────────── */

const cleanWord = (w) => String(w).replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").toLowerCase();

/**
 * 词级 LCS 对比（忽略大小写与首尾标点）。user / corr 各返回逐词 { t, sp, hit }：
 * hit=true 表示该词在两边的公共子序列里（对的），false 表示多了 / 少了 / 位置错了。
 */
export function wordDiff(userText, correctText) {
  const A = String(userText ?? "").split(/\s+/).filter(Boolean);
  const B = String(correctText ?? "").split(/\s+/).filter(Boolean);
  const n = A.length;
  const k = B.length;
  const L = Array.from({ length: n + 1 }, () => Array(k + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = k - 1; j >= 0; j--) {
      L[i][j] = cleanWord(A[i]) === cleanWord(B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const inA = new Set();
  const inB = new Set();
  let i = 0;
  let j = 0;
  while (i < n && j < k) {
    if (cleanWord(A[i]) === cleanWord(B[j])) { inA.add(i); inB.add(j); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return {
    user: A.map((t, x) => ({ t, sp: x < n - 1 ? " " : "", hit: inA.has(x) })),
    corr: B.map((t, x) => ({ t, sp: x < k - 1 ? " " : "", hit: inB.has(x) })),
  };
}
