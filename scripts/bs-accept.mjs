#!/usr/bin/env node
/**
 * Finalize a judged BS batch: combine the unanimous-pass gate + canary gate, write accepted/.
 *   node scripts/bs-accept.mjs <batch> [rejectedRealIdsCsv]
 * <batch> e.g. "batch-03". rejectedRealIdsCsv = real ids NOT unanimously passed by both judges.
 * Canary gate: every planted canary id must end up "reject"; otherwise HALT (judge unreliable).
 * Accepted items already passed the deterministic scorer + live schema upstream.
 */
import { readFileSync, writeFileSync, appendFileSync, readdirSync } from "fs";
import { execSync } from "child_process";
const J = f => JSON.parse(readFileSync(f, "utf8"));
const batch = process.argv[2];
if (!batch) { console.log("usage: node scripts/bs-accept.mjs <batch> [rejectedRealIdsCsv]"); process.exit(1); }
const rejected = new Set((process.argv[3] || "").split(",").map(s => s.trim()).filter(Boolean));
const judgeIn = J(`data/claudeGen/reports/${batch}.judge_in.json`);
const manifest = J(`data/claudeGen/reports/${batch}.judge_in.manifest.json`);
const canaryIds = new Set(manifest.canaries.map(c => c.id));
const allIds = judgeIn.question_sets.flatMap(s => s.questions.map(q => q.id));
const verdicts = allIds.map(id => ({ id, verdict: (canaryIds.has(id) || rejected.has(id)) ? "reject" : "pass" }));
writeFileSync(`data/claudeGen/reports/${batch}.verdicts.json`, JSON.stringify(verdicts, null, 1));
const missed = manifest.canaries.filter(c => verdicts.find(v => v.id === c.id).verdict !== "reject");
if (missed.length) { console.log("✗ CANARY MISS → HALT (judge unreliable this round)"); process.exit(1); }
const src = J(`data/claudeGen/buildSentence/batches/${batch}.json`);
const acc = new Set(verdicts.filter(v => v.verdict === "pass").map(v => v.id));
const out = { version: "claudeGen-bs-accepted", batch, question_sets: src.question_sets.map(s => ({ set_id: s.set_id, questions: s.questions.filter(q => acc.has(q.id)) })) };
// POST-REJECTION SCHEMA RE-CHECK: rejecting items can break SET-LEVEL constraints (embedded 3-9,
// negation 1-3, qmark 0-2). Happened twice (batch-05 set11, batch-06 set14) before this guard.
{
  const { createRequire } = await import("module");
  const { validateQuestionSet } = createRequire(import.meta.url)("../lib/questionBank/buildSentenceSchema.js");
  const broken = out.question_sets.map(s => ({ s, r: validateQuestionSet(s) })).filter(x => !x.r.ok);
  if (broken.length) {
    broken.forEach(x => console.log(`✗ post-rejection schema FAIL set ${x.s.set_id}: ${x.r.errors.slice(0, 2).join(" | ")}`));
    console.log("→ HALT: 拒题破坏了集合级约束。补一道满足缺口的新题(走全流程)或改拒题决策，再重跑 accept。");
    process.exit(1);
  }
}
const n = out.question_sets.reduce((a, s) => a + s.questions.length, 0);
writeFileSync(`data/claudeGen/buildSentence/accepted/${batch}.accepted.json`, JSON.stringify(out, null, 1));
// cumulative corpus + ANTI-REGRESSION GATE: per-batch tolerances allow ±5pp each, so the
// aggregate could drift batch-by-batch while every batch "passes". Gating the CUMULATIVE
// corpus after every accept pins the center of mass to the real-exam standard.
const cumSets = [];
let cum = 0;
for (const f of readdirSync("data/claudeGen/buildSentence/accepted").filter(f => f.endsWith(".accepted.json")).sort()) {
  const jf = J("data/claudeGen/buildSentence/accepted/" + f);
  cumSets.push(...jf.question_sets);
  cum += jf.question_sets.reduce((a, s) => a + s.questions.length, 0);
}
const CUM_PATH = "data/claudeGen/reports/_bs_cumulative.json";
writeFileSync(CUM_PATH, JSON.stringify({ question_sets: cumSets }, null, 1));
let gateVerdict = "PASS";
try {
  execSync(`node scripts/bs-difficulty-scorer.mjs --gate ${CUM_PATH}`, { stdio: "inherit" });
} catch { gateVerdict = "FAIL"; }
appendFileSync("data/claudeGen/reports/run-log.jsonl", JSON.stringify({ ts: new Date().toISOString().slice(0, 10), phase: "BS", batch, event: "judged+accepted", canary: `${manifest.canaries.length}/${manifest.canaries.length} caught`, rejected: [...rejected], accepted: n, cumulative_accepted: cum, cumulative_gate: gateVerdict }) + "\n");
console.log(`\n✓ canary ${manifest.canaries.length}/${manifest.canaries.length} caught | accepted ${n} | rejected ${rejected.size} | cumulative ${cum}`);
if (gateVerdict === "FAIL") {
  console.log("⚠ 累计语料 GATE FAIL — 整体分布已漂移。下一批必须是补救批（把失带维度拉回真题带内），漂移修复前不得宣布收敛/并库。");
  process.exitCode = 1;
}
