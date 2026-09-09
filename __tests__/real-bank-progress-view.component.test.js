/**
 * components/realBank/RealBankProgressView.js —— 真题练习记录页。
 * 结构对齐分科历史页的模考记录范式（侧栏最新一次 + 列表 → 右栏完整回顾）。
 * 锁：①只显示真题记录（常规练习 / 模考不混入）；②点一条 → 右栏切成逐题回顾（复用各科
 * 历史页的 CTWDetail 等渲染，内容必须真的出来）；③返回 / 删除 / 空态。
 */
import { render, screen, fireEvent, within } from "@testing-library/react";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
  getSavedTier: jest.fn(() => "pro"),
}));

const deleteSession = jest.fn(() => ({ sessions: [] }));
let SESSIONS = [];
jest.mock("../lib/sessionStore", () => ({
  loadHist: jest.fn(() => ({ sessions: SESSIONS })),
  deleteSession: (...args) => deleteSession(...args),
  clearAllSessions: jest.fn(() => ({ sessions: [] })),
  setCurrentUser: jest.fn(),
  SESSION_STORE_EVENTS: { HISTORY_UPDATED_EVENT: "toefl-history-updated" },
}));

import { RealBankProgressView } from "../components/realBank/RealBankProgressView";

// 与 app/real-bank/page.js 的 saveRealReadingSession 同形（band 档位、details 字段名一个不改）。
const realCtw = {
  id: 101, type: "reading", mode: "standard", date: "2026-09-02T10:00:00.000Z", correct: 1, total: 2, band: 3.5,
  details: {
    subtype: "ctw", itemId: "real_ctw_test_1", topic: "Campus housing notice",
    passage: "The dorm will close early this winter.",
    blanks: [
      { position: 1, original_word: "dorm", displayed_fragment: "do" },
      { position: 4, original_word: "early", displayed_fragment: "ea" },
    ],
    results: [{ isCorrect: true }, { isCorrect: false }],
  },
};
const liveCtw = {
  id: 102, type: "reading", mode: "standard", date: "2026-09-02T11:00:00.000Z", correct: 2, total: 2,
  details: { subtype: "ctw", itemId: "ctw-live-9", topic: "LIVE ONLY TOPIC", passage: "x", blanks: [], results: [] },
};
const realLcr = {
  id: 103, type: "listening", mode: "practice", date: "2026-09-03T10:00:00.000Z", correct: 0, total: 1, band: 2,
  details: {
    subtype: "lcr", itemIds: ["real_lcr_test_1"], real: true,
    results: [{ itemId: "real_lcr_test_1", selected: "A", correct: "C", isCorrect: false }],
    items: [{ id: "real_lcr_test_1", speaker: "Could you review my essay before Friday?", options: { A: "I left.", B: "Rain.", C: "Sure, send it over.", D: "Closed." }, answer: "C", explanation: "Option C directly responds." }],
  },
};
const realDiscussion = {
  id: 104, type: "discussion", mode: "standard", date: "2026-09-05T10:00:00.000Z", score: 4, band: "B2",
  details: { promptId: "real_ad_test_1", promptSummary: "Should universities require internships?", promptData: { id: "real_ad_test_1", tier: "recalled" }, userText: "I believe internships matter.", feedback: null },
};
const writingMock = { id: 105, type: "mock", date: "2026-09-07T10:00:00.000Z", band: 4.5, details: { mockSessionId: "m1", tasks: [] } };
const readingMock = { id: 106, type: "reading", mode: "mock", date: "2026-09-07T11:00:00.000Z", correct: 20, total: 35, details: { subtype: "mock", m1: {}, m2: {} } };

beforeEach(() => {
  deleteSession.mockClear();
  SESSIONS = [realCtw, liveCtw, realLcr, realDiscussion, writingMock, readingMock];
});

describe("RealBankProgressView", () => {
  test("只列真题记录：3 条真题在列，常规练习与模考不混入", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const rows = screen.getAllByTestId("real-entry-row");
    expect(rows).toHaveLength(3);
    expect(screen.queryByText(/LIVE ONLY TOPIC/)).not.toBeInTheDocument();
    // 题型标签 + 来源分档 + 得分 都在行上
    expect(screen.getAllByText("阅读填词真题").length).toBeGreaterThan(0);
    expect(screen.getAllByText("学术讨论真题").length).toBeGreaterThan(0);
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("0/1")).toBeInTheDocument();
    // 侧栏：最近一次 = 最新的讨论题；题库覆盖卡在
    expect(within(screen.getByTestId("real-latest-card")).getByText(/学术讨论真题/)).toBeInTheDocument();
    expect(screen.getByTestId("real-coverage-card")).toBeInTheDocument();
    // 四科统计卡（写作 1 / 阅读 1 / 听力 1 / 口语 0）—— 科目名在覆盖卡里也出现，用 getAll
    ["写作", "阅读", "听力", "口语"].forEach((label) => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
    expect(screen.getByText("得分率 80%")).toBeInTheDocument();
  });

  test("点一条阅读记录 → 右栏切成逐题回顾（复用 CTWDetail，原文与填空结果真的渲染出来），返回后回到列表", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    expect(screen.queryByTestId("real-session-detail")).not.toBeInTheDocument();
    expect(screen.queryByText(/The dorm will close/)).not.toBeInTheDocument();

    const ctwRow = screen.getAllByTestId("real-entry-row").find((r) => r.textContent.includes("阅读填词真题"));
    fireEvent.click(ctwRow);

    const detail = screen.getByTestId("real-session-detail");
    expect(detail).toBeInTheDocument();
    // CTWDetail 把原文按词渲染并给挖空词上色 —— 挖空词以独立节点出现
    expect(within(detail).getAllByText("dorm").length).toBeGreaterThan(0);
    expect(within(detail).getByText(/填空结果/)).toBeInTheDocument();
    // 头部：再练入口指回真题专区同题型
    expect(within(detail).getByRole("link", { name: "再练一套" }).getAttribute("href")).toBe("/real-bank?type=ctw");
    // 列表已被回顾替换
    expect(screen.queryAllByTestId("real-entry-row")).toHaveLength(0);

    fireEvent.click(within(detail).getByRole("button", { name: /返回列表/ }));
    expect(screen.queryByTestId("real-session-detail")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("real-entry-row")).toHaveLength(3);
  });

  test("听力真题回顾复用 LCRDetail：读 details.items 的题干 / 选项 / 解析", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const row = screen.getAllByTestId("real-entry-row").find((r) => r.textContent.includes("听力应答真题"));
    fireEvent.click(row);
    const detail = screen.getByTestId("real-session-detail");
    // 题干在头部副标题与正文各出现一次
    expect(within(detail).getAllByText(/Could you review my essay/).length).toBeGreaterThan(0);
    expect(within(detail).getByText(/Sure, send it over\./)).toBeInTheDocument();
    expect(within(detail).getByText(/Option C directly responds/)).toBeInTheDocument();
    // practice 档在头部有档位 chip；再练入口把档位带回去
    expect(within(detail).getByText("练习模式")).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "再练一套" }).getAttribute("href")).toBe("/real-bank?type=lcr&mode=practice");
  });

  test("写作真题回顾走 HistoryRow（作答文本 + 题目摘要）", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const row = screen.getAllByTestId("real-entry-row").find((r) => r.textContent.includes("学术讨论真题"));
    fireEvent.click(row);
    const detail = screen.getByTestId("real-session-detail");
    expect(within(detail).getByText(/I believe internships matter/)).toBeInTheDocument();
    expect(within(detail).getAllByText(/Should universities require internships/).length).toBeGreaterThan(0);
    expect(within(detail).getByText("4/5")).toBeInTheDocument();
  });

  test("行上的删除按 sourceIndex（云端 id）调 deleteSession", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const row = screen.getAllByTestId("real-entry-row").find((r) => r.textContent.includes("阅读填词真题"));
    fireEvent.click(within(row).getByLabelText("删除记录"));
    expect(deleteSession).toHaveBeenCalledWith(101);
    // 删除不该顺带打开回顾
    expect(screen.queryByTestId("real-session-detail")).not.toBeInTheDocument();
  });

  test("没有真题记录：空态 + 去真题专区入口（即使有常规练习 / 模考记录）", () => {
    SESSIONS = [liveCtw, writingMock, readingMock];
    render(<RealBankProgressView onBack={() => {}} />);
    expect(screen.getByText("还没有真题练习记录")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去真题专区" }).getAttribute("href")).toBe("/?section=real-bank");
    expect(screen.queryAllByTestId("real-entry-row")).toHaveLength(0);
  });

  test("顶栏返回调 onBack", () => {
    const onBack = jest.fn();
    render(<RealBankProgressView onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(onBack).toHaveBeenCalled();
  });
});
