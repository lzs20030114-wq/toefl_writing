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
 * 日期一律用 lib/studyStreak.js 的 toLocalDateKey（本地时区），与首页打卡同口径，
 * 避免 UTC 跨日后「练了却没记上」。
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 任务形状（v2）：{ id, keys: [k1] | [k1, k2], target: 1..10, freq }
 *
 *  - keys 长度 1 或 2。**2 个 = 任选其一**：两个题型的记录相加计数（练哪个都算）。
 *  - freq = "daily" | "alternate" | "weekly"：
 *      daily     —— 每天都要练，target = 当天次数。
 *      alternate —— 隔天练，target = 应练日当天的次数。
 *      weekly    —— 每周 N 次，target = 本周次数（周一 00:00 本地时区起算，
 *                   与 lib/studyStreak.buildHeatmapColumns 的周一口径一致）。
 *  - **隔天的判定不用固定单双日锚点**（那样漏练一天会一直错位）：
 *      「昨天已达标（昨日计数 ≥ target）且今天还没练」→ 今天是休息日 restToday；
 *      否则今天就是应练日。今天已经练了就正常显示进度，不再算休息 ——
 *      于是漏练自动顺延，练超前也不会被罚。
 *  - weekly 永远不会 restToday（本周内哪天练随用户）。
 *  - 展示用 shown = min(done, target) 封顶，done 保留原值。
 *  - 总计：dueCount = 今天需要练的任务数（排除 restToday）；completeCount = 其中已达标数；
 *      allComplete = dueCount > 0 且全部达标；allRest = 有任务但今天全是休息日。
 *
 * 向后兼容：一期的旧形状 { key, target } 在 load/sanitize 时自动迁移成
 * { id, keys: [key], target, freq: "daily" }，老用户无感。
 */

import { toLocalDateKey, startOfDay, addDays } from "./studyStreak";

const STORAGE_PREFIX = "toefl-daily-tasks";
const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

export const DAILY_TASKS_UPDATED_EVENT = "toefl-daily-tasks-updated";

/** 一天最多盯 8 项，再多这张卡就读不过来了（编辑弹窗里也用这个上限提示） */
export const MAX_DAILY_TASKS = 8;
/** 单项次数上限 */
export const MAX_DAILY_TARGET = 10;
/** 一个任务最多绑 2 个题型（二选一） */
export const MAX_TASK_KEYS = 2;

export const FREQ_DAILY = "daily";
export const FREQ_ALTERNATE = "alternate";
export const FREQ_WEEKLY = "weekly";

export const DAILY_TASK_FREQS = [
  { key: FREQ_DAILY, label: "每天", unit: "day", unitLabel: "次/天", badge: "" },
  { key: FREQ_ALTERNATE, label: "隔天", unit: "day", unitLabel: "次/天", badge: "隔天" },
  { key: FREQ_WEEKLY, label: "每周", unit: "week", unitLabel: "次/周", badge: "本周" },
];

const FREQ_BY_KEY = new Map(DAILY_TASK_FREQS.map((f) => [f.key, f]));

export function getFreqMeta(freq) {
  return FREQ_BY_KEY.get(freq) || FREQ_BY_KEY.get(FREQ_DAILY);
}

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

/** 稳定 id：keys 原序 + 频率。重复时由 sanitize 追加序号。 */
export function makeTaskId(keys, freq) {
  return `${(keys || []).join("+")}@${freq}`;
}

/** 同一任务的去重签名：keys 当集合看（A/B 与 B/A 是同一个任务）+ 频率 */
function taskSignature(keys, freq) {
  return `${[...keys].sort().join("|")}@${freq}`;
}

/**
 * 脏数据清洗 + 旧形状迁移。
 * 丢未知题型 key、keys 去重/截到 2、keys 为空丢任务、target 夹到 1~10 的整数、
 * freq 非法回落 daily、keys集合+freq 完全相同的重复任务丢后者、最多 8 个任务。
 */
export function sanitizeTasks(rawTasks) {
  if (!Array.isArray(rawTasks)) return [];
  const seenSig = new Set();
  const seenId = new Set();
  const out = [];

  for (const raw of rawTasks) {
    if (!raw || typeof raw !== "object") continue;

    // v1 → v2 迁移：{ key, target } → { keys: [key], freq: "daily" }
    const rawKeys = Array.isArray(raw.keys)
      ? raw.keys
      : (raw.key != null ? [raw.key] : []);

    const keys = [];
    for (const k of rawKeys) {
      const key = String(k || "");
      if (!TYPE_BY_KEY.has(key) || keys.includes(key)) continue;
      keys.push(key);
      if (keys.length >= MAX_TASK_KEYS) break;
    }
    if (keys.length === 0) continue;

    const target = clampTarget(raw.target);
    if (target == null) continue;

    const freq = FREQ_BY_KEY.has(raw.freq) ? raw.freq : FREQ_DAILY;

    const sig = taskSignature(keys, freq);
    if (seenSig.has(sig)) continue;
    seenSig.add(sig);

    let id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : makeTaskId(keys, freq);
    if (seenId.has(id)) {
      let n = 2;
      while (seenId.has(`${id}#${n}`)) n += 1;
      id = `${id}#${n}`;
    }
    seenId.add(id);

    out.push({ id, keys, target, freq });
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

function emptyCounts() {
  const counts = {};
  for (const t of DAILY_TASK_TYPES) counts[t.key] = 0;
  return counts;
}

function tally(counts, session) {
  for (const t of DAILY_TASK_TYPES) {
    try {
      if (t.match(session)) counts[t.key] += 1;
    } catch {
      /* 单条脏记录不该拖垮整张卡 */
    }
  }
}

/** 指定本地日期（"YYYY-MM-DD"）各题型的练习次数。一条 session = 1 次。 */
export function countByTaskOnDay(sessions, dateKey) {
  const counts = emptyCounts();
  if (!dateKey) return counts;
  for (const s of sessions || []) {
    const key = toLocalDateKey(s?.date);
    if (!key || key !== dateKey) continue;
    tally(counts, s);
  }
  return counts;
}

/** 本地日期区间 [startDate, endDate) 内各题型的练习次数（按天 key 比较，含起始日、不含结束日）。 */
export function countByTaskInRange(sessions, startDate, endDate) {
  const counts = emptyCounts();
  const startKey = toLocalDateKey(startDate);
  const endKey = toLocalDateKey(endDate);
  if (!startKey || !endKey) return counts;
  for (const s of sessions || []) {
    const key = toLocalDateKey(s?.date);
    if (!key || key < startKey || key >= endKey) continue;
    tally(counts, s);
  }
  return counts;
}

/** 本周周一 00:00（本地时区），与 studyStreak.buildHeatmapColumns 同口径 */
export function startOfWeek(now = new Date()) {
  const t0 = startOfDay(now);
  const dow = (t0.getDay() + 6) % 7; // 周一 = 0
  return addDays(t0, -dow);
}

/** 今日各题型完成次数（countByTaskOnDay 的今日快捷方式，一期就有，保持导出） */
export function countTodayByTask(sessions, now = new Date()) {
  return countByTaskOnDay(sessions, toLocalDateKey(now));
}

const sumKeys = (counts, keys) => keys.reduce((n, k) => n + (counts[k] || 0), 0);

/**
 * 任务清单 + 今日/本周进度汇总。口径见文件头注。
 */
export function summarizeDailyTasks(tasks, sessions, now = new Date()) {
  const clean = sanitizeTasks(tasks);
  const today = startOfDay(now);
  const todayCounts = countByTaskOnDay(sessions, toLocalDateKey(today));

  const needsYesterday = clean.some((t) => t.freq === FREQ_ALTERNATE);
  const yesterdayCounts = needsYesterday
    ? countByTaskOnDay(sessions, toLocalDateKey(addDays(today, -1)))
    : null;

  const needsWeek = clean.some((t) => t.freq === FREQ_WEEKLY);
  const weekStart = startOfWeek(today);
  const weekCounts = needsWeek
    ? countByTaskInRange(sessions, weekStart, addDays(weekStart, 7))
    : null;

  const items = clean.map((task) => {
    const types = task.keys.map((k) => TYPE_BY_KEY.get(k));
    const base = {
      id: task.id,
      keys: task.keys,
      labels: types.map((t) => t.label),
      hrefs: types.map((t) => t.href),
      pros: types.map((t) => !!t.pro),
      freq: task.freq,
      target: task.target,
      unit: getFreqMeta(task.freq).unit,
    };

    if (task.freq === FREQ_WEEKLY) {
      const done = sumKeys(weekCounts, task.keys);
      return { ...base, done, shown: Math.min(done, task.target), complete: done >= task.target, restToday: false };
    }

    const doneToday = sumKeys(todayCounts, task.keys);

    if (task.freq === FREQ_ALTERNATE) {
      const doneYesterday = sumKeys(yesterdayCounts, task.keys);
      // 昨天已达标、今天还没动 → 今天休息；今天一旦练了就照常显示进度。
      if (doneYesterday >= task.target && doneToday === 0) {
        return { ...base, done: 0, shown: 0, complete: false, restToday: true };
      }
    }

    return {
      ...base,
      done: doneToday,
      shown: Math.min(doneToday, task.target),
      complete: doneToday >= task.target,
      restToday: false,
    };
  });

  const due = items.filter((i) => !i.restToday);
  const completeCount = due.filter((i) => i.complete).length;

  return {
    items,
    total: items.length,
    dueCount: due.length,
    completeCount,
    allComplete: due.length > 0 && completeCount === due.length,
    allRest: items.length > 0 && due.length === 0,
  };
}
