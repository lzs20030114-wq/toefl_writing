/**
 * 真题结构化阶段的模型调用预算 + 输出解析（scripts/realbank/model_output.js）。
 *
 * 2026-09-13 根因：第一来源 CTW 块 88/96 报「模型输出无法解析为 JSON」，实际是 deepseek-v4-flash
 * 的推理 token 把 max_tokens=16000 吃光、正文为空串（实测单块推理 13.4k token）。这里锁死：
 *   · CTW 预算放宽且超时跟着放宽（否则长推理撞超时 → 被当成系统性失败整卷中止）；
 *   · 选择题预算不变；
 *   · 宽松解析兼容旧实现能解析的一切，另外接住「JSON 后跟带括号的解释」，截断仍返回 null；
 *   · 正文为空与坏 JSON 分开报。
 */
const { CALL_BUDGET, callBudget, parseJsonLoose, unparsableProblem, ctwVisionCacheFile } = require("../scripts/realbank/model_output.js");

// structure_set.mjs 2026-09-13 之前的实现，原样搬来当回归基准。
function legacyParse(raw) {
  const s = String(raw || "").replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(s); } catch { /* 继续兜底 */ }
  const start = s.search(/[[{]/);
  if (start < 0) return null;
  const open = s[start];
  const close = open === "[" ? "]" : "}";
  const end = s.lastIndexOf(close);
  if (end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

describe("model_output.callBudget", () => {
  test("CTW 放宽到 32000 token；选择题与未知题型仍是旧预算 16000 / 90s", () => {
    expect(callBudget("ctw")).toEqual({ maxTokens: 32000, timeoutMs: 300000 });
    for (const t of ["ap", "rdl", "lcr", "listening_mcq", undefined, "whatever"]) {
      expect(callBudget(t)).toEqual({ maxTokens: 16000, timeoutMs: 90000 });
    }
  });

  test("超时必须够把预算跑满（按 150 token/s 的保守吞吐算），否则长推理会被当成系统性超时整卷中止", () => {
    for (const b of Object.values(CALL_BUDGET)) {
      expect(b.timeoutMs).toBeGreaterThanOrEqual((b.maxTokens / 150) * 1000 * 0.5);
    }
    expect(CALL_BUDGET.ctw.timeoutMs).toBeGreaterThanOrEqual((CALL_BUDGET.ctw.maxTokens / 150) * 1000);
  });

  test("预算表冻结，调用方改不动", () => {
    expect(Object.isFrozen(CALL_BUDGET)).toBe(true);
    expect(Object.isFrozen(CALL_BUDGET.ctw)).toBe(true);
  });
});

describe("model_output.parseJsonLoose", () => {
  const ctw = { passage: "Glaciers move.", blanks: [{ word: "move", given: "mo" }], topic: "geology" };

  test("纯 JSON / 围栏 / 前导空白 + 围栏", () => {
    expect(parseJsonLoose(JSON.stringify(ctw))).toEqual(ctw);
    expect(parseJsonLoose("```json\n" + JSON.stringify(ctw) + "\n```")).toEqual(ctw);
    expect(parseJsonLoose("\n  ```json\n" + JSON.stringify(ctw) + "\n```\n")).toEqual(ctw);
  });

  test("前面有说明文字", () => {
    expect(parseJsonLoose("好的，结果如下：\n" + JSON.stringify(ctw))).toEqual(ctw);
  });

  test("JSON 后面跟着带括号的解释（旧实现切到最后一个 } 会失败）", () => {
    const raw = JSON.stringify(ctw) + "\n注：第 8 空疑似答案页笔误 {cover → carve}";
    expect(legacyParse(raw)).toBeNull();
    expect(parseJsonLoose(raw)).toEqual(ctw);
  });

  test("前面的说明里带括号：跳过不合法的那一段，取后面的 JSON", () => {
    expect(parseJsonLoose("说明 {见下} 输出：" + JSON.stringify(ctw))).toEqual(ctw);
  });

  test("字符串里的括号不影响配对", () => {
    const obj = { passage: "a } b { c ] d [", blanks: [] };
    expect(parseJsonLoose(JSON.stringify(obj) + " 尾巴 }")).toEqual(obj);
    const esc = { passage: "he said \"{hi}\"", blanks: [] };
    expect(parseJsonLoose("x " + JSON.stringify(esc) + " y }")).toEqual(esc);
  });

  test("修复轮的数组输出照常解析", () => {
    const arr = [{ q_number: 26, stem: "What?", options: ["a", "b", "c", "d"] }];
    expect(parseJsonLoose(JSON.stringify(arr))).toEqual(arr);
    expect(parseJsonLoose("```\n" + JSON.stringify(arr) + "\n```")).toEqual(arr);
  });

  test("截断的 JSON 返回 null，且不拿里面完整的子对象凑数", () => {
    const full = JSON.stringify(ctw);
    const truncated = full.slice(0, full.indexOf("]"));   // 空位对象完整、外层没收尾
    expect(truncated).toContain('{"word":"move","given":"mo"}');
    expect(parseJsonLoose(truncated)).toBeNull();
  });

  test("空串 / 纯空白 / 没有 JSON → null", () => {
    expect(parseJsonLoose("")).toBeNull();
    expect(parseJsonLoose("   \n ")).toBeNull();
    expect(parseJsonLoose(null)).toBeNull();
    expect(parseJsonLoose("模型拒绝回答")).toBeNull();
  });

  test("兼容旧实现：旧实现能解析出来的，新实现结果完全一致", () => {
    const corpus = [
      JSON.stringify(ctw),
      "```json\n" + JSON.stringify(ctw) + "\n```",
      "前言 " + JSON.stringify(ctw) + " 结尾",
      "[1, 2, 3]",
      "noise [ {\"a\": 1} ] noise",
      "{\"a\": {\"b\": [1, {\"c\": \"}\"}]}}",
      "```\n{\"x\": \"```\"}\n```",
      "  {\"k\": 1}  ",
      "{\"k\": 1} and {\"k\": 2}",
      "[{\"q_number\": 1}]\n",
    ];
    for (const raw of corpus) {
      const old = legacyParse(raw);
      if (old !== null) expect(parseJsonLoose(raw)).toEqual(old);
    }
  });
});

describe("model_output.ctwVisionCacheFile（与 ctw_vision_transcribe.py 写缓存同一口径）", () => {
  test("中文卷名与 _v2 后缀原样保留，区段写成 起-止", () => {
    expect(ctwVisionCacheFile("3.30新托福真题", 1, 11, 20)).toBe("ctwvis__3.30新托福真题_M1_11-20__img1.txt");
    expect(ctwVisionCacheFile("5.10新托福真题_v2", "2", "1", "10")).toBe("ctwvis__5.10新托福真题_v2_M2_1-10__img1.txt");
  });
  test("空格等 \\w 之外的字符压成下划线（Python re.sub(r\"[^\\w.-]+\", \"_\") 的等价）", () => {
    expect(ctwVisionCacheFile("4.1 新托福 真题", 1, 1, 10)).toBe("ctwvis__4.1_新托福_真题_M1_1-10__img1.txt");
  });
});

describe("model_output.unparsableProblem", () => {
  test("正文为空单独报预算问题，文案仍含「无法解析为 JSON」（旧 grep 口径不断）", () => {
    for (const raw of ["", "  \n", null, undefined]) {
      const p = unparsableProblem(raw);
      expect(p).toMatch(/正文为空/);
      expect(p).toMatch(/max_tokens/);
      expect(p).toMatch(/无法解析为 JSON/);
    }
  });

  test("有正文但解析不了 → 旧文案原样", () => {
    expect(unparsableProblem("{\"passage\": \"trunc")).toBe("模型输出无法解析为 JSON");
  });
});
