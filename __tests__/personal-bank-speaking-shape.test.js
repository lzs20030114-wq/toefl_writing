import { fetchPersonalBank, mapPersonalToPicker } from "../lib/userBank/personalBank";

// (b) personalBank shape-guards for the two new speaking types.
// fetchPersonalBank reads the logged-in code from localStorage (getSavedCode) and GETs
// /api/user-bank; the per-type filter is the last defense before the task component
// consumes user JSON, so malformed rows must be dropped.
describe("fetchPersonalBank speaking shape-guards", () => {
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

  test("repeat: keeps well-formed sets, drops sets with empty/missing sentences", async () => {
    mockItems([
      { item_id: "usr_ABC123_1_0", data: { scenario: "我的导入", sentences: [{ sentence: "Printers are near the door." }] } },
      { item_id: "usr_ABC123_1_1", data: { scenario: "x", sentences: [] } },          // empty array → drop
      { item_id: "usr_ABC123_1_2", data: { scenario: "x", sentences: [{ sentence: "" }] } }, // blank sentence → drop
      { item_id: "usr_ABC123_1_3", data: { scenario: "x" } },                          // no sentences → drop
    ]);
    const rows = await fetchPersonalBank("repeat");
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("usr_ABC123_1_0");
    expect(rows[0].sentences[0].sentence).toMatch(/Printers/);
  });

  test("interview: keeps well-formed sets, drops sets with empty/missing questions", async () => {
    mockItems([
      { item_id: "usr_ABC123_2_0", data: { topic: "AI", questions: [{ question: "What AI tools do you use daily?" }] } },
      { item_id: "usr_ABC123_2_1", data: { topic: "x", questions: [] } },              // empty → drop
      { item_id: "usr_ABC123_2_2", data: { topic: "x", questions: [{ question: "   " }] } }, // blank → drop
      { item_id: "usr_ABC123_2_3", data: { topic: "x" } },                             // no questions → drop
    ]);
    const rows = await fetchPersonalBank("interview");
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("usr_ABC123_2_0");
    expect(rows[0].questions[0].question).toMatch(/AI tools/);
  });
});

// mapPersonalToPicker must emit the speaking picker item shape { id, tag, title, subtitle }.
describe("mapPersonalToPicker speaking shapes", () => {
  test("repeat item carries 我的 tag and sentence count subtitle", () => {
    const items = mapPersonalToPicker("repeat", [
      { id: "usr_ABC123_1_0", scenario: "IT Help Desk", sentences: [{ sentence: "A." }, { sentence: "B." }] },
    ]);
    expect(items[0].id).toBe("usr_ABC123_1_0");
    expect(items[0].tag).toBe("我的");
    expect(items[0].title).toBe("IT Help Desk");
    expect(items[0].subtitle).toBe("2 sentences");
    expect(items[0].personal).toBe(true);
  });

  test("interview item carries 我的 tag and question count subtitle", () => {
    const items = mapPersonalToPicker("interview", [
      { id: "usr_ABC123_2_0", topic: "Technology", questions: [{ question: "Q1?" }] },
    ]);
    expect(items[0].tag).toBe("我的");
    expect(items[0].title).toBe("Technology");
    expect(items[0].subtitle).toBe("1 questions");
  });
});
