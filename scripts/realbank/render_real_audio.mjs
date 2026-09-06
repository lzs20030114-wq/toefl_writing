#!/usr/bin/env node
/**
 * 真题录入 —— 听力/口语配音。
 *
 * `build_bank.mjs` 落库时 `audio_url: null` + `audio_pending: true`：商家的 mp3 内嵌了
 * 作答静音、音色也不是我们这套（LC 男女声、LAT 教授腔…），而且不是我们能分发的素材。
 * 所以真题的音频**一律自己配**，走的是 live 库同一条链路：
 *
 *   toneDirector（角色 → persona/性别锁声）→ renderListening（逐句合成、问句升调、
 *   轮次间隔）→ mp3Encode → storage.uploadAudio（Supabase 桶 listening_audio）
 *
 * 与 live 库的唯一区别是存储路径前缀 `real/`，不会覆盖生成库的任何一条音频。
 *
 * 逐题型的口播内容：
 *   lcr        只念刺激句（选项不发音，与 live 库一致）
 *   lc         两人两声（speakers[].gender 锁声，toneDirector 保证不撞声）
 *   la / lat   单声（announcement / transcript 全文）
 *   repeat     每句一条
 *   interview  每题一条
 *
 * 用法:
 *   node scripts/realbank/render_real_audio.mjs --dry-run     # 只报条数/词数/预估费用
 *   node scripts/realbank/render_real_audio.mjs               # 真跑（先探通再批量）
 *   node scripts/realbank/render_real_audio.mjs --only=lcr,lc --limit=5
 *
 * 断点续跑：已有 audio_url 的直接跳过，可以随时 Ctrl-C 再跑。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { renderSingleSpeaker, renderConversation } = require("../../lib/tts/renderListening.js");
const { encodeWavToMp3 } = require("../../lib/tts/mp3Encode.js");
const { uploadAudio } = require("../../lib/tts/storage.js");

const ROOT = process.cwd();
const LISTENING_DIR = path.join(ROOT, "data", "realBank", "listening");
const SPEAKING_DIR = path.join(ROOT, "data", "realBank", "speaking");

// 成本口径与 docs/ 的出题成本模型一致：¥0.107 / 140 口播词。
const CNY_PER_140_WORDS = 0.107;
// 预估超过这个数就停下汇报，不许闷头烧钱（8 套预期 ¥8~20）。
const COST_CEILING_CNY = 30;

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

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run") || argv.includes("--dry");
const ONLY = (argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
const ONLY_SET = ONLY ? new Set(ONLY.split(",")) : null;
const LIMIT_RAW = (argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1];
const LIMIT = LIMIT_RAW ? (parseInt(LIMIT_RAW, 10) || 0) : Infinity;
const YES = argv.includes("--yes");

const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const save = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n", "utf8");

/**
 * 待配音清单。每条 = 一次「合成 + 上传 + 回写」的工作单元。
 * spokenWords 只数**真正会被念出来的词**（LCR 的四个选项不算），费用才是真的。
 */
function planListening(type) {
  const p = path.join(LISTENING_DIR, `${type}.json`);
  if (!fs.existsSync(p)) return [];
  const bank = load(p);
  const jobs = [];
  for (const it of bank.items || []) {
    if (it.audio_url) continue;
    let words = 0;
    if (type === "lc") words = (it.conversation || []).reduce((n, t) => n + wc(t.text), 0);
    else if (type === "la") words = wc(it.announcement);
    else if (type === "lat") words = wc(it.transcript);
    else words = wc(it.speaker);
    if (!words) continue;
    jobs.push({
      file: p, bank, type, id: it.id, words,
      render: () => (type === "lc" ? renderConversation(it) : renderSingleSpeaker(it, type)),
      assign: (url) => { it.audio_url = url; delete it.audio_pending; },
    });
  }
  return jobs;
}

/** repeat / interview：每句 / 每题各一条音频；用 lcr 的单人链路，角色决定音色。 */
function planSpeaking(kind) {
  const p = path.join(SPEAKING_DIR, `${kind}.json`);
  if (!fs.existsSync(p)) return [];
  const bank = load(p);
  const jobs = [];
  for (const set of bank.items || []) {
    const list = kind === "repeat" ? (set.sentences || []) : (set.questions || []);
    for (const unit of list) {
      if (unit.audio_url) continue;
      const text = kind === "repeat" ? unit.sentence : unit.question;
      if (!wc(text)) continue;
      // derivePersona 走 lcr 的单人路径：id 决定性别（同一 id 每次都是同一把嗓子），
      // context 决定 AUTHORITY/PEER 分桶 —— 复述的说话人是场馆/图书馆工作人员，
      // 面试的说话人是研究协调员，两者都该落在 AUTHORITY 桶。
      const pseudo = {
        id: unit.id,
        speaker: text,
        context: kind === "repeat" ? (set.speaker_role || "staff") : "research coordinator",
      };
      jobs.push({
        file: p, bank, type: kind, id: unit.id, words: wc(text),
        render: () => renderSingleSpeaker(pseudo, "lcr"),
        assign: (url) => { unit.audio_url = url; delete unit.audio_pending; },
      });
    }
  }
  return jobs;
}

async function preflight() {
  // 一条最小请求同时探 OpenAI 与 Supabase。任一不通就停下，不进批量循环。
  const wav = await renderSingleSpeaker(
    { id: "real_preflight", speaker: "This is a connection test.", context: "staff" }, "lcr");
  const mp3 = await encodeWavToMp3(wav);
  const res = await uploadAudio("real/_preflight.mp3", mp3);
  if (res.local === true || String(res.url || "").startsWith("/")) {
    throw new Error(`Supabase 没接上：uploadAudio 退回了本地路径 ${res.url}`
      + `（需要 NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY）`);
  }
  return res.url;
}

async function main() {
  loadEnv();
  const types = ["lcr", "lc", "la", "lat"].filter((t) => !ONLY_SET || ONLY_SET.has(t));
  const kinds = ["repeat", "interview"].filter((t) => !ONLY_SET || ONLY_SET.has(t));
  const jobs = [...types.flatMap(planListening), ...kinds.flatMap(planSpeaking)];

  const byType = {};
  for (const j of jobs) {
    byType[j.type] = byType[j.type] || { n: 0, words: 0 };
    byType[j.type].n += 1;
    byType[j.type].words += j.words;
  }
  const totalWords = jobs.reduce((n, j) => n + j.words, 0);
  const cost = (totalWords / 140) * CNY_PER_140_WORDS;
  console.log("■ 真题听力/口语配音");
  for (const [t, v] of Object.entries(byType)) console.log(`  ${t}: ${v.n} 条 / ${v.words} 口播词`);
  console.log(`  合计 ${jobs.length} 条 / ${totalWords} 口播词 / 预估 ≈ ${cost.toFixed(2)} 元`
    + `（口径：${CNY_PER_140_WORDS} 元 per 140 词）`);

  if (!jobs.length) { console.log("  没有待配音的条目（都已有 audio_url）"); return; }
  if (cost > COST_CEILING_CNY && !YES) {
    console.error(`\n✗ 预估 ${cost.toFixed(2)} 元 超过护栏 ${COST_CEILING_CNY} 元 —— 已停下。`
      + `\n  这远高于 8 套的预期区间（8~20 元），先查是不是重复条目/文本异常长，`
      + `\n  确认无误再加 --yes 跑。`);
    process.exit(2);
  }
  if (DRY) { console.log("\n（--dry-run，未合成任何音频）"); return; }

  if (!process.env.OPENAI_API_KEY) {
    console.error("✗ 缺 OPENAI_API_KEY（.env.local 或环境变量）"); process.exit(1);
  }

  console.log("\n探通中（1 条最小请求）…");
  let probe;
  try {
    probe = await preflight();
  } catch (e) {
    console.error(`✗ 探通失败，已停下（不做重试循环）：${String(e && e.message).slice(0, 200)}`);
    console.error("  本机直连 OpenAI 可能需要 HTTPS_PROXY / OPENAI_PROXY_URL=http://127.0.0.1:10808");
    process.exit(1);
  }
  console.log(`  ✓ OpenAI + Supabase 都通了 → ${probe}\n`);

  let done = 0, fail = 0, budget = LIMIT;
  const dirty = new Map();
  for (const j of jobs) {
    if (budget <= 0) break;
    try {
      const wav = await j.render();
      const mp3 = await encodeWavToMp3(wav);
      const { url } = await uploadAudio(`real/${j.type}/${j.id}.mp3`, mp3);
      if (String(url || "").startsWith("/")) throw new Error("上传退回本地路径");
      j.assign(url);
      dirty.set(j.file, j.bank);
      done += 1; budget -= 1;
      // 每条都落盘：中途断了也不丢已经花过钱的音频（断点续跑靠 audio_url 判定）。
      save(j.file, j.bank);
      process.stdout.write(`\r  已配 ${done}/${jobs.length}   `);
    } catch (e) {
      fail += 1;
      console.log(`\n  ✗ ${j.id}: ${String(e && e.message).slice(0, 120)}`);
    }
  }
  process.stdout.write("\n");
  for (const [f, b] of dirty) save(f, b);
  console.log(`\n完成：新配 ${done} 条，失败 ${fail} 条。`);
}

main().catch((e) => { console.error(e); process.exit(1); });
