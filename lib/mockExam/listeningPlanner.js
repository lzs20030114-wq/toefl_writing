/**
 * Listening Adaptive Mock Exam — Module Planner
 *
 * Module 1: LCR(10 mixed) + LA(1) + LC(1)
 * Module 2 depends on M1 accuracy:
 *   Upper (>=60%): LCR(5 med+hard) + LA(1) + LC(1) + LAT(1)
 *   Lower (<60%):  LCR(5 easy+med) + LA(2) + LC(1), no LAT
 */

import lcrBank from "../../data/listening/bank/lcr.json";
import laBank from "../../data/listening/bank/la.json";
import lcBank from "../../data/listening/bank/lc.json";
import latBank from "../../data/listening/bank/lat.json";

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
 * Note: some listening items lack a difficulty field — they are treated as "any".
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
    // else fall back to all candidates (including those without difficulty)
  }

  return shuffle(candidates).slice(0, count);
}

/**
 * Build Module 1 items for the Listening section.
 *
 * Composition: LCR(10 mixed) + LA(1) + LC(1)
 * Total items: 12 (LCR = 10 single-Q items, LA = 1 multi-Q item, LC = 1 multi-Q item)
 */
export function buildListeningModule1() {
  const usedIds = new Set();
  const items = [];

  // 10 LCR items, mixed difficulty
  const lcrItems = pickItems(lcrBank.items, 10, { excludeIds: usedIds });
  for (const item of lcrItems) {
    usedIds.add(item.id);
    items.push({ ...item, taskType: "lcr" });
  }

  // 1 LA (announcement)
  const laItems = pickItems(laBank.items, 1, { excludeIds: usedIds });
  for (const item of laItems) {
    usedIds.add(item.id);
    items.push({ ...item, taskType: "la" });
  }

  // 1 LC (conversation)
  const lcItems = pickItems(lcBank.items, 1, { excludeIds: usedIds });
  for (const item of lcItems) {
    usedIds.add(item.id);
    items.push({ ...item, taskType: "lc" });
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
 * Upper: LCR(5 med+hard) + LA(1) + LC(1) + LAT(1)
 * Lower: LCR(5 easy+med) + LA(2) + LC(1), no LAT
 */
export function buildListeningModule2(path, usedIds = new Set()) {
  const items = [];
  const newUsedIds = new Set(usedIds);

  if (path === "upper") {
    // LCR: 5 medium+hard
    const lcrItems = pickItems(lcrBank.items, 5, {
      difficulties: ["medium", "hard"],
      excludeIds: newUsedIds,
    });
    for (const item of lcrItems) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType: "lcr" });
    }

    // LA: 1
    const laItems = pickItems(laBank.items, 1, { excludeIds: newUsedIds });
    for (const item of laItems) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType: "la" });
    }

    // LC: 1
    const lcItems = pickItems(lcBank.items, 1, { excludeIds: newUsedIds });
    for (const item of lcItems) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType: "lc" });
    }

    // LAT: 1
    const latItems = pickItems(latBank.items, 1, { excludeIds: newUsedIds });
    for (const item of latItems) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType: "lat" });
    }
  } else {
    // Lower path
    // LCR: 5 easy+medium
    const lcrItems = pickItems(lcrBank.items, 5, {
      difficulties: ["easy", "medium"],
      excludeIds: newUsedIds,
    });
    for (const item of lcrItems) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType: "lcr" });
    }

    // LA: 2
    const laItems = pickItems(laBank.items, 2, { excludeIds: newUsedIds });
    for (const item of laItems) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType: "la" });
    }

    // LC: 1
    const lcItems = pickItems(lcBank.items, 1, { excludeIds: newUsedIds });
    for (const item of lcItems) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType: "lc" });
    }
  }

  return { items, usedIds: newUsedIds };
}
