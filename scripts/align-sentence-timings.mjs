#!/usr/bin/env node
/**
 * align-sentence-timings.mjs — 给**已有音频**的听力题补 `sentence_timings`（句级起止秒）。
 *
 * 产线（backfill-tts / rerender-listening-audio / render_real_audio）只给新配的音频顺带写时间戳；
 * 已上线的生成库 TTS、真题 TTS、真题原声都没有。这里用本地 faster-whisper 的词级时间戳
 * （scripts/realbank/asr_words.py，零 API 费）把已知原文按句对上去（lib/listening/alignSentences.js）。
 * 契约：docs/listening-sentence-timings.md。
 *
 * 三段，可分开跑、可断点续跑（每段都跳过已完成的）：
 *   --phase=fetch   下载待补条目的 mp3 到 <workdir>/audio/<id>.mp3，写 <workdir>/jobs.json
 *   --phase=asr     调 asr_words.py --jobs 跑词级转写到 <workdir>/words/<id>.json（已有的跳过）
 *   --phase=apply   对齐并写回题库；真题原声还同步写进 original-audio.json 的条目（build_bank 回挂用）
 *   默认 --phase=all 顺序跑完三段。
 *
 * 用法（本机；需要能直连 Supabase 音频桶 + faster-whisper 环境，与 asr_words.py 相同）：
 *   node scripts/align-sentence-timings.mjs --dry-run              # 只报要补多少条
 *   node scripts/align-sentence-timings.mjs                        # 全量：生成库 + 真题库
 *   node scripts/align-sentence-timings.mjs --bank=real --only=lc  # 只补真题对话
 *   node scripts/align-sentence-timings.mjs --phase=apply          # 转写已跑完，只对齐写回
 *   --limit=N   --force（已有时间戳也重算）  --model=medium.en（默认 REALBANK_WORDS_MODEL 或 medium.en）
 *   --python=python（Windows 默认 python，其余 python3）  --workdir=.codex-tmp/listening-timings
 *
 * 写回口径：一条音频里定位到的句子 ≥80% 才写，否则记进 <workdir>/report.json 的 rejected，不写。
 * 定位不到的个别句子写 start/end=null（前端列出但不可点）。
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { alignSentences } = require("../lib/listening/alignSentences.js");
const { splitSentences } = require("../lib/tts/wavTools.js");
const { singleSpeakerText } = require("../lib/tts/renderListening.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.split("=").slice(1).join("=") : (argv.includes(`--${name}`) ? true : undefined); };

const PHASE = String(flag("phase") || "all");
const DRY = argv.includes("--dry-run") || argv.includes("--dry");
const FORCE = argv.includes("--force");
const ONLY = flag("only"); const ONLY_SET = ONLY && ONLY !== true ? new Set(String(ONLY).split(",")) : null;
const BANK = String(flag("bank") || "all"); // generated | real | all
const LIMIT_RAW = flag("limit"); const LIMIT = LIMIT_RAW && LIMIT_RAW !== true ? (parseInt(LIMIT_RAW, 10) || Infinity) : Infinity;
const MODEL = String(flag("model") || process.env.REALBANK_WORDS_MODEL || "medium.en");
const PYTHON = String(flag("python") || (process.platform === "win32" ? "python" : "python3"));
const WORKDIR = path.resolve(ROOT, String(flag("workdir") || ".codex-tmp/listening-timings"));
const AUDIO_DIR = path.join(WORKDIR, "audio");
const WORDS_DIR = path.join(WORKDIR, "words");
const FETCH_CONCURRENCY = 4;

const TYPES = ["lcr", "lc", "la", "lat"];
const BANKS = [];
if (BANK === "generated" || BANK === "all") for (const t of TYPES) BANKS.push({ kind: "generated", type: t, file: path.join(ROOT, "data/listening/bank", `${t}.json`) });
if (BANK === "real" || BANK === "all") for (const t of TYPES) BANKS.push({ kind: "real", type: t, file: path.join(ROOT, "data/realBank/listening", `${t}.json`) });
const ORIGINAL_MANIFEST = path.join(ROOT, "data/realBank/listening/original-audio.json");

const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const save = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n", "utf8");
const isHttp = (u) => /^https?:\/\//.test(String(u || ""));

/** 与渲染同一把刀切句：lc 逐轮（带 turn/speaker），其余单人整段。 */
export function sentencesOf(item, type) {
  if (type === "lc") {
    const out = [];
    (Array.isArray(item.conversation) ? item.conversation : []).forEach((t, i) => {
      for (const s of splitSentences(t && t.text)) out.push({ turn: i, ...(t.speaker != null ? { speaker: t.speaker } : {}), text: s });
    });
    return out;
  }
  return splitSentences(singleSpeakerText(item, type)).map((s) => ({ text: s }));
}

function plan() {
  const jobs = [];
  for (const b of BANKS) {
    if (ONLY_SET && !ONLY_SET.has(b.type)) continue;
    if (!fs.existsSync(b.file)) continue;
    const bank = load(b.file);
    for (const it of bank.items || []) {
      if (!it || !it.id || !isHttp(it.audio_url)) continue;
      if (Array.isArray(it.sentence_timings) && !FORCE) continue;
      const sentences = sentencesOf(it, b.type);
      if (!sentences.length) continue;
      jobs.push({
        id: it.id, type: b.type, kind: b.kind, file: b.file, url: it.audio_url,
        original: it.audio_source === "original" || /\/real_orig\//.test(it.audio_url),
        audio: path.join(AUDIO_DIR, `${it.id}.mp3`),
        words: path.join(WORDS_DIR, `${it.id}.json`),
        sentences,
      });
      if (jobs.length >= LIMIT) return jobs;
    }
  }
  return jobs;
}

async function fetchOne(job) {
  if (fs.existsSync(job.audio) && fs.statSync(job.audio).size > 0) return "cached";
  const res = await fetch(job.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("empty body");
  fs.mkdirSync(path.dirname(job.audio), { recursive: true });
  fs.writeFileSync(job.audio + ".part", buf);
  fs.renameSync(job.audio + ".part", job.audio);
  return "fetched";
}

async function phaseFetch(jobs) {
  let idx = 0, fetched = 0, cached = 0, failed = 0;
  const failures = [];
  async function worker() {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      try {
        const r = await fetchOne(job);
        if (r === "cached") cached++; else fetched++;
      } catch (e) { failed++; failures.push({ id: job.id, error: String(e && e.message).slice(0, 120) }); }
      const done = fetched + cached + failed;
      if (done % 50 === 0 || done === jobs.length) console.log(`  下载 ${done}/${jobs.length}（新 ${fetched} / 已有 ${cached} / 失败 ${failed}）`);
    }
  }
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  const asrJobs = jobs.filter((j) => fs.existsSync(j.audio)).map((j) => ({ audio: j.audio, out: j.words, ...(j.type === "lcr" ? { no_vad: true } : {}) }));
  fs.mkdirSync(WORKDIR, { recursive: true });
  save(path.join(WORKDIR, "jobs.json"), asrJobs);
  return { fetched, cached, failed, failures, asrJobs: asrJobs.length };
}

function phaseAsr() {
  const jobsFile = path.join(WORKDIR, "jobs.json");
  if (!fs.existsSync(jobsFile)) throw new Error(`缺 ${jobsFile}，先跑 --phase=fetch`);
  const script = path.join(ROOT, "scripts/realbank/asr_words.py");
  console.log(`  ${PYTHON} ${path.relative(ROOT, script)} --jobs ${path.relative(ROOT, jobsFile)} --model ${MODEL}`);
  const r = spawnSync(PYTHON, [script, "--jobs", jobsFile, "--model", MODEL], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`asr_words.py 退出码 ${r.status}`);
}

function phaseApply(jobs) {
  const byFile = new Map();
  const report = { written: 0, rejected: [], missingWords: [], perBank: {} };
  let manifest = null, manifestDirty = false;
  for (const job of jobs) {
    const key = `${job.kind}/${job.type}`;
    report.perBank[key] = report.perBank[key] || { candidates: 0, written: 0, rejected: 0, missingWords: 0, sentences: 0, located: 0 };
    const pb = report.perBank[key];
    pb.candidates += 1;
    if (!fs.existsSync(job.words)) { pb.missingWords += 1; report.missingWords.push(job.id); continue; }
    let words;
    try { words = load(job.words).words; } catch { pb.missingWords += 1; report.missingWords.push(job.id); continue; }
    const res = alignSentences(job.sentences, words);
    pb.sentences += res.total; pb.located += res.located;
    if (!res.timings) { pb.rejected += 1; report.rejected.push({ id: job.id, reasons: res.reasons.slice(0, 6) }); continue; }
    if (!byFile.has(job.file)) byFile.set(job.file, load(job.file));
    const bank = byFile.get(job.file);
    const it = (bank.items || []).find((x) => x && x.id === job.id);
    if (!it) continue;
    it.sentence_timings = res.timings;
    pb.written += 1; report.written += 1;
    if (job.original) {
      // 原声的时间戳还要进清单：build_bank 全量重建时 applyOriginalAudio 从清单回挂，条目上的会被覆盖。
      if (!manifest) manifest = fs.existsSync(ORIGINAL_MANIFEST) ? load(ORIGINAL_MANIFEST) : null;
      const e = manifest && manifest.entries && manifest.entries[job.id];
      if (e && e.url === it.audio_url) { e.sentence_timings = res.timings; manifestDirty = true; }
    }
  }
  if (!DRY) {
    for (const [file, bank] of byFile) save(file, bank);
    if (manifestDirty) save(ORIGINAL_MANIFEST, manifest);
    fs.mkdirSync(WORKDIR, { recursive: true });
    save(path.join(WORKDIR, "report.json"), report);
  }
  return report;
}

async function main() {
  const jobs = plan();
  const byKey = {};
  for (const j of jobs) { const k = `${j.kind}/${j.type}${j.original ? "(原声)" : ""}`; byKey[k] = (byKey[k] || 0) + 1; }
  console.log("■ 听力句级时间戳补齐");
  for (const [k, n] of Object.entries(byKey)) console.log(`  ${k}: ${n} 条`);
  console.log(`  合计 ${jobs.length} 条待补（已有 sentence_timings 的跳过${FORCE ? "，--force 已关闭" : ""}）`);
  if (!jobs.length) return;
  if (DRY && PHASE !== "apply") { console.log("\n（--dry-run：不下载、不转写、不写回）"); return; }

  if (PHASE === "fetch" || PHASE === "all") {
    console.log(`\n① 下载音频 → ${path.relative(ROOT, AUDIO_DIR)}`);
    const r = await phaseFetch(jobs);
    console.log(`  新下载 ${r.fetched} / 已有 ${r.cached} / 失败 ${r.failed}；转写作业单 ${r.asrJobs} 条 → jobs.json`);
    if (r.failures.length) console.log("  失败：" + r.failures.slice(0, 10).map((f) => `${f.id}(${f.error})`).join(", "));
    if (PHASE === "fetch") return;
  }
  if (PHASE === "asr" || PHASE === "all") {
    console.log(`\n② 词级转写（faster-whisper ${MODEL}）→ ${path.relative(ROOT, WORDS_DIR)}`);
    phaseAsr();
    if (PHASE === "asr") return;
  }
  console.log(`\n③ 对齐写回${DRY ? "（--dry-run：只报不写）" : ""}`);
  const rep = phaseApply(jobs);
  for (const [k, v] of Object.entries(rep.perBank)) {
    const pct = v.sentences ? Math.round((v.located / v.sentences) * 100) : 0;
    console.log(`  ${k}: 写入 ${v.written} / 拒绝 ${v.rejected} / 缺转写 ${v.missingWords}（句子定位率 ${pct}%）`);
  }
  console.log(`  合计写入 ${rep.written} 条；拒绝 ${rep.rejected.length}；缺转写 ${rep.missingWords.length}${DRY ? "" : `；明细 ${path.relative(ROOT, path.join(WORKDIR, "report.json"))}`}`);
  if (rep.rejected.length) console.log("  拒绝样例：" + rep.rejected.slice(0, 5).map((r) => `${r.id}: ${r.reasons[0]}`).join(" | "));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error("✗", e && e.message ? e.message : e); process.exit(1); });
