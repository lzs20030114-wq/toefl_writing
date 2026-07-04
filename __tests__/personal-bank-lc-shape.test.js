import { fetchPersonalBank, mapPersonalToPicker } from "../lib/userBank/personalBank";

// personalBank shape-guard + audio_url whitelist for LC (听对话). Last defense before ListeningMCQTask
// consumes user JSON: a well-formed item needs EXACTLY 2 speakers (each with a gender) + a
// conversation[] of ≥4 turns (each turn's speaker ∈ the two speaker names, text non-empty) +
// a questions[] where each has stem + complete A-D options + answer∈ABCD (q.answer). audio_url must
// be OUR bucket / same-origin proxy path, else nulled.
describe("fetchPersonalBank LC shape-guard + audio whitelist", () => {
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

  const goodQ = { stem: "What is it about?", options: { A: "a", B: "b", C: "c", D: "d" }, answer: "A" };
  const speakers = [
    { name: "Woman", role: "student", gender: "female" },
    { name: "Man", role: "advising_staff", gender: "male" },
  ];
  const conversation = [
    { speaker: "Woman", text: "Hi, I'm trying to pick an elective for next term." },
    { speaker: "Man", text: "Sure, what's your major again?" },
    { speaker: "Woman", text: "Marketing. Public speaking seems useful but it's early." },
    { speaker: "Man", text: "Well, presentation skills will help you a lot." },
  ];
  const goodLc = { situation: "elective advising", speakers, conversation, questions: [goodQ, { ...goodQ, answer: "B" }] };

  test("keeps well-formed; drops wrong speaker count / missing gender / short conversation / stray speaker / bad answer", async () => {
    mockItems([
      { item_id: "usr_ABC123_1_0", data: goodLc },
      { item_id: "usr_ABC123_1_1", data: { ...goodLc, speakers: [speakers[0]] } },                          // 1 speaker → drop
      { item_id: "usr_ABC123_1_2", data: { ...goodLc, speakers: [{ name: "Woman" }, { name: "Man" }] } },     // no gender → drop
      { item_id: "usr_ABC123_1_3", data: { ...goodLc, conversation: conversation.slice(0, 3) } },             // <4 turns → drop
      { item_id: "usr_ABC123_1_4", data: { ...goodLc, conversation: [...conversation.slice(0, 3), { speaker: "Bob", text: "stray" }] } }, // stray speaker → drop
      { item_id: "usr_ABC123_1_5", data: { ...goodLc, questions: [{ ...goodQ, answer: null }] } },            // unresolved answer → drop
    ]);
    const rows = await fetchPersonalBank("lc");
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("usr_ABC123_1_0");
  });

  test("audio_url whitelist: keeps bucket / proxy path, nulls foreign URLs", async () => {
    mockItems([
      { item_id: "usr_ABC123_2_0", data: { ...goodLc, audio_url: "https://x.supabase.co/storage/v1/object/public/listening_audio/user/ABC123/usr_ABC123_2_0-1.mp3" } },
      { item_id: "usr_ABC123_2_1", data: { ...goodLc, audio_url: "/api/audio/user/ABC123/usr_ABC123_2_1-1.mp3" } },
      { item_id: "usr_ABC123_2_2", data: { ...goodLc, audio_url: "https://evil.example.com/track.mp3" } },
    ]);
    const rows = await fetchPersonalBank("lc");
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId["usr_ABC123_2_0"].audio_url).toMatch(/listening_audio\/user\/ABC123\//);
    expect(byId["usr_ABC123_2_1"].audio_url).toBe("/api/audio/user/ABC123/usr_ABC123_2_1-1.mp3");
    expect(byId["usr_ABC123_2_2"].audio_url).toBeNull();
  });

  test("mapPersonalToPicker(lc): situation → title, 我的 tag, 题数 subtitle", () => {
    const items = mapPersonalToPicker("lc", [
      { id: "usr_ABC123_3_0", situation: "Elective advising chat", conversation, speakers, questions: [goodQ, goodQ] },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("usr_ABC123_3_0");
    expect(items[0].tag).toBe("我的");
    expect(items[0].title).toBe("Elective advising chat");
    expect(items[0].subtitle).toBe("2 题");
    expect(items[0].personal).toBe(true);
  });

  test("mapPersonalToPicker(lc): falls back to first turn text when no situation", () => {
    const items = mapPersonalToPicker("lc", [
      { id: "usr_ABC123_4_0", conversation, speakers, questions: [goodQ] },
    ]);
    expect(items[0].title).toMatch(/Hi, I'm trying to pick an elective/);
    expect(items[0].subtitle).toBe("1 题");
  });
});
