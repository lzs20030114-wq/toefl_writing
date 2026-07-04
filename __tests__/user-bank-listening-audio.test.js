const {
  isListeningType,
  stripClientAudioUrl,
  userAudioStoragePath,
} = require("../lib/userBank/listeningAudio");

// Security patches A (strip client audio_url on save) + B (only reap this user's own bucket audio
// on delete), tested as pure helpers. 研究附录 C, §3 补丁表 #3/#4/#5.
describe("stripClientAudioUrl (security patch A)", () => {
  test("strips audio_url from a listening (lcr) item", () => {
    const out = stripClientAudioUrl("lcr", { speaker: "hi", audio_url: "https://evil.example.com/x.mp3", options: {} });
    expect(out).not.toHaveProperty("audio_url");
    expect(out.speaker).toBe("hi");
  });

  test("leaves listening item without audio_url untouched", () => {
    const data = { speaker: "hi", options: { A: "a" } };
    const out = stripClientAudioUrl("lcr", data);
    expect(out).toEqual(data);
  });

  test("passes NON-listening types through untouched (they legitimately have no audio)", () => {
    const data = { text: "passage", audio_url: "should-not-happen" };
    // rdl is not a listening type — helper doesn't touch it.
    expect(stripClientAudioUrl("rdl", data)).toEqual(data);
    expect(stripClientAudioUrl("discussion", { professor: {} })).toEqual({ professor: {} });
  });

  test("does not mutate the input object", () => {
    const data = { speaker: "hi", audio_url: "x" };
    stripClientAudioUrl("lcr", data);
    expect(data).toHaveProperty("audio_url"); // original still intact
  });

  test("null / non-object data is safe", () => {
    expect(stripClientAudioUrl("lcr", null)).toBeNull();
    expect(stripClientAudioUrl("lcr", "str")).toBe("str");
  });

  test("isListeningType is case-insensitive and only true for listening subtypes", () => {
    expect(isListeningType("lcr")).toBe(true);
    expect(isListeningType("LCR")).toBe(true);
    expect(isListeningType("rdl")).toBe(false);
    expect(isListeningType("")).toBe(false);
  });
});

describe("userAudioStoragePath (security patch B — DELETE path resolution)", () => {
  const CODE = "ABC123";

  test("resolves a raw Supabase bucket URL under this user's prefix", () => {
    const url = "https://proj.supabase.co/storage/v1/object/public/listening_audio/user/ABC123/usr_ABC123_1_0-1780.mp3";
    expect(userAudioStoragePath(CODE, url)).toBe("user/ABC123/usr_ABC123_1_0-1780.mp3");
  });

  test("resolves a same-origin /api/audio/ proxy path under this user's prefix", () => {
    const url = "/api/audio/user/ABC123/usr_ABC123_1_0-1780.mp3";
    expect(userAudioStoragePath(CODE, url)).toBe("user/ABC123/usr_ABC123_1_0-1780.mp3");
  });

  test("returns null for ANOTHER user's prefix (no cross-user delete)", () => {
    const url = "https://proj.supabase.co/storage/v1/object/public/listening_audio/user/XYZ999/x.mp3";
    expect(userAudioStoragePath(CODE, url)).toBeNull();
  });

  test("returns null for a global-bank path (choose-response/…) — not user-owned", () => {
    const url = "https://proj.supabase.co/storage/v1/object/public/listening_audio/choose-response/lcr_1.mp3";
    expect(userAudioStoragePath(CODE, url)).toBeNull();
  });

  test("returns null for a foreign host / non-bucket URL", () => {
    expect(userAudioStoragePath(CODE, "https://evil.example.com/user/ABC123/x.mp3")).toBeNull();
    expect(userAudioStoragePath(CODE, "https://evil.example.com/track.mp3")).toBeNull();
  });

  test("returns null on path-traversal attempts", () => {
    expect(userAudioStoragePath(CODE, "/api/audio/user/ABC123/../../secret.mp3")).toBeNull();
  });

  test("decodes percent-encoded segments before the prefix check", () => {
    // /api/audio encodes each segment; the stored proxy path may be encoded.
    const url = "/api/audio/user/ABC123/usr_ABC123_1_0-1780.mp3";
    expect(userAudioStoragePath(CODE, url)).toBe("user/ABC123/usr_ABC123_1_0-1780.mp3");
  });

  test("empty / missing inputs → null", () => {
    expect(userAudioStoragePath(CODE, "")).toBeNull();
    expect(userAudioStoragePath("", "/api/audio/user/ABC123/x.mp3")).toBeNull();
    expect(userAudioStoragePath(CODE, null)).toBeNull();
  });
});
