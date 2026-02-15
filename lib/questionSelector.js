import BS_DATA from "../data/buildSentence/questions.json";
import { hardFailReasons, validateQuestionSet } from "./questionBank/qualityGateBuildSentence";
import { loadDoneIds, addDoneIds } from "./sessionStore";

const BS_DONE_KEY = "toefl-bs-done-sets";

/**
 * Select a set of 10 Build a Sentence questions (v2 — ETS set-based).
 *
 * - Loads question_sets from questions.json
 * - Tracks done set_ids in localStorage
 * - Picks the first undone set, or falls back to the oldest done set
 * - Returns the 10 questions from that set
 */
export function selectBSQuestions(options = {}) {
  const sets = BS_DATA.question_sets || [];
  if (sets.length === 0) {
    throw new Error("Build sentence question bank is empty.");
  }

  // Filter sets: all questions must pass quality gate
  const validSets = sets.filter(s =>
    Array.isArray(s.questions) && s.questions.length > 0 &&
    s.questions.every(q => hardFailReasons(q).length === 0) &&
    validateQuestionSet(s).ok
  );

  if (validSets.length === 0) {
    throw new Error("Build sentence bank quality gate rejected all question sets.");
  }

  // Load done set IDs
  const doneSetsRaw = loadDoneIds(BS_DONE_KEY);
  const doneSets = new Set([...doneSetsRaw].map(Number));

  // Prefer undone sets
  let chosen = validSets.find(s => !doneSets.has(s.set_id));

  if (!chosen) {
    // All done — pick first set (round-robin reset)
    chosen = validSets[0];
  }

  // Mark this set as done
  addDoneIds(BS_DONE_KEY, [chosen.set_id]);

  if (!Array.isArray(chosen.questions) || chosen.questions.length !== 10) {
    throw new Error(`Build sentence set ${chosen.set_id} must contain exactly 10 questions.`);
  }

  return chosen.questions;
}

/* --- Pick random prompt for Email/Discussion, preferring undone --- */
export function pickRandomPrompt(data, usedSessionSet, storageKey) {
  const doneIds = loadDoneIds(storageKey);
  let candidates = [];
  for (let i = 0; i < data.length; i++) {
    if (!usedSessionSet.has(i) && !doneIds.has(data[i].id)) candidates.push(i);
  }
  if (candidates.length === 0) {
    for (let i = 0; i < data.length; i++) {
      if (!usedSessionSet.has(i)) candidates.push(i);
    }
  }
  if (candidates.length === 0) {
    usedSessionSet.clear();
    candidates = Array.from({ length: data.length }, (_, i) => i);
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}
