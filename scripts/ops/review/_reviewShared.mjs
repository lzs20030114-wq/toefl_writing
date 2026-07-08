/**
 * _reviewShared.mjs — 盲审质检工具链共享模块
 *
 * 被 extract-blind-batches.mjs / run-deterministic-checks.mjs / collect-verdicts.mjs 共用：
 *   - 各库路径与盲卷批次大小配置
 *   - 盲卷 item 构建（剥答案字段，不改选项顺序）
 *   - 标答提取（keys sidecar 与 collect 判分共用同一口径）
 *   - BS assembled 归一化
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { repoRoot } from "../_shared.mjs";

// ── 库配置 ───────────────────────────────────────────────────────────────────
// MCQ 盲卷题型（CTW 无标答选择题形态，不出盲卷；只走确定性检查）。
export const MCQ_BANKS = [
  { type: "ap", file: "data/reading/bank/ap.json" },
  { type: "rdl-short", file: "data/reading/bank/rdl-short.json" },
  { type: "rdl-long", file: "data/reading/bank/rdl-long.json" },
  { type: "lcr", file: "data/listening/bank/lcr.json" },
  { type: "lc", file: "data/listening/bank/lc.json" },
  { type: "la", file: "data/listening/bank/la.json" },
  { type: "lat", file: "data/listening/bank/lat.json" },
];

export const CTW_FILE = "data/reading/bank/ctw.json";
export const BS_FILE = "data/buildSentence/questions.json";
export const REPEAT_FILE = "data/speaking/bank/repeat.json";
export const INTERVIEW_FILE = "data/speaking/bank/interview.json";

// 盲卷批次大小（按题型阅读/作答成本定）。
export const BATCH_SIZES = {
  lat: 12, ap: 12, "rdl-long": 15, lc: 20, la: 20,
  "rdl-short": 25, bs: 25, lcr: 40,
};

// ── I/O ─────────────────────────────────────────────────────────────────────
export function readJsonAbs(fileRelOrAbs) {
  const full = fileRelOrAbs.startsWith("/") ? fileRelOrAbs : resolve(repoRoot, fileRelOrAbs);
  return JSON.parse(readFileSync(full, "utf8"));
}

export function loadBankItems(file) {
  const data = readJsonAbs(file);
  return Array.isArray(data.items) ? data.items : [];
}

/** BS 主库拍平：question_sets[].questions[] → 一维题目数组。 */
export function loadBSQuestions() {
  const data = readJsonAbs(BS_FILE);
  const sets = Array.isArray(data.question_sets) ? data.question_sets : [];
  const out = [];
  for (const s of sets) for (const q of (s && s.questions) || []) out.push(q);
  return out;
}

// ── 盲卷构建 ─────────────────────────────────────────────────────────────────
// 剥除的泄答字段（item 级与 question 级都剥；哪级没有该字段就自然跳过）。
const STRIP_FIELDS = [
  "correct_answer", "answer", "explanation", "answer_paradigm",
  "distractor_types", "_audit", "audio_url", "flavor_score",
];

function stripFields(obj) {
  const copy = { ...obj };
  for (const f of STRIP_FIELDS) delete copy[f];
  return copy;
}

/**
 * MCQ 盲卷 item：去掉泄答字段，保留正文与全部选项（不改动选项字母顺序）。
 * 多题 item（ap/lc/la/lat/rdl）保留 questions 数组结构（每题同样剥泄答字段）。
 */
export function buildBlindMCQItem(item) {
  const blind = stripFields(item);
  if (Array.isArray(item.questions)) {
    blind.questions = item.questions.map((q) => stripFields(q));
  }
  return blind;
}

/** BS 盲卷 item：固定字段集；chunks 含干扰词但不标注哪个是。 */
export function buildBlindBSItem(q) {
  const blind = {
    id: q.id,
    prompt: q.prompt,
    prompt_task_kind: q.prompt_task_kind,
    prefilled: q.prefilled,
    prefilled_positions: q.prefilled_positions,
    chunks: q.chunks,
  };
  if (blind.prompt_task_kind === undefined) delete blind.prompt_task_kind;
  return blind;
}

// ── 标答提取（keys sidecar 与 collect 判分共用） ──────────────────────────────
/**
 * extractAnswerKey(type, item) → { q0:"B", q1:"A", ... }
 * lcr 是单题 item（顶层 answer）；其余 MCQ 从 questions[i] 取 correct_answer/answer。
 */
export function extractAnswerKey(type, item) {
  if (type === "lcr") {
    return { q0: item.answer != null ? String(item.answer) : null };
  }
  const keys = {};
  (item.questions || []).forEach((q, i) => {
    const a = q.correct_answer != null ? q.correct_answer : q.answer;
    keys[`q${i}`] = a != null ? String(a) : null;
  });
  return keys;
}

/** BS keys sidecar 条目：{ answer:"..." } */
export function extractBSKey(q) {
  return { answer: q.answer != null ? String(q.answer) : null };
}

// ── 归一化 ───────────────────────────────────────────────────────────────────
/** MCQ 答案字母归一化（"b " → "B"）。 */
export function normLetter(v) {
  return String(v == null ? "" : v).trim().toUpperCase();
}

/** BS assembled 归一化：小写、多空格折叠、去末尾标点（含被空格隔开的标点段，如 "now. ."）。 */
export function normalizeAssembled(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.!?,;:。！？，；：]+$/, "")
    .trim();
}

/** 批次切分：保持库内原顺序。 */
export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 批次文件名编号：1 → "001"。 */
export function pad3(n) {
  return String(n).padStart(3, "0");
}
