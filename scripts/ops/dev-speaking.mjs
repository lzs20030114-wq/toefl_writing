#!/usr/bin/env node
// Speaking·repeat deviation: current bank vs realExam2026, same detector.
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const J = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
const wc = (s) => String(typeof s === "object" ? (s.text || s.sentence || "") : s).trim().split(/\s+/).filter(Boolean).length;
const mean = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : 0;
const pct = (a, f) => Math.round(a.filter(f).length / a.length * 100);

function measure(sets) {
  const perSet = sets.map((s) => (s.sentences || []).length);
  const allLen = sets.flatMap((s) => (s.sentences || []).map(wc)).filter(Boolean);
  return {
    sets: sets.length,
    sentPerSet: mean(perSet),
    set7pct: pct(perSet, (n) => n === 7),
    words: mean(allLen),
    easy: pct(allLen, (n) => n >= 4 && n <= 7),
    medium: pct(allLen, (n) => n >= 8 && n <= 12),
    hard: pct(allLen, (n) => n >= 13),
  };
}
const cur = J("data/speaking/bank/repeat.json");
const curM = measure(cur.items || cur.sets || cur);
const tgt = J("data/realExam2026/speaking/repeat.json");
const tgtM = measure(tgt.sets || tgt.items);

console.log("Speaking·repeat — 当前库 vs realExam2026(同检测器)\n");
const row = (label, k, u = "") => console.log(label.padEnd(18) + `${curM[k]}${u}`.padStart(10) + `${tgtM[k]}${u}`.padStart(12) + `${(curM[k] - tgtM[k]).toFixed(1)}`.padStart(9));
console.log("维度".padEnd(18) + "当前库".padStart(10) + "真题".padStart(12) + "偏差".padStart(9));
console.log("-".repeat(49));
console.log("套数".padEnd(18) + String(curM.sets).padStart(10) + String(tgtM.sets).padStart(12));
row("句/套", "sentPerSet");
row("恰好7句%", "set7pct", "%");
row("句词数", "words");
row("难度·易(4-7)%", "easy", "%");
row("难度·中(8-12)%", "medium", "%");
row("难度·难(13+)%", "hard", "%");
