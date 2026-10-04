/**
 * components/realBank/RealBankProgressView.js —— 真题练习记录页（设计稿「真题练习记录 优化版」）。
 * 锁：
 *  ①只显示真题记录（常规练习 / 非真题模考不混入），概览的摘要卡 / 科目条 / 题库覆盖 / 日分组；
 *  ②点一行 = 就地展开「错题速览」，再进入逐题回顾（填词 / 选择题 / 听力应答 / 写作报告 / 真题模考）；
 *  ③详情：编号导航、筛选条、上一条下一条、左栏列表；
 *  ④评分失败的写作记录：「没有评分反馈」+ 重试评分，成功后直接出完整批改报告；
 *  ⑤删除 / 清空 / 空态 / 返回。
 */
import React from "react";
import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
  getSavedTier: jest.fn(() => "pro"),
}));

const deleteSession = jest.fn(() => ({ sessions: [] }));
const patchSession = jest.fn(async () => true);
let SESSIONS = [];
jest.mock("../lib/sessionStore", () => ({
  loadHist: jest.fn(() => ({ sessions: SESSIONS })),
  deleteSession: (...args) => deleteSession(...args),
  patchSession: (...args) => patchSession(...args),
  clearAllSessions: jest.fn(() => ({ sessions: [] })),
  setCurrentUser: jest.fn(),
  SESSION_STORE_EVENTS: { HISTORY_UPDATED_EVENT: "toefl-history-updated" },
}));

const evaluate = jest.fn();
jest.mock("../lib/ai/writingEval", () => ({ evaluateWritingResponse: (...a) => evaluate(...a) }));

import { RealBankProgressView } from "../components/realBank/RealBankProgressView";
import { getRealCTWItems, realTierLabel } from "../lib/realBank";

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
    results: [{ isCorrect: true, userAnswer: "rm", fullWord: "dorm" }, { isCorrect: false, userAnswer: "rly", fullWord: "early" }],
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
// 评分失败（feedback 为空）的讨论题：保存了整道题与作答原文，可重试评分。
const realDiscussion = {
  id: 104, type: "discussion", mode: "standard", date: "2026-09-05T10:00:00.000Z", score: null,
  details: {
    promptId: "real_ad_test_1", promptSummary: "Should universities require internships?",
    promptData: { id: "real_ad_test_1", tier: "recalled", professor: { name: "Dr. Gupta", text: "What is your view on internships?" }, students: [{ name: "Daniel", text: "They help." }] },
    userText: "I believe internships matter.", feedback: null, scoringFailed: true,
  },
};
// 有完整 AI 反馈的邮件真题：回顾必须走 WritingFeedbackPanel（与主练习记录页 / 模考报告同一套）。
const FB = {
  score: 4.5, band: "4.5", summary: "三个目标全部覆盖，语域得体。", goals: [],
  actions: [{ title: "结尾稍显仓促", importance: "缺少明确的收尾请求。", action: "补一句期待回复。" }], patterns: [],
  annotationSegments: [
    { type: "text", text: "Dear Ms. Alvarez, thank you for the " },
    { type: "mark", level: "red", errorType: "grammar", text: "workshop slide", fix: "workshop slides", note: "名词复数。" },
    { type: "text", text: "." },
  ],
  comparison: { modelEssay: "", points: [] },
};
const realEmail = {
  id: 107, type: "email", mode: "standard", date: "2026-09-06T10:00:00.000Z", score: 4.5, band: "4.5",
  details: {
    promptId: "real_em_test_1", promptSummary: "To Ms. Alvarez · Workshop slides", promptData: { id: "real_em_test_1", tier: "official", to: "Ms. Alvarez", subject: "Workshop slides" },
    userText: "Dear Ms. Alvarez, thank you for the workshop slide.", feedback: FB,
  },
};
const writingMock = { id: 105, type: "mock", date: "2026-09-07T10:00:00.000Z", band: 4.5, details: { mockSessionId: "m1", tasks: [] } };
const readingMock = { id: 106, type: "reading", mode: "mock", date: "2026-09-07T11:00:00.000Z", correct: 20, total: 35, details: { subtype: "mock", m1: {}, m2: {} } };
// 真题阅读模考：两个题组（填词 + 日常阅读）。
const realReadingMock = {
  id: 108, type: "mock", mode: "mock", date: "2026-09-08T10:00:00.000Z", score: 3,
  details: {
    real: true, source: "real-bank", realMock: true, subtype: "mock", section: "reading", mockSessionId: "mk1",
    seenItemIds: ["real_ctw_test_1", "real_rdl_test_1"],
    items: [{ id: "real_rdl_test_1", taskType: "rdl", text: "Notice body.", questions: [{ stem: "What is it about?", options: { A: "a", B: "b" }, correct_answer: "A" }] }],
    aggregate: { raw: 2, maxRaw: 3 },
    tasks: [
      { taskType: "ctw", itemId: "real_ctw_test_1", module: 1, correct: 1, total: 2, results: realCtw.details.results, blanks: realCtw.details.blanks, passage: realCtw.details.passage },
      { taskType: "rdl", itemId: "real_rdl_test_1", module: 2, correct: 1, total: 1, results: [{ selected: "A", correct: "A", isCorrect: true }] },
    ],
  },
};

// 超时交卷的真题阅读模考：第 2 组是新版占位（没有题面），第 3 组是修复前的旧记录形状 ——
// 没展示过，却连原文 / 题目 / 答案一起存了下来，只能按 seenItemIds 认出来。
const UNSEEN_SECRET = "SECRET UNSEEN PASSAGE";
const timedOutReadingMock = {
  id: 110, type: "reading", mode: "mock", date: "2026-09-09T10:00:00.000Z",
  details: {
    real: true, source: "real-bank", realMock: true, subtype: "mock", section: "reading", attemptId: "att-timeout",
    seenItemIds: ["real_ctw_test_1"],
    items: [
      { id: "real_ctw_test_1", taskType: "ctw" },
      { id: "real_rdl_test_9", taskType: "rdl", realMockRole: "scored", unreached: true },
      { id: "real_ap_test_9", taskType: "ap", passage: UNSEEN_SECRET, questions: [{ stem: "Why?", correct_answer: "C" }] },
    ],
    scoredCorrect: 1, scoredTotal: 35,
    tasks: [
      { taskType: "ctw", itemId: "real_ctw_test_1", correct: 1, total: 2, results: realCtw.details.results, blanks: realCtw.details.blanks, passage: realCtw.details.passage },
      { taskType: "rdl", itemId: "real_rdl_test_9", realMockRole: "scored", unreached: true, timedOut: true, correct: 0, total: 3, unanswered: 3, results: [] },
      { taskType: "ap", itemId: "real_ap_test_9", timedOut: true, correct: 0, total: 5, passage: UNSEEN_SECRET, topic: "SECRET TOPIC", questions: [{ stem: "Why?", correct_answer: "C" }], results: [] },
    ],
  },
};
// 中途放弃的写作真题模考：造句做到第 2 题（第 3 题新版占位、第 4 题旧形状连答案都存了），邮件 / 讨论没到达。
const abortedWritingMock = {
  id: 111, type: "mock", mode: "mock", date: "2026-09-10T10:00:00.000Z", score: null,
  details: {
    real: true, source: "real-bank", realMock: true, subtype: "mock", section: "writing", mockSessionId: "ms-aborted", aborted: true,
    seenItemIds: ["real_bs_test_1", "real_bs_test_2"],
    items: [{ id: "real_bs_test_1", taskType: "bs" }, { id: "real_em_test_9", taskType: "email", unreached: true }, { id: "real_ad_test_9", taskType: "discussion", unreached: true }],
    tasks: [
      { taskId: "bs", taskType: "bs", title: "Build a Sentence", score: 1, maxScore: 10, itemIds: ["real_bs_test_1", "real_bs_test_2", "real_bs_test_3", "real_bs_test_4"], meta: { details: [
        { qid: "real_bs_test_1", prompt: "Where is it?", userAnswer: "it is here", correctAnswer: "it is here", isCorrect: true },
        { qid: "real_bs_test_2", prompt: "When?", userAnswer: "now it is", correctAnswer: "it is now", isCorrect: false },
        { qid: "real_bs_test_3", unreached: true, isCorrect: false },
        { qid: "real_bs_test_4", prompt: "SECRET BS PROMPT", userAnswer: "(no answer)", correctAnswer: "SECRET BS ANSWER", isCorrect: false },
      ] } },
      { taskId: "email", taskType: "email", score: null, maxScore: 5, itemIds: ["real_em_test_9"], items: [{ id: "real_em_test_9", taskType: "email", unreached: true }], meta: null },
      { taskId: "discussion", taskType: "discussion", score: null, maxScore: 5, itemIds: ["real_ad_test_9"], items: [{ id: "real_ad_test_9", taskType: "discussion", unreached: true }], meta: null },
    ],
  },
};

const rows = () => screen.getAllByTestId("real-entry-row");
const rowOf = (label) => rows().find((r) => r.textContent.includes(label));
function expandRow(label) {
  const row = rowOf(label);
  fireEvent.click(within(row).getAllByRole("button", { expanded: false })[0]);
  return row;
}
function openDetail(label, cta) {
  const row = expandRow(label);
  fireEvent.click(within(row).getByRole("button", { name: cta || /→$/ }));
  return screen.getByTestId("real-session-detail");
}

beforeEach(() => {
  window.scrollTo = jest.fn(); // jsdom 未实现；页面切换会回到顶部
  window.history.replaceState(null, "", "/real-bank/progress");
  deleteSession.mockClear();
  patchSession.mockClear();
  evaluate.mockReset();
  window.innerWidth = 1280;
  SESSIONS = [realCtw, liveCtw, realLcr, realDiscussion, realEmail, writingMock, readingMock];
});

describe("概览", () => {
  test("只列真题记录：4 条真题在列，常规练习与非真题模考不混入", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    expect(rows()).toHaveLength(4);
    expect(screen.queryByText(/LIVE ONLY TOPIC/)).not.toBeInTheDocument();
    expect(screen.getAllByText("阅读填词真题").length).toBeGreaterThan(0);
    expect(screen.getAllByText("学术讨论真题").length).toBeGreaterThan(0);
    // 行上的得分：填词 1/2、听力应答 0/1、邮件 4.5/5、讨论没评分
    expect(within(rowOf("阅读填词真题")).getByText("1/2")).toBeInTheDocument();
    expect(within(rowOf("听力应答真题")).getByText("0/1")).toBeInTheDocument();
    expect(within(rowOf("学术讨论真题")).getByText("未评分")).toBeInTheDocument();
    // 最近一次 = 时间最新的那条（邮件）；题库覆盖条在
    expect(within(screen.getByTestId("real-latest-card")).getByText(/邮件真题/)).toBeInTheDocument();
    expect(screen.getByTestId("real-coverage-card")).toBeInTheDocument();
    // 科目条：全部 4 / 写作 2 / 阅读 1 / 听力 1 / 口语 0
    expect(within(screen.getByTestId("real-subject-all")).getByText("4")).toBeInTheDocument();
    expect(within(screen.getByTestId("real-subject-writing")).getByText("2")).toBeInTheDocument();
    expect(within(screen.getByTestId("real-subject-speaking")).getByText("暂无记录")).toBeInTheDocument();
    // 写作平均：只有邮件有分 = 90；阅读 50
    expect(within(screen.getByTestId("real-subject-writing")).getByText("得分率 90%")).toBeInTheDocument();
    expect(within(screen.getByTestId("real-subject-reading")).getByText("得分率 50%")).toBeInTheDocument();
    // 整体 (50 + 0 + 90) / 3 = 47
    expect(screen.getByText(/平均得分率 47%/)).toBeInTheDocument();
  });

  test("点科目 → 列表只剩该科；再点一次回到全部", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    fireEvent.click(screen.getByTestId("real-subject-reading"));
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("阅读填词真题");
    fireEvent.click(screen.getByTestId("real-subject-reading"));
    expect(rows()).toHaveLength(4);
  });

  test("点一行 = 就地展开错题速览（不进详情）；再点收起", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const row = rowOf("阅读填词真题");
    expect(within(row).queryByText(/错题速览/)).not.toBeInTheDocument();
    fireEvent.click(within(row).getAllByRole("button", { expanded: false })[0]);
    expect(within(row).getByText("错题速览 · 1 题")).toBeInTheDocument();
    expect(within(row).getByText("第 2 空")).toBeInTheDocument();
    expect(within(row).getByText("你填 early · 应为 early")).toBeInTheDocument();
    expect(screen.queryByTestId("real-session-detail")).not.toBeInTheDocument();
    fireEvent.click(within(row).getAllByRole("button", { expanded: true })[0]);
    expect(within(row).queryByText(/错题速览/)).not.toBeInTheDocument();
  });

  test("日分组标题可折叠", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const group = screen.getAllByRole("button", { expanded: true }).find((b) => /\d 次/.test(b.textContent) && !b.closest("[data-testid=real-entry-row]"));
    fireEvent.click(group);
    expect(screen.queryAllByTestId("real-entry-row").length).toBeLessThan(4);
  });

  test("题库覆盖条可展开按题型看进度", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const toggle = within(screen.getByTestId("real-coverage-card")).getByRole("button", { name: /题库覆盖/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByTestId("real-coverage-card")).getAllByText(/填词|日常/).length).toBeGreaterThan(0);
  });
});

describe("详情：逐题回顾", () => {
  test("阅读填词：展开速览 → 逐题回顾，原文里的空 / 卡片 / 导航都在；返回列表回到概览", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    expect(screen.queryByTestId("real-session-detail")).not.toBeInTheDocument();
    const detail = openDetail("阅读填词真题", /逐题回顾 →/);
    // 默认展开第一个错的空（第 2 空）：你填的 / 正确答案
    const panel = within(detail.closest("main")).getByTestId("ctw-blank-panel");
    expect(within(panel).getByText("第 2 空")).toBeInTheDocument();
    expect(panel).toHaveTextContent("你填的 early");
    expect(panel).toHaveTextContent("正确答案 early");
    // 原文挖空词以独立节点出现；legend 与筛选条
    expect(within(detail.closest("main")).getAllByText(/^do$/).length).toBeGreaterThan(0);
    expect(within(detail.closest("main")).getByText(/点原文里的空或下方卡片查看解析/)).toBeInTheDocument();
    // 头部：再练入口指回真题专区同题型
    expect(within(detail).getByRole("link", { name: "再练一套" }).getAttribute("href")).toBe("/real-bank?type=ctw");
    // 导航：答对 1 · 答错 1，两个编号
    const nav = within(detail).getByTestId("real-unit-nav");
    expect(within(nav).getByText("答对 1 · 答错 1")).toBeInTheDocument();
    // 列表已被回顾替换
    expect(screen.queryAllByTestId("real-entry-row")).toHaveLength(0);
    fireEvent.click(within(detail).getByRole("button", { name: /返回列表/ }));
    expect(screen.queryByTestId("real-session-detail")).not.toBeInTheDocument();
    expect(rows()).toHaveLength(4);
  });

  test("速览里点某一项：直接进详情并展开那一题", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const row = expandRow("阅读填词真题");
    fireEvent.click(within(row).getByText("第 2 空").closest("button"));
    const detail = screen.getByTestId("real-session-detail");
    expect(within(detail.closest("main")).getByTestId("ctw-blank-panel")).toBeInTheDocument();
  });

  test("编号导航：点编号展开对应的空；筛选「答对」只留对的；全部收起", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const detail = openDetail("阅读填词真题", /逐题回顾 →/);
    const main = detail.closest("main");
    const nav = within(detail).getByTestId("real-unit-nav");
    fireEvent.click(within(nav).getByRole("button", { name: "1" }));
    expect(within(main).getAllByTestId("ctw-blank-panel")).toHaveLength(2);
    fireEvent.click(within(main).getByRole("button", { name: "全部收起" }));
    expect(within(main).queryByTestId("ctw-blank-panel")).not.toBeInTheDocument();
    fireEvent.click(within(main).getByRole("tab", { name: /答对/ }));
    expect(within(main).queryByText(/第 2 空/)).not.toBeInTheDocument();
    fireEvent.click(within(main).getByRole("tab", { name: /错题/ }));
    expect(within(main).getAllByRole("button", { expanded: false }).length).toBeGreaterThan(0);
  });

  test("听力应答：题干 / 选项 / 解析来自 details.items；档位 chip 与再练链接带模式", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const detail = openDetail("听力应答真题", /逐题回顾 →/);
    const main = detail.closest("main");
    expect(within(main).getAllByText(/Could you review my essay/).length).toBeGreaterThan(0);
    expect(within(main).getByText(/Sure, send it over\./)).toBeInTheDocument();
    expect(within(main).getByText(/Option C directly responds/)).toBeInTheDocument();
    expect(within(main).getByText("你的选择")).toBeInTheDocument();
    expect(within(main).getByText("正确答案")).toBeInTheDocument();
    expect(within(detail).getByText("练习模式")).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "再练一套" }).getAttribute("href")).toBe("/real-bank?type=lcr&mode=practice");
  });

  test("主从布局：宽屏有左栏列表，点另一条直接切换；上一条 / 下一条也可切；窄屏没有左栏", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const detail = openDetail("阅读填词真题", /逐题回顾 →/);
    const rail = screen.getByTestId("real-rail");
    expect(within(rail).getAllByRole("button").length).toBeGreaterThanOrEqual(5); // 收起键 + 4 条
    fireEvent.click(within(rail).getByTitle("听力应答真题"));
    expect(within(screen.getByTestId("real-session-detail")).getByText("听力应答真题", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /下一条/ }));
    expect(screen.getByTestId("real-session-detail")).toBeInTheDocument();
    // 左栏收起 / 展开
    fireEvent.click(within(rail).getByRole("button", { name: "收起列表" }));
    expect(within(rail).getByRole("button", { name: "展开列表" })).toBeInTheDocument();
    expect(detail).toBeDefined();
    act(() => { window.innerWidth = 900; window.dispatchEvent(new Event("resize")); });
    expect(screen.queryByTestId("real-rail")).not.toBeInTheDocument();
  });
});

describe("写作", () => {
  test("有 AI 反馈：回顾走 WritingFeedbackPanel（三标签报告），编号导航定位到批注，返回回到概览", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const detail = openDetail("邮件真题", /查看批改报告 →/);
    const main = detail.closest("main");
    const report = within(main).getByTestId("real-writing-report");
    expect(within(report).getByTestId("score-panel")).toBeInTheDocument();
    expect(within(report).getByText("宏观评价与建议")).toBeInTheDocument();
    expect(within(report).getByText("逐句批注大纲")).toBeInTheDocument();
    expect(within(report).getByText("范文对比分析")).toBeInTheDocument();
    expect(within(report).getByText("结尾稍显仓促")).toBeInTheDocument();
    expect(within(report).getByRole("button", { name: "再练一遍" })).toBeInTheDocument();
    // 头部导航统计 + 编号
    const nav = within(detail).getByTestId("real-unit-nav");
    expect(within(nav).getByText(/AI 评分 4.5\/5 · 换算 5.5\/6 · 1 处批注/)).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole("button", { name: "1" }));
    expect(within(report).getByText("共发现", { exact: false })).toBeInTheDocument();
    fireEvent.click(within(report).getByRole("button", { name: "返回" }));
    expect(screen.queryByTestId("real-session-detail")).not.toBeInTheDocument();
  });

  test("评分失败：横幅 + 题目 + 作答原文；概览速览里也有重试评分", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const row = expandRow("学术讨论真题");
    expect(within(row).getByText("批改状态")).toBeInTheDocument();
    expect(within(row).getByText(/AI 评分未完成，作答原文已保存/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /重试评分/ })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: /查看作答 →/ }));
    const detail = screen.getByTestId("real-session-detail");
    const main = detail.closest("main");
    expect(within(main).getByTestId("real-unscored-banner")).toHaveTextContent("没有评分反馈");
    expect(within(main).getByTestId("real-unscored-text")).toHaveTextContent("I believe internships matter.");
    expect(within(main).getByText(/Dr\. Gupta/)).toBeInTheDocument();
    expect(within(detail).getByText("未评分")).toBeInTheDocument();
  });

  test("重试评分成功：按存下的题与作答重评，回写记录，页面直接变成完整批改报告", async () => {
    evaluate.mockResolvedValue({ ...FB, score: 4 });
    render(<RealBankProgressView onBack={() => {}} />);
    const row = expandRow("学术讨论真题");
    fireEvent.click(within(row).getByRole("button", { name: /查看作答 →/ }));
    const main = screen.getByTestId("real-session-detail").closest("main");
    fireEvent.click(within(main).getByRole("button", { name: "重试评分" }));
    expect(within(main).getByTestId("real-unscored-banner")).toHaveTextContent("正在重新评分");
    await waitFor(() => expect(within(main).getByTestId("real-writing-report")).toBeInTheDocument());
    expect(evaluate).toHaveBeenCalledWith("discussion", realDiscussion.details.promptData, "I believe internships matter.", "zh");
    expect(patchSession).toHaveBeenCalledTimes(1);
    expect(patchSession.mock.calls[0][0]).toBe(104);
    expect(within(main).getByTestId("score-panel")).toBeInTheDocument();
    expect(within(screen.getByTestId("real-session-detail")).getByText("4/5")).toBeInTheDocument();
  });

  test("开发态 StrictMode（挂载→卸载→再挂载）下重试评分也能走完，不会卡在「评分中…」", async () => {
    evaluate.mockResolvedValue({ ...FB, score: 4 });
    render(<React.StrictMode><RealBankProgressView onBack={() => {}} /></React.StrictMode>);
    const row = expandRow("学术讨论真题");
    fireEvent.click(within(row).getByRole("button", { name: /重试评分/ }));
    await waitFor(() => expect(within(row).queryByRole("button", { name: /评分中/ })).not.toBeInTheDocument());
    expect(within(row).getByText("4/5")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("重新评分完成：4/5");
  });

  test("概览里重试评分失败：行内给出中文原因，按钮变「再试一次」", async () => {
    evaluate.mockRejectedValue(new Error("API timeout"));
    render(<RealBankProgressView onBack={() => {}} />);
    const row = expandRow("学术讨论真题");
    fireEvent.click(within(row).getByRole("button", { name: /重试评分/ }));
    await waitFor(() => expect(within(row).getByRole("alert")).toHaveTextContent("重新评分失败：AI 响应超时，请重试"));
    expect(within(row).getByRole("button", { name: "再试一次" })).toBeInTheDocument();
  });

  test("重试评分失败：中文原因 + 再试一次，作答原文仍在", async () => {
    evaluate.mockRejectedValue(new Error("API timeout"));
    render(<RealBankProgressView onBack={() => {}} />);
    const row = expandRow("学术讨论真题");
    fireEvent.click(within(row).getByRole("button", { name: /查看作答 →/ }));
    const main = screen.getByTestId("real-session-detail").closest("main");
    fireEvent.click(within(main).getByRole("button", { name: "重试评分" }));
    await waitFor(() => expect(within(main).getByTestId("real-unscored-banner")).toHaveTextContent("重新评分失败"));
    expect(within(main).getByTestId("real-unscored-banner")).toHaveTextContent("AI 响应超时，请重试");
    expect(within(main).getByRole("button", { name: "再试一次" })).toBeInTheDocument();
    expect(within(main).getByTestId("real-unscored-text")).toHaveTextContent("I believe internships matter.");
    expect(patchSession).not.toHaveBeenCalled();
  });
});

describe("真题模考", () => {
  beforeEach(() => { SESSIONS = [realReadingMock, realCtw]; });

  test("题组列表 → 点进某一组 = 同一套详情（面包屑返回题组列表）", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const row = expandRow("阅读真题模考");
    expect(within(row).getByText(/题组得分 · 共 2 组/)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: /查看模考报告 →/ }));
    const detail = screen.getByTestId("real-session-detail");
    const main = detail.closest("main");
    const list = within(main).getByTestId("real-mock-review");
    expect(within(list).getAllByText(/逐题回顾 →/)).toHaveLength(2);
    expect(within(detail).getByText(/原始分 2\/3 · 2 个题组/)).toBeInTheDocument();
    // 进第 1 组（填词）：面包屑 + M1 + 填词回顾
    fireEvent.click(within(list).getAllByRole("button", { name: /逐题回顾 →/ })[0]);
    expect(within(detail).getByText(/第 1 题组 · 填词/)).toBeInTheDocument();
    expect(within(detail).getByText("M1")).toBeInTheDocument();
    expect(within(main).getByTestId("ctw-blank-panel")).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: /‹ 阅读真题模考/ }));
    expect(within(main).getByTestId("real-mock-review")).toBeInTheDocument();
  });

  test("超时没到达的题组：只列题型、不露题面 / 话题 / 答案，点不进去；编号导航也锁住", () => {
    SESSIONS = [timedOutReadingMock];
    render(<RealBankProgressView onBack={() => {}} />);
    const row = expandRow("阅读真题模考");
    expect(within(row).getByText(/题组得分 · 共 3 组/)).toBeInTheDocument();
    expect(row.textContent).not.toContain("SECRET");
    fireEvent.click(within(row).getByRole("button", { name: /查看模考报告 →/ }));
    const detail = screen.getByTestId("real-session-detail");
    const main = detail.closest("main");
    const list = within(main).getByTestId("real-mock-review");
    expect(within(list).getAllByText(/逐题回顾 →/)).toHaveLength(1);
    const unreached = within(list).getAllByTestId("real-mock-unreached");
    expect(unreached).toHaveLength(2);
    unreached.forEach((el) => {
      expect(el).toHaveTextContent("超时未到达 · 未展示题目");
      expect(el).not.toHaveTextContent(/逐题回顾|real_/);
      expect(el.tagName).not.toBe("BUTTON");
    });
    expect(within(unreached[0]).getByText("0/3")).toBeInTheDocument();
    expect(main.textContent).not.toContain("SECRET");
    expect(within(detail).getByText(/原始分 1\/35 · 3 个题组 · 2 组未到达/)).toBeInTheDocument();
    // 编号导航：第 2、3 组锁住，点了也不进去
    const nav = within(detail).getByTestId("real-unit-nav");
    expect(within(nav).getByRole("button", { name: "2" })).toBeDisabled();
    expect(within(nav).getByRole("button", { name: "3" })).toBeDisabled();
    fireEvent.click(unreached[1]);
    fireEvent.click(within(nav).getByRole("button", { name: "3" }));
    expect(within(detail).queryByText(/第 3 题组/)).not.toBeInTheDocument();
    expect(within(main).getByTestId("real-mock-review")).toBeInTheDocument();
    // 到达的那组照常进
    fireEvent.click(within(list).getByRole("button", { name: /逐题回顾 →/ }));
    expect(within(main).getByTestId("ctw-blank-panel")).toBeInTheDocument();
  });

  test("速览里点没到达的题组：进详情但停在题组列表", () => {
    SESSIONS = [timedOutReadingMock];
    render(<RealBankProgressView onBack={() => {}} />);
    const row = expandRow("阅读真题模考");
    fireEvent.click(within(row).getByText("第 2 题组").closest("button"));
    const detail = screen.getByTestId("real-session-detail");
    expect(within(detail.closest("main")).getByTestId("real-mock-review")).toBeInTheDocument();
    expect(within(detail).queryByText(/第 2 题组 ·/)).not.toBeInTheDocument();
  });

  test("中止的写作模考：得分「已中止」；造句里没展示的题只显示「第 N 题 · 未到达」，不露题面与答案", () => {
    SESSIONS = [abortedWritingMock];
    render(<RealBankProgressView onBack={() => {}} />);
    expect(within(rowOf("写作真题模考")).getByText("已中止")).toBeInTheDocument();
    const row = expandRow("写作真题模考");
    fireEvent.click(within(row).getByRole("button", { name: /查看模考报告 →/ }));
    const detail = screen.getByTestId("real-session-detail");
    const main = detail.closest("main");
    const list = within(main).getByTestId("real-mock-review");
    const unreached = within(list).getAllByTestId("real-mock-unreached");
    expect(unreached).toHaveLength(2);
    unreached.forEach((el) => expect(el).toHaveTextContent("中止前未到达 · 未展示题目"));
    expect(within(detail).getByText(/^已中止 · 3 个题组 · 2 组未到达$/)).toBeInTheDocument();
    expect(within(main).getByText(/本卷中途已中止，不计分/)).toBeInTheDocument();

    fireEvent.click(within(list).getByRole("button", { name: /逐题回顾 →/ }));
    expect(within(detail).getByText(/第 1 题组 · 造句/)).toBeInTheDocument();
    expect(within(detail).getByText("答对 1 · 答错 1 · 未到达 2")).toBeInTheDocument();
    const stubs = within(main).getAllByTestId("bs-unreached");
    expect(stubs.map((el) => el.textContent)).toEqual([expect.stringContaining("第 3 题 · 未到达"), expect.stringContaining("第 4 题 · 未到达")]);
    stubs.forEach((el) => expect(within(el).queryByRole("button")).not.toBeInTheDocument());
    expect(main.textContent).not.toContain("SECRET");
    // 到达的题照常：题面 + 可展开对比
    expect(within(main).getByText("When?")).toBeInTheDocument();
  });

  test("整卷模考不挂单题的来源分档 / 考试日期（那只是看到的第一道题的）", () => {
    const item = getRealCTWItems().find((it) => it.date && it.tier === "official") || getRealCTWItems().find((it) => it.date && it.tier);
    expect(item).toBeTruthy();
    SESSIONS = [{ ...realReadingMock, details: { ...realReadingMock.details, seenItemIds: [item.id, "real_rdl_test_1"] } }];
    render(<RealBankProgressView onBack={() => {}} />);
    const row = rowOf("阅读真题模考");
    expect(within(row).queryByText(realTierLabel(item.tier))).not.toBeInTheDocument();
    expect(row.textContent).not.toContain("考试 ");
    expect(within(screen.getByTestId("real-latest-card")).queryByText(realTierLabel(item.tier))).not.toBeInTheDocument();
    const detail = openDetail("阅读真题模考", /查看模考报告 →/);
    expect(detail.textContent).not.toContain("考试日期");
    expect(within(detail).queryByText(realTierLabel(item.tier))).not.toBeInTheDocument();
  });
});

describe("从模考结果页跳来（?mock=<记录 date>）", () => {
  test("直接打开那条真题模考，并把参数从地址栏去掉（其余参数保留）", () => {
    SESSIONS = [realReadingMock, timedOutReadingMock, realCtw];
    window.history.replaceState(null, "", `/real-bank/progress?from=result&mock=${encodeURIComponent(timedOutReadingMock.date)}`);
    render(<RealBankProgressView onBack={() => {}} />);
    const detail = screen.getByTestId("real-session-detail");
    expect(within(detail.closest("main")).getAllByTestId("real-mock-unreached")).toHaveLength(2);
    expect(window.location.search).toBe("?from=result");
    expect(screen.getByTestId("real-rail")).toBeInTheDocument();
  });

  test("记录还在云端同步：等历史到了再打开（只消费一次）", () => {
    SESSIONS = [];
    window.history.replaceState(null, "", `/real-bank/progress?mock=${encodeURIComponent(realReadingMock.date)}`);
    render(<RealBankProgressView onBack={() => {}} />);
    expect(screen.getByText("还没有真题练习记录")).toBeInTheDocument();
    expect(window.location.search).toContain("mock=");
    SESSIONS = [realReadingMock, realCtw];
    act(() => { window.dispatchEvent(new CustomEvent("toefl-history-updated")); });
    const detail = screen.getByTestId("real-session-detail");
    expect(within(detail.closest("main")).getByTestId("real-mock-review")).toBeInTheDocument();
    expect(window.location.search).toBe("");
    // 回到列表后，历史再刷新也不会被拉回去
    fireEvent.click(within(detail).getByRole("button", { name: /返回列表/ }));
    act(() => { window.dispatchEvent(new CustomEvent("toefl-history-updated")); });
    expect(screen.queryByTestId("real-session-detail")).not.toBeInTheDocument();
  });

  test("云端同步回来的日期写法不同（+00:00 而不是 Z）也能对上", () => {
    // 结果页带的是本地保存时的 toISOString()；记录被云端同步替换后，timestamptz 回来是 "+00:00" 写法。
    SESSIONS = [{ ...timedOutReadingMock, date: "2026-09-09T10:00:00+00:00" }, realCtw];
    window.history.replaceState(null, "", `/real-bank/progress?mock=${encodeURIComponent("2026-09-09T10:00:00.000Z")}`);
    render(<RealBankProgressView onBack={() => {}} />);
    expect(screen.getByTestId("real-session-detail")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  test("找不到那条记录：留在概览并提示，不去开别的模考", () => {
    SESSIONS = [realReadingMock, realCtw];
    window.history.replaceState(null, "", `/real-bank/progress?mock=${encodeURIComponent("2026-01-01T00:00:00.000Z")}`);
    render(<RealBankProgressView onBack={() => {}} />);
    expect(screen.queryByTestId("real-session-detail")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("没找到这次模考的记录");
    expect(window.location.search).toBe("");
  });

  test("只认真题模考记录：同一时刻的单题记录不会被当成模考打开", () => {
    SESSIONS = [realCtw];
    window.history.replaceState(null, "", `/real-bank/progress?mock=${encodeURIComponent(realCtw.date)}`);
    render(<RealBankProgressView onBack={() => {}} />);
    expect(screen.queryByTestId("real-session-detail")).not.toBeInTheDocument();
  });
});

describe("删除 / 清空 / 空态", () => {
  test("展开行里的「删除记录」要二次确认，按 sourceIndex（云端 id）调 deleteSession，且不顺带打开回顾", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const row = expandRow("阅读填词真题");
    fireEvent.click(within(row).getByRole("button", { name: "删除记录" }));
    expect(deleteSession).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole("button", { name: "确认删除" }));
    expect(deleteSession).toHaveBeenCalledWith(101);
    expect(screen.queryByTestId("real-session-detail")).not.toBeInTheDocument();
  });

  test("详情头部的删除：确认后删除并回到概览", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    const detail = openDetail("阅读填词真题", /逐题回顾 →/);
    fireEvent.click(within(detail).getByRole("button", { name: "删除" }));
    fireEvent.click(within(detail).getByRole("button", { name: "确认删除" }));
    expect(deleteSession).toHaveBeenCalledWith(101);
    expect(screen.queryByTestId("real-session-detail")).not.toBeInTheDocument();
  });

  test("清空全部真题记录：二次确认，从后往前逐条删（本地存储按下标删，顺序错了会删错）", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "清空全部真题记录" }));
    expect(deleteSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    const order = deleteSession.mock.calls.map((c) => c[0]);
    expect(order).toHaveLength(4);
    expect(order).toEqual([...order].sort((a, b) => b - a));
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
