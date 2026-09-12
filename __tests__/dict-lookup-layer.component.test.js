/**
 * WordLookupLayer 的渲染健壮性。
 *
 * 重点是「没有 fetch 也不能炸」：loadShard 里 `fetch(...)` 在缺 fetch 的环境
 * （jsdom 测试、老 WebView）会**同步**抛 ReferenceError，promise 上的 .catch
 * 接不住；一旦漏进去，阅读复盘的整棵渲染树会跟着崩，所有渲染该组件的测试连坐。
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { WordLookupLayer } from "../components/reading/WordLookupLayer";

const PASSAGE = "Clownfish and sea anemones form a remarkable partnership.";

describe("WordLookupLayer", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("环境里没有 fetch 时照常渲染原文，不抛错", () => {
    delete global.fetch;
    expect(() =>
      render(<WordLookupLayer passage={PASSAGE}>{PASSAGE}</WordLookupLayer>)
    ).not.toThrow();
    expect(screen.getByText(PASSAGE)).toBeInTheDocument();
  });

  it("有 fetch 时按文章首字母预热分片", () => {
    const calls = [];
    global.fetch = jest.fn((url) => {
      calls.push(url);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    render(<WordLookupLayer passage={PASSAGE}>{PASSAGE}</WordLookupLayer>);
    // 文章里出现过的首字母都该被预取，且每片只取一次
    expect(calls).toEqual(expect.arrayContaining(["/dict/c.json", "/dict/a.json"]));
    expect(new Set(calls).size).toBe(calls.length);
  });

  it("没有 passage 时不发任何请求", () => {
    global.fetch = jest.fn();
    render(<WordLookupLayer>正文缺失</WordLookupLayer>);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("默认不渲染弹窗", () => {
    delete global.fetch;
    const { container } = render(
      <WordLookupLayer passage={PASSAGE}>{PASSAGE}</WordLookupLayer>
    );
    const popovers = [...container.querySelectorAll("div")].filter(
      (d) => d.style.position === "fixed"
    );
    expect(popovers).toHaveLength(0);
  });
});
