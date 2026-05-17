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
 */
function pickItems(pool, count, { difficulties = null, excludeIds = new Set() } = {}) {
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

function pickRdlFiveQuestionSet(excludeIds = new Set()) {
  const shortCandidates = shuffle(rdlShortBank.items.filter((item) => !excludeIds.has(item.id)));
  const longCandidates = shuffle(rdlLongBank.items.filter((item) => !excludeIds.has(item.id)));

  const shortItem = shortCandidates.find((item) => questionCount(item) === 2) || shortCandidates[0];
  const longItem = longCandidates.find((item) => questionCount(item) === 3) || longCandidates[0];
  const picked = [shortItem, longItem].filter(Boolean);

  if (picked.reduce((sum, item) => sum + questionCount(item), 0) >= 5) {
    return shuffle(picked);
  }

  const fallback = shuffle([...rdlShortBank.items, ...rdlLongBank.items])
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

  pushPicked(items, usedIds, pickRdlFiveQuestionSet(usedIds), asRdl);

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
  pushPicked(items, newUsedIds, pickItems(ctwBank.items, 2, {
    difficulties: upper ? ["medium", "hard"] : ["easy", "medium"],
    excludeIds: newUsedIds,
  }), asCtw);

  pushPicked(items, newUsedIds, pickRdlFiveQuestionSet(newUsedIds), asRdl);

  pushPicked(items, newUsedIds, pickItems(apBank.items, 1, {
    difficulties: upper ? ["medium", "hard"] : ["easy", "medium"],
    excludeIds: newUsedIds,
  }), asAp);

  return { items, usedIds: newUsedIds };
}
