#!/usr/bin/env node
// Reading deviation (AP + CTW): current generated bank vs realExam2026, same detectors.
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const J = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const items = (d) => d.items || d.passages || (Array.isArray(d) ? d : []);
const mean = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : 0;
const stats = (a) => { const s = [...a].sort((x, y) => x - y); return `${mean(a)} [${s[0]}–${s[s.length - 1]}]`; };

// ---- AP ----
const apCur = items(J("data/reading/bank/ap.json"));
const apTgt = J("data/realExam2026/reading/academicPassage.json").items;
console.log("Reading · AP — 当前库 vs realExam2026\n");
console.log("维度".padEnd(20) + "当前库".padStart(14) + "真题".padStart(14));
console.log("-".repeat(48));
console.log("样本数".padEnd(20) + String(apCur.length).padStart(14) + String(apTgt.length).padStart(14));
console.log("passage词数".padEnd(20) + stats(apCur.map((x) => x.word_count || wc(x.passage))).padStart(14) + stats(apTgt.map((x) => wc(x.passage))).padStart(14));
console.log("题/篇".padEnd(20) + String(mean(apCur.map((x) => x.question_count || (x.questions || []).length))).padStart(14) + String(mean(apTgt.map((x) => (x.questions || []).length))).padStart(14));
console.log("选项/题".padEnd(20) + String(mean(apCur.flatMap((x) => (x.questions || []).map((q) => (q.options || q.choices || []).length)))).padStart(14) + String(mean(apTgt.flatMap((x) => (x.questions || []).map((q) => (q.options || []).length)))).padStart(14));

// ---- CTW ----
const ctwCur = items(J("data/reading/bank/ctw.json"));
const ctwTgt = J("data/realExam2026/reading/completeTheWords.json").items;
console.log("\nReading · CTW — 当前库 vs realExam2026\n");
console.log("维度".padEnd(20) + "当前库".padStart(14) + "真题".padStart(14));
console.log("-".repeat(48));
console.log("样本数".padEnd(20) + String(ctwCur.length).padStart(14) + String(ctwTgt.length).padStart(14));
console.log("段落词数".padEnd(20) + stats(ctwCur.map((x) => x.word_count || wc(x.passage))).padStart(14) + stats(ctwTgt.map((x) => wc(x.paragraph))).padStart(14));
console.log("(空数: 真题不可测 — 答案在答案卷, CTW json无)".padEnd(20));
console.log("当前库 blank_count: " + mean(ctwCur.map((x) => x.blank_count || (x.blanks || []).length)));
