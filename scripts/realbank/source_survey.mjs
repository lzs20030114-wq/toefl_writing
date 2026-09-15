#!/usr/bin/env node
/**
 * 真题源料体检 —— 「这卷这科到底能不能开工」的只读盘点。
 *
 * 为什么要有：丢题账本只说「整科没跑过」，不说**为什么没跑**。是压根没 ingest 过？
 * 是 ingest 了但商家没给音频？还是已经结构化躺在 .codex-tmp 里、只差合库？
 * 这三种情况的下一步动作完全不同，而且第二种在「不自己 TTS 配音」的前提下根本不该开工 ——
 * 录进来也是一堆没声音的听力题。凭猜开工正是 2026-09 连修几轮仍普遍丢题的原因
 * （口径见 scripts/realbank/loss_attribution.js 头注）。
 *
 * 零 token、零网络、只读：吃 .codex-tmp/realbank/ 的 ingest 记录与结构化产物，
 * 外加 data/realBank/loss-ledger.json 的缺口口径，什么都不写。
 *
 * 用法：
 *   node scripts/realbank/source_survey.mjs                     # 全部「没跑过 / 管线丢题」的卷·科
 *   node scripts/realbank/source_survey.mjs --section=listening
 *   node scripts/realbank/source_survey.mjs --cause=section_never_run
 *   node scripts/realbank/source_survey.mjs --json              # 机读
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = process.cwd();
const TMP = path.join(ROOT, ".codex-tmp", "realbank");
const LEDGER = path.join(ROOT, "data", "realBank", "loss-ledger.json");

const argv = process.argv.slice(2);
const flag = (n) => (argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=");
const ONLY_SECTION = flag("section") || null;
const ONLY_CAUSE = flag("cause") || null;
const AS_JSON = argv.includes("--json");

const readJson = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } };

/**
 * 一卷一科的处境判定（纯函数，单测钉在 __tests__/realbank-source-survey.test.js）。
 *
 * verdict 的含义与下一步动作：
 *   ready_to_build    已结构化、这科有 ok 的结果 —— 只差合库（跑 build_bank）
 *   needs_structure   有料（文档 + 音频）但这科没结构化过 —— 跑 structure_set
 *   deferred_only     结构化跑过但这科没有一条 ok —— 要重扫，听力还得先有 ASR 逐字稿
 *   no_audio          ingest 过、但商家一个音频文件都没给 —— 不自己配音就不该开工
 *   incomplete_audio  音频有但都没下完（文件名带 downloading）
 *   not_ingested      .codex-tmp 里连 ingest 记录都没有 —— 从 ingest_set.py 开始
 *
 * 判定顺序是有意的：**先看有没有音频，再看结构化到哪一步**。听力/口语没音频这件事
 * 压倒一切 —— 结构化得再漂亮，没声音的听力题也不能上线。
 *
 * @param {{ingest: object|null, structured: object|null, section: string}} x
 * @returns {{verdict: string, why: string, audioFiles: number, audioMb: number, statuses: object}}
 */
export function classify({ ingest, structured, section }) {
  const audio = (ingest && Array.isArray(ingest.audio) ? ingest.audio : []);
  const audioFiles = audio.length;
  const audioMb = Math.round(audio.reduce((n, a) => n + (Number(a.mb) || 0), 0) * 10) / 10;
  const incomplete = audio.filter((a) => a.complete === false).length;

  const results = (structured && Array.isArray(structured.results) ? structured.results : [])
    .filter((r) => r.section === section);
  const statuses = {};
  for (const r of results) statuses[r.status || "?"] = (statuses[r.status || "?"] || 0) + 1;

  const base = { audioFiles, audioMb, statuses };
  if (!ingest && !structured) return { verdict: "not_ingested", why: ".codex-tmp 里没有这卷的 ingest 记录", ...base };

  const needsAudio = section === "listening" || section === "speaking";
  if (needsAudio && audioFiles === 0) return { verdict: "no_audio", why: "ingest 记录里一个音频文件都没有", ...base };
  if (needsAudio && incomplete === audioFiles) return { verdict: "incomplete_audio", why: `${incomplete} 个音频都没下完`, ...base };

  if ((statuses.ok || 0) > 0) return { verdict: "ready_to_build", why: `这科已有 ${statuses.ok} 条 ok 的结构化结果`, ...base };
  if (results.length === 0) return { verdict: "needs_structure", why: "有料但这科没结构化过", ...base };
  return { verdict: "deferred_only", why: `这科 ${results.length} 条结果里没有 ok（${JSON.stringify(statuses)}）`, ...base };
}

export const VERDICT_NEXT = {
  ready_to_build: "跑 build_bank（可能只差合库）",
  needs_structure: ' 跑 structure_set.mjs "<卷>" --sections=<科>',
  deferred_only: '跑 structure_set.mjs "<卷>" --only-failed；听力还要先有 ASR 逐字稿',
  no_audio: "【不开工】商家没给音频 —— 不自己配音的前提下，录进来也是没声音的题",
  incomplete_audio: "【不开工】音频没下完，先补齐源文件",
  not_ingested: "从 scripts/realbank/ingest_set.py 开始",
};

function main() {
  const ledger = readJson(LEDGER);
  if (!ledger) {
    console.error(`读不到 ${path.relative(ROOT, LEDGER)} —— 先跑 node scripts/realbank/loss_ledger.mjs`);
    process.exit(1);
  }
  if (!fs.existsSync(TMP)) {
    console.error(`没有 ${path.relative(ROOT, TMP)} —— 本脚本要在有源料的那台机器上跑`);
    process.exit(1);
  }

  // 缺口口径完全照账本，不自己数
  const want = new Map();
  for (const r of ledger.rows || []) {
    if (!["section_never_run", "section_lost", "pipeline_loss"].includes(r.cause)) continue;
    if (ONLY_CAUSE && r.cause !== ONLY_CAUSE) continue;
    if (ONLY_SECTION && r.section !== ONLY_SECTION) continue;
    const k = `${r.set}::${r.section}`;
    const cur = want.get(k) || { set: r.set, section: r.section, cause: r.cause, missing: 0 };
    cur.missing += r.missing || 0;
    want.set(k, cur);
  }

  const out = [];
  for (const w of want.values()) {
    const ingest = readJson(path.join(TMP, `${w.set}.json`));
    const structured = readJson(path.join(TMP, `${w.set}.structured.json`));
    out.push({ ...w, ...classify({ ingest, structured, section: w.section }) });
  }
  out.sort((a, b) => b.missing - a.missing);

  if (AS_JSON) { console.log(JSON.stringify(out, null, 2)); return; }

  const agg = {};
  for (const r of out) {
    const k = `${r.section}/${r.verdict}`;
    agg[k] = agg[k] || { sets: 0, missing: 0, audioMb: 0 };
    agg[k].sets += 1;
    agg[k].missing += r.missing;
    agg[k].audioMb += r.audioMb;
  }
  console.log(`真题源料体检（账本 ${ledger._generated || "?"}）—— ${out.length} 个卷·科\n`);
  console.log("科目/处境                        卷·科    缺题   音频MB   下一步");
  for (const [k, v] of Object.entries(agg).sort((a, b) => b[1].missing - a[1].missing)) {
    const verdict = k.split("/")[1];
    console.log(`  ${k.padEnd(30)} ${String(v.sets).padStart(3)} ${String(v.missing).padStart(7)} ${String(Math.round(v.audioMb)).padStart(7)}   ${VERDICT_NEXT[verdict] || ""}`);
  }
  console.log("\n逐卷：");
  for (const r of out) {
    console.log(`  ${r.set.padEnd(22)} ${r.section.padEnd(10)} 缺 ${String(r.missing).padStart(3)} · ${r.verdict.padEnd(16)} · 音频 ${r.audioFiles} 个/${r.audioMb}MB · ${r.why}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
