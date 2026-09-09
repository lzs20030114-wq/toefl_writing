/**
 * Adaptive mock exam — module plans (bank-free).
 *
 * The single source of truth for "how many items / questions / minutes does
 * each adaptive module have". Kept free of any bank JSON import so light
 * consumers (home cards, intro copy) can read the shape without pulling the
 * whole question bank into their bundle; the planners re-export everything
 * here, so `lib/mockExam/readingPlanner` stays the natural import for code
 * that already loads the banks.
 *
 * Structure mirrors the 2026 real paper, reverse-engineered from the question
 * -number headers of 79 recalled sets (docs/realbank-set-blueprint.md §1,
 * lib/realExam/blueprint.mjs):
 *
 *   Reading   50 题 = M1 35 + M2 15
 *     M1: CTW ×2 (10 空 each) + RDL 10 题 (2 short ×2Q + 2 long ×3Q) + AP ×1 (5Q)
 *     M2: CTW ×1 (10 空) + AP ×1 (5Q)   ← no RDL in M2
 *   Listening 47 题 = M1 32 + M2 15
 *     M1: LCR ×12 + LC ×3 (2Q) + LA ×3 (2Q) + LAT ×2 (4Q)
 *     M2: LCR ×3 + LC ×2 + LAT ×2       ← no LA in M2
 *
 * Upper and lower Module 2 paths share the SAME composition on both sections;
 * only the difficulty band differs.
 */

import {
  LCR_SECONDS_PER_ITEM,
  listeningSecondsForType,
  TOEFL_LISTENING_SECTION_SECONDS,
} from "../listeningTiming";

/* ---------------------------------------------------------------- Reading */

/** Per-module composition in BANK ITEMS (not questions), in paper order. */
export const READING_MODULE_PLAN = {
  1: { ctw: 2, rdlShort: 2, rdlLong: 2, ap: 1 },
  2: { ctw: 1, ap: 1 },
};

/** Scored questions contributed by ONE item of each type. */
export const READING_QUESTIONS_PER_ITEM = { ctw: 10, rdlShort: 2, rdlLong: 3, ap: 5 };

/** Scored-question total for a reading module (35 / 15). */
export function readingModuleQuestionCount(module) {
  const plan = READING_MODULE_PLAN[module] || {};
  return Object.entries(plan).reduce(
    (sum, [type, count]) => sum + count * (READING_QUESTIONS_PER_ITEM[type] || 0),
    0
  );
}

/** Whole-section scored-question total (50). */
export const READING_TOTAL_QUESTIONS =
  readingModuleQuestionCount(1) + readingModuleQuestionCount(2);

/**
 * Chinese question-count blurb for the intro / home cards:
 *   1 → "35 题 (CTW 20空 + RDL 10题 + AP 5题)"
 *   2 → "15 题 (CTW 10空 + AP 5题)"
 */
export function describeReadingModulePlan(module) {
  const plan = READING_MODULE_PLAN[module];
  if (!plan) return "";
  const parts = [];
  const ctwBlanks = (plan.ctw || 0) * READING_QUESTIONS_PER_ITEM.ctw;
  if (ctwBlanks) parts.push(`CTW ${ctwBlanks}空`);
  const rdlQuestions =
    (plan.rdlShort || 0) * READING_QUESTIONS_PER_ITEM.rdlShort +
    (plan.rdlLong || 0) * READING_QUESTIONS_PER_ITEM.rdlLong;
  if (rdlQuestions) parts.push(`RDL ${rdlQuestions}题`);
  const apQuestions = (plan.ap || 0) * READING_QUESTIONS_PER_ITEM.ap;
  if (apQuestions) parts.push(`AP ${apQuestions}题`);
  return `${readingModuleQuestionCount(module)} 题 (${parts.join(" + ")})`;
}

/**
 * Per-question pace, seconds. Kept EXACTLY as shipped before the blueprint
 * re-balance so the felt pressure is unchanged; only the question counts moved.
 *   before: M1 12 min / 20 题 = 36 s/题 (4 篇 → 3.0 min/篇)
 *           M2 10 min / 30 题 = 20 s/题 (5 篇 → 2.0 min/篇)
 *   after:  M1 36 s × 35 题 = 21 min (7 篇 → 3.0 min/篇, identical pace)
 *           M2 20 s × 15 题 =  5 min (2 篇 → 2.5 min/篇, slightly roomier)
 * Section total 22 → 26 min, purely because Module 1 grew 20 → 35 题.
 */
export const READING_SECONDS_PER_QUESTION = { 1: 36, 2: 20 };

/** Countdown budget for a reading module, in seconds (M1 1260 / M2 300). */
export function readingModuleSeconds(module) {
  return (READING_SECONDS_PER_QUESTION[module] || 0) * readingModuleQuestionCount(module);
}

/* -------------------------------------------------------------- Listening */

/** Paper order of the task types within a listening module. */
export const LISTENING_TASK_ORDER = ["lcr", "lc", "la", "lat"];

/** Per-module composition in BANK ITEMS (段/条, not questions). */
export const LISTENING_MODULE_PLAN = {
  1: { lcr: 12, lc: 3, la: 3, lat: 2 },
  2: { lcr: 3, lc: 2, lat: 2 },
};

/** Scored questions contributed by ONE item of each type. */
export const LISTENING_QUESTIONS_PER_ITEM = { lcr: 1, lc: 2, la: 2, lat: 4 };

const LISTENING_TYPE_LABELS = { lcr: "LCR", lc: "LC", la: "LA", lat: "LAT" };

/** Plan entries for a listening module in paper order, skipping absent types. */
export function orderedListeningPlan(module) {
  const plan = LISTENING_MODULE_PLAN[module] || {};
  return LISTENING_TASK_ORDER.filter((type) => (plan[type] || 0) > 0).map((type) => [type, plan[type]]);
}

/** Scored-question total for a listening module (32 / 15). */
export function listeningModuleQuestionCount(module) {
  return orderedListeningPlan(module).reduce(
    (sum, [type, count]) => sum + count * (LISTENING_QUESTIONS_PER_ITEM[type] || 0),
    0
  );
}

/** Whole-section scored-question total (47). */
export const LISTENING_TOTAL_QUESTIONS =
  listeningModuleQuestionCount(1) + listeningModuleQuestionCount(2);

/**
 * Chinese question-count blurb for the intro / home cards:
 *   1 → "32 题 (12 LCR + 3 LC + 3 LA + 2 LAT)"
 *   2 → "15 题 (3 LCR + 2 LC + 2 LAT)"
 */
export function describeListeningModulePlan(module) {
  const entries = orderedListeningPlan(module);
  if (entries.length === 0) return "";
  const parts = entries.map(([type, count]) => `${count} ${LISTENING_TYPE_LABELS[type]}`);
  return `${listeningModuleQuestionCount(module)} 题 (${parts.join(" + ")})`;
}

/**
 * Rough audio length of one item, seconds — measured from the shipped banks'
 * MEDIAN transcript length at ~150 wpm (lcr 9 词 · lc 91 词 · la 95 词 ·
 * lat 256 词). Only used to weight the module timers, never shown to a user.
 */
const LISTENING_AUDIO_SECONDS = { lcr: 4, lc: 36, la: 38, lat: 102 };

/**
 * Wall-clock demand of one item = audio + its answer windows. The answer
 * windows are the real per-question countdowns from lib/listeningTiming.js
 * (LCR/LC/LA 20s per question, LAT 30s per question).
 */
export function listeningItemSeconds(type) {
  const perQuestion = type === "lcr" ? LCR_SECONDS_PER_ITEM : listeningSecondsForType(type);
  const questions = LISTENING_QUESTIONS_PER_ITEM[type] || 0;
  return (LISTENING_AUDIO_SECONDS[type] || 0) + perQuestion * questions;
}

/** Summed wall-clock demand of a listening module (M1 ≈ 1194s, M2 ≈ 668s). */
export function listeningModuleTimeWeight(module) {
  return orderedListeningPlan(module).reduce(
    (sum, [type, count]) => sum + count * listeningItemSeconds(type),
    0
  );
}

/**
 * Countdown budget for a listening module, in seconds.
 *
 * The 29-minute section budget (TOEFL_LISTENING_SECTION_SECONDS) is unchanged;
 * only the split moved. It used to be weighted by raw ITEM count (12 : 8) back
 * when the mock was a 20-item slice of the section. The mock is now the full
 * 47-question section, so the split is weighted by each module's time DEMAND
 * (audio + answer windows) instead: M2 is lecture-heavy (2 LAT = 8 of its 15
 * questions), and a raw question-count split (32 : 15) would starve it.
 *   M1 ≈ 1194s / M2 ≈ 668s demand → 29 min splits ≈ 18.6 min / 10.4 min.
 * Answer windows are upper bounds (a test-taker can advance early), so the
 * budget is deliberately a little tighter than the worst-case demand — same
 * shape as before.
 */
export function listeningModuleSeconds(module) {
  const total = listeningModuleTimeWeight(1) + listeningModuleTimeWeight(2);
  if (!total) return 0;
  return Math.round((TOEFL_LISTENING_SECTION_SECONDS * listeningModuleTimeWeight(module)) / total);
}

/* ------------------------------------------------------------ Shared copy */

/** "21 + 5 min" style label for the home task cards. */
export function moduleTimeLabel(secondsFor) {
  return `${Math.round(secondsFor(1) / 60)} + ${Math.round(secondsFor(2) / 60)} min`;
}
