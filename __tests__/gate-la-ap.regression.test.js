// Regression lock for the LA/AP gate-registry entries (2026-07-11).
//
// The registry+harness is the repo's canonical freeze mechanism (report/CI layer
// today; production enforcement lives in check-quality-gates + mergeClaude
// hard-rejects). This test locks: the entries validate, the frozen standards
// are fresh (corpus unchanged → derive reproduces them), and the instrument
// discriminates (real corpus PASSES every hard gate, the degraded fixture —
// genuine pre-fix bank items — FAILS every hard gate).

const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { REGISTRY } = require(path.join(ROOT, "lib/gate/gate-registry.js"));
const H = require(path.join(ROOT, "lib/gate/gateHarness.js"));

for (const type of ["la", "ap"]) {
  describe(`gate registry: ${type}`, () => {
    const cfg = REGISTRY[type];

    test("entry exists with noFlatten (items carry questions[] legitimately)", () => {
      expect(cfg).toBeTruthy();
      expect(cfg.noFlatten).toBe(true);
    });

    test("frozen standard is fresh (re-derive reproduces it)", () => {
      const std = H.readJSON(cfg.standardPath);
      expect(H.freshnessOk(cfg, std)).toBe(true);
    });

    test("instrument discriminates: real PASSES, degraded fixture FAILS every hard gate", () => {
      const std = H.readJSON(cfg.standardPath);
      const sc = H.selfcheck(cfg, std);
      expect(sc.realPasses).toBe(true);
      expect(sc.degradedFailsEach).toBe(true);
      expect(sc.hardDims.length).toBeGreaterThan(0);
    });
  });
}
