#!/usr/bin/env node
/**
 * mark-audio-stale-by-split.mjs — 切句规则变了之后，找出「按旧规则配的音频会念错」的条目并作废。
 *
 * 背景（2026-09-07 线上反馈）：lib/tts/wavTools.splitSentences 以前按每个句号切句、逐句 TTS 再拼接，
 * "leave at seven a.m." 被切成 "seven a." + "m." 两段，中间停顿。修成认缩写/小数/网址之后，
 * 凡是新旧切法结果不同的条目，桶里的 mp3 都是错的，要重配：
 *   真题库 data/realBank/{listening,speaking}  → 清 audio_url + audio_pending，render_real_audio.mjs 补
 *   生成库 data/listening/bank                  → 清 audio_url，backfill-tts.mjs --tts-provider=openai 补
 *     （生成库口语是 edge-tts 整句念的，不走切句，不动）
 *
 * 用法: node scripts/mark-audio-stale-by-split.mjs [--bank=real|live|all] [--dry]
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { splitSentences } = require("../lib/tts/wavTools.js");

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const BANK = (argv.find((a) => a.startsWith("--bank=")) || "--bank=all").split("=")[1];

// 修复前的切法（原样保留，作为「已配音频实际念了什么」的基准）。
function oldSplit(text) {
  const out = (String(text || "").match(/[^.!?]+[.!?]*/g) || []).map((s) => s.trim()).filter(Boolean);
  return out.length ? out : [String(text || "").trim()].filter(Boolean);
}
// 只比「念出来的词」：引号/括号归属哪一段不影响发音，不算变化。
const QUOTES_RE = /[“”"'‘’()\[\]]/g;
const norm = (arr) => arr.map((s) => s.replace(QUOTES_RE, "").replace(/\s+/g, " ").trim()).filter(Boolean).join("|");
const changed = (text) => norm(oldSplit(text)) !== norm(splitSentences(text));
const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

const targets = [];
if (BANK === "real" || BANK === "all") {
  targets.push(
    { file: "data/realBank/listening/lc.json", units: (b) => b.items, texts: (it) => (it.conversation || []).map((l) => l.text), pending: true },
    { file: "data/realBank/listening/la.json", units: (b) => b.items, texts: (it) => [it.announcement], pending: true },
    { file: "data/realBank/listening/lat.json", units: (b) => b.items, texts: (it) => [it.transcript], pending: true },
    { file: "data/realBank/listening/lcr.json", units: (b) => b.items, texts: (it) => [it.speaker], pending: true },
    { file: "data/realBank/speaking/repeat.json", units: (b) => b.items.flatMap((x) => x.sentences || []), texts: (s) => [s.sentence], pending: true },
    { file: "data/realBank/speaking/interview.json", units: (b) => b.items.flatMap((x) => x.questions || []), texts: (q) => [q.question], pending: true },
  );
}
if (BANK === "live" || BANK === "all") {
  targets.push(
    { file: "data/listening/bank/lc.json", units: (b) => b.items, texts: (it) => (it.conversation || []).map((l) => l.text) },
    { file: "data/listening/bank/la.json", units: (b) => b.items, texts: (it) => [it.announcement] },
    { file: "data/listening/bank/lat.json", units: (b) => b.items, texts: (it) => [it.transcript] },
    { file: "data/listening/bank/lcr.json", units: (b) => b.items, texts: (it) => [it.speaker] },
  );
}

let total = 0, words = 0;
for (const t of targets) {
  const p = path.join(ROOT, t.file);
  if (!fs.existsSync(p)) continue;
  const bank = JSON.parse(fs.readFileSync(p, "utf8"));
  const hit = [];
  for (const u of t.units(bank)) {
    if (!u.audio_url) continue;
    const texts = t.texts(u).filter(Boolean);
    if (!texts.some(changed)) continue;
    hit.push(u.id);
    words += texts.reduce((n, s) => n + wc(s), 0);
    if (!DRY) { u.audio_url = null; if (t.pending) u.audio_pending = true; }
  }
  total += hit.length;
  console.log(`${t.file}: ${hit.length} 条切法变了${hit.length ? " -> " + hit.slice(0, 6).join(", ") + (hit.length > 6 ? " ..." : "") : ""}`);
  if (!DRY && hit.length) fs.writeFileSync(p, JSON.stringify(bank, null, 2) + (t.file.startsWith("data/listening") ? "\n" : ""), "utf8");
}
console.log(`\n合计 ${total} 条 / ${words} 口播词 / 预估 ≈ ${(words / 140 * 0.107).toFixed(2)} 元${DRY ? "（--dry，未写文件）" : "（已清 audio_url）"}`);
