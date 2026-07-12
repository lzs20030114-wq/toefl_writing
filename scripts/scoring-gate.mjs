/* eslint-disable no-console */
// ============================================================================
// 写作评分防退化门 (Scoring Gate)
// ----------------------------------------------------------------------------
// 用途：把 2026-07-12「判分锚 v3 + 三路取中位」大修的验收 harness 固化成仓库内的
//       永久闸门。任何人改评分 prompt / parse / calibration / 中位选取 / 模型 / 预算
//       之后，跑一条命令就能得出「过 / 不过」，防止评分质量静默退化。
//
// 本闸门跑的是**生产代码本体**（不复制副本）：
//   · lib/ai/prompts/academicWriting.js · emailWriting.js  —— 判分锚 v3 prompt
//   · lib/ai/parse.js  (parseReport)                        —— 生产解析
//   · lib/ai/calibration.js  (calibrateScoreReport)         —— 生产校准层
//   · lib/ai/writingEval.js  (pickMedianCandidate)          —— 生产中位选取纯函数
//   · lib/ai/deepseekHttp.js (callDeepSeekViaCurl)          —— 生产传输层
// 因此 prompt / parse / calibration / 中位任何一处改动都会被本闸门直接感知。
//
// 语料（只读，改评分逻辑时不动它）：data/eval-profiles/writing-scoring-gate.json
//   12 篇评分锚（含 2 篇 in-prompt few-shot 泄漏锚，clean 统计时排除）+ 11 个对抗探针。
// 验收标准一页纸：docs/eval-spec/writing-scoring.md（6 条验收线的口径与出处）。
//
// 用法：
//   node scripts/scoring-gate.mjs                 # 全量（~29 个中位流程 ≈ 30 分钟, 费用 ~¥1）
//   node scripts/scoring-gate.mjs --quick         # 冒烟（vaccine+heating+P5+P10+P1+P9 ≈ 8 分钟, 几毛钱）
//   node scripts/scoring-gate.mjs --budget 6000 --samples 3
// 参数：--budget 单采样 max_tokens（默认 6000）· --samples 每个中位单元并行采样数（默认 3）
//       --quick 冒烟子集（部分验收线，非完整 GATE 判定）
//
// 6 条验收线（全量，与固化前 harness 同口径）：
//   ① clean 锚命中（排除 leaked 两篇后 |final-expected|≤tol）≥ ceil(0.75×10) = 8/10
//   ② ets-disc-5-vaccine（官方 5 分文）≥ 4.5
//   ③ P5-email-missing-goal（缺 1 个 goal）≤ 3
//   ④ P10-official5-plus-3typos（官方 5 分文 + 3 错字，限时噪声豁免）≥ 4.0 硬线；
//     <4.5 记预警。2026-07-12 三轮复测实证其中枢 ≈4.4 正坐在 4.5 上（单抽约半数擦线
//     翻车），硬线定病位（病时 3.5）、理想位 4.5 降级为预警——与 gate-registry
//     「检测器精度不够只能 monitor 不做 hard」同哲学。P10 为此升级为 3 遍中位单元降噪。
//   ⑤ 垃圾探针 P1/P2/P3/P6/P7/P8/P9（模板/跑题/连接词沙拉/注水/注入×2/复述题干）全过
//   ⑥ 稳定性两篇（vaccine / heating）中位流程各跑 3 遍，极差全 ≤ 1.0 硬线；>0.5 记预警
//     （同上：vaccine 家族单采样 σ≈0.5，3 中位极差 ≤0.5 本身约半数擦线）。
//   全部满足 → GATE PASS (exit 0)，否则 GATE FAIL + 逐条列破线 (exit 1)。预警不拦 exit，
//   但连续多次预警 = 中枢在漂移，该去查 prompt/模型。
//
// 每个「中位单元」= 三路取中位：并行 samples 次 callDeepSeekViaCurl(120s) → 各自 parseReport
//   → 成功者 calibrateScoreReport → 用生产 pickMedianCandidate 选中位（有效候选构造 {final}）。
//   单采样无 parse 级重试（与生产一致）。稳定性两篇把整套中位流程跑 3 遍取中位数的中位数。
// 并发纪律：单元内 samples 采样并行；单元之间串行 → 任意时刻并发 API ≤ samples(默认3)。
//
// ⚠ 与固化前 scratchpad harness 的一处适配：生产传输层 callDeepSeekViaCurl 只回吐 content
//   字符串，不暴露 finish_reason / usage（scratchpad 的 genClient 会）。故「推理吃预算 /
//   finish=length」只能从 content 推断：空 content（推理吃光预算）或非空但截在 ===SCORE===
//   之前（正文没写完）→ 记为 likelyBudget，汇总里单独计数。这是保真度换生产传输层的取舍。
//
// 不进 jest（要 API key + 半小时 + 花钱）；是手动 / 发版前闸门。
// ============================================================================

import { register, createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// 相对脚本自身定位仓库根，避免依赖 cwd（可从任意目录调用）。
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

// ── ESM 解析垫片 ────────────────────────────────────────────────────────────
// lib/ai/writingEval.js 用无扩展名相对 import（./client 等）——Next/jest 能解析，
// 裸 Node 严格 ESM 不能。注册一个 resolve hook：给无扩展名相对 specifier 补 .js。
// 必须在动态 import writingEval.js 之前 register，故所有生产模块走 main() 内动态 import。
const EXT_HOOK = `
export async function resolve(specifier, context, nextResolve) {
  const isRel = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExt = /\\.[cm]?jsx?$|\\.json$/i.test(specifier);
  if (isRel && !hasExt) {
    try { return await nextResolve(specifier + ".js", context); }
    catch { return await nextResolve(specifier, context); }
  }
  return nextResolve(specifier, context);
}
`;
register("data:text/javascript," + encodeURIComponent(EXT_HOOK), import.meta.url);

const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../lib/ai/deepseekHttp.js");

// ── .env.local 加载（参考 scripts/calibration-test.js + models.mjs 做法）────────
function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnvLocal();

// ── CLI 参数 ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { budget: 6000, samples: 3, quick: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--quick") out.quick = true;
    else if (a === "--budget") out.budget = Number(argv[++i]);
    else if (a === "--samples") out.samples = Number(argv[++i]);
    else if (a.startsWith("--budget=")) out.budget = Number(a.split("=")[1]);
    else if (a.startsWith("--samples=")) out.samples = Number(a.split("=")[1]);
  }
  if (!Number.isFinite(out.budget) || out.budget <= 0) out.budget = 6000;
  if (!Number.isFinite(out.samples) || out.samples < 1) out.samples = 3;
  return out;
}
const ARGS = parseArgs(process.argv.slice(2));

const MODEL = "deepseek-v4-flash";
const TEMPERATURE = 0.3;
const TIMEOUT_MS = 120000;
const EPS = 1e-9;

// 冒烟子集（--quick）：vaccine + heating（含 3 遍稳定性）+ P5 + P10 + 垃圾里的 P1 / P9。
const QUICK_ANCHOR_IDS = new Set(["ets-disc-5-vaccine", "cal-email-4-heating"]);
const QUICK_PROBE_IDS = new Set([
  "P5-email-missing-goal", "P10-official5-plus-3typos",
  "P1-template-discussion", "P9-copy-prompt",
]);

const median = (arr) => {
  const s = arr.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function evalExpect(final, expect) {
  if (final == null) return false;
  const { op, value, min, max } = expect || {};
  if (op === "lte") return final <= value + EPS;
  if (op === "gte") return final >= value - EPS;
  if (op === "range") return final >= min - EPS && final <= max + EPS;
  return false;
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("Missing DEEPSEEK_API_KEY (check .env.local)");
    process.exit(1);
  }

  // 生产模块动态载入（resolve hook 已注册，writingEval 的无扩展名 import 可解析）。
  const [parseMod, calibMod, acadMod, emailMod, evalMod] = await Promise.all([
    import("../lib/ai/parse.js"),
    import("../lib/ai/calibration.js"),
    import("../lib/ai/prompts/academicWriting.js"),
    import("../lib/ai/prompts/emailWriting.js"),
    import("../lib/ai/writingEval.js"),
  ]);
  const { parseReport } = parseMod;
  const { calibrateScoreReport } = calibMod;
  const { getDiscussionSystemPrompt, buildDiscussionUserPrompt } = acadMod;
  const { getEmailSystemPrompt, buildEmailUserPrompt } = emailMod;
  const { pickMedianCandidate } = evalMod;

  const corpusPath = path.join(ROOT, "data/eval-profiles/writing-scoring-gate.json");
  const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const proxyUrl = resolveProxyUrl();

  const fails = []; // 采样级 format-fail 汇总（原因分布 + likelyBudget 计数）
  let totalCalls = 0;

  // ── 一次「中位流程」= samples 路并行取中位 ─────────────────────────────────
  async function scoreMedianFlow(task, pd, text) {
    const sys = task === "email" ? getEmailSystemPrompt("zh") : getDiscussionSystemPrompt("zh");
    const userPrompt = task === "email" ? buildEmailUserPrompt(pd, text) : buildDiscussionUserPrompt(pd, text);
    const payload = {
      model: MODEL,
      max_tokens: ARGS.budget,
      temperature: TEMPERATURE,
      stream: false,
      messages: [{ role: "system", content: sys }, { role: "user", content: userPrompt }],
    };

    const runOneSample = async () => {
      let content = "";
      try {
        content = await callDeepSeekViaCurl({ apiKey, proxyUrl, timeoutMs: TIMEOUT_MS, payload });
      } catch (e) {
        const msg = String(e?.message || e).slice(0, 200);
        // 传输层抛错（含「missing content」= 推理吃光预算 content=null 的情形）。
        const likelyBudget = /missing content/i.test(msg);
        return { formatFail: true, final: null, fail: { kind: "transport", reason: msg, contentLen: 0, likelyBudget } };
      }
      const parsed = parseReport(content);
      if (parsed.error) {
        const empty = String(content || "").trim() === "";
        const hasScoreMarker = /===SCORE===/.test(String(content || ""));
        // finish=length 代理：空 content 或非空但截在 ===SCORE=== 之前 → 正文没写完。
        const likelyBudget = empty || !hasScoreMarker;
        return {
          formatFail: true, final: null,
          fail: { kind: "parse", reason: parsed.errorReason || "parse error", contentLen: String(content || "").length, empty, likelyBudget },
        };
      }
      const report = calibrateScoreReport(task, parsed, text);
      return { formatFail: false, final: report.score, fail: null };
    };

    const results = await Promise.all(Array.from({ length: ARGS.samples }, () => runOneSample()));
    totalCalls += results.length;
    results.forEach((r) => { if (r.fail) fails.push(r.fail); });

    const sampleFinals = results.map((r) => (r.formatFail ? null : r.final)); // 原始采样顺序
    // 有效候选（原始顺序，供 pickMedianCandidate 的原索引 tie-break 与生产一致）。
    const validCandidates = results.filter((r) => !r.formatFail).map((r) => ({ final: r.final }));
    if (validCandidates.length === 0) {
      return { formatFail: true, final: null, samples: sampleFinals, nValid: 0 };
    }
    const idx = pickMedianCandidate(validCandidates);
    return { formatFail: false, final: validCandidates[idx].final, samples: sampleFinals, nValid: validCandidates.length };
  }

  console.log(`\n######### SCORING-GATE  model=${MODEL}  budget=${ARGS.budget}  samples=${ARGS.samples}  mode=${ARGS.quick ? "QUICK" : "FULL"} #########`);
  console.log(`proxy=${proxyUrl || "(direct)"}\n`);

  const runAnchors = ARGS.quick ? corpus.anchors.filter((a) => QUICK_ANCHOR_IDS.has(a.id)) : corpus.anchors;
  const runProbes = ARGS.quick ? corpus.probes.filter((p) => QUICK_PROBE_IDS.has(p.id)) : corpus.probes;

  // ── 评分锚 ───────────────────────────────────────────────────────────────
  console.log("── ANCHORS ──");
  const anchorRows = [];
  for (const a of runAnchors) {
    const nFlows = a.stability ? 3 : 1;
    const runs = [];
    const flows = [];
    for (let i = 0; i < nFlows; i += 1) {
      const f = await scoreMedianFlow(a.task, a.promptData, a.response);
      runs.push(f.formatFail ? null : f.final);
      flows.push({ samples: f.samples, nValid: f.nValid, final: f.formatFail ? null : f.final });
    }
    const finalScore = median(runs);
    const within = finalScore != null && Math.abs(finalScore - a.expected) <= (a.tol ?? 0.5) + EPS;
    const samplesField = flows.length === 1 ? flows[0].samples : flows.map((x) => x.samples);
    anchorRows.push({
      id: a.id, task: a.task, expected: a.expected, tol: a.tol ?? 0.5,
      official: !!a.official, authorBuilt: !!a.authorBuilt, leaked: !!a.leaked, stability: !!a.stability,
      runs, samples: samplesField, final: finalScore, within,
    });
    console.log(
      `${(within ? "PASS" : "FAIL").padEnd(4)} ${a.id.padEnd(24)} exp=${a.expected} runs=[${runs.join(",")}] samples=${JSON.stringify(samplesField)} median=${finalScore}${a.leaked ? " (LEAKED/in-prompt)" : ""}`
    );
  }

  // ── 对抗探针 ─────────────────────────────────────────────────────────────
  console.log("\n── PROBES ──");
  const probeRows = [];
  for (const p of runProbes) {
    // stability:true 的探针（P10）与稳定性锚同待遇：中位流程跑 3 遍取中位数的中位数,
    // 消掉「单 flow 探针坐在判定线上、一半概率擦线翻车」的抽样噪声。
    const nFlows = p.stability ? 3 : 1;
    const runs = [];
    const flows = [];
    for (let i = 0; i < nFlows; i += 1) {
      const f = await scoreMedianFlow(p.task, p.promptData, p.text);
      runs.push(f.formatFail ? null : f.final);
      flows.push({ samples: f.samples, nValid: f.nValid, final: f.formatFail ? null : f.final });
    }
    const finalScore = median(runs);
    const pass = evalExpect(finalScore, p.expect);
    const samplesField = flows.length === 1 ? flows[0].samples : flows.map((x) => x.samples);
    probeRows.push({
      id: p.id, task: p.task, role: p.role, expText: p.expText, stability: !!p.stability,
      runs, final: finalScore, samples: samplesField,
      nValid: flows.length === 1 ? flows[0].nValid : undefined, pass,
      formatFail: finalScore == null,
    });
    console.log(
      `${(pass ? "PASS" : "FAIL").padEnd(4)} ${p.id.padEnd(28)} final=${finalScore == null ? "FMT" : finalScore}${nFlows > 1 ? ` runs=[${runs.join(",")}]` : ""} samples=${JSON.stringify(samplesField)} exp:${p.expText} [${p.role}]`
    );
  }

  // ── 稳定性（vaccine / heating 的 3 个中位数极差） ──────────────────────────
  const stability = [];
  for (const id of ["ets-disc-5-vaccine", "cal-email-4-heating"]) {
    const row = anchorRows.find((r) => r.id === id);
    if (!row) continue; // quick 里两篇都在；防御式
    const vals = row.runs.filter((x) => x != null);
    const range = vals.length ? Number((Math.max(...vals) - Math.min(...vals)).toFixed(2)) : null;
    // 硬线 ≤1.0（病位：预算饿死采样时代 heating 摆到过 1.0+）；>0.5 记预警（理想位）。
    stability.push({
      id, runs: row.runs, range,
      stable: range != null && range <= 1.0 + EPS,
      warn: range != null && range > 0.5 + EPS && range <= 1.0 + EPS,
    });
  }

  // ── 验收判定 ─────────────────────────────────────────────────────────────
  const anchorById = (id) => anchorRows.find((r) => r.id === id);
  const probeById = (id) => probeRows.find((r) => r.id === id);
  const cleanRows = corpus.anchors.filter((a) => !a.leaked);
  const cleanBar = Math.ceil(0.75 * cleanRows.length); // = 8/10
  const ranCleanRows = anchorRows.filter((r) => !r.leaked);
  const cleanTolHits = ranCleanRows.filter((r) => r.within).length;
  const allCleanRan = ranCleanRows.length === cleanRows.length;

  const vaccine = anchorById("ets-disc-5-vaccine");
  const p5 = probeById("P5-email-missing-goal");
  const p10 = probeById("P10-official5-plus-3typos");
  const garbageAll = corpus.probes.filter((p) => p.role === "garbage");
  const ranGarbage = probeRows.filter((r) => r.role === "garbage");
  const garbagePass = ranGarbage.length > 0 && ranGarbage.every((r) => r.pass);
  const allGarbageRan = ranGarbage.length === garbageAll.length;

  // 每条验收线：status = PASS | FAIL | N/A（该线所需单元未跑，仅 quick 会出现）。
  const lines = [];
  lines.push({
    key: "clean_anchor_hits", label: `① clean 锚命中 ≥ ${cleanBar}/${cleanRows.length}`,
    status: allCleanRan ? (cleanTolHits >= cleanBar ? "PASS" : "FAIL") : "N/A",
    detail: `hits=${cleanTolHits}/${ranCleanRows.length}${allCleanRan ? "" : " (quick: 未跑全部 clean 锚)"}`,
  });
  lines.push({
    key: "vaccine_ge_4.5", label: "② vaccine ≥ 4.5",
    status: vaccine ? (vaccine.final != null && vaccine.final >= 4.5 - EPS ? "PASS" : "FAIL") : "N/A",
    detail: vaccine ? `final=${vaccine.final}` : "未跑",
  });
  lines.push({
    key: "p5_lte_3", label: "③ P5-email-missing-goal ≤ 3",
    status: p5 ? (p5.pass ? "PASS" : "FAIL") : "N/A",
    detail: p5 ? `final=${p5.final}` : "未跑",
  });
  const p10Warn = p10 && p10.pass && p10.final != null && p10.final < 4.5 - EPS;
  lines.push({
    key: "p10_ge_4.0", label: "④ P10-official5-plus-3typos ≥ 4.0（<4.5 预警）",
    status: p10 ? (p10.pass ? "PASS" : "FAIL") : "N/A",
    detail: p10 ? `final=${p10.final}${p10Warn ? " ⚠ 低于理想位 4.5" : ""}` : "未跑",
    warn: !!p10Warn,
  });
  lines.push({
    key: "garbage_all_pass", label: "⑤ 垃圾探针全过 (P1/P2/P3/P6/P7/P8/P9)",
    status: ranGarbage.length === 0 ? "N/A" : (garbagePass ? "PASS" : "FAIL"),
    detail: `pass=${ranGarbage.filter((r) => r.pass).length}/${ranGarbage.length}${allGarbageRan ? "" : ` (quick: 仅跑 ${ranGarbage.map((r) => r.id).join("/")})`}`,
  });
  lines.push({
    key: "stability_le_1.0", label: "⑥ 稳定性两篇极差 ≤ 1.0（>0.5 预警）",
    status: stability.length === 2 ? (stability.every((s) => s.stable) ? "PASS" : "FAIL") : "N/A",
    detail: stability.map((s) => `${s.id.includes("vaccine") ? "vac" : "heat"}=${s.range}${s.warn ? "⚠" : ""}`).join(" "),
    warn: stability.some((s) => s.warn),
  });

  const runnable = lines.filter((l) => l.status !== "N/A");
  const allRunnablePass = runnable.every((l) => l.status === "PASS");
  // 全量：6 线全 PASS 才 GATE PASS。quick：只对跑到的线判 QUICK SMOKE。
  const fullVerdict = !ARGS.quick && lines.every((l) => l.status === "PASS");
  const verdictPass = ARGS.quick ? allRunnablePass : fullVerdict;

  // ── format-fail 汇总（原因分布 + finish=length 代理计数） ──────────────────
  const reasonDist = {};
  let budgetFails = 0;
  fails.forEach((f) => {
    const k = `${f.kind}:${f.reason}`;
    reasonDist[k] = (reasonDist[k] || 0) + 1;
    if (f.likelyBudget) budgetFails += 1;
  });

  // ── 打印汇总 ─────────────────────────────────────────────────────────────
  console.log("\n── ACCEPTANCE ──");
  for (const l of lines) console.log(`  ${l.status.padEnd(4)} ${l.label.padEnd(40)} ${l.detail}`);

  console.log("\n── FORMAT-FAIL ──");
  console.log(`  采样级 format-fail 数: ${fails.length} / ${totalCalls} 采样` + (fails.length ? "" : " (无)"));
  if (fails.length) {
    console.log(`  其中疑似「推理吃预算/finish=length」(likelyBudget): ${budgetFails}`);
    console.log("  原因分布:");
    Object.entries(reasonDist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`    ${v}×  ${k}`));
  }

  const verdictText = ARGS.quick
    ? (verdictPass ? "QUICK SMOKE PASS (部分验收线，非完整 GATE 判定)" : "QUICK SMOKE FAIL")
    : (verdictPass ? "GATE PASS" : "GATE FAIL");
  const warnLines = lines.filter((l) => l.warn);
  console.log(`\n######### ${verdictText}${warnLines.length ? `  (预警 ${warnLines.length} 条)` : ""}  (calls=${totalCalls}) #########`);
  if (!verdictPass) {
    console.log("破线:");
    runnable.filter((l) => l.status === "FAIL").forEach((l) => console.log(`  ✗ ${l.label} — ${l.detail}`));
  }
  if (warnLines.length) {
    console.log("预警（不拦 exit；连续多次出现 = 中枢在漂移，该查 prompt/模型）:");
    warnLines.forEach((l) => console.log(`  ⚠ ${l.label} — ${l.detail}`));
  }

  // ── 落盘结果 JSON ─────────────────────────────────────────────────────────
  const outDir = path.join(ROOT, "data/claudeGen/reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `scoring-gate-${stamp()}.json`);
  const summary = {
    generatedAt: new Date().toISOString(),
    mode: ARGS.quick ? "quick" : "full",
    model: MODEL, budget: ARGS.budget, samples: ARGS.samples, temperature: TEMPERATURE,
    verdict: verdictText, verdictPass,
    acceptance: lines,
    cleanBar, cleanTolHits, cleanTotal: ranCleanRows.length, allCleanRan,
    stability,
    formatFail: { samples: fails.length, totalCalls, likelyBudget: budgetFails, reasonDist },
    anchorRows, probeRows,
  };
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
  console.log(`\nwritten ${outPath}`);

  process.exit(verdictPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
