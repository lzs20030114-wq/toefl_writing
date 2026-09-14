/**
 * 听力题的 AI 讲解（LCR 应答 / LA-LAT 通知讲座 / LC 对话）。
 *
 * 锁的是五件事：
 *   ① 四个入口都有：听力练习历史 LCRDetail / LADetail / LCDetail（/listening/progress、
 *      /real-bank/progress、听力模考详情共用这一组），以及 ListeningMCQTask 与
 *      LCRTask 交卷后的结果页；只给答错的题，Pro 专属，点了才计费；
 *   ② 应答题（lcr）必须走语用那支：整道题只有说话人一句话，没有「原文定位」可讲，
 *      system prompt 与 message 都不能用讲座那套话术；
 *   ③ 讲座 / 对话题走定位那支，原文要真的喂进去（对话没存 transcript 时按 turns 拼）；
 *   ④ 讲座原文不许被截断：LAT 原文 1080–1893 字符，错题本那侧 1500 的上限会砍掉大半；
 *   ⑤ 未作答时写「未作答」，不假装学生选了什么。
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

// AudioPlayer 会碰 <audio> / TTS，jsdom 里不需要真播；换成占位。
jest.mock("../components/listening/AudioPlayer", () => ({
  AudioPlayer: () => null,
  default: () => null,
}));

const callAI = jest.fn(async () => "这是 AI 讲解：说话人在婉拒邀约。");
jest.mock("../lib/ai/client", () => ({
  ...jest.requireActual("../lib/ai/client"),
  callAI: (...args) => callAI(...args),
}));

import { AI_HELPER_MAX_TOKENS } from "../lib/ai/client";
import { LCRDetail, LADetail, LCDetail } from "../components/listening/ListeningProgressView";
import { ListeningMCQTask } from "../components/listening/ListeningMCQTask";
import {
  buildListeningExplainMessage,
  conversationText,
  isRespondKind,
} from "../components/listening/useListeningAiExplain";

const TRANSCRIPT =
  "Today we'll look at how coral reefs record climate. The skeleton grows in annual bands, " +
  "and the thickness of each band tracks the water temperature of that year.";

const LA_QUESTION = {
  stem: "What does the professor say the band thickness indicates?",
  options: {
    A: "The age of the colony",
    B: "The water temperature that year",
    C: "The depth of the reef",
    D: "The number of species present",
  },
  answer: "B",
  explanation: "讲座末句说厚度追踪当年水温。",
};

const LCR_ITEM = {
  id: "lcr-7",
  speaker: "I'd love to join you for dinner, but I've got a paper due tomorrow.",
  situation: "Two classmates talking after class",
  pragmatic_function: "polite refusal with a reason",
  options: {
    A: "Great, see you at seven then.",
    B: "That's too bad — maybe next week?",
    C: "I didn't know you liked cooking.",
    D: "You should hand it in tomorrow.",
  },
  answer: "B",
  explanation: "对方婉拒并给了理由，合适的回应是表示遗憾并另约时间。",
};

function aiButtons() {
  return screen.queryAllByRole("button", { name: /AI 深入解析/ });
}

beforeEach(() => {
  TIER = "pro";
  callAI.mockClear();
  localStorage.clear();
});

describe("LCRDetail（应答题练习历史 / 真题记录）", () => {
  const session = (over = {}) => ({
    id: 11,
    type: "listening",
    date: "2026-09-13T10:00:00.000Z",
    details: {
      subtype: "lcr",
      items: [LCR_ITEM, { ...LCR_ITEM, id: "lcr-8" }],
      results: [
        { selected: "C", correct: "B", isCorrect: false },
        { selected: "B", correct: "B", isCorrect: true },
      ],
      ...over,
    },
  });

  test("只给答错的题放 AI 按钮", () => {
    render(<LCRDetail session={session()} />);
    expect(aiButtons()).toHaveLength(1);
  });

  test("非 Pro：没有按钮也不计费", () => {
    TIER = "free";
    render(<LCRDetail session={session()} />);
    expect(aiButtons()).toHaveLength(0);
    expect(callAI).not.toHaveBeenCalled();
  });

  test("点了才调；走应答题那支 —— message 带说话人原话与语用功能，system 讲应答不讲定位", async () => {
    render(<LCRDetail session={session()} />);
    expect(callAI).not.toHaveBeenCalled();

    fireEvent.click(aiButtons()[0]);
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));

    const [system, message, maxTokens, timeoutMs, temperature] = callAI.mock.calls[0];
    expect(system).toContain("应答");
    expect(system).toContain("不要使用 markdown");
    // 应答题没有「原文第几段」可定位，不能套阅读/讲座那套话术
    expect(system).not.toContain("哪一句给出了正确答案");
    expect(message).toContain(`说话人说：${LCR_ITEM.speaker}`);
    expect(message).toContain("该句的语用功能：polite refusal with a reason");
    expect(message).toContain("学生选的回应：C. I didn't know you liked cooking.");
    expect(message).toContain("正确回应：B. That's too bad — maybe next week?");
    expect([maxTokens, timeoutMs, temperature]).toEqual([AI_HELPER_MAX_TOKENS, 60000, 0.3]);

    expect(await screen.findByText(/婉拒邀约/)).toBeInTheDocument();
  });

  test("缓存复用：重新挂载自动回填且不再计费", async () => {
    const { unmount } = render(<LCRDetail session={session()} />);
    fireEvent.click(aiButtons()[0]);
    expect(await screen.findByText(/婉拒邀约/)).toBeInTheDocument();
    expect(callAI).toHaveBeenCalledTimes(1);
    unmount();

    render(<LCRDetail session={session()} />);
    expect(await screen.findByText(/婉拒邀约/)).toBeInTheDocument();
    expect(callAI).toHaveBeenCalledTimes(1);
  });
});

describe("LADetail（通知 / 讲座练习历史）", () => {
  const session = (over = {}) => ({
    id: 12,
    type: "listening",
    date: "2026-09-13T10:00:00.000Z",
    details: {
      subtype: "lat",
      itemIds: ["lat-3"],
      transcript: TRANSCRIPT,
      questions: [LA_QUESTION],
      results: [{ selected: "A", correct: "B", isCorrect: false }],
      ...over,
    },
  });

  test("答错的题有按钮；message 带讲座原文 + 题干 + 选项原文，走定位那支", async () => {
    render(<LADetail session={session()} />);
    fireEvent.click(aiButtons()[0]);
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));

    const [system, message] = callAI.mock.calls[0];
    expect(system).toContain("听力");
    expect(system).toContain("定位");
    expect(message).toContain(TRANSCRIPT);
    expect(message).toContain(LA_QUESTION.stem);
    expect(message).toContain("学生选择：A. The age of the colony");
    expect(message).toContain("正确答案：B. The water temperature that year");
  });

  test("答对的题不放按钮", () => {
    render(<LADetail session={session({ results: [{ selected: "B", correct: "B", isCorrect: true }] })} />);
    expect(aiButtons()).toHaveLength(0);
  });

  test("未作答：写「未作答」", async () => {
    render(<LADetail session={session({ results: [{ selected: null, correct: "B", isCorrect: false }] })} />);
    fireEvent.click(aiButtons()[0]);
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    expect(callAI.mock.calls[0][1]).toContain("学生选择：未作答");
  });

  test("老记录没存题面（stem 与 options 都空）时不放按钮 —— 讲不了就不放", () => {
    render(<LADetail session={session({ questions: [], results: [{ selected: "A", correct: "B", isCorrect: false }] })} />);
    expect(aiButtons()).toHaveLength(0);
  });
});

describe("LCDetail（对话练习历史）", () => {
  const CONVO = [
    { speaker: "Student", text: "Do you know when the library closes tonight?" },
    { speaker: "Clerk", text: "It closes at ten, but the study rooms stay open until midnight." },
  ];
  const Q = {
    stem: "What does the clerk say about the study rooms?",
    options: { A: "They close at ten", B: "They stay open later", C: "They are being renovated", D: "They need a reservation" },
    answer: "B",
  };

  test("没存 transcript 时按对话 turns 拼出原文喂进去", async () => {
    render(
      <LCDetail
        session={{
          id: 13,
          type: "listening",
          date: "2026-09-13T10:00:00.000Z",
          details: {
            subtype: "lc",
            itemIds: ["lc-2"],
            conversation: CONVO,
            questions: [Q],
            results: [{ selected: "A", correct: "B", isCorrect: false }],
          },
        }}
      />
    );
    fireEvent.click(aiButtons()[0]);
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    const message = callAI.mock.calls[0][1];
    expect(message).toContain("Student: Do you know when the library closes tonight?");
    expect(message).toContain("Clerk: It closes at ten, but the study rooms stay open until midnight.");
    expect(message).toContain("学生选择：A. They close at ten");
  });
});

describe("ListeningMCQTask 交卷后的结果页", () => {
  const item = {
    id: "lat-task-1",
    transcript: TRANSCRIPT,
    questions: [LA_QUESTION],
  };

  function answerWrong() {
    render(
      <ListeningMCQTask
        item={item}
        taskType="lat"
        onComplete={() => {}}
        onExit={() => {}}
        isPractice
        title="Academic Talk"
      />
    );
    // listen → answer：AudioPlayer 被 mock 掉了，不会触发 onEnded，用「听完了」按钮推进
    const advance = screen.queryByRole("button", { name: /ready to answer|开始答题|跳过|继续/i });
    if (advance) fireEvent.click(advance);
    fireEvent.click(screen.getByText(LA_QUESTION.options.A));
    fireEvent.click(screen.getByRole("button", { name: /提交|交卷|Submit/ }));
  }

  test("交卷后答错的题有 AI 按钮；点了才计费，message 带讲座原文", async () => {
    answerWrong();
    expect(aiButtons()).toHaveLength(1);
    expect(callAI).not.toHaveBeenCalled();

    fireEvent.click(aiButtons()[0]);
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    const message = callAI.mock.calls[0][1];
    expect(message).toContain(TRANSCRIPT);
    expect(message).toContain("学生选择：A. The age of the colony");
  });
});

describe("buildListeningExplainMessage / 纯函数", () => {
  test("isRespondKind 只认 lcr", () => {
    expect(isRespondKind("lcr")).toBe(true);
    expect(isRespondKind("LCR")).toBe(true);
    expect(isRespondKind("lat")).toBe(false);
    expect(isRespondKind(undefined)).toBe(false);
  });

  test("conversationText：缺 speaker 时按 A/B 交替兜底，空 turn 不占行", () => {
    expect(conversationText([{ text: "Hi" }, { text: "Hello" }, { text: "" }])).toBe(
      "Speaker A: Hi\nSpeaker B: Hello"
    );
    expect(conversationText("已经是字符串")).toBe("已经是字符串");
    expect(conversationText(null)).toBe("");
  });

  test("LAT 长度的原文（~1800 字符）整篇喂进去，不砍尾段", () => {
    // 错题本那侧 1500 的上限会砍掉 91/149 篇生成库 LAT 与 42/74 篇真题 LAT 的后半段。
    const tail = "The decisive clue sits in this final sentence.";
    const long = "A".repeat(1800) + " " + tail;
    const message = buildListeningExplainMessage({
      subtype: "lat",
      stem: LA_QUESTION.stem,
      contextText: long,
      options: LA_QUESTION.options,
      selected: "A",
      correct: "B",
      isCorrect: false,
    });
    expect(message).toContain(tail);
    expect(message).not.toContain("...");
  });

  test("应答题没给语用功能时不写那一行（不让模型猜字段）", () => {
    const message = buildListeningExplainMessage({
      subtype: "lcr",
      speaker: LCR_ITEM.speaker,
      options: LCR_ITEM.options,
      selected: "C",
      correct: "B",
      isCorrect: false,
    });
    expect(message).not.toContain("语用功能");
    expect(message).toContain("说话人说：");
  });

  test("应答题未作答：写「未作答」", () => {
    const message = buildListeningExplainMessage({
      subtype: "lcr",
      speaker: LCR_ITEM.speaker,
      options: LCR_ITEM.options,
      selected: null,
      correct: "B",
      isCorrect: false,
    });
    expect(message).toContain("学生选的回应：未作答");
  });
});
