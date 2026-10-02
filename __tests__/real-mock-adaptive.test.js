import {
  calculateRealAdaptiveScore,
  routeRealModule,
  validateRealAdaptivePaper,
} from "../lib/realMockExam/adaptiveScore";
import {
  saveAdaptiveCheckpoint, loadAdaptiveCheckpoint, clearAdaptiveCheckpoint,
} from "../lib/mockExam/adaptiveCheckpoint";

function item(id, type, count, role = "scored") {
  if (type === "ctw") return { id, taskType: type, realMockRole: role, blanks: Array.from({ length: count }, () => ({})) };
  if (type === "lcr") return { id, taskType: type, realMockRole: role, answer: "A" };
  return { id, taskType: type, realMockRole: role, questions: Array.from({ length: count }, () => ({})) };
}

function readingPaper() {
  return {
    attemptId: "attempt-1", userCode: "ABC123", section: "reading", templateVersion: "2026-full-v1",
    routeThreshold: 0.6,
    timing: { module1Seconds: 1260, module2Seconds: { upper: 540, lower: 540 } },
    m1Items: [
      item("m1-ctw-a", "ctw", 10), item("m1-rdl-a", "rdl", 2), item("m1-rdl-b", "rdl", 3), item("m1-ap", "ap", 5),
      item("m1-ctw-b", "ctw", 10, "practice-extra"), item("m1-rdl-c", "rdl", 2, "practice-extra"), item("m1-rdl-d", "rdl", 3, "practice-extra"),
    ],
    m2ByPath: {
      upper: [item("up-ctw", "ctw", 10), item("up-ap", "ap", 5)],
      lower: [item("lo-ctw", "ctw", 10), item("lo-rdl-a", "rdl", 2), item("lo-rdl-b", "rdl", 3)],
    },
  };
}

function listeningPaper() {
  const lcr = (prefix, n, role = "scored") => Array.from({ length: n }, (_, i) => item(`${prefix}-${i}`, "lcr", 1, role));
  return {
    attemptId: "listen-1", userCode: "ABC123", section: "listening", templateVersion: "2026-full-v1",
    timing: { module1Seconds: 1080, module2Seconds: { upper: 660, lower: 420 } },
    m1Items: [
      ...lcr("scored", 8), item("sc-lc-a", "lc", 2), item("sc-lc-b", "lc", 2), item("sc-la-a", "la", 2), item("sc-la-b", "la", 2), item("sc-lat", "lat", 4),
      ...lcr("extra", 4, "practice-extra"), item("ex-lc", "lc", 2, "practice-extra"), item("ex-la", "la", 2, "practice-extra"), item("ex-lat", "lat", 4, "practice-extra"),
    ],
    m2ByPath: {
      upper: [...lcr("up", 3), item("up-lc-a", "lc", 2), item("up-lc-b", "lc", 2), item("up-lat-a", "lat", 4), item("up-lat-b", "lat", 4)],
      lower: [...lcr("lo", 7), item("lo-lc-a", "lc", 2), item("lo-lc-b", "lc", 2), item("lo-la-a", "la", 2), item("lo-la-b", "la", 2)],
    },
  };
}

describe("real adaptive reading score and route", () => {
  test("only the 20 scored M1 questions choose the path", () => {
    const paper = readingPaper();
    const results = paper.m1Items.map((it) => ({ correct: it.realMockRole === "scored" ? (it.id === "m1-ctw-a" ? 10 : 0) : 15 }));
    expect(routeRealModule(paper.m1Items, results, 0.6)).toBe("lower");
    results[1].correct = 2;
    expect(routeRealModule(paper.m1Items, results, 0.6)).toBe("upper");
  });

  test("timeout unanswered scored questions stay in the 35 denominator; extra stays outside", () => {
    const paper = readingPaper();
    const m1 = paper.m1Items.map((it) => ({ correct: it.realMockRole === "practice-extra" ? 10 : 0 }));
    const m2 = paper.m2ByPath.lower.map(() => ({ correct: 0 }));
    const score = calculateRealAdaptiveScore(paper.m1Items, m1, paper.m2ByPath.lower, m2, "lower");
    expect(score).toMatchObject({ correct: 0, total: 35, extraTotal: 15, band: 1, path: "lower" });
    expect(score.extraCorrect).toBe(15);
    m1[0].correct = 10;
    m2[0].correct = 10;
    expect(calculateRealAdaptiveScore(paper.m1Items, m1, paper.m2ByPath.lower, m2, "lower").band).toBe(4);
  });

  test("both M2 routes must have their specified task mix before a paper can start", () => {
    const paper = readingPaper();
    expect(validateRealAdaptivePaper(paper, "reading", "ABC123")).toBe(true);
    paper.m2ByPath.lower = [item("wrong-ctw", "ctw", 10), item("wrong-ap", "ap", 5)];
    expect(validateRealAdaptivePaper(paper, "reading", "ABC123")).toBe(false);
  });

  test("a lower route can estimate 4.5 without the ordinary mock's 4.0 cap", () => {
    const paper = readingPaper();
    const m1 = paper.m1Items.map(() => ({ correct: 0 }));
    m1[0].correct = 10;
    m1[1].correct = 1;
    expect(routeRealModule(paper.m1Items, m1)).toBe("lower");
    const m2 = paper.m2ByPath.lower.map((it) => ({ correct: it.taskType === "ctw" ? 10 : it.questions.length }));
    expect(calculateRealAdaptiveScore(paper.m1Items, m1, paper.m2ByPath.lower, m2, "lower")).toMatchObject({ correct: 26, total: 35, band: 4.5 });
  });

  test("listening validates 32+15 with genuinely different upper/lower task types", () => {
    const paper = listeningPaper();
    expect(validateRealAdaptivePaper(paper, "listening", "ABC123")).toBe(true);
    paper.m2ByPath.lower = paper.m2ByPath.upper;
    expect(validateRealAdaptivePaper(paper, "listening", "ABC123")).toBe(false);
  });
});

describe("adaptive checkpoint isolation", () => {
  beforeEach(() => localStorage.clear());
  const standard = { phase: "module1", m1Items: [{ id: "ordinary" }], currentItemIndex: 0 };
  const real = { phase: "module1", m1Items: [{ id: "real" }], currentItemIndex: 0, paper: readingPaper() };
  const options = { source: "real-bank", userCode: "ABC123", templateVersion: "2026-full-v1" };

  test("ordinary checkpoint retains the legacy key and cannot be loaded as real", () => {
    saveAdaptiveCheckpoint("reading", standard);
    expect(localStorage.getItem("toefl-adaptive-checkpoint:reading")).toBeTruthy();
    expect(loadAdaptiveCheckpoint("reading")?.m1Items[0].id).toBe("ordinary");
    expect(loadAdaptiveCheckpoint("reading", options)).toBeNull();
  });

  test("real checkpoint refuses wrong account, source, and template", () => {
    saveAdaptiveCheckpoint("reading", real, options);
    expect(loadAdaptiveCheckpoint("reading", options)?.paper.attemptId).toBe("attempt-1");
    expect(loadAdaptiveCheckpoint("reading", { ...options, userCode: "OTHER1" })).toBeNull();
    expect(loadAdaptiveCheckpoint("reading", { ...options, templateVersion: "future" })).toBeNull();
    expect(loadAdaptiveCheckpoint("reading")).toBeNull();
    clearAdaptiveCheckpoint("reading", options);
    expect(loadAdaptiveCheckpoint("reading", options)).toBeNull();
  });
});
