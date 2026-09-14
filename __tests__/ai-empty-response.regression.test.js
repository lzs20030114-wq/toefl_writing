/**
 * 「AI 解释点了不出内容、也不报错」的回归锁 —— 2026-09-13 线上故障。
 *
 * 故障链条（三段，缺一段都还会静默）：
 *   ① deepseek-v4-flash 是推理型模型，reasoning_tokens 计入 max_tokens 预算。
 *      AI 辅助调用原本只给 260-700，远在推理长度量级以下 → 推理吃光预算，上游回
 *      finish_reason=length + **空 content**，HTTP 却是 200。
 *   ② /api/ai 的单采样路径不校验空正文，直接 Response.json({ content: "" }) 放行，
 *      而且因为是 200，api_error_feedback 一条记录都不写 —— 后台完全查不到。
 *   ③ 前端 hook 把空串当成功：ex.text 是假值于是渲染回按钮、error 又是 null，
 *      用户看到的就是一个点了毫无反应的死按钮。
 *
 * 本文件锁 ②③ 两层的判据；① 是预算值，由 AI_HELPER_MAX_TOKENS 一处收口，
 * 这里顺带断言各调用点确实用的是那个常量而不是又写死一个小数字。
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => "ABC123"),
  getSavedTier: jest.fn(() => "pro"),
}));

import { callAI, callAIMulti, mapAiHelperError, AI_HELPER_MAX_TOKENS, AI_EXPLAIN_BUDGET } from "../lib/ai/client";

const DETAIL = {
  prompt: "Will you be attending the conference next week?",
  userAnswer: "I will not available during those dates.",
  correctAnswer: "I am not available during those dates.",
  isCorrect: false,
  grammar_points: ["be-verb"],
};

function mockAiResponse(body, { ok = true, status = 200 } = {}) {
  global.fetch = jest.fn().mockResolvedValue({ ok, status, json: async () => body });
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

describe("callAI 不把空正文当成功", () => {
  test.each([
    ["空串", { content: "" }],
    ["只有空白字符", { content: "   \n  " }],
    ["字段缺失", {}],
  ])("%s → 抛错而不是返回空内容", async (_label, body) => {
    mockAiResponse(body);
    await expect(callAI("s", "m", AI_HELPER_MAX_TOKENS, 5000, 0.3)).rejects.toThrow(/empty ai response/i);
  });

  test("正常内容照常返回", async () => {
    mockAiResponse({ content: "这里是讲解正文。" });
    await expect(callAI("s", "m", AI_HELPER_MAX_TOKENS, 5000, 0.3)).resolves.toBe("这里是讲解正文。");
  });

  test("空正文的错误有可读文案（不是裸 message）", () => {
    expect(mapAiHelperError(new Error("Empty AI response"))).toBe("AI 没返回内容，请重试");
  });
});

describe("callAIMulti 不把空正文当成功", () => {
  test("contents 全空 且 content 也空 → 抛错", async () => {
    mockAiResponse({ content: "", contents: ["", "  "] });
    await expect(callAIMulti("s", "m", 8000, 5000, 0.3, 3)).rejects.toThrow(/empty ai response/i);
  });

  test("contents 里有非空的就照常取（部分采样为空不算失败）", async () => {
    mockAiResponse({ content: "", contents: ["", "有效报告"] });
    await expect(callAIMulti("s", "m", 8000, 5000, 0.3, 3)).resolves.toEqual(["有效报告"]);
  });
});

describe("AI 解释按钮：上游空正文时必须给出可见反馈", () => {
  // 挂真组件，不写「长得像」的复刻页（见 CLAUDE.md 的复现约定）。
  function Harness({ Block, hook }) {
    const ai = hook();
    return <Block explainKey="k" detail={DETAIL} {...ai} />;
  }

  test("点了之后不再是「既无内容也无报错」的死按钮", async () => {
    const { useBsAiExplain, BsAiExplainBlock } = require("../components/buildSentence/useBsAiExplain");
    mockAiResponse({ content: "" });
    render(<Harness Block={BsAiExplainBlock} hook={useBsAiExplain} />);

    fireEvent.click(screen.getByRole("button", { name: "AI 解释" }));

    // 核心断言：用户得到的是一条可读的错误，而不是什么都没发生。
    expect(await screen.findByText("AI 没返回内容，请重试")).toBeInTheDocument();
  });

  test("空正文不写进 localStorage 缓存（否则下次点开是空白面板）", async () => {
    const { useBsAiExplain, BsAiExplainBlock } = require("../components/buildSentence/useBsAiExplain");
    mockAiResponse({ content: "" });
    render(<Harness Block={BsAiExplainBlock} hook={useBsAiExplain} />);

    fireEvent.click(screen.getByRole("button", { name: "AI 解释" }));
    await screen.findByText("AI 没返回内容，请重试");

    const cache = JSON.parse(localStorage.getItem("bs-ai-explain-cache") || "{}");
    expect(Object.values(cache).filter((v) => !String(v || "").trim())).toHaveLength(0);
  });

  test("正常返回时照常渲染讲解", async () => {
    const { useBsAiExplain, BsAiExplainBlock } = require("../components/buildSentence/useBsAiExplain");
    mockAiResponse({ content: "be 动词不能和 will 直接连用。" });
    render(<Harness Block={BsAiExplainBlock} hook={useBsAiExplain} />);

    fireEvent.click(screen.getByRole("button", { name: "AI 解释" }));
    expect(await screen.findByText("be 动词不能和 will 直接连用。")).toBeInTheDocument();
  });

  test("请求带的是共享预算常量，不是又写死的小数字", async () => {
    const { useBsAiExplain, BsAiExplainBlock } = require("../components/buildSentence/useBsAiExplain");
    mockAiResponse({ content: "讲解" });
    render(<Harness Block={BsAiExplainBlock} hook={useBsAiExplain} />);

    fireEvent.click(screen.getByRole("button", { name: "AI 解释" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    // 造句是「单句」档；分档是 2026-09-14 加的（一刀切 2000 把查词这类快活儿也拖慢了）。
    expect(body.maxTokens).toBe(AI_EXPLAIN_BUDGET.sentence);
    // 关键：小预算必须配着「空正文自动升档」一起送，否则就是退回 09-13 那个故障。
    expect(body.retryMaxTokens).toBe(AI_HELPER_MAX_TOKENS);
    // 推理型模型下 260-700 就是这次故障的量级，升档上限别再退回去。
    expect(AI_HELPER_MAX_TOKENS).toBeGreaterThanOrEqual(1500);
  });

  test("满档调用不带 retryMaxTokens（同档重试是白花钱）", async () => {
    mockAiResponse({ content: "讲解" });
    const { callAIStream } = require("../lib/ai/client");
    await callAIStream("s", "m", AI_EXPLAIN_BUDGET.passage, {});

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.maxTokens).toBe(AI_HELPER_MAX_TOKENS);
    expect(body.retryMaxTokens).toBeUndefined();
  });

  test("分档表本身：快档要真的比满档小，且满档就是升档上限", () => {
    expect(AI_EXPLAIN_BUDGET.word).toBeLessThan(AI_EXPLAIN_BUDGET.sentence);
    expect(AI_EXPLAIN_BUDGET.sentence).toBeLessThan(AI_EXPLAIN_BUDGET.passage);
    expect(AI_EXPLAIN_BUDGET.passage).toBe(AI_HELPER_MAX_TOKENS);
  });
});

describe("所有 AI 辅助调用点都用共享预算", () => {
  const fs = require("fs");
  const path = require("path");
  const CALL_SITES = [
    "components/buildSentence/useBsAiExplain.js",
    "components/reading/useReadingAiExplain.js",
    "components/reading/useCtwAiExplain.js",
    "components/reading/WordLookupLayer.js",
    "components/mistakes/useMcqAiExplain.js",
    "components/MistakeNotebook.js",
  ];

  test.each(CALL_SITES)("%s 不再写死 token 预算", (rel) => {
    const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    // 按行抓，别用 /callAI\([^)]*\)/ —— 实参里有 buildMessage(detail) 这类嵌套括号时
    // 那个正则会在第一个 ")" 提前截断，把已经改好的调用点误报成没改。
    const calls = src.split("\n").filter((line) => /\bawait callAI(?:Stream)?\(/.test(line));
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((call) => {
      // 2026-09-14 起预算按用途分档（AI_EXPLAIN_BUDGET.word/sentence/passage），
      // 但仍必须来自那张表——就地写个数字就又回到「六份各调各的」的老路。
      expect(call).toMatch(/AI_EXPLAIN_BUDGET\.(word|sentence|passage)/);
    });
  });

  test.each(CALL_SITES)("%s 的失败分支不直接渲染 e.message", (rel) => {
    const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    // 事故原文见 lib/ai/client.js 的 mapAiHelperError 注释：裸 message 会把
    // "API error 403" 这种话甩给用户，既看不懂也不知道能重试。
    expect(src).not.toMatch(/error:\s*e\.message/);
  });
});
