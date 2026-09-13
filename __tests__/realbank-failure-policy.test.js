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
  SOFT_FAILURE_LIMIT, classifySystemicFailure, escalate, shouldResweep,
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

/**
 * --only-failed 的重扫判据。
 * 这里最贵的一条是「合流层扣下的块不重扫」：听力/口语被 merge_*_asr 扣下的段同样标成 flagged，
 * 不挡的话一轮听力扫描会把整批扣下的段重新过一遍模型 —— 而结构化只看 OCR 文本、不碰音频，
 * 对齐/性别/段数的病一分钱都治不了，结果照旧扣下。纯烧钱。
 */
describe("shouldResweep", () => {
  const unit = (over = {}) => ({ key: "reading|1|31-31|35", type: "ap", answers: [{ n: 31, answer: "b" }], ...over });

  test("失败的块要重扫（这才是 --only-failed 的本职）", () => {
    for (const status of ["flagged", "error", undefined]) {
      expect(shouldResweep(unit(), { status })).toEqual({ resweep: true, skip: null });
    }
    expect(shouldResweep(unit(), null)).toEqual({ resweep: true, skip: null });   // 既有产物里没有 = 新块
  });

  test("已经 ok / 材料屏 / 等音频的，不重扫", () => {
    for (const status of ["ok", "passage_screen", "deferred"]) {
      expect(shouldResweep(unit(), { status })).toEqual({ resweep: false, skip: "already_done" });
    }
  });

  test("合流层扣下的（带 merged_by）不重扫 —— 重跑结构化治不了对齐/性别/音频的病", () => {
    const held = { status: "flagged", merged_by: "merge_first_source_asr-v1",
      problems: ["no_turns:对话没有说话人标签"] };
    expect(shouldResweep(unit({ type: "lc" }), held)).toEqual({ resweep: false, skip: "merge_held" });
    expect(shouldResweep(unit({ type: "interview" }), { status: "flagged", merged_by: "merge_vendor_asr-v1" }))
      .toEqual({ resweep: false, skip: "merge_held" });
  });

  test("合流层已经跑成 ok 的更不用说（两条判据都拦得住）", () => {
    expect(shouldResweep(unit({ type: "lat" }), { status: "ok", merged_by: "merge_vendor_asr-v1" }).resweep)
      .toBe(false);
  });

  test("没经过合流的听力块照常重扫 —— 别把整科一起挡掉", () => {
    expect(shouldResweep(unit({ type: "lcr" }), { status: "flagged" }))
      .toEqual({ resweep: true, skip: null });
  });

  test("答案不足的填词块是路由误判，不为它烧钱", () => {
    expect(shouldResweep({ type: "ctw", answers: [{ n: 1 }, { n: 2 }] }, { status: "flagged" }))
      .toEqual({ resweep: false, skip: "ctw_misrouted" });
    const real = { type: "ctw", answers: Array.from({ length: 10 }, (_, i) => ({ n: i + 1 })) };
    expect(shouldResweep(real, { status: "flagged" })).toEqual({ resweep: true, skip: null });
  });
});
