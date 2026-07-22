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

  test("forwards Range and returns a fixed-length 206 (iOS/AVFoundation contract)", async () => {
    global.fetch = jest.fn(async (url, opts) => {
      // Assert the proxy built the correct Supabase URL and forwarded Range.
      expect(url).toBe("https://abc123.supabase.co/storage/v1/object/public/listening_audio/choose-response/lcr_001.mp3");
      expect(opts.headers.Range).toBe("bytes=0-9");
      return new Response("AUDIOBYTES", {
        status: 206,
        headers: {
          "content-type": "audio/mpeg",
          "content-range": "bytes 0-9/4096",
          "accept-ranges": "bytes",
          "content-length": "10",
        },
      });
    });

    const res = await GET(req("bytes=0-9"), { params: { path: ["choose-response", "lcr_001.mp3"] } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("content-range")).toBe("bytes 0-9/4096");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toMatch(/immutable/);
    // content-length 锁成实际 body 字节数（定长响应，不允许被 chunked 化丢掉）。
    expect(res.headers.get("content-length")).toBe("10");
    expect(await res.text()).toBe("AUDIOBYTES");
  });

  // 上游无视 Range 回 200 时，本层必须自行切片出精确的 206 —— iOS 的探测请求
  // (bytes=0-1) 拿不到严格的 partial 语义就会永远停在缓冲。
  const fullBody = (body = "0123456789") =>
    jest.fn(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "audio/mpeg", "content-length": String(body.length) },
    }));

  test("upstream ignores Range (200) → proxy slices a proper 206 itself", async () => {
    global.fetch = fullBody();
    const res = await GET(req("bytes=2-5"), { params: { path: ["x.mp3"] } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("2345");
  });

  test("open-ended and suffix ranges are sliced correctly", async () => {
    global.fetch = fullBody();
    const open = await GET(req("bytes=3-"), { params: { path: ["x.mp3"] } });
    expect(open.status).toBe(206);
    expect(open.headers.get("content-range")).toBe("bytes 3-9/10");
    expect(await open.text()).toBe("3456789");

    global.fetch = fullBody();
    const suffix = await GET(req("bytes=-4"), { params: { path: ["x.mp3"] } });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe("bytes 6-9/10");
    expect(await suffix.text()).toBe("6789");
  });

  test("unsatisfiable range → 416 with the total size", async () => {
    global.fetch = fullBody();
    const res = await GET(req("bytes=99-"), { params: { path: ["x.mp3"] } });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10");
  });

  test("oversized clip (beyond buffer cap) falls back to streaming passthrough", async () => {
    global.fetch = jest.fn(async () => new Response("HUGE", {
      status: 206,
      headers: {
        "content-type": "audio/mpeg",
        "content-range": "bytes 0-3/30000000",
        "content-length": "30000000",
      },
    }));
    const res = await GET(req("bytes=0-3"), { params: { path: ["x.mp3"] } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-length")).toBe("30000000");
    expect(await res.text()).toBe("HUGE");
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
