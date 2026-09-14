/**
 * 阅读选择题（RDL / AP，含真题选句题）的 AI 讲解。
 *
 * 锁的是四件事：
 *   ① 三个入口都有：练习历史 RDLDetail（/progress/reading 与 /real-bank/progress 共用）、
 *      RDLTask 交卷后的逐题复盘；只给答错的题，Pro 专属，点了才计费；
 *   ② 选句题的作答值是 S1..Sn 句子键 —— message 里必须换成句子原文，
 *      否则模型看到「学生选择：S3」无从下手（这是选句题讲解唯一的前提）；
 *   ③ 原文不许被截断：AP 原文中位数 1289–1434 字符，旧版 1200 的上限会砍掉
 *      绝大多数 AP 的尾段，而答案句经常就在后半篇；
 *   ④ 未作答时 message 写「未作答」，不假装学生选了什么。
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// jsdom 不带 fetch；历史页渲染原文会过划词词典层（挂载即预热词库分片）。
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

const callAI = jest.fn(async () => "这是 AI 讲解：答案句在第二段末尾。");
jest.mock("../lib/ai/client", () => ({
  ...jest.requireActual("../lib/ai/client"),
  callAI: (...args) => callAI(...args),
}));

import { AI_HELPER_MAX_TOKENS } from "../lib/ai/client";
import { RDLDetail } from "../components/reading/ReadingProgressView";
import { RDLTask } from "../components/reading/RDLTask";
import { buildReadingExplainMessage } from "../components/reading/useReadingAiExplain";

const PASSAGE =
  "USED TEXTBOOK SALE! Saturday, May 17, in Room 112.\n\n" +
  "Prices range from three to twenty-five dollars. Cash only. Doors open at nine.";

const Q_DETAIL = {
  question_type: "detail",
  stem: "According to the flyer, how much will the books cost?",
  options: {
    A: "Between three and twenty-five dollars",
    B: "A flat fee of fifteen dollars each",
    C: "Ten dollars for any single title",
    D: "Nothing for currently enrolled students",
  },
  correct_answer: "A",
  explanation: "原文写 prices range from $3 to $25。",
};

const Q_NO_EXPLANATION = {
  question_type: "inference",
  stem: "What can be inferred about a buyer who arrives late?",
  options: { A: "Fewer titles remain", B: "Prices double", C: "Entry is free", D: "Books are new" },
  correct_answer: "A",
};

function historySession(overrides = {}) {
  return {
    id: 42,
    type: "reading",
    date: "2026-09-13T10:00:00.000Z",
    details: {
      subtype: "rdl",
      itemId: "rdl-1",
      passage: PASSAGE,
      questions: [Q_DETAIL, Q_NO_EXPLANATION],
      results: [
        { selected: "B", correct: "A", isCorrect: false },
        { selected: "A", correct: "A", isCorrect: true },
      ],
      ...overrides,
    },
  };
}

function aiButtons() {
  return screen.queryAllByRole("button", { name: /AI 深入解析/ });
}

beforeEach(() => {
  TIER = "pro";
  callAI.mockClear();
  localStorage.clear();
});

describe("RDLDetail（阅读练习历史 / 真题练习记录）", () => {
  test("只给答错的题放 AI 按钮，答对的题不放", () => {
    render(<RDLDetail session={historySession()} />);
    expect(aiButtons()).toHaveLength(1);
  });

  test("非 Pro：逐题回顾照常渲染，但没有 AI 按钮，也不计费", () => {
    TIER = "free";
    render(<RDLDetail session={historySession()} />);
    expect(screen.getByText(Q_DETAIL.stem)).toBeInTheDocument();
    expect(aiButtons()).toHaveLength(0);
    expect(callAI).not.toHaveBeenCalled();
  });

  test("渲染不自动调 API；点按钮才调，message 带原文 + 题干 + 选项原文 + 正确答案", async () => {
    render(<RDLDetail session={historySession()} />);
    expect(callAI).not.toHaveBeenCalled();

    fireEvent.click(aiButtons()[0]);
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));

    const [system, message, maxTokens, timeoutMs, temperature] = callAI.mock.calls[0];
    expect(system).toContain("TOEFL 阅读");
    // 面板是 pre-wrap 纯文本渲染，markdown 星号会原样显示
    expect(system).toContain("不要使用 markdown");
    expect(message).toContain(PASSAGE);
    expect(message).toContain(Q_DETAIL.stem);
    expect(message).toContain("学生选择：B. A flat fee of fifteen dollars each");
    expect(message).toContain("正确答案：A. Between three and twenty-five dollars");
    expect([maxTokens, timeoutMs, temperature]).toEqual([AI_HELPER_MAX_TOKENS, 60000, 0.3]);

    expect(await screen.findByText(/答案句在第二段末尾/)).toBeInTheDocument();
  });

  test("未作答：message 写「未作答」，不编一个选项", async () => {
    render(<RDLDetail session={historySession({
      results: [{ selected: null, correct: "A", isCorrect: false }],
      questions: [Q_DETAIL],
    })} />);
    fireEvent.click(aiButtons()[0]);
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    expect(callAI.mock.calls[0][1]).toContain("学生选择：未作答");
  });

  test("老记录没存题面（questions 缺失）时不放按钮 —— 讲不了就不放", () => {
    render(<RDLDetail session={historySession({ questions: undefined })} />);
    expect(aiButtons()).toHaveLength(0);
  });

  test("结果进 localStorage 缓存，重新挂载时自动回填且不再计费", async () => {
    const { unmount } = render(<RDLDetail session={historySession()} />);
    fireEvent.click(aiButtons()[0]);
    expect(await screen.findByText(/答案句在第二段末尾/)).toBeInTheDocument();
    expect(callAI).toHaveBeenCalledTimes(1);
    unmount();

    render(<RDLDetail session={historySession()} />);
    expect(await screen.findByText(/答案句在第二段末尾/)).toBeInTheDocument();
    expect(callAI).toHaveBeenCalledTimes(1);
  });
});

describe("RDLTask 交卷后的逐题复盘", () => {
  const item = { id: "rdl-task-1", genre: "flyer", text: PASSAGE, questions: [Q_DETAIL, Q_NO_EXPLANATION] };

  function submitWrong() {
    render(<RDLTask item={item} title="Read in Daily Life" onComplete={() => {}} onBack={() => {}} />);
    // 第 1 题选错、第 2 题选对，然后交卷
    fireEvent.click(screen.getByText(Q_DETAIL.options.B));
    fireEvent.click(screen.getByRole("button", { name: /下一题|Next/ }));
    fireEvent.click(screen.getByText(Q_NO_EXPLANATION.options.A));
    fireEvent.click(screen.getByRole("button", { name: /提交|交卷|Submit/ }));
  }

  test("交卷前没有 AI 按钮（做题中不该出现答案线索）", () => {
    render(<RDLTask item={item} title="Read in Daily Life" onComplete={() => {}} onBack={() => {}} />);
    expect(aiButtons()).toHaveLength(0);
    expect(callAI).not.toHaveBeenCalled();
  });

  test("交卷后答错的那题有 AI 按钮；点了才计费，message 带原文与学生选项", async () => {
    submitWrong();
    // 交卷后回到第 1 题（答错的那题）
    expect(aiButtons()).toHaveLength(1);
    expect(callAI).not.toHaveBeenCalled();

    fireEvent.click(aiButtons()[0]);
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    const message = callAI.mock.calls[0][1];
    expect(message).toContain(PASSAGE);
    expect(message).toContain("学生选择：B. A flat fee of fifteen dollars each");
    expect(await screen.findByText(/答案句在第二段末尾/)).toBeInTheDocument();
  });

  test("切到答对的那题就没有 AI 按钮", () => {
    submitWrong();
    fireEvent.click(screen.getByRole("button", { name: /下一题|Next/ }));
    expect(aiButtons()).toHaveLength(0);
  });

  test("选句题交卷后也有 AI 按钮（块与选句题复盘同级，不只挂在四选一那支上）", async () => {
    const ssItem = {
      id: "ap-ss-1",
      genre: "academic",
      text: "Intro paragraph.\n\nAlpha runs fast. Beta sits still. Gamma jumps high.",
      paragraphs: ["Intro paragraph.", "Alpha runs fast. Beta sits still. Gamma jumps high."],
      questions: [
        {
          question_type: "sentence_selection",
          stem: "Identify the sentence in paragraph 2 that describes motion.",
          paragraph: 2,
          paragraph_index: 1,
          options: { S1: "Alpha runs fast.", S2: "Beta sits still.", S3: "Gamma jumps high." },
          correct_answer: "S1",
        },
      ],
    };
    render(<RDLTask item={ssItem} title="Academic Passage" onComplete={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getAllByText("Beta sits still.")[0]);
    fireEvent.click(screen.getByRole("button", { name: /提交|交卷|Submit/ }));
    expect(aiButtons()).toHaveLength(1);

    fireEvent.click(aiButtons()[0]);
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    const message = callAI.mock.calls[0][1];
    expect(message).toContain("选句题");
    expect(message).toContain("学生选的句子：Beta sits still.");
    expect(message).toContain("正确句子：Alpha runs fast.");
  });

  test("题库没带 explanation 的题照样有 AI 按钮 —— 独立于静态解析渲染", () => {
    render(
      <RDLTask
        item={{ ...item, questions: [Q_NO_EXPLANATION] }}
        title="Read in Daily Life"
        onComplete={() => {}}
        onBack={() => {}}
      />
    );
    fireEvent.click(screen.getByText(Q_NO_EXPLANATION.options.B));
    fireEvent.click(screen.getByRole("button", { name: /提交|交卷|Submit/ }));
    expect(screen.queryByText(Q_DETAIL.explanation)).not.toBeInTheDocument();
    expect(aiButtons()).toHaveLength(1);
  });
});

describe("buildReadingExplainMessage 纯函数", () => {
  // 真题 AP 选句题：作答值是 S 键，讲解前提是把键换成句子原文。
  const SS_PASSAGE = "Intro paragraph.\n\nAlpha runs fast. Beta sits still. Gamma jumps high.";
  const SS_QUESTION = {
    question_type: "sentence_selection",
    stem: "Identify the sentence in paragraph 2 that describes motion.",
    paragraph: 2,
    paragraph_index: 1,
    options: { S1: "Alpha runs fast.", S2: "Beta sits still.", S3: "Gamma jumps high." },
    correct_answer: "S1",
  };

  test("选句题：写出句子原文 + 段号，不把 S 键直接丢给模型", () => {
    const message = buildReadingExplainMessage({
      stem: SS_QUESTION.stem,
      question: SS_QUESTION,
      options: SS_QUESTION.options,
      selected: "S2",
      correct: "S1",
      passage: SS_PASSAGE,
      isCorrect: false,
    });
    expect(message).toContain("选句题");
    expect(message).toContain("第 2 段");
    expect(message).toContain("学生选的句子：Beta sits still.");
    expect(message).toContain("正确句子：Alpha runs fast.");
    // S 键本身不能是唯一信息 —— 不许出现「学生选的句子：S2」这种写法
    expect(message).not.toContain("学生选的句子：S2");
  });

  test("段号是脏数据时不写成「第 null 段」", () => {
    const message = buildReadingExplainMessage({
      stem: SS_QUESTION.stem,
      question: { ...SS_QUESTION, paragraph: null },
      options: SS_QUESTION.options,
      selected: "S2",
      correct: "S1",
      passage: SS_PASSAGE,
      isCorrect: false,
    });
    expect(message).toContain("选句题");
    expect(message).not.toContain("第 null 段");
    expect(message).not.toContain("第 undefined 段");
  });

  test("选句题未作答：写「未作答」", () => {
    const message = buildReadingExplainMessage({
      stem: SS_QUESTION.stem,
      question: SS_QUESTION,
      options: SS_QUESTION.options,
      selected: null,
      correct: "S1",
      passage: SS_PASSAGE,
      isCorrect: false,
    });
    expect(message).toContain("学生选的句子：未作答");
  });

  test("第二来源被拍成 A–D 的选句题按四选一走（没有 S 键）", () => {
    const message = buildReadingExplainMessage({
      stem: "Identify the sentence …",
      question: { question_type: "sentence_selection", options: { A: "Alpha runs.", B: "Beta sits." } },
      options: { A: "Alpha runs.", B: "Beta sits." },
      selected: "B",
      correct: "A",
      passage: SS_PASSAGE,
      isCorrect: false,
    });
    expect(message).not.toContain("选句题");
    expect(message).toContain("学生选择：B. Beta sits.");
  });

  test("AP 长度的原文（~1500 字符）整篇喂进去，不砍尾段", () => {
    // 旧版上限 1200 会砍掉 74/101 篇生成库 AP 与 84/86 篇真题 AP 的尾段。
    const tail = "The decisive clue sits in this final sentence.";
    const longPassage = "A".repeat(1500) + " " + tail;
    const message = buildReadingExplainMessage({
      stem: Q_DETAIL.stem,
      options: Q_DETAIL.options,
      selected: "B",
      correct: "A",
      passage: longPassage,
      isCorrect: false,
    });
    expect(message).toContain(tail);
    expect(message).not.toContain("...");
  });
});
