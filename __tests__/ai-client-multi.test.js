/**
 * callAIMulti — 客户端多采样封装(三路取中位的浏览器侧入口)
 * 覆盖:contents 数组返回、缺 contents 退化 [content]、非 2xx 错误映射透传。
 */

import { callAI, callAIMulti } from "../lib/ai/client";

describe("callAIMulti", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test("returns the contents array (filtering empty strings) when server provides it", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: "a", contents: ["a", "", "  ", "b"] }),
    });

    const out = await callAIMulti("s", "m", 4000, 150000, 0.3, 3);
    expect(out).toEqual(["a", "b"]);
    // 请求体带 samples=3
    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body).samples).toBe(3);
  });

  test("degrades to [content] when server omits contents (rollout window)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: "only" }),
    });

    const out = await callAIMulti("s", "m", 4000, 150000, 0.3, 3);
    expect(out).toEqual(["only"]);
  });

  test("degrades to [content] when contents is present but all empty", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: "fallback", contents: ["", "   "] }),
    });

    const out = await callAIMulti("s", "m", 4000, 150000, 0.3, 3);
    expect(out).toEqual(["fallback"]);
  });

  test("propagates err.status / err.code / err.serverMessage on non-2xx", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ code: "DAILY_LIMIT", error: "Daily limit reached." }),
    });

    await expect(callAIMulti("s", "m", 4000, 150000, 0.3, 3)).rejects.toMatchObject({
      status: 429,
      code: "DAILY_LIMIT",
      serverMessage: "Daily limit reached.",
      message: "API error 429",
    });
  });
});

describe("callAI (single-sample, unchanged contract)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test("returns the content string and does NOT send a samples field", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: "hello" }),
    });

    const out = await callAI("s", "m", 2000);
    expect(out).toBe("hello");
    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body).samples).toBeUndefined();
  });
});
