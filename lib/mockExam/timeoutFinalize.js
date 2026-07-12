/**
 * Adaptive mock exam — timeout finalization (pure, testable).
 *
 * When a module's countdown hits zero, ETS-style scoring counts every question
 * the student didn't answer as WRONG (not discarded). This module rebuilds a
 * module's results array so its scored total always equals the planned total:
 *   - completed tasks keep their real results,
 *   - the task in progress (if any) contributes its partially-selected answers,
 *   - tasks never reached are filled in as all-wrong (unanswered) shells.
 *
 * Keeping this separate from the React shell means the scoring invariant
 * (sum of totals === plannedTotal) can be unit-tested without a DOM.
 */

/**
 * Scored-question count for a single planned item.
 *   ctw → number of blanks · lcr → 1 · everything else → number of questions.
 */
export function itemScorableCount(item) {
  if (!item) return 0;
  if (item.taskType === "ctw") return (item.blanks || []).length;
  if (item.taskType === "lcr") return 1;
  return (item.questions || []).length;
}

/**
 * Total scored questions across a module's planned items.
 */
export function plannedTotal(items) {
  return (items || []).reduce((sum, item) => sum + itemScorableCount(item), 0);
}

/**
 * Build an all-wrong result for an item the student never reached (or reached
 * but left entirely blank). Shapes match what each inline task's onComplete
 * would have produced, so the post-exam review renders them the same way —
 * only every answer is marked incorrect.
 */
export function buildUnattemptedResult(item) {
  const total = itemScorableCount(item);
  if (item.taskType === "ctw") {
    // userAnswer null (not the bare fragment) so the review shows "(未填)".
    const results = (item.blanks || []).map(() => ({ userAnswer: null, isCorrect: false }));
    return { correct: 0, total, results, unanswered: total };
  }
  if (item.taskType === "lcr") {
    const results = [{ selected: null, correct: item.answer, isCorrect: false }];
    return { correct: 0, total, results, unanswered: total };
  }
  const results = (item.questions || []).map((q) => ({
    selected: null,
    correct: q.correct_answer || q.answer,
    isCorrect: false,
  }));
  return { correct: 0, total, results, unanswered: total };
}

/**
 * True when a partial-collector payload is a well-formed snapshot for the
 * given item (right item id, sane numbers, results array, and a total that
 * matches the item's scorable count so the plannedTotal invariant holds).
 */
function isValidPartial(partial, item) {
  return (
    partial &&
    typeof partial === "object" &&
    partial.itemId === item.id &&
    Array.isArray(partial.results) &&
    Number.isFinite(partial.correct) &&
    Number.isFinite(partial.total) &&
    partial.total === itemScorableCount(item)
  );
}

/**
 * Reconstruct a module's full results array at timeout.
 *
 * @param {Array}    items            The module's planned items (in order).
 * @param {Array}    completedResults Results already submitted this module.
 * @param {Function} [collectPartial] Returns the in-progress task's partial
 *                                    answers as { itemId, correct, total,
 *                                    results, unanswered }. Only consulted for
 *                                    the item at index completedResults.length.
 * @returns {Array} completedResults + one entry per remaining item. Each added
 *   entry carries `item`; only entries that still contain unanswered questions
 *   (unanswered > 0) are flagged `timedOut: true`. A task the collector found
 *   fully answered before the clock hit zero is scored normally and left
 *   unflagged, so the review doesn't badge a punctually-finished task as
 *   timed out. Invariant: the returned array's summed `total` equals
 *   plannedTotal(items) (assuming each completed result's total already matches
 *   its item's scorable count).
 */
export function finalizeTimedOutResults(items, completedResults, collectPartial) {
  const safeItems = Array.isArray(items) ? items : [];
  const finalResults = Array.isArray(completedResults) ? [...completedResults] : [];
  const startIdx = finalResults.length;

  for (let i = startIdx; i < safeItems.length; i++) {
    const item = safeItems[i];
    let entry = null;

    // The in-progress task (first unreached item) may have partially-selected
    // answers still living in its component state — pull them in so they score.
    if (i === startIdx && typeof collectPartial === "function") {
      try {
        const partial = collectPartial();
        if (isValidPartial(partial, item)) {
          entry = {
            correct: partial.correct,
            total: partial.total,
            results: partial.results,
            unanswered: Number.isFinite(partial.unanswered) ? partial.unanswered : 0,
          };
        }
      } catch {
        entry = null; // collector threw → fall back to all-wrong below
      }
    }

    if (!entry) entry = buildUnattemptedResult(item);
    // Only flag as timed-out when the entry still has unanswered questions. A
    // student who answered everything (or submitted ≤1s before the clock hit
    // zero) leaves the collector reporting unanswered:0 — that task was scored
    // punctually and must not wear the "⏱ 超时" badge.
    finalResults.push({ ...entry, item, timedOut: (entry.unanswered || 0) > 0 });
  }

  return finalResults;
}
