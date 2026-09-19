// 老练习记录补句级时间戳：记录是存快照的，sentence_timings 上线（2026-09-18）之前做的记录里没有这个键，
// 但存了 audio_url —— 时间戳描述的正是「某一条具体音频」（docs/listening-sentence-timings.md），
// 所以按 audio_url 到题库里现查就是同一份。题库 JSON 走动态 import，只有打开这种老记录时才拉，
// 不进练习记录页的首屏包。lcr 不在此列（单句题，复盘不渲染逐句原文）。

import { normalizeSentenceTimings } from "./sentenceTimings";

const LOADERS = [
  () => import("../../data/listening/bank/la.json"),
  () => import("../../data/listening/bank/lat.json"),
  () => import("../../data/listening/bank/lc.json"),
  () => import("../../data/realBank/listening/la.json"),
  () => import("../../data/realBank/listening/lat.json"),
  () => import("../../data/realBank/listening/lc.json"),
];

let indexPromise = null;

/** url → sentence_timings 的索引（只收体检通过的）。纯函数，测试直接喂题库。 */
export function buildTimingsIndex(banks) {
  const index = new Map();
  for (const bank of banks || []) {
    const items = (bank && (bank.items || (bank.default && bank.default.items))) || [];
    for (const it of items) {
      if (!it || typeof it.audio_url !== "string" || !it.audio_url) continue;
      if (!normalizeSentenceTimings(it.sentence_timings)) continue;
      index.set(it.audio_url, it.sentence_timings);
    }
  }
  return index;
}

/** 按 audio_url 查时间戳；查不到 / 题库加载失败一律 null（调用方退回整段原文）。 */
export async function findSentenceTimingsByAudioUrl(audioUrl) {
  if (typeof audioUrl !== "string" || !audioUrl) return null;
  if (!indexPromise) {
    indexPromise = Promise.all(LOADERS.map((load) => load().catch(() => null))).then(buildTimingsIndex);
  }
  try {
    const index = await indexPromise;
    return index.get(audioUrl) || null;
  } catch {
    return null;
  }
}
