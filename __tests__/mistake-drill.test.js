/**
 * 练错题（lib/mistakes/drill + components/mistakes/MistakeDrill）：
 * 选题型 / 来源 / 数量 → 依次做每一组 → 统计报告；结果只回写错题池，不写练习历史。
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mergeEntries, emptyPool, loadPool, syncPoolFromSessions } from "../lib/mistakes/pool";
import { extractMistakeEntries } from "../lib/mistakes/extract";
import { buildStages, buildUnits, filterUnits, pickUnits, scoreStage, summarizeDrill } from "../lib/mistakes/drill";

const SESSIONS = [
  {
    type: "bs", date: "2026-10-01T10:00:00.000Z",
    details: [
      { qid: "q1", prompt: "P1", userAnswer: "x", correctAnswer: "A one.", isCorrect: false, grammar_points: ["g1"] },
      { qid: "q2", prompt: "P2", userAnswer: "x", correctAnswer: "A two.", isCorrect: false },
      { qid: "q3", prompt: "P3", userAnswer: "x", correctAnswer: "A three.", isCorrect: false },
    ],
  },
  {
    type: "listening", date: "2026-10-02T10:00:00.000Z",
    details: {
      subtype: "lcr", itemIds: ["l1", "l2"],
      items: [
        { id: "l1", speaker: "S1", options: { A: "a", B: "b" }, answer: "A" },
        { id: "l2", speaker: "S2", options: { A: "a", B: "b" }, answer: "B" },
      ],
      results: [
        { itemId: "l1", selected: "B", correct: "A", isCorrect: false },
        { itemId: "l2", selected: "A", correct: "B", isCorrect: false },
      ],
    },
  },
  {
    type: "reading", date: "2026-10-03T10:00:00.000Z",
    details: {
      subtype: "ap", itemId: "ap1", topic: "Bees", passage: "Long passage",
      questions: [{ stem: "Q0" }, { stem: "Q1" }, { stem: "Q2" }, { stem: "Q3" }],
      results: [
        { selected: "A", correct: "B", isCorrect: false },
        { selected: "A", correct: "A", isCorrect: true },
        { selected: "C", correct: "D", isCorrect: false },
        { selected: "A", correct: "A", isCorrect: true },
      ],
    },
  },
  {
    type: "reading", date: "2026-10-04T10:00:00.000Z",
    details: {
      subtype: "ctw", itemId: "c1", passage: "Some words here.",
      blanks: [{ position: 0, original_word: "Some", displayed_fragment: "So" }, { position: 1, original_word: "words", displayed_fragment: "wo" }],
      results: [
        { blank: { position: 0 }, userAnswer: "ne", fullWord: "Sone", isCorrect: false },
        { blank: { position: 1 }, userAnswer: "rds", fullWord: "words", isCorrect: true },
      ],
    },
  },
];

function makePool() {
  return mergeEntries(emptyPool(), extractMistakeEntries(SESSIONS)).pool;
}

describe("drill 纯函数", () => {
  test("拼句 / 应答一题一个单位，篇章题按篇合成一个单位", () => {
    const units = buildUnits(makePool());
    const byType = (t) => units.filter((u) => u.type === t);
    expect(byType("bs")).toHaveLength(3);
    expect(byType("lcr")).toHaveLength(2);
    const ap = byType("read");
    expect(ap).toHaveLength(1);
    expect(ap[0].size).toBe(2);
    expect(ap[0].available).toBe(true);
    expect(byType("ctw")[0].size).toBe(1);
  });

  test("按题型 / 来源过滤；按题数抽，篇章单位不拆", () => {
    const units = buildUnits(makePool());
    expect(filterUnits(units, { types: ["bs"] })).toHaveLength(3);
    expect(filterUnits(units, { types: ["bs"], source: "starred" })).toHaveLength(0);
    const picked = pickUnits(filterUnits(units, { types: ["bs", "lcr"] }), { count: 4, order: "recent" });
    expect(picked.reduce((n, u) => n + u.size, 0)).toBe(4);
    expect(picked[0].type).toBe("lcr"); // 最近错的在前
    expect(pickUnits(units, { count: 0 })).toHaveLength(units.length);
    // 同一 seed 可复现，换 seed 换一批
    const a = pickUnits(units, { count: 3, seed: 7 }).map((u) => u.id);
    expect(pickUnits(units, { count: 3, seed: 7 }).map((u) => u.id)).toEqual(a);
  });

  test("拆组：拼句一组、应答一组、每篇一组；篇章组只带错过的题并换新 id", () => {
    const pool = makePool();
    const stages = buildStages(buildUnits(pool), pool);
    expect(stages.map((s) => s.kind)).toEqual(["bs", "lcr", "rdl", "ctw"]);
    const lcr = stages[1];
    expect(lcr.items.map((i) => i.id)).toEqual(["l1__drill", "l2__drill"]);
    const ap = stages[2];
    expect(ap.item.id).toBe("ap1__drill");
    expect(ap.item.questions.map((q) => q.stem)).toEqual(["Q0", "Q2"]);
    expect(ap.title).toBe("Academic Passage");
    const ctw = stages[3];
    expect(ctw.item.blanks).toHaveLength(2); // 整篇重做
    expect(ctw.keyByIndex).toEqual({ 0: "ctw:c1#b0" });
  });

  test("判分只回报错过的那几题 / 空", () => {
    const pool = makePool();
    const stages = buildStages(buildUnits(pool), pool);
    const [bs, lcr, ap, ctw] = stages;
    expect(scoreStage({ ...bs, keyByQid: { q1: "bs:q1", q2: "bs:q2" } }, { details: [{ qid: "q1", isCorrect: true }, { qid: "q2", isCorrect: false }, { qid: "zz", isCorrect: true }] }))
      .toEqual([{ key: "bs:q1", correct: true }, { key: "bs:q2", correct: false }]);
    expect(scoreStage(lcr, { results: [{ itemId: "l1__drill", isCorrect: true }, { itemId: "l2__drill", isCorrect: false }] }))
      .toEqual([{ key: "lcr:l1", correct: true }, { key: "lcr:l2", correct: false }]);
    expect(scoreStage(ap, { results: [{ isCorrect: false }, { isCorrect: true }] }))
      .toEqual([{ key: "ap:ap1#q0", correct: false }, { key: "ap:ap1#q2", correct: true }]);
    expect(scoreStage(ctw, { results: [{ isCorrect: true }, { isCorrect: false }] }))
      .toEqual([{ key: "ctw:c1#b0", correct: true }]);
    const s = summarizeDrill([{ key: "bs:q1", correct: true }, { key: "lcr:l2", correct: false }], pool.cards);
    expect(s).toEqual({ total: 2, correct: 1, byType: { bs: { total: 1, correct: 1 }, lcr: { total: 1, correct: 0 } } });
  });

  test("原文被配额精简的篇不能重做", () => {
    const pool = makePool();
    pool.items["ap:ap1"] = { ...pool.items["ap:ap1"], pruned: true, questions: undefined, passage: undefined };
    const ap = buildUnits(pool).find((u) => u.type === "read");
    expect(ap.available).toBe(false);
    expect(filterUnits([ap], {})).toHaveLength(0);
  });
});

/* ── 组件流程 ── */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(global.__drillQuery || ""),
}));
jest.mock("../components/shared/ExamAudioProvider", () => ({
  ExamAudioProvider: ({ children }) => children,
  useExamAudio: () => null,
}));
jest.mock("../lib/sessionStore", () => {
  const saveSess = jest.fn();
  return {
    loadHist: () => ({ sessions: global.__drillSessions || [] }),
    saveSess,
    SESSION_STORE_EVENTS: { HISTORY_UPDATED_EVENT: "toefl-history-updated" },
  };
});
jest.mock("../data/buildSentence/questions.json", () => ({
  question_sets: [{ set_id: 1, questions: [
    { id: "q1", prompt: "P1", answer: "A one." },
    { id: "q2", prompt: "CHANGED PROMPT", answer: "A two." },
  ] }],
}), { virtual: false });

function mockMakeStub(label, makeResult) {
  return function Stub(props) {
    return (
      <div data-testid={`stub-${label}`}>
        <span>{label}</span>
        <button type="button" onClick={() => props.onComplete(makeResult(props))}>提交{label}</button>
        <button type="button" onClick={() => props.onExit({ completed: true })}>{props.nextLabel || "返回"}</button>
      </div>
    );
  };
}
jest.mock("../components/buildSentence/BuildSentenceTask", () => ({
  BuildSentenceTask: (props) => {
    global.__bsProps = props;
    const Stub = mockMakeStub("拼句", (p) => ({ details: p.questions.map((q) => ({ qid: q.id, isCorrect: q.id === "q1" })) }));
    return <Stub {...props} />;
  },
}));
jest.mock("../components/listening/LCRTask", () => ({
  LCRTask: (props) => {
    const Stub = mockMakeStub("应答", (p) => ({ results: p.batchItems.map((i) => ({ itemId: i.id, isCorrect: false })) }));
    return <Stub {...props} />;
  },
}));
jest.mock("../components/reading/RDLTask", () => ({
  RDLTask: (props) => {
    const Stub = mockMakeStub("阅读", (p) => ({ results: p.item.questions.map(() => ({ isCorrect: true })) }));
    return <Stub {...props} />;
  },
}));
jest.mock("../components/reading/CTWTask", () => ({
  CTWTask: (props) => {
    const Stub = mockMakeStub("填词", () => ({ results: [{ isCorrect: true }, { isCorrect: true }] }));
    return <Stub {...props} />;
  },
}));
jest.mock("../components/listening/ListeningMCQTask", () => ({ ListeningMCQTask: () => null }));

describe("MistakeDrill 组件流程", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("toefl-user-tier", "pro");
    global.__drillSessions = SESSIONS;
    global.__drillQuery = "";
    window.scrollTo = jest.fn();
  });

  test("选全部 → 依次做完四组 → 报告页数字对、回写 lastDrill、不写练习历史", async () => {
    const MistakeDrill = require("../components/mistakes/MistakeDrill").default;
    const { saveSess } = require("../lib/sessionStore");
    render(<MistakeDrill />);
    await screen.findByText("练哪些题型");
    fireEvent.click(screen.getByText("全部"));
    // 最近错的优先 → 篇章组按 填词(10-04)、阅读(10-03) 排
    fireEvent.change(screen.getByLabelText("抽题顺序"), { target: { value: "recent" } });
    await act(async () => { fireEvent.click(screen.getByTestId("drill-start")); });

    // 第 1 组：拼句（q2 题面对不上 → 当已下线；q3 不在题库 → 下线；只剩 q1）
    await screen.findByTestId("stub-拼句");
    expect(global.__bsProps.questions.map((q) => q.id)).toEqual(["q1"]);
    expect(global.__bsProps.persistSession).toBe(false);
    expect(global.__bsProps.recordGroupDone).toBe(false);
    fireEvent.click(screen.getByText("提交拼句"));
    fireEvent.click(screen.getByText("下一组（2/4）→"));

    await screen.findByTestId("stub-应答");
    fireEvent.click(screen.getByText("提交应答"));
    fireEvent.click(screen.getByText("下一组（3/4）→"));

    await screen.findByTestId("stub-填词");
    fireEvent.click(screen.getByText("提交填词"));
    fireEvent.click(screen.getByText("下一组（4/4）→"));

    await screen.findByTestId("stub-阅读");
    fireEvent.click(screen.getByText("提交阅读"));
    fireEvent.click(screen.getByText("查看统计 →"));

    await screen.findByTestId("drill-report");
    // 拼句 1 题对、应答 2 题错、阅读 2 题对、填词 1 空对 = 6 题对 4
    expect(screen.getByText("题数").previousSibling.textContent).toBe("6");
    expect(screen.getByText("答对").previousSibling.textContent).toBe("4");
    expect(screen.getByText("67%")).toBeTruthy();
    expect(screen.getByText(/有 2 道拼句原题已经下线/)).toBeTruthy();
    expect(screen.getByText("仍然错的 2 题")).toBeTruthy();
    expect(saveSess).not.toHaveBeenCalled();

    const pool = loadPool();
    expect(pool.cards["bs:q1"].lastDrill.correct).toBe(true);
    expect(pool.cards["lcr:l1"].lastDrill.correct).toBe(false);
    expect(pool.drills).toHaveLength(1);

    // 报告页：把做对的移出错题本
    fireEvent.click(screen.getByText(/把勾选的 4 题移出错题本/));
    expect(loadPool().cards["ap:ap1#q0"].deletedAt).toBeTruthy();
    expect(loadPool().cards["lcr:l1"].deletedAt).toBeNull();
  });

  test("「只练这题」直达：只抽那一题；免费用户不能练阅读 / 听力", async () => {
    localStorage.setItem("toefl-user-tier", "free");
    global.__drillQuery = "key=" + encodeURIComponent("ap:ap1#q2");
    syncPoolFromSessions(SESSIONS);
    const MistakeDrill = require("../components/mistakes/MistakeDrill").default;
    render(<MistakeDrill />);
    await screen.findByText(/只练这一篇/);
    expect(screen.getByText(/阅读 \/ 听力练习是 Pro 功能/)).toBeTruthy();
    expect(screen.getByTestId("drill-start")).toBeDisabled();
  });
});
