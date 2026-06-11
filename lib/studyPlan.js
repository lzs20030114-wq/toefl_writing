"use client";

/**
 * 备考目标存储。按用户隔离存在 localStorage（沿用 sessionStore 的 scope 思路），
 * 单条记录 / 用户：考试日期 + 目标分数。先不落库，前端即可上线；
 * 打卡热力图所需的练习数据另从云端 sessions 派生（见 lib/studyStreak.js）。
 */

const STORAGE_PREFIX = "toefl-study-plan";
const isBrowser = () => typeof window !== "undefined" && typeof localStorage !== "undefined";

export const STUDY_PLAN_UPDATED_EVENT = "toefl-study-plan-updated";

const EMPTY = { examDate: null, targetScore: null, currentScore: null, createdAt: null, updatedAt: null };

function clampScore(n) {
  // 新托福写作分制：1.0–6.0，0.5 一档
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(6, Math.round(n * 2) / 2));
}

function scopedKey(userCode) {
  const code = String(userCode || "").trim().toUpperCase();
  return `${STORAGE_PREFIX}::${code ? `user:${code}` : "guest"}`;
}

function emitUpdated() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(STUDY_PLAN_UPDATED_EVENT));
  } catch {
    /* no-op */
  }
}

export function loadStudyPlan(userCode) {
  if (!isBrowser()) return { ...EMPTY };
  try {
    const raw = localStorage.getItem(scopedKey(userCode));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      examDate: typeof parsed?.examDate === "string" && parsed.examDate ? parsed.examDate : null,
      targetScore: clampScore(parsed?.targetScore),
      currentScore: clampScore(parsed?.currentScore),
      createdAt: parsed?.createdAt || null,
      updatedAt: parsed?.updatedAt || null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveStudyPlan(userCode, plan) {
  if (!isBrowser()) return { ...EMPTY };
  const prev = loadStudyPlan(userCode);
  const next = {
    examDate: plan?.examDate || null,
    targetScore: clampScore(plan?.targetScore),
    currentScore: clampScore(plan?.currentScore),
    // 备考起点：首次设定时记下，用于环形进度的时间轴基准；编辑时保留
    createdAt: prev.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(scopedKey(userCode), JSON.stringify(next));
    emitUpdated();
  } catch {
    /* ignore quota errors */
  }
  return next;
}

export function clearStudyPlan(userCode) {
  if (!isBrowser()) return { ...EMPTY };
  try {
    localStorage.removeItem(scopedKey(userCode));
    emitUpdated();
  } catch {
    /* ignore */
  }
  return { ...EMPTY };
}

export function hasGoal(plan) {
  return !!(plan && (plan.examDate || Number.isFinite(plan.targetScore)));
}
