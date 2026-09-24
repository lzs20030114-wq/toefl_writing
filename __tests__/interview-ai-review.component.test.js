/**
 * 模拟面试练习记录的「AI 整场分析」块（components/speaking/useInterviewAiReview.js）。
 *
 * 锁的是：
 *   ① 挂在练习记录 InterviewDetail（/speaking/progress 与 /real-bank/progress 共用）；
 *      Pro 专属；点了才计费（初次渲染不发请求）；
 *   ② 发给 /api/ai 的 system 是整场诊断那份、message 里真的带了每题转写；
 *   ③ 报告按段渲染：总体判断 / 问题（含维度 chip + 怎么改）/ 改写示范 / 下次练习 / 只盯一件事；
 *   ④ 缓存：同一场第二次打开自动回填，不再调用 AI；
 *   ⑤ 没有任何有效转写的记录不渲染这块（没得分析就不给按钮）；
 *   ⑥ 模型没按 JSON 出 → 「格式异常」文案 + 重试按钮，不把 e.message 原样吐给用户。
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

jest.mock("../components/listening/AudioPlayer", () => ({
  AudioPlayer: () => null,
  default: () => null,
}));

const REPORT = {
  overview: "整体在 3 到 3.5 档之间，两题之间波动大，最拖分的是展开不够。",
  strengths: [{ point: "Q1 给了具体例子", evidence: 'Q1: "looked at the syllabus for five minutes"' }],
  issues: [
    {
      dimension: "elaboration",
      title: "理由停在 fun 这一层，没有细节",
      evidence: 'Q2: "because it is fun"',
      why: "没有支撑的理由撑不到 3 分以上",
      fix: "把 fun 换成一个具体场景：上周和谁在哪吃、聊了什么。",
    },
  ],
  patterns: ["每题都用 I think 开头"],
  rewrite: { question: 2, improved: "Honestly, I usually decide based on how much time I have between classes.", changes: "开头直接答『怎么决定』。" },
  nextSteps: ["第一句直接给答案", "每题一个带时间地点的例子", "结尾一句回扣问题"],
  focus: "下次只盯一件事：每题必须有一个具体例子。",
};

const callAI = jest.fn(async () => JSON.stringify(REPORT));
jest.mock("../lib/ai/client", () => ({
  ...jest.requireActual("../lib/ai/client"),
  callAI: (...args) => callAI(...args),
}));

import { InterviewDetail } from "../components/speaking/SpeakingProgressView";
import { INTERVIEW_REVIEW_MAX_TOKENS } from "../lib/ai/prompts/interviewReview";

const T1 = "Um, I think I make decisions pretty quickly, like when I chose my history class I looked at the syllabus for five minutes.";
const T2 = "I like to eat lunch with my friends because it is fun.";

function session(over = {}) {
  return {
    id: 7,
    type: "speaking",
    date: "2026-09-18T10:00:00.000Z",
    mode: "practice",
    details: {
      subtype: "interview",
      topic: "Campus life",
      averageScore: 3.5,
      attempted: 2,
      total: 2,
      totalElapsed: 95,
      items: [
        {
          id: "q1",
          question: "Do you make decisions quickly or slowly?",
          category: "Decision-making",
          recorded: true,
          transcript: T1,
          aiScore: { score: 4, onTopic: true, summary: "切题。", dimensions: { fluency: { score: 4 }, intelligibility: { score: 4 }, language: { score: 3.5 }, organization: { score: 4 } } },
        },
        {
          id: "q2",
          question: "How do you decide what to eat for lunch?",
          category: "Daily life",
          recorded: true,
          transcript: T2,
          aiScore: { score: 3, onTopic: true, summary: "展开不足。", dimensions: { fluency: { score: 3 }, intelligibility: { score: 3.5 }, language: { score: 3 }, organization: { score: 3 } } },
        },
      ],
      ...over,
    },
  };
}

function startButton() {
  return screen.queryByRole("button", { name: /开始分析/ });
}

beforeEach(() => {
  TIER = "pro";
  callAI.mockClear();
  callAI.mockImplementation(async () => JSON.stringify(REPORT));
  localStorage.clear();
});

describe("InterviewDetail 里的 AI 整场分析", () => {
  it("Pro 看得到入口，初次渲染不发请求", () => {
    render(<InterviewDetail session={session()} />);
    expect(screen.getByText("AI 整场分析")).toBeInTheDocument();
    expect(startButton()).toBeInTheDocument();
    expect(callAI).not.toHaveBeenCalled();
    expect(screen.queryByTestId("interview-ai-review")).toBeNull();
  });

  it("非 Pro 不渲染这块", () => {
    TIER = "free";
    render(<InterviewDetail session={session()} />);
    expect(screen.queryByText("AI 整场分析")).toBeNull();
    expect(startButton()).toBeNull();
  });

  it("没有任何有效转写的记录不渲染这块", () => {
    render(
      <InterviewDetail
        session={session({
          items: [
            { id: "q1", question: "Q?", recorded: false, transcript: null, aiScore: null },
            { id: "q2", question: "Q?", recorded: true, transcript: "uh", aiScore: null },
          ],
        })}
      />,
    );
    expect(screen.queryByText("AI 整场分析")).toBeNull();
  });

  it("点击后用整场 prompt 调 AI，报告按段渲染", async () => {
    render(<InterviewDetail session={session()} />);
    fireEvent.click(startButton());
    expect(screen.getByRole("button", { name: /分析中/ })).toBeDisabled();

    await waitFor(() => expect(screen.getByTestId("interview-ai-review")).toBeInTheDocument());
    expect(callAI).toHaveBeenCalledTimes(1);
    const [system, message, maxTokens] = callAI.mock.calls[0];
    expect(system).toMatch(/Take an Interview/);
    expect(system).toMatch(/不是重新打分/);
    expect(message).toContain(T1);
    expect(message).toContain(T2);
    expect(message).toMatch(/Q2[\s\S]*机器评分：3\/5/);
    expect(message).toMatch(/话题：Campus life/);
    expect(maxTokens).toBe(INTERVIEW_REVIEW_MAX_TOKENS);

    // 段落
    expect(screen.getByText("总体判断")).toBeInTheDocument();
    expect(screen.getByText(REPORT.overview)).toBeInTheDocument();
    expect(screen.getByText("Q1 给了具体例子")).toBeInTheDocument();
    expect(screen.getByText("理由停在 fun 这一层，没有细节")).toBeInTheDocument();
    expect(screen.getByText("展开")).toBeInTheDocument(); // 维度 chip
    expect(screen.getByText(/怎么改/)).toBeInTheDocument();
    expect(screen.getByText(/上周和谁在哪吃/)).toBeInTheDocument();
    expect(screen.getByText("每题都用 I think 开头")).toBeInTheDocument();
    expect(screen.getByText("Q2 改写示范")).toBeInTheDocument();
    expect(screen.getByText(REPORT.rewrite.improved)).toBeInTheDocument();
    expect(screen.getByText("第一句直接给答案")).toBeInTheDocument();
    expect(screen.getByText(REPORT.focus)).toBeInTheDocument();
    // 出了报告后按钮收起
    expect(startButton()).toBeNull();
  });

  it("同一场第二次打开自动回填缓存，不再调 AI", async () => {
    const { unmount } = render(<InterviewDetail session={session()} />);
    fireEvent.click(startButton());
    await waitFor(() => expect(screen.getByTestId("interview-ai-review")).toBeInTheDocument());
    unmount();

    render(<InterviewDetail session={session({ averageScore: 3.5 })} />);
    await waitFor(() => expect(screen.getByTestId("interview-ai-review")).toBeInTheDocument());
    expect(callAI).toHaveBeenCalledTimes(1);
  });

  it("转写不同的另一场不会命中上一场的缓存", async () => {
    const { unmount } = render(<InterviewDetail session={session()} />);
    fireEvent.click(startButton());
    await waitFor(() => expect(screen.getByTestId("interview-ai-review")).toBeInTheDocument());
    unmount();

    const other = session();
    other.details.items[1] = { ...other.details.items[1], transcript: T2 + " We usually go to the cafeteria near the library." };
    render(<InterviewDetail session={other} />);
    expect(screen.queryByTestId("interview-ai-review")).toBeNull();
    expect(startButton()).toBeInTheDocument();
  });

  it("模型没按 JSON 出 → 格式异常文案 + 重试，不吐 e.message", async () => {
    callAI.mockImplementationOnce(async () => "抱歉，我无法完成分析。");
    render(<InterviewDetail session={session()} />);
    fireEvent.click(startButton());
    await waitFor(() => expect(screen.getByText("AI 返回格式异常，请重试")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
    expect(screen.queryByText(/No JSON/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    await waitFor(() => expect(screen.getByTestId("interview-ai-review")).toBeInTheDocument());
    expect(callAI).toHaveBeenCalledTimes(2);
  });

  it("额度 / 网络类错误走统一文案", async () => {
    callAI.mockImplementationOnce(async () => {
      const err = new Error("API error 429");
      err.status = 429;
      err.code = "DAILY_LIMIT";
      throw err;
    });
    render(<InterviewDetail session={session()} />);
    fireEvent.click(startButton());
    await waitFor(() => expect(screen.getByText(/今日免费次数已用完/)).toBeInTheDocument());
  });
});
