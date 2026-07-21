/**
 * Speaking mock planner — done-set exclusion.
 *
 * buildSpeakingExam(excludeIds) should prefer sets the user hasn't practised,
 * but must always fall back to the full pool once everything's been seen —
 * Interview has only ~11 sets, so a heavy user WILL exhaust it and the exam
 * must still build (never return a null set / fail to open).
 */

import { buildSpeakingExam } from "../lib/mockExam/speakingPlanner";
import repeatBank from "../data/speaking/bank/repeat.json";
import interviewBank from "../data/speaking/bank/interview.json";

describe("buildSpeakingExam done-set exclusion", () => {
  test("prefers the only undone set of each type", () => {
    const keepRepeat = repeatBank.items[0].id;
    const keepInterview = interviewBank.items[0].id;
    // Everything done except one repeat + one interview set.
    const done = new Set([
      ...repeatBank.items.map((s) => s.id).filter((id) => id !== keepRepeat),
      ...interviewBank.items.map((s) => s.id).filter((id) => id !== keepInterview),
    ]);
    for (let k = 0; k < 20; k++) {
      const exam = buildSpeakingExam(done);
      expect(exam.repeatSet.id).toBe(keepRepeat);
      expect(exam.interviewSet.id).toBe(keepInterview);
    }
  });

  test("falls back to the full pool when every set is done (Interview only ~11)", () => {
    const allDone = new Set([
      ...repeatBank.items.map((s) => s.id),
      ...interviewBank.items.map((s) => s.id),
    ]);
    for (let k = 0; k < 20; k++) {
      const exam = buildSpeakingExam(allDone);
      expect(exam.repeatSet).toBeTruthy();
      expect(exam.interviewSet).toBeTruthy();
    }
  });

  test("no excludeIds → still builds a complete exam (legacy behaviour)", () => {
    const exam = buildSpeakingExam();
    expect(exam.repeatSet).toBeTruthy();
    expect(exam.interviewSet).toBeTruthy();
    expect(exam.totalTime).toBe(480);
  });
});
