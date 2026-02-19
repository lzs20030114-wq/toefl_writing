import BS_DATA from "../data/buildSentence/questions.json";
import { hardFailReasons, validateQuestionSet } from "./questionBank/qualityGateBuildSentence";
import { loadDoneIds, addDoneIds } from "./sessionStore";

const BS_DONE_KEY = "toefl-bs-done-sets";

/**
 * Select a set of 10 Build a Sentence questions (v2 - ETS set-based).
 *
 * - Loads question_sets from questions.json
 * - Tracks done set_ids in localStorage
 * - Picks the first undone set, or falls back to the first set when exhausted
 * - Returns the 10 questions from that set
 */
export function selectBSQuestions(options = {}) {
  const sets = BS_DATA.question_sets || [];
  if (sets.length === 0) {
    throw new Error("Build sentence question bank is empty.");
  }

  const validSets = sets.filter(
    (s) =>
      Array.isArray(s.questions) &&
      s.questions.length > 0 &&
      hasUniqueQuestionSessionContent(s.questions) &&
      s.questions.every((q) => hardFailReasons(q).length === 0) &&
      validateQuestionSet(s).ok
  );

  if (validSets.length === 0) {
    throw new Error("Build sentence bank quality gate rejected all question sets.");
  }

  const doneSetsRaw = loadDoneIds(BS_DONE_KEY);
  const doneSets = new Set([...doneSetsRaw].map(Number));

  let chosen = validSets.find((s) => !doneSets.has(s.set_id));
  if (!chosen) {
    chosen = validSets[0];
  }

  addDoneIds(BS_DONE_KEY, [chosen.set_id]);

  if (!Array.isArray(chosen.questions) || chosen.questions.length !== 10) {
    throw new Error(`Build sentence set ${chosen.set_id} must contain exactly 10 questions.`);
  }

  return chosen.questions;
}

function hasUniqueQuestionSessionContent(questions) {
  const ids = new Set();
  const contentKeys = new Set();

  for (const q of questions) {
    const id = String(q?.id || "").trim();
    const answer = String(q?.answer || "").trim().toLowerCase();
    const punct = q?.has_question_mark === true ? "?" : ".";
    const key = `${answer}|${punct}`;

    if (!id || ids.has(id) || !answer || contentKeys.has(key)) {
      return false;
    }
    ids.add(id);
    contentKeys.add(key);
  }

  return true;
}

/* Pick random prompt for Email/Discussion, preferring undone. */
export function pickRandomPrompt(data, usedSessionSet, storageKey) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Prompt bank is empty.");
  }

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

  if (candidates.length === 0) {
    throw new Error("Prompt bank is empty.");
  }

  const usedIdxList = Array.from(usedSessionSet || []);
  if (usedIdxList.length === 0 || candidates.length === 1) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const usedTokenSets = usedIdxList
    .map((idx) => buildPromptTokenSet(data[idx]))
    .filter((s) => s.size > 0);
  if (usedTokenSets.length === 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const scored = candidates.map((idx) => {
    const tokenSet = buildPromptTokenSet(data[idx]);
    if (tokenSet.size === 0) {
      return { idx, novelty: 0 };
    }
    let minDistance = 1;
    for (const usedSet of usedTokenSets) {
      const d = jaccardDistance(tokenSet, usedSet);
      if (d < minDistance) minDistance = d;
    }
    return { idx, novelty: minDistance };
  });

  scored.sort((a, b) => b.novelty - a.novelty);
  const top = scored.filter((x) => x.novelty >= scored[0].novelty - 0.08).map((x) => x.idx);
  return top[Math.floor(Math.random() * top.length)];
}

function buildPromptTokenSet(item) {
  const text = [
    item?.scenario || "",
    item?.direction || "",
    item?.professor?.text || "",
    ...(Array.isArray(item?.students) ? item.students.map((s) => s?.text || "") : []),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");

  const stop = new Set([
    "the", "a", "an", "to", "of", "and", "or", "in", "on", "for", "with", "your", "you", "are", "is",
    "this", "that", "it", "as", "be", "at", "by", "from", "will", "should", "can", "could", "would",
  ]);

  return new Set(
    text
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !stop.has(w))
  );
}

function jaccardDistance(a, b) {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let inter = 0;
  for (const v of a) {
    if (b.has(v)) inter += 1;
  }
  return 1 - inter / union.size;
}
