#!/usr/bin/env node
/**
 * 数字卷「整块录音」听力 —— 批量铺量驱动：一批卷串行跑完整条链，钱和耗时逐套记账。
 *
 * 单套链路（2026-09-16 3.16 pilot 定型，见 scripts/realbank/merge_recording_asr.py 头注），按**卷名顺序**跑：
 *   ① merge_recording_asr.py --plan-structure   本机转写 + 查重，列出值得送结构化的题块（零 API）
 *   ② structure_set.mjs --sections listening --merge --keys …
 *        只送计划里、且产物里还没有 ok 的块（DeepSeek）。用 --merge 不用 --only-failed：
 *        合流过的卷在 --only-failed 眼里整科「归合流所有」，一块都不会重扫（failure_policy.isMergeOwned）。
 *   ③ merge_recording_asr.py                     录音分段 + 屏幕题面合流（零 API）
 *   ④ audit_answers.mjs --section=listening --only-missing   只审新题（DeepSeek）
 * 整批跑完再落库一次：
 *   ⑤ 所有录音卷按卷名顺序重合流一遍（零 API）—— 查重的保留方先后规则要看到全部已合流的卷才稳定
 *   ⑥ build_bank --only-audio --keep-unbound-recording   先让新题进库（bind 按库里条目做计划）
 *   ⑦ bind_original_audio --ids=… --cached-narration-only
 *        只切「原声清单里没有 / 口播文本变了」的整块录音条目（零 TTS），不整库重传
 *   ⑧ build_bank --only-audio                     没挂上原声的整块录音题不收
 *   ⑨ assemble_sets → loss_ledger --dry-run       对账：全库槽位涨了多少
 *
 * 钱：每套开跑前按待结构化块数预估（结构化 ¥0.014/块 + 盲审 ¥0.002/块），加上已花的超过 --budget 就停。
 * 实花从 .ops/deepseek-usage.jsonl 本进程启动后新增的行里算（同一台机器别的会话同时调 DeepSeek 会被算进来 ——
 * 宁可高估）。逐套明细追加到 .codex-tmp/realbank/logs/recording-batch.jsonl。
 *
 * 用法：
 *   node scripts/realbank/recording_batch.mjs --sets "3.18新托福真题,3.17新托福真题" --spent 0.73 --budget 30
 *   … --no-land      只跑 ①~④，不落库
 *   … --land-only    只跑 ⑤~⑨
 * 退出码：0 正常；2 用法错误；3 系统性 API 失败 / 预算用尽（批次中途停下，已跑完的卷照常落库）。
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const OA = require("./original_audio.js");

const ROOT = process.cwd();
const TMP = path.join(ROOT, ".codex-tmp", "realbank");
const LEDGER = path.join(ROOT, ".ops", "deepseek-usage.jsonl");
const LOG_DIR = path.join(TMP, "logs");
const LISTENING_DIR = path.join(ROOT, "data", "realBank", "listening");
const MERGER = "merge_recording_asr-v1";
const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SETS = [...new Set(String(val("--sets", "")).split(",").map((s) => s.trim()).filter(Boolean))].sort();
const BUDGET = Number(val("--budget", "30"));
const SPENT_BEFORE = Number(val("--spent", "0"));
const PY = process.env.REALBANK_PY || "python";
const NO_LAND = argv.includes("--no-land");
const LAND_ONLY = argv.includes("--land-only");
const CNY_PER_MTOK = Number(process.env.DEEPSEEK_CNY_PER_MTOK || 5.24);
const EST_PER_BLOCK = 0.014;
const EST_PER_AUDIT = 0.002;

if (!SETS.length && !LAND_ONLY) {
  console.error('用法: node scripts/realbank/recording_batch.mjs --sets "卷1,卷2" [--spent ¥] [--budget ¥] [--no-land | --land-only]');
  process.exit(2);
}

const readJson = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } };
const ledgerLines = () => { try { return fs.readFileSync(LEDGER, "utf8").split(/\n/).filter(Boolean); } catch { return []; } };
const START_LINE = ledgerLines().length;
const spentSinceStart = () => ledgerLines().slice(START_LINE).reduce((n, l) => {
  try { const r = JSON.parse(l); return n + ((r.prompt_tokens || 0) + (r.completion_tokens || 0)) * CNY_PER_MTOK / 1e6; } catch { return n; }
}, 0);

fs.mkdirSync(LOG_DIR, { recursive: true });
const runLog = path.join(LOG_DIR, `recording-batch-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
function step(label, cmd, args) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" } });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  fs.appendFileSync(runLog, `\n===== ${label} :: ${cmd} ${args.join(" ")}\n${out}\n[exit ${r.status}]\n`, "utf8");
  return { status: r.status, out, sec: Math.round((Date.now() - t0) / 1000) };
}
const tail = (out, n = 3) => out.trim().split(/\r?\n/).filter((l) => !/进度\s*\d/.test(l)).slice(-n).map((l) => `     ${l}`).join("\n");
const ledgerSlots = () => {
  const m = /全库槽位\s+(\d+)\/(\d+)/.exec(step("ledger", process.execPath, ["scripts/realbank/loss_ledger.mjs", "--dry-run"]).out);
  return m ? Number(m[1]) : null;
};

/** 已被整块录音合流过的卷（按卷名排序）。 */
function recordingSets() {
  return fs.readdirSync(TMP).filter((f) => f.endsWith(".structured.json")).sort()
    .map((f) => ({ set: f.replace(/\.structured\.json$/, ""), st: readJson(path.join(TMP, f), {}) }))
    .filter((x) => x.st && x.st.merged_asr && x.st.merged_asr.merger === MERGER);
}

/** build_bank.mjs spokenText 的同一份口播指纹（原声清单 text_sha1 按它算）。 */
function spokenText(kind, it) {
  if (kind === "lcr") return String(it.speaker || "");
  if (kind === "la") return String(it.announcement || "");
  if (kind === "lat") return String(it.transcript || "");
  const roster = (it.speakers || []).map((s) => `${s.name}/${s.gender}`).join(",");
  const lines = (it.conversation || []).map((t) => `${t.speaker}: ${t.text}`).join(" / ");
  return `${roster} || ${lines}`;
}

/** 库里整块录音来源、原声清单里没有或口播指纹对不上的条目 id。 */
function unboundRecordingIds(recSetNames) {
  const manifest = readJson(path.join(LISTENING_DIR, "original-audio.json"), { entries: {} }).entries || {};
  const ids = [];
  for (const kind of ["lcr", "lc", "la", "lat"]) {
    for (const it of readJson(path.join(LISTENING_DIR, `${kind}.json`), { items: [] }).items || []) {
      if (!recSetNames.has(String(it.source || ""))) continue;
      const e = manifest[it.id];
      if (!e || e.text_sha1 !== OA.sha1(spokenText(kind, it))) ids.push(it.id);
    }
  }
  return ids;
}

console.log(`■ 整块录音听力批次：${SETS.length} 套（按卷名顺序）· 预算 ¥${BUDGET}（启动前已花 ¥${SPENT_BEFORE.toFixed(2)}）`
  + ` · 明细日志 ${path.relative(ROOT, runLog)}`);
const slotsBefore = ledgerSlots();
console.log(`  起点：全库槽位 ${slotsBefore}`);
const done = [];
let stopped = null;

if (!LAND_ONLY) {
  for (const set of SETS) {
    const t0 = Date.now();
    const spent0 = spentSinceStart();
    const plan = step(`plan ${set}`, PY, ["-X", "utf8", "scripts/realbank/merge_recording_asr.py", "--set", set, "--plan-structure"]);
    const planDoc = readJson(path.join(TMP, "asr-recording", set, "structure-plan.json"));
    if (plan.status !== 0 || !planDoc || !/要结构化/.test(plan.out)) {
      console.log(`  ✗ ${set}：计划没出来，跳过\n${tail(plan.out)}`);
      done.push({ set, skipped: "plan_failed", detail: tail(plan.out, 2).trim() });
      continue;
    }
    const base = readJson(path.join(TMP, `${set}.structured.fs_parsed.json`)) || readJson(path.join(TMP, `${set}.structured.json`), { results: [] });
    const haveOk = new Set((base.results || []).filter((r) => r.section === "listening" && r.status === "ok").map((r) => r.key));
    const todo = (planDoc.keys || []).filter((k) => !haveOk.has(k));
    const est = todo.length * (EST_PER_BLOCK + EST_PER_AUDIT);
    const spentNow = SPENT_BEFORE + spentSinceStart();
    if (spentNow + est > BUDGET) {
      stopped = `预算：已花 ¥${spentNow.toFixed(2)} + 本套预估 ¥${est.toFixed(2)} > ¥${BUDGET}`;
      console.log(`  ■ 停：${stopped}`);
      break;
    }
    console.log(`  · ${set}：计划 ${planDoc.keys.length}/${planDoc.screen_keys} 块、其中待结构化 ${todo.length}`
      + `（重复 ${planDoc.dup_groups.length} 组、坏 module ${planDoc.bad_modules.length}）预估 ¥${est.toFixed(2)}`);
    if (todo.length) {
      const ss = step(`structure ${set}`, process.execPath, ["scripts/realbank/structure_set.mjs", set, "--sections", "listening",
        "--merge", "--keys", todo.join(",")]);
      if (ss.status === 3) { stopped = `结构化系统性失败（${set}）`; console.log(`  ■ 停：${stopped}\n${tail(ss.out)}`); break; }
      console.log(`    结构化 ${ss.sec}s：${tail(ss.out, 1).trim()}`);
    }
    const mg = step(`merge ${set}`, PY, ["-X", "utf8", "scripts/realbank/merge_recording_asr.py", "--set", set]);
    const mline = (mg.out.match(/^\s+\S+：录音.*$/m) || [""])[0].trim();
    console.log(`    合流：${mline || tail(mg.out, 2).trim()}`);
    // ③′ 听力题号重排（零 API，幂等）。必须在盲审之前：重排会改题号+答案字母，审早了审的是错位的题。
    const rn = step(`renumber ${set}`, process.execPath, ["scripts/realbank/listening_renumber_run.mjs", set, "--write"]);
    const rnline = (rn.out.match(/✔ 写盘：[^\n]*/) || rn.out.match(/-- 无题可重排 --/) || [""])[0].trim();
    if (rnline) console.log(`    重排：${rnline}`);
    // --only-missing 要求既有 .audit.json；从没审过的卷（4.29 阅读只有填词，从来没生成过）就整科审
    const hasAudit = fs.existsSync(path.join(TMP, `${set}.audit.json`));
    const au = step(`audit ${set}`, process.execPath, ["scripts/realbank/audit_answers.mjs", set, "--section=listening",
      ...(hasAudit ? ["--only-missing"] : [])]);
    if (au.status === 3) { stopped = `盲审系统性失败（${set}）`; console.log(`  ■ 停：${stopped}\n${tail(au.out)}`); break; }
    const auditLine = ((au.out.match(/一致 \d+\/\d+ = [\d.]+%/) || [""])[0]) || ((au.out.match(/--only-missing：[^\n]*/) || [""])[0]) || tail(au.out, 1).trim();
    const cost = spentSinceStart() - spent0;
    const rec = { set, plan_keys: planDoc.keys.length, structured_now: todo.length, screen_keys: planDoc.screen_keys,
      dup_groups: planDoc.dup_groups.length, bad_modules: planDoc.bad_modules, merge: mline, audit: auditLine,
      cost_cny: Math.round(cost * 1000) / 1000, sec: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() };
    done.push(rec);
    fs.appendFileSync(path.join(LOG_DIR, "recording-batch.jsonl"), `${JSON.stringify(rec)}\n`, "utf8");
    console.log(`    盲审：${auditLine} · 本套 ¥${rec.cost_cny.toFixed(2)} · ${rec.sec}s · 累计 ¥${(SPENT_BEFORE + spentSinceStart()).toFixed(2)}`);
  }
}

if (!NO_LAND) {
  console.log("\n■ 落库");
  const recs = recordingSets();
  for (const { set } of recs) {
    const mg = step(`remerge ${set}`, PY, ["-X", "utf8", "scripts/realbank/merge_recording_asr.py", "--set", set]);
    if (mg.status !== 0) console.log(`  ⚠ 重合流 ${set} 失败：${tail(mg.out, 1).trim()}`);
    // 重合流把 structured 打回旧题号 → 同一份重排要再落一遍（签名相同，盲审明细不会被作废）。
    const rn = step(`renumber ${set}`, process.execPath, ["scripts/realbank/listening_renumber_run.mjs", set, "--write"]);
    if (rn.status !== 0) console.log(`  ⚠ 重排 ${set} 失败：${tail(rn.out, 1).trim()}`);
  }
  console.log(`  重合流 + 重排 ${recs.length} 套录音卷（按卷名顺序，查重先后稳定）`);
  const b1 = step("build keep-unbound", process.execPath, ["scripts/realbank/build_bank.mjs", "--only-audio", "--keep-unbound-recording"]);
  if (b1.status !== 0) { console.log(`  ✗ build_bank 失败\n${tail(b1.out, 6)}`); process.exit(1); }
  const ids = unboundRecordingIds(new Set(recs.map((x) => x.set)));
  if (ids.length) {
    const bind = step("bind", process.execPath, ["scripts/realbank/bind_original_audio.mjs", `--ids=${ids.join(",")}`, "--cached-narration-only"]);
    console.log(`  原声（${ids.length} 条待切）：${(bind.out.match(/■ 合计：[^\n]*/) || [""])[0]}  ${(bind.out.match(/■ 回挂：[^\n]*/) || [""])[0]}`);
    if (bind.status !== 0) console.log(`  ✗ bind_original_audio 失败（这些新题不会上线：下一步的 build 按清单拦）\n${tail(bind.out, 6)}`);
  } else {
    console.log("  原声：没有待切条目");
  }
  const b2 = step("build gated", process.execPath, ["scripts/realbank/build_bank.mjs", "--only-audio"]);
  if (b2.status !== 0) { console.log(`  ✗ build_bank 失败\n${tail(b2.out, 6)}`); process.exit(1); }
  console.log(`  ${(b2.out.match(/整块录音来源没挂上原声不收[^\n]*/) || [""])[0]}`);
  const as = step("assemble", process.execPath, ["scripts/realbank/assemble_sets.mjs"]);
  if (as.status !== 0) { console.log(`  ✗ assemble_sets 失败\n${tail(as.out, 6)}`); process.exit(1); }
  const slotsAfter = ledgerSlots();
  console.log(`\n■ 全库槽位 ${slotsBefore} → ${slotsAfter}（${slotsAfter - slotsBefore >= 0 ? "+" : ""}${slotsAfter - slotsBefore}）`
    + ` · 本批花费 ¥${spentSinceStart().toFixed(2)} · 累计 ¥${(SPENT_BEFORE + spentSinceStart()).toFixed(2)}`);
}
if (stopped) { console.log(`\n批次中途停下：${stopped}`); process.exit(3); }
