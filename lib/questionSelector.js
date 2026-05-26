import BS_DATA from "../data/buildSentence/questions.json";
import { hardFailReasons, validateQuestionSet } from "./questionBank/qualityGateBuildSentence";
import { loadDoneIds } from "./sessionStore";
import { getForbiddenTopics, pushRecentTopic } from "./recentTopics";

// Email prompts store the same topic as both Simplified and Traditional
// variants (e.g. "职场工作" and "職場工作"). Map traditional → simplified so
// the anti-consecutive picker doesn't treat them as different topics.
const EMAIL_TOPIC_NORMALIZE = {
  "職場工作": "职场工作",
  "社區生活": "社区生活",
  "消費售後": "消费售后",
};
export function normalizeEmailTopic(raw) {
  const s = String(raw || "");
  return EMAIL_TOPIC_NORMALIZE[s] || s;
}

const BS_DONE_KEY = "toefl-bs-done-sets";
export const DONE_STORAGE_KEYS = {
  BUILD_SENTENCE: BS_DONE_KEY,
  BUILD_SENTENCE_GP: "toefl-bs-done-gp",
  EMAIL: "toefl-em-done",
  DISCUSSION: "toefl-disc-done",
  READING_CTW: "toefl-reading-ctw-done",
  READING_RDL: "toefl-reading-rdl-done",
  LISTENING_LCR: "toefl-listening-lcr-done",
  SPEAKING_REPEAT: "toefl-speaking-repeat-done",
  SPEAKING_INTERVIEW: "toefl-speaking-interview-done",
};
export const BANK_EXHAUSTED_ERRORS = {
  BUILD_SENTENCE: "BUILD_SENTENCE_BANK_EXHAUSTED",
  PROMPT: "PROMPT_BANK_EXHAUSTED",
};

/**
 * Select a set of 10 Build a Sentence questions (v2 - ETS set-based).
 *
 * - Loads question_sets from questions.json
 * - Tracks done set_ids in localStorage
 * - Picks the first undone set, throws exhausted error when none remain
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
    throw new Error(BANK_EXHAUSTED_ERRORS.BUILD_SENTENCE);
  }

  if (!Array.isArray(chosen.questions) || chosen.questions.length !== 10) {
    throw new Error(`Build sentence set ${chosen.set_id} must contain exactly 10 questions.`);
  }

  return chosen.questions.map((q) => ({ ...q, __sourceSetId: chosen.set_id }));
}

function hasUniqueQuestionSessionContent(questions) {
  const ids = new Set();

  for (const q of questions) {
    const id = String(q?.id || "").trim();
    const answer = String(q?.answer || "").trim().toLowerCase();

    if (!id || ids.has(id) || !answer) {
      return false;
    }
    ids.add(id);
  }

  return true;
}

/* Pick random prompt for Email/Discussion, preferring undone.
 * opts.topicKeyFn(item) + opts.scope enable cross-reload "no consecutive same
 * topic" — the picker filters out candidates whose topic matches the last one
 * served in this scope, falling back to the unfiltered set if that empties.
 */
export function pickRandomPrompt(data, usedSessionSet, storageKey, opts = {}) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Prompt bank is empty.");
  }

  const { topicKeyFn, scope } = opts;
  const useTopicFilter = typeof topicKeyFn === "function" && typeof scope === "string" && scope;
  // Forbidden set encodes both invariants: ≠ last topic AND keep the
  // 5-question sliding window at ≥ 3 distinct topics. See recentTopics.js.
  const forbidden = useTopicFilter ? getForbiddenTopics(scope) : new Set();

  const passesTopicFilter = (i) => {
    if (!useTopicFilter || forbidden.size === 0) return true;
    return !forbidden.has(topicKeyFn(data[i]));
  };

  // Tier 1: not done, not in this session, and topic-diversity respected
  let candidates = [];
  for (let i = 0; i < data.length; i++) {
    if (!usedSessionSet.has(i) && !doneIdsHas(storageKey, data[i].id) && passesTopicFilter(i)) {
      candidates.push(i);
    }
  }
  // Tier 2: drop session-used, keep done-filter + topic-diversity
  if (candidates.length === 0) {
    for (let i = 0; i < data.length; i++) {
      if (!doneIdsHas(storageKey, data[i].id) && passesTopicFilter(i)) candidates.push(i);
    }
  }
  // Tier 3: drop topic-diversity so we don't strand the user on a tiny bank
  if (candidates.length === 0) {
    for (let i = 0; i < data.length; i++) {
      if (!doneIdsHas(storageKey, data[i].id)) candidates.push(i);
    }
  }
  if (candidates.length === 0) {
    throw new Error(BANK_EXHAUSTED_ERRORS.PROMPT);
  }

  const chosen = scoreAndPick(data, candidates, usedSessionSet);
  if (useTopicFilter) pushRecentTopic(scope, topicKeyFn(data[chosen]) || "");
  return chosen;
}

// Cache the doneIds set per call site so we don't re-load localStorage in the
// loop above (callers hit the same storageKey many times during one pick).
let _doneCacheKey = null;
let _doneCacheSet = null;
function doneIdsHas(storageKey, id) {
  if (_doneCacheKey !== storageKey) {
    _doneCacheKey = storageKey;
    _doneCacheSet = loadDoneIds(storageKey);
  }
  return _doneCacheSet.has(id);
}

function scoreAndPick(data, candidates, usedSessionSet) {
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
