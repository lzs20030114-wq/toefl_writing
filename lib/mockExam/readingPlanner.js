/**
 * Reading Adaptive Mock Exam - Module Planner
 *
 * ETS-style target for a full Reading mock:
 *   - 50 scored items total
 *   - Complete the Words: 30 blanks
 *   - Read in Daily Life: 10 questions
 *   - Academic Passage: 10 questions
 *
 * Existing bank shape:
 *   - CTW: each item is one passage with 10 blanks
 *   - RDL short: 2 questions per item
 *   - RDL long: 3 questions per item
 *   - AP: 5 questions per item
 *
 * Module 1 routes the student with 20 scored items:
 *   CTW(1 set / 10 blanks) + RDL(5 questions) + AP(1 passage / 5 questions)
 *
 * Module 2 completes the exam with 30 scored items:
 *   CTW(2 sets / 20 blanks) + RDL(5 questions) + AP(1 passage / 5 questions)
 */

import ctwBank from "../../data/reading/bank/ctw.json";
import rdlShortBank from "../../data/reading/bank/rdl-short.json";
import rdlLongBank from "../../data/reading/bank/rdl-long.json";
import apBank from "../../data/reading/bank/ap.json";

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

/**
 * Pick RDL items totalling 5 questions (1 short 2Q + 1 long 3Q), preferring
 * the routed difficulties. Difficulty filtering is pool-floor-guarded (see
 * filterRdlPool); the question-count fallback below always searches the FULL
 * pools so an exam can never come up short on questions.
 * Exported for unit tests (pools injectable).
 */
export function pickRdlFiveQuestionSet(excludeIds = new Set(), difficulties = null, pools = null, doneIds = new Set()) {
  const shortPool = pools?.short || rdlShortBank.items;
  const longPool = pools?.long || rdlLongBank.items;

  // filterRdlPool applies the difficulty routing (with its floor guard); within
  // that pool we then demote already-done items so undone passages are served
  // first (the `.find` picks the first matching, undone before done).
  const shortCandidates = orderUndoneFirst(
    shuffle(filterRdlPool(shortPool, difficulties).filter((item) => !excludeIds.has(item.id))),
    doneIds
  );
  const longCandidates = orderUndoneFirst(
    shuffle(filterRdlPool(longPool, difficulties).filter((item) => !excludeIds.has(item.id))),
    doneIds
  );

  const shortItem = shortCandidates.find((item) => questionCount(item) === 2) || shortCandidates[0];
  const longItem = longCandidates.find((item) => questionCount(item) === 3) || longCandidates[0];
  const picked = [shortItem, longItem].filter(Boolean);

  if (picked.reduce((sum, item) => sum + questionCount(item), 0) >= 5) {
    return shuffle(picked);
  }

  // Question-count fallback searches the FULL pools (never floor-guarded) so the
  // exam always reaches 5 questions; undone still comes before done here too.
  const fallback = orderUndoneFirst(
    shuffle([...shortPool, ...longPool])
      .filter((item) => !excludeIds.has(item.id) && !picked.some((p) => p.id === item.id)),
    doneIds
  );
  for (const item of fallback) {
    picked.push(item);
    if (picked.reduce((sum, cur) => sum + questionCount(cur), 0) >= 5) break;
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
 * Build Module 1 items for the Reading section.
 * @param {Set<string>} [doneIds] - IDs of items the user already practised;
 *   preferred-against but never hard-excluded (so a full bank still builds).
 *   Omit for the pre-existing behaviour (no cross-attempt de-duplication).
 */
export function buildReadingModule1(doneIds = new Set()) {
  const usedIds = new Set();
  const items = [];

  pushPicked(items, usedIds, pickItems(ctwBank.items, 1, {
    difficulties: ["easy", "medium"],
    doneIds,
  }), asCtw);

  // Routing module: same easy+medium band as CTW/AP above
  pushPicked(items, usedIds, pickRdlFiveQuestionSet(usedIds, ["easy", "medium"], null, doneIds), asRdl);

  pushPicked(items, usedIds, pickItems(apBank.items, 1, {
    difficulties: ["easy", "medium"],
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
 * Build Module 2 items based on routing path.
 * @param {Set<string>} [doneIds] - see buildReadingModule1.
 */
export function buildReadingModule2(path, usedIds = new Set(), doneIds = new Set()) {
  const items = [];
  const newUsedIds = new Set(usedIds);

  const upper = path === "upper";
  const difficulties = upper ? ["medium", "hard"] : ["easy", "medium"];

  pushPicked(items, newUsedIds, pickItems(ctwBank.items, 2, {
    difficulties,
    excludeIds: newUsedIds,
    doneIds,
  }), asCtw);

  // RDL follows the routing path too (pool-floor-guarded, see filterRdlPool)
  pushPicked(items, newUsedIds, pickRdlFiveQuestionSet(newUsedIds, difficulties, null, doneIds), asRdl);

  pushPicked(items, newUsedIds, pickItems(apBank.items, 1, {
    difficulties,
    excludeIds: newUsedIds,
    doneIds,
  }), asAp);

  return { items, usedIds: newUsedIds };
}
