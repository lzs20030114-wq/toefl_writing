/**
 * 结构化阶段的失败分级（scripts/realbank/failure_policy.js）。
 *
 * 这条判据两边都很贵：
 *   · 判松了 —— 欠费/鉴权坏了照常跑完，空结果把上一次花钱换来的产物静默冲掉（2026-09-05 毁过四套卷）；
 *   · 判紧了 —— 一块慢就整卷作废、run_pipeline 整批停，而慢的块恰恰是推理长、最容易丢的那些，
 *     等于「越该救的题越把整卷拖垮」。这是 2026-09-14 把单块超时从硬失败降成软失败的原因。
 * 两侧都锁死。
 */
const {
  SOFT_FAILURE_LIMIT, classifySystemicFailure, escalate,
} = require("../scripts/realbank/failure_policy.js");

const err = (message, code) => Object.assign(new Error(message), code ? { code } : {});

describe("classifySystemicFailure：硬失败", () => {
  test("欠费 / 鉴权 / 权限 / 限流的 HTTP 码一律硬失败", () => {
    for (const status of [401, 402, 403, 407, 429]) {
      const sys = classifySystemicFailure(err(`DeepSeek ${status}: {"error":{"message":"nope"}}`));
      expect(sys).toBeTruthy();
      expect(sys.soft).toBeUndefined();
      expect(sys.httpStatus).toBe(status);
    }
  });

  test("欠费文案不带状态码也认得出（真事故里就是这句）", () => {
    const sys = classifySystemicFailure(err('{"error":{"message":"Insufficient Balance"}}'));
    expect(sys.soft).toBeUndefined();
    expect(sys.apiMessage).toBe("Insufficient Balance");
  });

  test("缺 key / 代理配置错 / 连不上，都是硬失败", () => {
    for (const m of [
      "Missing DEEPSEEK_API_KEY",
      "SOCKS proxy is not supported",
      "connect ECONNREFUSED 127.0.0.1:10808",
      "socket hang up",
    ]) expect(classifySystemicFailure(err(m)).soft).toBeUndefined();
    expect(classifySystemicFailure(err("read failed", "ENOTFOUND")).soft).toBeUndefined();
  });

  test("单块 5xx 不算系统性（deepseekHttp 已重试过，零星 5xx 更像抖动）", () => {
    expect(classifySystemicFailure(err('DeepSeek 503: {"error":{"message":"overloaded"}}'))).toBeNull();
    expect(classifySystemicFailure(err("模型输出无法解析为 JSON"))).toBeNull();
    expect(classifySystemicFailure(null)).toBeNull();
  });
});

describe("classifySystemicFailure：单块超时是软失败", () => {
  test("请求超时标 soft，不再直接整卷作废", () => {
    const sys = classifySystemicFailure(err("curl timeout after 240000ms"));
    expect(sys.soft).toBe(true);
    expect(sys.reason).toBe("请求超时");
  });

  test("连接级超时（ETIMEDOUT）仍是硬失败 —— 那是连不上，不是这块算得久", () => {
    expect(classifySystemicFailure(err("connect ETIMEDOUT 1.2.3.4:443")).soft).toBeUndefined();
    expect(classifySystemicFailure(err("request failed", "ETIMEDOUT")).soft).toBeUndefined();
  });
});

describe("escalate", () => {
  test("硬失败立刻中止，不看计数", () => {
    const sys = classifySystemicFailure(err("DeepSeek 402: x"));
    expect(escalate(sys, 0)).toMatchObject({ abort: true, info: sys });
  });

  test("软失败攒够 SOFT_FAILURE_LIMIT 次才中止；中止时说明攒了几次", () => {
    const sys = classifySystemicFailure(err("timeout"));
    let soft = 0;
    for (let i = 1; i < SOFT_FAILURE_LIMIT; i += 1) {
      const step = escalate(sys, soft);
      soft = step.softFailures;
      expect({ i, abort: step.abort }).toEqual({ i, abort: false });   // 前 N-1 次都不中止
      expect(soft).toBe(i);
    }
    const last = escalate(sys, soft);
    expect(last.abort).toBe(true);
    expect(last.info.reason).toContain(`累计 ${SOFT_FAILURE_LIMIT} 次`);
  });

  test("一块慢不会拖垮整卷（这正是改判的目的）", () => {
    const sys = classifySystemicFailure(err("curl timeout after 240000ms"));
    expect(escalate(sys, 0).abort).toBe(false);
  });

  test("普通失败（null）既不中止也不计数", () => {
    expect(escalate(null, 3)).toEqual({ abort: false, softFailures: 3, info: null });
  });
});
