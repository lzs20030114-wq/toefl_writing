import { fetchPersonalBank, mapPersonalToPicker } from "../lib/userBank/personalBank";

// personalBank shape-guard + audio_url whitelist for LA (听公告) / LAT (学术讲座). Last defense before
// ListeningMCQTask consumes user JSON: a well-formed item needs announcement/transcript + a
// questions[] where each has stem + complete A-D options + answer∈ABCD (listening answer field is
// q.answer). audio_url must be OUR bucket / same-origin proxy path, else nulled.
describe("fetchPersonalBank LA/LAT shape-guard + audio whitelist", () => {
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
  const goodLa = { announcement: "The library will be closed for maintenance on Friday.", questions: [goodQ, { ...goodQ, answer: "B" }] };
  const goodLat = { transcript: "Today we will discuss the geology of ancient rocks in detail.", questions: [goodQ, { ...goodQ, answer: "B" }] };

  test("LA: keeps well-formed; drops missing announcement / incomplete options / null answer", async () => {
    mockItems([
      { item_id: "usr_ABC123_1_0", data: goodLa },
      { item_id: "usr_ABC123_1_1", data: { ...goodLa, announcement: "" } },                                     // no body → drop
      { item_id: "usr_ABC123_1_2", data: { ...goodLa, questions: [{ ...goodQ, options: { A: "a", B: "b", C: "c" } }] } }, // missing D → drop
      { item_id: "usr_ABC123_1_3", data: { ...goodLa, questions: [{ ...goodQ, answer: null }] } },              // unresolved answer → drop
      { item_id: "usr_ABC123_1_4", data: { ...goodLa, questions: [] } },                                        // no questions → drop
    ]);
    const rows = await fetchPersonalBank("la");
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("usr_ABC123_1_0");
  });

  test("LAT: keeps well-formed; drops missing transcript / bad answer", async () => {
    mockItems([
      { item_id: "usr_ABC123_2_0", data: goodLat },
      { item_id: "usr_ABC123_2_1", data: { ...goodLat, transcript: "" } },                          // no body → drop
      { item_id: "usr_ABC123_2_2", data: { ...goodLat, questions: [{ ...goodQ, answer: "Z" }] } },  // bad answer → drop
    ]);
    const rows = await fetchPersonalBank("lat");
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("usr_ABC123_2_0");
  });

  test("audio_url whitelist: keeps bucket / proxy path, nulls foreign URLs (LA)", async () => {
    mockItems([
      { item_id: "usr_ABC123_3_0", data: { ...goodLa, audio_url: "https://x.supabase.co/storage/v1/object/public/listening_audio/user/ABC123/usr_ABC123_3_0-1.mp3" } },
      { item_id: "usr_ABC123_3_1", data: { ...goodLa, audio_url: "/api/audio/user/ABC123/usr_ABC123_3_1-1.mp3" } },
      { item_id: "usr_ABC123_3_2", data: { ...goodLa, audio_url: "https://evil.example.com/track.mp3" } },
    ]);
    const rows = await fetchPersonalBank("la");
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId["usr_ABC123_3_0"].audio_url).toMatch(/listening_audio\/user\/ABC123\//);
    expect(byId["usr_ABC123_3_1"].audio_url).toBe("/api/audio/user/ABC123/usr_ABC123_3_1-1.mp3");
    expect(byId["usr_ABC123_3_2"].audio_url).toBeNull();
  });

  test("mapPersonalToPicker(la): situation/announcement → title, 我的 tag, 题数 subtitle", () => {
    const items = mapPersonalToPicker("la", [
      { id: "usr_ABC123_4_0", situation: "Library maintenance notice", announcement: "The library...", questions: [goodQ, goodQ] },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("usr_ABC123_4_0");
    expect(items[0].tag).toBe("我的");
    expect(items[0].title).toBe("Library maintenance notice");
    expect(items[0].subtitle).toBe("2 题");
    expect(items[0].personal).toBe(true);
  });

  test("mapPersonalToPicker(lat): topic → title, subject subtitle", () => {
    const items = mapPersonalToPicker("lat", [
      { id: "usr_ABC123_5_0", topic: "Volcanic rock formation", subject: "geology", transcript: "Today...", questions: [goodQ] },
    ]);
    expect(items[0].tag).toBe("我的");
    expect(items[0].title).toBe("Volcanic rock formation");
    expect(items[0].subtitle).toBe("geology");
    expect(items[0].personal).toBe(true);
  });
});
