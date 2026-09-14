/**
 * 「AI 深入解析」点了几十秒后弹红字「AI 响应超时，请重试」—— 2026-09-14 用户截图。
 *
 * 故障链条：
 *   ① deepseek-v4-flash 先推理再出正文，推理阶段一个 content 字节都不产生；
 *      2026-09-13 把 AI_HELPER_MAX_TOKENS 从 260-700 抬到 2000（修「点了不出内容」）
 *      之后，模型能想更久，「思考 50s + 出正文 15s」成了完全正常的一次成功调用。
 *   ② /api/ai 虽然对上游开了 stream，却把整条 SSE 在服务端拼完才回一个 JSON，
 *      浏览器在那几十秒里收不到任何字节。
 *   ③ 客户端的超时是 **60s 总时长**，于是必然在正文到达前掐断。服务端那次回答其实
 *      生成完了，只是没人接 —— 用户白等 + 用量照扣，重试还是同样的结局。
 *
 * 修法是把整条链改成流式 + **静默超时**：只要还有字节（推理阶段发心跳注释行），
 * 计时器就清零；真卡死时 45s 就报错，比旧版更快。本文件锁客户端这一半，
 * 服务端那一半在 api-ai-route.test.js 的「流式回传」describe。
 */
// jsdom 不带 TextEncoder/TextDecoder（真浏览器都有）——补齐 jsdom 缺的浏览器 API
// 是测试隔离的本分，不是针对被测代码的 workaround。
const { TextEncoder: NodeTextEncoder, TextDecoder: NodeTextDecoder } = require("util");
if (typeof global.TextEncoder === "undefined") global.TextEncoder = NodeTextEncoder;
if (typeof global.TextDecoder === "undefined") global.TextDecoder = NodeTextDecoder;

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => "ABC123"),
  getSavedTier: jest.fn(() => "pro"),
}));

import {
  callAIStream,
  mapAiHelperError,
  AI_HELPER_MAX_TOKENS,
  AI_HELPER_IDLE_TIMEOUT_MS,
  AI_HELPER_TOTAL_TIMEOUT_MS,
} from "../lib/ai/client";

/** 造一个 SSE 形状的 fetch 响应：chunks 按顺序吐，每段之间可以停 gapMs。 */
function sseResponse(chunks, { gapMs = 0 } = {}) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream; charset=utf-8" },
    body: {
      getReader: () => ({
        read: async () => {
          if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
          if (i >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: enc.encode(chunks[i++]) };
        },
      }),
    },
  };
}

function mockFetch(response) {
  global.fetch = jest.fn().mockResolvedValue(response);
}

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

describe("callAIStream：边收边给，不再靠总时长判生死", () => {
  test("把 delta 拼成完整正文，并逐段回调累计文本", async () => {
    mockFetch(
      sseResponse([
        ": open\n\n",
        'data: {"delta":"被动语态"}\n\n',
        'data: {"delta":"要求过去分词。"}\n\n',
        'data: {"done":true}\n\n',
      ]),
    );

    const seen = [];
    const text = await callAIStream("s", "m", AI_HELPER_MAX_TOKENS, {
      onDelta: (partial) => seen.push(partial),
    });

    expect(text).toBe("被动语态要求过去分词。");
    // 回调给的是**累计**正文，调用方可以直接塞进面板，不用自己拼。
    expect(seen).toEqual(["被动语态", "被动语态要求过去分词。"]);
  });

  test("请求带 stream:true 与共享 token 预算", async () => {
    mockFetch(sseResponse(['data: {"delta":"讲解"}\n\n', 'data: {"done":true}\n\n']));
    await callAIStream("s", "m", AI_HELPER_MAX_TOKENS, {});

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.maxTokens).toBe(AI_HELPER_MAX_TOKENS);
  });

  test("分片在行中间被切开也要拼对（SSE 分片可以落在任意字节）", async () => {
    mockFetch(sseResponse(['data: {"del', 'ta":"前半"}\n\ndata: {"delta":"后半"}\n', "\n"]));
    await expect(callAIStream("s", "m", 2000, {})).resolves.toBe("前半后半");
  });

  test("心跳注释行不断清零静默计时器：每段间隔小于 idle 就不该超时", async () => {
    // 总耗时 ~200ms 远超 80ms 的静默上限，但每一段间隔只有 40ms。
    // 旧的「总时长超时」在这里必然误杀，这正是线上那次误报的模型。
    mockFetch(
      sseResponse([": open\n\n", ": tick\n\n", ": tick\n\n", 'data: {"delta":"想了很久才开口"}\n\n', 'data: {"done":true}\n\n'], {
        gapMs: 40,
      }),
    );

    await expect(
      callAIStream("s", "m", 2000, { idleTimeoutMs: 80, totalTimeoutMs: 5000 }),
    ).resolves.toBe("想了很久才开口");
  });

  test("真的静默到超时 → 报可重试的超时文案，而不是无限转圈", async () => {
    // 永远不出字节：只有客户端自己兜底才会结束（别指望 abort 一定能掀翻挂起的 read）。
    mockFetch({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: { getReader: () => ({ read: () => new Promise(() => {}) }) },
    });

    const err = await callAIStream("s", "m", 2000, { idleTimeoutMs: 60, totalTimeoutMs: 5000 }).catch((e) => e);
    expect(String(err.message)).toMatch(/api timeout/i);
    expect(mapAiHelperError(err)).toBe("AI 响应超时，请重试");
  });

  test("总时长兜底同样能收场（静默计时器被心跳一直续命时）", async () => {
    mockFetch(sseResponse([": tick\n\n", ": tick\n\n", ": tick\n\n", ": tick\n\n", ": tick\n\n"], { gapMs: 20 }));
    const err = await callAIStream("s", "m", 2000, { idleTimeoutMs: 5000, totalTimeoutMs: 60 }).catch((e) => e);
    expect(String(err.message)).toMatch(/api timeout/i);
  });

  test("流里报错（头已发出去只能在流里报）→ 按 status 归类文案", async () => {
    mockFetch(
      sseResponse([
        ": open\n\n",
        'data: {"error":"AI service temporarily unavailable. Please retry.","status":502}\n\n',
      ]),
    );
    const err = await callAIStream("s", "m", 2000, {}).catch((e) => e);
    expect(err.status).toBe(502);
    expect(mapAiHelperError(err)).toBe("服务暂时不可用，请重试");
  });

  test("只有心跳、一个 delta 都没有 → 空正文绝不当成功", async () => {
    mockFetch(sseResponse([": open\n\n", ": tick\n\n", 'data: {"done":true}\n\n']));
    const err = await callAIStream("s", "m", 2000, {}).catch((e) => e);
    expect(String(err.message)).toMatch(/empty ai response/i);
    expect(mapAiHelperError(err)).toBe("AI 没返回内容，请重试");
  });

  test("服务端不支持流式（本地代理路径 / 旧部署）→ 自动降级成一次性 JSON", async () => {
    mockFetch({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ content: "一次性返回的讲解" }),
    });

    const seen = [];
    const text = await callAIStream("s", "m", 2000, { onDelta: (p) => seen.push(p) });
    expect(text).toBe("一次性返回的讲解");
    // 降级路径也要喂一次 onDelta，调用方不必为两种响应写两套渲染。
    expect(seen).toEqual(["一次性返回的讲解"]);
  });

  test("流式开始前的 HTTP 错误仍带 status/code（升级引导、限流分类不能丢）", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "Daily limit reached.", code: "DAILY_LIMIT" }),
    });
    const err = await callAIStream("s", "m", 2000, {}).catch((e) => e);
    expect(err.status).toBe(429);
    expect(mapAiHelperError(err)).toBe("今日免费次数已用完，升级 Pro 可无限使用");
  });

  test("超时常量：静默上限要短于总上限，总上限要留在 Vercel maxDuration 之内", () => {
    expect(AI_HELPER_IDLE_TIMEOUT_MS).toBeLessThan(AI_HELPER_TOTAL_TIMEOUT_MS);
    // app/api/ai/route.js: maxDuration=180s、直连预算 165s。客户端兜底必须在这之后
    // 才有意义（否则又变成「服务端还在正常出字，客户端先判死」的老问题），
    // 但也不能超过 Vercel 会杀掉函数的 180s。
    expect(AI_HELPER_TOTAL_TIMEOUT_MS).toBeGreaterThan(165000);
    expect(AI_HELPER_TOTAL_TIMEOUT_MS).toBeLessThanOrEqual(180000);
  });
});
