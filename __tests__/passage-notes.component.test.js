/**
 * 原文批注提问（components/notes/NotedPassage + usePassageNotes + WordLookupLayer 的 notes 入口）。
 * 全部 mock callAI，不花钱；云同步在游客账号下不发请求，这里另测登录后会推。
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

let TIER = "pro";
let CODE = "";
jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => CODE),
  getSavedTier: jest.fn(() => TIER),
  AUTH_CHANGED_EVENT: "auth-changed",
}));

const lookupWord = jest.fn(async (w) => ({ word: w, p: "'nektə", t: "n. 花蜜" }));
jest.mock("../lib/dict/lookup", () => ({
  ...jest.requireActual("../lib/dict/lookup"),
  lookupWord: (...a) => lookupWord(...a),
}));

let REPLY = "主干是 Bees visit flowers。\"Bees visit flowers to collect nectar.\" [S1] 意思是蜜蜂采蜜。";
const callAI = jest.fn(async () => REPLY);
jest.mock("../lib/ai/client", () => ({
  ...jest.requireActual("../lib/ai/client"),
  callAI: (...args) => callAI(...args),
}));

import { NotedPassage } from "../components/notes/NotedPassage";
import { NOTE_SYSTEM } from "../lib/notes/noteQa";
import { makeNote } from "../lib/notes/passageNotes";
import { loadAllNotes, NOTE_STORE_PREFIX } from "../lib/notes/noteStore";
import { AI_HELPER_MAX_TOKENS } from "../lib/ai/client";
import { QA_DAILY_PREFIX, localDate } from "../lib/qa/qaStore";

const P1 = "Bees visit flowers to collect nectar. In doing so, they carry pollen from one flower to another.";
const P2 = "Some flowers attract only one kind of bee.";
const PASSAGE = `${P1}\n\n${P2}`;

const realRect = Range.prototype.getBoundingClientRect;
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 116, left: 40, right: 100, width: 60, height: 16 });
});
afterAll(() => {
  Range.prototype.getBoundingClientRect = realRect;
});

beforeEach(() => {
  localStorage.clear();
  TIER = "pro";
  CODE = "";
  REPLY = "主干是 Bees visit flowers。\"Bees visit flowers to collect nectar.\" [S1] 意思是蜜蜂采蜜。";
  callAI.mockClear();
  lookupWord.mockClear();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
});

function select(node, text) {
  const host = node.firstChild && node.firstChild.nodeType === 3 ? node.firstChild : node;
  const at = host.nodeValue.indexOf(text);
  const r = document.createRange();
  r.setStart(host, at);
  r.setEnd(host, at + text.length);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  fireEvent.mouseUp(node);
}

const paragraph = (text) => screen.getByText((_, el) => el?.tagName === "DIV" && el.textContent === text && el.children.length === 0);

describe("原文批注提问", () => {
  it("选中一整句 → 提问气泡 → 快捷问题 → 原文留高亮和序号，笔记卡展开并带出处", async () => {
    render(<NotedPassage passage={PASSAGE} />);
    select(paragraph(P1), "In doing so, they carry pollen from one flower to another.");
    expect(await screen.findByTestId("note-ask-bubble")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("note-preset-parse"));

    expect(await screen.findByTestId("note-answer")).toHaveTextContent("意思是蜜蜂采蜜");
    expect(callAI).toHaveBeenCalledTimes(1);
    const [system, message, tokens] = callAI.mock.calls[0];
    expect(system).toBe(NOTE_SYSTEM);
    expect(message).toContain('【学生选中的原文】"In doing so, they carry pollen from one flower to another."（在 S2）');
    expect(tokens).toBe(AI_HELPER_MAX_TOKENS * 2);
    // 整句不查词典
    expect(lookupWord).not.toHaveBeenCalled();
    expect(screen.getByTestId("note-mark")).toHaveTextContent("In doing so, they carry pollen from one flower to another.");
    expect(screen.getByTestId("note-badge")).toHaveTextContent("1");
    expect(screen.getByText("第 1 段第 1 句")).toBeInTheDocument();
    expect(screen.queryByTestId("note-ask-bubble")).toBeNull();

    // 存档里有一条、带这一轮
    const saved = loadAllNotes("guest");
    expect(saved).toHaveLength(1);
    expect(saved[0].turns[0]).toMatchObject({ presetId: "parse", label: "拆解这句" });
    // 占了一轮每日额度（和逐题追问共用）
    expect(localStorage.getItem(`${QA_DAILY_PREFIX}:guest`)).toContain(localDate());
  });

  it("平时收起：点高亮展开 / 收起；刷新后高亮还在", async () => {
    const note = { ...makeNote({ passage: PASSAGE, quote: "carry pollen" }), turns: [{ q: "q", label: "常见搭配", a: "carry 常和 pollen 连用 [S2]", at: "x" }] };
    localStorage.setItem(`${NOTE_STORE_PREFIX}:guest`, JSON.stringify({ notes: [note] }));
    render(<NotedPassage passage={PASSAGE} />);
    const mark = screen.getByTestId("note-mark");
    expect(mark).toHaveTextContent("carry pollen");
    expect(screen.queryByTestId("note-card")).toBeNull();
    fireEvent.click(mark);
    expect(screen.getByTestId("note-answer")).toHaveTextContent("carry 常和 pollen 连用");
    expect(screen.getByText("问：常见搭配")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("note-badge"));
    expect(screen.queryByTestId("note-card")).toBeNull();
  });

  it("追问同一处带上之前的问答；删除是软删除", async () => {
    const note = { ...makeNote({ passage: PASSAGE, quote: "nectar" }), turns: [{ q: "什么意思", a: "花蜜 [词典]", dict: "nectar", at: "x" }] };
    localStorage.setItem(`${NOTE_STORE_PREFIX}:guest`, JSON.stringify({ notes: [note] }));
    REPLY = "动词搭配 collect nectar [S1]";
    render(<NotedPassage passage={PASSAGE} />);
    fireEvent.click(screen.getByTestId("note-mark"));
    fireEvent.change(screen.getByTestId("note-follow-input"), { target: { value: "还有什么搭配" } });
    fireEvent.click(screen.getByTestId("note-follow-send"));
    await waitFor(() => expect(screen.getAllByTestId("note-answer")).toHaveLength(2));
    const message = callAI.mock.calls[0][1];
    expect(message).toContain("学生1：什么意思");
    expect(message).toContain("【词典】（ECDICT）nectar");
    expect(lookupWord).toHaveBeenCalledWith("nectar");

    fireEvent.click(screen.getByTestId("note-delete"));
    fireEvent.click(screen.getByTestId("note-delete-confirm"));
    expect(screen.queryByTestId("note-mark")).toBeNull();
    const all = loadAllNotes("guest");
    expect(all).toHaveLength(1);
    expect(all[0].deletedAt).toBeTruthy();
  });

  it("AI 失败：草稿留着可以重试，不扣额度、不存档", async () => {
    callAI.mockRejectedValueOnce(new Error("Empty AI response"));
    render(<NotedPassage passage={PASSAGE} />);
    select(paragraph(P1), "In doing so, they carry pollen from one flower to another.");
    fireEvent.change(await screen.findByTestId("note-ask-input"), { target: { value: "这句为什么用 doing" } });
    fireEvent.click(screen.getByTestId("note-ask-send"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(loadAllNotes("guest")).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(`${QA_DAILY_PREFIX}:guest`) || "{}").count || 0).toBe(0);
    fireEvent.click(screen.getByText("重试"));
    expect(await screen.findByTestId("note-answer")).toBeInTheDocument();
    expect(loadAllNotes("guest")).toHaveLength(1);
  });

  it("选中单个词走词典弹窗，底部多一块「问 AI」，问词形会查词典", async () => {
    render(<NotedPassage passage={PASSAGE} />);
    select(paragraph(P1), "nectar");
    fireEvent.click(await screen.findByTestId("note-preset-forms"));
    expect(await screen.findByTestId("note-answer")).toBeInTheDocument();
    expect(callAI.mock.calls[0][1]).toContain("【词典】（ECDICT）nectar");
    expect(callAI.mock.calls[0][1]).toContain("列出这个词的所有词形");
    expect(screen.getByTestId("note-mark")).toHaveTextContent("nectar");
  });

  it("鼠标划词后浏览器选区换成自绘高亮（压住 Edge 划词菜单），关弹窗就清掉；Ctrl+C 照样复制", async () => {
    const store = new Map();
    global.CSS = { highlights: { set: (k, v) => store.set(k, v), delete: (k) => store.delete(k) } };
    global.Highlight = function Highlight(r) { this.range = r; };
    try {
      render(<NotedPassage passage={PASSAGE} />);
      const host = paragraph(P1);
      const quote = "In doing so, they carry pollen from one flower to another.";
      const at = host.firstChild.nodeValue.indexOf(quote);
      const r = document.createRange();
      r.setStart(host.firstChild, at);
      r.setEnd(host.firstChild, at + quote.length);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(r);
      const notPrevented = fireEvent.mouseUp(host);
      expect(notPrevented).toBe(false); // mouseup 被阻止了默认行为
      expect(await screen.findByTestId("note-ask-bubble")).toBeInTheDocument();
      expect(window.getSelection().isCollapsed).toBe(true);
      expect(store.get("note-pending").range.toString()).toBe(quote);

      const setData = jest.fn();
      const copy = new Event("copy", { bubbles: true, cancelable: true });
      copy.clipboardData = { setData };
      document.dispatchEvent(copy);
      expect(setData).toHaveBeenCalledWith("text/plain", quote);

      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
      expect(store.has("note-pending")).toBe(false);
    } finally {
      delete global.CSS;
      delete global.Highlight;
    }
  });

  it("选中两个词就直接弹提问气泡，不再显示最后一个词的词典释义；快捷问题按短语给", async () => {
    render(<NotedPassage passage={PASSAGE} />);
    select(paragraph(P1), "carry pollen");
    expect(await screen.findByTestId("note-ask-bubble")).toBeInTheDocument();
    expect(screen.queryByText("讲讲这句里的用法")).toBeNull();
    expect(screen.getByTestId("note-preset-collocations")).toBeInTheDocument();
    expect(lookupWord).not.toHaveBeenCalled();
  });

  it("非 Pro：选中几个词仍走词典（看不到提问）", async () => {
    TIER = "free";
    render(<NotedPassage passage={PASSAGE} />);
    select(paragraph(P1), "carry pollen");
    expect(screen.queryByTestId("note-ask-bubble")).toBeNull();
    await waitFor(() => expect(lookupWord).toHaveBeenCalled());
  });

  it("非 Pro：长选区不弹提问气泡", () => {
    TIER = "free";
    render(<NotedPassage passage={PASSAGE} />);
    select(paragraph(P1), "In doing so, they carry pollen from one flower to another.");
    expect(screen.queryByTestId("note-ask-bubble")).toBeNull();
  });

  it("登录后：笔记推到云端副本", async () => {
    jest.useFakeTimers();
    try {
      CODE = "abc123";
      const calls = [];
      global.fetch = jest.fn((url, init) => {
        calls.push([String(url), init?.method || "GET", init?.body]);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, notes: [] }) });
      });
      render(<NotedPassage passage={PASSAGE} />);
      select(paragraph(P1), "In doing so, they carry pollen from one flower to another.");
      fireEvent.click(screen.getByTestId("note-preset-simpler"));
      await act(async () => { await Promise.resolve(); });
      await act(async () => { jest.advanceTimersByTime(3000); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      await waitFor(() => expect(calls.some(([u, m]) => u === "/api/notes" && m === "POST")).toBe(true));
      const post = calls.find(([u, m]) => u === "/api/notes" && m === "POST");
      const body = JSON.parse(post[2]);
      expect(body.code).toBe("ABC123");
      expect(body.notes[0].quote).toBe("In doing so, they carry pollen from one flower to another.");
    } finally {
      jest.useRealTimers();
    }
  });

  it("词形表：一个词形一行，点「收藏」直接进单词本（带释义、例句和音标），再显示「已收藏」", async () => {
    const answer = [
      "[词形]",
      "nectar｜n.｜花蜜｜原词｜Bees collect nectar.",
      "nectarous｜adj.｜花蜜的；甜美的｜派生形容词｜A nectarous scent.",
      "[/词形]",
      "补充：nectar 多为不可数名词。",
    ].join("\n");
    const note = { ...makeNote({ passage: PASSAGE, quote: "nectar" }), turns: [{ q: "列词形", label: "列出所有词形", a: answer, at: "x" }] };
    localStorage.setItem(`${NOTE_STORE_PREFIX}:guest`, JSON.stringify({ notes: [note] }));
    render(<NotedPassage passage={PASSAGE} />);
    fireEvent.click(screen.getByTestId("note-mark"));

    const rows = await screen.findAllByTestId("word-form-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("nectar");
    expect(rows[0]).toHaveTextContent("花蜜");
    expect(screen.getByTestId("note-answer")).toHaveTextContent("nectar 多为不可数名词");
    expect(screen.queryByText(/\[词形\]/)).toBeNull();

    fireEvent.click(screen.getByTestId("word-form-save-nectar"));
    await waitFor(() => expect(screen.getByTestId("word-form-save-nectar")).toHaveTextContent("已收藏"));
    const { getCard } = require("../lib/vocab/vocabStore");
    const card = getCard("nectar");
    expect(card.def).toBe("n. 花蜜");
    expect(card.sentence).toBe("Bees collect nectar.");
    expect(card.phonetic).toBe("'nektə");
    expect(card.source).toBe("passage-note");
    expect(screen.getByTestId("word-form-save-nectarous")).toHaveTextContent("收藏");
  });

  it("点出处高亮原文那句：原文里有这句就接住（跨笔记高亮也能找到），没有就返回 false", async () => {
    const note = { ...makeNote({ passage: PASSAGE, quote: "carry pollen" }), turns: [{ q: "q", a: "a", at: "x" }] };
    localStorage.setItem(`${NOTE_STORE_PREFIX}:guest`, JSON.stringify({ notes: [note] }));
    render(<NotedPassage passage={PASSAGE} />);
    const { flashPassageSentence } = require("../lib/notes/passageFlash");
    let ok;
    act(() => { ok = flashPassageSentence("In doing so, they carry pollen from one flower to another."); });
    expect(ok).toBe(true);
    // 选区跨过笔记序号角标（DOM 上它在句子中间），所以文字里会带上角标数字
    expect(window.getSelection().toString().replace(/\d/g, "")).toBe("In doing so, they carry pollen from one flower to another.");
    expect(flashPassageSentence("Not in this passage at all.")).toBe(false);
  });
});

