/**
 * 划词弹窗里「讲讲这句里的用法」的回归门。
 *
 * 2026-09-13 用户反馈：点了按钮转一会儿什么都没有。根因是 deepseek-v4-flash 的推理
 * token 也计入 max_tokens，原先只给 260：实测一次完整讲解要 248-669 token（波动大），260 时 6 次
 * 全被截断，其中 2 次推理就吃光预算、正文 0 字；而前端把空串当成「没结果」悄悄退回按钮。
 */
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

jest.mock("../lib/ai/client", () => ({
  callAI: jest.fn(),
  isDailyLimitError: (e) => !!(e && e.code === "DAILY_LIMIT"),
}));

import { callAI } from "../lib/ai/client";
import { WordLookupLayer } from "../components/reading/WordLookupLayer";

const PASSAGE = "The small fish hides among the long stinging tentacles.";
const SHARDS = {
  t: { tentacles: { p: "'tentəkəlz", t: "n. 触手", g: "" } },
  s: { small: { p: "smɔ:l", t: "a. 小的", g: "" } },
};

const realFetch = global.fetch;
const realCaret = document.caretRangeFromPoint;
const realRect = Range.prototype.getBoundingClientRect;

beforeAll(() => {
  global.fetch = jest.fn((url) => {
    const letter = String(url).match(/\/dict\/(.)\.json/)[1];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(SHARDS[letter] || {}) });
  });
  // jsdom 没实现这两个 API：x < 100 视为点在 small 上，否则点在 tentacles 上
  document.caretRangeFromPoint = (x) => {
    const host = screen.getByText(PASSAGE);
    const word = x < 100 ? "small" : "tentacles";
    const r = document.createRange();
    r.setStart(host.firstChild, PASSAGE.indexOf(word) + 2);
    r.collapse(true);
    return r;
  };
  Range.prototype.getBoundingClientRect = () => ({
    top: 100, bottom: 116, left: 40, right: 100, width: 60, height: 16,
  });
});

afterAll(() => {
  global.fetch = realFetch;
  document.caretRangeFromPoint = realCaret;
  Range.prototype.getBoundingClientRect = realRect;
});

beforeEach(() => {
  callAI.mockReset();
  localStorage.clear();
  localStorage.setItem("toefl-user-tier", "pro");
});

async function openWord(x) {
  fireEvent.mouseUp(screen.getByText(PASSAGE), { clientX: x, clientY: 108 });
  return screen.findByText("讲讲这句里的用法");
}

describe("划词弹窗 · AI 讲解", () => {
  it("给足 token 预算：推理 token 计入 max_tokens，给少了正文会被饿死", async () => {
    callAI.mockResolvedValue("这里指海葵的触手。");
    render(<WordLookupLayer passage={PASSAGE}>{PASSAGE}</WordLookupLayer>);
    fireEvent.click(await openWord(150));
    expect(await screen.findByText("这里指海葵的触手。")).toBeInTheDocument();
    // 实测完整讲解输出 248~669 token 且波动大，上限低于 1000 就会随机截断
    expect(callAI.mock.calls[0][2]).toBeGreaterThanOrEqual(1000);
  });

  it("AI 返回空正文时明确提示，而不是悄悄退回按钮", async () => {
    callAI.mockResolvedValue("   ");
    render(<WordLookupLayer passage={PASSAGE}>{PASSAGE}</WordLookupLayer>);
    fireEvent.click(await openWord(150));
    expect(await screen.findByText(/没返回内容/)).toBeInTheDocument();
    // 空结果不能进缓存，否则重试也永远拿不到
    expect(localStorage.getItem("dict-ai-explain-cache")).toBeNull();
  });

  it("请求失败给人话，不把 API error 403 这种原文丢给用户", async () => {
    callAI.mockRejectedValue(Object.assign(new Error("API error 500"), { status: 500 }));
    render(<WordLookupLayer passage={PASSAGE}>{PASSAGE}</WordLookupLayer>);
    fireEvent.click(await openWord(150));
    expect(await screen.findByText("AI 暂时没响应，稍后再试")).toBeInTheDocument();
    expect(screen.queryByText(/API error/)).toBeNull();
  });

  it("等待期间换了词，旧词的讲解不能贴到新词的弹窗上", async () => {
    let resolveOld;
    callAI.mockImplementation(() => new Promise((r) => { resolveOld = r; }));
    render(<WordLookupLayer passage={PASSAGE}>{PASSAGE}</WordLookupLayer>);
    fireEvent.click(await openWord(150)); // 查 tentacles 并发起 AI 请求
    await openWord(50); // 请求还没回来，改查 small
    await act(async () => {
      resolveOld("tentacles 在这里指触手。");
    });
    expect(screen.queryByText("tentacles 在这里指触手。")).toBeNull();
    expect(screen.getByText("讲讲这句里的用法")).toBeInTheDocument();
  });
});
