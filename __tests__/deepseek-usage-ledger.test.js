/** @jest-environment node */

// DeepSeek 调用台账 (lib/ai/usageLedger.js) + deepseekHttp 埋点。
// 背景: 9/1 一次本地批量脚本跑了 518 次 DeepSeek (¥11.97)，事后只能靠账单倒推。
// 台账必须满足: 每次调用留一行、写失败绝不影响主链路、Vercel/edge 上完全 no-op。

jest.mock("https", () => ({ request: jest.fn() }));

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const ledger = require("../lib/ai/usageLedger");
const { callDeepSeekViaCurl } = require("../lib/ai/deepseekHttp");

const ENV_KEYS = [
  "DEEPSEEK_USAGE_LOG",
  "DEEPSEEK_USAGE_QUIET",
  "DEEPSEEK_CNY_PER_MTOK",
  "VERCEL",
  "NEXT_RUNTIME",
];

let savedEnv = {};
const tempPaths = new Set();

function tmpLedgerPath(suffix = "jsonl") {
  const name = `deepseek-usage-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.${suffix}`;
  const p = path.join(os.tmpdir(), name);
  tempPaths.add(p);
  return p;
}

function cleanup(target) {
  try {
    if (fs.existsSync(target)) {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
      else fs.unlinkSync(target);
    }
  } catch (_) {
    /* 清理失败不影响断言 */
  }
}

beforeEach(() => {
  savedEnv = {};
  ENV_KEYS.forEach((k) => {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  });
  // 进度行只在真跑脚本时有意义，测试里静音，避免污染 jest 输出
  process.env.DEEPSEEK_USAGE_QUIET = "1";
  https.request.mockReset();
});

afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  });
  tempPaths.forEach(cleanup);
  tempPaths.clear();
});

// ── (a) 正常写入 ──────────────────────────────────────────────────────────────

describe("recordUsage 写台账", () => {
  test("写入 DEEPSEEK_USAGE_LOG 指向的文件，字段齐全", () => {
    const file = tmpLedgerPath();
    process.env.DEEPSEEK_USAGE_LOG = file;

    const wrote = ledger.recordUsage({
      script: "run-bank-update.mjs",
      label: "bs-r1",
      model: "deepseek-v4-flash",
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 300,
        total_tokens: 1500,
        prompt_cache_hit_tokens: 640,
      },
      ms: 4321,
      ok: true,
    });

    expect(wrote).toBe(true);
    expect(fs.existsSync(file)).toBe(true);

    const raw = fs.readFileSync(file, "utf8");
    expect(raw.endsWith("\n")).toBe(true);

    const rows = ledger.readLedger(file);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(typeof row.ts).toBe("string");
    expect(new Date(row.ts).toISOString()).toBe(row.ts); // ISO UTC
    expect(row.script).toBe("run-bank-update.mjs");
    expect(row.label).toBe("bs-r1");
    expect(row.model).toBe("deepseek-v4-flash");
    expect(row.prompt_tokens).toBe(1200);
    expect(row.completion_tokens).toBe(300);
    expect(row.total_tokens).toBe(1500);
    expect(row.cached_tokens).toBe(640);
    expect(row.ms).toBe(4321);
    expect(row.ok).toBe(true);
    expect(row.pid).toBe(process.pid);
  });

  test("多次调用追加多行", () => {
    const file = tmpLedgerPath();
    process.env.DEEPSEEK_USAGE_LOG = file;
    ledger.recordUsage({ script: "a.js", model: "m", usage: { total_tokens: 1 } });
    ledger.recordUsage({ script: "b.js", model: "m", usage: { total_tokens: 2 } });
    ledger.recordUsage({ script: "c.js", model: "m", usage: { total_tokens: 3 } });
    const rows = ledger.readLedger(file);
    expect(rows.map((r) => r.script)).toEqual(["a.js", "b.js", "c.js"]);
  });

  test("usage 缺失/字段不全时全部容错为 0", () => {
    const file = tmpLedgerPath();
    process.env.DEEPSEEK_USAGE_LOG = file;

    ledger.recordUsage({ script: "no-usage.js", model: "deepseek-chat" });
    ledger.recordUsage({ script: "partial.js", model: "deepseek-chat", usage: { prompt_tokens: 7 } });
    ledger.recordUsage({
      script: "details.js",
      model: "deepseek-chat",
      usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 8 } },
    });

    const rows = ledger.readLedger(file);
    expect(rows).toHaveLength(3);

    expect(rows[0]).toMatchObject({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cached_tokens: 0,
      ms: 0,
      ok: true,
    });
    expect(rows[0].label).toBeUndefined();
    expect(rows[0].error).toBeUndefined();

    // total_tokens 缺失时回退成 prompt + completion
    expect(rows[1]).toMatchObject({ prompt_tokens: 7, completion_tokens: 0, total_tokens: 7, cached_tokens: 0 });
    // cached_tokens 走 prompt_tokens_details 兜底
    expect(rows[2]).toMatchObject({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cached_tokens: 8 });
  });

  test("失败记录写 ok:false 并把 error 截到 200 字", () => {
    const file = tmpLedgerPath();
    process.env.DEEPSEEK_USAGE_LOG = file;
    ledger.recordUsage({ script: "boom.js", model: "m", ok: false, error: "x".repeat(500) });
    const [row] = ledger.readLedger(file);
    expect(row.ok).toBe(false);
    expect(row.error).toHaveLength(200);
  });

  test("readLedger 跳过坏行", () => {
    const file = tmpLedgerPath();
    fs.writeFileSync(file, '{"ts":"2026-09-01T00:00:00.000Z","script":"a.js"}\nnot-json\n\n{"script":"b.js"}\n', "utf8");
    const rows = ledger.readLedger(file);
    expect(rows.map((r) => r.script)).toEqual(["a.js", "b.js"]);
  });
});

// ── (b) 禁用开关 ──────────────────────────────────────────────────────────────

describe("台账开关", () => {
  test("DEEPSEEK_USAGE_LOG=0 时不写文件并返回 false", () => {
    const defaultPath = ledger.resolveLedgerPath(); // 此时 env 未设置，拿到仓库默认路径
    const before = fs.existsSync(defaultPath) ? fs.statSync(defaultPath).size : -1;

    process.env.DEEPSEEK_USAGE_LOG = "0";
    expect(ledger.isLedgerEnabled()).toBe(false);
    expect(ledger.recordUsage({ script: "x.js", model: "m", usage: { total_tokens: 1 } })).toBe(false);

    const after = fs.existsSync(defaultPath) ? fs.statSync(defaultPath).size : -1;
    expect(after).toBe(before);
  });

  test("VERCEL=1 时不写文件并返回 false（serverless 文件系统不可持久写）", () => {
    const file = tmpLedgerPath();
    process.env.DEEPSEEK_USAGE_LOG = file;
    process.env.VERCEL = "1";

    expect(ledger.isLedgerEnabled()).toBe(false);
    expect(ledger.recordUsage({ script: "x.js", model: "m", usage: { total_tokens: 1 } })).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  test("NEXT_RUNTIME=edge 时同样 no-op", () => {
    const file = tmpLedgerPath();
    process.env.DEEPSEEK_USAGE_LOG = file;
    process.env.NEXT_RUNTIME = "edge";

    expect(ledger.isLedgerEnabled()).toBe(false);
    expect(ledger.recordUsage({ script: "x.js", model: "m" })).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  test("resolveLedgerPath 默认落到仓库 .ops/deepseek-usage.jsonl", () => {
    const p = ledger.resolveLedgerPath();
    expect(p.endsWith(path.join(".ops", "deepseek-usage.jsonl"))).toBe(true);
  });

  test("cnyPerMtok 默认 5.24，可被 DEEPSEEK_CNY_PER_MTOK 覆盖", () => {
    expect(ledger.cnyPerMtok()).toBe(5.24);
    process.env.DEEPSEEK_CNY_PER_MTOK = "8";
    expect(ledger.cnyPerMtok()).toBe(8);
  });
});

// ── (c) 写失败不抛错 ──────────────────────────────────────────────────────────

describe("recordUsage 永不抛错", () => {
  test("不可写路径（父级是文件）返回 false 且不抛错", () => {
    const blocker = tmpLedgerPath("txt");
    fs.writeFileSync(blocker, "i am a file, not a directory", "utf8");
    process.env.DEEPSEEK_USAGE_LOG = path.join(blocker, "nested", "ledger.jsonl");

    let result;
    expect(() => {
      result = ledger.recordUsage({ script: "x.js", model: "m", usage: { total_tokens: 5 } });
    }).not.toThrow();
    expect(result).toBe(false);
  });

  test("entry 为 undefined 也不抛错", () => {
    const file = tmpLedgerPath();
    process.env.DEEPSEEK_USAGE_LOG = file;
    expect(() => ledger.recordUsage(undefined)).not.toThrow();
    const [row] = ledger.readLedger(file);
    expect(row.total_tokens).toBe(0);
    expect(row.ok).toBe(true);
  });
});

// ── (d)(e) callDeepSeekViaCurl 埋点 ───────────────────────────────────────────

function mockHttpsResponse({ statusCode, body }) {
  https.request.mockImplementation((_url, _options, callback) => {
    const handlers = {};
    const res = {
      statusCode,
      on(event, fn) {
        handlers[event] = fn;
        return res;
      },
    };
    setImmediate(() => {
      callback(res);
      if (handlers.data) handlers.data(Buffer.from(body, "utf8"));
      if (handlers.end) handlers.end();
    });
    const req = {
      on() {
        return req;
      },
      write() {},
      end() {},
    };
    return req;
  });
}

describe("callDeepSeekViaCurl 埋点", () => {
  test("成功路径照常返回 content，并记一行台账", async () => {
    const file = tmpLedgerPath();
    process.env.DEEPSEEK_USAGE_LOG = file;
    mockHttpsResponse({
      statusCode: 200,
      body: JSON.stringify({
        choices: [{ message: { content: "hi" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const out = await callDeepSeekViaCurl({
      apiKey: "sk-test",
      payload: { model: "deepseek-v4-flash", messages: [] },
      proxyUrl: "", // 强制直连分支，绕开环境里的 HTTPS_PROXY
      timeoutMs: 5000,
      meta: { script: "unit-test.js", label: "smoke" },
    });

    expect(out).toBe("hi");

    const rows = ledger.readLedger(file);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      script: "unit-test.js",
      label: "smoke",
      model: "deepseek-v4-flash",
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      cached_tokens: 0,
      ok: true,
    });
    expect(typeof rows[0].ms).toBe("number");
  });

  test("不传 meta 时向后兼容（script 走 argv 兜底）", async () => {
    const file = tmpLedgerPath();
    process.env.DEEPSEEK_USAGE_LOG = file;
    mockHttpsResponse({
      statusCode: 200,
      body: JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { total_tokens: 3 } }),
    });

    const out = await callDeepSeekViaCurl({
      apiKey: "sk-test",
      payload: { model: "deepseek-chat" },
      proxyUrl: "",
      timeoutMs: 5000,
    });

    expect(out).toBe("ok");
    const [row] = ledger.readLedger(file);
    expect(row.script).toBe(ledger.defaultScriptName());
    expect(row.total_tokens).toBe(3);
  });

  test("失败路径记 ok:false 并仍然抛错", async () => {
    const file = tmpLedgerPath();
    process.env.DEEPSEEK_USAGE_LOG = file;
    mockHttpsResponse({ statusCode: 500, body: '{"error":"server exploded"}' });

    await expect(
      callDeepSeekViaCurl({
        apiKey: "sk-test",
        payload: { model: "deepseek-v4-flash" },
        proxyUrl: "",
        // 低于 RETRY_MIN_REMAINING_MS，跳过重试，保持用例快
        timeoutMs: 5000,
        meta: { script: "unit-test.js" },
      }),
    ).rejects.toThrow(/DeepSeek 500/);

    const rows = ledger.readLedger(file);
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(false);
    expect(rows[0].script).toBe("unit-test.js");
    expect(rows[0].model).toBe("deepseek-v4-flash");
    expect(rows[0].total_tokens).toBe(0);
    expect(rows[0].error).toMatch(/DeepSeek 500/);
  });

  test("返回非 JSON 时记 ok:false 并抛原错误", async () => {
    const file = tmpLedgerPath();
    process.env.DEEPSEEK_USAGE_LOG = file;
    mockHttpsResponse({ statusCode: 200, body: "<html>gateway</html>" });

    await expect(
      callDeepSeekViaCurl({
        apiKey: "sk-test",
        payload: { model: "deepseek-chat" },
        proxyUrl: "",
        timeoutMs: 5000,
        meta: { script: "unit-test.js" },
      }),
    ).rejects.toThrow(/non-JSON/);

    const [row] = ledger.readLedger(file);
    expect(row.ok).toBe(false);
    expect(row.error).toMatch(/non-JSON/);
  });

  test("台账被禁用时调用照常成功（观测设施不影响主链路）", async () => {
    process.env.DEEPSEEK_USAGE_LOG = "0";
    mockHttpsResponse({
      statusCode: 200,
      body: JSON.stringify({ choices: [{ message: { content: "still fine" } }] }),
    });

    await expect(
      callDeepSeekViaCurl({
        apiKey: "sk-test",
        payload: { model: "deepseek-chat" },
        proxyUrl: "",
        timeoutMs: 5000,
      }),
    ).resolves.toBe("still fine");
  });
});
