#!/usr/bin/env node
/**
 * One-shot orchestrator: run all 4 sections' generators sequentially,
 * capture per-task logs + timing + acceptance counts, then emit a
 * single aggregated report at the end. Continues past individual
 * failures so partial output still ships a usable batch.
 *
 * Output:
 *   .claude/produce-logs/{taskId}.log     — full stdout/stderr per task
 *   .claude/produce-logs/summary.json     — machine-readable summary
 *   .claude/produce-logs/summary.md       — human-readable report
 */

import { spawn } from "child_process";
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LOG_DIR = resolve(ROOT, ".claude", "produce-logs");

mkdirSync(LOG_DIR, { recursive: true });

// Load .env.local for DEEPSEEK_API_KEY (the child processes do their own
// load too, but we mirror it into our env so the orchestrator's invocation
// surface stays uniform).
for (const p of [resolve(ROOT, ".env.local"), resolve(ROOT, ".env")]) {
  try {
    readFileSync(p, "utf8").split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([\w]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
    });
  } catch { /* ignore */ }
}

if (!process.env.DEEPSEEK_API_KEY) {
  console.error("ERROR: DEEPSEEK_API_KEY not in env/.env.local");
  process.exit(1);
}

// ── Task table ────────────────────────────────────────────────────────────
// Each task is one generator invocation. `expected` is the rough target
// count for the report (the actual generator may produce fewer if items
// get rejected). `stagingPrefix` lets us count what landed in staging
// for sections that use the staging→bank flow.
const TASKS = [
  // Writing — direct-write to prompts.json / questions.json
  { id: "bs",         section: "writing",   label: "Build a Sentence (3 sets)",
    cmd: "node", args: ["scripts/batch-produce.mjs", "--sets", "3", "--append"],
    expected: 30, direct: "data/buildSentence/questions.json" },
  { id: "email",      section: "writing",   label: "Email (3 prompts)",
    cmd: "node", args: ["scripts/generateEmailQuestions.mjs", "3"],
    expected: 3, direct: "data/emailWriting/prompts.json" },
  { id: "disc",       section: "writing",   label: "Academic Discussion (3 prompts)",
    cmd: "node", args: ["scripts/generateDiscQuestions.mjs", "3"],
    expected: 3, direct: "data/academicWriting/prompts.json" },

  // Reading — staging-based
  { id: "rdl",        section: "reading",   label: "Read in Daily Life (2)",
    cmd: "node", args: ["scripts/generate-rdl.mjs", "--count", "2"],
    expected: 2, stagingDir: "data/reading/staging", stagingPrefix: "rdl-" },
  { id: "ctw",        section: "reading",   label: "Complete the Words (2)",
    cmd: "node", args: ["scripts/generate-ctw.mjs", "--count", "2"],
    expected: 2, stagingDir: "data/reading/staging", stagingPrefix: "ctw-" },
  { id: "ap",         section: "reading",   label: "Academic Passage (1)",
    cmd: "node", args: ["scripts/generate-ap.mjs", "--count", "1"],
    expected: 1, stagingDir: "data/reading/staging", stagingPrefix: "ap-" },

  // Listening — staging-based, skip TTS to save time
  { id: "lcr",        section: "listening", label: "Choose a Response (10 items)",
    cmd: "node", args: ["scripts/generate-lcr.mjs", "--count", "10"],
    expected: 10, stagingDir: "data/listening/staging", stagingPrefix: "lcr-" },
  { id: "la",         section: "listening", label: "Announcement (1)",
    cmd: "node", args: ["scripts/generate-la.mjs", "--count", "1"],
    expected: 1, stagingDir: "data/listening/staging", stagingPrefix: "la-" },
  { id: "lc",         section: "listening", label: "Conversation (1)",
    cmd: "node", args: ["scripts/generate-lc.mjs", "--count", "1"],
    expected: 1, stagingDir: "data/listening/staging", stagingPrefix: "lc-" },
  { id: "lat",        section: "listening", label: "Academic Talk (1)",
    cmd: "node", args: ["scripts/generate-lat.mjs", "--count", "1"],
    expected: 1, stagingDir: "data/listening/staging", stagingPrefix: "lat-" },

  // Speaking — staging-based
  { id: "spk_repeat", section: "speaking",  label: "Repeat (1 set)",
    cmd: "node", args: ["scripts/generate-speaking.mjs", "--type", "repeat", "--count", "1"],
    expected: 7, stagingDir: "data/speaking/staging", stagingPrefix: "rpt-" },
  { id: "spk_intv",   section: "speaking",  label: "Interview (1 set)",
    cmd: "node", args: ["scripts/generate-speaking.mjs", "--type", "interview", "--count", "1"],
    expected: 4, stagingDir: "data/speaking/staging", stagingPrefix: "intv-" },
];

// ── Counting helpers ──────────────────────────────────────────────────────
function countDirectAdded(task, before, after) {
  // For direct-write tasks (BS, Email, Disc), compute new entries added.
  if (!before || !after) return null;
  const b = Array.isArray(before) ? before : (before.questions || before.question_sets || []);
  const a = Array.isArray(after) ? after : (after.questions || after.question_sets || []);
  // BS uses question_sets → questions; flatten
  if ((after.question_sets || []).length) {
    const bq = (before.question_sets || []).reduce((n, s) => n + (s.questions || []).length, 0);
    const aq = (after.question_sets || []).reduce((n, s) => n + (s.questions || []).length, 0);
    return aq - bq;
  }
  return a.length - b.length;
}

function loadJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { return null; }
}

function countStagingNew(task, sinceMs) {
  if (!task.stagingDir) return null;
  const dir = resolve(ROOT, task.stagingDir);
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir).filter((f) => f.startsWith(task.stagingPrefix) && f.endsWith(".json"));
  let items = 0;
  let fileCount = 0;
  for (const f of files) {
    const full = join(dir, f);
    try {
      const st = statSync(full);
      if (st.mtimeMs < sinceMs) continue;
      const data = JSON.parse(readFileSync(full, "utf8"));
      const arr = data.items || data.questions || data.sets || [];
      items += Array.isArray(arr) ? arr.length : 0;
      fileCount++;
    } catch { /* ignore */ }
  }
  return { items, files: fileCount };
}

// ── Runner ────────────────────────────────────────────────────────────────
function runTask(task, startedAtMs) {
  return new Promise((res) => {
    const logFile = join(LOG_DIR, `${task.id}.log`);
    const t0 = Date.now();
    console.log(`[start ] ${task.id.padEnd(11)} ${task.label}`);

    const before = task.direct ? loadJsonSafe(resolve(ROOT, task.direct)) : null;

    const child = spawn(task.cmd, task.args, {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks = [];
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => chunks.push(d));

    child.on("close", (code) => {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      writeFileSync(logFile, Buffer.concat(chunks));
      const after = task.direct ? loadJsonSafe(resolve(ROOT, task.direct)) : null;

      let added = null;
      if (task.direct) added = countDirectAdded(task, before, after);
      else added = countStagingNew(task, startedAtMs);

      const result = {
        id: task.id,
        section: task.section,
        label: task.label,
        ok: code === 0,
        exitCode: code,
        elapsedSec: Number(elapsed),
        expected: task.expected,
        added,
        logFile,
      };
      const addedStr = typeof added === "object" && added ? `${added.items} items / ${added.files} files` : String(added);
      console.log(`[${code === 0 ? "ok   " : "FAIL "}] ${task.id.padEnd(11)} ${elapsed}s  added=${addedStr}`);
      res(result);
    });

    child.on("error", (err) => {
      console.error(`[error] ${task.id}: ${err.message}`);
      res({
        id: task.id, section: task.section, label: task.label,
        ok: false, exitCode: -1, elapsedSec: ((Date.now() - t0) / 1000),
        expected: task.expected, added: 0, error: err.message,
      });
    });
  });
}

async function main() {
  const overallStart = Date.now();
  console.log(`\n=== produce-all-sections — ${TASKS.length} tasks ===\n`);

  const results = [];
  for (const task of TASKS) {
    const r = await runTask(task, overallStart);
    results.push(r);
  }

  const totalElapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  const summary = {
    started_at: new Date(overallStart).toISOString(),
    finished_at: new Date().toISOString(),
    total_elapsed_sec: Number(totalElapsed),
    tasks_total: results.length,
    tasks_ok: okCount,
    tasks_failed: failCount,
    results,
  };
  writeFileSync(join(LOG_DIR, "summary.json"), JSON.stringify(summary, null, 2));

  // Markdown report
  const md = [
    `# Production Run Summary`,
    ``,
    `- Started: ${summary.started_at}`,
    `- Finished: ${summary.finished_at}`,
    `- Total elapsed: ${totalElapsed}s`,
    `- Tasks: ${okCount}/${results.length} succeeded${failCount ? ` · ${failCount} failed` : ""}`,
    ``,
    `## Per-task results`,
    ``,
    `| Section | Task | Status | Elapsed | Target | Added |`,
    `|---|---|---|---|---|---|`,
    ...results.map((r) => {
      const addedStr = typeof r.added === "object" && r.added
        ? `${r.added.items} items / ${r.added.files} file${r.added.files === 1 ? "" : "s"}`
        : String(r.added ?? "?");
      const status = r.ok ? "✓" : `✗ (exit ${r.exitCode})`;
      return `| ${r.section} | ${r.id} — ${r.label} | ${status} | ${r.elapsedSec.toFixed(1)}s | ${r.expected} | ${addedStr} |`;
    }),
    ``,
  ].join("\n");
  writeFileSync(join(LOG_DIR, "summary.md"), md);

  console.log("\n=== summary ===");
  console.log(md);
  console.log(`\nLogs: ${LOG_DIR}`);
  process.exit(failCount > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
