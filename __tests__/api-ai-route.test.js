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
  // ── 修:三路全空正文不再错标成 upstream(2026-09-21 线上实案)──────────
  //
  // 后台 /admin-api-errors 上曾出现两条「deepseek / upstream / 502 / 详情空」。
  // 详情为空恰恰说明没有任何一路 reject:三路都回了 HTTP 200,只是正文是空的,
  // 却掉进了 upstream 兜底分支(reason=null → describeUpstreamError 返回空串)。
  // 单发路径早有 empty_content 这个分类,fan-out 一直漏着。
  describe("fan-out 全部 200 但无正文 → empty_content(不是 upstream)", () => {
    function sse(chunks) {
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
          controller.close();
        },
      });
      return { ok: true, status: 200, headers: new Headers({ "content-type": "text/event-stream" }), body };
    }
    const fanout = () => new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ system: "s", message: "m", maxTokens: 8000, samples: 3, userCode: "ABC123" }),
    });
    const failRow = () => mockInsertCalls.find((c) => c.table === "api_error_feedback" && c.row.stage === "deepseek");

    beforeEach(() => {
      mockSupabaseConfigured = true;
      mockUsersRow = { tier: "pro", tier_expires_at: "2999-01-01T00:00:00.000Z" };
      mockInsertCalls.length = 0;
    });
    afterEach(() => {
      mockSupabaseConfigured = false;
      mockUsersRow = null;
    });

    test("推理吃光预算(只有 reasoning_content)→ empty_content + 详情带 finish/reasoning", async () => {
      global.fetch = jest.fn().mockImplementation(async () => sse([
        'data: {"choices":[{"delta":{"reasoning_content":"想了很久很久"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
        "data: [DONE]\n\n",
      ]));

      const res = await POST(fanout());

      expect(res.status).toBe(502);
      const row = failRow().row;
      expect(row.error_type).toBe("empty_content");
      // 详情不能再是 NULL——那正是线上查不出根因的原因。
      expect(row.error_detail).toContain("samples=3");
      expect(row.error_detail).toContain("max_tokens=8000");
      expect(row.error_detail).toContain("finish=length");
      expect(row.error_detail).toContain("reasoning=");
      expect(row.error_detail).toContain("#3");
      // 失败不扣用量。
      expect(mockInsertCalls.some((c) => c.table === "daily_usage")).toBe(false);
    });

    test("上游回 200 就把流掐了 → 详情标出 stream-cut,与预算问题区分得开", async () => {
      global.fetch = jest.fn().mockImplementation(async () => sse([]));

      const res = await POST(fanout());

      expect(res.status).toBe(502);
      const row = failRow().row;
      expect(row.error_type).toBe("empty_content");
      expect(row.error_detail).toContain("chunks=0");
      expect(row.error_detail).toContain("stream-cut");
      expect(row.error_detail).not.toContain("finish=length");
    });

    test("有一路真的报错时仍记成 upstream,保留上游原文(不被新分支吃掉)", async () => {
      let n = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        n += 1;
        // 429 不在重试白名单里,这一路会直接 reject;另外两路回 200 空正文。
        if (n === 1) return { ok: false, status: 429, text: async () => "rate limited" };
        return sse([]);
      });

      const res = await POST(fanout());

      expect(res.status).toBe(429);
      const row = failRow().row;
      expect(row.error_type).toBe("upstream");
      expect(row.error_detail).toBe("upstream 429: rate limited");
    });

    test("单发路径的空正文详情也带上诊断行", async () => {
      global.fetch = jest.fn().mockResolvedValue(sse([
        'data: {"choices":[{"delta":{"reasoning_content":"..."},"finish_reason":"length"}]}\n\n',
        "data: [DONE]\n\n",
      ]));
      const req = new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify({ system: "s", message: "m", maxTokens: 2000, userCode: "ABC123" }),
      });

      const res = await POST(req);

      expect(res.status).toBe(502);
      const row = failRow().row;
      expect(row.error_type).toBe("empty_content");
      expect(row.error_detail).toContain("samples=1");
      expect(row.error_detail).toContain("finish=length");
    });
    // ── 三路全空时的降级单发自救(2026-09-21)──────────────────────
    test("自救成功 → 200 返回自救那份报告，并留一条 empty_content_rescued 痕迹", async () => {
      let n = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        n += 1;
        // 前 3 路(fan-out)全空,第 4 次是降级单发的自救。
        if (n <= 3) return sse([]);
        return sse([
          'data: {"choices":[{"delta":{"content":"===SCORE=== 4"}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      });

      const res = await POST(fanout());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.content).toBe("===SCORE=== 4");
      // callAIMulti 会从 contents 里取,单元素数组 = 取中位取到这一份。
      expect(body.contents).toEqual(["===SCORE=== 4"]);
      expect(global.fetch).toHaveBeenCalledTimes(4); // 3 路 fan-out + 1 路自救

      // 关键:用户侧成功了,但这次「三路全空」必须仍然看得见,否则自救一上线故障就隐身了。
      const trace = mockInsertCalls.find((c) => c.table === "api_error_feedback");
      expect(trace.row.stage).toBe("deepseek_rescue");
      expect(trace.row.error_type).toBe("empty_content_rescued");
      expect(trace.row.http_status).toBe(200);
      expect(trace.row.error_detail).toContain("#3");
    });

    test("自救也是空正文 → 仍回 502，详情带上自救那一路的诊断", async () => {
      global.fetch = jest.fn().mockImplementation(async () => sse([]));

      const res = await POST(fanout());

      expect(res.status).toBe(502);
      expect(global.fetch).toHaveBeenCalledTimes(4);
      const row = failRow().row;
      expect(row.error_type).toBe("empty_content");
      expect(row.error_detail).toContain("rescue: ");
      expect(row.error_detail).toContain("stream-cut");
    });

    test("自救撞上上游报错 → 502，详情带上自救的上游原文", async () => {
      let n = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        n += 1;
        if (n <= 3) return sse([]);
        // 402 不在重试白名单里,自救只发一次就抛。
        return { ok: false, status: 402, text: async () => "Insufficient Balance" };
      });

      const res = await POST(fanout());

      expect(res.status).toBe(502);
      expect(global.fetch).toHaveBeenCalledTimes(4);
      const row = failRow().row;
      expect(row.error_type).toBe("empty_content");
      expect(row.error_detail).toContain("rescue: upstream 402: Insufficient Balance");
    });

    test("剩余预算不够时不开始自救，详情写明 skipped", async () => {
      const realNow = Date.now;
      let offset = 0;
      jest.spyOn(Date, "now").mockImplementation(() => realNow.call(Date) + offset);
      try {
        let n = 0;
        global.fetch = jest.fn().mockImplementation(async () => {
          n += 1;
          // 三路都发出去之后把时钟推到预算耗尽,模拟 fan-out 本身跑了两分半。
          if (n === 3) offset = 160000;
          return sse([]);
        });

        const res = await POST(fanout());

        expect(res.status).toBe(502);
        // 没有第 4 次调用 —— 不能为了自救把自己拖过 Vercel 的 180s 上限。
        expect(global.fetch).toHaveBeenCalledTimes(3);
        expect(failRow().row.error_detail).toContain("rescue: skipped");
      } finally {
        Date.now.mockRestore();
      }
    });
  });
});
