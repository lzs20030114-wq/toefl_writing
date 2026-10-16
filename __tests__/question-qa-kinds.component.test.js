/**
 * 答疑窗口推广到听力四型、阅读填词、错题本（lib/qa/qaKinds + 各题型 AI 讲解块）。全部 mock callAI，不花钱。
 * 锁的是：讲解下面有「继续追问」、按钮是本题型的、用本题型的系统提示词和证据包、
 * 听力出处点了会广播「播放这一句」、同类错题与举一反三只在阅读选择题上。
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => "ABC123"),
  getSavedTier: jest.fn(() => "pro"),
}));
jest.mock("../lib/sessionStore", () => ({
  loadHist: jest.fn(() => ({ sessions: [] })),
  SESSION_STORE_EVENTS: { HISTORY_UPDATED_EVENT: "toefl-history-updated" },
}));
jest.mock("../lib/dict/lookup", () => ({ lookupWord: jest.fn(async () => null) }));

let QA_REPLY = '"lost my student card" [S2] 所以她是来补卡的。';
const FIRST = '依据："lost my student card" [S2]\n错在哪：原文没提交费。';
const callAI = jest.fn(async (system) => (system.includes("追问") ? QA_REPLY : FIRST));
jest.mock("../lib/ai/client", () => ({
  ...jest.requireActual("../lib/ai/client"),
  callAI: (...args) => callAI(...args),
}));

import { useListeningAiExplain, ListeningAiExplainBlock } from "../components/listening/useListeningAiExplain";
import { useCtwAiExplain, CtwAiExplainBlock } from "../components/reading/useCtwAiExplain";
import { QA_SYSTEM_LISTENING, QA_SYSTEM_LCR, QA_SYSTEM_CTW, LISTENING_EXPLAIN_SYSTEM } from "../lib/qa/questionQa";
import { SENTENCE_PLAY_EVENT } from "../lib/notes/passageFlash";
import { qaDetailForCard } from "../lib/qa/mistakeQaDetail";

const LC_DETAIL = {
  subtype: "lc",
  qid: "lc-1-q0",
  stem: "Why does the woman go to the office?",
  contextText: "",
  conversation: [
    { speaker: "Woman", text: "Hi there. I lost my student card yesterday." },
    { speaker: "Man", text: "No problem, I can print a new one." },
  ],
  options: { A: "To pay a fee", B: "To replace her card" },
  selected: "A",
  correct: "B",
  isCorrect: false,
};

function ListeningHarness({ detail = LC_DETAIL }) {
  const h = useListeningAiExplain();
  return <ListeningAiExplainBlock explainKey={`k-${detail.qid}`} detail={detail} {...h} includeCorrect />;
}

const CTW_DETAIL = {
  isCorrect: false,
  itemId: "ctw-9",
  position: 7,
  displayed_fragment: "popul",
  original_word: "population",
  fullWord: "popular",
  userAnswer: "ar",
  passage: "The Spix's Macaw is critically endangered. The population of this bird declined because of habitat loss.",
  blankIndex: 0,
  blankTotal: 10,
};

function CtwHarness() {
  const h = useCtwAiExplain();
  return <CtwAiExplainBlock explainKey="ctw-k" detail={CTW_DETAIL} {...h} includeCorrect />;
}

beforeEach(() => {
  callAI.mockClear();
  localStorage.clear();
  QA_REPLY = '"lost my student card" [S2] 所以她是来补卡的。';
});

describe("听力选择题", () => {
  test("第一轮讲解按句编号、出处可点；讲解下面接本题型的追问按钮", async () => {
    render(<ListeningHarness />);
    fireEvent.click(screen.getByRole("button", { name: /AI 深入解析/ }));
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    expect(callAI.mock.calls[0][0]).toBe(LISTENING_EXPLAIN_SYSTEM);
    // 出处显示成「第 2 句（Woman）」
    expect(await screen.findByText("第 2 句（Woman）")).toBeInTheDocument();
    expect(screen.getByTestId("qa-entry-listen-cue")).toBeInTheDocument();
    expect(screen.queryByTestId("qa-entry-analogy")).toBeNull();
  });

  test("追问走听力提示词，证据包是编号后的听力原文；点出处广播「播放这一句」", async () => {
    render(<ListeningHarness />);
    fireEvent.click(screen.getByRole("button", { name: /AI 深入解析/ }));
    fireEvent.click(await screen.findByTestId("qa-entry-listen-cue"));
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(2));
    const [system, message] = callAI.mock.calls[1];
    expect(system).toBe(QA_SYSTEM_LISTENING);
    expect(message).toContain("[S2] （Woman）I lost my student card yesterday.");
    expect(message).toContain("【回答格式】");
    expect(message).not.toContain("学生以前");

    const played = [];
    const onPlay = (e) => { played.push(e.detail.text); e.detail.handled = true; };
    window.addEventListener(SENTENCE_PLAY_EVENT, onPlay);
    const answer = await screen.findByTestId("qa-answer");
    fireEvent.click(answer.querySelector("[data-testid='qa-cite']"));
    window.removeEventListener(SENTENCE_PLAY_EVENT, onPlay);
    expect(played).toEqual(["I lost my student card yesterday."]);
  });

  test("应答题：不看讲解也能直接问，按钮是应答题那套", async () => {
    const detail = {
      subtype: "lcr",
      qid: "lcr-1",
      speaker: "Could you lend me your notes from Monday?",
      options: { A: "Sure, here you go.", B: "On Monday." },
      selected: "B",
      correct: "A",
      isCorrect: false,
    };
    QA_REPLY = '"Could you lend me" [S1] 是在请求。';
    render(<ListeningHarness detail={detail} />);
    fireEvent.click(screen.getByTestId("qa-ask"));
    fireEvent.click(await screen.findByTestId("qa-preset-tone"));
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    const [system, message] = callAI.mock.calls[0];
    expect(system).toBe(QA_SYSTEM_LCR);
    expect(message).toContain("[S1] Could you lend me your notes from Monday?");
    expect(await screen.findByText("原话")).toBeInTheDocument();
  });
});

describe("阅读填词", () => {
  test("讲解下面接填词的追问；追问用填词提示词，证据包定位到空所在的句子", async () => {
    QA_REPLY = '"The population of this bird" [S2] 这里要名词。';
    render(<CtwHarness />);
    fireEvent.click(screen.getByRole("button", { name: /AI 深入解析/ }));
    fireEvent.click(await screen.findByTestId("qa-entry-why-form"));
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(2));
    const [system, message] = callAI.mock.calls[1];
    expect(system).toBe(QA_SYSTEM_CTW);
    expect(message).toContain("本题：第 1 个空（共 10 个），在 [S2]");
    expect(message).toContain("学生填写：popular");
    expect(await screen.findByText("第 2 句")).toBeInTheDocument();
  });

  test("「我是这么想的…」预填的是「我当时填 popular，是因为」", async () => {
    render(<CtwHarness />);
    fireEvent.click(screen.getByTestId("qa-ask"));
    fireEvent.click(await screen.findByTestId("qa-preset-my-thinking"));
    expect(screen.getByTestId("qa-input").value).toBe("我当时填 popular，是因为");
  });
});

describe("错题本卡片 → 答疑 detail", () => {
  test("阅读选择题、填词、听力都拼得出来；没有篇级快照返回 null", () => {
    const items = {
      "rdl:r1": { passage: "A. B.", itemId: "r1", questions: [{ stem: "Q?", options: { A: "x", B: "y" }, correct_answer: "B" }] },
      "ctw:c1": { passage: CTW_DETAIL.passage, itemId: "c1", blanks: [{ position: 7, displayed_fragment: "popul", original_word: "population" }] },
      "lc:l1": { itemId: "l1", transcript: "", conversation: LC_DETAIL.conversation, questions: [{ stem: "Why?", options: LC_DETAIL.options, answer: "B" }] },
      "lcr:x": { itemId: "x", speaker: "Could you help?", options: { A: "Sure.", B: "No." }, answer: "A" },
    };
    const rdl = qaDetailForCard({ subject: "reading", subtype: "rdl", itemKey: "rdl:r1", index: 0, brief: { stem: "Q?", options: { A: "x", B: "y" }, selected: "A", correctKey: "B" } }, items);
    expect(rdl).toMatchObject({ stem: "Q?", selected: "A", correct: "B", passage: "A. B." });
    expect(rdl.qaKind).toBeUndefined();
    const ctw = qaDetailForCard({ subject: "reading", subtype: "ctw", key: "ctw:c1#b7", itemKey: "ctw:c1", index: 0, brief: { userAnswer: "popular", correctAnswer: "population" } }, items);
    expect(ctw).toMatchObject({ qaKind: "ctw", position: 7, selected: "popular", correct: "population", displayed_fragment: "popul" });
    const lc = qaDetailForCard({ subject: "listening", subtype: "lc", itemKey: "lc:l1", index: 0, brief: { stem: "Why?", options: LC_DETAIL.options, selected: "A", correctKey: "B" } }, items);
    expect(lc).toMatchObject({ qaKind: "listening", selected: "A", correct: "B" });
    expect(lc.turns).toHaveLength(2);
    const lcr = qaDetailForCard({ subject: "listening", subtype: "lcr", itemKey: "lcr:x", brief: { selected: "B", correctKey: "A" } }, items);
    expect(lcr).toMatchObject({ qaKind: "lcr", passage: "Could you help?" });
    expect(qaDetailForCard({ subject: "reading", subtype: "rdl", itemKey: "rdl:gone", brief: {} }, items)).toBeNull();
  });
});
