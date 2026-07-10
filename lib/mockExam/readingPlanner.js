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
 * Pick `count` items from `pool`, filtering by difficulty and excluding usedIds.
 * Falls back to any available items if not enough at the desired difficulties.
 * Exported for unit tests.
 */
export function pickItems(pool, count, { difficulties = null, excludeIds = new Set() } = {}) {
  let candidates = pool.filter((item) => !excludeIds.has(item.id));

  if (difficulties && difficulties.length > 0) {
    const preferred = candidates.filter(
      (item) => item.difficulty && difficulties.includes(item.difficulty)
    );
    if (preferred.length >= count) {
      candidates = preferred;
    }
  }

  return shuffle(candidates).slice(0, count);
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
export function pickRdlFiveQuestionSet(excludeIds = new Set(), difficulties = null, pools = null) {
  const shortPool = pools?.short || rdlShortBank.items;
  const longPool = pools?.long || rdlLongBank.items;

  const shortCandidates = shuffle(
    filterRdlPool(shortPool, difficulties).filter((item) => !excludeIds.has(item.id))
  );
  const longCandidates = shuffle(
    filterRdlPool(longPool, difficulties).filter((item) => !excludeIds.has(item.id))
  );

  const shortItem = shortCandidates.find((item) => questionCount(item) === 2) || shortCandidates[0];
  const longItem = longCandidates.find((item) => questionCount(item) === 3) || longCandidates[0];
  const picked = [shortItem, longItem].filter(Boolean);

  if (picked.reduce((sum, item) => sum + questionCount(item), 0) >= 5) {
    return shuffle(picked);
  }

  const fallback = shuffle([...shortPool, ...longPool])
    .filter((item) => !excludeIds.has(item.id) && !picked.some((p) => p.id === item.id));
  for (const item of fallback) {
    picked.push(item);
    if (picked.reduce((sum, cur) => sum + questionCount(cur), 0) >= 5) break;
  }
  return picked;
}

function pushPicked(items, usedIds, picked, mapper) {
  for (const item of picked) {
    usedIds.add(item.id);
    items.push(mapper(item));
  }
}

/**
 * Build Module 1 items for the Reading section.
 */
export function buildReadingModule1() {
  const usedIds = new Set();
  const items = [];

  pushPicked(items, usedIds, pickItems(ctwBank.items, 1, {
    difficulties: ["easy", "medium"],
  }), asCtw);

  // Routing module: same easy+medium band as CTW/AP above
  pushPicked(items, usedIds, pickRdlFiveQuestionSet(usedIds, ["easy", "medium"]), asRdl);

  pushPicked(items, usedIds, pickItems(apBank.items, 1, {
    difficulties: ["easy", "medium"],
    excludeIds: usedIds,
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
 */
export function buildReadingModule2(path, usedIds = new Set()) {
  const items = [];
  const newUsedIds = new Set(usedIds);

  const upper = path === "upper";
  const difficulties = upper ? ["medium", "hard"] : ["easy", "medium"];

  pushPicked(items, newUsedIds, pickItems(ctwBank.items, 2, {
    difficulties,
    excludeIds: newUsedIds,
  }), asCtw);

  // RDL follows the routing path too (pool-floor-guarded, see filterRdlPool)
  pushPicked(items, newUsedIds, pickRdlFiveQuestionSet(newUsedIds, difficulties), asRdl);

  pushPicked(items, newUsedIds, pickItems(apBank.items, 1, {
    difficulties,
    excludeIds: newUsedIds,
  }), asAp);

  return { items, usedIds: newUsedIds };
}
