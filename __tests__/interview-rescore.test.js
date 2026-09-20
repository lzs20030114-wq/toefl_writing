/**
 * 面试评分的「补分」路径（2026-09-20 事故的用户侧）。
 *
 * 事故形态：DeepSeek 变慢时，面试每题各自一次评分全部等到超时；用户看到的是
 * 「评分超时，请检查网络后重试」，而且那条练习记录里那几题永远没有分——除非
 * 把整道题重录一遍。转写一直都在，这不合理。
 *
 * 锁的是：
 *   ① 失败报告带 retryable，且文案不许出现「网络」（真因与用户网络无关）；
 *   ② 成功的评分写进本地补分缓存——交卷只等 60 秒，晚到的那份靠它回到记录里；
 *   ③ rescoreInterview 命中缓存就不再调用 AI（不重复计费）；
 *   ④ 练习记录页：缺分且有转写的那题给「重新评分」，点完显示分数；
 *   ⑤ 没有有效语音那种失败不给重试入口（重算多少次都一样）。
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
  getSavedTier: jest.fn(() => "pro"),
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

const callAIMulti = jest.fn();
jest.mock("../lib/ai/client", () => ({
  ...jest.requireActual("../lib/ai/client"),
  callAIMulti: (...args) => callAIMulti(...args),
}));

import { scoreInterview, rescoreInterview } from "../lib/speakingEval/interviewScorer";
import {
  readCachedInterviewScore,
  writeCachedInterviewScore,
} from "../lib/speakingEval/interviewScoreCache";
import { InterviewDetail } from "../components/speaking/SpeakingProgressView";

const QUESTION = "Do you prefer studying alone or with a group? Explain why.";
const TRANSCRIPT =
  "I prefer studying with a group because last week my classmate explained the statistics "
  + "homework to me in ten minutes and I had been stuck on it for two hours by myself.";

function goodRaw(score = 4) {
  return JSON.stringify({
    overall: score,
    on_topic: true,
    dimensions: {
      fluency: { score, feedback: "节奏稳" },
      intelligibility: { score, feedback: "清楚" },
      language: { score, feedback: "用词到位" },
      organization: { score, feedback: "结构清晰" },
    },
    summary: "回答完整，有具体例子。",
    suggestions: ["再加一个对比"],
  });
}

const queuedError = () => Object.assign(new Error("API error 504"), {
  status: 504,
  code: "UPSTREAM_TIMEOUT",
});

beforeEach(() => {
  callAIMulti.mockReset();
  try { localStorage.clear(); } catch { /* jsdom 之外无所谓 */ }
});

describe("失败报告", () => {
  test("上游排队 → 可重试，且文案不提网络", async () => {
    callAIMulti.mockRejectedValue(queuedError());

    const res = await scoreInterview({ question: QUESTION, transcript: TRANSCRIPT });

    expect(res.error).toBe(true);
    expect(res.retryable).toBe(true);
    expect(res.summary).toContain("排队");
    expect(res.summary).not.toContain("网络");
    expect(res.summary).toContain("重新评分");
  });

  test("没有有效语音 → 不给重试入口（重算也救不回来）", async () => {
    const res = await scoreInterview({ question: QUESTION, transcript: "uh" });

    expect(res.error).toBe(true);
    expect(res.retryable).toBe(false);
    expect(callAIMulti).not.toHaveBeenCalled();
  });

  test("主动中止（交卷掐断在途评分）不算故障报错", async () => {
    const controller = new AbortController();
    callAIMulti.mockImplementation(async () => {
      controller.abort();
      throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    });

    const res = await scoreInterview({
      question: QUESTION,
      transcript: TRANSCRIPT,
      signal: controller.signal,
    });

    expect(res.error).toBe(true);
    expect(res.retryable).toBe(true);
    expect(res.summary).toContain("取消");
  });
});

describe("本地补分缓存", () => {
  test("成功的评分自动入缓存，键是题目 + 转写", async () => {
    callAIMulti.mockResolvedValue([goodRaw(4), goodRaw(4), goodRaw(4)]);

    // 分值以实际报告为准：护栏层（词数/跑题/复读）会在模型分之上再压，
    // 写死一个数字只会把这条测试绑死在护栏参数上。
    const scored = await scoreInterview({ question: QUESTION, transcript: TRANSCRIPT });

    const cached = readCachedInterviewScore({ question: QUESTION, transcript: TRANSCRIPT });
    expect(cached).toBeTruthy();
    expect(cached.score).toBe(scored.score);
    // 换一题（同样的转写）不该命中
    expect(readCachedInterviewScore({ question: "another question", transcript: TRANSCRIPT })).toBeNull();
  });

  test("失败报告不入缓存，否则一次失败会被永久钉在那一题上", async () => {
    callAIMulti.mockRejectedValue(queuedError());

    await scoreInterview({ question: QUESTION, transcript: TRANSCRIPT });

    expect(readCachedInterviewScore({ question: QUESTION, transcript: TRANSCRIPT })).toBeNull();
  });

  test("写入失败报告的直接调用也被挡住", () => {
    writeCachedInterviewScore({ question: QUESTION, transcript: TRANSCRIPT }, { error: true, score: 0 });
    expect(readCachedInterviewScore({ question: QUESTION, transcript: TRANSCRIPT })).toBeNull();
  });
});

describe("rescoreInterview", () => {
  test("命中缓存就不再调用 AI（不重复计费）", async () => {
    callAIMulti.mockResolvedValue([goodRaw(5), goodRaw(5), goodRaw(5)]);
    const first = await scoreInterview({ question: QUESTION, transcript: TRANSCRIPT });
    expect(callAIMulti).toHaveBeenCalledTimes(1);

    const again = await rescoreInterview({ question: QUESTION, transcript: TRANSCRIPT });

    expect(again.score).toBe(first.score);
    expect(callAIMulti).toHaveBeenCalledTimes(1); // 没有第二次
  });

  test("没缓存才真的算一次", async () => {
    callAIMulti.mockResolvedValue([goodRaw(3), goodRaw(3), goodRaw(3)]);

    const res = await rescoreInterview({ question: QUESTION, transcript: TRANSCRIPT });

    expect(res.error).toBeUndefined();
    expect(callAIMulti).toHaveBeenCalledTimes(1);
  });
});

describe("练习记录页的补分入口", () => {
  function sessionWith(aiScore, transcript = TRANSCRIPT) {
    return {
      type: "speaking",
      date: new Date().toISOString(),
      details: {
        mode: "practice",
        total: 1,
        attempted: 1,
        items: [{
          id: "q1",
          question: QUESTION,
          category: "personal",
          recorded: true,
          transcript,
          aiScore,
        }],
      },
    };
  }

  test("评分失败的那题给「重新评分」，点完显示分数", async () => {
    callAIMulti.mockResolvedValue([goodRaw(4), goodRaw(4), goodRaw(4)]);
    const failed = {
      error: true,
      retryable: true,
      score: 0,
      summary: "AI 正在排队，这一题没能及时出分。",
      dimensions: {},
    };

    render(<InterviewDetail session={sessionWith(failed)} />);

    fireEvent.click(screen.getByTestId("interview-rescore-history"));

    // 分数徽章出现（具体分值由护栏决定，这里只认「拿到分了」），入口随之消失。
    await waitFor(() => expect(screen.getAllByText(/\/5$/).length).toBeGreaterThan(0));
    expect(screen.queryByTestId("interview-rescore-history")).not.toBeInTheDocument();
  });

  test("交卷后才回来的那份分数（记录里是 null）靠缓存直接补上，不用点也不计费", async () => {
    callAIMulti.mockResolvedValue([goodRaw(5), goodRaw(5), goodRaw(5)]);
    await scoreInterview({ question: QUESTION, transcript: TRANSCRIPT });
    callAIMulti.mockClear();

    render(<InterviewDetail session={sessionWith(null)} />);

    // 记录里这题是 null，缓存命中后分数徽章才会出现 —— 它就是「补上了」的证据。
    await waitFor(() => expect(screen.getAllByText(/\/5$/).length).toBeGreaterThan(0));
    expect(callAIMulti).not.toHaveBeenCalled();
    expect(screen.queryByTestId("interview-rescore-history")).not.toBeInTheDocument();
  });

  test("没有转写的那题不给重试入口（没东西可评）", () => {
    render(<InterviewDetail session={sessionWith(null, "")} />);
    expect(screen.queryByTestId("interview-rescore-history")).not.toBeInTheDocument();
  });

  test("retryable=false 的失败同样不给入口", () => {
    const hopeless = { error: true, retryable: false, score: 0, summary: "未检测到有效语音输入。", dimensions: {} };
    render(<InterviewDetail session={sessionWith(hopeless)} />);
    expect(screen.queryByTestId("interview-rescore-history")).not.toBeInTheDocument();
  });

  test("已经有分的题不显示重试入口", () => {
    const good = { score: 4, summary: "不错", dimensions: {}, suggestions: [] };
    render(<InterviewDetail session={sessionWith(good)} />);
    expect(screen.queryByTestId("interview-rescore-history")).not.toBeInTheDocument();
  });
});
