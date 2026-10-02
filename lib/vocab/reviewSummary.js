/**
 * 一轮复习结束后的复盘数据（阅读、听力共用，渲染在 components/vocab/ReviewSummary.js）。
 * 纯函数：不碰 React / localStorage，所有输入由调用方传进来，便于直接测。
 */

import { definitionForContext } from "./book";
import { humanizeDef } from "../dict/core";

const UP = "#0d9668";
const LEARNING = "#0891B2";
const FLAT = "#94a39a";

export const fmtDuration = (ms) => {
  const total = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(total / 60)} 分 ${String(total % 60).padStart(2, "0")} 秒`;
};

/** 单词本整体统计里复盘页要对比的那三项。 */
export const pickStats = (stats) => (stats
  ? { knowledge: stats.knowledge || 0, mature: stats.mature || 0, learning: stats.learning || 0 }
  : null);

/** 给一个词配一行释义（优先「在这句里的那条」，句子可以是阅读原句或听力原句）。 */
export const senseOf = (card, sentence = "") =>
  humanizeDef(definitionForContext(card, sentence || "") || card?.def || card?.defFull || "");

const change = (label, from, to, tone) => {
  const delta = to - from;
  return { label, from, to, delta: delta === 0 ? "±0" : delta > 0 ? `+${delta}` : `${delta}`, color: delta === 0 ? FLAT : tone };
};

/**
 * @param {object} input
 *   first     词 -> 第一次被问时是否想起来/听懂
 *   tally     { good, again } 全部提问次数
 *   lost      本轮答过「忘了/没听懂」的词（按首次出错顺序）
 *   infoFor   词 -> 卡片（取词形和释义；取不到的词不进列表）
 *   senseFor  卡片 -> 一行释义
 *   startedAt / endedAt  毫秒时间戳
 *   startStats / statsNow 开场与现在的整体统计（缺一就不显示前后变化）
 */
export function buildReviewSummary({ first, tally, lost, infoFor, senseFor, startedAt, endedAt, startStats, statsNow }) {
  const words = Object.keys(first || {}).length;
  const firstGood = Object.values(first || {}).filter(Boolean).length;
  const lostList = (lost || []).map((word) => {
    const info = infoFor(word);
    return info ? { word, display: info.display || info.word, sense: senseFor(info) } : null;
  }).filter(Boolean);
  const changes = startStats && statsNow ? [
    change("预计记得", startStats.knowledge, statsNow.knowledge || 0, UP),
    change("已记牢", startStats.mature, statsNow.mature || 0, UP),
    change("学习中", startStats.learning, statsNow.learning || 0, LEARNING),
  ] : null;
  return {
    duration: fmtDuration((endedAt || Date.now()) - startedAt),
    words,
    asks: tally.good + tally.again,
    good: tally.good,
    again: tally.again,
    firstGood,
    firstRate: words ? Math.round((firstGood / words) * 100) : 0,
    lost: lostList,
    changes,
  };
}
