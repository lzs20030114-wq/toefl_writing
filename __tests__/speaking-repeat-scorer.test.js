import { scoreRepeat } from "../lib/speakingEval/repeatScorer";
import {
  calculateSpeakingBand,
  computeSpeakingRaw,
  rawToSpeakingBand,
} from "../lib/mockExam/speakingBand";

// Convenience: score → official level (integer 0-5).
const level = (orig, trans) => scoreRepeat(orig, trans).officialLevel;

describe("scoreRepeat — official 0-5 holistic rubric", () => {
  // ── Level 5: exact repetition (incl. normalization-only differences) ──────────
  describe("level 5 — exact repetition", () => {
    test("verbatim repetition", () => {
      const s = "the students discussed the economic impact of new tariffs";
      expect(level(s, s)).toBe(5);
    });

    test("contraction difference is NOT an error (it is ≡ it's)", () => {
      const orig = "it is important that we arrive on time";
      const trans = "it's important that we arrive on time";
      expect(level(orig, trans)).toBe(5);
    });

    test("contraction difference the other way (it's ≡ it is)", () => {
      const orig = "it's clear that they will finish the project";
      const trans = "it is clear that they will finish the project";
      expect(level(orig, trans)).toBe(5);
    });

    test("number spelling difference is NOT an error (twenty ≡ 20)", () => {
      const orig = "there are twenty students waiting in the lecture hall";
      const trans = "there are 20 students waiting in the lecture hall";
      expect(level(orig, trans)).toBe(5);
    });

    test("score and officialLevel agree, breakdown is clean", () => {
      const s = "the meeting will begin at noon in the main office";
      const r = scoreRepeat(s, s);
      expect(r.score).toBe(5);
      expect(r.officialLevel).toBe(5);
      expect(r.accuracy).toBe(100);
      expect(r.errorBreakdown).toEqual({
        functionWordErrors: 0,
        contentWordErrors: 0,
        transpositions: 0,
      });
      expect(r.missedWords).toHaveLength(0);
    });
  });

  // ── Level 4: meaning captured, minor changes ──────────────────────────────────
  describe("level 4 — meaning captured, minor changes", () => {
    test("one function word dropped (the)", () => {
      const orig = "the professor explained the theory clearly to the class";
      const trans = "professor explained the theory clearly to the class";
      expect(level(orig, trans)).toBe(4);
    });

    test("two adjacent words transposed", () => {
      const orig = "she quickly ran to the corner store for milk";
      const trans = "she ran quickly to the corner store for milk";
      expect(level(orig, trans)).toBe(4);
    });

    test("a tense marker is wrong (walked → walk)", () => {
      const orig = "they walked to the station early yesterday morning";
      const trans = "they walk to the station early yesterday morning";
      expect(level(orig, trans)).toBe(4);
    });
  });

  // ── Level 3: essentially full sentence, meaning not accurately captured ────────
  describe("level 3 — full sentence but meaning not accurately captured", () => {
    test("multiple function words dropped + one content word changed, still full", () => {
      const orig = "the teacher gave the students a long list of new words";
      const trans = "teacher gave students a short list new words";
      expect(level(orig, trans)).toBe(3);
    });
  });

  // ── Level 2: significant part missing / truncated ─────────────────────────────
  describe("level 2 — significant part missing (truncation)", () => {
    test("repeats only the first half then stops", () => {
      const orig =
        "the committee decided to postpone the meeting until next week because of the storm";
      const trans = "the committee decided to postpone the meeting";
      expect(level(orig, trans)).toBe(2);
    });
  });

  // ── Level 1: minimal response of a few words ──────────────────────────────────
  describe("level 1 — minimal few-word response", () => {
    test("only two or three words", () => {
      const orig =
        "the researchers presented their findings at the international conference in Tokyo";
      const trans = "the researchers";
      expect(level(orig, trans)).toBe(1);
    });
  });

  // ── Level 0: no response / no English / unconnected ───────────────────────────
  describe("level 0 — no response / no English / unconnected", () => {
    test("empty transcript", () => {
      const orig = "the students discussed the economic impact of tariffs";
      expect(level(orig, "")).toBe(0);
    });

    test("no English (Chinese-only transcript)", () => {
      const orig = "the students discussed the economic impact of tariffs";
      expect(level(orig, "我不知道这个句子怎么说")).toBe(0);
    });

    test("entirely unconnected English sentence", () => {
      const orig = "photosynthesis converts sunlight into chemical energy inside plant cells";
      const trans = "my favorite hobby is playing basketball";
      expect(level(orig, trans)).toBe(0);
    });
  });

  // ── errorBreakdown classification ─────────────────────────────────────────────
  describe("errorBreakdown classification", () => {
    test("dropped function word counts as a function-word error", () => {
      const orig = "the professor explained the theory to the class";
      const trans = "professor explained the theory to the class";
      const r = scoreRepeat(orig, trans);
      expect(r.errorBreakdown.functionWordErrors).toBe(1);
      expect(r.errorBreakdown.contentWordErrors).toBe(0);
      expect(r.errorBreakdown.transpositions).toBe(0);
    });

    test("content word swapped for an unrelated word counts as a content-word error", () => {
      const orig = "we discussed the economy during the lecture this afternoon";
      const trans = "we discussed the weather during the lecture this afternoon";
      const r = scoreRepeat(orig, trans);
      expect(r.errorBreakdown.contentWordErrors).toBe(1);
      expect(r.errorBreakdown.functionWordErrors).toBe(0);
    });

    test("adjacent swap counts as one transposition, not two substitutions", () => {
      const orig = "she quickly ran to the corner store for milk";
      const trans = "she ran quickly to the corner store for milk";
      const r = scoreRepeat(orig, trans);
      expect(r.errorBreakdown.transpositions).toBe(1);
      expect(r.errorBreakdown.contentWordErrors).toBe(0);
      expect(r.errorBreakdown.functionWordErrors).toBe(0);
    });

    test("tense marker change is booked as a (minor) function-word-tier error", () => {
      const orig = "they walked to the station early yesterday morning";
      const trans = "they walk to the station early yesterday morning";
      const r = scoreRepeat(orig, trans);
      expect(r.errorBreakdown.functionWordErrors).toBe(1);
      expect(r.errorBreakdown.contentWordErrors).toBe(0);
    });
  });

  // ── Output shape / UI-highlight contract ──────────────────────────────────────
  describe("output shape (UI backward compatibility)", () => {
    test("returns all legacy fields plus the new ones", () => {
      const r = scoreRepeat("the cat sat on the mat", "the cat sat on the mat");
      expect(r).toHaveProperty("accuracy");
      expect(r).toHaveProperty("matchedWords");
      expect(r).toHaveProperty("missedWords");
      expect(r).toHaveProperty("extraWords");
      expect(r).toHaveProperty("score");
      expect(r).toHaveProperty("officialLevel");
      expect(r).toHaveProperty("errorBreakdown");
      expect(Number.isInteger(r.score)).toBe(true);
    });

    test("matchedWords use UI-normalized ORIGINAL word forms (contraction case)", () => {
      // Original text is "it is ..."; matched pool must contain the UI-normalized
      // original words ("it", "is"), so WordHighlight (which normalizes each rendered
      // original word) highlights them green.
      const orig = "it is a wonderful day today";
      const trans = "it's a wonderful day today";
      const r = scoreRepeat(orig, trans);
      expect(r.matchedWords).toEqual(
        expect.arrayContaining(["it", "is", "a", "wonderful", "day", "today"]),
      );
      expect(r.missedWords).toHaveLength(0);
    });

    test("matched pool aligns with number word original form (twenty, not 20)", () => {
      const orig = "twenty people attended the workshop";
      const trans = "20 people attended the workshop";
      const r = scoreRepeat(orig, trans);
      // UI renders "twenty" and normalizes it to "twenty" — that form must be present.
      expect(r.matchedWords).toContain("twenty");
      expect(r.missedWords).toHaveLength(0);
    });

    test("missed word appears in missedWords for highlight", () => {
      const orig = "the professor explained the theory to the class";
      const trans = "professor explained the theory to the class";
      const r = scoreRepeat(orig, trans);
      expect(r.missedWords).toContain("the");
    });

    test("empty transcript marks every original word missed", () => {
      const r = scoreRepeat("the cat sat on the mat", "");
      expect(r.score).toBe(0);
      expect(r.matchedWords).toHaveLength(0);
      expect(r.missedWords).toEqual(["the", "cat", "sat", "on", "the", "mat"]);
    });
  });
});

// ── Task 2: mock-exam speaking band on the ETS raw structure ────────────────────
describe("calculateSpeakingBand — ETS raw structure (repeat 35 + interview 20)", () => {
  test("perfect performance → band 6", () => {
    const repeat = [5, 5, 5, 5, 5, 5, 5];
    const interview = [5, 5, 5, 5];
    const r = calculateSpeakingBand(repeat, interview);
    expect(r.repeatRaw).toBeCloseTo(35, 5);
    expect(r.interviewRaw).toBeCloseTo(20, 5);
    expect(r.rawTotal).toBeCloseTo(55, 5);
    expect(r.band).toBe(6);
  });

  test("all zeros → band floored at 1", () => {
    const r = calculateSpeakingBand([0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0]);
    expect(r.rawTotal).toBe(0);
    expect(r.band).toBe(1);
  });

  test("all fours → raw 28 + 16 = 44 → band 5.0", () => {
    const r = calculateSpeakingBand([4, 4, 4, 4, 4, 4, 4], [4, 4, 4, 4]);
    expect(r.repeatRaw).toBeCloseTo(28, 5);
    expect(r.interviewRaw).toBeCloseTo(16, 5);
    expect(r.rawTotal).toBeCloseTo(44, 5);
    // (44/55)*6 = 4.8 → round half → 5.0
    expect(r.band).toBe(5.0);
  });

  test("truncated repeats (all level 2) + interview level 3 → raw 26 → band 3.0", () => {
    const r = calculateSpeakingBand([2, 2, 2, 2, 2, 2, 2], [3, 3, 3, 3]);
    expect(r.repeatRaw).toBeCloseTo(14, 5);
    expect(r.interviewRaw).toBeCloseTo(12, 5);
    expect(r.rawTotal).toBeCloseTo(26, 5);
    // (26/55)*6 = 2.836 → round half → 3.0
    expect(r.band).toBe(3.0);
  });

  test("variable set size (6 sentences) normalizes to the 35-point equivalent", () => {
    const six = [5, 5, 5, 5, 5, 5]; // mean 5 → raw 35 regardless of count
    const r = calculateSpeakingBand(six, [5, 5, 5, 5]);
    expect(r.repeatRaw).toBeCloseTo(35, 5);
    expect(r.band).toBe(6);
  });

  test("fewer than 4 interview questions scale up proportionally", () => {
    // 2 answered at mean 4 → interviewRaw = 16 (as if 4 questions at 4)
    const raw = computeSpeakingRaw([4, 4, 4, 4, 4, 4, 4], [4, 4]);
    expect(raw.interviewRaw).toBeCloseTo(16, 5);
  });

  test("handles empty inputs without throwing", () => {
    const r = calculateSpeakingBand([], []);
    expect(r.rawTotal).toBe(0);
    expect(r.band).toBe(1);
  });

  test("rawToSpeakingBand is monotonic across the range", () => {
    expect(rawToSpeakingBand(0)).toBe(1);
    expect(rawToSpeakingBand(55)).toBe(6);
    expect(rawToSpeakingBand(27.5)).toBe(3); // (27.5/55)*6 = 3.0
  });

  test("band range maps into the official CEFR half-band bins", () => {
    // Sanity: band 6 → C2 tier, band 3 → B1 tier, per bandDescriptors.json.
    // (These bins are half-band ranges; we assert the numeric band lands in them.)
    const c2 = calculateSpeakingBand([5, 5, 5, 5, 5, 5, 5], [5, 5, 5, 5]).band;
    const b1 = calculateSpeakingBand([2, 2, 2, 2, 2, 2, 2], [3, 3, 3, 3]).band;
    expect(c2).toBe(6);        // 6 → C2
    expect(b1).toBeGreaterThanOrEqual(3);
    expect(b1).toBeLessThanOrEqual(3.5); // 3-3.5 → B1
  });
});
