#!/usr/bin/env node
// Email deviation: current generated bank vs realExam2026, same detectors.
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const J = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const mean = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : 0;

function measure(items, scenarioKey, bulletsKey) {
  const sc = items.map((x) => wc(x[scenarioKey]));
  const bl = items.map((x) => (x[bulletsKey] || []).length);
  return {
    n: items.length,
    scenarioWords: mean(sc),
    bullets: mean(bl),
    bullet3pct: Math.round(bl.filter((b) => b === 3).length / items.length * 100),
    distinctSubjects: new Set(items.map((x) => String(x.subject || "").toLowerCase().trim()).filter(Boolean)).size,
  };
}
const cur = measure(J("data/emailWriting/prompts.json").items || J("data/emailWriting/prompts.json"), "scenario", "goals");
const tgt = measure(J("data/realExam2026/writing/email.json").items, "scenario", "bullets");

console.log("Email: 当前题库 vs realExam2026真题(同检测器)\n");
const row = (label, k, u = "") => console.log(label.padEnd(20) + `${cur[k]}${u}`.padStart(10) + `${tgt[k]}${u}`.padStart(12) + `${(cur[k] - tgt[k]).toFixed(1)}`.padStart(9));
console.log("维度".padEnd(20) + "当前库".padStart(10) + "真题".padStart(12) + "偏差".padStart(9));
console.log("-".repeat(51));
console.log("样本数".padEnd(20) + String(cur.n).padStart(10) + String(tgt.n).padStart(12));
row("场景词数", "scenarioWords");
row("bullets/任务数", "bullets");
row("恰好3 bullets%", "bullet3pct", "%");
