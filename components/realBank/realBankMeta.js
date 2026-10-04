// 真题练习记录页的「元数据」层：把一条记录补上来源分档 / 考试日期 / 副标题 / 题库总量。
// 历史记录里只存了题目 id（real_ 前缀），分档与日期要回题库查 —— 所以这个文件 import lib/realBank
// （整个真题库 JSON）。它只被 /real-bank/progress 路由用，首页入口卡不走这里
// （__tests__/real-bank-section.component.test.js 有源码级回归门盯着首页组件的 bundle）。

import {
  REAL_SUBTYPE_META,
  realSessionItemIds,
  buildRealBankCoverage,
} from "../../lib/realBankHistory";
import {
  formatExamDate,
  getRealAPItems,
  getRealBSBatches,
  getRealCTWItems,
  getRealDiscussionPrompts,
  getRealEmailPrompts,
  getRealInterviewSets,
  getRealLAItems,
  getRealLATItems,
  getRealLCItems,
  getRealLCRItems,
  getRealRDLItems,
  getRealRepeatSets,
  realTierLabel,
} from "../../lib/realBank";
import { REAL_WRITING_COUNTS } from "../home/realExamCounts";
import REAL_READING_COUNTS from "../../data/realBank/reading/counts.json";
import REAL_LISTENING_COUNTS from "../../data/realBank/listening/counts.json";
import REAL_SPEAKING_COUNTS from "../../data/realBank/speaking/counts.json";

// 与 components/home/sections.js 的 SECTION_ACCENTS["real-bank"] 同色（金琥珀）。
export const ACCENT = { color: "#B45309", soft: "#FFF7ED" };

// 来源分档 chip 配色：官方绿、回忆版金、参考版灰 —— 与 picker 卡片上的分档语义一致。
export const TIER_CHIP = {
  official: { color: "#166534", bg: "#DCFCE7" },
  recalled: { color: "#B45309", bg: "#FFF7ED" },
  legacy: { color: "#4B5563", bg: "#F3F4F6" },
};

// 题库总量（覆盖率分母）：写作三题型是冻结常量，其余读 build_bank 落库时写的 counts.json。
export const BANK_TOTALS = {
  bs: REAL_WRITING_COUNTS.bs,
  email: REAL_WRITING_COUNTS.email,
  discussion: REAL_WRITING_COUNTS.discussion,
  ctw: REAL_READING_COUNTS.ctw,
  rdl: REAL_READING_COUNTS.rdl,
  ap: REAL_READING_COUNTS.ap,
  lcr: REAL_LISTENING_COUNTS.lcr,
  lc: REAL_LISTENING_COUNTS.lc,
  la: REAL_LISTENING_COUNTS.la,
  lat: REAL_LISTENING_COUNTS.lat,
  repeat: REAL_SPEAKING_COUNTS.repeat,
  interview: REAL_SPEAKING_COUNTS.interview,
};

export function buildCoverage(entries) {
  return buildRealBankCoverage(entries, BANK_TOTALS);
}

/* ── 真题条目索引（id → 来源分档 / 考试日期 / 卷次标签） ─────────── */
// 整库只建一次（模块级缓存），12 个题库加起来一千多条，Map 一次建完几毫秒。
let itemIndexCache = null;
export function getRealItemIndex() {
  if (itemIndexCache) return itemIndexCache;
  const m = new Map();
  const put = (it, extra) => {
    const id = String(it?.id || "");
    if (!id) return;
    m.set(id, { tier: it?.tier, date: it?.date || "", label: "", ...extra });
  };
  try {
    getRealDiscussionPrompts().forEach((p) => put(p, { label: p.course || "" }));
    getRealEmailPrompts().forEach((p) => put(p, {}));
    getRealBSBatches().forEach((b, i) =>
      b.questions.forEach((q) => put(q, { tier: b.tier, date: b.date, label: `第 ${i + 1} 套 · ${b.label || ""}`.replace(/ · $/, "") })),
    );
    getRealCTWItems().forEach((it) => put(it, { label: it.topic || "" }));
    getRealRDLItems().forEach((it) => put(it, { label: it.topic || it.genre || "" }));
    getRealAPItems().forEach((it) => put(it, { label: it.topic || "" }));
    getRealLCRItems().forEach((it) => put(it, { label: it.speaker || "" }));
    getRealLCItems().forEach((it) => put(it, { label: it.topic || it.context || "" }));
    getRealLAItems().forEach((it) => put(it, { label: it.topic || it.context || "" }));
    getRealLATItems().forEach((it) => put(it, { label: it.topic || it.context || "" }));
    getRealRepeatSets().forEach((s) => put(s, { label: s.scenario || s.topic || "" }));
    getRealInterviewSets().forEach((s) => put(s, { label: s.topic || "" }));
  } catch {
    // 题库某一份坏了不该让记录页白屏：索引缺项只是少显示分档 / 日期。
  }
  itemIndexCache = m;
  return m;
}

export function truncate(text, max = 56) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** 用时（秒）→ "11:20"；记录里没存就返回 ""。 */
export function formatDuration(session) {
  const d = session?.details;
  const obj = d && typeof d === "object" && !Array.isArray(d) ? d : {};
  const sec = Number(obj.totalElapsed ?? obj.elapsed ?? obj.duration);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 一条记录的展示信息：题型元数据、来源分档、考试日期、副标题（题目摘要 / 话题 / 卷次）、条目 id、用时。 */
export function describeEntry(entry, index) {
  const s = entry.session || {};
  const sub = entry.subtype;
  const meta = REAL_SUBTYPE_META[sub] || {};
  const d = s.details;
  const obj = d && typeof d === "object" && !Array.isArray(d) ? d : {};
  const ids = realSessionItemIds(s);
  // 题库查询用解析后的当前 id（旧 id 在库里已经查不到了）；解析不出（已下线）再退回记录里的 id。
  const lookupId = (Array.isArray(entry.itemIds) && entry.itemIds[0]) || ids[0];
  const info = lookupId ? index.get(lookupId) : null;
  // 写作历史里整道题（promptData）都存了，分档 / 日期优先读历史本身（老记录也能显示）。
  // 整卷模考由多场考试的题拼成：没有单一的来源分档 / 考试日期（ids[0] 只是看到的第一道题）。
  const isWriting = sub === "bs" || sub === "email" || sub === "discussion";
  const tier = obj.realMock ? "" : obj.promptData?.tier || info?.tier || (ids.length > 0 && !isWriting ? "recalled" : "");
  const examDate = obj.realMock ? "" : formatExamDate(obj.promptData?.date || info?.date || "");

  let subtitle = "";
  if (sub === "email" || sub === "discussion") subtitle = obj.promptSummary || info?.label || "";
  else if (sub === "bs") subtitle = info?.label || (Array.isArray(d) ? `${d.length} 题` : "");
  // 整套（按考试日期打包）记录标题数；老记录是一题一条，仍显示那句口播。
  else if (sub === "lcr") subtitle = (obj.items?.length > 1 ? `整套 ${obj.items.length} 题` : obj.items?.[0]?.speaker) || info?.label || "";
  else if (obj.realMock) subtitle = `${Array.isArray(obj.tasks) ? obj.tasks.length : 0} 个题组`;
  else subtitle = obj.topic || obj.genre || info?.label || "";

  return {
    meta, tier, tierLabel: tier ? realTierLabel(tier) : "", examDate, subtitle: truncate(subtitle),
    // 整卷模考里 seenItemIds[0] 只是「看到过的第一道题」，不代表这条记录，别当条目 id 展示。
    itemId: obj.realMock ? "" : lookupId || "", duration: formatDuration(s),
  };
}

/** 「再练一套」的去向：整卷模考回对应科目的真题模考，单题回真题专区同题型（带回档位）。 */
export function retryHref(entry) {
  if (entry?.session?.details?.realMock) {
    const route = { writing: "/mock-exam", reading: "/reading-exam", listening: "/listening-exam", speaking: "/speaking-exam" };
    return `${route[entry.session.details.section] || "/?section=real-bank"}?source=real-bank`;
  }
  const mode = String(entry?.session?.mode || "").trim();
  const qs = new URLSearchParams();
  qs.set("type", entry.subtype);
  if (mode && mode !== "standard") qs.set("mode", mode);
  return `/real-bank?${qs.toString()}`;
}
