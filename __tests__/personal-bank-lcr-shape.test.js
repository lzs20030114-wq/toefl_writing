import { fetchPersonalBank, mapPersonalToPicker } from "../lib/userBank/personalBank";

// personalBank shape-guard + audio_url whitelist for LCR (听力选择回应). The per-type filter is the
// last defense before LCRTask consumes user JSON: a well-formed item needs speaker + complete A-D
// options + answer∈ABCD. audio_url must be OUR bucket / same-origin proxy path, else nulled (so
// AudioPlayer never receives a foreign <audio src>).
describe("fetchPersonalBank LCR shape-guard + audio whitelist", () => {
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

  const good = {
    speaker: "Where should I submit the essay?",
    options: { A: "a", B: "b", C: "c", D: "d" },
    answer: "C",
  };

  test("keeps well-formed items; drops missing speaker / incomplete options / bad answer", async () => {
    mockItems([
      { item_id: "usr_ABC123_1_0", data: good },
      { item_id: "usr_ABC123_1_1", data: { ...good, speaker: "" } },                       // no speaker → drop
      { item_id: "usr_ABC123_1_2", data: { ...good, options: { A: "a", B: "b", C: "c" } } }, // missing D → drop
      { item_id: "usr_ABC123_1_3", data: { ...good, answer: "Z" } },                        // bad answer → drop
      { item_id: "usr_ABC123_1_4", data: { ...good, answer: null } },                       // null answer → drop
    ]);
    const rows = await fetchPersonalBank("lcr");
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("usr_ABC123_1_0");
    expect(rows[0].speaker).toBe("Where should I submit the essay?");
  });

  test("audio_url whitelist: keeps bucket URL and /api/audio path, nulls foreign URLs", async () => {
    mockItems([
      { item_id: "usr_ABC123_2_0", data: { ...good, audio_url: "https://x.supabase.co/storage/v1/object/public/listening_audio/user/ABC123/usr_ABC123_2_0-1.mp3" } },
      { item_id: "usr_ABC123_2_1", data: { ...good, audio_url: "/api/audio/user/ABC123/usr_ABC123_2_1-1.mp3" } },
      { item_id: "usr_ABC123_2_2", data: { ...good, audio_url: "https://evil.example.com/track.mp3" } }, // foreign → null
      { item_id: "usr_ABC123_2_3", data: { ...good, audio_url: "javascript:alert(1)" } },                // junk → null
    ]);
    const rows = await fetchPersonalBank("lcr");
    expect(rows.length).toBe(4);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId["usr_ABC123_2_0"].audio_url).toMatch(/listening_audio\/user\/ABC123\//);
    expect(byId["usr_ABC123_2_1"].audio_url).toBe("/api/audio/user/ABC123/usr_ABC123_2_1-1.mp3");
    expect(byId["usr_ABC123_2_2"].audio_url).toBeNull();
    expect(byId["usr_ABC123_2_3"].audio_url).toBeNull();
  });

  test("mapPersonalToPicker(lcr): speaker → title, 我的 tag", () => {
    const items = mapPersonalToPicker("lcr", [
      { id: "usr_ABC123_3_0", speaker: "Could you help me find the reading room?", situation: "library help" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("usr_ABC123_3_0");
    expect(items[0].tag).toBe("我的");
    expect(items[0].title).toBe("Could you help me find the reading room?");
    expect(items[0].personal).toBe(true);
  });

  test("mapPersonalToPicker(lcr): long speaker truncated to 70 chars", () => {
    const longSpeaker = "a".repeat(120);
    const items = mapPersonalToPicker("lcr", [{ id: "x", speaker: longSpeaker }]);
    expect(items[0].title.length).toBeLessThanOrEqual(70);
    expect(items[0].title.endsWith("...")).toBe(true);
  });
});
