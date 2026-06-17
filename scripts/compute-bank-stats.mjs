#!/usr/bin/env node
// Summarize all 7 question banks into a single .bank-stats.json file.
// Output is consumed by the Claude routine so it can:
//   1. Know what's already in each bank (avoid recycling topics/scenarios)
//   2. See recent N samples per bank (style anchoring)
//   3. Compare current distribution against calibration targets

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUT = resolve(ROOT, "data/.bank-stats.json");

function readJSON(rel) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
}

function tally(items, keyFn) {
  const c = {};
  for (const it of items) {
    const k = keyFn(it);
    if (k == null || k === "") continue;
    c[k] = (c[k] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1]));
}

// ── BS classifier (same patterns as analyze-tpo-bs.mjs) ──
function classifyBSOpener(p) {
  const s = String(p || "").toLowerCase().trim();
  if (/^what did/.test(s)) return "what did X";
  if (/^(did|do|does|are|was|were|is|have|has|can|could|will|would|should) (you|the|i|he|she|they|we|it|my|your)/.test(s)) return "yes-no Q";
  if (/^(where|why|when|how|who|which)/.test(s)) return "wh-Q";
  if (/^i (noticed|heard|saw|wonder|see|hear)/.test(s)) return "I-statement";
  if (/^[A-Z]/.test(String(p || ""))) return "statement";
  return "other";
}

function classifyBSSentenceType(q) {
  const combined = (
    String(q.answer || "") + " " + (q.chunks || []).join(" ")
  ).toLowerCase();
  const hasCogVerb = /(know|knew|ask|asked|wonder|wondered|curious|wondering|told|find|found|figure|figured|needed)/.test(combined);
  const hasComp = /(whether| if | what |where|when|why|how| who |whom|which)/.test(combined);
  const hasWantedToKnow = / wanted to know /.test(combined) || / want to know /.test(combined);
  const hasFoundOut = / found out /.test(combined) || / figured out /.test(combined);
  const hasAskedComp = / asked (if|whether|what|where|why|when|how|who) /.test(combined);
  const isIndirect = hasWantedToKnow || hasFoundOut || hasAskedComp || (hasCogVerb && hasComp);
  const isNegation = /(did not|do not|does not|have not|has not|had not|could not|will not|would not|no longer|no one|nothing|nobody|never)/.test(combined) || /\bnot\b/.test(combined);
  const isRelative = /(that|which|whom) (he|she|i|we|they|professor)/.test(combined);
  const isComparative = / more \w+ than /.test(combined) || / better than /.test(combined) || /\w+er than /.test(combined);
  const isPassive = / (was|were|is|are|been|being) \w+(ed|en) /.test(combined);
  if (isIndirect) return "indirect-Q";
  if (isRelative) return "relative-clause";
  if (isComparative) return "comparative";
  if (isPassive) return "passive";
  if (isNegation) return "negation";
  return "other";
}

// ── BS ──
function bsStats() {
  const j = readJSON("data/buildSentence/questions.json");
  const sets = j.question_sets || [];
  const allQs = sets.flatMap((s) => s.questions || []);
  const recentSets = sets.slice(-6); // last 6 sets
  const recentQs = recentSets.flatMap((s) => s.questions || []);
  return {
    total_sets: sets.length,
    total_questions: allQs.length,
    recent_60_samples: recentQs.slice(-60).map((q) => ({
      prompt: q.prompt,
      answer: q.answer,
      grammar: (q.grammar_points || []).slice(0, 3),
    })),
    opener_freq_recent60: tally(recentQs.slice(-60), (q) => classifyBSOpener(q.prompt)),
    sentence_type_freq_recent60: tally(recentQs.slice(-60), (q) => classifyBSSentenceType(q)),
  };
}

// ── Discussion ──
function discussionStats() {
  const items = readJSON("data/academicWriting/prompts.json");
  return {
    total: items.length,
    course_dist: tally(items, (q) => q.course),
    recent_40_samples: items.slice(-40).map((q) => ({
      course: q.course,
      prof_text_preview: String(q?.professor?.text || "").slice(0, 100),
      student_names: (q.students || []).map((s) => s.name),
    })),
  };
}

// ── Email ──
const EMAIL_TOPIC_NORM = {
  "職場工作": "职场工作",
  "社區生活": "社区生活",
  "消費售後": "消费售后",
};
function normalizeEmailTopic(t) {
  return EMAIL_TOPIC_NORM[t] || t;
}
function emailStats() {
  const items = readJSON("data/emailWriting/prompts.json");
  return {
    total: items.length,
    topic_dist: tally(items, (q) => normalizeEmailTopic(q.topic)),
    recent_30_samples: items.slice(-30).map((q) => ({
      topic: normalizeEmailTopic(q.topic),
      to: q.to,
      subject: q.subject,
      scenario_preview: String(q.scenario || "").slice(0, 80),
    })),
  };
}

// ── Reading helper ──
function readingStats(file, label) {
  try {
    const j = readJSON(file);
    const items = j.items || [];
    return {
      total: items.length,
      topic_dist: tally(items, (it) => it.topic || it.genre),
      subtopic_dist: tally(items, (it) => `${it.topic || it.genre}/${it.subtopic || ""}`),
      recent_subjects: items.slice(-30).map((it) => `${it.topic || it.genre}/${it.subtopic || ""}`.replace(/\/$/, "")),
    };
  } catch (e) {
    return { total: 0, error: e.message };
  }
}

// ── Listening / Speaking helper ──
// Leaner than readingStats — we mainly need an accurate `total` so the nightly
// report can compute真实入库增量 (current bank total − this snapshot). Added
// 2026-06-17 so listening/speaking are covered too (compute-quality-report diffs
// against this snapshot instead of trusting R1's gen-time `accepted`).
function bankItemTotal(file, keyFn) {
  try {
    const j = readJSON(file);
    const items = j.items || j.sets || [];
    return {
      total: items.length,
      recent_subjects: items.slice(-30).map(keyFn).filter(Boolean),
    };
  } catch (e) {
    return { total: 0, error: e.message };
  }
}

// ── Main ──
const stats = {
  generated_at: new Date().toISOString(),
  bs: bsStats(),
  discussion: discussionStats(),
  email: emailStats(),
  reading_ap: readingStats("data/reading/bank/ap.json", "AP"),
  reading_ctw: readingStats("data/reading/bank/ctw.json", "CTW"),
  reading_rdl_short: readingStats("data/reading/bank/rdl-short.json", "RDL-short"),
  reading_rdl_long: readingStats("data/reading/bank/rdl-long.json", "RDL-long"),
  listening_lat: bankItemTotal("data/listening/bank/lat.json", (it) => it.subject || it.topic || ""),
  listening_lc: bankItemTotal("data/listening/bank/lc.json", (it) => it.situation || it.context || ""),
  listening_la: bankItemTotal("data/listening/bank/la.json", (it) => it.situation || it.context || ""),
  listening_lcr: bankItemTotal("data/listening/bank/lcr.json", (it) => it.situation || it.context || ""),
  speaking_repeat: bankItemTotal("data/speaking/bank/repeat.json", (it) => it.scenario || ""),
};

writeFileSync(OUTPUT, JSON.stringify(stats, null, 2) + "\n", "utf8");
console.log(`Bank stats written to ${OUTPUT}`);
console.log(`  BS:         ${stats.bs.total_sets} sets / ${stats.bs.total_questions} questions`);
console.log(`  Discussion: ${stats.discussion.total} items`);
console.log(`  Email:      ${stats.email.total} items`);
console.log(`  AP:         ${stats.reading_ap.total} items`);
console.log(`  CTW:        ${stats.reading_ctw.total} items`);
console.log(`  RDL short:  ${stats.reading_rdl_short.total} items`);
console.log(`  RDL long:   ${stats.reading_rdl_long.total} items`);
