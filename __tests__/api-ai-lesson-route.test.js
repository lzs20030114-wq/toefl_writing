/**
 * @jest-environment node
 *
 * /api/ai/lesson —— 写作批改的「第二次调用」（讲评）。
 * 关键不变量：它**不计每日用量**（评分那次已经扣过），所以任何路径都不许写
 * daily_usage（既不 insert 也不 rpc）。防滥用靠同源校验 + 独立限流 + 有效用户 +
 * 字段白名单，而不是靠扣次数。
 */

let mockSupabaseConfigured = true;
let mockUsersRow = { tier: "free", tier_expires_at: null };
let mockUsersError = null;
const mockInsertCalls = [];
const mockRpcCalls = [];
const mockUpdateCalls = [];

jest.mock("../lib/supabaseAdmin", () => ({
  get isSupabaseAdminConfigured() { return mockSupabaseConfigured; },
  supabaseAdmin: {
    from(table) {
      const selectFilter = {
        eq() { return selectFilter; },
        async maybeSingle() {
          if (table === "users") return { data: mockUsersRow, error: mockUsersError };
          return { data: null, error: null };
        },
      };
      return {
        select() { return selectFilter; },
        async insert(row) { mockInsertCalls.push({ table, row }); return { error: null }; },
        update(vals) {
          const f = { eq() { return f; }, then(res, rej) { mockUpdateCalls.push({ table, vals }); return Promise.resolve({ error: null }).then(res, rej); } };
          return f;
        },
      };
    },
    async rpc(name, args) { mockRpcCalls.push({ name, args }); return { data: 1, error: null }; },
  },
}));

import { POST } from "../app/api/ai/lesson/route";

const LONG_ESSAY = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
const REPORT = {
  score: 3.5,
  band: "Intermediate+",
  rubric: { dimensions: { task_fulfillment: { score: 3, reason: "展开不足" } } },
  modelEssay: "Dear Professor, ...",
};

function lessonRequest(extra = {}, init = {}) {
  return new Request("http://localhost/api/ai/lesson", {
    method: "POST",
    ...init,
    body: JSON.stringify({
      userCode: "ABC123",
      type: "discussion",
      promptData: { professor: { name: "Dr. A", text: "q" }, students: [] },
      userText: LONG_ESSAY,
      report: REPORT,
      ...extra,
    }),
  });
}

function usageTouched() {
  return mockRpcCalls.length > 0 || mockInsertCalls.some((c) => c.table === "daily_usage");
}

describe("/api/ai/lesson", () => {
  const savedEnv = {};
  beforeEach(() => {
    ["DEEPSEEK_PROXY_URL", "HTTPS_PROXY", "HTTP_PROXY"].forEach((k) => {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    });
    mockSupabaseConfigured = true;
    mockUsersRow = { tier: "free", tier_expires_at: null };
    mockUsersError = null;
    mockInsertCalls.length = 0;
    mockRpcCalls.length = 0;
    mockUpdateCalls.length = 0;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Object.entries(savedEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  });

  test("跨域浏览器请求被拒", async () => {
    global.fetch = jest.fn();
    const req = lessonRequest({}, { headers: { origin: "https://evil.example", host: "localhost" } });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/forbidden origin/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test.each([
    ["缺失", undefined],
    ["非法值", "speaking"],
    ["空串", ""],
  ])("type %s → 400", async (_label, type) => {
    global.fetch = jest.fn();
    const res = await POST(lessonRequest({ type }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/type must be discussion or email/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("userText 少于 30 词 → 400，且不发上游", async () => {
    global.fetch = jest.fn();
    const res = await POST(lessonRequest({ userText: "too short to be an essay" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too short/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("userText 超长 / report 超大 / promptData 超大 → 400", async () => {
    global.fetch = jest.fn();
    const tooLongText = await POST(lessonRequest({ userText: "w ".repeat(5000) }));
    expect(tooLongText.status).toBe(400);
    expect((await tooLongText.json()).error).toMatch(/userText too long/);

    const bigReport = await POST(lessonRequest({ report: { blob: "x".repeat(21000) } }));
    expect(bigReport.status).toBe(400);
    expect((await bigReport.json()).error).toMatch(/report too large/);

    const bigPrompt = await POST(lessonRequest({ promptData: { blob: "x".repeat(7000) } }));
    expect(bigPrompt.status).toBe(400);
    expect((await bigPrompt.json()).error).toMatch(/promptData too large/);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("无用户码 → 403；查无此人 → 403；查库失败 → 503", async () => {
    global.fetch = jest.fn();

    const missing = await POST(lessonRequest({ userCode: "" }));
    expect(missing.status).toBe(403);

    mockUsersRow = null;
    const invalid = await POST(lessonRequest());
    expect(invalid.status).toBe(403);
    expect((await invalid.json()).error).toMatch(/invalid user/i);

    mockUsersRow = null;
    mockUsersError = { message: "gateway timeout" };
    const down = await POST(lessonRequest());
    expect(down.status).toBe(503);
    expect((await down.json()).code).toBe("USER_LOOKUP_FAILED");

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("上游成功：返回 { ok: true, content }，free 用户也放行，且不计用量", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "===VERDICT===\n现状: ok" } }] }),
    });

    const res = await POST(lessonRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.content).toBe("===VERDICT===\n现状: ok");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(usageTouched()).toBe(false);

    // 讲评 prompt 由服务端组装：客户端传的只有题目/原文/报告摘要
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.max_tokens).toBe(4096);
    expect(sent.temperature).toBe(0.3);
    expect(sent.messages[0].role).toBe("system");
    expect(sent.messages[0].content).toContain("只教一件事");
    expect(sent.messages[1].content).toContain("【考生原文】");
  });

  test("上游 5xx → 502，写 api_error_feedback(endpoint=/api/ai/lesson)，且不计用量", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "upstream boom" });

    const res = await POST(lessonRequest());

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unavailable|retry/i);
    expect(usageTouched()).toBe(false);
    expect(mockUpdateCalls).toHaveLength(0);

    const logged = mockInsertCalls.find((c) => c.table === "api_error_feedback");
    expect(logged).toBeTruthy();
    expect(logged.row.endpoint).toBe("/api/ai/lesson");
    expect(logged.row.stage).toBe("deepseek");
    expect(logged.row.error_type).toBe("upstream");
    expect(logged.row.http_status).toBe(502);
    expect(logged.row.error_detail).toContain("upstream 500");
  });

  test("上游 200 但正文为空 → 502 + empty_content 留痕，不计用量", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "   " } }] }),
    });

    const res = await POST(lessonRequest());

    expect(res.status).toBe(502);
    expect(usageTouched()).toBe(false);
    const logged = mockInsertCalls.find((c) => c.table === "api_error_feedback");
    expect(logged.row.error_type).toBe("empty_content");
    expect(logged.row.endpoint).toBe("/api/ai/lesson");
  });

  test("email 题型走邮件版讲评 prompt", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });

    const res = await POST(
      lessonRequest({
        type: "email",
        promptData: { scenario: "s", direction: "d", to: "Manager", goals: ["g1", "g2", "g3"] },
      })
    );

    expect(res.status).toBe(200);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.messages[0].content).toContain("communicative goal");
    expect(sent.messages[1].content).toContain("三个目标");
  });
});
