/**
 * 练错题（lib/mistakes/drill + components/mistakes/MistakeDrill）：
 * 选题型 / 来源 / 数量 → 依次做每一组 → 统计报告；结果只回写错题池，不写练习历史。
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mergeEntries, emptyPool, loadPool, syncPoolFromSessions } from "../lib/mistakes/pool";
import { extractMistakeEntries } from "../lib/mistakes/extract";
import { buildStages, buildUnits, classifyDrill, filterUnits, isSameMistake, pickUnits, restrictUnits, scoreStage, summarizeDrill } from "../lib/mistakes/drill";

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

  test("拆组：拼句一组（用回查好的原题）、应答一组、每篇一组；篇章组只带错过的题并换新 id", () => {
    const pool = makePool();
    const bsQuestions = { "bs:q1": { id: "q1", prompt: "P1" }, "bs:q3": { id: "new_q3", prompt: "P3" } };
    const stages = buildStages(buildUnits(pool, { blockedKeys: ["bs:q2"] }), pool, { bsQuestions });
    expect(stages.map((s) => s.kind)).toEqual(["bs", "lcr", "rdl", "ctw"]);
    expect(stages[0].questions.map((q) => q.id)).toEqual(["q1", "new_q3"]);
    expect(stages[0].keyByQid).toEqual({ q1: "bs:q1", new_q3: "bs:q3" });
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

  test("回查不到原题的拼句（blockedKeys）不进抽题范围 —— 抽 N 题就给 N 道能做的", () => {
    const units = buildUnits(makePool(), { blockedKeys: new Set(["bs:q2"]) });
    const bs = filterUnits(units, { types: ["bs"] });
    expect(bs.map((u) => u.id)).toEqual(["bs:q1", "bs:q3"]);
    expect(pickUnits(units.filter((u) => u.type === "bs" || u.type === "lcr"), { count: 4 }).reduce((n, u) => n + u.size, 0)).toBe(4);
  });

  test("判分只回报错过的那几题 / 空，并带上这一次的作答", () => {
    const pool = makePool();
    const stages = buildStages(buildUnits(pool), pool, { bsQuestions: { "bs:q1": { id: "q1" }, "bs:q2": { id: "q2", prefilled: ["dorms"] } } });
    const [bs, lcr, ap, ctw] = stages;
    expect(scoreStage(bs, { details: [{ qid: "q1", isCorrect: true, userAnswer: "A one." }, { qid: "q2", isCorrect: false, userAnswer: "(no answer)" }, { qid: "zz", isCorrect: true }] }))
      .toEqual([{ key: "bs:q1", correct: true, answer: "A one.", selected: null }, { key: "bs:q2", correct: false, answer: "", selected: null }]);
    // 只剩预填词 = 一块没放 = 没作答
    expect(scoreStage(bs, { details: [{ qid: "q2", isCorrect: false, userAnswer: "Dorms." }] })[0].answer).toBe("");
    expect(scoreStage(lcr, { results: [{ itemId: "l1__drill", selected: "A", isCorrect: true }, { itemId: "l2__drill", selected: "A", isCorrect: false }] }))
      .toEqual([{ key: "lcr:l1", correct: true, answer: "A. a", selected: "A" }, { key: "lcr:l2", correct: false, answer: "A. a", selected: "A" }]);
    expect(scoreStage(ap, { results: [{ selected: "C", isCorrect: false }, { selected: "D", isCorrect: true }] }).map(({ key, correct, selected }) => ({ key, correct, selected })))
      .toEqual([{ key: "ap:ap1#q0", correct: false, selected: "C" }, { key: "ap:ap1#q2", correct: true, selected: "D" }]);
    expect(scoreStage(ctw, { results: [{ userAnswer: "me", fullWord: "Some", isCorrect: true }, { isCorrect: false }] }))
      .toEqual([{ key: "ctw:c1#b0", correct: true, answer: "Some", selected: null }]);
    const s = summarizeDrill([{ key: "bs:q1", correct: true }, { key: "lcr:l2", correct: false }], pool.cards);
    expect(s).toEqual({ total: 2, correct: 1, byType: { bs: { total: 1, correct: 1 }, lcr: { total: 1, correct: 0 } } });
  });

  test("结算口径：纠正 / 没拿下 / 和上次错得一样", () => {
    const pool = makePool();
    // lcr:l1 上次选 B；这次又选 B → 同样的错。lcr:l2 上次选 A，这次选 B → 换了个错法。bs:q1 拼得和上次一样
    expect(isSameMistake(pool.cards["lcr:l1"], { correct: false, selected: "B" })).toBe(true);
    expect(isSameMistake(pool.cards["lcr:l2"], { correct: false, selected: "B" })).toBe(false);
    expect(isSameMistake(pool.cards["bs:q1"], { correct: false, answer: " X " })).toBe(true);
    expect(isSameMistake(pool.cards["bs:q1"], { correct: false, answer: "" })).toBe(false);
    const c = classifyDrill([
      { key: "lcr:l2", correct: false, selected: "B" },
      { key: "lcr:l1", correct: false, selected: "B" },
      { key: "bs:q2", correct: true },
    ], pool.cards);
    expect(c.fixed.map((x) => x.card.key)).toEqual(["bs:q2"]);
    expect(c.still.map((x) => x.card.key)).toEqual(["lcr:l1", "lcr:l2"]); // 同样的错排前面
    expect(c.sameMistake).toBe(1);
    // 没作答单独算，不算「换了个错法」
    const u = classifyDrill([{ key: "bs:q1", correct: false, answer: "" }, { key: "lcr:l2", correct: false, selected: null }], pool.cards);
    expect(u).toMatchObject({ unanswered: 2, sameMistake: 0, changed: 0 });
  });

  test("「再练没拿下的」只留那几题：篇章单位收窄", () => {
    const units = restrictUnits(buildUnits(makePool()), ["ap:ap1#q2", "lcr:l1"]);
    expect(units.map((u) => [u.id, u.size])).toEqual([["lcr:l1", 1], ["ap:ap1", 1]]);
    expect(units[1].cardKeys).toEqual(["ap:ap1#q2"]);
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
    { id: "q9", prompt: "P3", answer: "A three." },
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
    const Stub = mockMakeStub("拼句", (p) => ({ details: p.questions.map((q) => ({ qid: q.id, isCorrect: q.id === "q1", userAnswer: "my try" })) }));
    return <Stub {...props} />;
  },
}));
jest.mock("../components/listening/LCRTask", () => ({
  LCRTask: (props) => {
    const Stub = mockMakeStub("应答", (p) => ({ results: p.batchItems.map((i) => ({ itemId: i.id, selected: "B", isCorrect: false })) }));
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

  test("拼句先核对原题再抽 → 依次做完四组（组间是衔接卡，不出各科练习结算页）→ 练错题结算页", async () => {
    const MistakeDrill = require("../components/mistakes/MistakeDrill").default;
    const { saveSess } = require("../lib/sessionStore");
    render(<MistakeDrill />);
    await screen.findByText("练哪些题型");
    // q2 题面对不上、按「题面+答案」也找不到 → 下线，不进抽题；q3 的 id 变了但按内容找回（q9）
    expect(screen.getByText(/另有 1 道拼句的原题已从题库下线/)).toBeTruthy();
    fireEvent.click(screen.getByText("全部"));
    fireEvent.change(screen.getByLabelText("抽题顺序"), { target: { value: "recent" } });
    expect(screen.getByText(/^7 题 · 约/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId("drill-start")); });

    await screen.findByTestId("stub-拼句");
    expect(global.__bsProps.questions.map((q) => q.id)).toEqual(["q1", "q9"]);
    expect(global.__bsProps.persistSession).toBe(false);
    expect(global.__bsProps.recordGroupDone).toBe(false);
    fireEvent.click(screen.getByText("提交拼句"));
    // 交卷即离开任务组件（不出它自己的 Band 结算页），进衔接卡
    expect(screen.queryByTestId("stub-拼句")).toBeNull();
    expect(screen.getByText(/纠正了 1 \/ 2/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("drill-continue"));

    await screen.findByTestId("stub-应答");
    fireEvent.click(screen.getByText("提交应答"));
    fireEvent.click(screen.getByTestId("drill-continue"));
    await screen.findByTestId("stub-填词");
    fireEvent.click(screen.getByText("提交填词"));
    fireEvent.click(screen.getByTestId("drill-continue"));
    await screen.findByTestId("stub-阅读");
    fireEvent.click(screen.getByText("提交阅读"));

    await screen.findByTestId("drill-report");
    // 纠正：bs:q1、ctw b0、ap q0/q2 = 4；没拿下：bs:q3、lcr l1/l2 = 3；其中 lcr:l1 两次都选 B
    expect(screen.getByTestId("drill-fixed").textContent).toBe("4 / 7");
    expect(screen.getByText("没拿下的 3 题")).toBeTruthy();
    expect(screen.getAllByText("和上次错得一样")).toHaveLength(1);
    expect(screen.getAllByText("换了个错法")).toHaveLength(2);
    expect(screen.queryByText("Band")).toBeNull();
    expect(saveSess).not.toHaveBeenCalled();

    const pool = loadPool();
    expect(pool.cards["bs:q1"].lastDrill.correct).toBe(true);
    expect(pool.cards["lcr:l1"].lastDrill.correct).toBe(false);
    expect(pool.drills).toHaveLength(1);

    fireEvent.click(screen.getByText(/把勾选的 4 题移出错题本/));
    expect(loadPool().cards["ap:ap1#q0"].deletedAt).toBeTruthy();
    expect(loadPool().cards["lcr:l1"].deletedAt).toBeNull();

    // 再练没拿下的：只出这 3 题
    fireEvent.click(screen.getByTestId("drill-retry-still"));
    await screen.findByTestId("stub-拼句");
    expect(global.__bsProps.questions.map((q) => q.id)).toEqual(["q9"]);
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
