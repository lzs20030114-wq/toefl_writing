/**
 * 阅读填词（CTW）练习记录 —— 点开一个答错的空看「自己填的 vs 正确答案 + 所在句子 + AI 解析」。
 *
 * 锁的是三件事：
 *   ① locateBlankSentence 纯函数只靠 position 定位（真题库的 blank 没有
 *      sentence_index / word_index_in_sentence），越界 / 空原文不许抛错；
 *   ② 错项 chip 可点开、再点收起；面板必须补上「你填的」这个信息缺口
 *      （chip 上红色显示的其实是正确答案的补全，用户看不到自己填了什么）；
 *   ③ AI 解析是 Pro 专属、点了才计费，message 里带正确答案与学生答案。
 *
 * 入口有两个（/progress/reading 与 /real-bank/progress）但共用 CTWDetail，所以只测这一处。
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// jsdom 不带 fetch。ReadingProgressView 渲染原文时会经过划词词典层，它挂载即
// 预热词库分片。lib/dict/lookup.js 自己已经有 typeof fetch 保护，这里再补一道
// 只是让本文件不依赖「别的模块恰好做了那道保护」——补齐 jsdom 缺的浏览器 API
// 是测试隔离的本分，不是针对某个组件的 workaround。
if (typeof global.fetch !== "function") {
  global.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });
}

let TIER = "pro";
jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
  getSavedTier: jest.fn(() => TIER),
}));

jest.mock("../lib/sessionStore", () => ({
  loadHist: jest.fn(() => ({ sessions: [] })),
  deleteSession: jest.fn(() => ({ sessions: [] })),
  clearAllSessions: jest.fn(() => ({ sessions: [] })),
  setCurrentUser: jest.fn(),
  SESSION_STORE_EVENTS: { HISTORY_UPDATED_EVENT: "toefl-history-updated" },
}));

const callAI = jest.fn(async () => "这是 AI 讲解：被动语态要求过去分词。");
jest.mock("../lib/ai/client", () => ({
  callAI: (...args) => callAI(...args),
}));

import { CTWDetail } from "../components/reading/ReadingProgressView";
import { locateBlankSentence } from "../components/reading/useCtwAiExplain";

//  词索引： 0     1    2     3      4  5      6       7     8    9 10    11 12   13   14      15  16    17      18
const PASSAGE =
  "Early pots were shaped by hand. Potters later used a wheel to make them faster. The wheel changed everything.";

const B_SHAPED = { position: 3, original_word: "shaped", displayed_fragment: "sha", sentence_index: 0, word_index_in_sentence: 3 };
const B_WHEEL = { position: 10, original_word: "wheel", displayed_fragment: "whe", sentence_index: 1, word_index_in_sentence: 4 };
const B_CHANGED = { position: 17, original_word: "changed", displayed_fragment: "cha", sentence_index: 2, word_index_in_sentence: 2 };

// 与 CTWTask.js handleSubmit 同形：userAnswer 只是缺失部分（不含前缀），fullWord = 前缀 + 输入。
function liveSession() {
  return {
    id: 55,
    type: "reading",
    mode: "standard",
    date: "2026-09-10T10:00:00.000Z",
    details: {
      subtype: "ctw",
      itemId: "ctw-live-1",
      topic: "Pottery",
      passage: PASSAGE,
      blanks: [B_SHAPED, B_WHEEL, B_CHANGED],
      results: [
        { blank: B_SHAPED, userAnswer: "ping", fullWord: "shaping", isCorrect: false },
        { blank: B_WHEEL, userAnswer: "el", fullWord: "wheel", isCorrect: true },
        { blank: B_CHANGED, userAnswer: "", fullWord: "cha", isCorrect: false },
      ],
    },
  };
}

// 真题库（data/realBank/reading/ctw.json）的 blank 只有 position / original_word /
// displayed_fragment / hidden_length —— 缺 sentence_index 也必须能展开。
function realBankSession() {
  const blank = { position: 3, original_word: "shaped", displayed_fragment: "sha", hidden_length: 3 };
  return {
    id: 101,
    type: "reading",
    mode: "standard",
    date: "2026-09-11T10:00:00.000Z",
    details: {
      subtype: "ctw",
      itemId: "real_ctw_121a_1_11",
      passage: PASSAGE,
      blanks: [blank],
      results: [{ blank, userAnswer: "ping", fullWord: "shaping", isCorrect: false }],
    },
  };
}

// 老记录：results[i] 没内嵌 blank，也没 fullWord/userAnswer —— 走 blanks[i] 兜底。
function legacySession() {
  return {
    id: 7,
    type: "reading",
    date: "2026-05-01T10:00:00.000Z",
    details: {
      subtype: "ctw",
      itemId: "ctw-legacy",
      passage: PASSAGE,
      blanks: [B_SHAPED],
      results: [{ isCorrect: false }],
    },
  };
}

function wrongChips() {
  return screen.getAllByRole("button").filter((b) => b.getAttribute("aria-expanded") !== null);
}

beforeEach(() => {
  TIER = "pro";
  callAI.mockClear();
  try { localStorage.clear(); } catch {}
});

describe("locateBlankSentence", () => {
  test("按 position 定位到所在句，目标词用【】标出", () => {
    const loc = locateBlankSentence(PASSAGE, 3);
    expect(loc.sentence).toBe("Early pots were shaped by hand.");
    expect(loc.targetIndexInSentence).toBe(3);
    expect(loc.words[loc.targetIndexInSentence]).toBe("shaped");
    expect(loc.marked).toBe("Early pots were 【shaped】 by hand.");
  });

  test("首句第一个词", () => {
    const loc = locateBlankSentence(PASSAGE, 0);
    expect(loc.sentence).toBe("Early pots were shaped by hand.");
    expect(loc.targetIndexInSentence).toBe(0);
  });

  test("末句（passage 末尾没有后续句子）", () => {
    const loc = locateBlankSentence(PASSAGE, 17);
    expect(loc.sentence).toBe("The wheel changed everything.");
    expect(loc.targetIndexInSentence).toBe(2);
    expect(loc.marked).toBe("The wheel 【changed】 everything.");
  });

  test("中间句不会串到相邻句", () => {
    const loc = locateBlankSentence(PASSAGE, 10);
    expect(loc.sentence).toBe("Potters later used a wheel to make them faster.");
    expect(loc.targetIndexInSentence).toBe(4);
  });

  test("句末标点后带引号 / 括号也算句界", () => {
    const p = 'Early pots were shaped." Potters used a wheel.';
    const loc = locateBlankSentence(p, 5);
    expect(loc.sentence).toBe("Potters used a wheel.");
    expect(loc.targetIndexInSentence).toBe(1);
  });

  test("整段没有句末标点 → 整段当一句", () => {
    const loc = locateBlankSentence("one two three", 1);
    expect(loc.sentence).toBe("one two three");
    expect(loc.targetIndexInSentence).toBe(1);
  });

  test("position 越界 / 非法 → 安全空值，不抛错", () => {
    expect(() => locateBlankSentence(PASSAGE, 999)).not.toThrow();
    expect(locateBlankSentence(PASSAGE, 999).sentence).toBe("");
    expect(locateBlankSentence(PASSAGE, -1).sentence).toBe("");
    expect(locateBlankSentence(PASSAGE, "abc").sentence).toBe("");
    expect(locateBlankSentence(PASSAGE, undefined).sentence).toBe("");
    expect(locateBlankSentence(PASSAGE, 1.5).sentence).toBe("");
  });

  test("空 / 缺失 passage → 安全空值，不抛错", () => {
    expect(() => locateBlankSentence(undefined, 0)).not.toThrow();
    expect(locateBlankSentence(undefined, 0).sentence).toBe("");
    expect(locateBlankSentence("", 0).sentence).toBe("");
    expect(locateBlankSentence("   ", 0).sentence).toBe("");
    expect(locateBlankSentence(null, 3).words).toEqual([]);
  });
});

describe("CTWDetail 错项展开面板", () => {
  test("点错项 chip → 面板给出「你填的」与正确答案，以及所在句子", () => {
    render(<CTWDetail session={liveSession()} />);
    expect(screen.queryByTestId("ctw-blank-panel")).not.toBeInTheDocument();

    fireEvent.click(wrongChips()[0]);

    const panel = screen.getByTestId("ctw-blank-panel");
    expect(within(panel).getByText("第 1 空")).toBeInTheDocument();
    // 学生的完整词（前缀 + 输入）—— 这是原来 chip 上看不到的信息
    expect(within(panel).getByText("shaping")).toBeInTheDocument();
    // 正确答案（面板里出现两次：对照行 + 句中高亮）
    expect(within(panel).getAllByText("shaped").length).toBeGreaterThan(0);
    // 所在句子的其它词也在，且没有串到下一句
    expect(within(panel).getByText(/Early/)).toBeInTheDocument();
    expect(panel.textContent).toContain("hand.");
    expect(panel.textContent).not.toContain("Potters");
  });

  test("同一时刻只展开一个：点另一个错项会换面板", () => {
    render(<CTWDetail session={liveSession()} />);
    fireEvent.click(wrongChips()[0]);
    expect(screen.getByTestId("ctw-blank-panel").textContent).toContain("第 1 空");
    fireEvent.click(wrongChips()[1]);
    const panels = screen.getAllByTestId("ctw-blank-panel");
    expect(panels).toHaveLength(1);
    expect(panels[0].textContent).toContain("第 3 空");
  });

  test("未作答（userAnswer 为空串）→ 面板显示「未作答」", () => {
    render(<CTWDetail session={liveSession()} />);
    fireEvent.click(wrongChips()[1]); // 第 3 空，userAnswer: ""
    const panel = screen.getByTestId("ctw-blank-panel");
    expect(within(panel).getByText("未作答")).toBeInTheDocument();
    expect(within(panel).getAllByText("changed").length).toBeGreaterThan(0);
  });

  test("再点同一个 chip → 收起", () => {
    render(<CTWDetail session={liveSession()} />);
    const chip = wrongChips()[0];
    fireEvent.click(chip);
    expect(screen.getByTestId("ctw-blank-panel")).toBeInTheDocument();
    fireEvent.click(wrongChips()[0]);
    expect(screen.queryByTestId("ctw-blank-panel")).not.toBeInTheDocument();
  });

  test("正确的 chip 不是 button、点了也不展开", () => {
    render(<CTWDetail session={liveSession()} />);
    // 3 个空里只有 2 个错项 → 只有 2 个可点 chip
    expect(wrongChips()).toHaveLength(2);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    // 正确项（wheel，missing = "el"）落在一个 div 上
    const correctMissing = screen.getByText("el");
    expect(correctMissing.closest("button")).toBeNull();
    fireEvent.click(correctMissing);
    expect(screen.queryByTestId("ctw-blank-panel")).not.toBeInTheDocument();
  });

  test("真题记录（blank 只有 position/original_word/displayed_fragment/hidden_length）也能展开", () => {
    render(<CTWDetail session={realBankSession()} />);
    fireEvent.click(wrongChips()[0]);
    const panel = screen.getByTestId("ctw-blank-panel");
    expect(within(panel).getByText("shaping")).toBeInTheDocument();
    expect(within(panel).getAllByText("shaped").length).toBeGreaterThan(0);
    expect(panel.textContent).toContain("Early pots were");
  });

  test("老记录（results 没内嵌 blank / 没 fullWord）走 blanks[i] 兜底，不崩", () => {
    render(<CTWDetail session={legacySession()} />);
    fireEvent.click(wrongChips()[0]);
    const panel = screen.getByTestId("ctw-blank-panel");
    expect(within(panel).getByText("未作答")).toBeInTheDocument();
    expect(within(panel).getAllByText("shaped").length).toBeGreaterThan(0);
  });
});

describe("CTWDetail 面板里的 AI 解析", () => {
  test("非 Pro：面板照样展开（纯本地数据），但没有 AI 解析按钮", () => {
    TIER = "free";
    render(<CTWDetail session={liveSession()} />);
    fireEvent.click(wrongChips()[0]);
    const panel = screen.getByTestId("ctw-blank-panel");
    expect(within(panel).getByText("shaping")).toBeInTheDocument();
    expect(within(panel).queryByText(/AI 深入解析/)).not.toBeInTheDocument();
    expect(within(panel).queryAllByRole("button")).toHaveLength(0);
    expect(callAI).not.toHaveBeenCalled();
  });

  test("Pro：展开不自动调 API；点 AI 按钮才调，message 带正确答案 + 学生答案 + 所在句子", async () => {
    render(<CTWDetail session={liveSession()} />);
    fireEvent.click(wrongChips()[0]);
    const panel = screen.getByTestId("ctw-blank-panel");
    // 展开本身零成本
    expect(callAI).not.toHaveBeenCalled();

    fireEvent.click(within(panel).getByRole("button", { name: /AI 深入解析/ }));
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));

    const [system, message, maxTokens, timeoutMs, temperature] = callAI.mock.calls[0];
    expect(system).toContain("C-test");
    expect(message).toContain("正确答案：shaped");
    expect(message).toContain("学生填写：shaping");
    expect(message).toContain("已给出的字母：sha");
    expect(message).toContain("该空所在句子：Early pots were 【shaped】 by hand.");
    expect(message).toContain("第 1 个空（共 3 个）");
    expect(message).toContain(PASSAGE);
    expect([maxTokens, timeoutMs, temperature]).toEqual([700, 60000, 0.3]);

    expect(await screen.findByText(/被动语态要求过去分词/)).toBeInTheDocument();
  });

  test("Pro + 未作答：message 写「未作答」", async () => {
    render(<CTWDetail session={liveSession()} />);
    fireEvent.click(wrongChips()[1]);
    fireEvent.click(screen.getByRole("button", { name: /AI 深入解析/ }));
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    expect(callAI.mock.calls[0][1]).toContain("学生填写：未作答");
    expect(callAI.mock.calls[0][1]).toContain("正确答案：changed");
  });

  test("解析结果进 localStorage 缓存，重新展开时自动回填且不再计费", async () => {
    const { unmount } = render(<CTWDetail session={liveSession()} />);
    fireEvent.click(wrongChips()[0]);
    fireEvent.click(screen.getByRole("button", { name: /AI 深入解析/ }));
    expect(await screen.findByText(/被动语态要求过去分词/)).toBeInTheDocument();
    expect(callAI).toHaveBeenCalledTimes(1);
    unmount();

    render(<CTWDetail session={liveSession()} />);
    fireEvent.click(wrongChips()[0]);
    expect(await screen.findByText(/被动语态要求过去分词/)).toBeInTheDocument();
    expect(callAI).toHaveBeenCalledTimes(1); // 缓存命中，没有二次计费
  });
});
