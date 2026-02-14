import BS_EASY_DATA from "../data/buildSentence/easy.json";
import BS_MEDIUM_DATA from "../data/buildSentence/medium.json";
import BS_HARD_DATA from "../data/buildSentence/hard.json";
import { renderResponseSentence } from "./questionBank/renderResponseSentence";
import { hardFailReasons } from "./questionBank/qualityGateBuildSentence";
import { shuffle } from "./utils";
import { loadDoneIds } from "./sessionStore";

const BS_DATA = [...BS_EASY_DATA, ...BS_MEDIUM_DATA, ...BS_HARD_DATA];

/* --- Build a Sentence question selection (default: 3 easy + 3 medium + 4 hard) --- */
export function selectBSQuestions(options = {}) {
  const toCount = (v, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.floor(n);
  };
  const distribution = {
    easy: toCount(options?.easy, 3),
    medium: toCount(options?.medium, 3),
    hard: toCount(options?.hard, 4),
  };
  const totalNeeded = distribution.easy + distribution.medium + distribution.hard;
  const doneIds = loadDoneIds("toefl-bs-done");
  const byDiff = { easy: [], medium: [], hard: [] };
  BS_DATA.forEach(q => {
    if (!byDiff[q.difficulty]) return;
    if (hardFailReasons(q).length > 0) return;
    byDiff[q.difficulty].push(q);
  });
  const validAll = [...byDiff.easy, ...byDiff.medium, ...byDiff.hard];

  const usedSourceIds = new Set();
  const usedRendered = new Set();

  const renderKey = (q) => {
    const sentence = renderResponseSentence(q).correctSentenceFull;
    if (sentence) return sentence.trim().toLowerCase();
    return JSON.stringify([q.given || "", ...(q.answerOrder || []), q.responseSuffix || ""]);
  };

  const inSessionAvailable = (q) => !usedSourceIds.has(q.id) && !usedRendered.has(renderKey(q));

  function pickN(pool, n, targetDifficulty) {
    const bucket = Array.isArray(pool) ? pool : [];
    const basePool = bucket.length > 0 ? bucket : validAll;
    if (basePool.length === 0) return [];
    const preferred = shuffle(basePool.filter(q => !doneIds.has(q.id)));
    const fallback = shuffle(basePool.filter(q => doneIds.has(q.id)));
    const ordered = [...preferred, ...fallback];

    const picked = [];
    for (let i = 0; i < ordered.length && picked.length < n; i += 1) {
      const q = ordered[i];
      if (!inSessionAvailable(q)) continue;

      usedSourceIds.add(q.id);
      usedRendered.add(renderKey(q));

      if (bucket.length > 0) {
        picked.push(q);
      } else {
        picked.push({
          ...q,
          id: `${q.id}__${targetDifficulty}_${picked.length}`,
          difficulty: targetDifficulty,
        });
      }
    }
    return picked;
  }

  const selected = [
    ...pickN(byDiff.easy, distribution.easy, "easy"),
    ...pickN(byDiff.medium, distribution.medium, "medium"),
    ...pickN(byDiff.hard, distribution.hard, "hard"),
  ];
  if (selected.length < totalNeeded) {
    throw new Error("Build sentence bank quality gate rejected too many questions.");
  }
  return shuffle(selected);
}

/* --- Pick random prompt for Email/Discussion, preferring undone --- */
export function pickRandomPrompt(data, usedSessionSet, storageKey) {
  const doneIds = loadDoneIds(storageKey);
  // Priority 1: not done + not used this session
  let candidates = [];
  for (let i = 0; i < data.length; i++) {
    if (!usedSessionSet.has(i) && !doneIds.has(data[i].id)) candidates.push(i);
  }
  // Priority 2: not used this session
  if (candidates.length === 0) {
    for (let i = 0; i < data.length; i++) {
      if (!usedSessionSet.has(i)) candidates.push(i);
    }
  }
  // Priority 3: reset session
  if (candidates.length === 0) {
    usedSessionSet.clear();
    candidates = Array.from({ length: data.length }, (_, i) => i);
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}
