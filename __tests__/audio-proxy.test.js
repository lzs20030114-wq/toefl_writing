/**
 * @jest-environment node
 *
 * Locks the P2 fix (2026-06-26): listening audio is served same-origin via the
 * /api/audio edge proxy so it loads where supabase.co is blocked (mainland CN,
 * no proxy). Covers the URL-rewrite helper and the streaming route handler.
 *
 * Runs in the node env (not jsdom) so the route's global Response/Headers/fetch
 * resolve to Node's native Edge-compatible implementations.
 */
const { sameOriginAudio } = require("../lib/listening/audioSrc");

const SUPA = "https://abc123.supabase.co/storage/v1/object/public/listening_audio/choose-response/lcr_001.mp3";

describe("sameOriginAudio", () => {
  const prev = process.env.NEXT_PUBLIC_AUDIO_PROXY_DISABLED;
  afterEach(() => { process.env.NEXT_PUBLIC_AUDIO_PROXY_DISABLED = prev; });

  test("rewrites a Supabase listening_audio URL to the same-origin proxy path", () => {
    expect(sameOriginAudio(SUPA)).toBe("/api/audio/choose-response/lcr_001.mp3");
  });

  test("leaves non-Supabase / already-relative / empty values untouched", () => {
    expect(sameOriginAudio("/api/audio/x.mp3")).toBe("/api/audio/x.mp3");
    expect(sameOriginAudio("/listening-audio/x.mp3")).toBe("/listening-audio/x.mp3");
    expect(sameOriginAudio("https://other.cdn/x.mp3")).toBe("https://other.cdn/x.mp3");
    expect(sameOriginAudio(null)).toBe(null);
    expect(sameOriginAudio("")).toBe("");
  });

  test("kill switch returns the raw Supabase URL", () => {
    process.env.NEXT_PUBLIC_AUDIO_PROXY_DISABLED = "1";
    expect(sameOriginAudio(SUPA)).toBe(SUPA);
  });
});

describe("/api/audio edge route", () => {
  let GET;

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc123.supabase.co";
    GET = require("../app/api/audio/[...path]/route.js").GET;
  });
  afterEach(() => { delete global.fetch; });

  const req = (range) => ({ headers: new Headers(range ? { Range: range } : {}) });

  test("streams the upstream body, forwards Range, and copies media headers", async () => {
    global.fetch = jest.fn(async (url, opts) => {
      // Assert the proxy built the correct Supabase URL and forwarded Range.
      expect(url).toBe("https://abc123.supabase.co/storage/v1/object/public/listening_audio/choose-response/lcr_001.mp3");
      expect(opts.headers.Range).toBe("bytes=0-1023");
      return new Response("AUDIOBYTES", {
        status: 206,
        headers: {
          "content-type": "audio/mpeg",
          "content-range": "bytes 0-1023/4096",
          "accept-ranges": "bytes",
          "content-length": "1024",
        },
      });
    });

    const res = await GET(req("bytes=0-1023"), { params: { path: ["choose-response", "lcr_001.mp3"] } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("content-range")).toBe("bytes 0-1023/4096");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toMatch(/immutable/);
    expect(await res.text()).toBe("AUDIOBYTES");
  });

  test("rejects path traversal and non-audio extensions without fetching", async () => {
    global.fetch = jest.fn();
    const bad = await GET(req(), { params: { path: ["..", "secret.mp3"] } });
    expect(bad.status).toBe(400);
    const notAudio = await GET(req(), { params: { path: ["x.txt"] } });
    expect(notAudio.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("a failed upstream fetch returns 502 so the client can fall back to TTS", async () => {
    global.fetch = jest.fn(async () => { throw new Error("ECONNREFUSED"); });
    const res = await GET(req(), { params: { path: ["choose-response", "lcr_001.mp3"] } });
    expect(res.status).toBe(502);
  });
});
