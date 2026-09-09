/**
 * Reading Adaptive Mock Exam - Module Planner
 *
 * Structure mirrors the 2026 real paper, reverse-engineered from the question
 * -number headers of 79 recalled sets (docs/realbank-set-blueprint.md §1,
 * lib/realExam/blueprint.mjs): 50 scored questions, Module 1 = 35, Module 2 = 15.
 *
 *   Module 1 (35 题) — paper order CTW, CTW, RDL×4, AP
 *     CTW ×2 (10 blanks each = 20) + RDL 10 questions (2 short ×2Q + 2 long ×3Q)
 *     + AP ×1 (5Q)
 *   Module 2 (15 题) — paper order CTW, AP
 *     CTW ×1 (10 blanks) + AP ×1 (5Q).  **M2 has NO RDL.**
 *
 * Bank item shapes:
 *   - CTW: each item is one passage with 10 blanks
 *   - RDL short: 2 questions per item · RDL long: 3 questions per item
 *   - AP: 5 questions per item
 */

import ctwBank from "../../data/reading/bank/ctw.json";
import rdlShortBank from "../../data/reading/bank/rdl-short.json";
import rdlLongBank from "../../data/reading/bank/rdl-long.json";
import apBank from "../../data/reading/bank/ap.json";
import { READING_MODULE_PLAN, READING_QUESTIONS_PER_ITEM } from "./modulePlans";

// Module composition / question counts / timers live in ./modulePlans (kept
// free of bank imports so light consumers can read the shape without pulling
// the whole question bank). Re-exported here so this planner stays the single
// import for exam-building code.
export {
  READING_MODULE_PLAN,
  READING_QUESTIONS_PER_ITEM,
  READING_TOTAL_QUESTIONS,
  READING_SECONDS_PER_QUESTION,
  readingModuleQuestionCount,
  readingModuleSeconds,
  describeReadingModulePlan as describeModulePlan,
} from "./modulePlans";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Order a candidate list by strict four-tier preference:
 *   ① undone + target difficulty
 *   ② undone + any difficulty
 *   ③ done   + target difficulty
 *   ④ done   + any difficulty
 * Each tier is independently shuffled, then concatenated. Callers slice off the
 * head, so tiers fill progressively (a short tier spills into the next) — never
 * whole-tier replacement. When `doneIds` is empty, tiers ③/④ vanish and the
 * result is [undone+diff, undone+any]; when `difficulties` is empty every item
 * is "diff-matching" so it collapses to [undone, done]. Exported for tests.
 */
export function orderByDonePreference(items, difficulties, doneIds = new Set()) {
  const hasDiff = Array.isArray(difficulties) && difficulties.length > 0;
  const matchesDiff = (item) => !hasDiff || (item.difficulty && difficulties.includes(item.difficulty));
  const isDone = (item) => !!doneIds && doneIds.has(item.id);

  // tiers[0]=①undone+diff, [1]=②undone+any, [2]=③done+diff, [3]=④done+any
  const tiers = [[], [], [], []];
  for (const item of items) {
    const idx = (isDone(item) ? 2 : 0) + (matchesDiff(item) ? 0 : 1);
    tiers[idx].push(item);
  }
  return [...shuffle(tiers[0]), ...shuffle(tiers[1]), ...shuffle(tiers[2]), ...shuffle(tiers[3])];
}

/**
 * Pick `count` items from `pool`, filtering by difficulty and excluding usedIds.
 * Prefers items the user hasn't done yet (see orderByDonePreference for the
 * four-tier priority), but always falls back to done / off-difficulty items so
 * an exam stays fillable even once the bank is exhausted. `excludeIds`
 * (same-exam usedIds) is ALWAYS removed and never re-enters via any tier;
 * `doneIds` is the cross-attempt "already practised" set that only demotes.
 * When the whole (post-exclude) pool is smaller than `count`, returns
 * everything available — unchanged "pool truly too small" semantics.
 * Exported for unit tests.
 */
export function pickItems(pool, count, { difficulties = null, excludeIds = new Set(), doneIds = new Set() } = {}) {
  const available = pool.filter((item) => !excludeIds.has(item.id));
  return orderByDonePreference(available, difficulties, doneIds).slice(0, count);
}

// Minimum preferred-pool size before RDL difficulty filtering kicks in.
// Below this, filtering would recycle the same few passages across repeated
// mock attempts — an unlabelled/thin tier degrades to "any difficulty"
// instead. (CTW/AP picks need only 1-2 items, so pickItems' own >= count
// fallback suffices there; RDL draws from the pool every exam, so it needs
// a real floor.) Exported for unit tests.
export const RDL_MIN_FILTERED_POOL = 30;

/**
 * Restrict an RDL pool to preferred difficulties, unless the resulting pool
 * is too small to rotate healthily. Exported for unit tests.
 */
export function filterRdlPool(pool, difficulties) {
  if (!difficulties || difficulties.length === 0) return pool;
  const preferred = pool.filter(
    (item) => item.difficulty && difficulties.includes(item.difficulty)
  );
  return preferred.length >= RDL_MIN_FILTERED_POOL ? preferred : pool;
}

function asCtw(item) {
  return { ...item, taskType: "ctw" };
}

function asRdl(item) {
  return { ...item, taskType: "rdl" };
}

function asAp(item) {
  return { ...item, taskType: "ap" };
}

function questionCount(item) {
  return Array.isArray(item?.questions) ? item.questions.length : 0;
}

function totalQuestions(items) {
  return items.reduce((sum, item) => sum + questionCount(item), 0);
}

/**
 * RDL shape for a module that has RDL at all: 2 short (2Q) + 2 long (3Q) = 10
 * questions, matching the real paper's Q21-30 band (2+2+3+3).
 */
export const RDL_SET_SHAPE = {
  short: READING_MODULE_PLAN[1].rdlShort,
  long: READING_MODULE_PLAN[1].rdlLong,
};

/** Questions a given RDL shape is supposed to produce (10 for RDL_SET_SHAPE). */
export function rdlTargetQuestions(shape = RDL_SET_SHAPE) {
  return (
    (shape.short || 0) * READING_QUESTIONS_PER_ITEM.rdlShort +
    (shape.long || 0) * READING_QUESTIONS_PER_ITEM.rdlLong
  );
}

/**
 * Take `count` items off an already-ordered candidate list (difficulty-routed,
 * undone-first), preferring items whose question count is exactly `exactCount`
 * so the module lands on its planned question total. Off-count items still
 * fill in behind them rather than leaving the slot empty.
 */
function takePreferringQuestionCount(candidates, count, exactCount) {
  if (count <= 0) return [];
  const exact = [];
  const rest = [];
  for (const item of candidates) (questionCount(item) === exactCount ? exact : rest).push(item);
  return [...exact, ...rest].slice(0, count);
}

/**
 * Pick the RDL block for a module: `shape.short` short passages (2Q each) plus
 * `shape.long` long passages (3Q each) — 10 questions by default. Kept in paper
 * order (shorts before longs, i.e. 2+2+3+3).
 *
 * Difficulty routing is pool-floor-guarded (see filterRdlPool). If the shaped
 * pick still comes up short on QUESTIONS (thin/duplicate-heavy bank, odd
 * question counts), the fallback below searches the FULL pools — no floor
 * guard, no difficulty filter, short and long mixed — so a module can never
 * come up short: 5 shorts, or any short/long mix, is accepted over a gap.
 * Exported for unit tests (pools injectable).
 */
export function pickRdlQuestionSet(
  excludeIds = new Set(),
  difficulties = null,
  pools = null,
  doneIds = new Set(),
  shape = RDL_SET_SHAPE
) {
  const shortPool = pools?.short || rdlShortBank.items;
  const longPool = pools?.long || rdlLongBank.items;
  const target = rdlTargetQuestions(shape);
  if (target <= 0) return [];

  // filterRdlPool applies the difficulty routing (with its floor guard); within
  // that pool we then demote already-done items so undone passages are served
  // first, and finally prefer the exact per-variant question count.
  const order = (pool) =>
    orderUndoneFirst(
      shuffle(filterRdlPool(pool, difficulties).filter((item) => !excludeIds.has(item.id))),
      doneIds
    );

  const picked = [
    ...takePreferringQuestionCount(order(shortPool), shape.short || 0, READING_QUESTIONS_PER_ITEM.rdlShort),
    ...takePreferringQuestionCount(order(longPool), shape.long || 0, READING_QUESTIONS_PER_ITEM.rdlLong),
  ];

  if (totalQuestions(picked) >= target) return picked;

  const pickedIds = new Set(picked.map((item) => item.id));
  const fallback = orderUndoneFirst(
    shuffle([...shortPool, ...longPool]).filter(
      (item) => !excludeIds.has(item.id) && !pickedIds.has(item.id)
    ),
    doneIds
  );
  for (const item of fallback) {
    picked.push(item);
    if (totalQuestions(picked) >= target) break;
  }
  return picked;
}

/**
 * Stable partition that moves already-done items to the back while preserving
 * the (already shuffled) order within each partition. No-op when nothing is
 * done, so difficulty routing / existing behaviour is untouched by default.
 */
function orderUndoneFirst(list, doneIds) {
  if (!doneIds || doneIds.size === 0) return list;
  const undone = [];
  const done = [];
  for (const item of list) (doneIds.has(item.id) ? done : undone).push(item);
  return [...undone, ...done];
}

function pushPicked(items, usedIds, picked, mapper) {
  for (const item of picked) {
    usedIds.add(item.id);
    items.push(mapper(item));
  }
}

/**
 * Build Module 1 items for the Reading section (35 scored questions).
 * Paper order: CTW, CTW, RDL×4, AP.
 * @param {Set<string>} [doneIds] - IDs of items the user already practised;
 *   preferred-against but never hard-excluded (so a full bank still builds).
 *   Omit for the pre-existing behaviour (no cross-attempt de-duplication).
 */
export function buildReadingModule1(doneIds = new Set()) {
  const usedIds = new Set();
  const items = [];
  const plan = READING_MODULE_PLAN[1];
  // Routing module: same easy+medium band for every task type.
  const difficulties = ["easy", "medium"];

  pushPicked(items, usedIds, pickItems(ctwBank.items, plan.ctw, {
    difficulties,
    excludeIds: usedIds,
    doneIds,
  }), asCtw);

  pushPicked(items, usedIds, pickRdlQuestionSet(usedIds, difficulties, null, doneIds, {
    short: plan.rdlShort,
    long: plan.rdlLong,
  }), asRdl);

  pushPicked(items, usedIds, pickItems(apBank.items, plan.ap, {
    difficulties,
    excludeIds: usedIds,
    doneIds,
  }), asAp);

  return { items, usedIds };
}

/**
 * Route to Module 2 based on M1 accuracy.
 * @param {number} m1Accuracy - ratio of correct answers (0-1)
 * @returns {"upper"|"lower"}
 */
export function routeModule2(m1Accuracy) {
  return m1Accuracy >= 0.6 ? "upper" : "lower";
}

/**
 * Build Module 2 items based on routing path (15 scored questions).
 * Paper order: CTW, AP. Upper and lower share the SAME composition and differ
 * only in difficulty band.
 * @param {Set<string>} [doneIds] - see buildReadingModule1.
 */
export function buildReadingModule2(path, usedIds = new Set(), doneIds = new Set()) {
  const items = [];
  const newUsedIds = new Set(usedIds);
  const plan = READING_MODULE_PLAN[2];

  const upper = path === "upper";
  const difficulties = upper ? ["medium", "hard"] : ["easy", "medium"];

  pushPicked(items, newUsedIds, pickItems(ctwBank.items, plan.ctw, {
    difficulties,
    excludeIds: newUsedIds,
    doneIds,
  }), asCtw);

  pushPicked(items, newUsedIds, pickItems(apBank.items, plan.ap, {
    difficulties,
    excludeIds: newUsedIds,
    doneIds,
  }), asAp);

  return { items, usedIds: newUsedIds };
}
