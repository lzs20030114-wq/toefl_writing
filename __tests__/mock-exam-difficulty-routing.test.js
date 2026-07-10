/**
 * Adaptive mock exam — difficulty routing tests.
 *
 * Covers the 2026-07 fix: upper/lower Module 2 must actually serve
 * different-difficulty items for EVERY task type (previously only CTW/AP/LCR
 * were filtered; RDL and LA/LC/LAT drew from the same pool on both paths).
 */

import {
  pickItems as pickReadingItems,
  filterRdlPool,
  pickRdlFiveQuestionSet,
  buildReadingModule2,
  RDL_MIN_FILTERED_POOL,
} from "../lib/mockExam/readingPlanner";
import {
  pickItems as pickListeningItems,
  buildListeningModule2,
} from "../lib/mockExam/listeningPlanner";
import { estimateRdlDifficulty } from "../lib/readingGen/rdlDifficulty";

import rdlShortBank from "../data/reading/bank/rdl-short.json";
import rdlLongBank from "../data/reading/bank/rdl-long.json";
import ctwBank from "../data/reading/bank/ctw.json";
import apBank from "../data/reading/bank/ap.json";
import laBank from "../data/listening/bank/la.json";
import lcBank from "../data/listening/bank/lc.json";
import latBank from "../data/listening/bank/lat.json";

function makePool(spec) {
  // spec: { easy: n, medium: n, hard: n, none: n }
  const pool = [];
  let id = 0;
  for (const [difficulty, n] of Object.entries(spec)) {
    for (let i = 0; i < n; i++) {
      pool.push({
        id: `item_${id++}`,
        ...(difficulty === "none" ? {} : { difficulty }),
        questions: [{}, {}], // 2Q shape for RDL-short paths
      });
    }
  }
  return pool;
}

describe("pickItems difficulty preference", () => {
  test("returns only preferred difficulties when the pool is big enough", () => {
    const pool = makePool({ easy: 10, medium: 10, hard: 10 });
    const picked = pickReadingItems(pool, 5, { difficulties: ["medium", "hard"] });
    expect(picked).toHaveLength(5);
    for (const item of picked) {
      expect(["medium", "hard"]).toContain(item.difficulty);
    }
  });

  test("falls back to the full pool when preferred tier is too thin", () => {
    const pool = makePool({ easy: 10, hard: 2 });
    const picked = pickReadingItems(pool, 5, { difficulties: ["hard"] });
    expect(picked).toHaveLength(5); // fallback keeps the exam fillable
  });

  test("listening pickItems behaves identically", () => {
    const pool = makePool({ easy: 10, medium: 10, hard: 10 });
    const picked = pickListeningItems(pool, 4, { difficulties: ["easy", "medium"] });
    expect(picked).toHaveLength(4);
    for (const item of picked) {
      expect(["easy", "medium"]).toContain(item.difficulty);
    }
  });
});

describe("filterRdlPool floor guard", () => {
  test("filters when the preferred pool clears the floor", () => {
    const pool = makePool({ easy: 40, hard: RDL_MIN_FILTERED_POOL });
    const filtered = filterRdlPool(pool, ["hard"]);
    expect(filtered).toHaveLength(RDL_MIN_FILTERED_POOL);
    expect(filtered.every((i) => i.difficulty === "hard")).toBe(true);
  });

  test("returns the full pool when the preferred tier is below the floor", () => {
    const pool = makePool({ easy: 40, hard: RDL_MIN_FILTERED_POOL - 1 });
    const filtered = filterRdlPool(pool, ["hard"]);
    expect(filtered).toBe(pool); // small tier must NOT recycle the same few items
  });

  test("no difficulties → passthrough", () => {
    const pool = makePool({ easy: 3 });
    expect(filterRdlPool(pool, null)).toBe(pool);
  });
});

describe("pickRdlFiveQuestionSet difficulty routing (injected pools)", () => {
  const short = (difficulty, id) => ({ id, difficulty, questions: [{}, {}] });
  const long = (difficulty, id) => ({ id, difficulty, questions: [{}, {}, {}] });

  function pools() {
    const shortPool = [];
    const longPool = [];
    for (let i = 0; i < 35; i++) {
      shortPool.push(short("easy", `se${i}`), short("hard", `sh${i}`));
      longPool.push(long("easy", `le${i}`), long("hard", `lh${i}`));
    }
    return { short: shortPool, long: longPool };
  }

  test("upper-style preference yields only matching items", () => {
    const picked = pickRdlFiveQuestionSet(new Set(), ["hard"], pools());
    expect(picked.reduce((s, i) => s + i.questions.length, 0)).toBeGreaterThanOrEqual(5);
    for (const item of picked) expect(item.difficulty).toBe("hard");
  });

  test("lower-style preference yields only matching items", () => {
    const picked = pickRdlFiveQuestionSet(new Set(), ["easy"], pools());
    for (const item of picked) expect(item.difficulty).toBe("easy");
  });

  test("still fills 5 questions when a tier is thin (floor fallback)", () => {
    const thin = {
      short: [short("hard", "sh0"), ...Array.from({ length: 40 }, (_, i) => short("easy", `se${i}`))],
      long: Array.from({ length: 40 }, (_, i) => long("easy", `le${i}`)),
    };
    const picked = pickRdlFiveQuestionSet(new Set(), ["hard"], thin);
    expect(picked.reduce((s, i) => s + i.questions.length, 0)).toBeGreaterThanOrEqual(5);
  });
});

describe("live-bank routing (real data invariants)", () => {
  // These assert against the shipped banks: every difficulty tier the router
  // depends on must be thick enough for filtering to actually engage.

  test("reading banks have routable pools on both paths", () => {
    for (const bank of [ctwBank, apBank]) {
      const dist = { easy: 0, medium: 0, hard: 0 };
      bank.items.forEach((i) => { if (dist[i.difficulty] != null) dist[i.difficulty]++; });
      expect(dist.easy + dist.medium).toBeGreaterThanOrEqual(2);
      expect(dist.medium + dist.hard).toBeGreaterThanOrEqual(2);
    }
    // RDL: both routed bands must clear the filter floor, or routing silently
    // degrades to "any difficulty" (this is the regression this suite guards)
    for (const bank of [rdlShortBank, rdlLongBank]) {
      const dist = { easy: 0, medium: 0, hard: 0 };
      bank.items.forEach((i) => { if (dist[i.difficulty] != null) dist[i.difficulty]++; });
      expect(dist.easy + dist.medium).toBeGreaterThanOrEqual(RDL_MIN_FILTERED_POOL);
      expect(dist.medium + dist.hard).toBeGreaterThanOrEqual(RDL_MIN_FILTERED_POOL);
    }
  });

  test("reading M2 upper serves medium+hard CTW/AP/RDL, lower serves easy+medium", () => {
    const upper = buildReadingModule2("upper");
    const lower = buildReadingModule2("lower");

    for (const item of upper.items) {
      expect(["medium", "hard"]).toContain(item.difficulty);
    }
    for (const item of lower.items) {
      expect(["easy", "medium"]).toContain(item.difficulty);
    }
  });

  test("listening M2 upper serves medium+hard for every type, lower serves easy+medium", () => {
    // Preferred pools in la/lc/lat banks are all comfortably > needed count,
    // so the filter engages deterministically.
    for (const bank of [laBank, lcBank, latBank]) {
      const mh = bank.items.filter((i) => ["medium", "hard"].includes(i.difficulty)).length;
      const em = bank.items.filter((i) => ["easy", "medium"].includes(i.difficulty)).length;
      expect(mh).toBeGreaterThanOrEqual(5);
      expect(em).toBeGreaterThanOrEqual(5);
    }

    const upper = buildListeningModule2("upper");
    expect(upper.items.some((i) => i.taskType === "lat")).toBe(true);
    for (const item of upper.items) {
      expect(["medium", "hard"]).toContain(item.difficulty);
    }

    const lower = buildListeningModule2("lower");
    expect(lower.items.some((i) => i.taskType === "lat")).toBe(false);
    for (const item of lower.items) {
      expect(["easy", "medium"]).toContain(item.difficulty);
    }
  });
});

describe("rdlDifficulty estimator", () => {
  test("verbatim detail questions score easier than synthesis/inference questions", () => {
    const text =
      "The library will close at 9:00 PM on Friday, May 15. Students must return laptops to the front desk before closing. A $5 late fee applies to overdue equipment.";
    const easyItem = {
      variant: "short",
      text,
      questions: [
        {
          question_type: "detail",
          options: { A: "Return laptops to the front desk", B: "Pay at Room 12", C: "Email the office", D: "Visit another branch" },
          correct_answer: "A",
        },
        {
          question_type: "detail",
          options: { A: "At 7:00 PM", B: "At 9:00 PM on Friday", C: "At noon", D: "On Sunday" },
          correct_answer: "B",
        },
      ],
    };
    const hardItem = {
      variant: "short",
      text,
      questions: [
        {
          question_type: "inference",
          options: {
            A: "Keeping a device past the deadline costs money",
            B: "Laptops must be returned before closing",
            C: "The front desk charges a $5 late fee",
            D: "The library closes at 9:00 PM",
          },
          correct_answer: "A",
        },
        {
          question_type: "inference",
          options: {
            A: "Equipment stays available all weekend",
            B: "The $5 fee covers laptops returned to the desk",
            C: "Borrowed items are due before the evening ends",
            D: "Students must pay $5 at the front desk before closing",
          },
          correct_answer: "C",
        },
      ],
    };

    const easy = estimateRdlDifficulty(easyItem);
    const hard = estimateRdlDifficulty(hardItem);
    expect(easy.score).toBeLessThan(hard.score);
    expect(easy.difficulty).toBe("easy");
    expect(hard.difficulty).not.toBe("easy");
  });

  test("degenerate items default to medium", () => {
    expect(estimateRdlDifficulty(null).difficulty).toBe("medium");
    expect(estimateRdlDifficulty({ text: "", questions: [] }).difficulty).toBe("medium");
  });

  test("every live bank item carries a valid measured label", () => {
    for (const [bank, variant] of [[rdlShortBank, "short"], [rdlLongBank, "long"]]) {
      for (const item of bank.items) {
        expect(["easy", "medium", "hard"]).toContain(item.difficulty);
        // labels must match the estimator (backfill ran with the same code)
        const { difficulty } = estimateRdlDifficulty({ ...item, variant });
        expect(item.difficulty).toBe(difficulty);
      }
    }
  });
});
