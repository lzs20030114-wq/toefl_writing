#!/usr/bin/env node
/**
 * Run history dashboard — reads run_history.json and prints formatted stats.
 *
 * Usage:
 *   node scripts/run-stats.mjs          # show all runs
 *   node scripts/run-stats.mjs --last 5 # show last 5 runs
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_HISTORY_PATH = resolve(__dirname, "..", "data", "buildSentence", "run_history.json");
const CB_LOG_PATH = resolve(__dirname, "..", "data", "buildSentence", "circuit_breaker_log.json");

function parseArgs(argv) {
  let last = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--last" && argv[i + 1]) {
      last = parseInt(argv[i + 1], 10) || 0;
    }
  }
  return { last };
}

function fmtPct(n) { return (n * 100).toFixed(1) + "%"; }
function fmtDuration(s) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}
function pad(str, len) { return String(str).padStart(len); }

function main() {
  const args = parseArgs(process.argv.slice(2));

  let history;
  try {
    history = JSON.parse(readFileSync(RUN_HISTORY_PATH, "utf8"));
  } catch (_) {
    console.log("No run history found. Run generateBSQuestions.mjs at least once.");
    process.exit(0);
  }

  if (!Array.isArray(history) || history.length === 0) {
    console.log("Run history is empty.");
    process.exit(0);
  }

  const runs = args.last > 0 ? history.slice(-args.last) : history;
  const bar = "=".repeat(78);

  console.log(bar);
  console.log("  BUILD SENTENCE — RUN HISTORY DASHBOARD");
  console.log(bar);
  console.log(`  Total runs: ${history.length} | Showing: ${runs.length}`);
  console.log("");

  // Table header
  console.log(
    "  " +
    pad("#", 3) + "  " +
    "Date".padEnd(16) + "  " +
    pad("Sets", 6) + "  " +
    pad("Gen", 5) + "  " +
    pad("Acc", 5) + "  " +
    pad("Rate", 7) + "  " +
    pad("Pool", 5) + "  " +
    pad("CBs", 4) + "  " +
    pad("Time", 7)
  );
  console.log("  " + "-".repeat(72));

  runs.forEach((run, i) => {
    const idx = args.last > 0 ? history.length - runs.length + i + 1 : i + 1;
    const date = run.timestamp ? run.timestamp.slice(0, 16).replace("T", " ") : "?";
    const sets = run.assembled_sets != null ? `${run.assembled_sets}/${run.target_sets}` : "?";
    const gen = run.total_generated ?? "?";
    const acc = run.total_accepted ?? "?";
    const rate = typeof run.acceptance_rate === "number" ? fmtPct(run.acceptance_rate) : "?";
    const pool = run.reserve_pool_size ?? "?";
    const cbs = run.circuit_breaker_events ?? "?";
    const time = typeof run.duration_seconds === "number" ? fmtDuration(run.duration_seconds) : "?";

    console.log(
      "  " +
      pad(idx, 3) + "  " +
      date.padEnd(16) + "  " +
      pad(sets, 6) + "  " +
      pad(gen, 5) + "  " +
      pad(acc, 5) + "  " +
      pad(rate, 7) + "  " +
      pad(pool, 5) + "  " +
      pad(cbs, 4) + "  " +
      pad(time, 7)
    );
  });

  // Summary stats
  const rates = runs.map(r => r.acceptance_rate).filter(r => typeof r === "number");
  const durations = runs.map(r => r.duration_seconds).filter(r => typeof r === "number");

  if (rates.length >= 2) {
    console.log("");
    console.log("  TRENDS:");
    const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
    const latest = rates[rates.length - 1];
    const trend = rates.length >= 3
      ? (rates[rates.length - 1] > rates[rates.length - 2] ? "improving" :
         rates[rates.length - 1] < rates[rates.length - 2] ? "declining" : "stable")
      : "n/a";
    console.log(`  Acceptance rate: avg=${fmtPct(avgRate)} latest=${fmtPct(latest)} trend=${trend}`);

    if (durations.length >= 2) {
      const avgDur = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
      console.log(`  Duration: avg=${fmtDuration(avgDur)} latest=${fmtDuration(durations[durations.length - 1])}`);
    }
  }

  // Top reject reasons across runs
  const reasonTotals = {};
  runs.forEach(run => {
    const reasons = run.top_reject_reasons || {};
    Object.entries(reasons).forEach(([k, v]) => {
      reasonTotals[k] = (reasonTotals[k] || 0) + v;
    });
  });

  const sortedReasons = Object.entries(reasonTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (sortedReasons.length > 0) {
    console.log("");
    console.log("  TOP REJECT REASONS (across shown runs):");
    sortedReasons.forEach(([k, v]) => {
      console.log(`    ${pad(v, 4)}x  ${k}`);
    });
  }

  // Circuit breaker summary from log
  try {
    const cbData = JSON.parse(readFileSync(CB_LOG_PATH, "utf8"));
    const allEvents = cbData.all_events || cbData.events || [];
    if (allEvents.length > 0) {
      const typeCounts = {};
      allEvents.forEach(e => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });
      console.log("");
      console.log(`  CIRCUIT BREAKERS (${allEvents.length} total events):`);
      Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
        console.log(`    ${type}: ${count}x triggered`);
      });
    }
  } catch (_) { /* no log */ }

  console.log("");
  console.log(bar);
}

main();
