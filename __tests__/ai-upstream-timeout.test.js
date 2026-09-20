/**
 * @jest-environment node
 */

/**
 * 上游超时口径（2026-09-20 事故）。
 *
 * 现场：DeepSeek 一段时间内整体变慢，同一用户连续五次评分各干等满 165s 的总预算
 * 才被掐断；用户看到「网络连接异常，请检查后重试」（与网络无关），后台只留下一条
 * stage=server / internal 的 500，看不出是超时。
 *
 * 这里锁住四件事：
 *   ① 无输出看门狗：流连上但迟迟不出 token，要在几十秒内判负并重试，不能拖满预算；
 *   ② 看门狗窗口随预算等比收缩——预算 54s 的调用不能还等 45s 才判；
 *   ③ 预算与客户端外层超时对齐：客户端 60s 就放弃了，服务端不许再等 165s；
 *   ④ 分类：我们自己掐断的超时是 504 upstream_timeout，上游回的 HTTP 错误仍是 502/原码。
 */

import {
  isUpstreamTimeoutError,
  resolveProgressTimeout,
  resolveUpstreamBudget,
  readSseContent,
  callDirectOnce,
  CLIENT_RESPONSE_MARGIN_MS,
  MIN_UPSTREAM_BUDGET_MS,
  DEFAULT_PROGRESS_TIMEOUT_MS,
} from "../lib/ai/upstream";
const { isRetryableTransportError } = require("../lib/ai/deepseekHttp");

describe("resolveUpstreamBudget —— 服务端预算收敛到客户端超时之内", () => {
  const SERVER = 165000;

  test("不带 clientTimeoutMs（老客户端 / 服务端互调）→ 用服务端默认预算", () => {
    expect(resolveUpstreamBudget(undefined, SERVER)).toBe(SERVER);
    expect(resolveUpstreamBudget(null, SERVER)).toBe(SERVER);
    expect(resolveUpstreamBudget(0, SERVER)).toBe(SERVER);
  });

  test("客户端比服务端短（听力讲解 60s）→ 收敛到客户端超时减去回包余量", () => {
    expect(resolveUpstreamBudget(60000, SERVER)).toBe(60000 - CLIENT_RESPONSE_MARGIN_MS);
  });

  test("客户端比服务端长（写作评分 175s）→ 仍受服务端上限约束", () => {
    expect(resolveUpstreamBudget(175000, SERVER)).toBe(SERVER);
  });

  test("客户端超时短到离谱也留一个下限，不至于必然失败", () => {
    expect(resolveUpstreamBudget(5000, SERVER)).toBe(MIN_UPSTREAM_BUDGET_MS);
  });
});

describe("resolveProgressTimeout —— 看门狗窗口", () => {
  test("大预算取默认窗口", () => {
    expect(resolveProgressTimeout(165000)).toBe(DEFAULT_PROGRESS_TIMEOUT_MS);
  });

  test("小预算等比收缩，给重试留出时间", () => {
    // 54s 预算：窗口 24.3s → 判负后还剩 ~30s 够重试一次。
    expect(resolveProgressTimeout(54000)).toBe(24300);
    expect(resolveProgressTimeout(54000)).toBeLessThan(54000 / 2);
  });

  test("再小也有下限，不会把正常的首字延迟误判成卡死", () => {
    expect(resolveProgressTimeout(15000)).toBe(12000);
  });
});

describe("isUpstreamTimeoutError —— 只认我们自己掐断的那两种", () => {
  test("看门狗 / 预算掐断 → 是", () => {
    expect(isUpstreamTimeoutError(Object.assign(new Error("stalled"), { code: "UPSTREAM_STALL" }))).toBe(true);
    expect(isUpstreamTimeoutError(Object.assign(new Error("budget"), { code: "UPSTREAM_BUDGET" }))).toBe(true);
    expect(isUpstreamTimeoutError(new Error("DeepSeek request timeout"))).toBe(true);
  });

  test("上游自己回的 HTTP 错误 → 否（哪怕正文里写着 Gateway Time-out）", () => {
    const upstream504 = Object.assign(new Error("DeepSeek 504"), {
      status: 504,
      errText: "<html>Gateway Time-out</html>",
    });
    expect(isUpstreamTimeoutError(upstream504)).toBe(false);
    expect(isUpstreamTimeoutError(Object.assign(new Error("DeepSeek 429"), { status: 429 }))).toBe(false);
    expect(isUpstreamTimeoutError(null)).toBe(false);
  });
});

describe("isRetryableTransportError —— 显式标注优先于文案启发式", () => {
  test("看门狗掐断的那一路可以重试（失败得早，预算还剩大半）", () => {
    const stalled = Object.assign(new Error("DeepSeek stream stalled: no output for 45s"), {
      code: "UPSTREAM_STALL",
      retryable: true,
    });
    expect(isRetryableTransportError(stalled)).toBe(true);
  });

  test("预算耗尽的那一路不重试（再试也没时间了）", () => {
    const expired = Object.assign(new Error("DeepSeek request timeout: upstream budget exhausted"), {
      code: "UPSTREAM_BUDGET",
      retryable: false,
    });
    expect(isRetryableTransportError(expired)).toBe(false);
  });
});

describe("readSseContent —— 每个 token 都喂一次看门狗", () => {
  function streamOf(chunks) {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
        controller.close();
      },
    });
  }

  test("正文与推理 token 都算「在产出」，keep-alive 注释不算", async () => {
    const ping = jest.fn();
    const out = await readSseContent(
      streamOf([
        ": keep-alive\n\n",
        ": keep-alive\n\n",
        'data: {"choices":[{"delta":{"reasoning_content":"想一下"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"答"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"案"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
      { onProgress: ping },
    );
    expect(out).toBe("答案");
    // 两条 keep-alive 不计入：只有 3 个 token（1 推理 + 2 正文）喂了看门狗。
    // 这是关键 —— 上游排队时连接是活的、keep-alive 照发，认它就永远抓不到卡死。
    expect(ping).toHaveBeenCalledTimes(3);
  });

  test("不传 onProgress 时行为不变（向后兼容）", async () => {
    const out = await readSseContent(streamOf([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      "data: [DONE]\n\n",
    ]));
    expect(out).toBe("ok");
  });
});

describe("callDirectOnce —— 迟迟不出 token 的一路会被掐断并重试", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test("首字超过看门狗窗口 → 判卡死，换一条连接重试，第二次成功", async () => {
    let attempt = 0;
    global.fetch = jest.fn().mockImplementation(async (_url, init) => {
      attempt += 1;
      if (attempt === 1) {
        // 第一路：连上了但永远不出 token（上游排队的真实形态）。
        // 只在被 abort 时才失败 —— 正是看门狗要抓的场景。
        return await new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
          });
        });
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ choices: [{ message: { content: "recovered" } }] }),
      };
    });

    const content = await callDirectOnce("key", { system: "s", message: "m", maxTokens: 100, temperature: 0.3 }, {
      totalBudgetMs: 60000,
      progressTimeoutMs: 60, // 测试里把窗口压到 60ms，语义不变
    });

    expect(content).toBe("recovered");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("预算耗尽 → 抛 UPSTREAM_BUDGET，不再重试", async () => {
    global.fetch = jest.fn().mockImplementation(async (_url, init) => (
      await new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
        });
      })
    ));

    await expect(
      callDirectOnce("key", { system: "s", message: "m", maxTokens: 100, temperature: 0.3 }, {
        // 预算比看门狗窗口还短 → 先到期的是预算。
        totalBudgetMs: 1000,
        progressTimeoutMs: 60000,
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_BUDGET" });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
