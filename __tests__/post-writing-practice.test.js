import {
  extractPostWritingPracticeItems,
  groupPostWritingPracticeItems,
  __test__,
} from "../lib/postWritingPractice";

const { extractCorrectedWord, recoverSingleWordDiff, resolveSpellingPair, splitSentencesWithBounds } = __test__;

// ─────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────
describe("extractCorrectedWord", () => {
  test("returns bare single English word as-is", () => {
    expect(extractCorrectedWord("receive", "recieve")).toBe("receive");
  });
  test("parses Chinese instruction '改为 Y'", () => {
    expect(extractCorrectedWord("将 recieve 改为 receive", "recieve")).toBe("receive");
  });
  test("parses '应为 Y' pattern", () => {
    expect(extractCorrectedWord("应为 receive", "recieve")).toBe("receive");
  });
  test("parses '→' arrow form", () => {
    expect(extractCorrectedWord("recieve → receive", "recieve")).toBe("receive");
  });
  test("parses 'should be Y' English instruction", () => {
    expect(extractCorrectedWord("should be receive", "recieve")).toBe("receive");
  });
  test("returns empty when no clear correction (does NOT fall back to noise words)", () => {
    // Previously the "last English word" fallback would return "again" here,
    // serving the user a wrong correct-answer. The new logic returns "" so
    // resolveSpellingPair skips the item entirely.
    expect(extractCorrectedWord("your typing is bad, try again", "recieve")).toBe("");
    expect(extractCorrectedWord("this is a typo", "recieve")).toBe("");
    expect(extractCorrectedWord("spelling: should always be capitalized", "recieve")).toBe("");
  });
  test("returns empty if the only English word in fix matches the wrong word", () => {
    expect(extractCorrectedWord("recieve recieve", "recieve")).toBe("");
  });
});

describe("recoverSingleWordDiff", () => {
  test("recovers wrong/correct pair from whole-sentence marks", () => {
    expect(recoverSingleWordDiff("I recieved your email", "I received your email"))
      .toEqual({ wrong: "recieved", correct: "received" });
  });
  test("ignores trailing punctuation differences inside the word slot", () => {
    expect(recoverSingleWordDiff("I recieved your email.", "I received your email."))
      .toEqual({ wrong: "recieved", correct: "received" });
  });
  test("returns null when more than one word differs", () => {
    expect(recoverSingleWordDiff("I goes to storee", "I went to store")).toBeNull();
  });
  test("returns null when word counts differ", () => {
    expect(recoverSingleWordDiff("alot of money", "a lot of money")).toBeNull();
  });
  test("returns null when the texts are identical", () => {
    expect(recoverSingleWordDiff("hello world", "hello world")).toBeNull();
  });
});

describe("resolveSpellingPair", () => {
  test("single-word mark with English fix", () => {
    expect(resolveSpellingPair({
      type: "mark", text: "recieve", fix: "receive", errorType: "spelling", note: "",
    })).toEqual({ wrongWord: "recieve", correctWord: "receive" });
  });
  test("single-word mark with Chinese fix instruction", () => {
    expect(resolveSpellingPair({
      type: "mark", text: "recieve", fix: "将 recieve 改为 receive", errorType: "spelling", note: "",
    })).toEqual({ wrongWord: "recieve", correctWord: "receive" });
  });
  test("salvages whole-sentence spelling mark via diff", () => {
    expect(resolveSpellingPair({
      type: "mark",
      text: "I recieved your email yesterday",
      fix: "I received your email yesterday",
      errorType: "spelling",
      note: "拼写错误：recieved 应为 received。",
    })).toEqual({ wrongWord: "recieved", correctWord: "received" });
  });
  test("rejects when not tagged as spelling and no keyword in note/fix", () => {
    expect(resolveSpellingPair({
      type: "mark", text: "go", fix: "went", errorType: "", note: "时态错误",
    })).toBeNull();
  });
  test("rejects multi-word mark when fix is also multi-word (grammar)", () => {
    expect(resolveSpellingPair({
      type: "mark",
      text: "He go to school",
      fix: "He went to school",
      errorType: "",
      note: "语法错误",
    })).toBeNull();
  });
  test("rejects when wrong and correct lowercase match (case-only diff)", () => {
    expect(resolveSpellingPair({
      type: "mark", text: "Receive", fix: "receive", errorType: "spelling", note: "",
    })).toBeNull();
  });
  test("rejects non-mark segments", () => {
    expect(resolveSpellingPair({ type: "text", text: "hello" })).toBeNull();
  });
});

describe("splitSentencesWithBounds", () => {
  test("splits on . ! ? and tracks offsets", () => {
    const out = splitSentencesWithBounds("Hello. World! How are you?");
    expect(out).toHaveLength(3);
    expect(out[0].text.trim()).toBe("Hello.");
    expect(out[0].start).toBe(0);
    expect(out[1].text.trim()).toBe("World!");
    expect(out[2].text.trim()).toBe("How are you?");
  });
  test("handles trailing text without terminator", () => {
    const out = splitSentencesWithBounds("Hello world");
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Hello world");
  });
  test("returns empty for empty input", () => {
    expect(splitSentencesWithBounds("")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────
// extractPostWritingPracticeItems — end-to-end behavior
// ─────────────────────────────────────────────────────────
function makeSession({ type = "email", date, segments = [], correctedText = "", id, practiceRootId } = {}) {
  return {
    id,
    type,
    date: date || new Date().toISOString(),
    details: {
      practiceRootId,
      feedback: {
        annotationSegments: segments,
        correctedText,
      },
    },
  };
}

describe("extractPostWritingPracticeItems", () => {
  const now = new Date("2026-05-13T10:00:00Z");
  const todayDate = "2026-05-13T08:00:00Z";
  const yesterdayDate = "2026-05-12T08:00:00Z";

  test("returns empty list when no correctedText is present (legacy session)", () => {
    const items = extractPostWritingPracticeItems([
      makeSession({
        date: todayDate,
        correctedText: "",
        segments: [
          { type: "mark", text: "recieve", fix: "receive", errorType: "spelling", note: "", start: 0, end: 7 },
        ],
      }),
    ], now);
    expect(items).toEqual([]);
  });

  test("blanks the corrected word in the clean sentence (not the user's broken one)", () => {
    // User wrote "I recieve your email." → mark covers "recieve" at 2..9
    // (start 2 because plainText is "I recieve your email.")
    const userPlain = "I recieve your email.";
    const segments = [
      { type: "text", text: "I " },
      { type: "mark", text: "recieve", fix: "receive", errorType: "spelling", note: "", start: 2, end: 9 },
      { type: "text", text: " your email." },
    ];
    const correctedText = "I receive your email.";
    const items = extractPostWritingPracticeItems([
      makeSession({ date: todayDate, segments, correctedText, practiceRootId: "root-1" }),
    ], now);
    expect(items).toHaveLength(1);
    expect(items[0].promptSentence).toBe("I [______] your email.");
    expect(items[0].sentence).toBe("I receive your email.");
    expect(items[0].correctText).toBe("receive");
    expect(items[0].bucket).toBe("today");
  });

  test("multi-error sentence → blank shows clean context (the other errors are fixed in correctedText)", () => {
    // The user's sentence has 3 errors; AI's correctedText fixed all of them.
    // Drill should show the clean version with only the target word blanked.
    const userPlain = "Yesterday I goes to the storee.";
    const segments = [
      { type: "text", text: "Yesterday I " },
      // grammar mark on "goes" (not a spelling — not extracted)
      { type: "mark", text: "goes", fix: "went", errorType: "", note: "时态", start: 12, end: 16 },
      { type: "text", text: " to the " },
      // spelling mark on "storee"
      { type: "mark", text: "storee", fix: "store", errorType: "spelling", note: "", start: 24, end: 30 },
      { type: "text", text: "." },
    ];
    const correctedText = "Yesterday I went to the store.";
    const items = extractPostWritingPracticeItems([
      makeSession({ date: todayDate, segments, correctedText, practiceRootId: "root-2" }),
    ], now);
    expect(items).toHaveLength(1);
    expect(items[0].promptSentence).toBe("Yesterday I went to the [______].");
    // Crucially: "goes" is fixed to "went" in the prompt context — no pollution
    expect(items[0].promptSentence).not.toMatch(/goes/);
  });

  test("deduplicates same (session, wrong, correct, sentence) tuple", () => {
    const correctedText = "I receive your email.";
    const session = makeSession({
      date: todayDate,
      practiceRootId: "root-3",
      correctedText,
      segments: [
        { type: "text", text: "I " },
        { type: "mark", text: "recieve", fix: "receive", errorType: "spelling", note: "", start: 2, end: 9 },
        { type: "text", text: " your email." },
      ],
    });
    // Same session passed twice in the history shouldn't double-count.
    const items = extractPostWritingPracticeItems([session, session], now);
    expect(items).toHaveLength(1);
  });

  test("today vs notebook bucket assignment", () => {
    const segToday = [{ type: "text", text: "I " }, { type: "mark", text: "a", fix: "an", errorType: "spelling", note: "", start: 2, end: 3 }, { type: "text", text: " apple." }];
    const segYday  = [{ type: "text", text: "I " }, { type: "mark", text: "a", fix: "an", errorType: "spelling", note: "", start: 2, end: 3 }, { type: "text", text: " apple." }];
    const items = extractPostWritingPracticeItems([
      makeSession({ date: todayDate, segments: segToday, correctedText: "I an apple.", practiceRootId: "today-1" }),
      makeSession({ date: yesterdayDate, segments: segYday, correctedText: "I an apple.", practiceRootId: "yday-1" }),
    ], now);
    const grouped = groupPostWritingPracticeItems(items);
    expect(grouped.today).toHaveLength(1);
    expect(grouped.notebook).toHaveLength(1);
  });

  test("skips items where sentence alignment fails (mismatched sentence counts)", () => {
    // 2 user sentences but AI returned 1 sentence — alignment impossible, skip.
    const segments = [
      { type: "text", text: "I " },
      { type: "mark", text: "recieve", fix: "receive", errorType: "spelling", note: "", start: 2, end: 9 },
      { type: "text", text: " emails. They are nice." },
    ];
    const correctedText = "I receive emails and they are nice."; // 1 sentence, not 2
    const items = extractPostWritingPracticeItems([
      makeSession({ date: todayDate, segments, correctedText, practiceRootId: "skip-1" }),
    ], now);
    expect(items).toEqual([]);
  });

  test("skips items where the correct word is not findable in the clean sentence", () => {
    // AI's correctedText rephrased aggressively → correct word not literally present
    const segments = [
      { type: "text", text: "I " },
      { type: "mark", text: "recieve", fix: "receive", errorType: "spelling", note: "", start: 2, end: 9 },
      { type: "text", text: " emails." },
    ];
    const correctedText = "Emails arrive here."; // doesn't contain "receive"
    const items = extractPostWritingPracticeItems([
      makeSession({ date: todayDate, segments, correctedText, practiceRootId: "skip-2" }),
    ], now);
    expect(items).toEqual([]);
  });

  test("non-spelling marks (e.g. tense errors) are ignored", () => {
    const segments = [
      { type: "text", text: "He " },
      { type: "mark", text: "go", fix: "went", errorType: "", note: "时态错误", start: 3, end: 5 },
      { type: "text", text: " to school." },
    ];
    const correctedText = "He went to school.";
    const items = extractPostWritingPracticeItems([
      makeSession({ date: todayDate, segments, correctedText, practiceRootId: "skip-3" }),
    ], now);
    expect(items).toEqual([]);
  });

  test("non-email/discussion sessions are skipped (e.g. bs)", () => {
    const items = extractPostWritingPracticeItems([
      makeSession({
        type: "bs",
        date: todayDate,
        correctedText: "irrelevant",
        segments: [{ type: "mark", text: "x", fix: "y", errorType: "spelling", note: "", start: 0, end: 1 }],
      }),
    ], now);
    expect(items).toEqual([]);
  });

  test("uses stable session key (practiceRootId) so sessionIndex shifts don't dupe", () => {
    const make = (id) => makeSession({
      date: todayDate,
      practiceRootId: id,
      correctedText: "I receive your email.",
      segments: [
        { type: "text", text: "I " },
        { type: "mark", text: "recieve", fix: "receive", errorType: "spelling", note: "", start: 2, end: 9 },
        { type: "text", text: " your email." },
      ],
    });
    // First call: sessions = [A] → 1 item keyed by "root-A"
    // Second call: sessions = [B, A] → 2 items (A is still keyed by root-A, not its new index)
    const items1 = extractPostWritingPracticeItems([make("root-A")], now);
    expect(items1).toHaveLength(1);
    expect(items1[0].id).toContain("root-A");
    const items2 = extractPostWritingPracticeItems([make("root-B"), make("root-A")], now);
    expect(items2).toHaveLength(2);
    // Item for A should have the same id across calls — proof index doesn't pollute
    const idForA = items2.find((it) => it.id.includes("root-A"))?.id;
    expect(idForA).toBe(items1[0].id);
  });
});
