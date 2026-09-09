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
  pickRdlQuestionSet,
  buildReadingModule1,
  buildReadingModule2,
  RDL_MIN_FILTERED_POOL,
  RDL_SET_SHAPE,
  READING_MODULE_PLAN,
  READING_TOTAL_QUESTIONS,
  readingModuleQuestionCount,
  readingModuleSeconds,
  TOEFL_READING_SECTION_SECONDS,
  describeModulePlan as describeReadingModulePlan,
} from "../lib/mockExam/readingPlanner";
import {
  pickItems as pickListeningItems,
  buildListeningModule1,
  buildListeningModule2,
  LISTENING_MODULE_PLAN,
  LISTENING_TOTAL_QUESTIONS,
  listeningModuleQuestionCount,
  listeningModuleSeconds,
  describeModulePlan as describeListeningModulePlan,
} from "../lib/mockExam/listeningPlanner";
import { plannedTotal } from "../lib/mockExam/timeoutFinalize";
import { TOEFL_LISTENING_SECTION_SECONDS } from "../lib/listeningTiming";
import lcrBank from "../data/listening/bank/lcr.json";
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

describe("pickItems done-set exclusion (four-tier fallback)", () => {
  // Pool with all four tiers, difficulties = ["hard"]:
  //   ① undone+hard: uh1,uh2   ② undone+easy: ue1,ue2
  //   ③ done+hard:   dh1,dh2   ④ done+easy:   de1,de2
  const item = (id, difficulty) => ({ id, difficulty, questions: [{}, {}] });
  const buildFourTierPool = () => [
    item("uh1", "hard"), item("uh2", "hard"),
    item("ue1", "easy"), item("ue2", "easy"),
    item("dh1", "hard"), item("dh2", "hard"),
    item("de1", "easy"), item("de2", "easy"),
  ];
  const DONE = new Set(["dh1", "dh2", "de1", "de2"]);
  const ids = (picked) => new Set(picked.map((i) => i.id));

  for (const [name, pick] of [["reading", pickReadingItems], ["listening", pickListeningItems]]) {
    test(`${name}: undone items are preferred over done ones`, () => {
      const picked = pick(buildFourTierPool(), 2, { difficulties: ["hard"], doneIds: DONE });
      expect(ids(picked)).toEqual(new Set(["uh1", "uh2"])); // tier ① only
    });

    test(`${name}: falls back tier-by-tier, never skipping a tier`, () => {
      const pool = buildFourTierPool();
      // count 4 → all of ① then 2 from ② (undone-easy), no done items yet
      const p4 = ids(pick(pool, 4, { difficulties: ["hard"], doneIds: DONE }));
      expect(p4.has("uh1") && p4.has("uh2")).toBe(true);
      expect([...p4].filter((id) => id.startsWith("ue")).length).toBe(2);
      expect([...p4].some((id) => DONE.has(id))).toBe(false);

      // count 6 → ①+② exhausted, then 2 from ③ (done+hard), NOT ④ (done+easy)
      const p6 = ids(pick(pool, 6, { difficulties: ["hard"], doneIds: DONE }));
      ["uh1", "uh2", "ue1", "ue2"].forEach((id) => expect(p6.has(id)).toBe(true));
      expect([...p6].filter((id) => id.startsWith("dh")).length).toBe(2);
      expect([...p6].some((id) => id.startsWith("de"))).toBe(false);

      // count 8 → whole pool
      expect(pick(pool, 8, { difficulties: ["hard"], doneIds: DONE })).toHaveLength(8);
    });

    test(`${name}: excludeIds is absolute — never returned even from the done tier`, () => {
      const pool = [item("a", "hard"), item("b", "hard")];
      const picked = pick(pool, 2, {
        difficulties: ["hard"],
        excludeIds: new Set(["a"]),
        doneIds: new Set(["b"]),
      });
      // a is hard-excluded; b is merely done → returned (pool-too-small semantics)
      expect(picked.map((i) => i.id)).toEqual(["b"]);
    });

    test(`${name}: no doneIds → behaves like the legacy picker`, () => {
      const big = makePool({ easy: 10, medium: 10, hard: 10 });
      const restricted = pick(big, 5, { difficulties: ["medium", "hard"] });
      expect(restricted).toHaveLength(5);
      restricted.forEach((i) => expect(["medium", "hard"]).toContain(i.difficulty));

      const thin = makePool({ easy: 10, hard: 2 });
      expect(pick(thin, 5, { difficulties: ["hard"] })).toHaveLength(5); // fillable fallback
    });
  }
});

describe("reading builders honour the done-set", () => {
  const readingAllDone = () =>
    new Set(
      [...ctwBank.items, ...apBank.items, ...rdlShortBank.items, ...rdlLongBank.items].map((i) => i.id)
    );

  test("buildReadingModule1 avoids done items while undone remain", () => {
    const emCtw = ctwBank.items.filter((i) => ["easy", "medium"].includes(i.difficulty));
    const keepUndone = new Set(emCtw.slice(0, 3).map((i) => i.id));
    // Everything except those 3 easy/medium CTW is marked done.
    const done = new Set(ctwBank.items.filter((i) => !keepUndone.has(i.id)).map((i) => i.id));
    for (let k = 0; k < 20; k++) {
      const ctw = buildReadingModule1(done).items.find((i) => i.taskType === "ctw");
      expect(keepUndone.has(ctw.id)).toBe(true);
    }
  });

  test("builds a full exam even when the entire bank is done (no throw)", () => {
    const allDone = readingAllDone();
    const baseline = buildReadingModule1();
    const exhausted = buildReadingModule1(allDone);
    expect(exhausted.items.length).toBe(baseline.items.length);
    expect(exhausted.items.every((i) => i.id)).toBe(true);

    const m2 = buildReadingModule2("upper", new Set(), allDone);
    const m2Base = buildReadingModule2("upper");
    expect(m2.items.length).toBe(m2Base.items.length);
    // Difficulty routing survives exhaustion: tier ③ (done+diff) precedes ④.
    for (const it of m2.items) expect(["medium", "hard"]).toContain(it.difficulty);
  });
});

describe("listening builders honour the done-set", () => {
  const listeningAllDone = () =>
    new Set([...lcrBank.items, ...laBank.items, ...lcBank.items, ...latBank.items].map((i) => i.id));

  test("buildListeningModule1 avoids done items while undone remain", () => {
    const keepUndone = new Set(lcrBank.items.slice(0, 3).map((i) => i.id));
    const done = new Set(lcrBank.items.filter((i) => !keepUndone.has(i.id)).map((i) => i.id));
    for (let k = 0; k < 20; k++) {
      const lcr = buildListeningModule1(done).items.filter((i) => i.taskType === "lcr");
      // Only 3 undone LCR exist → the 10 requested spill into done, but the
      // undone ones must always be included first.
      keepUndone.forEach((id) => expect(lcr.some((i) => i.id === id)).toBe(true));
    }
  });

  test("builds a full exam even when the entire bank is done (no throw)", () => {
    const allDone = listeningAllDone();
    const base1 = buildListeningModule1();
    const exhausted1 = buildListeningModule1(allDone);
    expect(exhausted1.items.length).toBe(base1.items.length);

    const upper = buildListeningModule2("upper", new Set(), allDone);
    const upperBase = buildListeningModule2("upper");
    expect(upper.items.length).toBe(upperBase.items.length);
    expect(upper.items.some((i) => i.taskType === "lat")).toBe(true);
    for (const it of upper.items) expect(["medium", "hard"]).toContain(it.difficulty);
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

describe("pickRdlQuestionSet difficulty routing (injected pools)", () => {
  const short = (difficulty, id) => ({ id, difficulty, questions: [{}, {}] });
  const long = (difficulty, id) => ({ id, difficulty, questions: [{}, {}, {}] });
  const questions = (picked) => picked.reduce((s, i) => s + i.questions.length, 0);

  function pools() {
    const shortPool = [];
    const longPool = [];
    for (let i = 0; i < 35; i++) {
      shortPool.push(short("easy", `se${i}`), short("hard", `sh${i}`));
      longPool.push(long("easy", `le${i}`), long("hard", `lh${i}`));
    }
    return { short: shortPool, long: longPool };
  }

  test("default shape is 2 short + 2 long = 10 questions", () => {
    expect(RDL_SET_SHAPE).toEqual({ short: 2, long: 2 });
    const picked = pickRdlQuestionSet(new Set(), null, pools());
    expect(picked).toHaveLength(4);
    expect(questions(picked)).toBe(10);
    // paper order: the two 2Q shorts come before the two 3Q longs (2+2+3+3)
    expect(picked.map((i) => i.questions.length)).toEqual([2, 2, 3, 3]);
  });

  test("upper-style preference yields only matching items", () => {
    const picked = pickRdlQuestionSet(new Set(), ["hard"], pools());
    expect(questions(picked)).toBeGreaterThanOrEqual(10);
    for (const item of picked) expect(item.difficulty).toBe("hard");
  });

  test("lower-style preference yields only matching items", () => {
    const picked = pickRdlQuestionSet(new Set(), ["easy"], pools());
    for (const item of picked) expect(item.difficulty).toBe("easy");
  });

  test("still fills 10 questions when a tier is thin (floor fallback)", () => {
    const thin = {
      short: [short("hard", "sh0"), ...Array.from({ length: 40 }, (_, i) => short("easy", `se${i}`))],
      long: Array.from({ length: 40 }, (_, i) => long("easy", `le${i}`)),
    };
    const picked = pickRdlQuestionSet(new Set(), ["hard"], thin);
    expect(questions(picked)).toBeGreaterThanOrEqual(10);
  });

  test("fills 10 questions from shorts alone when the long pool is empty", () => {
    const shortsOnly = {
      short: Array.from({ length: 8 }, (_, i) => short("medium", `se${i}`)),
      long: [],
    };
    const picked = pickRdlQuestionSet(new Set(), ["hard"], shortsOnly);
    expect(questions(picked)).toBeGreaterThanOrEqual(10); // 5 shorts
    expect(new Set(picked.map((i) => i.id)).size).toBe(picked.length); // no repeats
  });

  test("fills 10 questions from longs alone when the short pool is empty", () => {
    const longsOnly = {
      short: [],
      long: Array.from({ length: 8 }, (_, i) => long("medium", `le${i}`)),
    };
    const picked = pickRdlQuestionSet(new Set(), null, longsOnly);
    expect(questions(picked)).toBeGreaterThanOrEqual(10); // 4 longs
  });

  test("excludeIds is never violated, even on the fallback path", () => {
    const excluded = new Set(["se0", "se1", "le0"]);
    const picked = pickRdlQuestionSet(excluded, null, {
      short: Array.from({ length: 4 }, (_, i) => short("medium", `se${i}`)),
      long: Array.from({ length: 4 }, (_, i) => long("medium", `le${i}`)),
    });
    for (const item of picked) expect(excluded.has(item.id)).toBe(false);
    expect(picked.reduce((s, i) => s + i.questions.length, 0)).toBeGreaterThanOrEqual(10);
  });

  test("doneIds only demote — a fully-done pool still fills the set", () => {
    const p = pools();
    const allDone = new Set([...p.short, ...p.long].map((i) => i.id));
    const picked = pickRdlQuestionSet(new Set(), ["hard"], p, allDone);
    expect(questions(picked)).toBeGreaterThanOrEqual(10);
    for (const item of picked) expect(item.difficulty).toBe("hard"); // tier ③ before ④
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
    // Both paths share the same composition now (blueprint M2 A 型), so LAT
    // appears on the lower path too — only the difficulty band differs.
    expect(lower.items.some((i) => i.taskType === "lat")).toBe(true);
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

/**
 * Blueprint conformance — the adaptive mock must match the 2026 real paper
 * structure reverse-engineered in docs/realbank-set-blueprint.md §1:
 *   Reading   50 题 = M1 35 (CTW×2 + RDL 10题 + AP×1) + M2 15 (CTW×1 + AP×1, no RDL)
 *   Listening 47 题 = M1 32 (12 LCR + 3 LC + 3 LA + 2 LAT) + M2 15 (3 LCR + 2 LC + 2 LAT)
 */
describe("2026 blueprint composition", () => {
  const TRIALS = 10;
  const byType = (items) =>
    items.reduce((acc, i) => ({ ...acc, [i.taskType]: (acc[i.taskType] || 0) + 1 }), {});
  const typeOrder = (items) => items.map((i) => i.taskType).join(",");

  describe("reading", () => {
    test("plan constants describe a 35 + 15 = 50 question exam", () => {
      expect(READING_MODULE_PLAN[1]).toEqual({ ctw: 2, rdlShort: 2, rdlLong: 2, ap: 1 });
      expect(READING_MODULE_PLAN[2]).toEqual({ ctw: 1, ap: 1 });
      expect(READING_MODULE_PLAN[2].rdlShort).toBeUndefined();
      expect(READING_MODULE_PLAN[2].rdlLong).toBeUndefined();
      expect(readingModuleQuestionCount(1)).toBe(35);
      expect(readingModuleQuestionCount(2)).toBe(15);
      expect(READING_TOTAL_QUESTIONS).toBe(50);
    });

    test("Module 1 = CTW×2 + RDL(2 short + 2 long) + AP×1, in paper order, 35 题", () => {
      for (let k = 0; k < TRIALS; k++) {
        const { items, usedIds } = buildReadingModule1();
        expect(byType(items)).toEqual({ ctw: 2, rdl: 4, ap: 1 });
        expect(typeOrder(items)).toBe("ctw,ctw,rdl,rdl,rdl,rdl,ap");
        const rdl = items.filter((i) => i.taskType === "rdl");
        expect(rdl.map((i) => i.questions.length)).toEqual([2, 2, 3, 3]);
        expect(plannedTotal(items)).toBe(readingModuleQuestionCount(1));
        // no item is served twice inside one module
        expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
        expect(usedIds.size).toBe(items.length);
      }
    });

    test("Module 2 = CTW×1 + AP×1, no RDL, 15 题 — identical on both paths", () => {
      for (const path of ["upper", "lower"]) {
        for (let k = 0; k < TRIALS; k++) {
          const { items } = buildReadingModule2(path);
          expect(byType(items)).toEqual({ ctw: 1, ap: 1 });
          expect(typeOrder(items)).toBe("ctw,ap");
          expect(items.some((i) => i.taskType === "rdl")).toBe(false);
          expect(plannedTotal(items)).toBe(15);
        }
      }
    });

    test("Module 2 never re-serves a Module 1 item", () => {
      for (let k = 0; k < TRIALS; k++) {
        const m1 = buildReadingModule1();
        const m2 = buildReadingModule2("upper", m1.usedIds);
        const m1Ids = new Set(m1.items.map((i) => i.id));
        for (const item of m2.items) expect(m1Ids.has(item.id)).toBe(false);
        expect(plannedTotal([...m1.items, ...m2.items])).toBe(READING_TOTAL_QUESTIONS);
      }
    });

    test("describeModulePlan renders the intro-card blurbs", () => {
      expect(describeReadingModulePlan(1)).toBe("35 题 (CTW 20空 + RDL 10题 + AP 5题)");
      expect(describeReadingModulePlan(2)).toBe("15 题 (CTW 10空 + AP 5题)");
    });

    test("module timers split the real 30-min reading budget by question count (21 / 9 min)", () => {
      expect(TOEFL_READING_SECTION_SECONDS).toBe(30 * 60);
      expect(readingModuleSeconds(1)).toBe(21 * 60);
      expect(readingModuleSeconds(2)).toBe(9 * 60);
      expect(readingModuleSeconds(1) + readingModuleSeconds(2)).toBe(TOEFL_READING_SECTION_SECONDS);
    });
  });

  describe("listening", () => {
    test("plan constants describe a 32 + 15 = 47 question exam", () => {
      expect(LISTENING_MODULE_PLAN[1]).toEqual({ lcr: 12, lc: 3, la: 3, lat: 2 });
      expect(LISTENING_MODULE_PLAN[2]).toEqual({ lcr: 3, lc: 2, lat: 2 });
      expect(LISTENING_MODULE_PLAN[2].la).toBeUndefined();
      expect(listeningModuleQuestionCount(1)).toBe(32);
      expect(listeningModuleQuestionCount(2)).toBe(15);
      expect(LISTENING_TOTAL_QUESTIONS).toBe(47);
    });

    test("Module 1 = 12 LCR + 3 LC + 3 LA + 2 LAT, in paper order, 32 题", () => {
      for (let k = 0; k < TRIALS; k++) {
        const { items, usedIds } = buildListeningModule1();
        expect(byType(items)).toEqual({ lcr: 12, lc: 3, la: 3, lat: 2 });
        expect(typeOrder(items)).toBe(
          [...Array(12).fill("lcr"), "lc", "lc", "lc", "la", "la", "la", "lat", "lat"].join(",")
        );
        expect(plannedTotal(items)).toBe(listeningModuleQuestionCount(1));
        expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
        expect(usedIds.size).toBe(items.length);
      }
    });

    test("Module 2 = 3 LCR + 2 LC + 2 LAT, 15 题 — upper and lower are structurally identical", () => {
      const shapes = [];
      for (const path of ["upper", "lower"]) {
        for (let k = 0; k < TRIALS; k++) {
          const { items } = buildListeningModule2(path);
          expect(byType(items)).toEqual({ lcr: 3, lc: 2, lat: 2 });
          expect(typeOrder(items)).toBe("lcr,lcr,lcr,lc,lc,lat,lat");
          expect(items.some((i) => i.taskType === "la")).toBe(false);
          expect(plannedTotal(items)).toBe(15);
        }
        shapes.push(JSON.stringify(byType(buildListeningModule2(path).items)));
      }
      expect(shapes[0]).toBe(shapes[1]); // only difficulty differs between paths
    });

    test("Module 2 never re-serves a Module 1 item", () => {
      for (let k = 0; k < TRIALS; k++) {
        const m1 = buildListeningModule1();
        const m2 = buildListeningModule2("lower", m1.usedIds);
        const m1Ids = new Set(m1.items.map((i) => i.id));
        for (const item of m2.items) expect(m1Ids.has(item.id)).toBe(false);
        expect(plannedTotal([...m1.items, ...m2.items])).toBe(LISTENING_TOTAL_QUESTIONS);
      }
    });

    test("describeModulePlan renders the intro-card blurbs", () => {
      expect(describeListeningModulePlan(1)).toBe("32 题 (12 LCR + 3 LC + 3 LA + 2 LAT)");
      expect(describeListeningModulePlan(2)).toBe("15 题 (3 LCR + 2 LC + 2 LAT)");
    });

    test("module timers still split exactly the 29-minute section budget", () => {
      const m1 = listeningModuleSeconds(1);
      const m2 = listeningModuleSeconds(2);
      expect(m1 + m2).toBe(TOEFL_LISTENING_SECTION_SECONDS);
      expect(m1).toBeGreaterThan(m2); // M1 carries 32 of the 47 questions
    });
  });

  test("done-set exhaustion still yields the full blueprint composition", () => {
    const readingDone = new Set(
      [...ctwBank.items, ...apBank.items, ...rdlShortBank.items, ...rdlLongBank.items].map((i) => i.id)
    );
    expect(plannedTotal(buildReadingModule1(readingDone).items)).toBe(35);
    expect(plannedTotal(buildReadingModule2("lower", new Set(), readingDone).items)).toBe(15);

    const listeningDone = new Set(
      [...lcrBank.items, ...laBank.items, ...lcBank.items, ...latBank.items].map((i) => i.id)
    );
    expect(plannedTotal(buildListeningModule1(listeningDone).items)).toBe(32);
    expect(plannedTotal(buildListeningModule2("upper", new Set(), listeningDone).items)).toBe(15);
  });
});
