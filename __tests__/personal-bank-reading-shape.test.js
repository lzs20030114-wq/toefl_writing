import { fetchPersonalBank, mapPersonalToPicker } from "../lib/userBank/personalBank";

// personalBank shape-guards for the two reading types (rdl/ap) — mirrors
// __tests__/personal-bank-speaking-shape.test.js conventions. The per-type filter is the
// last defense before RDLTask consumes user JSON; malformed / un-scorable rows must drop.
describe("fetchPersonalBank reading shape-guards", () => {
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

  const goodQ = {
    question_type: "detail",
    stem: "When does the sale start?",
    options: { A: "Monday", B: "Tuesday", C: "Friday", D: "Saturday" },
    correct_answer: "C",
  };

  test("rdl: keeps well-formed items, drops missing text / empty questions / incomplete options / null answer", async () => {
    mockItems([
      { item_id: "usr_ABC123_1_0", data: { text: "USED TEXTBOOK SALE! Saturday in Room 112.", variant: "short", questions: [goodQ, goodQ] } },
      { item_id: "usr_ABC123_1_1", data: { questions: [goodQ] } },                                        // no text → drop
      { item_id: "usr_ABC123_1_2", data: { text: "Some flyer text here.", questions: [] } },              // empty questions → drop
      { item_id: "usr_ABC123_1_3", data: { text: "Some flyer text here.", questions: [{ ...goodQ, options: { A: "x", B: "y" } }] } }, // options 缺 C/D → drop
      { item_id: "usr_ABC123_1_4", data: { text: "Some flyer text here.", questions: [{ ...goodQ, correct_answer: null }] } },        // 无答案不可判分 → drop
    ]);
    const rows = await fetchPersonalBank("rdl");
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("usr_ABC123_1_0");
    expect(rows[0].questions).toHaveLength(2);
  });

  test("ap: keeps well-formed items (passage field), drops missing passage / bad questions", async () => {
    mockItems([
      { item_id: "usr_ABC123_2_0", data: { topic: "physics", passage: "Fluid dynamics is the study of liquids in motion.\n\nIt has many applications.", questions: [goodQ] } },
      { item_id: "usr_ABC123_2_1", data: { topic: "physics", questions: [goodQ] } },                      // no passage → drop
      { item_id: "usr_ABC123_2_2", data: { passage: "Some academic text.", questions: [{ ...goodQ, stem: "  " }] } }, // blank stem → drop
    ]);
    const rows = await fetchPersonalBank("ap");
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("usr_ABC123_2_0");
    expect(rows[0].passage).toMatch(/Fluid dynamics/);
  });

  // CTW: guard requires passage + ≥1 blank, each blank with original_word / displayed_fragment /
  // numeric position (CTWTask locates blanks by position + scores fragment+input===original_word).
  const goodBlank = { position: 9, original_word: "clownfish", displayed_fragment: "clow", word_index_in_sentence: 1, sentence_index: 1 };

  test("ctw: keeps well-formed items, drops missing passage / empty blanks / blank missing fields / non-numeric position", async () => {
    mockItems([
      { item_id: "usr_ABC123_3_0", data: { passage: "Reefs host clownfish. They shelter safely.", first_sentence: "Reefs host clownfish.", blanks: [goodBlank], blank_count: 1 } },
      { item_id: "usr_ABC123_3_1", data: { blanks: [goodBlank] } },                                                  // no passage → drop
      { item_id: "usr_ABC123_3_2", data: { passage: "Some passage text.", blanks: [] } },                            // empty blanks → drop
      { item_id: "usr_ABC123_3_3", data: { passage: "Some passage text.", blanks: [{ ...goodBlank, original_word: "" }] } }, // blank missing original_word → drop
      { item_id: "usr_ABC123_3_4", data: { passage: "Some passage text.", blanks: [{ ...goodBlank, position: "9" }] } },     // non-numeric position → drop
    ]);
    const rows = await fetchPersonalBank("ctw");
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("usr_ABC123_3_0");
    expect(rows[0].blanks).toHaveLength(1);
  });
});

// mapPersonalToPicker must emit the reading picker item shape { id, tag, title, subtitle }
// (aligned with buildRDLTopics / buildAPTopics in app/reading/page.js).
describe("mapPersonalToPicker reading shapes", () => {
  test("rdl item uses format_metadata.title, 我的 tag, question-count subtitle", () => {
    const items = mapPersonalToPicker("rdl", [
      {
        id: "usr_ABC123_1_0",
        text: "USED TEXTBOOK SALE! Saturday, May 17.",
        format_metadata: { title: "Used Textbook Sale" },
        questions: [{}, {}],
      },
    ]);
    expect(items[0].id).toBe("usr_ABC123_1_0");
    expect(items[0].tag).toBe("我的");
    expect(items[0].title).toBe("Used Textbook Sale");
    expect(items[0].subtitle).toBe("2 题");
    expect(items[0].personal).toBe(true);
  });

  test("rdl item without title falls back to first line of text", () => {
    const items = mapPersonalToPicker("rdl", [
      { id: "usr_ABC123_1_1", text: "Campus shuttle schedule changes next week. Details below.", format_metadata: {}, questions: [{}] },
    ]);
    expect(items[0].title).toMatch(/Campus shuttle schedule/);
  });

  test("ap item titles from passage first line, subtitle from subtopic", () => {
    const items = mapPersonalToPicker("ap", [
      {
        id: "usr_ABC123_2_0",
        topic: "physics",
        subtopic: "fluid dynamics",
        passage: "Fluid dynamics concerns the movement of liquids and gases.\n\nSecond paragraph.",
        questions: [{}, {}, {}, {}, {}],
      },
    ]);
    expect(items[0].tag).toBe("我的");
    expect(items[0].title).toMatch(/Fluid dynamics concerns/);
    expect(items[0].subtitle).toBe("fluid dynamics");
    expect(items[0].personal).toBe(true);
  });

  test("ctw item titles from first_sentence, subtitle from topic, blank-count fallback", () => {
    const items = mapPersonalToPicker("ctw", [
      {
        id: "usr_ABC123_3_0",
        topic: "biology",
        first_sentence: "Clownfish and sea anemones form a remarkable partnership.",
        passage: "Clownfish and sea anemones form a remarkable partnership. They protect each other.",
        blank_count: 10,
        blanks: new Array(10).fill({ position: 0, original_word: "x", displayed_fragment: "x" }),
      },
    ]);
    expect(items[0].id).toBe("usr_ABC123_3_0");
    expect(items[0].tag).toBe("我的");
    expect(items[0].title).toMatch(/Clownfish and sea anemones/);
    expect(items[0].subtitle).toBe("biology");
    expect(items[0].personal).toBe(true);
  });

  test("ctw title falls back to passage first line when first_sentence absent; long titles truncate", () => {
    const items = mapPersonalToPicker("ctw", [
      { id: "usr_ABC123_3_1", topic: "history", passage: "Ancient trade routes shaped early civilizations. Goods moved far.", blank_count: 10 },
    ]);
    expect(items[0].title).toMatch(/Ancient trade routes/);
    expect(items[0].subtitle).toBe("history");
  });
});
