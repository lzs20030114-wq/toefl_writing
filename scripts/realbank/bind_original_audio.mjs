#!/usr/bin/env node
/**
 * 真题听力「原声优先」—— 从商家源料里切出真人原声，逐条过闸，替掉我们自己配的 TTS。
 *
 * 现状：`data/realBank/listening/{lcr,lc,la,lat}.json` 的 audio_url 全部指向
 * `real/<type>/<id>.mp3`，是 `render_real_audio.mjs` 用 gpt-4o-mini-tts 配的。
 * 商家源料里其实带着真人原声，本脚本把能可靠切出来的那部分换成原声；
 * **切不出来 / 过不了闸的一律保持 TTS 不动**（TTS 文件也原样留着，随时可回滚）。
 *
 * 两类源：
 *   rf/rp（第二来源）：逐题 mp3，`<set>.json` 的 source_dir + structured 记录的
 *     items[0].audio_path 直接定位。头上带 ETS 旁白，尾巴内嵌作答时间
 *     （每 ~0.65s 一声 −31 dBFS 计时「咔」，静音阈值裁不掉）。
 *   first（第一来源）：整块 ListeningModule1/2.mp3。structured 的 audio_span_sec
 *     **尾巴不准**（1.21B lc Q13 记 138.38s 实际 126s 就完），lcr 更是十二句短应答
 *     两两共用一个粗区间 —— 所以这里根本不用 span 当切点，只拿它做粗定位，
 *     真正的切点全部来自**词级时间戳**（scripts/realbank/asr_words.py，本机 faster-whisper，
 *     零 API 费用）+ 与题库口播文本的序列对齐。
 *
 * 判据（切点 / 旁白剥离 / 尾巴裁剪 / 过闸）全在 scripts/realbank/original_audio.js
 * 这个无 IO 的纯模块里，单测见 __tests__/realbank-original-audio.test.js。
 *
 * 用法：
 *   node scripts/realbank/bind_original_audio.mjs --dry-run      # 只算+切到本地+出报告
 *   node scripts/realbank/bind_original_audio.mjs                # 上传 + 写清单 + 回挂
 *   …… --only=lc,lat --set=rf0610 --limit=20 --ids=real_lc_121b_1_13
 *
 * --dry-run 产物：
 *   .codex-tmp/realbank/orig-audio/<type>/<id>.mp3   本地切片（供人工试听）
 *   .codex-tmp/realbank/orig-audio/report.json       逐条体检报告
 */
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const OA = require("./original_audio.js");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, ".codex-tmp", "realbank");
const LISTENING_DIR = path.join(ROOT, "data", "realBank", "listening");
const WORDS_DIR = path.join(OUT_DIR, "asr-words");
const SLICE_DIR = path.join(OUT_DIR, "orig-audio");
const NARRATION_DIR = path.join(OUT_DIR, "narration-tts");
const MANIFEST = path.join(LISTENING_DIR, "original-audio.json");
const TTS_NARRATION_LEDGER = path.join(LISTENING_DIR, "tts-narration.json");
const SRC_ROOT = process.env.REALBANK_SRC_ROOT || "D:\\桌面\\【2026改后全科真题】（持续更新中）";
const TYPES = ["lcr", "lc", "la", "lat"];
const STORAGE_PREFIX = "real_orig";
const CONCURRENCY = Number(process.env.REALBANK_ORIG_CONCURRENCY || 4);

/* ── CLI ─────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=").slice(1).join("=");
const DRY = argv.includes("--dry-run") || argv.includes("--dry");
const ONLY = flag("only") ? new Set(flag("only").split(",").map((s) => s.trim())) : null;
const SET = flag("set") ? new Set(flag("set").split(",").map((s) => s.trim())) : null;
const IDS = flag("ids") ? new Set(flag("ids").split(",").map((s) => s.trim())) : null;
const LIMIT = flag("limit") ? parseInt(flag("limit"), 10) || Infinity : Infinity;
const SKIP_TTS_NARRATION = argv.includes("--skip-tts-narration");
const REDO_TTS_NARRATION = argv.includes("--redo-tts-narration");

const pad2 = (n) => String(n).padStart(2, "0");
const round3 = (x) => Math.round(x * 1000) / 1000;
const log = (...a) => console.log(...a);

/** 与 build_bank.mjs setSlug / extract_bs_pages.set_slug 同规则。 */
function setSlug(s) {
  if (/^r[fp]\d{4}$/.test(s)) return s;
  const m = /^(\d{1,2})[.．](\d{1,2})/.exec(s);
  const base = m ? `${m[1]}${m[2]}` : "x";
  const v = /([ABC])卷/.exec(s);
  const rev = /_v(\d+)$/.exec(s);
  return base + (v ? v[1].toLowerCase() : "") + (rev ? `v${rev[1]}` : "");
}

/** build_bank.mjs 的口播**指纹**（清单 text_sha1 用它，回挂时逐字比对）。 */
function spokenFingerprint(kind, it) {
  if (kind === "lcr") return String(it.speaker || "");
  if (kind === "la") return String(it.announcement || "");
  if (kind === "lat") return String(it.transcript || "");
  if (kind === "lc") {
    const roster = (it.speakers || []).map((s) => `${s.name}/${s.gender}`).join(",");
    const lines = (it.conversation || []).map((t) => `${t.speaker}: ${t.text}`).join(" / ");
    return roster + " || " + lines;
  }
  return "";
}

/* ── 进程辅助 ────────────────────────────────────────────────────────────── */
function run(cmd, args, { binary = false, input = null } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
    const out = [];
    const err = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", (e) => resolve({ code: -1, out: binary ? Buffer.alloc(0) : "", err: String(e.message) }));
    p.on("close", (code) => resolve({
      code,
      out: binary ? Buffer.concat(out) : Buffer.concat(out).toString("utf8"),
      err: Buffer.concat(err).toString("utf8"),
    }));
    if (input != null) { p.stdin.write(input); p.stdin.end(); }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 网络调用重试。本机到 supabase.co 会偶发 10s connect timeout
 * （实测同一个对象 URL 第一次 ConnectTimeoutError、紧接着 6 次全部 200，
 * 是 Cloudflare 两个 anycast IP 里有一个不通），单次失败不代表「系统性失败」，
 * 不重试会把一条好条目误判成失败、或者把整轮上传拦在探针那一步。
 */
async function withRetry(fn, { tries = 4, label = "" } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (i < tries) await sleep(400 * i * i);
    }
  }
  throw new Error(`${label ? label + ": " : ""}${String(last && last.message || last).slice(0, 160)}（重试 ${tries} 次仍失败）`);
}

async function pool(items, n, fn) {
  const it = items[Symbol.iterator]();
  const workers = Array.from({ length: Math.max(1, n) }, async () => {
    for (;;) {
      const nx = it.next();
      if (nx.done) return;
      await fn(nx.value);
    }
  });
  await Promise.all(workers);
}

async function ffprobeDuration(file) {
  const r = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1", file]);
  const d = parseFloat(String(r.out).trim());
  return Number.isFinite(d) ? d : null;
}

/* ── 1. 建计划：题库条目 → 源音频 + 定位信息 ─────────────────────────────── */

function buildIndex() {
  const idx = new Map();
  const setJson = new Map();
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".structured.json"));
  for (const f of files) {
    const setname = f.replace(/\.structured\.json$/, "");
    let st;
    try { st = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8")); } catch { continue; }
    for (const r of st.results || []) {
      if (r.section !== "listening" || r.status !== "ok") continue;
      const id = `real_${r.type}_${setSlug(setname)}_${r.module}_${pad2(r.q_start)}`;
      if (!idx.has(id)) idx.set(id, { setname, r, st });
    }
    if (!setJson.has(setname)) {
      let sj = null;
      try { sj = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `${setname}.json`), "utf8")); } catch { /* 可缺 */ }
      setJson.set(setname, sj);
    }
  }
  return { idx, setJson };
}

/** 第一来源：卷名 + module → 整块 mp3 的绝对路径（文件名取自 asr 缓存的 file 字段）。 */
const firstAudioCache = new Map();
function firstSourceAudio(setname, module) {
  const key = `${setname}#${module}`;
  if (firstAudioCache.has(key)) return firstAudioCache.get(key);
  let res = { err: "asr缓存缺失" };
  const p = path.join(OUT_DIR, "asr", setname, `listening_m${module}.json`);
  if (fs.existsSync(p)) {
    const base = JSON.parse(fs.readFileSync(p, "utf8")).file;
    const dir = path.join(SRC_ROOT, setname);
    res = { err: `源音频缺失(${base})` };
    if (fs.existsSync(dir)) {
      const stack = [dir];
      while (stack.length) {
        const cur = stack.pop();
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
          const fp = path.join(cur, e.name);
          if (e.isDirectory()) stack.push(fp);
          else if (e.name === base) { res = { file: fp }; stack.length = 0; break; }
        }
      }
    }
  }
  firstAudioCache.set(key, res);
  return res;
}

function buildPlan() {
  const { idx, setJson } = buildIndex();
  const survey = loadNarrationSurvey();
  const plan = [];
  const skipped = {};
  for (const type of TYPES) {
    const p = path.join(LISTENING_DIR, `${type}.json`);
    if (!fs.existsSync(p)) continue;
    const bank = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const it of bank.items || []) {
      const hit = idx.get(it.id);
      if (!hit) { skipped[it.id] = { type, reason: "no_structured_record" }; continue; }
      const { setname, r, st } = hit;
      // --only / --ids 只筛「要评估哪些」，**不筛定位**：第一来源是整块 module，
      // 同 module 里每一组的切点都依赖前一组的终点与后一组的起点。
      // 按题型先筛掉一半再定位，剩下的组会把被筛掉那组的音频一起吃进来。
      const selected = (!ONLY || ONLY.has(type)) && (!IDS || IDS.has(it.id));
      if (SET && !SET.has(setname) && !SET.has(setSlug(setname))) continue;

      const vendor = !!(r.items && r.items[0] && r.items[0].audio_path);
      let audioFile = null;
      let srcDirName = setname;
      // rp* 是「拼盘」卷，落料格式与 rf 一样是逐题 mp3，走同一条逻辑，只是报告里分开数。
      const source = vendor ? (/^rp/.test(setname) ? "rp" : "rf") : "first";
      if (vendor) {
        const sd = (st && st.source_dir) || (setJson.get(setname) && setJson.get(setname).source_dir);
        if (!sd) { skipped[it.id] = { type, set: setname, reason: "source_missing:no_source_dir" }; continue; }
        const fp = path.join(sd, r.items[0].audio_path);
        if (!fs.existsSync(fp)) { skipped[it.id] = { type, set: setname, reason: "source_missing:file" }; continue; }
        audioFile = fp;
        srcDirName = path.basename(sd.replace(/[\\/]+$/, ""));
      } else {
        const res = firstSourceAudio(setname, r.module);
        if (res.err) { skipped[it.id] = { type, set: setname, reason: `source_missing:${res.err}` }; continue; }
        audioFile = res.file;
      }

      const text = OA.spokenPlainText(type, it);
      const tokens = OA.normTokens(text);
      if (!tokens.length) { skipped[it.id] = { type, set: setname, reason: "empty_spoken_text" }; continue; }
      plan.push({
        id: it.id, type, set: setname, source, audioFile, srcDirName, selected,
        module: r.module, qStart: r.q_start,
        span: Array.isArray(r.audio_span_sec) ? r.audio_span_sec : null,
        words: tokens.length,
        targetTokens: tokens,
        textSha1: OA.sha1(spokenFingerprint(type, it)),
        narrationRaw: survey.get(it.id) || null,   // 文本在 ensureWords 之后定（还原不到才退通用句）
      });
    }
  }
  plan.sort((a, b) => (a.set === b.set
    ? (a.module - b.module) || (a.qStart - b.qStart)
    : a.set.localeCompare(b.set)));
  if (LIMIT !== Infinity) {
    let n = 0;
    for (const e of plan) { if (e.selected && ++n > LIMIT) e.selected = false; }
  }
  return { plan, skipped };
}

/* ── 2. 词级转写（本机 faster-whisper，零 API 费用） ──────────────────────── */

function wordsCachePath(entry) {
  if (entry.source === "first") {
    return path.join(WORDS_DIR, entry.set, `listening_m${entry.module}.json`);
  }
  // 与 .codex-tmp/realbank/asr-vendor/ 同布局：<源目录名>/<文件名去扩展>.json。
  // 不能用 audioFile 的父目录 —— 逐题 mp3 一律躺在 <源目录>/audio/item_level/ 下，
  // 取父目录会让所有卷都落进同一个 "audio" 目录、同名文件互相覆盖。
  return path.join(WORDS_DIR, entry.srcDirName || entry.set,
    `${path.basename(entry.audioFile).replace(/\.[^.]+$/, "")}.json`);
}

let asrElapsed = 0;
async function runAsrWords(jobs) {
  const todo = jobs.filter((j) => !fs.existsSync(j.out));
  if (!todo.length) return { done: 0, elapsed: 0 };
  const t0 = Date.now();
  const jobFile = path.join(os.tmpdir(), `realbank-asr-words-${process.pid}-${Date.now()}.json`);
  fs.mkdirSync(WORDS_DIR, { recursive: true });
  fs.writeFileSync(jobFile, JSON.stringify(jobs), "utf8");
  const r = await new Promise((resolve) => {
    const p = spawn("python", [path.join("scripts", "realbank", "asr_words.py"), "--jobs", jobFile],
      { stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
    const out = [];
    p.stdout.on("data", (d) => out.push(d));
    p.on("error", (e) => resolve({ code: -1, out: String(e.message) }));
    p.on("close", (code) => resolve({ code, out: Buffer.concat(out).toString("utf8") }));
  });
  try { fs.unlinkSync(jobFile); } catch { /* ignore */ }
  const elapsed = (Date.now() - t0) / 1000;
  asrElapsed += elapsed;
  log(`  词级转写完成：新跑 ${todo.length} 个，用时 ${elapsed.toFixed(0)}s；缓存 ${path.relative(ROOT, WORDS_DIR)}`);
  if (r.code !== 0) log(`  ⚠ asr_words.py 退出码 ${r.code}：${String(r.out).slice(0, 200)}`);
  return { done: todo.length, elapsed };
}

async function ensureWords(plan) {
  // 第一来源是整块 module：只要这个 module 里有一条要评估，整块就得转写（同组互为切点边界）。
  const liveModules = new Set(plan.filter((e) => e.selected && e.source === "first")
    .map((e) => `${e.set}#${e.module}`));
  const jobs = new Map();
  for (const e of plan) {
    e.wordsPath = wordsCachePath(e);
    const needed = e.source === "first" ? liveModules.has(`${e.set}#${e.module}`) : e.selected;
    if (needed && !jobs.has(e.wordsPath)) jobs.set(e.wordsPath, { audio: e.audioFile, out: e.wordsPath });
  }
  const list = [...jobs.values()];
  const todo = list.filter((j) => !fs.existsSync(j.out));
  log(`■ 词级转写：需要 ${jobs.size} 个音频文件的词级时间戳，其中 ${todo.length} 个没缓存`);
  const r = await runAsrWords(list);
  return { total: jobs.size, done: r.done, elapsed: r.elapsed };
}

const wordsCache = new Map();
function loadWords(p) {
  if (wordsCache.has(p)) return wordsCache.get(p);
  let d = null;
  try { d = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* 缺就是缺 */ }
  wordsCache.set(p, d);
  return d;
}

/* ── 3. 算切点 ───────────────────────────────────────────────────────────── */

/**
 * 第一来源：同一 module 内按 q_start 顺序**单调**定位 —— 光标只往前走，
 * 后一组只能在前一组结束之后找。这一步同时解决两件事：
 *   · span 的尾巴不准（根本不用它当终点）；
 *   · lcr 十二句短应答共用粗区间、内容又互相像（"Who is presenting our project?" /
 *     "Who will be attending the conference?"）—— 顺序单调等于天然的唯一性约束。
 */
function locateFirstSource(entries, words) {
  let cursor = 0;
  const placed = [];
  for (const e of entries) {
    const limit = Math.min(words.length, cursor + e.targetTokens.length * 4 + 300);
    const win = words.slice(cursor, limit);
    const cut = OA.computeCut({
      words: win,
      targetTokens: e.targetTokens,
      allowLeadIn: e.type !== "lcr",
    });
    if (!cut.ok) { placed.push({ e, cut }); continue; }
    const aAbs = cursor + cut.aIdx;
    const bAbs = cursor + cut.bIdx;
    // 旁白起点（"listen" 那个词）：给上一组当天花板，保证上一条切片不吃到本组旁白。
    const narrStart = cut.narrStartIdx == null ? null : words[cursor + cut.narrStartIdx].start;
    placed.push({
      e, cut, aAbs, bAbs, narrStart,
      contentStart: words[aAbs].start, contentEnd: words[bAbs - 1].end,
    });
    cursor = bAbs;
  }
  return placed;
}

/** 能量探针：把 [from, to] 解成 8kHz 单声道 PCM，按 20ms 分箱取峰值 dBFS（头尾定界共用一次解码）。 */
async function energyProbes(file, from, to) {
  if (!(to > from)) return [];
  const r = await run("ffmpeg", ["-nostdin", "-v", "error", "-i", file,
    "-af", `atrim=start=${round3(from)}:end=${round3(to)},aresample=8000`,
    "-ac", "1", "-f", "s16le", "-"], { binary: true });
  const buf = r.out;
  const probes = [];
  const binSamples = 8000 * 0.02;
  for (let i = 0; i < buf.length / 2; i += binSamples) {
    let peak = 0;
    for (let k = i; k < Math.min(i + binSamples, buf.length / 2); k++) {
      const v = Math.abs(buf.readInt16LE(k * 2));
      if (v > peak) peak = v;
    }
    probes.push({
      t: round3(from + (i / 8000)),
      db: peak === 0 ? -91 : Math.round(20 * Math.log10(peak / 32768) * 10) / 10,
    });
  }
  return probes;
}

const LOUDNORM = "I=-16:TP=-1.5:LRA=11";
/**
 * 真峰限制器，挂在 loudnorm 后面兜底。两个坑叠在一起，缺一个都会削波：
 *
 * ① loudnorm 的 `linear=true`（我们用的两遍模式）只套一个恒定增益、**不带限制器**，
 *    TP 参数形同虚设 —— 实测旁白 TTS 原始峰值 −15.3 dBFS，归一化到 −16 LUFS 要 +15 dB，
 *    出来峰值直接顶到 −0.2 dBFS。
 * ② **64 kbps 单声道 mp3 解码会过冲 ~1.5 dB**（实测：编码前 −1.5 dBFS 的 wav，
 *    64k mp3 解出来 0.0 dB；同一份 128k 只到 −1.9 dB）。所以限制器不能只压到
 *    TP 目标 −1.5，得再让出一档。
 *
 * 0.7079 = 10^(−3/20)：编码前压到 −3 dBFS，64k 过冲后落在 −1.3 dBFS。
 * 只削瞬时峰，积分响度仍是 −16 LUFS（实测 −16.5）。
 */
const PEAK_LIMIT = "alimiter=limit=0.7079:level=false";

/** 跑一遍 loudnorm 测量（`-f null`），拿到 input_i 与 measured_*（供第二遍线性归一化用）。 */
async function measureLoudness(file, trim) {
  const af = [trim, "asetpts=N/SR/TB", `loudnorm=${LOUDNORM}:print_format=json`]
    .filter(Boolean).join(",");
  // loudnorm 的 JSON 只在 info 级打印，所以这一条不能用 -v error；
  // stderr 全部捕获在进程内、不落终端，等价于静默。其余 ffmpeg 调用一律 -v error。
  const r = await run("ffmpeg", ["-nostdin", "-hide_banner", "-nostats", "-v", "info",
    "-i", file, "-af", af, "-f", "null", "-"]);
  const m = /\{[^{}]*"input_i"[\s\S]*?\}/.exec(r.err || "");
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return {
      input_i: parseFloat(j.input_i), input_tp: parseFloat(j.input_tp),
      input_lra: parseFloat(j.input_lra), input_thresh: parseFloat(j.input_thresh),
      target_offset: parseFloat(j.target_offset),
    };
  } catch { return null; }
}

/** 把测量结果变成第二遍 loudnorm 的线性参数（短片段也能精确落到 −16 LUFS）。 */
function loudnormApply(m) {
  if (!m || ![m.input_i, m.input_tp, m.input_lra, m.input_thresh].every(Number.isFinite)
      || m.input_i <= -70) {
    return `loudnorm=${LOUDNORM}`;                       // 测不出来就退回单遍动态模式
  }
  return `loudnorm=${LOUDNORM}:linear=true:measured_I=${m.input_i}:measured_TP=${m.input_tp}`
    + `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}`
    + (Number.isFinite(m.target_offset) ? `:offset=${m.target_offset}` : "");
}

/**
 * 切片 + 旁白 + 响度统一 + 淡入淡出 → mp3 单声道 64k CBR 44.1kHz。
 *
 * 成品结构：`0.3s 静音 | 旁白 | 静音(补到旁白末词→正文首词 2.4s) | 正文切片`。
 * 旁白在缓存阶段已经单独归一化到 −16 LUFS、并裁掉了首尾静音；正文这里走**两遍**
 * loudnorm（先测再线性套用），两段都精确落在 −16，拼起来不会「旁白炸耳」。
 * lcr 没有旁白（narrationFile 为空）时就是单段，与原来完全一致。
 */
async function renderSlice(file, start, end, out, opt = {}) {
  const bodyDur = round3(end - start);
  const trim = `atrim=start=${round3(start)}:end=${round3(end)}`;
  const measured = await measureLoudness(file, trim);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const narrationFile = opt.narrationFile || null;
  // 正文切片自己带 headPad，所以插入的静音 = 2.4s − 已有的那段留白。
  const gap = narrationFile
    ? Math.max(0.1, round3(OA.DEFAULTS.narrationGapSec - Math.max(0, (opt.headPad ?? 0))))
    : 0;
  const pre = narrationFile ? OA.DEFAULTS.narrationPreRollSec : 0;

  let args;
  let totalDur;
  if (!narrationFile) {
    totalDur = bodyDur;
    const fadeOut = Math.max(0, round3(totalDur - 0.02));
    args = ["-nostdin", "-y", "-hide_banner", "-nostats", "-v", "error", "-i", file,
      "-af", [trim, "asetpts=N/SR/TB", loudnormApply(measured), PEAK_LIMIT, "aresample=44100",
        "afade=t=in:st=0:d=0.02", `afade=t=out:st=${fadeOut}:d=0.02`].join(","),
      "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "64k", out];
  } else {
    const narrDur = opt.narrationDurationSec || 0;
    totalDur = round3(pre + narrDur + gap + bodyDur);
    const fadeOut = Math.max(0, round3(totalDur - 0.02));
    const graph = [
      `anullsrc=r=44100:cl=mono,atrim=0:${pre},asetpts=N/SR/TB[pre]`,
      "[0:a]aresample=44100,aformat=channel_layouts=mono[narr]",
      `anullsrc=r=44100:cl=mono,atrim=0:${gap},asetpts=N/SR/TB[gap]`,
      `[1:a]${trim},asetpts=N/SR/TB,${loudnormApply(measured)},${PEAK_LIMIT},aresample=44100,aformat=channel_layouts=mono[body]`,
      "[pre][narr][gap][body]concat=n=4:v=0:a=1[cat]",
      `[cat]afade=t=in:st=0:d=0.02,afade=t=out:st=${fadeOut}:d=0.02[out]`,
    ].join(";");
    args = ["-nostdin", "-y", "-hide_banner", "-nostats", "-v", "error",
      "-i", narrationFile, "-i", file, "-filter_complex", graph, "-map", "[out]",
      "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "64k", out];
  }
  const r = await run("ffmpeg", args);
  return {
    ok: r.code === 0 && fs.existsSync(out),
    lufsIn: measured ? measured.input_i : null,
    gap, totalDur,
    err: String(r.err || "").slice(-400),
  };
}

/* ── 旁白合成（gpt-4o-mini-tts，按句子文本去重缓存） ──────────────────────── */

// 播音员音色：toneDirector 的 voiceFor() 只从 SAFE_VOICES.female/male 里取
// （nova / echo / coral / ash，撞色回退也只在同性别表里走），中性表里的 sage
// 一定不会被任何 lc 角色用到 —— 旁白与对话里的人同声是最刺耳的穿帮。
const NARRATOR_VOICE = "sage";
const NARRATOR_INSTRUCTIONS = "You are the exam narrator for a standardized English listening test. "
  + "Read the single framing sentence in a neutral, clear, unhurried voice. "
  + "No emotion, no emphasis, no rising interest — steady announcer delivery, "
  + "standard American English, slightly slower than conversational pace.";
// 60 来句、不到 1000 词，按 docs 的 ¥0.107/140 词口径 ≈ ¥1；超过这个数就停下。
const NARRATION_COST_CEILING_CNY = 3;
const CNY_PER_140_WORDS = 0.107;

function narrationCachePath(text) {
  return path.join(NARRATION_DIR, `${OA.sha1(text)}.mp3`);
}

/**
 * 合成 + 规整一句旁白：TTS → 裁掉首尾静音 → 两遍 loudnorm 到 −16 LUFS → mp3。
 * 裁静音是为了让「旁白末词 → 正文首词 = 2.4s」这条间隔说话算数（TTS 首尾自带的
 * 半秒静音不裁掉，实际间隔就会比 2.4s 大出一截、每条还不一样）。
 */
async function synthNarration(text) {
  const out = narrationCachePath(text);
  if (fs.existsSync(out)) return out;
  const { generateSpeech } = require("../../lib/tts/openaiTts.js");
  fs.mkdirSync(NARRATION_DIR, { recursive: true });
  const raw = out.replace(/\.mp3$/, ".raw.mp3");
  if (!fs.existsSync(raw)) {
    const buf = await generateSpeech(text, {
      voice: NARRATOR_VOICE, instructions: NARRATOR_INSTRUCTIONS, format: "mp3",
    });
    if (!buf || buf.length < 1000) throw new Error(`TTS 返回空音频（${buf ? buf.length : 0} 字节）`);
    fs.writeFileSync(raw, buf);
  }
  const dur = await ffprobeDuration(raw);
  const probes = await energyProbes(raw, 0, dur || 10);
  const loud = probes.filter((p) => p.db > OA.DEFAULTS.quietDb);
  if (!loud.length) throw new Error("合成出来的旁白整条是静音");
  const from = Math.max(0, loud[0].t - 0.03);
  const to = Math.min(dur || 10, loud[loud.length - 1].t + OA.DEFAULTS.binSec + 0.12);
  const trim = `atrim=start=${round3(from)}:end=${round3(to)}`;
  const measured = await measureLoudness(raw, trim);
  const r = await run("ffmpeg", ["-nostdin", "-y", "-hide_banner", "-nostats", "-v", "error",
    "-i", raw, "-af", [trim, "asetpts=N/SR/TB", loudnormApply(measured), PEAK_LIMIT, "aresample=44100"].join(","),
    "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "64k", out]);
  if (r.code !== 0 || !fs.existsSync(out)) throw new Error(`旁白后处理失败：${String(r.err).slice(-200)}`);
  return out;
}

/**
 * 实测表里没有的条目，现场从词级缓存里把旁白原句捞回来。
 *
 * narration_survey.json 是按**过闸的**切片抄的，没过闸的（以及后来才补进来的）条目
 * 一个都不在里面 —— 只认那张表的话，这些条目全部退成通用句
 * （"Listen to a talk."），可 la/lat 的旁白是带场景的，丢了场景就丢了真考的信息。
 * 逐题 mp3 直接在整条里找；第一来源按 structured 的 span 起点附近找。
 */
function recoverNarrationRaw(e) {
  const wd = loadWords(e.wordsPath);
  if (!wd || !Array.isArray(wd.words) || !wd.words.length) return null;
  let lo = 0;
  let hi = wd.words.length;
  if (e.source === "first") {
    const t0 = Array.isArray(e.span) ? e.span[0] : null;
    if (t0 == null) return null;
    lo = wd.words.findIndex((w) => w.end >= t0 - 6);
    if (lo < 0) lo = 0;
    const h = wd.words.findIndex((w) => w.start > t0 + 12);
    hi = h < 0 ? wd.words.length : h;
  }
  const n = OA.findNarration(wd.words, lo, hi);
  return n ? wd.words.slice(n.start, n.end).map((w) => w.w).join(" ") : null;
}

/** 旁白原句实测表（narration_survey.json：[id, type, 旁白原句, 间隔秒]）→ Map(id → 原句)。 */
function loadNarrationSurvey() {
  const p = path.join(SLICE_DIR, "narration_survey.json");
  const m = new Map();
  if (!fs.existsSync(p)) return m;
  try {
    for (const row of JSON.parse(fs.readFileSync(p, "utf8"))) {
      if (Array.isArray(row) && row[0] && row[2]) m.set(row[0], row[2]);
    }
  } catch { /* 读不了就全用通用句 */ }
  return m;
}

/**
 * 把一批 {id, type, narrationText} 的旁白合成齐（按文本去重）。
 * 先报「去重后句数 + 预估费用」，超护栏就抛错停下，绝不闷头烧钱。
 */
async function ensureNarrations(texts, { dry }) {
  const uniq = [...new Set(texts.filter(Boolean))];
  const todo = uniq.filter((t) => !fs.existsSync(narrationCachePath(t)));
  // 花钱的只有「连 TTS 原始输出都没有」的那些：后处理（裁静音 / 响度 / 限峰）换判据时
  // 只删成品、留 .raw.mp3，重跑一分钱不花，估价不能把它们算进去。
  const paid = todo.filter((t) => !fs.existsSync(narrationCachePath(t).replace(/\.mp3$/, ".raw.mp3")));
  const words = paid.reduce((n, t) => n + t.trim().split(/\s+/).filter(Boolean).length, 0);
  const cost = (words / 140) * CNY_PER_140_WORDS;
  log(`\n■ 旁白合成：需要 ${uniq.length} 句（去重后），其中 ${todo.length} 句要出成品`
    + `（${paid.length} 句要真调 TTS / ${words} 口播词 / 预估 ≈ ${cost.toFixed(2)} 元，`
    + `口径 ${CNY_PER_140_WORDS} 元 per 140 词）`);
  if (dry) { log("  （--dry-run：未合成）"); return { uniq: uniq.length, todo: todo.length, words, cost, made: 0 }; }
  if (cost > NARRATION_COST_CEILING_CNY) {
    throw new Error(`旁白合成预估 ${cost.toFixed(2)} 元 超过护栏 ${NARRATION_COST_CEILING_CNY} 元 —— 已停下，先查是不是句子表异常`);
  }
  if (!todo.length) { log("  全部命中缓存，零花费"); return { uniq: uniq.length, todo: 0, words: 0, cost: 0, made: 0 }; }
  if (paid.length && !process.env.OPENAI_API_KEY) throw new Error("缺 OPENAI_API_KEY（.env.local 或环境变量）");
  let made = 0;
  for (const t of todo) {
    await synthNarration(t);
    made += 1;
    if (made % 10 === 0 || made === todo.length) log(`  已合成 ${made}/${todo.length}`);
  }
  log(`  旁白缓存 → ${path.relative(ROOT, NARRATION_DIR)}（音色 ${NARRATOR_VOICE}）`);
  return { uniq: uniq.length, todo: todo.length, words, cost, made };
}

/* ── 主流程 ──────────────────────────────────────────────────────────────── */

async function main() {
  const t0 = Date.now();
  loadEnv();                       // 旁白合成要 OPENAI_API_KEY，上传要 Supabase —— 一开始就读
  const { plan, skipped } = buildPlan();
  const nSel = plan.filter((e) => e.selected).length;
  log(`■ 计划：${nSel} 条听力题待评估（源料齐备）；${Object.keys(skipped).length} 条源料缺失`
    + (nSel === plan.length ? "" : `；另 ${plan.length - nSel} 条只参与定位不评估（--only/--ids 之外，但同 module 要用它们夹切点）`));

  const asrStat = await ensureWords(plan);

  // 源文件时长（越界闸要用）
  const durations = new Map();
  const distinctFiles = [...new Set(plan.map((e) => e.audioFile))];
  await pool(distinctFiles, CONCURRENCY, async (f) => { durations.set(f, await ffprobeDuration(f)); });
  log(`■ 源文件时长已探：${durations.size} 个`);

  /* 3a. 旁白：真考 lcr 没有旁白，lc/la/lat 有（见 original_audio.js 的 narrationTextFor）。
   * 切片时把源头那段旁白剥掉了，这里按实测原句自己配回来、再拼到正文前面。 */
  for (const e of plan) {
    if (e.type === "lcr") { e.narrationText = null; continue; }
    if (!e.narrationRaw) e.narrationRaw = recoverNarrationRaw(e);
    e.narrationText = OA.narrationTextFor(e.type, e.narrationRaw);
  }
  const narrStat = await ensureNarrations(
    plan.filter((e) => e.selected).map((e) => e.narrationText), { dry: DRY });
  for (const e of plan) {
    if (!e.narrationText) continue;
    const p = narrationCachePath(e.narrationText);
    e.narrationFile = fs.existsSync(p) ? p : null;
  }
  const narrDur = new Map();
  for (const f of new Set(plan.map((e) => e.narrationFile).filter(Boolean))) {
    narrDur.set(f, await ffprobeDuration(f));
  }
  for (const e of plan) if (e.narrationFile) e.narrationDurationSec = narrDur.get(e.narrationFile) || 0;

  /* 3b. 定位 */
  const located = locateAll(plan, durations);

  /* 3c. 尾巴裁剪 + 过闸 + 切片 */
  let results = await evaluateAll(located);

  /* 3c. 无 VAD 重转写补救。faster-whisper 开着 VAD 时，短 mp3（逐题 lcr 的前后各有
   * 好几秒静音 + 计时音）偶尔会把词级时间戳错位到静音里 —— 实测 rf0610 q12
   * "How[0-0.94] can[5.93-6.67]"，一句七个词被摊成 8.6s，词速闸判 49 WPM。
   * 症状唯一（词速过低 / 定位失败），所以只给**已经没过闸**的那几条关掉 VAD 重跑一次。 */
  const RETRYABLE = new Set(["wpm_out_of_range", "locate_failed", "anchor_mismatch", "tail_not_clean"]);
  const retry = results.filter((r) => !r.pass && r.source !== "first"
    && r.reasons.some((x) => RETRYABLE.has(x)));
  if (retry.length) {
    const byId = new Map(plan.map((e) => [e.id, e]));
    const jobs = new Map();
    for (const r of retry) {
      const e = byId.get(r.id);
      if (!e) continue;
      e.novadPath = e.wordsPath.replace(/\.json$/, ".novad.json");
      jobs.set(e.novadPath, { audio: e.audioFile, out: e.novadPath, no_vad: true });
    }
    log(`\n■ 无 VAD 重转写补救：${retry.length} 条没过闸 → ${jobs.size} 个音频重跑`);
    await runAsrWords([...jobs.values()]);
    const redo = [];
    for (const r of retry) {
      const e = byId.get(r.id);
      if (!e || !fs.existsSync(e.novadPath)) continue;
      e.wordsPath = e.novadPath;
      redo.push(e);
    }
    const redone = await evaluateAll(locateAll(redo, durations));
    const fixed = new Map(redone.filter((r) => r.pass).map((r) => [r.id, r]));
    results = results.map((r) => (fixed.has(r.id) ? { ...fixed.get(r.id), recovered_no_vad: true } : r));
    log(`  救回 ${fixed.size} 条`);
  }

  await report(plan, skipped, results, asrStat, narrStat, t0);
}

/** 定位：第一来源按 module 顺序单调定位；rf/rp 一题一文件整文件对齐。 */
function locateAll(plan, durations) {
  const located = [];
  const groups = new Map();
  for (const e of plan) {
    if (e.source !== "first") continue;
    const k = `${e.set}#${e.module}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const [, entries] of groups) {
    if (!entries.some((e) => e.selected)) continue;
    entries.sort((a, b) => a.qStart - b.qStart);
    const wd = loadWords(entries[0].wordsPath);
    if (!wd || !wd.words) { for (const e of entries) located.push({ e, fail: "asr_words_missing" }); continue; }
    const placed = locateFirstSource(entries, wd.words);
    for (let i = 0; i < placed.length; i++) {
      const cur = placed[i];
      if (!cur.cut.ok) { located.push({ e: cur.e, fail: cur.cut.reason, coverage: cur.cut.coverage }); continue; }
      // 天花板 = 下一组的旁白起点（没有旁白就用它的正文起点）；最后一组用文件时长。
      let nextStart = null;
      for (let j = i + 1; j < placed.length; j++) {
        if (!placed[j].cut.ok) continue;
        nextStart = placed[j].narrStart != null ? placed[j].narrStart : placed[j].contentStart;
        break;
      }
      // 地板 = 上一组的正文终点：lcr 十二句是背靠背念的（间隔 ~0.2s），
      // headPad 0.25s 不夹住就会把上一句的尾音削进来。
      let floor = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (!placed[j].cut.ok) continue;
        floor = placed[j].contentEnd + OA.DEFAULTS.decayFloor;
        break;
      }
      located.push({
        e: cur.e, words: wd.words, aAbs: cur.aAbs, bAbs: cur.bAbs,
        cut: cur.cut, nextStart, floor,
        fileDuration: durations.get(cur.e.audioFile) || wd.duration || null,
      });
    }
  }
  // rf/rp：一题一文件，整文件对齐
  for (const e of plan) {
    if (e.source === "first" || !e.selected) continue;
    const wd = loadWords(e.wordsPath);
    if (!wd || !wd.words) { located.push({ e, fail: "asr_words_missing" }); continue; }
    // 源 mp3 整条是静音（实测 rf0615 q05/q06/q11 三条 max_volume −91 dB，商家给了空文件）
    if (!wd.words.length) { located.push({ e, fail: "source_no_speech" }); continue; }
    const cut = OA.computeCut({
      words: wd.words, targetTokens: e.targetTokens,
      ceiling: durations.get(e.audioFile) || wd.duration || undefined,
      allowLeadIn: e.type !== "lcr",
    });
    if (!cut.ok) { located.push({ e, fail: cut.reason, coverage: cut.coverage }); continue; }
    located.push({
      e, words: wd.words, aAbs: cut.aIdx, bAbs: cut.bIdx, cut, nextStart: null,
      fileDuration: durations.get(e.audioFile) || wd.duration || null,
    });
  }
  return located;
}

async function evaluateAll(all) {
  const located = all.filter((L) => L.e.selected);
  const results = [];
  let n = 0;
  await pool(located, CONCURRENCY, async (L) => {
    n += 1;
    if (n % 50 === 0) log(`  切片进度 ${n}/${located.length}`);
    const e = L.e;
    const base = {
      id: e.id, type: e.type, set: e.set, source: e.source,
      source_file: path.basename(e.audioFile), words: e.words, text_sha1: e.textSha1,
    };
    // 上一轮跑出来的切片先删掉：这一轮没过闸却留着旧 mp3，报告与硬盘就对不上了。
    const out = path.join(SLICE_DIR, e.type, `${e.id}.mp3`);
    try { fs.rmSync(out, { force: true }); } catch { /* ignore */ }
    if (L.fail) { results.push({ ...base, pass: false, reasons: [L.fail], coverage: L.coverage ?? null }); return; }

    const cut = L.cut;
    const ceiling = Math.min(
      L.nextStart == null ? Infinity : L.nextStart - OA.DEFAULTS.nextGuard,
      L.fileDuration == null ? Infinity : L.fileDuration,
    );
    // 探到 contentEnd 之后 maxDecay + tailPad + 一点余量：既要找到真正的收声时刻，
    // 也要看清收声之后有没有计时音。
    const probeTo = Math.min(
      cut.contentEnd + OA.DEFAULTS.maxDecay + OA.DEFAULTS.tailPad + 0.1,
      ceiling, L.fileDuration == null ? Infinity : L.fileDuration);
    const rawStart = Math.max(0, cut.start, L.floor || 0);
    // 一次解码同时喂头尾两道定界（切片本身也就这么长，成本与只探尾巴一样）。
    const probes = await energyProbes(e.audioFile, rawStart, probeTo);
    const tail = OA.resolveTail({
      contentEnd: cut.contentEnd, probes, ceiling,
      atCeiling: Number.isFinite(ceiling) && probeTo >= ceiling - 0.01,
    });
    const end = Math.min(tail.end, ceiling);
    const head = OA.resolveHead({ start: rawStart, contentStart: cut.contentStart, probes });
    const start = head.start;
    const duration = round3(end - start);
    // 词速按**正文本身**的跨度算，不含头尾留白 —— lcr 只有 5 个词，
    // 0.75s 的留白就能把 107 WPM 冲淡到 84，把好条目误判成「念太慢」。
    const wpm = Math.round(OA.wpmOf(e.words, Math.max(0.01, tail.speechEnd - cut.contentStart)));
    const gate = OA.gateDecision({
      coverage: cut.coverage, matched: cut.matched, targetTokens: cut.targetTokens,
      wpm, start, end,
      nextStart: L.nextStart, fileDuration: L.fileDuration,
      tailClean: tail.ok,
    });
    const rec = {
      ...base, pass: gate.pass, reasons: gate.reasons,
      span_sec: [round3(start), round3(end)], duration_sec: duration,
      content_start: cut.contentStart, content_end: cut.contentEnd, speech_end: tail.speechEnd,
      coverage: Math.round(cut.coverage * 1000) / 1000,
      matched: cut.matched, target_tokens: cut.targetTokens,
      wpm, narration: cut.narration,
      head_trimmed: head.trimmed, head_offender_at: head.offenderAt,
      tail_trimmed: tail.trimmed, tail_at_file_end: !!tail.atFileEnd,
      tail_max_db: tail.maxDb == null ? null : tail.maxDb,
      tail_offender_at: tail.offenderAt == null ? null : round3(tail.offenderAt),
      next_start: L.nextStart == null ? null : round3(L.nextStart),
      file_duration: L.fileDuration == null ? null : round3(L.fileDuration),
    };
    if (!gate.pass) { results.push(rec); return; }

    const sl = await renderSlice(e.audioFile, start, end, out, {
      narrationFile: e.narrationFile || null,
      narrationDurationSec: e.narrationDurationSec || 0,
      headPad: round3(cut.contentStart - start),
    });
    if (!sl.ok) {
      rec.pass = false; rec.reasons = ["ffmpeg_failed"]; rec.ffmpeg_err = sl.err;
      results.push(rec); return;
    }
    rec.lufs_in = sl.lufsIn;
    // 只有旁白真的拼进去了才记 —— --dry-run 不合成旁白，报告不许声称有。
    const hasNarr = !!(e.narrationFile && e.narrationText);
    rec.narration_text = hasNarr ? e.narrationText : null;
    rec.narration_source = hasNarr ? "tts" : null;
    rec.narration_gap_sec = hasNarr ? sl.gap + round3(cut.contentStart - start) : null;
    rec.clip_duration_sec = round3(sl.totalDur);
    rec.local_file = path.relative(ROOT, out).split(path.sep).join("/");
    rec.bytes = fs.statSync(out).size;
    results.push(rec);
  });
  return results;
}

/* ── 4. 报告 / 上传 / 回挂 ───────────────────────────────────────────────── */
async function report(plan, skipped, results, asrStat, narrStat, t0) {
  results.sort((a, b) => a.id.localeCompare(b.id));
  const reportDoc = {
    generated_at: new Date().toISOString(),
    dry_run: DRY,
    planned: plan.filter((e) => e.selected).length,
    source_missing: skipped,
    asr: { files: asrStat.total, transcribed: asrStat.done, elapsed_sec: Math.round(asrElapsed),
      model: process.env.REALBANK_WORDS_MODEL || "medium.en",
      cache_dir: path.relative(ROOT, WORDS_DIR).split(path.sep).join("/") },
    narration: { ...narrStat, voice: NARRATOR_VOICE, gap_sec: OA.DEFAULTS.narrationGapSec,
      pre_roll_sec: OA.DEFAULTS.narrationPreRollSec,
      cache_dir: path.relative(ROOT, NARRATION_DIR).split(path.sep).join("/") },
    results,
  };
  fs.mkdirSync(SLICE_DIR, { recursive: true });
  fs.writeFileSync(path.join(SLICE_DIR, "report.json"), JSON.stringify(reportDoc, null, 1), "utf8");

  const matrix = {};
  const cell = (k) => (matrix[k] = matrix[k] || { bank: 0, n: 0, pass: 0, reasons: {} });
  for (const e of plan) if (e.selected) cell(`${e.source}/${e.type}`).bank += 1;
  for (const [, s] of Object.entries(skipped)) if (s.type) cell(`?/${s.type}`).bank += 1;
  for (const r of results) {
    const m = cell(`${r.source}/${r.type}`);
    m.n += 1;
    if (r.pass) m.pass += 1;
    else for (const why of r.reasons) m.reasons[why] = (m.reasons[why] || 0) + 1;
  }
  log("\n■ 按来源 × 题型：题库条数 / 有原声可对 / 过闸 / 未过原因");
  for (const [k, v] of Object.entries(matrix).sort()) {
    log(`  ${k.padEnd(12)} 库 ${String(v.bank).padStart(3)}  可对 ${String(v.n).padStart(3)}  过闸 ${String(v.pass).padStart(3)}  ` +
      `${Object.keys(v.reasons).length ? JSON.stringify(v.reasons) : ""}`);
  }
  const passed = results.filter((r) => r.pass);
  log(`\n■ 合计：可对 ${results.length} / 过闸 ${passed.length} / 未过 ${results.length - passed.length}` +
    `；源料缺失 ${Object.keys(skipped).length}`);
  log(`  报告 → ${path.relative(ROOT, path.join(SLICE_DIR, "report.json"))}`);
  log(`  切片 → ${path.relative(ROOT, SLICE_DIR)}/<type>/<id>.mp3`);

  const narrated = passed.filter((r) => r.narration_text).length;
  log(`  其中 ${narrated} 条带旁白（lc/la/lat），${passed.length - narrated} 条无旁白（lcr，真考也没有）`);

  if (DRY) {
    log(`\n（--dry-run：未上传、未改 data/）  总用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    return;
  }

  /* 5. 上传 + 写清单 + 回挂 */
  const { uploadAudio, versionedAudioUrl } = require("../../lib/tts/storage.js");
  // 探针：一条最小上传先探通 Supabase，别在批量循环里才发现没接上。
  const probe = await withRetry(
    () => uploadAudio(`${STORAGE_PREFIX}/_preflight.mp3`, Buffer.from([0xff, 0xfb, 0x90, 0x00])),
    { label: "上传探针" });
  if (!probe || String(probe.url || "").startsWith("/")) {
    throw new Error("Supabase 没接上（uploadAudio 退回本地路径）—— 已停下，未写清单。"
      + "需要 NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  }
  log(`\n■ 上传探针通了 → ${probe.url.slice(0, 90)}…`);
  // 已有清单先读进来：--only / --set 的增量跑不能把上一轮传过的条目抹掉。
  let manifest = { entries: {}, skipped: {} };
  if (fs.existsSync(MANIFEST)) {
    try { manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { /* 坏了就重建 */ }
  }
  manifest._purpose = "真题听力原声切片清单：build_bank.mjs 重建时按 text_sha1 回挂 audio_url（见 scripts/realbank/original_audio.js）";
  manifest.generated_at = new Date().toISOString();
  manifest.entries = manifest.entries || {};
  manifest.skipped = manifest.skipped || {};
  let up = 0;
  let upFail = 0;
  for (const r of passed) {
    let url;
    try {
      const buf = fs.readFileSync(path.join(ROOT, r.local_file));
      ({ url } = await withRetry(() => uploadAudio(`${STORAGE_PREFIX}/${r.type}/${r.id}.mp3`, buf),
        { label: "上传" }));
    } catch (err) {
      upFail += 1; log(`  ✗ ${r.id}: ${String(err && err.message).slice(0, 120)}`); continue;
    }
    if (String(url || "").startsWith("/")) { upFail += 1; log(`  ✗ ${r.id}: 上传退回本地路径（Supabase 没接上）`); continue; }
    manifest.entries[r.id] = {
      url: versionedAudioUrl(url), source: r.source, set: r.set, source_file: r.source_file,
      span_sec: r.span_sec, duration_sec: r.duration_sec, text_sha1: r.text_sha1,
      coverage: r.coverage, wpm: r.wpm, lufs_in: r.lufs_in,
      narration_text: r.narration_text || null,
      narration_source: r.narration_source || null,
      narration_gap_sec: r.narration_gap_sec == null ? null : r.narration_gap_sec,
      clip_duration_sec: r.clip_duration_sec == null ? r.duration_sec : r.clip_duration_sec,
      verified: true, on: new Date().toISOString().slice(0, 10),
    };
    delete manifest.skipped[r.id];
    up += 1;
    if (up % 50 === 0) log(`  已上传 ${up}/${passed.length}`);
  }
  if (upFail) log(`  ⚠ ${upFail} 条上传失败，未进清单（保持 TTS）`);
  for (const r of results) {
    if (r.pass) continue;
    manifest.skipped[r.id] = { reason: r.reasons.join(","), coverage: r.coverage ?? null };
    delete manifest.entries[r.id];      // 上一轮过闸、这一轮不过 → 清单里不该再留着
  }
  for (const [id, s] of Object.entries(skipped)) { manifest.skipped[id] = { reason: s.reason }; delete manifest.entries[id]; }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  log(`\n■ 清单 → ${path.relative(ROOT, MANIFEST)}（${up} 条原声 / ${Object.keys(manifest.skipped).length} 条保持 TTS）`);

  const bundle = {};
  for (const t of TYPES) {
    const p = path.join(LISTENING_DIR, `${t}.json`);
    if (fs.existsSync(p)) bundle[t] = JSON.parse(fs.readFileSync(p, "utf8"));
  }
  const mounted = OA.applyOriginalAudio(
    Object.fromEntries(Object.entries(bundle).map(([k, v]) => [k, v.items || []])),
    manifest, spokenFingerprint);
  for (const [t, b] of Object.entries(bundle)) {
    // 落盘格式必须与 build_bank.mjs 逐字节一致（JSON.stringify(…, null, 2)，无尾换行），
    // 否则「重建前后文件相同」这条验收会因为一个换行符假红。
    fs.writeFileSync(path.join(LISTENING_DIR, `${t}.json`), JSON.stringify(b, null, 2), "utf8");
  }
  log(`■ 回挂：${mounted.mounted} 条挂上原声；${mounted.mismatched.length} 条口播文本对不上（保持 TTS）`);

  await verifyUploads(manifest, passed);
  await narrateTtsFallbacks(plan, manifest, results, uploadAudio, versionedAudioUrl);
  log(`\n总用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

/** 上传核验：随机 10 条真拉一次，200 且字节数与本地切片一致。 */
async function verifyUploads(manifest, passed) {
  const ids = Object.keys(manifest.entries);
  const local = new Map(passed.map((r) => [r.id, r]));
  const pick = ids.filter((id) => local.has(id)).sort(() => Math.random() - 0.5).slice(0, 10);
  log(`\n■ 上传核验：随机抽 ${pick.length} 条真拉`);
  let ok = 0;
  for (const id of pick) {
    const e = manifest.entries[id];
    const want = local.get(id).bytes;
    try {
      const { status, buf } = await withRetry(async () => {
        const res = await fetch(e.url);
        return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
      }, { label: "核验拉取" });
      const res = { status };
      const good = res.status === 200 && buf.length === want;
      if (good) ok += 1;
      else log(`  ✗ ${id}: status ${res.status}, ${buf.length} 字节（本地 ${want}）`);
    } catch (err) {
      log(`  ✗ ${id}: ${String(err && err.message).slice(0, 120)}`);
    }
  }
  log(`  ${ok}/${pick.length} 条 200 且字节数一致`);
}

/**
 * TTS 兜底条目补旁白：真题专区里没绑上原声、仍是我们自己配的 lc/la/lat，
 * 把线上那条 mp3 拉下来、在前面接同一把嗓子念的旁白，再传回**同一路径**（换 ?v=）。
 *
 * 正文不重配（一个 token 都不花），只是在前面多接一段旁白 —— 与原声条目听起来是一套。
 * 这些条目**不进 original-audio.json**（它们不是原声），台账另记 tts-narration.json：
 * 靠 text_sha1 做幂等，重跑不会把旁白接两遍。
 */
async function narrateTtsFallbacks(plan, manifest, results, uploadAudio, versionedAudioUrl) {
  const planById = new Map((plan || []).map((e) => [e.id, e]));
  if (SKIP_TTS_NARRATION) { log("\n■ TTS 兜底补旁白：--skip-tts-narration，跳过"); return; }
  const survey = loadNarrationSurvey();
  let ledger = { entries: {} };
  if (fs.existsSync(TTS_NARRATION_LEDGER)) {
    try { ledger = JSON.parse(fs.readFileSync(TTS_NARRATION_LEDGER, "utf8")); } catch { /* 重建 */ }
  }
  ledger.entries = ledger.entries || {};

  const bundle = {};
  const jobs = [];
  for (const t of ["lc", "la", "lat"]) {
    const p = path.join(LISTENING_DIR, `${t}.json`);
    if (!fs.existsSync(p)) continue;
    bundle[t] = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const it of bundle[t].items || []) {
      if (manifest.entries[it.id]) continue;                     // 已是原声（自带旁白）
      if (it.audio_source === "original") continue;
      if (!/^https?:\/\//.test(String(it.audio_url || ""))) continue;  // 还没配音，交给 render_real_audio
      const sha = OA.sha1(spokenFingerprint(t, it));
      const prev = ledger.entries[it.id];
      const e = planById.get(it.id);
      const text = (e && e.narrationText)
        || OA.narrationTextFor(t, survey.get(it.id) || (e ? recoverNarrationRaw(e) : null));
      if (!text) continue;
      // 幂等键要带旁白文本：换了旁白（例如原句还原出来了）就得重做，不能被台账挡住
      if (!REDO_TTS_NARRATION && prev && prev.text_sha1 === sha
          && prev.url === it.audio_url && prev.narration_text === text) continue;
      jobs.push({ type: t, item: it, sha, text, prev, doc: bundle[t] });
    }
  }
  log(`\n■ TTS 兜底补旁白：${jobs.length} 条（lc/la/lat 里没绑上原声、已有 TTS 音频的）`);
  if (!jobs.length) return;

  await ensureNarrations(jobs.map((j) => j.text), { dry: false });
  const rows = [];
  let done = 0;
  let fail = 0;
  for (const j of jobs) {
    const tmpIn = path.join(SLICE_DIR, "_tts", `${j.item.id}.src.mp3`);
    const tmpOut = path.join(SLICE_DIR, "_tts", `${j.item.id}.mp3`);
    try {
      fs.mkdirSync(path.dirname(tmpIn), { recursive: true });
      // 本地留着的 .src.mp3 是**没加旁白**的正文，优先用它 —— 线上那条路径已经被
      // 上一轮的带旁白版本 upsert 覆盖了，再下载来拼一次就会把旁白念两遍。
      if (!fs.existsSync(tmpIn)) {
        if (j.prev) {
          throw new Error("台账说这条补过旁白，但本地没留未加旁白的正文 —— 拒绝二次拼接（会念两遍）");
        }
        const buf = await withRetry(async () => {
          const res = await fetch(j.item.audio_url);
          if (res.status !== 200) throw new Error(`下载 ${res.status}`);
          return Buffer.from(await res.arrayBuffer());
        }, { label: "下载现有 TTS" });
        fs.writeFileSync(tmpIn, buf);
      }
      const dur = await ffprobeDuration(tmpIn);
      if (!dur || dur < 0.5) throw new Error(`下载到的音频时长异常（${dur}）`);
      const nf = narrationCachePath(j.text);
      const sl = await renderSlice(tmpIn, 0, dur, tmpOut, {
        narrationFile: nf, narrationDurationSec: await ffprobeDuration(nf), headPad: 0,
      });
      if (!sl.ok) throw new Error(`ffmpeg 失败：${sl.err.slice(-160)}`);
      // 传回同一路径（upsert），换 ?v= 让 immutable 缓存失效
      const storagePath = storagePathOf(j.item.audio_url);
      if (!storagePath) throw new Error(`认不出存储路径：${j.item.audio_url.slice(0, 90)}`);
      const { url } = await withRetry(() => uploadAudio(storagePath, fs.readFileSync(tmpOut)),
        { label: "回传同路径" });
      if (String(url || "").startsWith("/")) throw new Error("上传退回本地路径");
      const newUrl = versionedAudioUrl(url);
      j.item.audio_url = newUrl;
      ledger.entries[j.item.id] = {
        url: newUrl, storage_path: storagePath, text_sha1: j.sha,
        narration_text: j.text, narration_source: "tts",
        narration_gap_sec: OA.DEFAULTS.narrationGapSec,
        clip_duration_sec: round3(sl.totalDur), on: new Date().toISOString().slice(0, 10),
      };
      rows.push({ id: j.item.id, type: j.type, narration_text: j.text,
        duration_sec: round3(sl.totalDur), local_file: path.relative(ROOT, tmpOut).split(path.sep).join("/") });
      done += 1;
      if (done % 10 === 0) log(`  已补 ${done}/${jobs.length}`);
    } catch (err) {
      fail += 1;
      log(`  ✗ ${j.item.id}: ${String(err && err.message).slice(0, 140)}`);
    }
  }
  for (const [t, doc] of Object.entries(bundle)) {
    fs.writeFileSync(path.join(LISTENING_DIR, `${t}.json`), JSON.stringify(doc, null, 2), "utf8");
  }
  ledger._purpose = "真题专区「TTS 兜底条目已补旁白」台账：这些条目不是原声（不进 original-audio.json），"
    + "但音频里已经接了旁白。靠 text_sha1 + url 做幂等，重跑不会把旁白接两遍。";
  ledger.generated_at = new Date().toISOString();
  fs.writeFileSync(TTS_NARRATION_LEDGER, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  log(`  完成 ${done} 条，失败 ${fail} 条；台账 → ${path.relative(ROOT, TTS_NARRATION_LEDGER)}`);
  fs.writeFileSync(path.join(SLICE_DIR, "tts-narration-report.json"), JSON.stringify(rows, null, 1), "utf8");
}

/** 从 Supabase 公开 URL（或 /api/audio 代理路径）还原出桶内存储路径。 */
function storagePathOf(url) {
  const m = /\/storage\/v1\/object\/public\/listening_audio\/([^?#]+)/.exec(String(url || ""));
  if (m) return decodeURIComponent(m[1]);
  const p = /^\/api\/audio\/([^?#]+)/.exec(String(url || ""));
  return p ? decodeURIComponent(p[1]) : null;
}

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(\w+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
    }
    break;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
