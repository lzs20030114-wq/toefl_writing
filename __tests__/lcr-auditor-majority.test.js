/**
 * lcrAuditor 3 票多数盲审 — 聚合逻辑测试（2026-08-02 加固）
 *
 * 规则：键答案需多数可用票一致；任何一票发现第二个 valid 选项即否决；
 * 可用票 <2 → error（合库层 fail-closed）。
 */

const { auditLCRItemMajority, auditLCRBatchMajority } = require("../lib/listeningGen/lcrAuditor");

const ITEM = {
  id: "lcr_test_1",
  speaker: "Have you been getting any sleep lately?",
  options: {
    A: "Sleep is important for memory.",
    B: "Honestly, barely four hours a night.",
    C: "I bought a new pillow online yesterday.",
    D: "The store closes at nine tonight.",
  },
  answer: "B",
  situation: "expressing concern about a friend who looks exhausted",
};

// 构造一个按顺序吐出预设回复的假 callAI
function scriptedAI(responses) {
  let i = 0;
  return async () => responses[i++ % responses.length];
}

const vote = (best, ratings) => JSON.stringify({ ratings, best, reasoning: "test" });
const CLEAN_B = vote("B", { A: "invalid", B: "valid", C: "invalid", D: "invalid" });
const DISSENT_C_PARTIAL = vote("C", { A: "invalid", B: "partially_valid", C: "partially_valid", D: "invalid" });
const AMBIG_TWO_VALID = vote("B", { A: "invalid", B: "valid", C: "valid", D: "invalid" });
const MISMATCH_C_VALID = vote("C", { A: "invalid", B: "partially_valid", C: "valid", D: "invalid" });
const GARBAGE = "not json at all";

test("3/3 一致且无歧义 → match, 不 ambiguous", async () => {
  const r = await auditLCRItemMajority(ITEM, scriptedAI([CLEAN_B, CLEAN_B, CLEAN_B]));
  expect(r.error).toBeUndefined();
  expect(r.match).toBe(true);
  expect(r.ambiguous).toBe(false);
  expect(r.agreeCount).toBe(3);
});

test("2/3 多数一致（异见票未见第二 valid）→ match 通过", async () => {
  const r = await auditLCRItemMajority(ITEM, scriptedAI([CLEAN_B, DISSENT_C_PARTIAL, CLEAN_B]));
  expect(r.match).toBe(true);
  expect(r.ambiguous).toBe(false);
});

test("任一票发现两个 valid 选项 → ambiguous 否决", async () => {
  const r = await auditLCRItemMajority(ITEM, scriptedAI([CLEAN_B, AMBIG_TWO_VALID, CLEAN_B]));
  expect(r.ambiguous).toBe(true);
});

test("多数票改判他选（且判其 valid）→ 不 match", async () => {
  const r = await auditLCRItemMajority(ITEM, scriptedAI([MISMATCH_C_VALID, MISMATCH_C_VALID, CLEAN_B]));
  expect(r.match).toBe(false);
  expect(r.aiAnswer).toBe("C");
});

test("可用票 <2 → error", async () => {
  const r = await auditLCRItemMajority(ITEM, scriptedAI([GARBAGE, GARBAGE, CLEAN_B]));
  expect(r.error).toBe(true);
});

test("batch fail-closed：audit error 的题进 flagged 不进 clean", async () => {
  const r = await auditLCRBatchMajority([{ ...ITEM }], scriptedAI([GARBAGE, GARBAGE, GARBAGE]));
  expect(r.errors).toBe(1);
  expect(r.clean).toHaveLength(0);
  expect(r.flagged).toHaveLength(1);
  expect(r.flagged[0].audit_result.error).toBe(true);
});

test("batch 干净题进 clean 并带 _audit 票数", async () => {
  const r = await auditLCRBatchMajority([{ ...ITEM }], scriptedAI([CLEAN_B, CLEAN_B, CLEAN_B]));
  expect(r.clean).toHaveLength(1);
  expect(r.clean[0]._audit).toEqual({ match: true, ambiguous: false, votes: 3, agree: 3 });
});
