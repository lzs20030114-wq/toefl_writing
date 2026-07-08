/**
 * lib/gen/promptExcludes.js — staging scan + fingerprint + dedup helpers.
 *
 * All filesystem cases run against a throwaway mkdtemp directory so the real
 * data/ tree is never read or written.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  listStagingFiles,
  loadStagingItems,
  loadBSStagingAnswers,
  firstContentWords,
  orderedExcludes,
  computeRdlExcludes,
} = require("../lib/gen/promptExcludes.js");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "prompt-excludes-"));
}
function write(dir, name, obj) {
  fs.writeFileSync(path.join(dir, name), typeof obj === "string" ? obj : JSON.stringify(obj));
}

describe("loadStagingItems", () => {
  test("reads items[] from prefix-matching .json files and skips everything else", () => {
    const dir = tmpdir();
    write(dir, "ap-1.json", { items: [{ topic: "physics" }, { topic: "biology" }] });
    write(dir, "ap-2.json", { items: [{ topic: "chemistry" }] });
    write(dir, "ctw-1.json", { items: [{ topic: "SHOULD-NOT-APPEAR" }] }); // wrong prefix
    write(dir, "ap-broken.json", "{ this is not valid json ]"); // parse failure → skipped
    write(dir, "ap-noitems.json", { total: 3 }); // no items[] → skipped
    write(dir, "ap-notes.txt", "ignored, not json");

    const items = loadStagingItems(dir, "ap-");
    const topics = items.map((i) => i.topic);
    expect(items).toHaveLength(3);
    expect(topics).toEqual(expect.arrayContaining(["physics", "biology", "chemistry"]));
    expect(topics).not.toContain("SHOULD-NOT-APPEAR");
  });

  test("empty prefix reads every .json", () => {
    const dir = tmpdir();
    write(dir, "routine-a.json", { items: [{ x: 1 }] });
    write(dir, "TESTGROUP-b.json", { items: [{ x: 2 }] });
    write(dir, "run.state.json", { status: "done" }); // no items[] → skipped
    expect(loadStagingItems(dir, "")).toHaveLength(2);
  });

  test("returns items newest-file-first (descending filename sort)", () => {
    const dir = tmpdir();
    write(dir, "la-routine-20260101.json", { items: [{ tag: "old" }] });
    write(dir, "la-routine-20260705.json", { items: [{ tag: "new" }] });
    const items = loadStagingItems(dir, "la-");
    expect(items[0].tag).toBe("new");
    expect(items[1].tag).toBe("old");
  });

  test("prefix 'lc-' does not match 'lcr-' files, and 'la-' does not match 'lat-'", () => {
    const dir = tmpdir();
    write(dir, "lc-1.json", { items: [{ k: "lc" }] });
    write(dir, "lcr-1.json", { items: [{ k: "lcr" }] });
    write(dir, "la-1.json", { items: [{ k: "la" }] });
    write(dir, "lat-1.json", { items: [{ k: "lat" }] });
    expect(loadStagingItems(dir, "lc-").map((i) => i.k)).toEqual(["lc"]);
    expect(loadStagingItems(dir, "la-").map((i) => i.k)).toEqual(["la"]);
  });

  test("missing directory returns [] (no throw)", () => {
    expect(loadStagingItems(path.join(os.tmpdir(), "does-not-exist-xyz"), "ap-")).toEqual([]);
  });
});

describe("listStagingFiles", () => {
  test("filters by extension + prefix and sorts newest-first", () => {
    const dir = tmpdir();
    write(dir, "ap-1.json", {});
    write(dir, "ap-2.json", {});
    write(dir, "ap-note.txt", "x");
    write(dir, "ctw-1.json", {});
    expect(listStagingFiles(dir, "ap-")).toEqual(["ap-2.json", "ap-1.json"]);
  });
});

describe("loadBSStagingAnswers", () => {
  test("handles both {question_sets:[{questions:[{answer}]}]} and {items:[{answer}]}", () => {
    const dir = tmpdir();
    write(dir, "sets.json", {
      question_sets: [
        { questions: [{ answer: "Answer one." }, { answer: "Answer two." }] },
        { questions: [{ answer: "Answer three." }] },
      ],
    });
    write(dir, "items.json", { items: [{ answer: "Item answer." }, { noAnswer: true }] });
    write(dir, "state.json", { status: "done" }); // non-content → nothing
    write(dir, "reserve.json", [{ answer: "bare array — skipped" }]); // bare array → skipped

    const answers = loadBSStagingAnswers(dir);
    expect(answers).toEqual(
      expect.arrayContaining(["Answer one.", "Answer two.", "Answer three.", "Item answer."]),
    );
    expect(answers).toHaveLength(4);
    expect(answers).not.toContain("bare array — skipped");
  });

  test("missing directory returns []", () => {
    expect(loadBSStagingAnswers(path.join(os.tmpdir(), "nope-xyz"))).toEqual([]);
  });
});

describe("firstContentWords", () => {
  test("lowercases, strips punctuation, drops stopwords, keeps first n content words", () => {
    const out = firstContentWords("The elevator in Anderson Hall will be out of service from March 3!", 6);
    expect(out).toBe("elevator anderson hall out service march");
  });

  test("defaults to 8 words", () => {
    const out = firstContentWords("Notice: the annual community garden plot registration opens next week for all students.");
    expect(out.split(" ")).toHaveLength(8);
  });

  test("handles null / empty safely", () => {
    expect(firstContentWords(null)).toBe("");
    expect(firstContentWords("")).toBe("");
    expect(firstContentWords("the of to in on")).toBe(""); // all stopwords
  });
});

describe("orderedExcludes", () => {
  test("fresh values win the front, older appended, case-insensitive dedup, capped", () => {
    const fresh = ["Alpha", "Beta"];
    const older = ["beta", "Gamma", "Delta"]; // "beta" dupes "Beta"
    expect(orderedExcludes(fresh, older, 3)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  test("drops empty/whitespace entries", () => {
    expect(orderedExcludes(["", "  ", "x"], [null, undefined, "y"], 10)).toEqual(["x", "y"]);
  });

  test("respects the cap", () => {
    expect(orderedExcludes(["a", "b", "c", "d"], ["e"], 2)).toEqual(["a", "b"]);
  });
});

describe("computeRdlExcludes", () => {
  test("unions bank tail + same-variant staging, summarized to first-8-content-words, staging first", () => {
    const root = tmpdir();
    const bankDir = path.join(root, "data", "reading", "bank");
    const stagingDir = path.join(root, "data", "reading", "staging");
    fs.mkdirSync(bankDir, { recursive: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    write(bankDir, "rdl-short.json", {
      items: [{ variant: "short", text: "Bank subject about library orientation hours today." }],
    });
    write(stagingDir, "rdl-run-short.json", {
      items: [
        { variant: "short", text: "Staging subject about campus shuttle detour notice." },
        { variant: "long", text: "This long item must be filtered out of the short run." },
      ],
    });

    const excl = computeRdlExcludes(root, "short", 25);
    // staging (short) prioritized ahead of bank
    expect(excl[0]).toBe(firstContentWords("Staging subject about campus shuttle detour notice.", 8));
    expect(excl).toContain(firstContentWords("Bank subject about library orientation hours today.", 8));
    // the long-variant staging item is excluded
    expect(excl.join("|")).not.toContain("filtered out");
  });

  test("missing bank file still returns staging-derived subjects (no throw)", () => {
    const root = tmpdir();
    const stagingDir = path.join(root, "data", "reading", "staging");
    fs.mkdirSync(stagingDir, { recursive: true });
    write(stagingDir, "rdl-run-long.json", {
      items: [{ variant: "long", text: "Only staging exists for the annual e-waste recycling drive." }],
    });
    const excl = computeRdlExcludes(root, "long", 25);
    expect(excl).toContain(firstContentWords("Only staging exists for the annual e-waste recycling drive.", 8));
  });
});
