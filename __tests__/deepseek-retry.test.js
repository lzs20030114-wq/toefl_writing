const {
  isRetryableTransportError,
  callWithRetry,
} = require("../lib/ai/deepseekHttp");

function err(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

describe("isRetryableTransportError", () => {
  test("retries transient network codes", () => {
    expect(isRetryableTransportError(err("reset", { code: "ECONNRESET" }))).toBe(true);
    expect(isRetryableTransportError(err("refused", { code: "ECONNREFUSED" }))).toBe(true);
    expect(isRetryableTransportError(err("pipe", { code: "EPIPE" }))).toBe(true);
    expect(isRetryableTransportError(err("dns", { code: "EAI_AGAIN" }))).toBe(true);
    expect(isRetryableTransportError(err("socket hang up"))).toBe(true);
  });

  test("retries upstream 5xx (DeepSeek and proxy CONNECT)", () => {
    expect(isRetryableTransportError(err("DeepSeek 500: oops"))).toBe(true);
    expect(isRetryableTransportError(err("DeepSeek 503: busy"))).toBe(true);
    expect(isRetryableTransportError(err("proxy CONNECT failed: 502"))).toBe(true);
  });

  test("does NOT retry 4xx / 429 / non-5xx upstream", () => {
    expect(isRetryableTransportError(err("DeepSeek 400: bad"))).toBe(false);
    expect(isRetryableTransportError(err("DeepSeek 401: auth"))).toBe(false);
    expect(isRetryableTransportError(err("DeepSeek 429: rate"))).toBe(false);
    expect(isRetryableTransportError(err("proxy CONNECT failed: 407"))).toBe(false);
  });

  test("does NOT retry timeouts or permanent config errors", () => {
    expect(isRetryableTransportError(err("DeepSeek request timeout"))).toBe(false);
    expect(isRetryableTransportError(err("DeepSeek proxied request timeout"))).toBe(false);
    expect(isRetryableTransportError(err("SOCKS proxy is not supported"))).toBe(false);
    expect(isRetryableTransportError(err("Unsupported proxy schema: ftp://x"))).toBe(false);
    expect(isRetryableTransportError(null)).toBe(false);
    expect(isRetryableTransportError(undefined)).toBe(false);
  });
});

describe("callWithRetry", () => {
  test("returns immediately on first success (single attempt)", async () => {
    let calls = 0;
    const out = await callWithRetry({
      totalBudgetMs: 120000,
      runAttempt: async () => {
        calls += 1;
        return "ok";
      },
    });
    expect(out).toBe("ok");
    expect(calls).toBe(1);
  });

  test("retries once on a transient error then succeeds", async () => {
    let calls = 0;
    const out = await callWithRetry({
      totalBudgetMs: 120000,
      runAttempt: async () => {
        calls += 1;
        if (calls === 1) throw err("DeepSeek 503: busy");
        return "recovered";
      },
    });
    expect(out).toBe("recovered");
    expect(calls).toBe(2);
  });

  test("does not retry a non-retryable error", async () => {
    let calls = 0;
    await expect(
      callWithRetry({
        totalBudgetMs: 120000,
        runAttempt: async () => {
          calls += 1;
          throw err("DeepSeek 400: bad request");
        },
      }),
    ).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });

  test("retries at most once (2 attempts total) then throws the last error", async () => {
    let calls = 0;
    await expect(
      callWithRetry({
        totalBudgetMs: 120000,
        runAttempt: async () => {
          calls += 1;
          throw err(`DeepSeek 500: attempt ${calls}`);
        },
      }),
    ).rejects.toThrow(/attempt 2/);
    expect(calls).toBe(2);
  });

  test("does not retry when remaining budget is too small (fast-fail guard)", async () => {
    let calls = 0;
    await expect(
      callWithRetry({
        totalBudgetMs: 5000, // below RETRY_MIN_REMAINING_MS (8000)
        runAttempt: async () => {
          calls += 1;
          throw err("DeepSeek 503: busy");
        },
      }),
    ).rejects.toThrow(/503/);
    expect(calls).toBe(1);
  });

  test("passes the remaining budget to each attempt (never grows)", async () => {
    const budgets = [];
    let calls = 0;
    await callWithRetry({
      totalBudgetMs: 120000,
      runAttempt: async (remaining) => {
        budgets.push(remaining);
        calls += 1;
        if (calls === 1) throw err("DeepSeek 502: gateway");
        return "done";
      },
    });
    expect(calls).toBe(2);
    expect(budgets[0]).toBeLessThanOrEqual(120000);
    // Second attempt's budget is the leftover, strictly less than the first.
    expect(budgets[1]).toBeLessThan(budgets[0]);
  });
});
