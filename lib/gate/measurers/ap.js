"use strict";
/**
 * Pure, deterministic per-item detectors for Academic-Passage (AP).
 * Consumed by the generic gate harness (lib/gate/gateHarness.js).
 *
 * 2026-07-11: added after the AP ending-collapse fix (Batch 3)。
 *  - last_sent_however: 末句含 However(真题 1/64 ≈ 0.016,旧库 0.458 —
 *    本轮修复的核心维度,正则精度 1.0,hard)。
 *  - passage_word_count: 真题均值 ~181(drift 带,旧 However 题词数在带内,
 *    不能当 hard 的降级判据)。
 *  - opener_copula_share: 首句 "X is a/the…" 系动词开场(启发式 → monitor)。
 *  - option_spread_mean: 每题选项词数极差的均值(真题 2.63,生成 ~1.7 —
 *    已知的"太均匀"合成痕迹,先 monitor 观察,库回填达标后再考虑升 hard)。
 */

function textOf(item) {
  return String((item && item.passage) || "").trim();
}
function sentences(s) {
  return s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
}
function wc(s) { return String(s).split(/\s+/).filter(Boolean).length; }

function measureItem(item) {
  const t = textOf(item);
  const sents = sentences(t);
  const last = sents[sents.length - 1] || "";
  const first = sents[0] || "";
  const spreads = [];
  for (const q of item.questions || []) {
    const opts = q.options ? Object.values(q.options) : [];
    if (opts.length >= 3) {
      const ws = opts.map(wc);
      spreads.push(Math.max(...ws) - Math.min(...ws));
    }
  }
  return {
    last_sent_however_share: /\bhowever\b/i.test(last) ? 1 : 0,
    passage_word_count: wc(t),
    opener_copula_share: /^[A-Z][A-Za-z' -]*\s+(is|are)\s+(a|an|the|one)\b/.test(first) ? 1 : 0,
    option_spread_mean: spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : NaN,
  };
}

function measure(items) {
  return (items || []).map(measureItem);
}

module.exports = { measure, measureItem };
