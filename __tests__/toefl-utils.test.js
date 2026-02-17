import { fmt, wc, norm } from "../lib/utils";
import { loadHist, saveSess, loadDoneIds, addDoneIds } from "../lib/sessionStore";
import { callAI, mapScoringError } from "../lib/ai/client";
import { selectBSQuestions, pickRandomPrompt } from "../lib/questionSelector";
import { renderResponseSentence } from "../lib/questionBank/renderResponseSentence";

describe("toefl utils", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  test("fmt formats mm:ss", () => {
    expect(fmt(0)).toBe("00:00");
    expect(fmt(61)).toBe("01:01");
    expect(fmt(600)).toBe("10:00");
  });

  test("wc counts words", () => {
    expect(wc("")).toBe(0);
    expect(wc("  one   two  three ")).toBe(3);
  });

  test("norm normalizes common punctuation", () => {
    expect(norm("Hello, world!")).toBe("hello world");
  });

  test("saveSess/loadHist stores at most 50 sessions", () => {
    for (let i = 0; i < 55; i += 1) {
      saveSess({ type: "email", score: 3 + (i % 2) });
    }
    const hist = loadHist();
    expect(hist.sessions).toHaveLength(50);
    expect(hist.sessions[0]).toHaveProperty("date");
  });

  test("done ids are de-duplicated", () => {
    addDoneIds("toefl-em-done", ["em1", "em2", "em1"]);
    const ids = [...loadDoneIds("toefl-em-done")];
    expect(ids.sort()).toEqual(["em1", "em2"]);
  });

  test("selectBSQuestions returns 10 valid questions", () => {
    const qs = selectBSQuestions();
    expect(qs).toHaveLength(10);
    qs.forEach((q) => {
      expect(q).toHaveProperty("id");
      expect(q).toHaveProperty("prompt");
      expect(q).toHaveProperty("answer");
      expect(Array.isArray(q.chunks)).toBe(true);
      expect(typeof q.has_question_mark).toBe("boolean");
    });
  });

  test("selectBSQuestions ignores legacy distribution options and still returns one full set", () => {
    const qs = selectBSQuestions({ easy: 5, medium: 2, hard: 2 });
    expect(qs).toHaveLength(10);
  });

  test("selectBSQuestions has no duplicate id or rendered content in one session", () => {
    const qs = selectBSQuestions();
    expect(qs).toHaveLength(10);

    const ids = qs.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);

    const rendered = qs.map((q) => renderResponseSentence(q).correctSentenceFull.trim().toLowerCase());
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  test("same question render remains deterministic with prefilled positions", () => {
    const q = {
      answer: "Could you send me the slides after class today?",
      has_question_mark: true,
      prefilled: ["you"],
      prefilled_positions: { you: 1 },
    };
    const order = ["could", "send me", "the slides", "after class", "today"];
    const out1 = renderResponseSentence(q, order).correctSentenceFull;
    const out2 = renderResponseSentence(q, order).correctSentenceFull;
    expect(out1).toBe(out2);
  });

  test("pickRandomPrompt prefers undone + unused prompt", () => {
    const data = [{ id: "a" }, { id: "b" }, { id: "c" }];
    localStorage.setItem("test-key", JSON.stringify(["a"]));
    const used = new Set([1]);
    jest.spyOn(Math, "random").mockReturnValue(0);
    const idx = pickRandomPrompt(data, used, "test-key");
    expect(idx).toBe(2);
  });

  test("callAI times out when request hangs", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(() => new Promise(() => {}));
    const p = callAI("s", "m", 100, 50);
    jest.advanceTimersByTime(60);
    await expect(p).rejects.toThrow("API timeout");
    jest.useRealTimers();
  });

  test("mapScoringError maps key categories", () => {
    expect(mapScoringError(new Error("API timeout"))).toContain("timed out");
    expect(mapScoringError(new Error("API error 401"))).toContain("Authentication failed");
    expect(mapScoringError(new Error("API error 429"))).toContain("429");
    expect(mapScoringError(new Error("Unexpected token x in JSON"))).toContain("Invalid response format");
    expect(mapScoringError(new Error("API error 500"))).toContain("temporarily unavailable");
    expect(mapScoringError(new Error("Failed to fetch"))).toContain("Network connection error");
  });
});
