/**
 * Listening Adaptive Mock Exam — Module Planner
 *
 * Structure mirrors the 2026 real paper, reverse-engineered from the question
 * -number headers of 79 recalled sets (docs/realbank-set-blueprint.md §1,
 * lib/realExam/blueprint.mjs): 47 scored questions, Module 1 = 32, Module 2 = 15.
 *
 *   Module 1 (32 题) — paper order LCR×12, LC×3, LA×3, LAT×2
 *     LCR 12 (1Q each) + LC 3 段 (2Q each) + LA 3 段 (2Q each) + LAT 2 段 (4Q each)
 *   Module 2 (15 题) — paper order LCR×3, LC×2, LAT×2
 *     LCR 3 + LC 2 段 + LAT 2 段.  **No LA in M2.**
 *
 * Upper and lower paths have the SAME composition and differ only in the
 * difficulty band they draw from. (The real paper also has a rarer M2 "B"型 —
 * 7 短应答 + 1 讲座 + 2 段 2 题短材料 — seen in exactly one recalled set; we
 * do not model it.)
 */

import lcrBank from "../../data/listening/bank/lcr.json";
import laBank from "../../data/listening/bank/la.json";
import lcBank from "../../data/listening/bank/lc.json";
import latBank from "../../data/listening/bank/lat.json";
import { orderedListeningPlan } from "./modulePlans";

/** Bank lookup by task type. */
const BANKS = { lcr: lcrBank, la: laBank, lc: lcBank, lat: latBank };

// Module composition / question counts / timers live in ./modulePlans (kept
// free of bank imports so light consumers can read the shape without pulling
// the whole question bank). Re-exported here so this planner stays the single
// import for exam-building code.
export {
  LISTENING_MODULE_PLAN,
  LISTENING_QUESTIONS_PER_ITEM,
  LISTENING_TASK_ORDER,
  LISTENING_TOTAL_QUESTIONS,
  listeningModuleQuestionCount,
  listeningModuleSeconds,
  listeningModuleTimeWeight,
  listeningItemSeconds,
  describeListeningModulePlan as describeModulePlan,
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

/** Fill a module from its plan, in paper order, tagging each item's taskType. */
function buildFromPlan(module, { difficulties = null, usedIds, doneIds }) {
  const items = [];
  for (const [type, count] of orderedListeningPlan(module)) {
    const picked = pickItems(BANKS[type].items, count, { difficulties, excludeIds: usedIds, doneIds });
    for (const item of picked) {
      usedIds.add(item.id);
      items.push({ ...item, taskType: type });
    }
  }
  return items;
}

/**
 * Build Module 1 items for the Listening section (32 scored questions).
 * Composition: LCR×12 + LC×3 + LA×3 + LAT×2, mixed difficulty (routing module).
 * @param {Set<string>} [doneIds] - IDs of items the user already practised;
 *   preferred-against but never hard-excluded. Omit for the pre-existing
 *   behaviour (no cross-attempt de-duplication).
 */
export function buildListeningModule1(doneIds = new Set()) {
  const usedIds = new Set();
  const items = buildFromPlan(1, { difficulties: null, usedIds, doneIds });
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
 * Composition: LCR×3 + LC×2 + LAT×2 on BOTH paths — upper draws medium+hard,
 * lower draws easy+medium. pickItems falls back to the full pool when a bank
 * lacks enough labelled items, so routing never starves.
 */
export function buildListeningModule2(path, usedIds = new Set(), doneIds = new Set()) {
  const newUsedIds = new Set(usedIds);
  const difficulties = path === "upper" ? ["medium", "hard"] : ["easy", "medium"];
  const items = buildFromPlan(2, { difficulties, usedIds: newUsedIds, doneIds });
  return { items, usedIds: newUsedIds };
}
