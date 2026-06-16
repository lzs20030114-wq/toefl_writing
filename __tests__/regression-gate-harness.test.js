"use strict";
/**
 * Proves the generalized, self-evolving regression-gate harness is EFFECTIVE & SOUND,
 * and ADDITIVE (the live BS scorer + its callers are untouched by this increment).
 */
const fs = require("fs");
const path = require("path");
const { REGISTRY, validateRegistry } = require("../lib/gate/gate-registry.js");
const H = require("../lib/gate/gateHarness.js");

const ctw = REGISTRY.ctw;

describe("regression-gate harness — registry guardrails (anti-regression invariants)", () => {
  test("the real registry is well-formed + frozen", () => {
    expect(validateRegistry(REGISTRY)).toBe(true);
    expect(Object.isFrozen(REGISTRY)).toBe(true);
    expect(Object.isFrozen(ctw)).toBe(true);
  });
  test("hard-gate FORBIDDEN below 0.95 detector precision (noisy detector can't silently false-reject)", () => {
    const bad = { x: { ...ctw, dimensions: [{ name: "d", policy: "hard", agg: "mean", tol: 1, detector_precision: 0.8, why_added: "x" }] } };
    expect(() => validateRegistry(bad)).toThrow(/hard-gate FORBIDDEN/);
  });
  test("missing why_added rationale rejected", () => {
    const bad = { x: { ...ctw, dimensions: [{ name: "d", policy: "monitor", agg: "mean", detector_precision: 0.9 }] } };
    expect(() => validateRegistry(bad)).toThrow(/why_added/);
  });
  test("policy must be in {hard,drift,monitor}", () => {
    const bad = { x: { ...ctw, dimensions: [{ name: "d", policy: "block", agg: "mean", tol: 1, detector_precision: 1, why_added: "x" }] } };
    expect(() => validateRegistry(bad)).toThrow(/policy must be one of/);
  });
  test("hard/drift dimension requires a numeric tolerance", () => {
    const bad = { x: { ...ctw, dimensions: [{ name: "d", policy: "hard", agg: "mean", detector_precision: 1, why_added: "x" }] } };
    expect(() => validateRegistry(bad)).toThrow(/requires a numeric/);
  });
  test("realPath cannot point at a generated bank/staging (derive-from-real-only)", () => {
    const bad = { x: { ...ctw, realPath: "data/reading/bank/ctw.json" } };
    expect(() => validateRegistry(bad)).toThrow(/REAL-exam corpus/);
  });
});

describe("regression-gate harness — derive / freshness / self-check (CTW, 2nd type)", () => {
  test("harness refuses to derive a standard from a generated path", () => {
    expect(() => H.deriveStandard({ ...ctw, realPath: "data/reading/bank/ctw.json" })).toThrow(/refuse to derive/);
  });
  test("derive is deterministic and freshness re-derive matches the frozen standard", () => {
    const std = H.deriveStandard(ctw);
    expect(std.n).toBeGreaterThanOrEqual(40); // real corpus has 75 passages
    expect(std.dimensions.passage_word_count.band).toHaveLength(2);
    expect(H.freshnessOk(ctw, std)).toBe(true);
    const stale = JSON.parse(JSON.stringify(std));
    stale.dimensions.passage_word_count.target += 5; // mutating a frozen target trips freshness
    expect(H.freshnessOk(ctw, stale)).toBe(false);
  });
  test("instrument self-check: real PASSES every hard gate, degraded fixture FAILS each", () => {
    const std = H.deriveStandard(ctw);
    const sc = H.selfcheck(ctw, std);
    expect(sc.realPasses).toBe(true);
    expect(sc.degradedFailsEach).toBe(true);
    expect(sc.ok).toBe(true);
  });
  test("gate produces a deterministic all-dimensions verdict on the live generated CTW bank", () => {
    const std = H.deriveStandard(ctw);
    const r = H.score(ctw, std, H.loadItems(ctw, "data/reading/bank/ctw.json"));
    expect(r.n).toBeGreaterThan(50);
    expect(["PASS", "FAIL"]).toContain(r.verdict);
    r.checks.forEach((c) => expect(["PASS", "FAIL", "INFO"]).toContain(c.verdict));
    // monitor dims never flip the verdict
    const hardFails = r.checks.filter((c) => c.policy === "hard" && c.verdict === "FAIL").length;
    expect(r.verdict === "FAIL").toBe(hardFails > 0);
  });
});

describe("regression-gate harness — self-evolving (declare a dimension → auto-incorporated)", () => {
  test("adding ONE new dimension auto-derives + freezes + self-checks, with no harness edits", () => {
    const extraDim = { name: "passage_char_count", policy: "monitor", agg: "mean", detector_precision: 1.0, why_added: "demo: declared dim is auto-incorporated" };
    const cfg2 = {
      ...ctw,
      dimensions: [...ctw.dimensions, extraDim],
      measure: (items) => ctw.measure(items).map((m, i) => ({
        ...m,
        passage_char_count: String((items[i] && (items[i].passage || items[i].paragraph || items[i].text)) || "").length,
      })),
    };
    const std2 = H.deriveStandard(cfg2);
    expect(std2.dimensions.passage_char_count).toBeDefined();      // appeared in the frozen standard
    expect(std2.dimensions.passage_char_count.target).toBeGreaterThan(0);
    expect(H.freshnessOk(cfg2, std2)).toBe(true);                  // freshness now covers the new dim
  });
});

describe("regression-gate harness — ISOLATION (live BS gate untouched)", () => {
  test("the harness + registry have NO code coupling to the live BS gate / merge path", () => {
    const reg = fs.readFileSync(path.resolve(__dirname, "../lib/gate/gate-registry.js"), "utf8");
    const harn = fs.readFileSync(path.resolve(__dirname, "../lib/gate/gateHarness.js"), "utf8");
    const src = reg + harn;
    // no shelling out to the live scorer, and no require() of any script / the live gate
    expect(src).not.toMatch(/child_process|execSync|spawnSync/);
    expect(src).not.toMatch(/require\(\s*['"][^'"]*scripts\//);
    expect(src).not.toMatch(/require\(\s*['"][^'"]*bs-difficulty-scorer/);
  });
});
