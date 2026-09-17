"use client";

/**
 * 每日任务（自我监督）存储 + 纯函数。
 * 风格照抄 lib/studyPlan.js：按用户隔离的 localStorage、CustomEvent 广播、全部 fail-open。
 * 只存本地，不建表、不做云端同步——这是「自己给自己定的小目标」，丢了也不影响任何计费/统计。
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 练习历史（sessions）真实形状（2026-09-17 逐个文件核实，不是猜的）：
 * 每条记录由 lib/sessionStore.js 的 saveSess 补上 `date`（ISO 字符串）与 attempts。
 *
 * | 题型            | type           | details.subtype | 写入处                                        |
 * |-----------------|----------------|-----------------|-----------------------------------------------|
 * | 造句 BS         | "bs"           | （details 是数组，无 subtype）| components/buildSentence/useBuildSentenceSession.js |
 * | 邮件写作        | "email"        | —               | components/writing/WritingTask.js（type prop 来自 app/email-writing/page.js）|
 * | 学术讨论        | "discussion"   | —               | components/writing/WritingTask.js（app/academic-writing/page.js）|
 * | 阅读填词 CTW    | "reading"      | "ctw"           | app/reading/page.js saveReadingSession / app/real-bank/page.js |
 * | 日常阅读 RDL    | "reading"      | "rdl"           | 同上（short/long 共用 subtype "rdl"，本模块合并为一项）|
 * | 学术阅读 AP     | "reading"      | "ap"            | 同上                                          |
 * | 听力四题型      | "listening"    | "lcr"/"la"/"lc"/"lat" | app/listening/page.js / app/real-bank/page.js |
 * | 口语复述        | "speaking"     | "repeat"        | app/speaking/page.js / app/real-bank/page.js  |
 * | 口语面试        | "speaking"     | "interview"     | 同上                                          |
 * | 写作模考        | "mock"         | —               | lib/mockExam/service.js                       |
 * | 阅读/听力模考   | "reading"/"listening" | "mock"   | components/mockExam/AdaptiveExamShell.js      |
 * | 口语模考        | "speaking"     | "mock"          | components/mockExam/SpeakingExamShell.js      |
 *
 * 真题专区（app/real-bank/page.js）刻意照抄常规练习的 type/details 形状（只多一个
 * details.real = true），所以真题练习天然计入对应题型，不需要额外分支。
 *
 * 计数口径：**一条 session 记录 = 1 次**（造句一组 10 题算 1 次、阅读一篇算 1 次）。
 * 与首页打卡热力图（lib/studyStreak.js buildPracticeMap）同口径，日期也复用它的
 * toLocalDateKey（本地时区），避免 UTC 跨日和打卡对不上。
 */

import { toLocalDateKey } from "./studyStreak";

const STORAGE_PREFIX = "toefl-daily-tasks";
const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

export const DAILY_TASKS_UPDATED_EVENT = "toefl-daily-tasks-updated";

/** 一天最多盯 8 项，再多这张卡就读不过来了（编辑弹窗里也用这个上限提示） */
export const MAX_DAILY_TASKS = 8;
/** 单项每日次数上限 */
export const MAX_DAILY_TARGET = 10;

const subtypeIs = (session, subtype) =>
  String(session?.details?.subtype || "") === subtype;

/** 模考记录：写作模考是独立 type，其余三科混在本科 type 里靠 details.subtype 区分 */
const isMockSession = (session) =>
  session?.type === "mock" || subtypeIs(session, "mock");

/**
 * 可选题型目录。key 即存储/统计口径，href 与首页各入口一致（已对过
 * components/home/HomePageClient.js、ReadingSectionContent.js、
 * ListeningSectionContent.js、SpeakingSectionContent.js）。
 * pro: 该题型是 Pro 专属（免费用户仍可加入每日任务，只是卡片上标一下）。
 */
export const DAILY_TASK_TYPES = [
  { key: "bs", label: "拖拽造句", group: "写作", href: "/build-sentence", pro: false, match: (s) => s?.type === "bs" },
  { key: "email", label: "邮件写作", group: "写作", href: "/email-writing", pro: false, match: (s) => s?.type === "email" },
  { key: "discussion", label: "学术讨论", group: "写作", href: "/academic-writing", pro: false, match: (s) => s?.type === "discussion" },

  { key: "ctw", label: "阅读填词", group: "阅读", href: "/reading?type=ctw", pro: true, match: (s) => s?.type === "reading" && subtypeIs(s, "ctw") },
  { key: "rdl", label: "日常阅读", group: "阅读", href: "/reading?type=rdl", pro: true, match: (s) => s?.type === "reading" && subtypeIs(s, "rdl") },
  { key: "ap", label: "学术阅读", group: "阅读", href: "/reading?type=ap", pro: true, match: (s) => s?.type === "reading" && subtypeIs(s, "ap") },

  { key: "lcr", label: "选择回应", group: "听力", href: "/listening?type=lcr", pro: true, match: (s) => s?.type === "listening" && subtypeIs(s, "lcr") },
  { key: "la", label: "听公告", group: "听力", href: "/listening?type=la", pro: true, match: (s) => s?.type === "listening" && subtypeIs(s, "la") },
  { key: "lc", label: "听对话", group: "听力", href: "/listening?type=lc", pro: true, match: (s) => s?.type === "listening" && subtypeIs(s, "lc") },
  { key: "lat", label: "学术讲座", group: "听力", href: "/listening?type=lat", pro: true, match: (s) => s?.type === "listening" && subtypeIs(s, "lat") },

  { key: "repeat", label: "听后复述", group: "口语", href: "/speaking?type=repeat", pro: true, match: (s) => s?.type === "speaking" && subtypeIs(s, "repeat") },
  { key: "interview", label: "模拟面试", group: "口语", href: "/speaking?type=interview", pro: true, match: (s) => s?.type === "speaking" && subtypeIs(s, "interview") },

  { key: "mock", label: "模考（任意科目）", group: "模考", href: "/mock-exam", pro: false, match: isMockSession },
];

export const DAILY_TASK_GROUPS = ["写作", "阅读", "听力", "口语", "模考"];

const TYPE_BY_KEY = new Map(DAILY_TASK_TYPES.map((t) => [t.key, t]));

export function getDailyTaskType(key) {
  return TYPE_BY_KEY.get(String(key || "")) || null;
}

const EMPTY = { tasks: [], updatedAt: null };

function clampTarget(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.round(v);
  if (i < 1) return null;
  return Math.min(MAX_DAILY_TARGET, i);
}

function scopedKey(userCode) {
  const code = String(userCode || "").trim().toUpperCase();
  return `${STORAGE_PREFIX}::${code ? `user:${code}` : "guest"}`;
}

function emitUpdated() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(DAILY_TASKS_UPDATED_EVENT));
  } catch {
    /* no-op */
  }
}

/** 脏数据清洗：丢未知 key、去重、target 夹到 1~10 的整数、截到 8 项 */
export function sanitizeTasks(rawTasks) {
  if (!Array.isArray(rawTasks)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of rawTasks) {
    const key = String(raw?.key || "");
    if (!TYPE_BY_KEY.has(key) || seen.has(key)) continue;
    const target = clampTarget(raw?.target);
    if (target == null) continue;
    seen.add(key);
    out.push({ key, target });
    if (out.length >= MAX_DAILY_TASKS) break;
  }
  return out;
}

export function loadDailyTasks(userCode) {
  if (!isBrowser()) return { ...EMPTY };
  try {
    const raw = localStorage.getItem(scopedKey(userCode));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      tasks: sanitizeTasks(parsed?.tasks),
      updatedAt: parsed?.updatedAt || null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveDailyTasks(userCode, tasks) {
  const next = { tasks: sanitizeTasks(tasks), updatedAt: new Date().toISOString() };
  if (!isBrowser()) return next;
  try {
    localStorage.setItem(scopedKey(userCode), JSON.stringify(next));
    emitUpdated();
  } catch {
    /* ignore quota errors */
  }
  return next;
}

export function clearDailyTasks(userCode) {
  if (!isBrowser()) return { ...EMPTY };
  try {
    localStorage.removeItem(scopedKey(userCode));
    emitUpdated();
  } catch {
    /* ignore */
  }
  return { ...EMPTY };
}

export function hasDailyTasks(state) {
  return !!(state && Array.isArray(state.tasks) && state.tasks.length > 0);
}

/**
 * 今日各题型完成次数。一条 session = 1 次；只数「本地日期 === 今天」的记录，
 * 无效/缺失 date 一律跳过（和 buildPracticeMap 一致）。
 */
export function countTodayByTask(sessions, now = new Date()) {
  const todayKey = toLocalDateKey(now);
  const counts = {};
  for (const t of DAILY_TASK_TYPES) counts[t.key] = 0;
  if (!todayKey) return counts;
  for (const s of sessions || []) {
    const key = toLocalDateKey(s?.date);
    if (!key || key !== todayKey) continue;
    for (const t of DAILY_TASK_TYPES) {
      try {
        if (t.match(s)) counts[t.key] += 1;
      } catch {
        /* 单条脏记录不该拖垮整张卡 */
      }
    }
  }
  return counts;
}

/**
 * 任务清单 + 今日进度汇总。done 只作统计原值（可能超 target），
 * 展示封顶交给 shown = min(done, target)。
 */
export function summarizeDailyTasks(tasks, sessions, now = new Date()) {
  const clean = sanitizeTasks(tasks);
  const counts = countTodayByTask(sessions, now);
  const items = clean.map(({ key, target }) => {
    const type = TYPE_BY_KEY.get(key);
    const done = counts[key] || 0;
    return {
      key,
      label: type.label,
      group: type.group,
      href: type.href,
      pro: !!type.pro,
      target,
      done,
      shown: Math.min(done, target),
      complete: done >= target,
    };
  });
  const completed = items.filter((i) => i.complete).length;
  return {
    items,
    total: items.length,
    completed,
    allComplete: items.length > 0 && completed === items.length,
  };
}
