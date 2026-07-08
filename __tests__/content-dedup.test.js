"use strict";
/**
 * Proves the merge-layer content-dedup (lib/gen/contentDedup.js) is EFFECTIVE:
 *   - contentKey is a punctuation/case/word-order-invariant fingerprint;
 *   - extractText pulls the right "body" field for every question type (and an
 *     unknown type falls back to a whole-item fingerprint that ignores id/audio_url);
 *   - it reproduces the real 2026-06 incident (identical passage, different minted id)
 *     as an EXACT dup, catches a 1-word edit as a NEAR dup, and passes genuinely
 *     different content;
 *   - within-batch repeats are caught (check-then-add);
 *   - the BS answer threshold is 0.75 (aligned with the generator's dedup).
 * No test here reads a real data/ file — all fixtures are synthetic.
 */
const D = require("../lib/gen/contentDedup.js");
const {
  normalizeWords,
  contentKey,
  jaccard,
  extractText,
  createDedupIndex,
  checkDuplicate,
  addToIndex,
} = D;

describe("contentKey — fingerprint invariance", () => {
  test("word order / punctuation / case do not change the key", () => {
    const a = contentKey("Hello, WORLD! Foo-bar.");
    const b = contentKey("world   foo bar hello");
    const c = contentKey("...bar... FOO (world) hello");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a.length).toBeGreaterThan(0);
  });

  test("different word sets produce different keys", () => {
    expect(contentKey("quantum entanglement physics")).not.toBe(
      contentKey("baroque orchestra melody harmony")
    );
  });

  test("normalizeWords drops <=2-char tokens and stopwords", () => {
    const w = normalizeWords("The cat is on a big red mat and it ran");
    expect(w).not.toContain("the"); // stopword
    expect(w).not.toContain("is"); // <=2 chars
    expect(w).not.toContain("on"); // <=2 chars
    expect(w).not.toContain("and"); // stopword
    expect(w).toContain("cat");
    expect(w).toContain("big");
    expect(w).toContain("red");
    expect(w).toContain("mat");
    expect(w).toContain("ran");
  });

  test("empty / null text never throws and yields an empty key", () => {
    expect(contentKey("")).toBe("");
    expect(contentKey(null)).toBe("");
    expect(normalizeWords(undefined)).toEqual([]);
  });
});

describe("jaccard", () => {
  test("accepts Sets or arrays; identical sets = 1, disjoint = 0", () => {
    expect(jaccard(new Set(["a", "b", "c"]), new Set(["a", "b", "c"]))).toBe(1);
    expect(jaccard(["a", "b"], ["c", "d"])).toBe(0);
    expect(jaccard(new Set(), new Set(["a"]))).toBe(0); // empty side → 0
  });
  test("partial overlap ratio is correct", () => {
    // {a,b,c} vs {a,b,d}: shared 2, union 4 → 0.5
    expect(jaccard(new Set(["a", "b", "c"]), new Set(["a", "b", "d"]))).toBeCloseTo(0.5, 6);
  });
});

describe("extractText — per-type body field", () => {
  test("ap / ctw → passage", () => {
    expect(extractText("ap", { passage: "reef ecosystems shelter fish" })).toBe("reef ecosystems shelter fish");
    expect(extractText("ctw", { passage: "glacial retreat reshapes valleys" })).toBe("glacial retreat reshapes valleys");
  });
  test("rdl (and long/short aliases) → text", () => {
    expect(extractText("rdl", { text: "photosynthesis converts light" })).toBe("photosynthesis converts light");
    expect(extractText("rdl-long", { text: "long form text" })).toBe("long form text");
    expect(extractText("rdl-short", { text: "short form text" })).toBe("short form text");
  });
  test("la → announcement, lat → transcript", () => {
    expect(extractText("la", { announcement: "library closes early tonight" })).toBe("library closes early tonight");
    expect(extractText("lat", { transcript: "today we discuss photosynthesis" })).toBe("today we discuss photosynthesis");
  });
  test("lc → conversation texts joined (speaker labels ignored)", () => {
    const item = { conversation: [{ speaker: "M", text: "where is the lab" }, { speaker: "W", text: "next building" }] };
    const t = extractText("lc", item);
    expect(t).toContain("where is the lab");
    expect(t).toContain("next building");
  });
  test("lcr → speaker + all option values", () => {
    const item = { speaker: "should we extend hours", options: { A: "yes definitely", B: "no keep same", C: "reduce them", D: "close entirely" } };
    const t = extractText("lcr", item);
    expect(t).toContain("should we extend hours");
    expect(t).toContain("yes definitely");
    expect(t).toContain("close entirely");
  });
  test("repeat → each sentence joined", () => {
    const item = { sentences: [{ sentence: "the quick fox" }, { sentence: "jumps over fences" }] };
    const t = extractText("repeat", item);
    expect(t).toContain("the quick fox");
    expect(t).toContain("jumps over fences");
  });
  test("interview → intro + each question", () => {
    const item = { intro: "tell us about hobbies", questions: [{ question: "what is your favorite" }, { question: "how did you start" }] };
    const t = extractText("interview", item);
    expect(t).toContain("tell us about hobbies");
    expect(t).toContain("what is your favorite");
    expect(t).toContain("how did you start");
  });
  test("discussion → professor text, object OR bare string", () => {
    expect(extractText("discussion", { professor: { name: "Dr X", text: "should cities ban cars" } })).toBe("should cities ban cars");
    expect(extractText("discussion", { professor: "should cities ban cars" })).toBe("should cities ban cars");
  });
  test("email → scenario, bs → answer", () => {
    expect(extractText("email", { scenario: "you missed a delivery" })).toBe("you missed a delivery");
    expect(extractText("bs", { answer: "i would like to reschedule" })).toBe("i would like to reschedule");
  });
});

describe("extractText — unknown type fallback ignores id / audio_url", () => {
  test("same content, different id/audio_url → identical fingerprint (exact dup)", () => {
    const type = "brand_new_type_2027"; // no explicit field mapping
    const a = { id: "x1", body: "spooky action at a distance entangles particles", audio_url: "http://a", created_at: "2026-01-01" };
    const b = { id: "x2", body: "spooky action at a distance entangles particles" };
    expect(contentKey(extractText(type, a))).toBe(contentKey(extractText(type, b)));

    const idx = createDedupIndex([a], type);
    const r = checkDuplicate(idx, b, type);
    expect(r.dup).toBe(true);
    expect(r.reason).toBe("exact");
    expect(r.matchId).toBe("x1");
  });
});

// ── Real 2026-06 incident: identical passage merged twice under different minted ids ──
describe("real incident replay — LCR content dedup", () => {
  // A speaker prompt + 4 options rich enough that a 1-word edit stays well above 0.85.
  const baseSpeaker =
    "Honestly I believe the administration should seriously reconsider their current decision about closing the student recreation center every weekend afternoon";
  const baseOptions = {
    A: "extend the operating schedule permanently",
    B: "reduce weekend availability slightly",
    C: "maintain the existing timetable unchanged",
    D: "eliminate early morning sessions entirely",
  };
  const lcr = (id, speaker, options, answer) => ({
    id, speaker, options, answer, context: "campus", situation: "policy", difficulty: "medium",
  });

  const seed = [
    lcr("lcr_a", baseSpeaker, baseOptions, "A"),
    lcr("lcr_b", "when does the shuttle bus depart from north campus tonight", { A: "eight", B: "nine", C: "ten", D: "eleven" }, "C"),
    lcr("lcr_c", "which professor teaches the introductory geology seminar this term", { A: "adams", B: "brown", C: "chen", D: "diaz" }, "B"),
  ];

  test("identical content, different id → EXACT dup (the ap_mpveuehi_0 ≡ ap_mq45tobz_23 case)", () => {
    const idx = createDedupIndex(seed, "lcr");
    const copy = lcr("lcr_copy", baseSpeaker, baseOptions, "D"); // same body, new id, even a different answer key
    const r = checkDuplicate(idx, copy, "lcr");
    expect(r.dup).toBe(true);
    expect(r.reason).toBe("exact");
    expect(r.matchId).toBe("lcr_a");
    expect(r.score).toBe(1);
  });

  test("one-word edit → NEAR dup at >= 0.85", () => {
    const idx = createDedupIndex(seed, "lcr");
    const edited = lcr("lcr_near", baseSpeaker.replace("afternoon", "evening"), baseOptions, "A");
    const r = checkDuplicate(idx, edited, "lcr");
    expect(r.dup).toBe(true);
    expect(r.reason).toBe("near");
    expect(r.score).toBeGreaterThanOrEqual(0.85);
    expect(r.matchId).toBe("lcr_a");
  });

  test("genuinely different content → NOT a dup", () => {
    const idx = createDedupIndex(seed, "lcr");
    const other = lcr(
      "lcr_other",
      "did the biology department already publish next semester laboratory safety guidelines online",
      { A: "yesterday", B: "tomorrow", C: "never", D: "unsure" },
      "A"
    );
    const r = checkDuplicate(idx, other, "lcr");
    expect(r.dup).toBe(false);
    expect(r.score).toBeLessThan(0.85);
  });
});

describe("within-batch self-dup (check-then-add)", () => {
  test("after addToIndex, the same content checks as a dup", () => {
    const idx = createDedupIndex([], "ap");
    const item = { id: "ap_1", passage: "sediment layers record ancient climate shifts over millennia" };
    // first sighting: not a dup
    expect(checkDuplicate(idx, item, "ap").dup).toBe(false);
    addToIndex(idx, item, "ap");
    // a second identical item in the same batch is now caught
    const twin = { id: "ap_2", passage: "sediment layers record ancient climate shifts over millennia" };
    const r = checkDuplicate(idx, twin, "ap");
    expect(r.dup).toBe(true);
    expect(r.reason).toBe("exact");
    expect(r.matchId).toBe("ap_1");
  });
});

describe("BS answer threshold is 0.75", () => {
  // answer2 shares 9 of 10 content words with answer1 → jaccard 9/11 ≈ 0.818:
  //   ≥ 0.75 (bs default)  → caught as a near dup
  //   < 0.85 (global default) → NOT caught, proving the per-type threshold is live.
  const a1 = { id: "bs_1", answer: "the museum will open a fascinating new exhibition about ancient marine creatures next spring" };
  const a2 = { id: "bs_2", answer: "the museum will open a fascinating new exhibition about ancient marine creatures next summer" };
  const a3 = { id: "bs_3", answer: "our neighbors quietly planted several colorful tulip bulbs beside their wooden garden fence yesterday" };

  test("near-dup answer (~0.82) is caught under the bs 0.75 threshold", () => {
    const idx = createDedupIndex([a1], "bs");
    const r = checkDuplicate(idx, a2, "bs");
    expect(r.dup).toBe(true);
    expect(r.reason).toBe("near");
    expect(r.score).toBeGreaterThanOrEqual(0.75);
    expect(r.score).toBeLessThan(0.85);
  });

  test("the SAME pair would slip past the 0.85 global default (per-type threshold matters)", () => {
    const idx = createDedupIndex([a1], "bs");
    const r = checkDuplicate(idx, a2, "bs", { threshold: 0.85 });
    expect(r.dup).toBe(false);
  });

  test("a genuinely different answer is not a dup", () => {
    const idx = createDedupIndex([a1], "bs");
    const r = checkDuplicate(idx, a3, "bs");
    expect(r.dup).toBe(false);
    expect(r.score).toBeLessThan(0.75);
  });
});

describe("robustness — missing/empty fields never throw", () => {
  test("checkDuplicate on an item with no body field returns dup:false + warning", () => {
    const idx = createDedupIndex([{ id: "ap_1", passage: "real passage words here about volcanoes" }], "ap");
    const r = checkDuplicate(idx, { id: "ap_empty" }, "ap"); // no passage
    expect(r.dup).toBe(false);
    expect(r.warning).toBe("empty-text");
  });
  test("createDedupIndex tolerates non-array input", () => {
    expect(() => createDedupIndex(null, "ap")).not.toThrow();
    expect(() => createDedupIndex(undefined, "lc")).not.toThrow();
  });
});
