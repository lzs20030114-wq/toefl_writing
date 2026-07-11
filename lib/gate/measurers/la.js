"use strict";
/**
 * Pure, deterministic per-item detectors for Listening-Announcement (LA).
 * Consumed by the generic gate harness (lib/gate/gateHarness.js).
 *
 * 2026-07-11: added after the LA paradigm rebuild (Batch 2)。三个检测器全部是
 * 正则/词数级(精度 1.0):
 *  - salutation_opener: 打招呼式开场(Attention/Good morning/…)。真题 ~0.20,
 *    旧库 0.75 — 本轮修复的核心维度。
 *  - stock_phrase: 定式短语命中("This is a reminder that"/"light refreshments"/
 *    "pleased|excited to announce")。真题 78 篇合计 1 命中(~0.013)。
 *  - announcement_word_count: 真题均值 ~86 词;旧库偏长。
 *
 * 真题字段 transcript(可能带 setting 引子,与 paradigm_snapshot 同款剥离),
 * 生成库字段 announcement。
 */

function textOf(item) {
  let t = String((item && (item.announcement || item.transcript)) || "").trim();
  const first = (t.split(/(?<=[.!?])\s+/)[0] || "");
  if (/^(listen to|you will hear)\b/i.test(first) || /in (a|an) [a-z ]+ class\.?$/i.test(first)) {
    t = t.slice(t.indexOf(first) + first.length).trim() || t;
  }
  return t;
}
const SALUTATION = /^(attention|good (morning|afternoon|evening)|hello|hi\b|greetings|welcome)/i;
const STOCK = /this is a (friendly )?reminder that|light refreshments|i'?m pleased to announce|we'?re (excited|thrilled) to announce/i;

function measureItem(item) {
  const t = textOf(item);
  return {
    salutation_opener_share: SALUTATION.test(t) ? 1 : 0,
    stock_phrase_share: STOCK.test(t) ? 1 : 0,
    announcement_word_count: t.split(/\s+/).filter(Boolean).length,
  };
}

function measure(items) {
  return (items || []).map(measureItem);
}

module.exports = { measure, measureItem };
