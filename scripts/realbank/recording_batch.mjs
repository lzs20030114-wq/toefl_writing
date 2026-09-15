#!/usr/bin/env node
/**
 * 数字卷「整块录音」听力 —— 批量铺量驱动：一批卷串行跑完整条链，钱和耗时逐套记账。
 *
 * 单套链路（2026-09-16 3.16 pilot 定型，见 scripts/realbank/merge_recording_asr.py 头注）：
 *   ① merge_recording_asr.py --plan-structure   本机转写 + 查重，列出值得送结构化的题块（零 API）
 *   ② structure_set.mjs --sections listening --only-failed --keys …   只结构化计划里的块（DeepSeek）
 *   ③ merge_recording_asr.py                     录音分段 + 屏幕题面合流（零 API）
 *   ④ audit_answers.mjs --section=listening      盲审第一票（DeepSeek）
 * 整批跑完再落库一次：
 *   ⑤ build_bank --only-audio --keep-unbound-recording   先让新题进库（bind 按库里条目做计划）
 *   ⑥ bind_original_audio --set=… --cached-narration-only 切真人原声、上传、写清单（零 TTS）
 *   ⑦ build_bank --only-audio                     没挂上原声的整块录音题不收
 *   ⑧ assemble_sets → loss_ledger --dry-run       对账：全库槽位涨了多少
 *
 * 钱：每套开跑前按计划块数预估（结构化 ¥0.014/块 + 盲审 ¥0.002/题），加上已花的超过 --budget 就停。
 * 实花从 .ops/deepseek-usage.jsonl 本进程启动后新增的行里算（同一台机器别的会话同时调 DeepSeek 会被算进来 ——
 * 宁可高估）。逐套明细追加到 .codex-tmp/realbank/logs/recording-batch.jsonl。
 *
 * 用法：
 *   node scripts/realbank/recording_batch.mjs --sets "3.18新托福真题,3.17新托福真题" --spent 0.73 --budget 30
 *   … --no-land      只跑 ①~④，不落库（⑤~⑧）
 *   … --land-only    只跑 ⑤~⑧（前面已跑过 ①~④ 的卷）
 * 退出码：0 正常；2 用法错误；3 系统性 API 失败 / 预算用尽（批次中途停下，已跑完的卷照常落库）。
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const ROOT = process.cwd();
const TMP = path.join(ROOT, ".codex-tmp", "realbank");
const LEDGER = path.join(ROOT, ".ops", "deepseek-usage.jsonl");
const LOG_DIR = path.join(TMP, "logs");
const argv = process.argv.slice(2);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SETS = String(val("--sets", "")).split(",").map((s) => s.trim()).filter(Boolean);
const BUDGET = Number(val("--budget", "30"));
const SPENT_BEFORE = Number(val("--spent", "0"));
const PY = process.env.REALBANK_PY || "python";
const NO_LAND = argv.includes("--no-land");
const LAND_ONLY = argv.includes("--land-only");
const CNY_PER_MTOK = Number(process.env.DEEPSEEK_CNY_PER_MTOK || 5.24);
const EST_PER_BLOCK = 0.014;
const EST_PER_AUDIT = 0.002;

if (!SETS.length) {
  console.error('用法: node scripts/realbank/recording_batch.mjs --sets "卷1,卷2" [--spent ¥] [--budget ¥] [--no-land | --land-only]');
  process.exit(2);
}

const ledgerLines = () => { try { return fs.readFileSync(LEDGER, "utf8").split(/\n/).filter(Boolean); } catch { return []; } };
const START_LINE = ledgerLines().length;
const spentSinceStart = () => ledgerLines().slice(START_LINE).reduce((n, l) => {
  try { const r = JSON.parse(l); return n + ((r.prompt_tokens || 0) + (r.completion_tokens || 0)) * CNY_PER_MTOK / 1e6; } catch { return n; }
}, 0);
const slugOf = (s) => {
  const m = /^(\d{1,2})[.．](\d{1,2})/.exec(s);
  const v = /([ABC])卷/.exec(s);
  const rev = /_v(\d+)$/.exec(s);
  return m ? `${m[1]}${m[2]}${v ? v[1].toLowerCase() : ""}${rev ? `v${rev[1]}` : ""}` : s;
};
const readJson = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } };

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
  const r = step("ledger", process.execPath, ["scripts/realbank/loss_ledger.mjs", "--dry-run"]);
  const m = /全库槽位\s+(\d+)\/(\d+)/.exec(r.out);
  return m ? Number(m[1]) : null;
};

console.log(`■ 整块录音听力批次：${SETS.length} 套 · 预算 ¥${BUDGET}（启动前已花 ¥${SPENT_BEFORE.toFixed(2)}）· 明细日志 ${path.relative(ROOT, runLog)}`);
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
    if (plan.status !== 0 || !planDoc || !/structure-plan|要结构化/.test(plan.out)) {
      console.log(`  ✗ ${set}：计划没出来，跳过\n${tail(plan.out)}`);
      done.push({ set, skipped: "plan_failed", detail: tail(plan.out, 2) });
      continue;
    }
    const keys = planDoc.keys || [];
    const est = keys.length * EST_PER_BLOCK + keys.length * EST_PER_AUDIT;
    const spentNow = SPENT_BEFORE + spentSinceStart();
    if (spentNow + est > BUDGET) {
      stopped = `预算：已花 ¥${spentNow.toFixed(2)} + 本套预估 ¥${est.toFixed(2)} > ¥${BUDGET}`;
      console.log(`  ■ 停：${stopped}`);
      break;
    }
    console.log(`  · ${set}：计划 ${keys.length}/${planDoc.screen_keys} 块（重复 ${planDoc.dup_groups.length} 组、坏 module ${planDoc.bad_modules.length}）预估 ¥${est.toFixed(2)}`);
    if (keys.length) {
      const ss = step(`structure ${set}`, process.execPath, ["scripts/realbank/structure_set.mjs", set, "--sections", "listening",
        "--only-failed", "--keys", keys.join(",")]);
      if (ss.status === 3) { stopped = `结构化系统性失败（${set}）`; console.log(`  ■ 停：${stopped}\n${tail(ss.out)}`); break; }
      console.log(`    结构化 ${ss.sec}s：${tail(ss.out, 1).trim()}`);
    }
    const mg = step(`merge ${set}`, PY, ["-X", "utf8", "scripts/realbank/merge_recording_asr.py", "--set", set]);
    const mline = (mg.out.match(/^\s+\S+：录音.*$/m) || [""])[0].trim();
    console.log(`    合流：${mline || tail(mg.out, 2).trim()}`);
    const st = readJson(path.join(TMP, `${set}.structured.json`), { results: [] });
    const auditable = (st.results || []).filter((r) => r.section === "listening" && r.status === "ok" && !r.dup_of
      && (r.items || []).some((it) => Array.isArray(it.options) && typeof it.answer_index === "number")).length;
    let auditLine = "无可审题";
    if (auditable) {
      const au = step(`audit ${set}`, process.execPath, ["scripts/realbank/audit_answers.mjs", set, "--section=listening"]);
      if (au.status === 3) { stopped = `盲审系统性失败（${set}）`; console.log(`  ■ 停：${stopped}\n${tail(au.out)}`); break; }
      auditLine = ((au.out.match(/一致 \d+\/\d+ = [\d.]+%/) || [""])[0]) || tail(au.out, 1).trim();
    }
    const cost = spentSinceStart() - spent0;
    const rec = { set, keys: keys.length, screen_keys: planDoc.screen_keys, dup_groups: planDoc.dup_groups.length,
      bad_modules: planDoc.bad_modules, merge: mline, audit: auditLine, cost_cny: Math.round(cost * 1000) / 1000,
      sec: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() };
    done.push(rec);
    fs.appendFileSync(path.join(LOG_DIR, "recording-batch.jsonl"), `${JSON.stringify(rec)}\n`, "utf8");
    console.log(`    盲审：${auditLine} · 本套 ¥${rec.cost_cny.toFixed(2)} · ${rec.sec}s · 累计 ¥${(SPENT_BEFORE + spentSinceStart()).toFixed(2)}`);
  }
}

if (!NO_LAND) {
  const landSets = LAND_ONLY ? SETS : done.filter((d) => !d.skipped).map((d) => d.set);
  if (landSets.length) {
    console.log(`\n■ 落库 ${landSets.length} 套`);
    const b1 = step("build keep-unbound", process.execPath, ["scripts/realbank/build_bank.mjs", "--only-audio", "--keep-unbound-recording"]);
    if (b1.status !== 0) { console.log(`  ✗ build_bank 失败\n${tail(b1.out, 6)}`); process.exit(1); }
    const bind = step("bind", process.execPath, ["scripts/realbank/bind_original_audio.mjs",
      `--set=${landSets.map(slugOf).join(",")}`, "--cached-narration-only"]);
    console.log(`  原声：${(bind.out.match(/■ 合计：[^\n]*/) || [""])[0]}  ${(bind.out.match(/■ 回挂：[^\n]*/) || [""])[0]}`);
    if (bind.status !== 0) { console.log(`  ✗ bind_original_audio 失败（新题不会上线：下一步的 build 按清单拦）\n${tail(bind.out, 6)}`); }
    const b2 = step("build gated", process.execPath, ["scripts/realbank/build_bank.mjs", "--only-audio"]);
    if (b2.status !== 0) { console.log(`  ✗ build_bank 失败\n${tail(b2.out, 6)}`); process.exit(1); }
    console.log(`  ${(b2.out.match(/整块录音来源没挂上原声不收[^\n]*/) || [""])[0]}`);
    const as = step("assemble", process.execPath, ["scripts/realbank/assemble_sets.mjs"]);
    if (as.status !== 0) { console.log(`  ✗ assemble_sets 失败\n${tail(as.out, 6)}`); process.exit(1); }
  }
  const slotsAfter = ledgerSlots();
  console.log(`\n■ 全库槽位 ${slotsBefore} → ${slotsAfter}（${slotsAfter - slotsBefore >= 0 ? "+" : ""}${slotsAfter - slotsBefore}）`
    + ` · 本批花费 ¥${spentSinceStart().toFixed(2)} · 累计 ¥${(SPENT_BEFORE + spentSinceStart()).toFixed(2)}`);
}
if (stopped) { console.log(`\n批次中途停下：${stopped}`); process.exit(3); }
