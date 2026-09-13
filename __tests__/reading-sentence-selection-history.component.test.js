/**
 * 选句题（sentence_selection）进了练习记录之后的下游渲染：
 *   ① 历史逐题回顾 RDLDetail（/progress/reading 与 /real-bank/progress 共用）；
 *   ② 错题本 lib/readingMistakes + McqMistakesView（含 AI 讲解 hook，hook 本体不改）。
 * 选项键是 S1..Sn、句数不定 —— 任何地方不许因为写死 A–D 而崩或把选项渲染没了。
 * 记录形状与 app/real-bank/page.js 的 saveRealReadingSession 一致（results + questions 快照）。
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

if (typeof global.fetch !== "function") {
  global.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });
}

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

const callAI = jest.fn(async () => "AI 讲解：第二句点名了建筑与路面。");
jest.mock("../lib/ai/client", () => ({
  callAI: (...args) => callAI(...args),
  mapAiHelperError: (e) => String(e?.message || e),
}));

import FIXTURE from "./fixtures/real-ap-sentence-selection.json";
import { RDLDetail } from "../components/reading/ReadingProgressView";
import { extractReadingMistakes } from "../lib/readingMistakes";
import { McqMistakesView } from "../components/mistakes/McqMistakesView";

const RAW = FIXTURE.items[0];
const [MCQ, VOCAB, SS] = RAW.questions;

function session({ ssSelected = "S3", mcqSelected = "B" } = {}) {
  const results = [
    { selected: mcqSelected, correct: MCQ.correct_answer, isCorrect: mcqSelected === MCQ.correct_answer },
    { selected: "A", correct: VOCAB.correct_answer, isCorrect: true },
    { selected: ssSelected, correct: SS.correct_answer, isCorrect: ssSelected === SS.correct_answer },
  ];
  return {
    id: 901,
    type: "reading",
    mode: "standard",
    date: "2026-09-13T10:00:00.000Z",
    correct: results.filter((r) => r.isCorrect).length,
    total: 3,
    band: 4,
    details: {
      subtype: "ap",
      itemId: RAW.id,
      topic: RAW.topic,
      genre: "",
      results,
      passage: RAW.passage,
      questions: RAW.questions,
    },
  };
}

beforeEach(() => {
  callAI.mockClear();
  localStorage.clear();
});

describe("RDLDetail：选句题回顾", () => {
  test("答错：题干 + 你选的句子（红）+ 正确句子（绿），不列 S 键；四选一题照旧列 A–D", () => {
    const { container } = render(<RDLDetail session={session({ ssSelected: "S3" })} />);
    const ss = screen.getByTestId("ss-history-detail");
    expect(screen.getByText(SS.stem)).toBeInTheDocument();
    expect(within(ss).getByText("选句题 · 第 4 段")).toBeInTheDocument();
    expect(within(ss).getByText(`你选的句子：${SS.options.S3}`)).toBeInTheDocument();
    expect(within(ss).getByText(`正确句子：${SS.options.S2}`)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/S[1-4]\./);
    // 同一条记录里的四选一题不受影响
    expect(screen.getByText(/A\. By purifying the air around buildings/)).toBeInTheDocument();
  });

  test("答对：只写你选的句子 ✓，不重复正确句子", () => {
    render(<RDLDetail session={session({ ssSelected: "S2" })} />);
    const ss = screen.getByTestId("ss-history-detail");
    expect(within(ss).getByText(`你选的句子：${SS.options.S2} ✓`)).toBeInTheDocument();
    expect(within(ss).queryByText(/正确句子：/)).toBeNull();
  });

  test("未作答（超时收卷 selected=null）→「未作答」，不崩", () => {
    render(<RDLDetail session={session({ ssSelected: null })} />);
    const ss = screen.getByTestId("ss-history-detail");
    expect(within(ss).getByText("你选的句子：未作答")).toBeInTheDocument();
    expect(within(ss).getByText(`正确句子：${SS.options.S2}`)).toBeInTheDocument();
  });
});

describe("错题本：选句题", () => {
  test("extractReadingMistakes：S 键换成句子原文，带段号与该段全文", () => {
    const [group] = extractReadingMistakes([session({ ssSelected: "S4", mcqSelected: "A" })]);
    expect(group.wrongCount).toBe(2);
    const ss = group.mistakes.find((m) => m.kind === "sentence_selection");
    expect(ss).toMatchObject({
      stem: SS.stem,
      options: null,
      optionsKey: null,
      selected: "S4",
      correctKey: "S2",
      userAnswer: SS.options.S4,
      correctAnswer: SS.options.S2,
      paragraph: 4,
    });
    expect(ss.paragraphText).toBe(Object.values(SS.options).join(" "));
    // 四选一错题形状不变
    const mcq = group.mistakes.find((m) => m.kind !== "sentence_selection");
    expect(mcq.optionsKey).toEqual(["A", "B", "C", "D"]);
    expect(mcq.userAnswer).toBe(`A. ${MCQ.options.A}`);
  });

  test("McqMistakesView 渲染「你选的句子 / 正确句子」；AI 讲解拿到 S 键题不崩，上下文是第 4 段", async () => {
    const groups = extractReadingMistakes([session({ ssSelected: "S4", mcqSelected: "B" })]);
    render(<McqMistakesView groups={groups} section="reading" />);

    expect(screen.getByText("选句题 · 第 4 段")).toBeInTheDocument();
    expect(screen.getByText("你选的句子")).toBeInTheDocument();
    expect(screen.getByText("正确句子")).toBeInTheDocument();
    expect(screen.getByText(SS.options.S4)).toBeInTheDocument();
    expect(screen.getByText(SS.options.S2)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI 解释" }));
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    const message = callAI.mock.calls[0][1];
    expect(message).toContain(`题目：${SS.stem}`);
    expect(message).toContain(`学生答案：${SS.options.S4}`);
    expect(message).toContain(`正确答案：${SS.options.S2}`);
    expect(message).toContain(`文章：${Object.values(SS.options).join(" ")}`);
    expect(message).not.toContain("选项：");
    expect(await screen.findByText(/第二句点名了建筑与路面/)).toBeInTheDocument();
  });
});
