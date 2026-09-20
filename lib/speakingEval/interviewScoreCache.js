"use client";

/**
 * 面试评分的本地补分缓存。
 *
 * 为什么需要它：面试每答一题就发一次 DeepSeek 评分，交卷时最多只等 60 秒
 * （InterviewTask 的 SUBMIT_WAIT_CAP_SEC）。上游排队时有两种落空：
 *   ① 评分失败 → 记录里存进去的是一份 error 报告（summary 写着失败原因）；
 *   ② 评分在交卷之后才回来 → 那条练习记录已经落库，分数进不去。
 * 两种都只差「一次重算」，而转写早就存好了，不该让用户重录一遍。
 *
 * 落在 localStorage 而不是回写 sessions 表：与全站 AI 讲解缓存同一套做法
 * （各科的 useXxxAiExplain 钩子）。sessions 的补丁通道 updateSessionDetails
 * 只认写作的 practiceRootId/practiceAttempt，为口语另开一套匹配键风险更大；
 * 而这里的键是「题目 + 转写」，天然幂等，换设备顶多是没命中、不会错配。
 *
 * 只缓存成功的报告：error 报告不进缓存，否则一次失败会被永久钉在那一题上。
 */

const CACHE_KEY = "interview-score-cache-v1";
const MAX_ENTRIES = 120;
// 键里的转写取前 400 字符即可：同一题的两次作答几乎不可能前 400 字全同，
// 而整段存进键会把 localStorage 撑大。
const KEY_QUESTION_CHARS = 120;
const KEY_TRANSCRIPT_CHARS = 400;

export function interviewScoreKey({ question, transcript } = {}) {
  const q = String(question || "").trim().slice(0, KEY_QUESTION_CHARS);
  const t = String(transcript || "").trim().slice(0, KEY_TRANSCRIPT_CHARS);
  return `${q}|||${t}`;
}

function loadAll() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** 读一条补分。无缓存 / 存储不可用 / 缓存的是失败报告，一律返回 null。 */
export function readCachedInterviewScore(input) {
  if (!input?.question || !input?.transcript) return null;
  try {
    const hit = loadAll()[interviewScoreKey(input)];
    return hit && typeof hit === "object" && !hit.error ? hit : null;
  } catch {
    return null;
  }
}

/** 写一条补分。失败报告不写；存储不可用时静默放弃（缓存只是加分项）。 */
export function writeCachedInterviewScore(input, score) {
  if (!input?.question || !input?.transcript) return;
  if (!score || typeof score !== "object" || score.error) return;
  try {
    const all = loadAll();
    all[interviewScoreKey(input)] = score;
    const keys = Object.keys(all);
    if (keys.length > MAX_ENTRIES) {
      keys.slice(0, keys.length - MAX_ENTRIES).forEach((k) => { delete all[k]; });
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* 配额满 / 隐私模式：缓存失效不影响评分本身 */
  }
}
