#!/usr/bin/env node
// BS deviation: CURRENT generated bank vs realExam2026 target, SAME detectors.
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const J = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

// identical detectors applied to both corpora
const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
function measure(sentences) {
  const t = sentences.map((s) => String(s || "").trim()).filter(Boolean);
  const lens = t.map(wc).sort((a, b) => a - b);
  const pct = (f) => Math.round(t.filter(f).length / t.length * 100);
  return {
    n: t.length,
    words: Math.round(lens.reduce((a, b) => a + b, 0) / t.length * 10) / 10,
    p10: lens[Math.floor(t.length * 0.1)], p90: lens[Math.floor(t.length * 0.9)],
    qmark: pct((s) => /\?\s*$/.test(s)),
    wh: pct((s) => /^(what|why|how|where|when|who|which)\b/i.test(s)),
    embedded: pct((s) => /\b(if|whether|wonder|do you know|can you tell|find out|found out|tell me|curious|wants? to know|needed to know)\b/i.test(s)),
    negation: pct((s) => /\b(not|n't|never|no longer|nothing|none|cannot)\b/i.test(s)),
    // difficulty proxy via answer length buckets
    easy: pct((s) => wc(s) <= 7),
    medium: pct((s) => wc(s) >= 8 && wc(s) <= 11),
    hard: pct((s) => wc(s) >= 12),
    // topic domain (keyword heuristic)
    campus: pct((s) => /\b(class|professor|assignment|due|exam|course|lecture|campus|dorm|library|tuition|advisor|registrar|syllabus|deadline|semester|study|homework|grade|department|enroll)\b/i.test(s)),
    daily: pct((s) => /\b(store|buy|ticket|coffee|bus|train|weekend|movie|friend|dinner|shop|restaurant|trip|gym|park|apartment|rent|neighbor)\b/i.test(s)),
  };
}

// realExam2026 target
const target = measure(J("data/realExam2026/writing/buildSentence-targets.json").items.map((x) => x.target));
// current generated bank answers
const bank = [];
for (const set of J("data/buildSentence/questions.json").question_sets || [])
  for (const q of set.questions || []) if (q.answer) bank.push(q.answer);
const cur = measure(bank);

const dims = [["answer词数", "words", ""], ["疑问句%", "qmark", "%"], ["wh开头%", "wh", "%"], ["间接embedded%", "embedded", "%"], ["否定%", "negation", "%"], ["难度·easy%", "easy", "%"], ["难度·medium%", "medium", "%"], ["难度·hard%", "hard", "%"], ["话题·校园%", "campus", "%"], ["话题·日常%", "daily", "%"]];
console.log("BS: 当前题库 vs realExam2026真题(同检测器)\n");
console.log("维度".padEnd(16) + "当前库".padStart(10) + "真题目标".padStart(12) + "偏差".padStart(10));
console.log("-".repeat(48));
console.log(("样本数").padEnd(16) + String(cur.n).padStart(10) + String(target.n).padStart(12));
for (const [label, k, u] of dims) {
  const c = cur[k], t = target[k];
  const d = (c - t).toFixed(k === "words" ? 1 : 0);
  console.log(label.padEnd(16) + `${c}${u}`.padStart(10) + `${t}${u}`.padStart(12) + `${d > 0 ? "+" : ""}${d}${u}`.padStart(10));
}
console.log(`\n词数分布: 当前 [${cur.p10}–${cur.p90}]  真题 [${target.p10}–${target.p90}]`);
