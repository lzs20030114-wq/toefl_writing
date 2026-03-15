const { createRateLimiter, getIp } = require("../lib/rateLimit");

describe("createRateLimiter", () => {
  beforeEach(() => {
    // Clean up globalThis keys from previous tests
    for (const key of Object.keys(globalThis)) {
      if (key.startsWith("__rl_test")) delete globalThis[key];
    }
  });

  it("allows requests under the limit", () => {
    const limiter = createRateLimiter("test1", { max: 3 });
    expect(limiter.isLimited("ip1")).toBe(false); // 1
    expect(limiter.isLimited("ip1")).toBe(false); // 2
    expect(limiter.isLimited("ip1")).toBe(false); // 3
  });

  it("blocks requests over the limit", () => {
    const limiter = createRateLimiter("test2", { max: 2 });
    expect(limiter.isLimited("ip1")).toBe(false); // 1
    expect(limiter.isLimited("ip1")).toBe(false); // 2
    expect(limiter.isLimited("ip1")).toBe(true);  // 3 → blocked
  });

  it("tracks different keys independently", () => {
    const limiter = createRateLimiter("test3", { max: 1 });
    expect(limiter.isLimited("ip1")).toBe(false);
    expect(limiter.isLimited("ip2")).toBe(false);
    expect(limiter.isLimited("ip1")).toBe(true);  // ip1 over limit
    expect(limiter.isLimited("ip2")).toBe(true);  // ip2 over limit
  });

  it("resets after window expires", () => {
    const limiter = createRateLimiter("test4", { max: 1, window: 50 });
    expect(limiter.isLimited("ip1")).toBe(false);
    expect(limiter.isLimited("ip1")).toBe(true);

    // Simulate time passing by manipulating bucket directly
    const buckets = globalThis["__rl_test4"];
    const entry = buckets.get("ip1");
    entry.t -= 100; // push timestamp back past the window

    expect(limiter.isLimited("ip1")).toBe(false); // should be reset
  });

  it("uses separate buckets per name", () => {
    const a = createRateLimiter("test5a", { max: 1 });
    const b = createRateLimiter("test5b", { max: 1 });
    expect(a.isLimited("ip1")).toBe(false);
    expect(b.isLimited("ip1")).toBe(false); // different limiter, different bucket
    expect(a.isLimited("ip1")).toBe(true);
    expect(b.isLimited("ip1")).toBe(true);
  });
});

describe("getIp", () => {
  function mockReq(headers) {
    return { headers: { get: (key) => headers[key] || null } };
  }

  it("prefers cf-connecting-ip", () => {
    const req = mockReq({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" });
    expect(getIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-forwarded-for first entry", () => {
    const req = mockReq({ "x-forwarded-for": "10.0.0.1, 10.0.0.2" });
    expect(getIp(req)).toBe("10.0.0.1");
  });

  it("falls back to x-real-ip", () => {
    const req = mockReq({ "x-real-ip": "192.168.1.1" });
    expect(getIp(req)).toBe("192.168.1.1");
  });

  it("returns unknown when no headers present", () => {
    const req = mockReq({});
    expect(getIp(req)).toBe("unknown");
  });
});
