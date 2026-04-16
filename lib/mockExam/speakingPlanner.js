/**
 * Speaking Mock Exam — Planner
 *
 * Builds a speaking exam with two tasks:
 *   Task 1: Listen & Repeat — 1 set of 7 sentences (~3 min)
 *   Task 2: Take an Interview — 1 set of 4 questions (~4 min)
 *   Total: ~8 minutes
 *
 * Unlike Reading/Listening, Speaking is NOT adaptive (no M1/M2 routing).
 * It is a straight-through 2-task exam.
 */

import repeatBank from "../../data/speaking/bank/repeat.json";
import interviewBank from "../../data/speaking/bank/interview.json";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a speaking exam.
 *
 * @param {Set<string>} [excludeIds] - IDs of previously done sets to avoid
 * @returns {{ repeatSet: object, interviewSet: object, totalTime: number }}
 */
export function buildSpeakingExam(excludeIds = new Set()) {
  const repeatSets = repeatBank.items || [];
  const interviewSets = interviewBank.items || [];

  // Pick 1 repeat set, preferring sets not previously done
  const repeatSet = pickSet(repeatSets, excludeIds);

  // Pick 1 interview set, preferring sets not previously done
  const interviewSet = pickSet(interviewSets, excludeIds);

  return {
    repeatSet,
    interviewSet,
    totalTime: 480, // 8 minutes in seconds
  };
}

/**
 * Pick one set from a pool, preferring sets whose ID is not in excludeIds.
 * Falls back to any available set if all are excluded.
 */
function pickSet(pool, excludeIds) {
  if (!pool || pool.length === 0) return null;

  // Try to find sets not in the exclusion list
  const preferred = pool.filter((s) => !excludeIds.has(s.id));
  const candidates = preferred.length > 0 ? preferred : pool;

  const shuffled = shuffle(candidates);
  return shuffled[0];
}
