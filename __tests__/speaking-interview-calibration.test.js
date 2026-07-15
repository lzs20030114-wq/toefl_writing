/**
 * Take an Interview 评分：护栏纯函数 + 三路取中位 + scoreInterview 集成 + prompt 冒烟。
 *
 * client.callAIMulti 被 mock（不打真网络）；calibration 与 prompt 用真实实现。
 */

jest.mock("../lib/ai/client", () => ({ callAIMulti: jest.fn() }));

import { callAIMulti } from "../lib/ai/client";
import { scoreInterview } from "../lib/speakingEval/interviewScorer";
import {
  clampHalf,
  countWords,
  isQuestionEcho,
  applyGuardrails,
  pickMedianReport,
  parseInterviewResponse,
  annotateOffTopicSummary,
  WORD_CAPS,
  OFF_TOPIC_CAP,
  ECHO_CAP,
} from "../lib/speakingEval/calibration";
import { getSpeakingSystemPrompt, buildInterviewUserPrompt } from "../lib/ai/prompts/speaking";

// ── 测试辅助 ──────────────────────────────────────────────────────────────────
function dims(score) {
  return {
    fluency: { score, feedback: "f" },
    intelligibility: { score, feedback: "i" },
    language: { score, feedback: "l" },
    organization: { score, feedback: "o" },
  };
}
// n 个互不重复、非题干、非停用词的内容词——用于凑词数且绝不触发复读检测。
function fillerWords(n) {
  return Array.from({ length: n }, (_, i) => `topicword${i}`).join(" ");
}
function rawJSON(overall, dimScore = overall, onTopic = true, extra = {}) {
  return JSON.stringify({
    overall,
    on_topic: onTopic,
    score: overall,
    dimensions: dims(dimScore),
    summary: "整体尚可。",
    suggestions: ["建议一", "建议二"],
    ...extra,
  });
}

// ── clampHalf / countWords ────────────────────────────────────────────────────
describe("clampHalf", () => {
  test("四舍五入到 0.5、夹到 [0,5]", () => {
    expect(clampHalf(3.24)).toBe(3.0);
    expect(clampHalf(3.26)).toBe(3.5);
    expect(clampHalf(7)).toBe(5);
    expect(clampHalf(-1)).toBe(0);
    expect(clampHalf("abc")).toBe(0);
    expect(clampHalf(undefined)).toBe(0);
  });
});

describe("countWords", () => {
  test("按空白切分、忽略空串", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("one two three")).toBe(3);
    expect(countWords("  a\n b\tc ")).toBe(3);
  });
});

// ── 词数封顶 ──────────────────────────────────────────────────────────────────
describe("applyGuardrails: 词数封顶", () => {
  test("<10 词 → cap 1.0，且维度条一并压到 ceiling", () => {
    const r = applyGuardrails({
      overall: 5, dimensions: dims(5),
      transcript: fillerWords(8), question: "zzz", onTopic: true,
    });
    expect(r.score).toBe(1.0);
    expect(r.guardrails).toContain("word_cap_lt_10");
    expect(r.dimensions.fluency.score).toBe(1.0);
    expect(r.dimensions.organization.score).toBe(1.0);
  });

  test("<25 词 → cap 2.5", () => {
    const r = applyGuardrails({
      overall: 5, dimensions: dims(5),
      transcript: fillerWords(20), question: "zzz", onTopic: true,
    });
    expect(r.score).toBe(2.5);
    expect(r.guardrails).toContain("word_cap_lt_25");
  });

  test("<45 词 → cap 3.5", () => {
    const r = applyGuardrails({
      overall: 5, dimensions: dims(5),
      transcript: fillerWords(40), question: "zzz", onTopic: true,
    });
    expect(r.score).toBe(3.5);
    expect(r.guardrails).toContain("word_cap_lt_45");
  });

  test("≥45 词 → 无词数封顶", () => {
    const r = applyGuardrails({
      overall: 4, dimensions: dims(4),
      transcript: fillerWords(60), question: "zzz", onTopic: true,
    });
    expect(r.score).toBe(4);
    expect(r.guardrails).toEqual([]);
  });

  test("WORD_CAPS 常量口径", () => {
    expect(WORD_CAPS).toEqual([
      { maxWords: 10, cap: 1.0 },
      { maxWords: 25, cap: 2.5 },
      { maxWords: 45, cap: 3.5 },
    ]);
  });
});

// ── 跑题封顶 ──────────────────────────────────────────────────────────────────
describe("applyGuardrails: on_topic=false 封顶 2.0", () => {
  test("跑题 → score ≤ OFF_TOPIC_CAP，记录 off_topic_cap", () => {
    const r = applyGuardrails({
      overall: 5, dimensions: dims(5),
      transcript: fillerWords(60), question: "zzz", onTopic: false,
    });
    expect(r.score).toBe(OFF_TOPIC_CAP);
    expect(r.guardrails).toContain("off_topic_cap");
  });

  test("on_topic=true 不触发", () => {
    const r = applyGuardrails({
      overall: 4, dimensions: dims(4),
      transcript: fillerWords(60), question: "zzz", onTopic: true,
    });
    expect(r.guardrails).not.toContain("off_topic_cap");
  });
});

// ── 复读题干检测 + 封顶 ───────────────────────────────────────────────────────
describe("isQuestionEcho / question_echo_cap", () => {
  const question = "What types of AI tools or features do you use regularly and how did you first start using them";

  test("几乎全部复读题干 → echo=true", () => {
    const echo = "Um, the AI tools or features I use regularly, like, the AI tools or features I use regularly, you know, and how I first start using them, well, the tools or features I use regularly, um, how did I first start using them, you know, regularly.";
    expect(isQuestionEcho(echo, question)).toBe(true);
  });

  test("引入大量新内容 → echo=false（不误伤正常作答）", () => {
    const real = "I mainly use a chatbot for studying and a voice assistant on my phone for reminders. My roommate showed me the chatbot last year when I needed help summarizing long articles for my history class.";
    expect(isQuestionEcho(real, question)).toBe(false);
  });

  test("空转写 → false", () => {
    expect(isQuestionEcho("", question)).toBe(false);
  });

  test("复读且 ≥45 词 → 封到 ECHO_CAP（隔离出词数封顶）", () => {
    const echo = "Um, the AI tools or features I use regularly, like, the AI tools or features I use regularly, you know, and how I first start using them, well, the tools or features I use regularly, um, how did I first start using them, you know, regularly.";
    expect(countWords(echo)).toBeGreaterThanOrEqual(45);
    const r = applyGuardrails({ overall: 5, dimensions: dims(5), transcript: echo, question, onTopic: true });
    expect(r.score).toBeLessThanOrEqual(ECHO_CAP);
    expect(r.guardrails).toContain("question_echo_cap");
  });
});

// ── 一致性收缩 ────────────────────────────────────────────────────────────────
describe("applyGuardrails: 维度均值与 overall 差异过大 → 收缩到中间值", () => {
  test("overall 5 但维度均 2 → 收缩到 3.5", () => {
    const r = applyGuardrails({
      overall: 5, dimensions: dims(2),
      transcript: fillerWords(60), question: "zzz", onTopic: true,
    });
    expect(r.score).toBe(3.5); // (2+5)/2
    expect(r.guardrails).toContain("consistency_shrink");
    // 无硬封顶时维度分不被上抬/下压
    expect(r.dimensions.fluency.score).toBe(2);
  });

  test("差异 ≤ 1.5 → 不收缩", () => {
    const r = applyGuardrails({
      overall: 4, dimensions: dims(3),
      transcript: fillerWords(60), question: "zzz", onTopic: true,
    });
    expect(r.guardrails).not.toContain("consistency_shrink");
    expect(r.score).toBe(4);
  });
});

// ── pickMedianReport ──────────────────────────────────────────────────────────
describe("pickMedianReport", () => {
  const R = (overall, id) => ({ overall, id });
  test("n=3 → 升序中位", () => {
    const chosen = pickMedianReport([R(5, "a"), R(3.5, "b"), R(4.5, "c")]);
    expect(chosen.id).toBe("c"); // 升序 3.5,4.5,5 → 中位 4.5
  });
  test("n=3 含并列 → 稳定取中位（原索引 tie-break）", () => {
    const chosen = pickMedianReport([R(5, "a"), R(4, "b"), R(5, "c")]);
    expect(chosen.id).toBe("a"); // 升序 4(b),5(a),5(c) → 中位 a
  });
  test("n=2 → 取较低者", () => {
    expect(pickMedianReport([R(4, "a"), R(3, "b")]).id).toBe("b");
    expect(pickMedianReport([R(3, "a"), R(5, "b")]).id).toBe("a");
  });
  test("n=1 → 用它", () => {
    expect(pickMedianReport([R(4, "a")]).id).toBe("a");
  });
  test("空 / 非数组 → null", () => {
    expect(pickMedianReport([])).toBeNull();
    expect(pickMedianReport(undefined)).toBeNull();
    expect(pickMedianReport(null)).toBeNull();
  });
});

// ── parseInterviewResponse ────────────────────────────────────────────────────
describe("parseInterviewResponse", () => {
  test("合法 JSON → overall / onTopic / dims / summary / suggestions", () => {
    const p = parseInterviewResponse(rawJSON(4, 3.5, true));
    expect(p.overall).toBe(4);
    expect(p.onTopic).toBe(true);
    expect(p.dimensions.language.score).toBe(3.5);
    expect(p.suggestions).toEqual(["建议一", "建议二"]);
  });

  test("剥离 markdown 代码围栏", () => {
    const fenced = "```json\n" + rawJSON(3) + "\n```";
    expect(parseInterviewResponse(fenced).overall).toBe(3);
  });

  test("overall 缺失 → 退回 score", () => {
    const raw = JSON.stringify({ score: 3.5, dimensions: dims(3.5), summary: "", suggestions: [] });
    expect(parseInterviewResponse(raw).overall).toBe(3.5);
  });

  test("overall 与 score 都缺失 → 退回维度均值", () => {
    const raw = JSON.stringify({ dimensions: dims(4), summary: "", suggestions: [] });
    expect(parseInterviewResponse(raw).overall).toBe(4);
  });

  test("on_topic=false 被保留；缺失默认 true", () => {
    expect(parseInterviewResponse(rawJSON(2, 2, false)).onTopic).toBe(false);
    const raw = JSON.stringify({ overall: 4, dimensions: dims(4), summary: "", suggestions: [] });
    expect(parseInterviewResponse(raw).onTopic).toBe(true);
  });

  test("缺 dimensions → 抛错；无 JSON → 抛错", () => {
    expect(() => parseInterviewResponse('{"overall":4}')).toThrow(/dimensions/i);
    expect(() => parseInterviewResponse("no json here")).toThrow(/JSON/i);
  });
});

// ── annotateOffTopicSummary ───────────────────────────────────────────────────
describe("annotateOffTopicSummary", () => {
  test("跑题/复读封顶且 summary 未点明 → 前置提示", () => {
    const out = annotateOffTopicSummary("回答比较简短。", ["off_topic_cap"]);
    expect(out).toMatch(/偏离|受限/);
    expect(out).toMatch(/回答比较简短。/);
  });
  test("summary 已含跑题字样 → 不重复前置", () => {
    const out = annotateOffTopicSummary("回答明显跑题了。", ["question_echo_cap"]);
    expect(out).toBe("回答明显跑题了。");
  });
  test("无跑题类护栏 → 原样返回", () => {
    expect(annotateOffTopicSummary("很好。", ["word_cap_lt_45"])).toBe("很好。");
  });
});

// ── scoreInterview 集成（mock callAIMulti，真 prompt + 真护栏）──────────────────
describe("scoreInterview: 三路取中位 + 护栏集成", () => {
  afterEach(() => jest.clearAllMocks());

  test("选中位路，护栏不触发（长作答），samplesUsed=3，透传新字段", async () => {
    callAIMulti.mockResolvedValue([rawJSON(5), rawJSON(3), rawJSON(4)]);
    const transcript = fillerWords(60); // ≥45 词、非复读
    const res = await scoreInterview({ question: "zzz unrelated question", transcript });

    expect(res.score).toBe(4); // median of [5,3,4]
    expect(res.error).toBeUndefined();
    expect(res.samplesUsed).toBe(3);
    expect(Array.isArray(res.guardrails)).toBe(true);
    expect(res.guardrails).toEqual([]);
    expect(res.dimensions.fluency.score).toBe(4);
    // 调用签名：maxTokens=2500, timeout=120000, temp=0.3, samples=3
    expect(callAIMulti).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), 2500, 120000, 0.3, 3,
    );
  });

  test("短作答 → 词数护栏把中位分压下来", async () => {
    callAIMulti.mockResolvedValue([rawJSON(5), rawJSON(5), rawJSON(5)]);
    const res = await scoreInterview({ question: "zzz unrelated question", transcript: fillerWords(8) });
    expect(res.score).toBe(1.0);
    expect(res.guardrails).toContain("word_cap_lt_10");
  });

  test("跑题（on_topic=false）→ 封顶 2.0 且 summary 点明", async () => {
    callAIMulti.mockResolvedValue([rawJSON(5, 5, false), rawJSON(5, 5, false), rawJSON(5, 5, false)]);
    const res = await scoreInterview({ question: "zzz unrelated question", transcript: fillerWords(60) });
    expect(res.score).toBe(2.0);
    expect(res.guardrails).toContain("off_topic_cap");
    expect(res.summary).toMatch(/偏离|受限|跑题/);
  });

  test("一路 parse 失败 → 取剩余两路较低者，samplesUsed=2", async () => {
    callAIMulti.mockResolvedValue(["not json at all", rawJSON(4), rawJSON(3)]);
    const res = await scoreInterview({ question: "zzz unrelated question", transcript: fillerWords(60) });
    expect(res.samplesUsed).toBe(2);
    expect(res.score).toBe(3); // n=2 取较低
  });

  test("少于 3 词 → fallback（不调用 AI）", async () => {
    const res = await scoreInterview({ question: "q", transcript: "um ok" });
    expect(res.error).toBe(true);
    expect(res.score).toBe(0);
    expect(callAIMulti).not.toHaveBeenCalled();
  });

  test("全部 parse 失败 → error fallback", async () => {
    callAIMulti.mockResolvedValue(["garbage", "more garbage", "still nothing"]);
    const res = await scoreInterview({ question: "zzz", transcript: fillerWords(60) });
    expect(res.error).toBe(true);
    expect(res.score).toBe(0);
  });
});

// ── prompt 冒烟 ───────────────────────────────────────────────────────────────
describe("prompt 冒烟", () => {
  test("system prompt 含官方档位关键描述语 + few-shot 锚，长度受控", () => {
    const sys = getSpeakingSystemPrompt();
    expect(sys.length).toBeLessThan(12000); // /api/ai MAX_SYSTEM_CHARS
    // 官方 5/2 档描述语
    expect(sys).toContain("on topic and well elaborated");
    expect(sys).toContain("consists mainly of language from the question");
    expect(sys).toMatch(/fully successful/i);
    // few-shot 官方满分样例落地（decide-quickly 里的独特短语）
    expect(sys).toContain("snack");
    // STT filler 不扣分的说明
    expect(sys).toMatch(/filler/i);
    // 反注入声明
    expect(sys).toMatch(/数据|指令/);
  });

  test("buildInterviewUserPrompt 含题目 + 转写 + 词数 + 反注入框架", () => {
    const u = buildInterviewUserPrompt("Do you decide quickly?", "um yeah I take my time to think");
    expect(u).toContain("Do you decide quickly?");
    expect(u).toContain("um yeah I take my time to think");
    expect(u).toMatch(/\d+ words/);
    expect(u).toMatch(/不是指令|数据/);
  });
});
