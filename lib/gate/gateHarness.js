"use strict";
/**
 * Type-agnostic regression-gate harness — the generalized engine extracted from the
 * design of scripts/bs-difficulty-scorer.mjs (BS's own live scorer is NOT touched; this
 * is additive). Given a per-type config from lib/gate/gate-registry.js it:
 *   deriveStandard → freeze targets from the REAL corpus
 *   freshnessOk    → frozen standard must equal a fresh in-memory re-derive (anti-stale)
 *   selfcheck      → real PASSES every hard gate; degraded fixture FAILS every hard gate
 *   score/gate     → all-dimensions verdict (PASS iff every hard gate in-band; monitor=info)
 *
 * The anti-regression guarantees live here, registry-wide (not anchored to one dimension):
 *  - targets derive ONLY from the real corpus (the registry validator forbids bank/staging paths)
 *  - the all-or-nothing verdict prevents "fix one dim by breaking another"
 *  - freshness re-derive prevents silently loosening the frozen ruler
 *  - the self-check loops EVERY hard-gate dim so adding a dim can't bypass discrimination.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const FRESHNESS_TOL = 1e-6;

function readJSON(p) { return JSON.parse(fs.readFileSync(path.resolve(ROOT, p), "utf8")); }
function writeJSON(p, d) { fs.writeFileSync(path.resolve(ROOT, p), JSON.stringify(d, null, 2) + "\n", "utf8"); }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

function loadItems(cfg, file) {
  const j = readJSON(file);
  const key = cfg.realItemsKey || "items";
  let arr = Array.isArray(j) ? j : (j[key] || j.items || j.question_sets || []);
  // tolerate BS-style set-nested banks (question_sets → questions); reading/CTW are flat
  if (arr.length && arr[0] && Array.isArray(arr[0].questions)) arr = arr.flatMap((s) => s.questions);
  return arr;
}

// aggregate per-item measures into one statistic per dimension (mean for now)
function aggregate(cfg, items) {
  const per = cfg.measure(items);
  const out = {};
  for (const d of cfg.dimensions) {
    const vals = per.map((r) => r[d.name]).filter((v) => typeof v === "number" && !Number.isNaN(v));
    out[d.name] = mean(vals); // only "mean" agg today; field reserved for future (median/share)
  }
  return out;
}

// DERIVE a frozen standard from the REAL corpus only.
function deriveStandard(cfg) {
  if (/[\\/](bank|staging)[\\/]|questions\.json/.test(cfg.realPath)) {
    throw new Error(`refuse to derive from a generated path: ${cfg.realPath}`); // belt-and-suspenders vs registry validator
  }
  const items = loadItems(cfg, cfg.realPath);
  const agg = aggregate(cfg, items);
  const dimensions = {};
  for (const d of cfg.dimensions) {
    const target = agg[d.name];
    const entry = { policy: d.policy, target, detector_precision: d.detector_precision };
    if (d.policy === "hard") entry.band = [target - d.tol, target + d.tol];
    else if (d.policy === "drift") entry.band = [target * (1 - d.tol), target * (1 + d.tol)];
    dimensions[d.name] = entry;
  }
  return { type: cfg.type, derived_from: cfg.realPath, n: items.length, dimensions };
}

const inBand = (v, band) => v >= band[0] && v <= band[1];

// score a batch/bank against the frozen standard
function score(cfg, std, items) {
  const agg = aggregate(cfg, items);
  const checks = cfg.dimensions.map((d) => {
    const sd = std.dimensions[d.name];
    const got = agg[d.name];
    if (d.policy === "monitor") return { name: d.name, policy: d.policy, got, target: sd.target, verdict: "INFO" };
    return { name: d.name, policy: d.policy, got, band: sd.band, verdict: inBand(got, sd.band) ? "PASS" : "FAIL" };
  });
  const fails = checks.filter((c) => c.verdict === "FAIL").map((c) => c.name);
  return { n: items.length, checks, verdict: fails.length === 0 ? "PASS" : "FAIL", fails };
}

// instrument self-check: real PASSES every hard gate, degraded fixture FAILS every hard gate
function selfcheck(cfg, std) {
  const real = score(cfg, std, loadItems(cfg, cfg.realPath));
  const degraded = score(cfg, std, loadItems(cfg, cfg.fixturePath));
  const hardDims = cfg.dimensions.filter((d) => d.policy === "hard").map((d) => d.name);
  const v = (r, n) => r.checks.find((c) => c.name === n).verdict;
  const realPasses = hardDims.every((n) => v(real, n) === "PASS");
  const degradedFailsEach = hardDims.every((n) => v(degraded, n) === "FAIL");
  return {
    ok: realPasses && degradedFailsEach && hardDims.length > 0,
    realPasses, degradedFailsEach, hardDims,
    degradedNotFailing: hardDims.filter((n) => v(degraded, n) !== "FAIL"),
  };
}

// freshness: frozen standard must equal a fresh in-memory re-derive (corpus/standard not stale)
function freshnessOk(cfg, std) {
  const fresh = deriveStandard(cfg);
  return cfg.dimensions.every((d) => {
    const a = std.dimensions[d.name], b = fresh.dimensions[d.name];
    return a && b && Math.abs(a.target - b.target) <= FRESHNESS_TOL;
  });
}

module.exports = { deriveStandard, score, selfcheck, freshnessOk, loadItems, aggregate, readJSON, writeJSON, FRESHNESS_TOL };
