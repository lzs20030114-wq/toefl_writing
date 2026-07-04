import { fetchPersonalBank } from "../lib/userBank/personalBank";

// (c) personalBank shape-guard for the build type. fetchPersonalBank reads the logged-in code
// from localStorage and GETs /api/user-bank; the per-type filter is the last line of defense
// before app/build-sentence/page.js feeds user JSON into the task component, so malformed rows
// (no answer / too few chunks) must be dropped.
describe("fetchPersonalBank build shape-guard", () => {
  beforeEach(() => {
    localStorage.setItem("toefl-user-code", "ABC123");
  });
  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  function mockItems(items) {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, items }) })
    );
  }

  test("keeps well-formed build questions, drops rows missing answer or with <2 chunks", async () => {
    mockItems([
      {
        item_id: "usr_ABC123_1_0",
        data: {
          prompt: "Is the reading room open again?",
          answer: "You can study there until midnight now.",
          chunks: ["can study", "there until", "midnight", "now", "did"],
          prefilled: ["You"],
          distractor: "did",
        },
      },
      { item_id: "usr_ABC123_1_1", data: { prompt: "x", chunks: ["a", "b"] } },              // no answer → drop
      { item_id: "usr_ABC123_1_2", data: { prompt: "x", answer: "  ", chunks: ["a", "b"] } }, // blank answer → drop
      { item_id: "usr_ABC123_1_3", data: { prompt: "x", answer: "ok", chunks: ["only"] } },   // <2 chunks → drop
      { item_id: "usr_ABC123_1_4", data: { prompt: "x", answer: "ok" } },                     // no chunks → drop
    ]);
    const rows = await fetchPersonalBank("build");
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("usr_ABC123_1_0");
    expect(rows[0].answer).toMatch(/study there until midnight/);
    expect(Array.isArray(rows[0].chunks)).toBe(true);
  });
});
