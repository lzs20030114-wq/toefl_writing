/**
 * Adaptive mock exam — timeout finalization scoring.
 *
 * Guards the 2026-07 fix: when a module's clock runs out, the in-progress task
 * must still be scored (partial answers) and every not-yet-reached task counts
 * as wrong — the module's scored total must always equal its planned total, so
 * "学术阅读" (always last) can no longer be silently discarded.
 */

import {
  itemScorableCount,
  plannedTotal,
  buildUnattemptedResult,
  finalizeTimedOutResults,
} from "../lib/mockExam/timeoutFinalize";

// ── Fixtures ──
const ctwItem = () => ({
  id: "ctw1",
  taskType: "ctw",
  blanks: [
    { original_word: "cat", displayed_fragment: "c" },
    { original_word: "dog", displayed_fragment: "d" },
  ],
});
const lcrItem = () => ({ id: "lcr1", taskType: "lcr", answer: "B" });
const mcqItem = () => ({
  id: "mcq1",
  taskType: "rdl",
  questions: [{ correct_answer: "A" }, { answer: "B" }, { correct_answer: "C" }],
});

describe("itemScorableCount / plannedTotal", () => {
  test("counts blanks / 1 / questions per task type", () => {
    expect(itemScorableCount(ctwItem())).toBe(2);
    expect(itemScorableCount(lcrItem())).toBe(1);
    expect(itemScorableCount(mcqItem())).toBe(3);
  });

  test("degenerate items count as 0, unknown types fall back to questions", () => {
    expect(itemScorableCount(null)).toBe(0);
    expect(itemScorableCount({ taskType: "ctw" })).toBe(0);
    expect(itemScorableCount({ taskType: "lat", questions: [{}, {}] })).toBe(2);
  });

  test("plannedTotal sums across the module", () => {
    expect(plannedTotal([ctwItem(), lcrItem(), mcqItem()])).toBe(6);
    expect(plannedTotal([])).toBe(0);
  });
});

describe("buildUnattemptedResult", () => {
  test("ctw → every blank wrong, userAnswer null", () => {
    const r = buildUnattemptedResult(ctwItem());
    expect(r).toMatchObject({ correct: 0, total: 2, unanswered: 2 });
    expect(r.results).toEqual([
      { userAnswer: null, isCorrect: false },
      { userAnswer: null, isCorrect: false },
    ]);
  });

  test("lcr → single wrong result, correct key preserved", () => {
    const r = buildUnattemptedResult(lcrItem());
    expect(r).toEqual({
      correct: 0,
      total: 1,
      unanswered: 1,
      results: [{ selected: null, correct: "B", isCorrect: false }],
    });
  });

  test("mcq → each question wrong, correct_answer||answer preserved", () => {
    const r = buildUnattemptedResult(mcqItem());
    expect(r).toMatchObject({ correct: 0, total: 3, unanswered: 3 });
    expect(r.results).toEqual([
      { selected: null, correct: "A", isCorrect: false },
      { selected: null, correct: "B", isCorrect: false },
      { selected: null, correct: "C", isCorrect: false },
    ]);
  });
});

describe("finalizeTimedOutResults", () => {
  test("(a) no collector — remaining tasks all wrong, total === plannedTotal", () => {
    const items = [ctwItem(), lcrItem(), mcqItem()];
    // First task already submitted (ctw: 1/2 correct).
    const completed = [
      {
        correct: 1,
        total: 2,
        results: [
          { userAnswer: "cat", isCorrect: true },
          { userAnswer: "dxx", isCorrect: false },
        ],
      },
    ];
    const final = finalizeTimedOutResults(items, completed, null);

    expect(final).toHaveLength(3);
    // Scored total must equal the module's planned total (nothing discarded).
    expect(final.reduce((s, r) => s + r.total, 0)).toBe(plannedTotal(items));
    // The two unreached tasks are all-wrong shells.
    expect(final[1]).toMatchObject({ correct: 0, total: 1, unanswered: 1, timedOut: true });
    expect(final[2]).toMatchObject({ correct: 0, total: 3, unanswered: 3, timedOut: true });
  });

  test("(b) collector hit — in-progress partial answers are scored", () => {
    const items = [mcqItem()]; // 3-question MCQ still on screen
    const collect = () => ({
      itemId: "mcq1",
      correct: 1,
      total: 3,
      unanswered: 1,
      results: [
        { selected: "A", correct: "A", isCorrect: true },
        { selected: "D", correct: "B", isCorrect: false },
        { selected: null, correct: "C", isCorrect: false },
      ],
    });
    const final = finalizeTimedOutResults(items, [], collect);

    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({ correct: 1, total: 3, unanswered: 1, timedOut: true });
    expect(final[0].item).toBe(items[0]);
    expect(final[0].results[0].isCorrect).toBe(true);
  });

  test("(c) collector itemId mismatch — ignored, falls back to unattempted", () => {
    const items = [mcqItem()];
    const collect = () => ({ itemId: "SOME_OTHER_ID", correct: 3, total: 3, results: [], unanswered: 0 });
    const final = finalizeTimedOutResults(items, [], collect);

    // Mismatched partial rejected → all wrong.
    expect(final[0]).toMatchObject({ correct: 0, total: 3, unanswered: 3, timedOut: true });
  });

  test("(d) collector throws — does not crash, falls back to unattempted", () => {
    const items = [mcqItem()];
    const collect = () => { throw new Error("boom"); };
    let final;
    expect(() => { final = finalizeTimedOutResults(items, [], collect); }).not.toThrow();
    expect(final[0]).toMatchObject({ correct: 0, total: 3, unanswered: 3, timedOut: true });
  });

  test("(e) completed results are preserved untouched; new entries carry timedOut + item", () => {
    const items = [ctwItem(), lcrItem()];
    const completedEntry = { correct: 2, total: 2, results: [], item: ctwItem() };
    const completed = [completedEntry];
    const final = finalizeTimedOutResults(items, completed, null);

    // Original entry kept by reference, no timedOut flag added to it.
    expect(final[0]).toBe(completedEntry);
    expect(final[0].timedOut).toBeUndefined();
    // Appended entry is flagged and references the planned item.
    expect(final[1].timedOut).toBe(true);
    expect(final[1].item).toBe(items[1]);
  });

  test("total invariant holds even when collector supplies a mismatched total", () => {
    const items = [mcqItem()];
    // Collector claims total=5 (inconsistent) → rejected, unattempted total=3.
    const collect = () => ({ itemId: "mcq1", correct: 2, total: 5, results: [], unanswered: 0 });
    const final = finalizeTimedOutResults(items, [], collect);
    expect(final.reduce((s, r) => s + r.total, 0)).toBe(plannedTotal(items));
  });
});
