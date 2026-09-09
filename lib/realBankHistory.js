// 「真题练习记录」的纯函数层：从练习历史（sessions）里挑出真题专区（/real-bank）的记录，
// 并把 12 种题型统一成同一套「题型 / 科目 / 得分 / 条目 id」口径，供
// components/realBank/RealBankProgressView.js（记录页）与首页真题面板的入口卡共用。
//
// 真题记录怎么辨认：沿用后台真题统计的同一判定（lib/admin/realSession.js 的 isRealSession，
// 纯函数，不碰 supabase）—— 前后台两处用同一把尺子，后台统计到的记录用户这里一定看得到。
//   reading    → details.itemId 以 real_ 开头
//   listening  → details.real === true（itemIds[0] 也是 real_ 前缀）
//   speaking   → details.real === true（setId 也是 real_ 前缀）
//   discussion / email → details.promptId 以 real_ 开头
//   bs         → details 是数组，每项带 qid，real_ 前缀即真题
//
// **不许** import lib/realBank（那会把整个真题库 JSON 打进首页 bundle，
// __tests__/real-bank-section.component.test.js 有源码级回归门盯着首页组件）。
// 题库总量只读各 counts.json / realExamCounts.js（几十字节）。

import { isRealSession } from "./admin/realSession";
import { getAccuracyPercent } from "./history/scoreMetrics";

export { isRealSession as isRealBankSession };

/** 真题 12 题型的展示元数据。颜色沿用各科历史页的题型色，label 与 app/real-bank 的 REAL_TYPES 对齐。 */
export const REAL_SUBTYPE_META = {
  bs: { subject: "writing", label: "造句真题", short: "造句", icon: "🧩", color: "#d97706", unit: "题" },
  email: { subject: "writing", label: "邮件真题", short: "邮件", icon: "📧", color: "#0891B2", unit: "题" },
  discussion: { subject: "writing", label: "学术讨论真题", short: "讨论", icon: "💬", color: "#6366F1", unit: "题" },
  ctw: { subject: "reading", label: "阅读填词真题", short: "填词", icon: "Aa", color: "#D97706", unit: "篇" },
  rdl: { subject: "reading", label: "日常阅读真题", short: "日常", icon: "📄", color: "#059669", unit: "篇" },
  ap: { subject: "reading", label: "学术阅读真题", short: "学术", icon: "📚", color: "#6366F1", unit: "篇" },
  lcr: { subject: "listening", label: "听力应答真题", short: "应答", icon: "💬", color: "#8B5CF6", unit: "题" },
  lc: { subject: "listening", label: "听力对话真题", short: "对话", icon: "🗣", color: "#0891B2", unit: "段" },
  la: { subject: "listening", label: "听力通知真题", short: "通知", icon: "📢", color: "#D97706", unit: "段" },
  lat: { subject: "listening", label: "听力讲座真题", short: "讲座", icon: "🎓", color: "#059669", unit: "段" },
  repeat: { subject: "speaking", label: "口语跟读真题", short: "跟读", icon: "🔁", color: "#F59E0B", unit: "套" },
  interview: { subject: "speaking", label: "口语访谈真题", short: "访谈", icon: "🎤", color: "#0891B2", unit: "套" },
};

/** 题型固定顺序（写作 → 阅读 → 听力 → 口语），与首页真题面板的分组顺序一致。 */
export const REAL_SUBTYPE_ORDER = ["bs", "email", "discussion", "ctw", "rdl", "ap", "lcr", "lc", "la", "lat", "repeat", "interview"];

export const REAL_SUBJECT_META = {
  writing: { label: "写作", icon: "✍️", color: "#0D9668" },
  reading: { label: "阅读", icon: "📖", color: "#3B82F6" },
  listening: { label: "听力", icon: "🎧", color: "#8B5CF6" },
  speaking: { label: "口语", icon: "🗣", color: "#F59E0B" },
};
export const REAL_SUBJECT_ORDER = ["writing", "reading", "listening", "speaking"];

/** 一条真题记录属于哪个题型（12 种之一）；认不出返回 ""。 */
export function realSessionSubtype(session) {
  const type = String(session?.type || "");
  if (type === "bs" || type === "email" || type === "discussion") return type;
  if (type === "reading" || type === "listening" || type === "speaking") {
    const sub = String(session?.details?.subtype || "").toLowerCase();
    return REAL_SUBTYPE_META[sub] && REAL_SUBTYPE_META[sub].subject === type ? sub : "";
  }
  return "";
}

export function realSessionSubject(session) {
  const sub = realSessionSubtype(session);
  return sub ? REAL_SUBTYPE_META[sub].subject : "";
}

/**
 * 这条记录练了哪些真题条目 id（造句一条记录是一整卷 → 多个 qid；其余一条记录一个 id）。
 * 覆盖率统计按「去重后的条目数」算，所以返回数组而不是单个。
 */
export function realSessionItemIds(session) {
  const d = session?.details;
  const type = String(session?.type || "");
  if (type === "bs") {
    return (Array.isArray(d) ? d : [])
      .map((x) => String(x?.qid || ""))
      .filter((id) => id.startsWith("real_"));
  }
  const obj = d && typeof d === "object" && !Array.isArray(d) ? d : {};
  let id = "";
  if (type === "reading") id = obj.itemId;
  else if (type === "listening") id = Array.isArray(obj.itemIds) ? obj.itemIds[0] : "";
  else if (type === "speaking") id = obj.setId;
  else if (type === "discussion" || type === "email") id = obj.promptId || obj.promptData?.id;
  id = String(id || "");
  return id.startsWith("real_") ? [id] : [];
}

// null / undefined / "" 一律当「没有分」—— Number(null) 是 0，不能直接喂给 Number.isFinite。
function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 0–100 夹紧 + 保留一位小数（4.2/5 → 84 而不是 84.00000000000001）。
function clampPct(v) {
  return Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
}

/**
 * 统一得分口径：{ label, pct, kind }
 *   - 客观题（造句 / 阅读 / 听力）：label "7/10"，pct = 正确率
 *   - 写作（邮件 / 讨论）：label "4/5"，pct = score/5；评分失败 → label "未评分"、pct null
 *   - 口语：label "3.8/5"（averageScore），pct = avg/5；没分则 "2/3 句"
 * pct 统一到 0–100，趋势图才能把四科画到同一根轴上（「得分率」）。
 */
export function realSessionScore(session) {
  const type = String(session?.type || "");
  const d = session?.details;
  if (type === "email" || type === "discussion") {
    const score = finite(session?.score);
    if (score == null) {
      const failed = !!(d && !Array.isArray(d) && d.scoringFailed);
      return { label: failed ? "未评分" : "--", pct: null, kind: "writing" };
    }
    return { label: `${score}/5`, pct: clampPct((score / 5) * 100), kind: "writing" };
  }
  if (type === "speaking") {
    const obj = d && !Array.isArray(d) ? d : {};
    const avg = finite(obj.averageScore);
    if (avg != null && avg > 0) {
      return { label: `${avg}/5`, pct: clampPct((avg / 5) * 100), kind: "speaking" };
    }
    const attempted = finite(obj.attempted) || 0;
    const total = finite(obj.total) || (Array.isArray(obj.items) ? obj.items.length : 0);
    return { label: total > 0 ? `${attempted}/${total}` : "--", pct: null, kind: "speaking" };
  }
  const pct = getAccuracyPercent(session);
  const total = finite(session?.total);
  const correct = finite(session?.correct);
  if (total != null && total > 0 && correct != null) {
    return { label: `${correct}/${total}`, pct, kind: "objective" };
  }
  const results = d && !Array.isArray(d) && Array.isArray(d.results) ? d.results : Array.isArray(d) ? d : [];
  if (results.length > 0) {
    const c = results.filter((r) => r?.isCorrect).length;
    return { label: `${c}/${results.length}`, pct, kind: "objective" };
  }
  return { label: "--", pct: null, kind: "objective" };
}

/** 得分率 → 颜色（与各科历史页的三档阈值一致：≥80 绿 / ≥60 黄 / 其余红；无分灰）。 */
export function realScoreColor(pct, fallback = "#94a39a") {
  if (!Number.isFinite(pct)) return fallback;
  if (pct >= 80) return "#059669";
  if (pct >= 60) return "#D97706";
  return "#E11D48";
}

/**
 * 从整份历史里挑出真题记录，按时间倒序，带 sourceIndex（云端行 id 优先，否则数组下标，
 * 与各科历史页的删除接口同一口径）。
 */
export function buildRealBankEntries(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  return list
    .map((session, i) => ({
      session,
      sourceIndex: Number.isFinite(Number(session?.id)) ? Number(session.id) : i,
      subtype: realSessionSubtype(session),
    }))
    .filter((e) => e.subtype && isRealSession(e.session))
    .sort((a, b) => new Date(b.session?.date || 0) - new Date(a.session?.date || 0));
}

/** 首页入口卡用：真题记录条数（只数，不排序、不建索引）。 */
export function countRealBankSessions(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  let n = 0;
  for (const s of list) if (realSessionSubtype(s) && isRealSession(s)) n += 1;
  return n;
}

/**
 * 题库覆盖：每个题型「练过的去重条目数 / 题库总量」。totals 形如 { bs: 281, ctw: 87, … }
 * （调用方从 counts.json / realExamCounts 拼）。缺总量的题型 total = 0，UI 只显示已练数。
 */
export function buildRealBankCoverage(entries, totals = {}) {
  const done = {};
  for (const sub of REAL_SUBTYPE_ORDER) done[sub] = new Set();
  for (const e of Array.isArray(entries) ? entries : []) {
    const sub = e?.subtype || realSessionSubtype(e?.session);
    if (!done[sub]) continue;
    for (const id of realSessionItemIds(e.session)) done[sub].add(id);
  }
  return REAL_SUBTYPE_ORDER.map((sub) => {
    const total = Math.max(0, Number(totals?.[sub]) || 0);
    const count = done[sub].size;
    return {
      subtype: sub,
      subject: REAL_SUBTYPE_META[sub].subject,
      done: count,
      total,
      pct: total > 0 ? Math.min(100, Math.round((count / total) * 100)) : null,
    };
  });
}

/** 按科目聚合：条数 + 平均得分率（pct 为 null 的记录不计入平均）。 */
export function buildRealBankSubjectStats(entries) {
  const acc = {};
  for (const subj of REAL_SUBJECT_ORDER) acc[subj] = { subject: subj, count: 0, sum: 0, n: 0 };
  for (const e of Array.isArray(entries) ? entries : []) {
    const subj = REAL_SUBTYPE_META[e.subtype]?.subject;
    if (!acc[subj]) continue;
    acc[subj].count += 1;
    const { pct } = realSessionScore(e.session);
    if (Number.isFinite(pct)) {
      acc[subj].sum += pct;
      acc[subj].n += 1;
    }
  }
  return REAL_SUBJECT_ORDER.map((subj) => ({
    subject: subj,
    count: acc[subj].count,
    avgPct: acc[subj].n > 0 ? Math.round(acc[subj].sum / acc[subj].n) : null,
  }));
}
