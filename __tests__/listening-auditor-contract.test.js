// Contract lock for the listening auditors ↔ merge-staging.mjs.
//
// merge-staging's auditItems() consumes the listening auditors through a narrow
// contract: each auditXItem(item, callAI) resolves to an object where
//   - res.match === false  → drop the item (answer mismatch vs second examiner)
//   - res.error            → audit failed; the message is in errorMsg OR reasoning
//     (la/lat/lc use errorMsg, lcr uses reasoning — auditItems reads both)
// If an auditor's return shape ever drifts from this, listening items would be
// silently mis-handled (the exact "wired but quietly broken" failure this repo
// keeps hitting). These tests fail loudly if that contract breaks — without any
// network call, by injecting a stub callAI.

const la = require("../lib/listeningGen/laAuditor.js");
const lat = require("../lib/listeningGen/latAuditor.js");
const lc = require("../lib/listeningGen/lcAuditor.js");
const lcr = require("../lib/listeningGen/lcrAuditor.js");

// Minimal valid items per schema (only the fields each auditor reads).
const mcqQ = (answer) => ({ stem: "q?", options: { A: "a", B: "b", C: "c", D: "d" }, answer });
const ITEMS = {
  la:  { announcement: "x", questions: [mcqQ("B")] },
  lat: { transcript: "x", questions: [mcqQ("B")] },
  lc:  { conversation: [{ speaker: "W", text: "x" }], questions: [mcqQ("B")] },
  lcr: { speaker: "x", options: { A: "a", B: "b", C: "c", D: "d" }, answer: "B" },
};

// Stub callAI returning each auditor's expected JSON shape.
const multiQ = (best) => async () => JSON.stringify({ questions: [{ question_index: 0, best, ratings: { A: "invalid", B: "valid", C: "invalid", D: "invalid" } }] });
const singleQ = (best) => async () => JSON.stringify({ best, ratings: { A: "invalid", B: "valid", C: "invalid", D: "invalid" } });
const garbage = async () => "not json at all";
const apiKeyThrow = async () => { throw new Error("DEEPSEEK_API_KEY not set"); };

const AUDITORS = {
  la:  { fn: la.auditLAItem,  item: ITEMS.la,  okStub: multiQ, marked: "B" },
  lat: { fn: lat.auditLATItem, item: ITEMS.lat, okStub: multiQ, marked: "B" },
  lc:  { fn: lc.auditLCItem,  item: ITEMS.lc,  okStub: multiQ, marked: "B" },
  lcr: { fn: lcr.auditLCRItem, item: ITEMS.lcr, okStub: singleQ, marked: "B" },
};

describe.each(Object.entries(AUDITORS))("%s auditor contract", (name, a) => {
  test("agreeing examiner → match true, no error", async () => {
    const res = await a.fn(a.item, a.okStub(a.marked));
    expect(res.error).toBeFalsy();
    expect(res.match).toBe(true);
  });

  test("disagreeing examiner → match false (this is what merge-staging drops on)", async () => {
    const res = await a.fn(a.item, a.okStub("D"));
    expect(res.error).toBeFalsy();
    expect(res.match).toBe(false);
  });

  test("unparseable response → error true with a message (errorMsg or reasoning)", async () => {
    const res = await a.fn(a.item, garbage);
    expect(res.error).toBe(true);
    const msg = res.errorMsg || res.reasoning;
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  test("api-key failure surfaces a message merge-staging's skip-regex matches", async () => {
    const res = await a.fn(a.item, apiKeyThrow);
    expect(res.error).toBe(true);
    const msg = res.errorMsg || res.reasoning || "";
    // merge-staging: /api[_ ]?key|not set|deepseek_api_key/i
    expect(/api[_ ]?key|not set|deepseek_api_key/i.test(msg)).toBe(true);
  });
});
