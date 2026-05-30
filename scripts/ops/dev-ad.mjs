#!/usr/bin/env node
// AD deviation: current generated bank vs realExam2026, same detectors.
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const J = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const profText = (p) => (p && typeof p === "object") ? (p.text || p.post || "") : String(p || "");
// the discussion question = the last/long '?'-sentence in the professor post
const qOf = (txt) => { const m = String(txt).split(/(?<=[.?!])\s+/).filter((s) => s.trim().endsWith("?")); return m.length ? m[m.length - 1] : ""; };

function measure(items, mode) {
  const courses = items.map((x) => x.course);
  const stuCounts = items.map((x) => (x.students || []).length);
  const stuWords = items.flatMap((x) => (x.students || []).map((s) => wc(s.text)));
  const qWords = items.map((x) => mode === "real" ? wc(x.professor_question) : wc(qOf(profText(x.professor))));
  const mean = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10;
  return {
    n: items.length,
    distinctCourses: new Set(courses.map((c) => String(c || "").toLowerCase().trim()).filter(Boolean)).size,
    courseReuse: Math.round(items.length / Math.max(1, new Set(courses.map((c) => String(c || "").toLowerCase().trim()).filter(Boolean)).size) * 10) / 10,
    avgStudents: mean(stuCounts),
    twoStudents: Math.round(stuCounts.filter((n) => n === 2).length / items.length * 100),
    studentWords: mean(stuWords.filter(Boolean)),
    qWords: mean(qWords.filter(Boolean)),
  };
}

const cur = measure(J("data/academicWriting/prompts.json"), "cur");
const tgt = measure(J("data/realExam2026/writing/academicDiscussion.json").items, "real");

console.log("AD: 当前题库 vs realExam2026真题(同检测器)\n");
const row = (label, k, u = "") => console.log(label.padEnd(22) + `${cur[k]}${u}`.padStart(10) + `${tgt[k]}${u}`.padStart(12) + `${(cur[k] - tgt[k]).toFixed(1)}`.padStart(9));
console.log("维度".padEnd(22) + "当前库".padStart(10) + "真题".padStart(12) + "偏差".padStart(9));
console.log("-".repeat(53));
console.log("样本数".padEnd(22) + String(cur.n).padStart(10) + String(tgt.n).padStart(12));
row("distinct课程", "distinctCourses");
row("课程复用(题/课)", "courseReuse");
row("平均学生数", "avgStudents");
row("恰好2学生%", "twoStudents", "%");
row("学生帖词数", "studentWords");
row("教授问题词数", "qWords");
