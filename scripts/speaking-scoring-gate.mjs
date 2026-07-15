/* eslint-disable no-console */
// ============================================================================
// 口语「Take an Interview」评分防退化门 (Speaking Scoring Gate)
// ----------------------------------------------------------------------------
// 仿 scripts/scoring-gate.mjs（写作评分门）。把 2026-07-15「官方 rubric 锚定 +
// 三路取中位 + 护栏」改造的验收固化成仓库内可重复跑的闸门。任何人改采访评分
// prompt / parse / 护栏 / 中位选取 / 模型 / 预算之后，跑一条命令就能得出「过/不过」。
//
// 本闸门跑的是**生产评分本体**（不复制副本）：
//   · lib/ai/prompts/speaking.js        (getSpeakingSystemPrompt / buildInterviewUserPrompt)
//   · lib/speakingEval/calibration.js   (parseInterviewResponse / pickMedianReport / applyGuardrails)
//   · lib/ai/deepseekHttp.js            (callDeepSeekViaCurl)  —— 生产传输层
// 因此 prompt / parse / 护栏 / 中位任何一处改动都会被本闸门直接感知。
//
// 语料（只读）：
//   · data/speakingScoring/officialSamples.json  —— 4 份官方满分(5)样例（金标硬线）
//   · data/speakingScoring/gradedSamples.json    —— 16 份自写分档样本(band 1-4，
//     status=pending_human_review) + 引用上面 4 份官方作 band-5 锚
//
// 判定：
//   ① 硬线：4 份官方满分样例得分 ≥ 4.5 全过（否则 GATE FAIL / exit 1）。
//   ② 参考性（样本待人工核对）：分档样本 band 均分单调递增、相邻档差 ≥ 0.5；
//      每档命中 |得分-target| ≤ 1.0 的比例。破线只记 WARN，不拦 exit——因为样本
//      尚未人工核对（pending_human_review），只作参考。
//
// 用法：
//   node scripts/speaking-scoring-gate.mjs --dry-run        # 不调 DeepSeek，只校验样本结构 + 管线接线
//   node scripts/speaking-scoring-gate.mjs                  # 真跑（samples=1，成本极低）
//   node scripts/speaking-scoring-gate.mjs --samples 3      # 三路取中位（更贴近生产，更慢更贵）
//   node scripts/speaking-scoring-gate.mjs --budget 2500
// 参数：--dry-run · --samples 每个中位单元并行采样数（默认 1，生产是 3）· --budget 单采样 max_tokens（默认 2500）
//
// 密钥：从 .env.local / .env 读 DEEPSEEK_API_KEY（同 scoring-gate.mjs）。缺 key 时
//   自动退化为 --dry-run 并在报告注明。
// ============================================================================

import { register, createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

// ── ESM 解析垫片 ─────────────────────────────────────────────────────────────
// 生产模块用无扩展名相对 import（./calibration 等）+ import JSON（officialRubrics.json）。
// 裸 Node 严格 ESM：① 无扩展名相对 specifier 需补 .js；② .json 需要 import attributes，
// 这里改用 load hook 把 .json 就地转成 `export default <json>` 的 ESM 模块（无需 attributes）。
// 必须在动态 import 生产模块之前 register。
const HOOK = `
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function resolve(specifier, context, nextResolve) {
  const isRel = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExt = /\\.[cm]?jsx?$|\\.json$/i.test(specifier);
  if (isRel && !hasExt) {
    try { return await nextResolve(specifier + ".js", context); }
    catch { return await nextResolve(specifier, context); }
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    const text = readFileSync(fileURLToPath(url), "utf8");
    return { format: "module", source: "export default " + text + ";", shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;
register("data:text/javascript," + encodeURIComponent(HOOK), import.meta.url);

const require = createRequire(import.meta.url);
const { callDeepSeekViaCurl, resolveProxyUrl } = require("../lib/ai/deepseekHttp.js");

// ── .env.local / .env 加载（照 scoring-gate.mjs 做法）─────────────────────────
function loadEnvFile(name) {
  const envPath = path.join(ROOT, name);
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
loadEnvFile(".env.local");
loadEnvFile(".env");

// ── CLI 参数 ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { budget: 2500, samples: 1, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--budget") out.budget = Number(argv[++i]);
    else if (a === "--samples") out.samples = Number(argv[++i]);
    else if (a.startsWith("--budget=")) out.budget = Number(a.split("=")[1]);
    else if (a.startsWith("--samples=")) out.samples = Number(a.split("=")[1]);
  }
  if (!Number.isFinite(out.budget) || out.budget <= 0) out.budget = 2500;
  if (!Number.isFinite(out.samples) || out.samples < 1) out.samples = 1;
  return out;
}
const ARGS = parseArgs(process.argv.slice(2));

const MODEL = "deepseek-v4-flash";
const TEMPERATURE = 0.3;
const TIMEOUT_MS = 120000;
const OFFICIAL_HARD_LINE = 4.5; // 官方满分样例硬线
const HIT_TOL = 1.0; // 分档样本命中容差 |score-target|
const MIN_ADJ_GAP = 0.5; // 相邻档均分最小差

const mean = (arr) => {
  const s = arr.filter((x) => x != null);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
};

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function importProd(rel) {
  return import(pathToFileURL(path.join(ROOT, rel)).href);
}

async function main() {
  // 生产模块动态载入（hooks 已注册）。
  const [promptMod, calibMod] = await Promise.all([
    importProd("lib/ai/prompts/speaking.js"),
    importProd("lib/speakingEval/calibration.js"),
  ]);
  const { getSpeakingSystemPrompt, buildInterviewUserPrompt } = promptMod;
  const { parseInterviewResponse, pickMedianReport, applyGuardrails } = calibMod;

  // 语料
  const officialSamples = JSON.parse(fs.readFileSync(path.join(ROOT, "data/speakingScoring/officialSamples.json"), "utf8"));
  const gradedPath = path.join(ROOT, "data/speakingScoring/gradedSamples.json");
  const graded = JSON.parse(fs.readFileSync(gradedPath, "utf8"));

  const officialArr = officialSamples.takeAnInterviewSamples.samples;
  const officialById = new Map(officialArr.map((s) => [s.id, s]));
  const questionBySetRef = new Map(
    graded.sets.map((set) => [set.setRef, new Map(set.questions.map((q) => [q.ref, q.text]))]),
  );

  // ── 结构 / 接线校验（dry-run 与真跑都先跑一遍）────────────────────────────
  const structIssues = [];
  // 样本必填字段 + band 覆盖
  const bandsSeen = new Set();
  for (const s of graded.samples) {
    for (const f of ["id", "setRef", "questionRef", "targetScore", "text", "wordCount", "status", "rationale"]) {
      if (s[f] === undefined || s[f] === null || s[f] === "") structIssues.push(`sample ${s.id || "?"} 缺字段 ${f}`);
    }
    bandsSeen.add(s.targetScore);
    // questionRef 能在对应 set 里解析
    const qmap = questionBySetRef.get(s.setRef);
    if (!qmap) structIssues.push(`sample ${s.id} 的 setRef=${s.setRef} 在 sets 中不存在`);
    else if (!qmap.has(s.questionRef)) structIssues.push(`sample ${s.id} 的 questionRef=${s.questionRef} 在 set ${s.setRef} 中不存在`);
    // wordCount 与 text 一致
    const wc = String(s.text || "").trim().split(/\s+/).filter(Boolean).length;
    if (wc !== s.wordCount) structIssues.push(`sample ${s.id} wordCount=${s.wordCount} 与实测 ${wc} 不符`);
  }
  for (const b of [1, 2, 3, 4]) if (!bandsSeen.has(b)) structIssues.push(`分档样本缺 band ${b}`);
  // 官方 band-5 引用能解析
  for (const id of graded.officialAnchors.sampleIds) {
    if (!officialById.has(id)) structIssues.push(`officialAnchors.sampleIds 里的 ${id} 在 officialSamples.json 中找不到`);
  }

  // 管线接线（离线跑一遍真实纯函数，证明 import/互连正常）
  let wiringOk = true;
  const wiringNotes = [];
  try {
    const sys = getSpeakingSystemPrompt();
    if (!sys || sys.length < 500) { wiringOk = false; wiringNotes.push("system prompt 异常短"); }
    const usr = buildInterviewUserPrompt("Do you decide quickly?", "um yeah I usually take my time to think");
    if (!/STUDENT_TRANSCRIPT/.test(usr)) { wiringOk = false; wiringNotes.push("user prompt 缺 transcript 分隔"); }
    // parse 一个合成 JSON
    const parsed = parseInterviewResponse('{"overall":4,"on_topic":true,"score":4,"dimensions":{"fluency":{"score":4,"feedback":"x"},"intelligibility":{"score":4,"feedback":"x"},"language":{"score":3.5,"feedback":"x"},"organization":{"score":4,"feedback":"x"}},"summary":"s","suggestions":["a","b"]}');
    if (parsed.overall !== 4) { wiringOk = false; wiringNotes.push("parseInterviewResponse overall 解析异常"); }
    // 中位 + 护栏
    const picked = pickMedianReport([{ overall: 5, dimensions: parsed.dimensions, summary: "", suggestions: [], onTopic: true }, parsed, { overall: 3, dimensions: parsed.dimensions, summary: "", suggestions: [], onTopic: true }]);
    if (!picked || picked.overall !== 4) { wiringOk = false; wiringNotes.push("pickMedianReport 中位选取异常"); }
    const guarded = applyGuardrails({ overall: 5, dimensions: parsed.dimensions, transcript: "too short", question: "q", onTopic: true });
    // "too short" = 2 词 → word cap 1.0
    if (!(guarded.score <= 1.0 && guarded.guardrails.length > 0)) { wiringOk = false; wiringNotes.push("applyGuardrails 词数封顶未生效"); }
  } catch (e) {
    wiringOk = false;
    wiringNotes.push("接线抛错: " + String(e?.message || e));
  }

  console.log(`\n######### SPEAKING-SCORING-GATE  model=${MODEL}  budget=${ARGS.budget}  samples=${ARGS.samples}  mode=${ARGS.dryRun ? "DRY-RUN" : "LIVE"} #########`);

  console.log("\n── 结构 / 接线校验 ──");
  console.log(`  样本数: ${graded.samples.length}（自写 band1-4） + 官方 band5 引用: ${graded.officialAnchors.sampleIds.length}`);
  console.log(`  结构问题: ${structIssues.length ? structIssues.length + " 处" : "无"}`);
  structIssues.forEach((x) => console.log(`    ✗ ${x}`));
  console.log(`  管线接线: ${wiringOk ? "OK" : "FAIL"}${wiringNotes.length ? " — " + wiringNotes.join("; ") : ""}`);

  const structPass = structIssues.length === 0 && wiringOk;

  // ── DeepSeek key 检查 ──────────────────────────────────────────────────────
  const hasKey = !!process.env.DEEPSEEK_API_KEY;
  const doLive = !ARGS.dryRun && hasKey;
  if (!ARGS.dryRun && !hasKey) {
    console.log("\n⚠ 未找到 DEEPSEEK_API_KEY（检查 .env.local）——退化为 DRY-RUN，只交付结构/接线校验结果。");
  }

  if (!doLive) {
    const verdict = structPass ? "DRY-RUN PASS（结构 + 接线通过；未评分）" : "DRY-RUN FAIL（结构/接线破线）";
    console.log(`\n######### ${verdict} #########`);
    writeReport({ mode: ARGS.dryRun ? "dry-run" : "dry-run-nokey", structPass, structIssues, wiringOk, wiringNotes, live: null });
    process.exit(structPass ? 0 : 1);
  }

  // ── 真跑评分 ───────────────────────────────────────────────────────────────
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const proxyUrl = resolveProxyUrl();
  console.log(`\nproxy=${proxyUrl || "(direct)"}`);
  let totalCalls = 0;

  // 一个「中位单元」= samples 路并行 → 各自 parse → 取中位 → 护栏。返回护栏后 final。
  async function scoreOne(question, transcript) {
    const sys = getSpeakingSystemPrompt();
    const usr = buildInterviewUserPrompt(question, transcript);
    const payload = {
      model: MODEL, max_tokens: ARGS.budget, temperature: TEMPERATURE, stream: false,
      messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
    };
    const runOne = async () => {
      let content = "";
      try {
        content = await callDeepSeekViaCurl({ apiKey, proxyUrl, timeoutMs: TIMEOUT_MS, payload });
      } catch (e) {
        return { ok: false, reason: String(e?.message || e).slice(0, 160) };
      }
      try {
        return { ok: true, report: parseInterviewResponse(content) };
      } catch (e) {
        return { ok: false, reason: "parse: " + String(e?.message || e).slice(0, 100) };
      }
    };
    const results = await Promise.all(Array.from({ length: ARGS.samples }, () => runOne()));
    totalCalls += results.length;
    const candidates = results.filter((r) => r.ok).map((r) => r.report);
    if (candidates.length === 0) {
      return { final: null, guardrails: [], nValid: 0, reason: results[0]?.reason || "all failed" };
    }
    const chosen = pickMedianReport(candidates);
    const guarded = applyGuardrails({
      overall: chosen.overall, dimensions: chosen.dimensions,
      transcript, question, onTopic: chosen.onTopic,
    });
    return { final: guarded.score, guardrails: guarded.guardrails, nValid: candidates.length, overallRaw: chosen.overall, onTopic: chosen.onTopic };
  }

  // ① 官方满分样例（同时是 band-5 锚）
  console.log("\n── 官方满分样例（硬线 ≥ 4.5）──");
  const officialRows = [];
  for (const s of officialArr) {
    const r = await scoreOne(s.question, s.response);
    const pass = r.final != null && r.final >= OFFICIAL_HARD_LINE;
    officialRows.push({ id: s.id, target: 5, final: r.final, pass, guardrails: r.guardrails, overallRaw: r.overallRaw });
    console.log(`  ${(pass ? "PASS" : "FAIL").padEnd(4)} ${s.id.padEnd(34)} final=${r.final}${r.guardrails.length ? " guards=" + r.guardrails.join(",") : ""}`);
  }

  // ② 分档样本（参考性）
  console.log("\n── 分档样本（参考性，待人工核对）──");
  const gradedRows = [];
  for (const s of graded.samples) {
    const qtext = questionBySetRef.get(s.setRef)?.get(s.questionRef) || "";
    const r = await scoreOne(qtext, s.text);
    const hit = r.final != null && Math.abs(r.final - s.targetScore) <= HIT_TOL;
    gradedRows.push({ id: s.id, setRef: s.setRef, target: s.targetScore, final: r.final, hit, guardrails: r.guardrails, overallRaw: r.overallRaw, wordCount: s.wordCount });
    console.log(`  ${(hit ? "hit " : "MISS").padEnd(4)} ${s.id.padEnd(12)} target=${s.target || s.targetScore} final=${r.final} (raw=${r.overallRaw})${r.guardrails.length ? " guards=" + r.guardrails.join(",") : ""}`);
  }

  // ── band 汇总 ──
  const bandMeans = {};
  const bandHitRate = {};
  for (const b of [1, 2, 3, 4]) {
    const rows = gradedRows.filter((r) => r.target === b);
    bandMeans[b] = mean(rows.map((r) => r.final));
    const hits = rows.filter((r) => r.hit).length;
    bandHitRate[b] = rows.length ? hits / rows.length : null;
  }
  bandMeans[5] = mean(officialRows.map((r) => r.final));
  bandHitRate[5] = officialRows.length ? officialRows.filter((r) => r.pass).length / officialRows.length : null;

  console.log("\n── BAND 汇总 ──");
  for (const b of [1, 2, 3, 4, 5]) {
    const hr = bandHitRate[b] == null ? "n/a" : `${Math.round(bandHitRate[b] * 100)}%`;
    console.log(`  band ${b}: 均分=${bandMeans[b] == null ? "n/a" : bandMeans[b].toFixed(2)}  命中率(|Δ|≤${HIT_TOL})=${hr}`);
  }

  // 单调性 + 相邻档差
  const orderIssues = [];
  for (const b of [2, 3, 4, 5]) {
    const lo = bandMeans[b - 1], hi = bandMeans[b];
    if (lo == null || hi == null) continue;
    if (hi <= lo) orderIssues.push(`band ${b} 均分(${hi.toFixed(2)}) 未高于 band ${b - 1}(${lo.toFixed(2)})`);
    else if (hi - lo < MIN_ADJ_GAP - 1e-9) orderIssues.push(`band ${b} 与 band ${b - 1} 差 ${(hi - lo).toFixed(2)} < ${MIN_ADJ_GAP}`);
  }

  // ── 验收判定 ──
  const officialAllPass = officialRows.every((r) => r.pass);
  const overallHitRate = mean([...gradedRows].map((r) => (r.hit ? 1 : 0)));

  console.log("\n── ACCEPTANCE ──");
  console.log(`  ${(officialAllPass ? "PASS" : "FAIL").padEnd(4)} ① 官方满分样例 ≥ ${OFFICIAL_HARD_LINE} 全过（硬线） — ${officialRows.filter((r) => r.pass).length}/${officialRows.length}`);
  console.log(`  ${(orderIssues.length === 0 ? "PASS" : "WARN").padEnd(4)} ② 分档均分单调 + 相邻差 ≥ ${MIN_ADJ_GAP}（参考性）${orderIssues.length ? " — " + orderIssues.join("; ") : ""}`);
  console.log(`  ${"INFO"} ③ 分档样本总体命中率(|Δ|≤${HIT_TOL})=${overallHitRate == null ? "n/a" : Math.round(overallHitRate * 100) + "%"}（参考性，样本待人工核对）`);

  // 硬线决定 exit；参考性只 WARN。
  const verdictPass = structPass && officialAllPass;
  const warnCount = orderIssues.length > 0 ? 1 : 0;
  const verdictText = verdictPass
    ? `GATE PASS${warnCount ? "（含参考性 WARN）" : ""}`
    : "GATE FAIL";
  console.log(`\n######### ${verdictText}  (calls=${totalCalls}) #########`);
  if (!verdictPass) {
    if (!structPass) console.log("  ✗ 结构/接线破线");
    if (!officialAllPass) officialRows.filter((r) => !r.pass).forEach((r) => console.log(`  ✗ 官方样例 ${r.id} final=${r.final} < ${OFFICIAL_HARD_LINE}`));
  }
  if (orderIssues.length) {
    console.log("参考性 WARN（样本待人工核对，不拦 exit）:");
    orderIssues.forEach((x) => console.log(`  ⚠ ${x}`));
  }

  writeReport({
    mode: `live-samples${ARGS.samples}`, structPass, structIssues, wiringOk, wiringNotes,
    live: { officialRows, gradedRows, bandMeans, bandHitRate, orderIssues, officialAllPass, overallHitRate, totalCalls, verdictPass },
  });
  process.exit(verdictPass ? 0 : 1);
}

function writeReport(summary) {
  const outDir = path.join(ROOT, "data/claudeGen/reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `speaking-scoring-gate-${stamp()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), model: MODEL, budget: ARGS.budget, samples: ARGS.samples, ...summary }, null, 2) + "\n", "utf8");
  console.log(`\nwritten ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
