/**
 * @jest-environment node
 */
/**
 * 端到端串起 /api/ai 的流式分支与 lib/ai/client 的流式读取 —— 经过一条**真实的
 * HTTP 连接**，不是两边各自对着 mock 自说自话。
 *
 * 为什么非要这一条：2026-09-14「AI 深入解析」超时的根因是「服务端把整条上游流拼完
 * 才回」，而那种缺陷恰好是两边分开 mock 时各自都「测过了」的 —— 客户端 mock 一个
 * 流、服务端 mock 一个上游，谁都不会发现中间那段其实是攒完再发的。这里量的是
 * **第一个字到达的时刻**：只要它明显早于最后一个字，就证明确实在边收边发。
 *
 * 唯一保留的替身是 DeepSeek 本身（没有 key 也不该在测试里花钱），
 * 它被替成一个按节奏吐 SSE 的假上游。
 */
const http = require("http");

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => "ABC123"),
  getSavedTier: jest.fn(() => "pro"),
}));

const { POST } = require("../app/api/ai/route");
const { callAIStream } = require("../lib/ai/client");

const UPSTREAM_GAP_MS = 60;

/** 假 DeepSeek：先推理（只有 reasoning_content）再逐段出正文，每段停一会儿。 */
function fakeUpstream(deltas, { reasoningRounds = 2 } = {}) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream" },
    body: (async function* () {
      for (let i = 0; i < reasoningRounds; i++) {
        await new Promise((r) => setTimeout(r, UPSTREAM_GAP_MS));
        yield Buffer.from(`data: {"choices":[{"delta":{"reasoning_content":"想${i}"}}]}\n\n`, "utf8");
      }
      for (const d of deltas) {
        await new Promise((r) => setTimeout(r, UPSTREAM_GAP_MS));
        yield Buffer.from(`data: {"choices":[{"delta":{"content":${JSON.stringify(d)}}}]}\n\n`, "utf8");
      }
      yield Buffer.from("data: [DONE]\n\n", "utf8");
    })(),
  });
}

describe("AI 讲解流式：客户端 ↔ /api/ai 走真实 HTTP", () => {
  let server;
  let baseUrl;
  let realFetch;

  const savedEnv = {};
  beforeAll(async () => {
    // 本机/CI 上可能有全局代理环境变量，那会让路由走 curl 代理路径（非流式）。
    // 线上 Vercel 走的是直连路径，这里要测的也是它。
    ["DEEPSEEK_PROXY_URL", "HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"].forEach((k) => {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    });
    realFetch = global.fetch;
    server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      // 照 Next 的做法:连接断开就 abort request.signal 并取消响应流。
      // 少了这一步,测出来的「断开」只是测试替身的行为,不是真实宿主的行为。
      const disconnect = new AbortController();
      const webRes = await POST(
        new Request(`http://127.0.0.1/api/ai`, {
          method: "POST",
          body: Buffer.concat(chunks),
          signal: disconnect.signal,
        }),
      );
      res.writeHead(webRes.status, Object.fromEntries(webRes.headers));
      if (!webRes.body) {
        res.end(await webRes.text());
        return;
      }
      const reader = webRes.body.getReader();
      res.on("close", () => {
        if (!res.writableEnded) {
          disconnect.abort();
          reader.cancel().catch(() => {});
        }
      });
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    Object.entries(savedEnv).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
    global.fetch = realFetch;
    await new Promise((r) => server.close(r));
  });

  beforeEach(() => {
    // 客户端打的是相对路径 "/api/ai"（真浏览器里就该这样），Node 的 fetch 需要绝对
    // 地址——这里只补上 origin，其余照走真 fetch。
    const upstream = fakeUpstream(["被动语态", "要求过去分词。"]);
    global.fetch = jest.fn((url, opts) =>
      String(url).startsWith("/") ? realFetch(baseUrl + url, opts) : upstream(url, opts),
    );
  });

  test("正文边收边到：第一个字明显早于最后一个字", async () => {
    const t0 = Date.now();
    const marks = [];
    const text = await callAIStream("s", "m", 2000, {
      onDelta: (partial) => marks.push({ at: Date.now() - t0, partial }),
    });

    expect(text).toBe("被动语态要求过去分词。");
    expect(marks.map((m) => m.partial)).toEqual(["被动语态", "被动语态要求过去分词。"]);
    // 攒完再发的话两段会几乎同时到达；真流式下它们之间隔着上游那一段间隔。
    expect(marks[1].at - marks[0].at).toBeGreaterThanOrEqual(UPSTREAM_GAP_MS * 0.5);
  });

  test("推理阶段的心跳能压住比它更短的静默超时（旧版就是死在这一段）", async () => {
    // 假上游先静默推理 2 轮 × 60ms 才出第一个正文字节。静默上限设成 100ms：
    // 没有心跳的话这里必然超时，有心跳则应当正常拿到讲解。
    await expect(
      callAIStream("s", "m", 2000, { idleTimeoutMs: 100, totalTimeoutMs: 10000 }),
    ).resolves.toBe("被动语态要求过去分词。");
  });

  test("客户端超时会真的断开连接，服务端随之掐掉上游（不再为没人看的回答烧 token）", async () => {
    let upstreamAborted = false;
    global.fetch = jest.fn((url, opts) => {
      if (String(url).startsWith("/")) return realFetch(baseUrl + url, opts);
      opts.signal?.addEventListener?.("abort", () => {
        upstreamAborted = true;
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => "text/event-stream" },
        // 永远不出字节的上游：只有超时兜底 + abort 传导才会收场。
        body: (async function* () {
          // unref:这个假上游被放弃后不该把 jest 的事件循环吊着不放。
          await new Promise((r) => {
            const t = setTimeout(r, 30000);
            if (t.unref) t.unref();
          });
        })(),
      });
    });

    const err = await callAIStream("s", "m", 2000, { idleTimeoutMs: 150, totalTimeoutMs: 5000 }).catch((e) => e);
    expect(String(err.message)).toMatch(/api timeout/i);

    await new Promise((r) => setTimeout(r, 300)); // 等 cancel() 传导到上游
    expect(upstreamAborted).toBe(true);
  }, 15000);
});
