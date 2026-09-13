/**
 * 真题结构化阶段的模型调用预算 + 输出解析（scripts/realbank/model_output.js）。
 *
 * 2026-09-13 根因：第一来源 CTW 块 88/96 报「模型输出无法解析为 JSON」，实际是 deepseek-v4-flash
 * 的推理 token 把 max_tokens=16000 吃光、正文为空串（实测单块推理 13.4k token）。这里锁死：
 *   · CTW 预算放宽且超时跟着放宽（否则长推理撞超时 → 被当成系统性失败整卷中止）；
 *   · 宽松解析兼容旧实现能解析的一切，另外接住「JSON 后跟带括号的解释」，截断仍返回 null；
 *   · 正文为空与坏 JSON 分开报。
 *
 * 2026-09-14 扩面：上面那条闸对**所有题型**生效，但当时只给 CTW 修过，选择题继续吃 16000/90s
 * （台账里顶到 16000 的 531 次调用多于 CTW 全部块的调用数；`--only-failed` 不改代码重跑能救回
 * 一半 flagged 块 —— 都是预算病的签名）。这里把口径改成：
 *   · 每个题型都有够用的预算，且**超时一律从预算推导**，不许手写（手写就会再配出一个撞墙组合）；
 *   · 输出失败分三种：正文为空 / 中途截断（预算病，可重试）/ 真坏格式（重试无用）。
 */
const {
  CALL_BUDGET, callBudget, budgetOf, retryBudget,
  parseJsonLoose, unparsableProblem, classifyBadOutput, isBudgetProblem,
  ctwVisionCacheFile,
} = require("../scripts/realbank/model_output.js");

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
  test("CTW 最宽；选择题与修复轮不再吃 16000（实证会顶满 → 正文空/截断 → flagged → 丢题）", () => {
    expect(callBudget("ctw").maxTokens).toBe(32000);
    for (const t of ["ap", "rdl", "lcr", "lc", "la", "lat", "listening_mcq", "mcq_repair"]) {
      expect(callBudget(t).maxTokens).toBeGreaterThan(16000);
    }
  });

  test("未知题型走 default，且 default 也够宽 —— 新题型不许默认继承那个会丢题的预算", () => {
    for (const t of [undefined, null, "", "whatever", "新题型"]) {
      expect(callBudget(t)).toEqual(CALL_BUDGET.default);
    }
    expect(CALL_BUDGET.default.maxTokens).toBeGreaterThan(16000);
  });

  test("超时一律从预算推导：跑满预算也撞不到墙（否则长推理被当成系统性超时整卷中止）", () => {
    // 实测 ~230 token/s。按保守 150 token/s 算，跑满预算的耗时仍须小于超时。
    for (const [name, b] of Object.entries(CALL_BUDGET)) {
      expect({ name, ok: b.timeoutMs > (b.maxTokens / 150) * 1000 }).toEqual({ name, ok: true });
    }
  });

  test("budgetOf 单调：预算越大超时越长，且任何预算都带握手余量", () => {
    expect(budgetOf(48000).timeoutMs).toBeGreaterThan(budgetOf(24000).timeoutMs);
    expect(budgetOf(1).timeoutMs).toBeGreaterThanOrEqual(30000);
  });

  test("retryBudget 翻倍但封在实测跑通过的 32000，且永不把预算调小", () => {
    const r = retryBudget(callBudget("ap"));
    expect(r.maxTokens).toBe(32000);                       // 24000 翻倍 → 封顶
    expect(r.timeoutMs).toBeGreaterThan(callBudget("ap").timeoutMs);
    expect(Object.isFrozen(r)).toBe(true);
    // 已经在上限的题型：同预算再打一次（正文为空本身带随机性），不是降级
    expect(retryBudget(callBudget("ctw")).maxTokens).toBe(32000);
    // 高于上限的预算不许被封顶封回去
    expect(retryBudget({ maxTokens: 60000 }).maxTokens).toBe(60000);
    expect(retryBudget(undefined).maxTokens).toBe(32000);
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

  test("吐到一半被截断 → 报成预算病，不再与坏格式混为一谈", () => {
    const p = unparsableProblem("{\"passage\": \"trunc");
    expect(p).toMatch(/截断/);
    expect(p).toMatch(/max_tokens/);
    expect(p).toMatch(/无法解析为 JSON/);          // 旧 grep 口径不断
    expect(isBudgetProblem(p)).toBe(true);
  });

  test("有完整结构但不是合法 JSON / 压根没有 JSON → 格式病，重试无用", () => {
    for (const raw of ["{not json}", "对不起，这一屏我看不清", "[1, 2,]"]) {
      const p = unparsableProblem(raw);
      expect(p).toBe("模型输出无法解析为 JSON");
      expect(isBudgetProblem(p)).toBe(false);
    }
  });
});

describe("model_output.classifyBadOutput", () => {
  test("三分：空 / 截断 / 坏格式", () => {
    expect(classifyBadOutput("")).toBe("empty");
    expect(classifyBadOutput("   \n ")).toBe("empty");
    expect(classifyBadOutput(null)).toBe("empty");
    expect(classifyBadOutput("{\"a\": [1, 2")).toBe("truncated");
    expect(classifyBadOutput("```json\n{\"a\": 1")).toBe("truncated");
    expect(classifyBadOutput("{not json}")).toBe("unparsable");
    expect(classifyBadOutput("没有 JSON")).toBe("unparsable");
  });

  test("字符串里的括号不算结构（不能把好输出误判成截断）", () => {
    expect(classifyBadOutput("{\"stem\": \"选 {A} 还是 [B]\"")).toBe("truncated");
    expect(classifyBadOutput("{\"stem\": \"选 {A}\"} 解释：(见上)")).toBe("unparsable");
  });

  test("只有预算病才让重试：截断/空 → true，坏格式 → false", () => {
    expect(isBudgetProblem(unparsableProblem(""))).toBe(true);
    expect(isBudgetProblem(unparsableProblem("{\"a\": 1"))).toBe(true);
    expect(isBudgetProblem(unparsableProblem("{not json}"))).toBe(false);
    expect(isBudgetProblem("随便一句别的话")).toBe(false);
  });
});
