#!/usr/bin/env node
/**
 * Generic regression-gate CLI over the type-agnostic harness + registry.
 *
 * REPORT / CI-test mode only this increment — NOT wired into any production merge path
 * (mergeClaude/appendBSSets/merge-staging/check-quality-gates are untouched). BS keeps
 * running its own proven scripts/bs-difficulty-scorer.mjs; cutover is a later step.
 *
 *   node scripts/cli/enforce-gates.mjs <type> --derive          # freeze standard from REAL corpus
 *   node scripts/cli/enforce-gates.mjs <type> --selfcheck       # real PASS / degraded FAIL
 *   node scripts/cli/enforce-gates.mjs <type> --gate <file>     # score a generated bank
 *
 * Exit codes mirror the live BS gate: 0 PASS · 1 FAIL · 2 instrument/stale/usage.
 */
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { REGISTRY } = require(resolve(ROOT, "lib/gate/gate-registry.js"));
const H = require(resolve(ROOT, "lib/gate/gateHarness.js"));

const [type, mode, file] = process.argv.slice(2);
const cfg = REGISTRY[type];
if (!cfg) { console.error(`unknown type "${type}". known: ${Object.keys(REGISTRY).join(", ")}`); process.exit(2); }

const f = (n) => (typeof n === "number" ? n.toFixed(3) : String(n));

if (mode === "--derive") {
  const std = H.deriveStandard(cfg);
  H.writeJSON(cfg.standardPath, std);
  console.log(`✓ derived ${type} standard from ${cfg.realPath} (n=${std.n}) → ${cfg.standardPath}`);
  for (const [k, v] of Object.entries(std.dimensions)) {
    console.log(`   ${k}: target=${f(v.target)}${v.band ? ` band=[${f(v.band[0])},${f(v.band[1])}]` : " (monitor)"}`);
  }
  process.exit(0);
}

let std;
try { std = H.readJSON(cfg.standardPath); }
catch { console.error(`no frozen standard at ${cfg.standardPath} — run --derive first`); process.exit(2); }

if (mode === "--selfcheck") {
  const sc = H.selfcheck(cfg, std);
  console.log(`instrument self-check: real-passes-all-hard=${sc.realPasses}  degraded-fails-each-hard=${sc.degradedFailsEach}`);
  if (!sc.degradedFailsEach) console.log(`  ⚠ degraded fixture did NOT fail: ${sc.degradedNotFailing.join(", ")} — regenerate fixture`);
  console.log(sc.ok ? "✓ scorer discriminates (real PASS / degraded FAIL on every hard gate)" : "✗ scorer NOT discriminative");
  process.exit(sc.ok ? 0 : 2);
}

if (mode === "--gate" && file) {
  if (!H.freshnessOk(cfg, std)) { console.error("✗ frozen standard is STALE (≠ fresh re-derive) — re-run --derive"); process.exit(2); }
  const sc = H.selfcheck(cfg, std);
  if (!sc.ok) { console.error("✗ instrument self-check failed — scorer not trustworthy"); process.exit(2); }
  const r = H.score(cfg, std, H.loadItems(cfg, file));
  console.log(`\n════ ${type.toUpperCase()} REGRESSION GATE: ${file} (n=${r.n}) ════`);
  for (const c of r.checks) {
    const mark = c.verdict === "PASS" ? "✓" : c.verdict === "FAIL" ? "✗" : "~";
    console.log(`  ${mark} ${c.name}: got ${f(c.got)}${c.band ? ` band [${f(c.band[0])},${f(c.band[1])}]` : ` (monitor, real ${f(c.target)})`}`);
  }
  console.log(`\n════ GATE: ${r.verdict} ════${r.fails.length ? ` (FAIL: ${r.fails.join(", ")})` : ""}`);
  process.exit(r.verdict === "PASS" ? 0 : 1);
}

console.error("usage: enforce-gates.mjs <type> [--derive | --selfcheck | --gate <file>]");
process.exit(2);
