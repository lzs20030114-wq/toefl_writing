/**
 * 客户端一侧的三件事（2026-09-20 事故）：
 *   ① 把自己的外层超时告诉服务端，让服务端的上游预算收敛进来；
 *   ② 504（上游排队）的文案不许再让用户去「检查网络」——真因与网络无关；
 *   ③ 「发出去就失败」补发一次，但只在快速失败时补（慢失败可能已经到了服务端，
 *      重发有重复计费风险）。
 */

import { callAI, mapAiHelperError, mapScoringError, isUpstreamQueuedError } from "../lib/ai/client";

function okResponse(content = "ok") {
  return { ok: true, json: async () => ({ content }) };
}

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

describe("请求体携带 clientTimeoutMs", () => {
  test("把外层超时一起发给服务端", async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse());
    await callAI("s", "m", 2000, 60000, 0.3);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.clientTimeoutMs).toBe(60000);
  });

  test("超出服务端允许区间的值不发，免得为了对齐反被判 400", async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse());
    await callAI("s", "m", 2000, 1000, 0.3);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.clientTimeoutMs).toBeUndefined();
  });
});

describe("504 文案", () => {
  const queued = Object.assign(new Error("API error 504"), { status: 504, code: "UPSTREAM_TIMEOUT" });

  test("识别为「上游排队」", () => {
    expect(isUpstreamQueuedError(queued)).toBe(true);
    expect(isUpstreamQueuedError(Object.assign(new Error("x"), { status: 502 }))).toBe(false);
  });

  test("讲解类：说排队，不说网络", () => {
    const msg = mapAiHelperError(queued);
    expect(msg).toContain("排队");
    expect(msg).not.toContain("网络");
  });

  test("评分类：同样不提网络", () => {
    const msg = mapScoringError(queued);
    expect(msg).toContain("排队");
    expect(msg).not.toContain("网络");
  });

  test("真的网络不通时仍然提示检查网络（没有误伤原有分支）", () => {
    expect(mapScoringError(new Error("Failed to fetch"))).toContain("网络");
    expect(mapAiHelperError(new Error("Failed to fetch"))).toContain("网络");
  });
});

describe("「发出去就失败」补发一次", () => {
  test("快速失败 → 补发一次并成功", async () => {
    let n = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      n += 1;
      if (n === 1) throw new TypeError("Failed to fetch");
      return okResponse("recovered");
    });

    const out = await callAI("s", "m", 2000, 60000, 0.3);

    expect(out).toBe("recovered");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("补发也失败 → 把错误抛出去，不无限重试", async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(callAI("s", "m", 2000, 60000, 0.3)).rejects.toThrow(/Failed to fetch/);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("慢失败不补发：请求很可能已经到了服务端，重发会重复计费", async () => {
    const realNow = Date.now;
    let t = realNow();
    jest.spyOn(Date, "now").mockImplementation(() => t);
    global.fetch = jest.fn().mockImplementation(async () => {
      t += 30000; // 失败前已经过了 30 秒
      throw new TypeError("Failed to fetch");
    });

    await expect(callAI("s", "m", 2000, 60000, 0.3)).rejects.toThrow(/Failed to fetch/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    Date.now = realNow;
  });

  test("调用方主动中止不补发", async () => {
    const controller = new AbortController();
    global.fetch = jest.fn().mockImplementation(async () => {
      controller.abort();
      throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    });

    await expect(callAI("s", "m", 2000, 60000, 0.3, { signal: controller.signal })).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("外部中止信号", () => {
  test("signal 一中止，请求随即收手", async () => {
    const controller = new AbortController();
    global.fetch = jest.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
      });
    }));

    const promise = callAI("s", "m", 2000, 60000, 0.3, { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow(/aborted/i);
  });
});
