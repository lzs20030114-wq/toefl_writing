/**
 * Reading Adaptive Mock Exam — Module Planner
 *
 * Module 1 (routing stage): CTW(10 easy+medium) + RDL-short(5) + AP(1 easy, 5 Qs)
 * Module 2 depends on M1 accuracy:
 *   Upper (>=60%): CTW(5 med+hard) + RDL-long(2) + AP(1 med/hard)
 *   Lower (<60%):  CTW(5 easy+med) + RDL-short(3) + AP(1 easy)
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
    // else fall back to all candidates
  }

  return shuffle(candidates).slice(0, count);
}

/**
 * Build Module 1 items for the Reading section.
 * Returns an array of item objects with a `taskType` field added.
 *
 * Composition: 10 CTW (easy+medium) + 5 RDL-short + 1 AP (easy)
 * Total individual scorable items:
 *   - CTW: 10 blanks each = 10 items (each item has multiple blanks scored together)
 *   - RDL-short: 5 items with 2 Qs each = 10 questions
 *   - AP: 1 item with 5 Qs = 5 questions
 *   Total scoring granularity: 10 CTW items + 5 RDL items + 1 AP item = 16 items
 */
export function buildReadingModule1() {
  const usedIds = new Set();
  const items = [];

  // 10 CTW items, easy+medium
  const ctwItems = pickItems(ctwBank.items, 10, {
    difficulties: ["easy", "medium"],
  });
  for (const item of ctwItems) {
    usedIds.add(item.id);
    items.push({ ...item, taskType: "ctw" });
  }

  // 5 RDL-short items
  const rdlItems = pickItems(rdlShortBank.items, 5, {
    excludeIds: usedIds,
  });
  for (const item of rdlItems) {
    usedIds.add(item.id);
    items.push({ ...item, taskType: "rdl" });
  }

  // 1 AP item, easy
  const apItems = pickItems(apBank.items, 1, {
    difficulties: ["easy"],
    excludeIds: usedIds,
  });
  for (const item of apItems) {
    usedIds.add(item.id);
    items.push({ ...item, taskType: "ap" });
  }

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
 *
 * Upper: CTW(5 med+hard) + RDL-long(2) + AP(1 med/hard)
 * Lower: CTW(5 easy+med) + RDL-short(3) + AP(1 easy)
 */
export function buildReadingModule2(path, usedIds = new Set()) {
  const items = [];
  const newUsedIds = new Set(usedIds);

  if (path === "upper") {
    // CTW: 5 medium+hard
    const ctwItems = pickItems(ctwBank.items, 5, {
      difficulties: ["medium", "hard"],
      excludeIds: newUsedIds,
    });
    for (const item of ctwItems) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType: "ctw" });
    }

    // RDL-long: 2 items
    const rdlItems = pickItems(rdlLongBank.items, 2, {
      excludeIds: newUsedIds,
    });
    for (const item of rdlItems) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType: "rdl" });
    }

    // AP: 1 medium or hard
    const apItems = pickItems(apBank.items, 1, {
      difficulties: ["medium", "hard"],
      excludeIds: newUsedIds,
    });
    for (const item of apItems) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType: "ap" });
    }
  } else {
    // Lower path
    // CTW: 5 easy+medium
    const ctwItems = pickItems(ctwBank.items, 5, {
      difficulties: ["easy", "medium"],
      excludeIds: newUsedIds,
    });
    for (const item of ctwItems) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType: "ctw" });
    }

    // RDL-short: 3 items
    const rdlItems = pickItems(rdlShortBank.items, 3, {
      excludeIds: newUsedIds,
    });
    for (const item of rdlItems) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType: "rdl" });
    }

    // AP: 1 easy
    const apItems = pickItems(apBank.items, 1, {
      difficulties: ["easy"],
      excludeIds: newUsedIds,
    });
    for (const item of apItems) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType: "ap" });
    }
  }

  return { items, usedIds: newUsedIds };
}
