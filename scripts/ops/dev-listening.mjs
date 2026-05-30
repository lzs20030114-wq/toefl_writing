#!/usr/bin/env node
// Listening deviation: current generated bank vs realExam2026, per sub-type, same detector.
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const J = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const items = (d) => d.items || (Array.isArray(d) ? d : []);
const mean = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
const rng = (a) => { const s = [...a].sort((x, y) => x - y); return `${mean(a)} [${s[0]}–${s[s.length - 1]}]`; };

// current bank passage text per type
const curLen = {
  la: items(J("data/listening/bank/la.json")).map((x) => wc(x.announcement || x.text)),
  lat: items(J("data/listening/bank/lat.json")).map((x) => wc(x.lecture || x.text)),
  lc: items(J("data/listening/bank/lc.json")).map((x) => wc((x.conversation || []).map((t) => t.text || t).join(" "))),
};
// realExam2026 passage text per type
const re = (f, key) => J(`data/realExam2026/listening/${f}`).items.map((x) => wc(key === "conv" ? (x.conversation || []).map((t) => t.text).join(" ") : x.transcript));
const tgtLen = {
  la: re("announcements.json"), lat: re("lectures.json"), lc: re("conversations.json", "conv"),
};

console.log("Listening — 当前库 vs realExam2026 篇章词数(按类型)\n");
console.log("类型".padEnd(14) + "当前n".padStart(8) + "当前词数".padStart(16) + "真题n".padStart(8) + "真题词数".padStart(16));
console.log("-".repeat(62));
for (const [t, label] of [["lc", "对话"], ["la", "通知"], ["lat", "讲座"]]) {
  console.log(label.padEnd(14) + String(curLen[t].length).padStart(8) + rng(curLen[t]).padStart(16) + String(tgtLen[t].length).padStart(8) + rng(tgtLen[t]).padStart(16));
}
// type mix (real, among the 3 discourse types)
const tot = tgtLen.lc.length + tgtLen.la.length + tgtLen.lat.length;
console.log(`\n真题篇章类型占比: 对话 ${Math.round(tgtLen.lc.length / tot * 100)}% / 通知 ${Math.round(tgtLen.la.length / tot * 100)}% / 讲座 ${Math.round(tgtLen.lat.length / tot * 100)}%`);
const ctot = curLen.lc.length + curLen.la.length + curLen.lat.length;
console.log(`当前库类型占比:   对话 ${Math.round(curLen.lc.length / ctot * 100)}% / 通知 ${Math.round(curLen.la.length / ctot * 100)}% / 讲座 ${Math.round(curLen.lat.length / ctot * 100)}%`);
