/**
 * @jest-environment node
 */

// logApiFailure 只在 supabaseAdmin 已配置时才写 api_error_feedback,而本文件
// 其余用例特意在「未配置」状态下跑(测试环境无 Supabase env,与真模块行为一致)。
// 这里用 getter 做可切换的 mock:默认 false 保持全部既有用例行为不变;
// 「partial-failure logging」describe 按需切到 true 以观测错误表插入。
let mockSupabaseConfigured = false;
let mockUsersRow = null;
const mockInsertCalls = [];

jest.mock("../lib/supabaseAdmin", () => ({
  get isSupabaseAdminConfigured() { return mockSupabaseConfigured; },
  supabaseAdmin: {
    from(table) {
      const selectFilter = {
        eq() { return selectFilter; },
        async maybeSingle() {
          if (table === "users") return { data: mockUsersRow, error: null };
          return { data: null, error: null }; // daily_usage → 今日无记录
        },
      };
      return {
        select() { return selectFilter; },
        async insert(row) { mockInsertCalls.push({ table, row }); return { error: null }; },
      };
    },
    async rpc() { return { data: 1, error: null }; },
  },
}));

import { POST } from "../app/api/ai/route";

describe("/api/ai route", () => {
  const savedEnv = {};
  beforeEach(() => {
    // Ensure tests use the fetch path, not the curl proxy path
    ["DEEPSEEK_PROXY_URL", "HTTPS_PROXY", "HTTP_PROXY"].forEach((k) => {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Object.entries(savedEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  });

  test("returns parsed content when upstream succeeds", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{\"score\":4}" } }] }),
    });

    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "m", maxTokens: 100 }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.content).toBe("{\"score\":4}");
  });

  test("normalizes maxTokens and temperature to numbers before upstream call", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });

    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "m", maxTokens: "100", temperature: "0.8" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const [, options] = global.fetch.mock.calls[0];
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody.max_tokens).toBe(100);
    expect(typeof parsedBody.max_tokens).toBe("number");
    expect(parsedBody.temperature).toBe(0.8);
    expect(typeof parsedBody.temperature).toBe("number");
  });

  test("passes through upstream error status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });

    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "m" }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toMatch(/unavailable|retry/i);
  });

  test("rejects invalid oversized request body", async () => {
    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "x".repeat(50000), maxTokens: 100 }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/too long/i);
  });

  test("rejects token requests above the 8192-token writing-report ceiling", async () => {
    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "m", maxTokens: 8193 }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("8192");
  });

  test("rejects cross-origin browser request", async () => {
    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { origin: "https://evil.example", host: "localhost" },
      body: JSON.stringify({ system: "s", message: "m", maxTokens: 100 }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toMatch(/forbidden origin/i);
  });

  test("rejects oversized request by content-length header", async () => {
    const req = new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "content-length": "130000" },
      body: JSON.stringify({ system: "s", message: "m", maxTokens: 100 }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(413);
    expect(body.error).toMatch(/too large/i);
  });

  // ── samples 参数(三路取中位的服务端 fan-out)────────────────
  describe("samples validation", () => {
    test.each([
      ["zero", 0],
      ["above max", 4],
      ["non-integer", 1.5],
      ["non-numeric string", "abc"],
    ])("rejects invalid samples (%s)", async (_label, samples) => {
      const req = new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, samples }),
      });
      const res = await POST(req);
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toMatch(/samples must be an integer between 1 and 3/i);
    });

    test("defaults to a single call (no contents field) when samples omitted", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "solo" } }] }),
      });

      const req = new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 100 }),
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.content).toBe("solo");
      expect(body.contents).toBeUndefined();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test("samples=3 fans out 3 upstream calls and returns a contents array", async () => {
      let n = 0;
      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: `sample-${++n}` } }] }),
      }));

      const req = new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, samples: 3 }),
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(Array.isArray(body.contents)).toBe(true);
      expect(body.contents).toHaveLength(3);
      expect(body.content).toBe(body.contents[0]);
    });

    test("samples=3 tolerates a partial failure (2 succeed, 1 fails)", async () => {
      // 429 不可重试(5xx 会被快速重试一次并恢复,见下方 direct-path describe)。
      let n = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        n += 1;
        if (n === 2) return { ok: false, status: 429, text: async () => "boom" };
        return { ok: true, json: async () => ({ choices: [{ message: { content: `ok-${n}` } }] }) };
      });

      const req = new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, samples: 3 }),
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.contents).toHaveLength(2);
      expect(body.content).toBe(body.contents[0]);
    });

    test("samples>1 with zero successes returns fail() upstream shape", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "all down",
      });

      const req = new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, samples: 2 }),
      });
      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.error).toMatch(/unavailable|retry/i);
    });
  });

  // ── 2026-09-09 直连路径:流式拼接 + 快速 5xx 单次重试 + 上游状态码留痕 ──
  describe("direct path streaming + retry", () => {
    function sseResponse(chunks) {
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
          controller.close();
        },
      });
      return { ok: true, status: 200, headers: new Headers({ "content-type": "text/event-stream" }), body };
    }
    const singleRequest = () => new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "m", maxTokens: 100 }),
    });

    test("sends stream:true upstream and reassembles SSE deltas (keep-alive, split chunks, [DONE])", async () => {
      global.fetch = jest.fn().mockResolvedValue(sseResponse([
        ": keep-alive\n\n",
        'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"===SC"}}]}\n\ndata: {"choices":[{"del',
        'ta":{"content":"ORE===\\n4"}}]}\n\n',
        "data: [DONE]\n\n",
      ]));

      const res = await POST(singleRequest());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.content).toBe("===SCORE===\n4");
      const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(sent.stream).toBe(true);
      expect(global.fetch.mock.calls[0][1].signal).toBeDefined();
    });

    test("an error object inside the stream fails that sample with its text", async () => {
      global.fetch = jest.fn().mockResolvedValue(sseResponse([
        'data: {"error":{"message":"server overloaded","code":"503"}}\n\n',
      ]));

      const res = await POST(singleRequest());
      expect(res.status).toBe(502); // 有 errText 无 status → 按上游失败映射 502
    });

    test("retries a fast 5xx once and succeeds on the second attempt", async () => {
      let n = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        n += 1;
        if (n === 1) return { ok: false, status: 503, text: async () => "overloaded" };
        return { ok: true, json: async () => ({ choices: [{ message: { content: "recovered" } }] }) };
      });

      const res = await POST(singleRequest());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.content).toBe("recovered");
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test("does not retry 402 (insufficient balance) and passes status through", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 402, text: async () => "Insufficient Balance" });

      const res = await POST(singleRequest());

      expect(res.status).toBe(402);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // ── 2026-09-13 故障:上游 200 + 空正文被单采样路径原样放行 ───────────
    // v4-flash 的 reasoning_tokens 计入 max_tokens 预算,预算被推理吃光时上游回
    // finish_reason=length + 空 content 而 HTTP 仍是 200。放行它 = 前端拿到
    // {content:""} 当成功,AI 解释渲染成「点了不出内容也不报错」的死按钮。
    test("SSE 流里只有 reasoning_content(正文为空)→ 按上游失败回 502，不是 200 空串", async () => {
      global.fetch = jest.fn().mockResolvedValue(sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"先分析主谓"}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":"再看时态"},"finish_reason":"length"}]}\n\n',
        "data: [DONE]\n\n",
      ]));

      const res = await POST(singleRequest());

      expect(res.status).toBe(502);
      expect((await res.json()).content).toBeUndefined();
    });

    test("非流式 JSON 正文为空 → 同样回 502", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ choices: [{ message: { content: "" }, finish_reason: "length" }] }),
      });

      const res = await POST(singleRequest());

      expect(res.status).toBe(502);
    });

    test("空正文会留痕到 api_error_feedback(errorType=empty_content)，且不扣用量", async () => {
      mockSupabaseConfigured = true;
      mockUsersRow = { tier: "pro", tier_expires_at: "2999-01-01T00:00:00.000Z" };
      mockInsertCalls.length = 0;
      try {
        global.fetch = jest.fn().mockResolvedValue(sseResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"想了很久"}}]}\n\n',
          "data: [DONE]\n\n",
        ]));
        const req = new Request("http://localhost/api/ai", {
          method: "POST",
          body: JSON.stringify({ system: "s", message: "m", maxTokens: 2000, userCode: "ABC123" }),
        });

        const res = await POST(req);

        expect(res.status).toBe(502);
        // 关键:原来是 200,这条记录根本不存在,后台 /admin-api-errors 查不到任何线索。
        const failRow = mockInsertCalls.find((c) => c.table === "api_error_feedback");
        expect(failRow.row.error_type).toBe("empty_content");
        expect(failRow.row.http_status).toBe(502);
        expect(failRow.row.error_detail).toContain("empty content");
      } finally {
        mockSupabaseConfigured = false;
        mockUsersRow = null;
      }
    });

    test("records the upstream status in error_detail when every attempt fails", async () => {
      mockSupabaseConfigured = true;
      mockUsersRow = { tier: "pro", tier_expires_at: "2999-01-01T00:00:00.000Z" };
      mockInsertCalls.length = 0;
      try {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 504, text: async () => "<html>Gateway Time-out</html>" });
        const req = new Request("http://localhost/api/ai", {
          method: "POST",
          body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, samples: 3, userCode: "ABC123" }),
        });
        const res = await POST(req);

        expect(res.status).toBe(502);
        expect(global.fetch).toHaveBeenCalledTimes(6); // 3 路 × (1 + 1 次重试)
        const failRow = mockInsertCalls.find((c) => c.table === "api_error_feedback" && c.row.stage === "deepseek");
        expect(failRow.row.http_status).toBe(502);
        expect(failRow.row.error_detail).toBe("upstream 504: <html>Gateway Time-out</html>");
      } finally {
        mockSupabaseConfigured = false;
        mockUsersRow = null;
      }
    });
  });

  // ── 修6:多采样部分失败留痕(stage=deepseek_partial)────────────
  describe("partial-failure logging (deepseek_partial)", () => {
    beforeEach(() => {
      mockSupabaseConfigured = true;
      mockUsersRow = { tier: "pro", tier_expires_at: "2999-01-01T00:00:00.000Z" };
      mockInsertCalls.length = 0;
    });
    afterEach(() => {
      mockSupabaseConfigured = false;
      mockUsersRow = null;
    });

    function fanoutRequest() {
      return new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 100, samples: 3, userCode: "ABC123" }),
      });
    }

    test("logs each rejected sample to api_error_feedback while the request still succeeds", async () => {
      let n = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        n += 1;
        if (n === 2) return { ok: false, status: 429, text: async () => "boom" };
        return { ok: true, json: async () => ({ choices: [{ message: { content: `ok-${n}` } }] }) };
      });

      const res = await POST(fanoutRequest());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.contents).toHaveLength(2);
      const errorLogs = mockInsertCalls.filter((c) => c.table === "api_error_feedback");
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].row.stage).toBe("deepseek_partial");
      expect(errorLogs[0].row.error_type).toBe("upstream_partial");
      expect(errorLogs[0].row.http_status).toBe(429);
      expect(errorLogs[0].row.error_detail).toBe("boom");
    });

    test("does not log when all samples succeed", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      });

      const res = await POST(fanoutRequest());

      expect(res.status).toBe(200);
      expect(mockInsertCalls.filter((c) => c.table === "api_error_feedback")).toHaveLength(0);
    });
  });

  // ——— 流式回传 ————————————————————————————————————————————————————
  //
  // 2026-09-14：讲解类调用点了几十秒弹「AI 响应超时，请重试」。根因是本路由把上游
  // 整条 SSE 拼完才回 JSON，而 v4-flash 推理阶段不产 content —— 浏览器几十秒收不到
  // 任何字节，客户端 60s 总时长超时必然误杀一次**成功**的调用（用量还照扣）。
  // 这个 describe 锁「服务端确实在边收边转发，且推理阶段有心跳」。
  describe("stream:true 边收边转发", () => {
    // 造一个 SSE 形状的上游响应：body 是异步可迭代（route 用 for await 读）。
    function upstreamSse(lines) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "text/event-stream" },
        body: (async function* () {
          for (const line of lines) yield Buffer.from(line, "utf8");
        })(),
      };
    }

    function streamRequest(extra = {}) {
      return new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 2000, stream: true, ...extra }),
      });
    }

    async function readAll(res) {
      const decoder = new TextDecoder("utf-8");
      let out = "";
      for await (const chunk of res.body) {
        out += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      }
      return out;
    }

    test("正文增量逐段发给浏览器，最后一条 done", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        upstreamSse([
          'data: {"choices":[{"delta":{"content":"被动语态"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"要求过去分词。"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );

      const res = await POST(streamRequest());
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      // 中间层(Nginx 类)默认会缓冲响应，那样流式就退化回一次性返回了。
      expect(res.headers.get("x-accel-buffering")).toBe("no");

      const body = await readAll(res);
      expect(body).toContain('data: {"delta":"被动语态"}');
      expect(body).toContain('data: {"delta":"要求过去分词。"}');
      expect(body).toContain('data: {"done":true}');
    });

    test("推理阶段（只有 reasoning_content）也发心跳——这正是旧版几十秒零字节的那一段", async () => {
      global.fetch = jest.fn().mockResolvedValue(
        upstreamSse([
          'data: {"choices":[{"delta":{"reasoning_content":"先想想语法"}}]}\n\n',
          'data: {"choices":[{"delta":{"reasoning_content":"再想想搭配"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"正文"}}]}\n\n',
          "data: [DONE]\n\n",
        ]),
      );

      const body = await readAll(await POST(streamRequest()));
      // 心跳是 SSE 注释行：客户端拿它清零静默计时器，但不当数据。
      expect((body.match(/^: tick$/gm) || []).length).toBe(2);
      // 推理内容本身绝不能漏给前端（那是模型的草稿，不是讲解）。
      expect(body).not.toContain("先想想语法");
      expect(body).toContain('data: {"delta":"正文"}');
    });

    test("上游回空正文 → 流里报错，不发 done（否则前端拿到「成功但没内容」）", async () => {
      global.fetch = jest.fn().mockResolvedValue(upstreamSse(["data: [DONE]\n\n"]));

      const body = await readAll(await POST(streamRequest()));
      expect(body).toContain('"error"');
      expect(body).toContain('"status":502');
      expect(body).not.toContain('"done":true');
    });

    test("上游 5xx → 流里报错事件", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => "upstream down",
        headers: { get: () => "application/json" },
      });

      const body = await readAll(await POST(streamRequest()));
      expect(body).toContain('"status":502');
      expect(body).not.toContain('"done":true');
    });

    test("上游忽略 stream 回整包 JSON 时，补发一条全文 delta", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "整包回来的讲解" } }] }),
      });

      const body = await readAll(await POST(streamRequest()));
      expect(body).toContain('data: {"delta":"整包回来的讲解"}');
      expect(body).toContain('data: {"done":true}');
    });

    test("多采样（写作评分）不受影响，仍是一次性 JSON", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "报告" } }] }),
      });

      const res = await POST(streamRequest({ samples: 3 }));
      expect(res.headers.get("content-type")).toContain("application/json");
      const parsed = await res.json();
      expect(parsed.contents).toHaveLength(3);
    });
  });

  // ——— 空正文自动升档 ————————————————————————————————————————————————
  //
  // 2026-09-14：讲解预算按用途分档（查词 800 / 单句 1200 / 整篇 2000）之后，快档
  // 偶尔会被长推理吃光（这正是 09-13 那次「点了不出内容」的机制）。所以小预算必须
  // 配一道升档：同一次请求里换大预算重来，用户只经历一次调用、也只扣一次用量。
  // 没有这道保险，分档就等于把修好的故障放回去。
  describe("retryMaxTokens：空正文在同一次请求里升档重来", () => {
    function jsonUpstream(contents) {
      const queue = [...contents];
      return jest.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: queue.shift() ?? "" } }] }),
      }));
    }

    function req(extra = {}) {
      return new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 800, ...extra }),
      });
    }

    test("第一次空 → 用 retryMaxTokens 再来一次，返回第二次的正文", async () => {
      global.fetch = jsonUpstream(["", "升档后出来的讲解"]);

      const res = await POST(req({ retryMaxTokens: 2000 }));
      expect(res.status).toBe(200);
      expect((await res.json()).content).toBe("升档后出来的讲解");

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(global.fetch.mock.calls[0][1].body).max_tokens).toBe(800);
      expect(JSON.parse(global.fetch.mock.calls[1][1].body).max_tokens).toBe(2000);
    });

    test("第一次就有正文 → 绝不多打一次（升档是兜底，不是常态）", async () => {
      global.fetch = jsonUpstream(["一次就够"]);

      const res = await POST(req({ retryMaxTokens: 2000 }));
      expect((await res.json()).content).toBe("一次就够");
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test("没带 retryMaxTokens（或不比 maxTokens 大）→ 维持原样回 502，不做同档重试", async () => {
      global.fetch = jsonUpstream(["", "不该被用到"]);
      const res = await POST(req({ retryMaxTokens: 800 }));

      expect(res.status).toBe(502);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test("非法 retryMaxTokens 被拒（别让它变成放大调用的口子）", async () => {
      global.fetch = jsonUpstream(["x"]);
      const res = await POST(req({ retryMaxTokens: 99999 }));
      expect(res.status).toBe(400);
    });

    test("时间不够时不升档：两次各吃满预算会被 Vercel 在 maxDuration 处斩断", async () => {
      // 第一次调用慢到把共享截止线几乎用光（内部 168s 预算 - 这里的 150s = 剩 15s，
      // 低于 30s 的升档门槛），此时宁可回一条能看懂的 502，也不要开第二次然后被杀。
      jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
      try {
        global.fetch = jest.fn().mockImplementation(async () => {
          jest.advanceTimersByTime(150000);
          return { ok: true, json: async () => ({ choices: [{ message: { content: "" } }] }) };
        });

        const res = await POST(req({ retryMaxTokens: 2000 }));
        expect(res.status).toBe(502);
        expect(global.fetch).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    test("升档两次都空 → 还是 502，不会伪装成成功", async () => {
      global.fetch = jsonUpstream(["", ""]);
      const res = await POST(req({ retryMaxTokens: 2000 }));
      expect(res.status).toBe(502);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test("流式路径同样升档，且对前端透明（第一次没发出任何 delta）", async () => {
      let call = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        call += 1;
        const lines =
          call === 1
            ? ['data: {"choices":[{"delta":{"reasoning_content":"想太久"}}]}\n\n', "data: [DONE]\n\n"]
            : ['data: {"choices":[{"delta":{"content":"升档后的讲解"}}]}\n\n', "data: [DONE]\n\n"];
        return {
          ok: true,
          status: 200,
          headers: { get: () => "text/event-stream" },
          body: (async function* () {
            for (const l of lines) yield Buffer.from(l, "utf8");
          })(),
        };
      });

      const res = await POST(req({ retryMaxTokens: 2000, stream: true }));
      const decoder = new TextDecoder("utf-8");
      let out = "";
      for await (const chunk of res.body) out += decoder.decode(chunk, { stream: true });

      expect(call).toBe(2);
      // 只有一条 delta：第一次是空的，用户不会看到半截讲解接另一半。
      expect((out.match(/"delta"/g) || []).length).toBe(1);
      expect(out).toContain('data: {"delta":"升档后的讲解"}');
      expect(out).toContain('data: {"done":true}');
    });
  });

  describe("升档要留痕（调档的唯一真实依据）", () => {
    beforeEach(() => {
      mockSupabaseConfigured = true;
      mockUsersRow = { tier: "pro", tier_expires_at: "2999-01-01T00:00:00.000Z" };
      mockInsertCalls.length = 0;
    });
    afterEach(() => {
      mockSupabaseConfigured = false;
      mockUsersRow = null;
    });

    test("升档成功时记一行 budget_escalated（某档频繁升档 = 给小了）", async () => {
      const queue = ["", "升档后出来的讲解"];
      global.fetch = jest.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: queue.shift() ?? "" } }] }),
      }));

      const res = await POST(
        new Request("http://localhost/api/ai", {
          method: "POST",
          body: JSON.stringify({ system: "s", message: "m", maxTokens: 800, retryMaxTokens: 2000, userCode: "ABC123" }),
        }),
      );
      expect(res.status).toBe(200);

      const logs = mockInsertCalls.filter((c) => c.table === "api_error_feedback");
      expect(logs).toHaveLength(1);
      expect(logs[0].row.error_type).toBe("budget_escalated");
      expect(logs[0].row.error_message).toContain("800");
      expect(logs[0].row.error_message).toContain("2000");
    });
  });
});
