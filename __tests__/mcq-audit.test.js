// Lock for the Claude-in-routine MCQ answer audit (lib/quality/mcqAudit.mjs).
//
// This is the deterministic half of the second-examiner: the routine model solves
// blind, this module compares. The tests assert that (1) extract never leaks the
// answer key, (2) a mismatch drops the whole item, (3) an unanswered question is
// kept-but-skipped (never silently dropped), and (4) the per-bank schema accessors
// (reading correct_answer vs listening answer vs lcr top-level answer) all resolve.

let M;
beforeAll(async () => {
  M = await import("../lib/quality/mcqAudit.mjs");
});

describe("prefixOf / questionKey", () => {
  test("extracts leading alpha prefix like merge-staging", () => {
    expect(M.prefixOf("lc-routine-20260616.json")).toBe("lc");
    expect(M.prefixOf("rdl-routine-20260616-short.json")).toBe("rdl");
    expect(M.prefixOf("ap-routine-r2-1.json")).toBe("ap");
  });
  test("question key is stable across phases", () => {
    expect(M.questionKey("ap-x.json", 2, 0)).toBe("ap-x.json#2#q0");
  });
});

describe("extractBlind — no key leakage", () => {
  const ap = [{
    id: "ap1",
    passage: "Concrete hardens through hydration.",
    questions: [
      { question_type: "factual_detail", stem: "What hardens concrete?", options: { A: "salt", B: "hydration", C: "heat", D: "sand" }, correct_answer: "B", explanation: "hydration" },
    ],
  }];

  test("includes stem/options/context but never correct_answer or explanation", () => {
    const blind = M.extractBlind(ap, "ap", "ap-x.json");
    expect(blind).toHaveLength(1);
    const q = blind[0];
    expect(q.key).toBe("ap-x.json#0#q0");
    expect(q.context).toContain("hydration");
    expect(q.options.B).toBe("hydration");
    // The dangerous bit: no answer key, no explanation anywhere in the payload.
    const json = JSON.stringify(q);
    expect(json).not.toContain("correct_answer");
    expect(json).not.toContain("explanation");
    expect(q.correct_answer).toBeUndefined();
  });

  test("skips questions without options", () => {
    const noOpts = [{ id: "x", text: "t", questions: [{ stem: "free response?" }] }];
    expect(M.extractBlind(noOpts, "rdl", "rdl-x.json")).toHaveLength(0);
  });
});

describe("applyVerdict — reading (correct_answer)", () => {
  const items = [
    { id: "ok", text: "T", questions: [{ stem: "q1", options: { A: 1, B: 2 }, correct_answer: "A" }] },
    { id: "bad", text: "T", questions: [{ stem: "q2", options: { A: 1, B: 2 }, correct_answer: "A" }] },
  ];

  test("drops the item whose marked key disagrees with the examiner", () => {
    const solved = { answers: { "rdl-x.json#0#q0": "A", "rdl-x.json#1#q0": "B" } };
    const v = M.applyVerdict(items, "rdl", "rdl-x.json", solved);
    expect(v.keptItems.map((i) => i.id)).toEqual(["ok"]);
    expect(v.rejectedItems).toEqual([{ itemIndex: 1, id: "bad" }]);
    expect(v.mismatches[0]).toMatchObject({ marked: "A", claude: "B", id: "bad" });
    expect(v.matched).toBe(1);
    expect(v.totalQ).toBe(2);
  });

  test("case/whitespace-insensitive comparison", () => {
    const solved = { answers: { "rdl-x.json#0#q0": " a ", "rdl-x.json#1#q0": "a" } };
    const v = M.applyVerdict(items, "rdl", "rdl-x.json", solved);
    expect(v.rejectedItems).toHaveLength(0);
    expect(v.matched).toBe(2);
  });

  test("an item with ANY mismatched question is dropped whole", () => {
    const multi = [{ id: "m", text: "T", questions: [
      { stem: "a", options: { A: 1, B: 2 }, correct_answer: "A" },
      { stem: "b", options: { A: 1, B: 2 }, correct_answer: "B" },
    ] }];
    const solved = { answers: { "rdl-x.json#0#q0": "A", "rdl-x.json#0#q1": "A" } };
    const v = M.applyVerdict(multi, "rdl", "rdl-x.json", solved);
    expect(v.keptItems).toHaveLength(0);
    expect(v.rejectedItems).toEqual([{ itemIndex: 0, id: "m" }]);
  });
});

describe("applyVerdict — unanswered is kept, not dropped", () => {
  const items = [{ id: "u", text: "T", questions: [{ stem: "q", options: { A: 1, B: 2 }, correct_answer: "A" }] }];
  test("missing answer → skipped, item retained", () => {
    const v = M.applyVerdict(items, "rdl", "rdl-x.json", { answers: {} });
    expect(v.keptItems.map((i) => i.id)).toEqual(["u"]);
    expect(v.rejectedItems).toHaveLength(0);
    expect(v.skipped).toHaveLength(1);
    expect(v.matched).toBe(0);
  });
});

describe("applyVerdict — listening answer-key fields", () => {
  test("lc/la/lat use question.answer", () => {
    const lc = [{ id: "c", conversation: [{ speaker: "W", text: "hi" }], questions: [{ stem: "q", options: { A: 1, B: 2 }, answer: "B" }] }];
    const blind = M.extractBlind(lc, "lc", "lc-x.json");
    expect(blind[0].context).toBe("W: hi");
    const good = M.applyVerdict(lc, "lc", "lc-x.json", { answers: { "lc-x.json#0#q0": "B" } });
    expect(good.rejectedItems).toHaveLength(0);
    const bad = M.applyVerdict(lc, "lc", "lc-x.json", { answers: { "lc-x.json#0#q0": "C" } });
    expect(bad.rejectedItems).toHaveLength(1);
  });

  test("lcr is one implicit question keyed on the item-level answer", () => {
    const lcr = [{ id: "r", speaker: "Are you free?", options: { A: "yes", B: "no", C: "maybe", D: "blue" }, answer: "A" }];
    const blind = M.extractBlind(lcr, "lcr", "lcr-x.json");
    expect(blind).toHaveLength(1);
    expect(blind[0].context).toBe("Are you free?");
    expect(blind[0].options.D).toBe("blue");
    expect(JSON.stringify(blind[0])).not.toContain('"answer"');

    const ok = M.applyVerdict(lcr, "lcr", "lcr-x.json", { answers: { "lcr-x.json#0#q0": "A" } });
    expect(ok.rejectedItems).toHaveLength(0);
    expect(ok.matched).toBe(1);
    const drop = M.applyVerdict(lcr, "lcr", "lcr-x.json", { answers: { "lcr-x.json#0#q0": "D" } });
    expect(drop.rejectedItems).toEqual([{ itemIndex: 0, id: "r" }]);
  });
});

describe("applyVerdict — accepts bare map or {answers}", () => {
  const items = [{ id: "z", text: "T", questions: [{ stem: "q", options: { A: 1, B: 2 }, correct_answer: "A" }] }];
  test("bare key→letter map works too", () => {
    const v = M.applyVerdict(items, "rdl", "rdl-x.json", { "rdl-x.json#0#q0": "A" });
    expect(v.matched).toBe(1);
    expect(v.rejectedItems).toHaveLength(0);
  });
});
