/**
 * Listening Adaptive Mock Exam — Module Planner
 *
 * Module 1: LCR(10 mixed) + LA(1) + LC(1)
 * Module 2 depends on M1 accuracy (all types difficulty-routed, not just LCR):
 *   Upper (>=60%): LCR(5 med+hard) + LA(1 med+hard) + LC(1 med+hard) + LAT(1 med+hard)
 *   Lower (<60%):  LCR(5 easy+med) + LA(2 easy+med) + LC(1 easy+med), no LAT
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
 * Order a candidate list by strict four-tier preference:
 *   ① undone + target difficulty
 *   ② undone + any difficulty
 *   ③ done   + target difficulty
 *   ④ done   + any difficulty
 * Each tier is independently shuffled, then concatenated; callers slice off the
 * head so tiers fill progressively (never whole-tier replacement). Items with
 * no difficulty field are "any" (never diff-matching). Exported for tests.
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
 * Prefers items the user hasn't done yet (four-tier priority, see
 * orderByDonePreference) but always falls back to done / off-difficulty items so
 * the exam stays fillable once the bank is exhausted. `excludeIds` (same-exam
 * usedIds) is ALWAYS removed and never re-enters via any tier; `doneIds` only
 * demotes. Note: some listening items lack a difficulty field — they are treated
 * as "any". Exported for unit tests.
 */
export function pickItems(pool, count, { difficulties = null, excludeIds = new Set(), doneIds = new Set() } = {}) {
  const available = pool.filter((item) => !excludeIds.has(item.id));
  return orderByDonePreference(available, difficulties, doneIds).slice(0, count);
}

/**
 * Build Module 1 items for the Listening section.
 *
 * Composition: LCR(10 mixed) + LA(1) + LC(1)
 * Total items: 12 (LCR = 10 single-Q items, LA = 1 multi-Q item, LC = 1 multi-Q item)
 */
/**
 * @param {Set<string>} [doneIds] - IDs of items the user already practised;
 *   preferred-against but never hard-excluded. Omit for the pre-existing
 *   behaviour (no cross-attempt de-duplication).
 */
export function buildListeningModule1(doneIds = new Set()) {
  const usedIds = new Set();
  const items = [];

  // 10 LCR items, mixed difficulty
  const lcrItems = pickItems(lcrBank.items, 10, { excludeIds: usedIds, doneIds });
  for (const item of lcrItems) {
    usedIds.add(item.id);
    items.push({ ...item, taskType: "lcr" });
  }

  // 1 LA (announcement)
  const laItems = pickItems(laBank.items, 1, { excludeIds: usedIds, doneIds });
  for (const item of laItems) {
    usedIds.add(item.id);
    items.push({ ...item, taskType: "la" });
  }

  // 1 LC (conversation)
  const lcItems = pickItems(lcBank.items, 1, { excludeIds: usedIds, doneIds });
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
 * Upper: LCR(5 med+hard) + LA(1 med+hard) + LC(1 med+hard) + LAT(1 med+hard)
 * Lower: LCR(5 easy+med) + LA(2 easy+med) + LC(1 easy+med), no LAT
 */
export function buildListeningModule2(path, usedIds = new Set(), doneIds = new Set()) {
  const items = [];
  const newUsedIds = new Set(usedIds);

  // All M2 types follow the routing path; pickItems falls back to the full
  // pool when a bank lacks enough labelled items, so routing never starves.
  const difficulties = path === "upper" ? ["medium", "hard"] : ["easy", "medium"];

  const pushAll = (picked, taskType) => {
    for (const item of picked) {
      newUsedIds.add(item.id);
      items.push({ ...item, taskType });
    }
  };

  if (path === "upper") {
    pushAll(pickItems(lcrBank.items, 5, { difficulties, excludeIds: newUsedIds, doneIds }), "lcr");
    pushAll(pickItems(laBank.items, 1, { difficulties, excludeIds: newUsedIds, doneIds }), "la");
    pushAll(pickItems(lcBank.items, 1, { difficulties, excludeIds: newUsedIds, doneIds }), "lc");
    pushAll(pickItems(latBank.items, 1, { difficulties, excludeIds: newUsedIds, doneIds }), "lat");
  } else {
    pushAll(pickItems(lcrBank.items, 5, { difficulties, excludeIds: newUsedIds, doneIds }), "lcr");
    pushAll(pickItems(laBank.items, 2, { difficulties, excludeIds: newUsedIds, doneIds }), "la");
    pushAll(pickItems(lcBank.items, 1, { difficulties, excludeIds: newUsedIds, doneIds }), "lc");
  }

  return { items, usedIds: newUsedIds };
}
