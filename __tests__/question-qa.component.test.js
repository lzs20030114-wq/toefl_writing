/**
 * 练习记录逐题「继续追问」窗口（components/reading/QuestionQaPanel + useQuestionQa）。
 * 计划见 docs/rag-qa-implementation-plan.md §5。全部 mock callAI，不花钱。
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

let TIER = "pro";
let CODE = "ABC123";
jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => CODE),
  getSavedTier: jest.fn(() => TIER),
}));

let SESSIONS = [];
jest.mock("../lib/sessionStore", () => ({
  loadHist: jest.fn(() => ({ sessions: SESSIONS })),
}));

const lookupWord = jest.fn(async (w) => ({ word: w, p: "kæʃ", t: "n. 现金" }));
jest.mock("../lib/dict/lookup", () => ({ lookupWord: (...a) => lookupWord(...a) }));

const FIRST = "这是 AI 讲解：答案句在第二段。";
let QA_REPLY = "答案依据是 [S3]。";
const callAI = jest.fn(async (system) => (system.includes("回答学生对「这一道题」的追问") ? QA_REPLY : FIRST));
jest.mock("../lib/ai/client", () => ({
  ...jest.requireActual("../lib/ai/client"),
  callAI: (...args) => callAI(...args),
}));

import { useReadingAiExplain, ReadingAiExplainBlock } from "../components/reading/useReadingAiExplain";
import { QA_SYSTEM, numberSentences, sentenceLabel, conversationKey } from "../lib/qa/questionQa";
import { saveConversation, pruneStore, QA_DAILY_PREFIX, localDate } from "../lib/qa/qaStore";
import { AI_HELPER_MAX_TOKENS } from "../lib/ai/client";

const PASSAGE =
  "Used textbook sale on Saturday in Room 112. Students can bring their own bags.\n\n" +
  "Prices range from three to twenty-five dollars. Cash only at the door. Doors open at nine.";

const Q = {
  question_type: "detail",
  stem: "According to the flyer, how much will the books cost?",
  options: { A: "Between three and twenty-five dollars", B: "A flat fee of fifteen dollars", C: "Ten dollars", D: "Nothing" },
  correct_answer: "A",
};

const DETAIL = {
  qid: "rdl-1-q0",
  stem: Q.stem,
  question: Q,
  options: Q.options,
  selected: "B",
  correct: "A",
  passage: PASSAGE,
  subtype: "rdl",
  isCorrect: false,
};

function Harness({ detail = DETAIL, variant }) {
  const h = useReadingAiExplain();
  return <div><ReadingAiExplainBlock explainKey={`k-${detail.qid}`} detail={detail} {...h} includeCorrect variant={variant} /></div>;
}

async function openPanel(props) {
  const utils = render(<Harness {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /AI 深入解析/ }));
  fireEvent.click(await screen.findByTestId("qa-open"));
  return utils;
}

const qaCalls = () => callAI.mock.calls.filter((c) => c[0] === QA_SYSTEM);

// 同类错题：另一篇 RDL 的 detail 题答错
const MISTAKE_SESSION = {
  id: 7,
  type: "reading",
  date: "2026-10-01T10:00:00.000Z",
  details: {
    subtype: "rdl",
    itemId: "rdl-other",
    passage: "The gym opens at six. Members must show a card.",
    questions: [{ question_type: "detail", stem: "When does the gym open?", options: { A: "At six", B: "At nine" }, correct_answer: "A" }],
    results: [{ selected: "B", correct: "A", isCorrect: false }],
  },
};

beforeEach(() => {
  TIER = "pro";
  CODE = "ABC123";
  SESSIONS = [MISTAKE_SESSION];
  QA_REPLY = "答案依据是 [S3]。";
  callAI.mockClear();
  lookupWord.mockClear();
  localStorage.clear();
});

describe("显示门槛", () => {
  test("讲解出来后预设问题直接露在下面，点一下就问，不用先展开", async () => {
    render(<Harness />);
    expect(screen.queryByTestId("qa-entry")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /AI 深入解析/ }));
    const entry = await screen.findByTestId("qa-entry");
    expect(entry).toHaveTextContent("还没懂？接着问：");
    expect(screen.getByTestId("qa-entry-parse-key")).toBeInTheDocument();
    expect(screen.getByTestId("qa-entry-simpler")).toBeInTheDocument();
    expect(screen.getByTestId("qa-open")).toHaveTextContent("自己提问");
    expect(screen.queryByTestId("qa-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("qa-entry-parse-key"));
    await waitFor(() => expect(qaCalls()).toHaveLength(1));
    expect(await screen.findByTestId("qa-answer")).toBeInTheDocument();
  });

  test("「我是这么想的…」在入口处点：展开并预填输入框，不发请求", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /AI 深入解析/ }));
    fireEvent.click(await screen.findByTestId("qa-entry-my-thinking"));
    expect(screen.getByTestId("qa-input").value).toBe("我当时选 B，是因为");
    expect(qaCalls()).toHaveLength(0);
  });

  test("问过的题收起后显示「继续追问（已问 N 轮）」", async () => {
    saveConversation("ABC123", conversationKey(DETAIL), { turns: [{ q: "问", a: "答 [S1]", at: "2026-10-12T00:00:00Z" }], related: null });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /AI 深入解析/ }));
    expect(await screen.findByTestId("qa-open")).toHaveTextContent("继续追问（已问 1 轮）");
    expect(screen.queryByTestId("qa-entry")).toBeNull();
  });

  test("讲解前就有「问这道题」：直接打开对话框，不调讲解，没有「讲简单点」", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("qa-ask"));
    expect(screen.getByTestId("qa-input")).toBeInTheDocument();
    expect(screen.queryByTestId("qa-preset-simpler")).toBeNull();
    expect(callAI).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("qa-input"), { target: { value: "这句什么意思" } });
    fireEvent.click(screen.getByTestId("qa-send"));
    await waitFor(() => expect(qaCalls()).toHaveLength(1));
    expect(qaCalls()[0][1]).not.toContain("本题已给出的讲解");
    expect(screen.queryByTestId("qa-ask")).toBeNull();
  });

  test("review 外观讲解前也有「问这道题」", () => {
    render(<Harness variant="review" />);
    expect(screen.getByTestId("qa-ask")).toHaveTextContent("问这道题");
  });

  test("真题记录页的 review 外观同样挂在讲解卡片下面", async () => {
    render(<Harness variant="review" />);
    fireEvent.click(screen.getByRole("button", { name: /AI 讲解/ }));
    expect(await screen.findByTestId("qa-open")).toBeInTheDocument();
  });

  test("非 Pro 看不到", () => {
    TIER = "free";
    render(<Harness />);
    expect(screen.queryByTestId("qa-open")).toBeNull();
    expect(screen.queryByTestId("qa-ask")).toBeNull();
    expect(screen.queryByRole("button", { name: /AI 深入解析/ })).toBeNull();
  });

  test("没有原文的老记录：有讲解，但没有「继续追问」", async () => {
    render(<Harness detail={{ ...DETAIL, passage: "" }} />);
    expect(screen.queryByTestId("qa-ask")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /AI 深入解析/ }));
    await screen.findByText(/答案句在第二段/);
    expect(screen.queryByTestId("qa-open")).toBeNull();
    expect(screen.queryByTestId("qa-entry")).toBeNull();
  });
});

describe("请求内容", () => {
  test("拆解答案句：system 是 QA_SYSTEM，message 带句号、作答、第一轮讲解，不带同类错题", async () => {
    await openPanel();
    fireEvent.click(screen.getByTestId("qa-preset-parse-key"));
    await waitFor(() => expect(qaCalls()).toHaveLength(1));
    const [system, message, maxTokens, timeoutMs, temperature] = qaCalls()[0];
    expect(system).toBe(QA_SYSTEM);
    expect(message).toContain("[S1]");
    expect(message).toContain("学生作答：B. A flat fee of fifteen dollars");
    expect(message).toContain("【本题已给出的讲解】");
    expect(message).toContain(FIRST);
    expect(message).not.toContain("同类错题");
    expect([maxTokens, timeoutMs, temperature]).toEqual([AI_HELPER_MAX_TOKENS * 2, 60000, 0.3]);
  });

  test("「我是这么想的…」只预填输入框，不发请求；补完发出后附上同类错题", async () => {
    await openPanel();
    fireEvent.click(screen.getByTestId("qa-preset-my-thinking"));
    const input = screen.getByTestId("qa-input");
    expect(input.value).toBe("我当时选 B，是因为");
    expect(qaCalls()).toHaveLength(0);
    fireEvent.change(input, { target: { value: "我当时选 B，是因为我以为是统一价" } });
    fireEvent.click(screen.getByTestId("qa-send"));
    await waitFor(() => expect(qaCalls()).toHaveLength(1));
    expect(qaCalls()[0][1]).toContain("[错题1]");
    expect(qaCalls()[0][1]).toContain("When does the gym open?");
  });

  test("没作答的题不出「我是这么想的…」", async () => {
    await openPanel({ detail: { ...DETAIL, selected: null } });
    expect(screen.queryByTestId("qa-preset-my-thinking")).toBeNull();
    expect(screen.getByTestId("qa-preset-parse-key")).toBeInTheDocument();
  });

  test("自由提问只问到原文里的一个词时，message 带词典词条", async () => {
    await openPanel();
    fireEvent.change(screen.getByTestId("qa-input"), { target: { value: "cash 在这里什么意思" } });
    fireEvent.click(screen.getByTestId("qa-send"));
    await waitFor(() => expect(qaCalls()).toHaveLength(1));
    expect(lookupWord).toHaveBeenCalledWith("cash");
    expect(qaCalls()[0][1]).toContain("【词典】（ECDICT）cash");
  });
});

describe("出处渲染", () => {
  const sentences = numberSentences(PASSAGE);

  test("有效出处显示成「第 x 段第 y 句」，点开显示原句", async () => {
    await openPanel();
    fireEvent.click(screen.getByTestId("qa-preset-simpler"));
    const tag = await screen.findByTestId("qa-cite");
    expect(tag).toHaveTextContent(sentenceLabel(sentences[2], sentences));
    expect(tag).toHaveTextContent("第 2 段第 1 句");
    fireEvent.click(tag);
    expect(screen.getByTestId("qa-cite-sentence")).toHaveTextContent(sentences[2].text);
    expect(screen.queryByTestId("qa-bad-note")).toBeNull();
  });

  test("核不上的出处标灰并给提示；引文找不到标虚线", async () => {
    QA_REPLY = "见 [S9]，原文说 \"books are free\"。";
    await openPanel();
    fireEvent.click(screen.getByTestId("qa-preset-simpler"));
    expect(await screen.findByTestId("qa-cite-bad")).toHaveAttribute("title", "这条出处核对不上，请以原文为准");
    expect(screen.getByTestId("qa-bad-quote")).toHaveTextContent("\"books are free\"");
    expect(screen.getByTestId("qa-bad-note")).toHaveTextContent("有 2 处出处或引文核对不上");
  });

  test("[错题N] 按那一轮实际附的错题核对：后来加载了错题，旧回答里编的仍是灰标", async () => {
    QA_REPLY = "你上次 [错题1] 也是这样。";
    await openPanel();
    fireEvent.click(screen.getByTestId("qa-preset-simpler"));
    expect(await screen.findByTestId("qa-cite-bad")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("qa-preset-my-thinking"));
    fireEvent.change(screen.getByTestId("qa-input"), { target: { value: "我当时选 B，是因为我以为是统一价" } });
    fireEvent.click(screen.getByTestId("qa-send"));
    await waitFor(() => expect(screen.getAllByTestId("qa-answer")).toHaveLength(2));
    const [first, second] = screen.getAllByTestId("qa-answer");
    expect(first.querySelector('[data-testid="qa-cite-bad"]')).not.toBeNull();
    expect(second.querySelector('[data-testid="qa-cite-bad"]')).toBeNull();
  });

  test("这一轮没附词典却写了 [词典]，标灰", async () => {
    QA_REPLY = "按 [词典] 的意思。";
    await openPanel();
    fireEvent.click(screen.getByTestId("qa-preset-simpler"));
    expect(await screen.findByTestId("qa-cite-bad")).toHaveTextContent("词典?");
  });

  test("回答里的 markdown 星号被去掉", async () => {
    QA_REPLY = "**结论**：看 [S3]。";
    await openPanel();
    fireEvent.click(screen.getByTestId("qa-preset-simpler"));
    const ans = await screen.findByTestId("qa-answer");
    expect(ans.textContent).not.toContain("**");
  });
});

describe("轮数、出错与上限", () => {
  test("出错时显示错误、问题留在输入框、不计轮数；重试成功后清空", async () => {
    callAI.mockImplementationOnce(async () => FIRST).mockImplementationOnce(async () => { throw new Error("API timeout"); });
    await openPanel();
    const input = screen.getByTestId("qa-input");
    fireEvent.change(input, { target: { value: "第二段第一句的主干是什么" } });
    fireEvent.click(screen.getByTestId("qa-send"));
    expect(await screen.findByText("AI 响应超时，请重试")).toBeInTheDocument();
    expect(input.value).toBe("第二段第一句的主干是什么");
    expect(screen.queryByTestId("qa-answer")).toBeNull();
    fireEvent.click(screen.getByTestId("qa-retry"));
    expect(await screen.findByTestId("qa-answer")).toBeInTheDocument();
    expect(input.value).toBe("");
    expect(screen.getByTestId("qa-status")).toHaveTextContent("还可以追问 5 次");
  });

  test("每日名额发请求前就占上，失败退回", async () => {
    const daily = () => JSON.parse(localStorage.getItem(`${QA_DAILY_PREFIX}:ABC123`) || "{}").n || 0;
    let fail;
    callAI.mockImplementationOnce(async () => FIRST).mockImplementationOnce(() => new Promise((_, rej) => { fail = rej; }));
    await openPanel();
    fireEvent.change(screen.getByTestId("qa-input"), { target: { value: "这句什么意思" } });
    fireEvent.click(screen.getByTestId("qa-send"));
    await waitFor(() => expect(fail).toBeDefined());
    expect(daily()).toBe(1);
    await act(async () => fail(new Error("API timeout")));
    expect(await screen.findByText("AI 响应超时，请重试")).toBeInTheDocument();
    expect(daily()).toBe(0);
  });

  test("等回答时已经开始打下一问，回答回来不清掉草稿", async () => {
    let done;
    callAI.mockImplementationOnce(async () => FIRST).mockImplementationOnce(() => new Promise((res) => { done = res; }));
    await openPanel();
    const input = screen.getByTestId("qa-input");
    fireEvent.change(input, { target: { value: "这句什么意思" } });
    fireEvent.click(screen.getByTestId("qa-send"));
    await waitFor(() => expect(done).toBeDefined());
    fireEvent.change(input, { target: { value: "那第三句呢" } });
    await act(async () => done("答案依据是 [S3]。"));
    expect(await screen.findByTestId("qa-answer")).toBeInTheDocument();
    expect(input.value).toBe("那第三句呢");
  });

  test("满 6 轮后输入框禁用", async () => {
    const turns = Array.from({ length: 6 }, (_, i) => ({ q: `问${i}`, a: `答${i} [S1]`, at: "2026-10-12T00:00:00Z" }));
    saveConversation("ABC123", conversationKey(DETAIL), { turns, related: null });
    await openPanel();
    expect(screen.getAllByTestId("qa-answer")).toHaveLength(6);
    expect(screen.getByTestId("qa-input")).toBeDisabled();
    expect(screen.getByTestId("qa-status")).toHaveTextContent("这题聊得够多了");
  });

  test("每天 30 轮到了就不再发，文案不出现「上限」", async () => {
    localStorage.setItem(`${QA_DAILY_PREFIX}:ABC123`, JSON.stringify({ date: localDate(), n: 30 }));
    await openPanel();
    const status = screen.getByTestId("qa-status");
    expect(status).toHaveTextContent("今天的追问已经很多了，明天再继续吧；写作批改不受影响");
    expect(status.textContent).not.toContain("上限");
    expect(screen.getByTestId("qa-preset-parse-key")).toBeDisabled();
  });

  test("输入法组字时按 Enter 不发送；平时 Enter 发送", async () => {
    await openPanel();
    const input = screen.getByTestId("qa-input");
    fireEvent.change(input, { target: { value: "这句什么意思" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(qaCalls()).toHaveLength(0);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(qaCalls()).toHaveLength(1));
  });
});

describe("存档", () => {
  test("卸载后重新渲染能读回；换账号读不到；同题干同作答的另一篇文章不串", async () => {
    const { unmount } = await openPanel();
    fireEvent.click(screen.getByTestId("qa-preset-simpler"));
    await screen.findByTestId("qa-answer");
    unmount();

    // 第一轮讲解命中缓存会自己回填，不用再点
    const again = render(<Harness />);
    expect(await screen.findByTestId("qa-open")).toHaveTextContent("继续追问（已问 1 轮）");
    again.unmount();

    const other = render(<Harness detail={{ ...DETAIL, qid: "", passage: "A different flyer about a bake sale. It starts at noon." }} />);
    fireEvent.click(screen.getByRole("button", { name: /AI 深入解析/ }));
    expect(await screen.findByTestId("qa-open")).toHaveTextContent(/^自己提问$/);
    other.unmount();

    CODE = "OTHER9";
    render(<Harness />);
    expect(await screen.findByTestId("qa-open")).toHaveTextContent(/^自己提问$/);
  });

  test("只剩一个会话也超线时，从它最早的轮次开始丢", () => {
    const turns = Array.from({ length: 6 }, (_, i) => ({ q: `q${i}`, a: "答".repeat(30000) }));
    const pruned = pruneStore({ only: { turns, updatedAt: "2026-10-12" } });
    expect(JSON.stringify(pruned).length).toBeLessThanOrEqual(100000);
    expect(pruned.only.turns.map((t) => t.q)).toEqual(["q3", "q4", "q5"]);
  });

  test("超过 100,000 字符时从最旧的开始淘汰", () => {
    const store = {};
    for (let i = 0; i < 30; i++) store[`k${i}`] = { turns: [{ q: "q", a: "答".repeat(5000) }], updatedAt: `2026-10-${String(i + 1).padStart(2, "0")}` };
    const pruned = pruneStore(store);
    expect(JSON.stringify(pruned).length).toBeLessThanOrEqual(100000);
    expect(pruned.k29).toBeTruthy();
    expect(pruned.k0).toBeUndefined();
  });
});

describe("上报", () => {
  test("还没追问时，页脚上报带第一轮讲解", async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    const prev = global.fetch;
    global.fetch = fetchMock;
    try {
      await openPanel();
      fireEvent.click(screen.getByTestId("qa-report-link"));
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "提交上报" })); });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).content).toContain(`AI 原话：${FIRST}`);
    } finally {
      global.fetch = prev;
    }
  });

  test("点哪条回答下的「上报这题」就上报哪条的原话", async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    const prev = global.fetch;
    global.fetch = fetchMock;
    try {
      QA_REPLY = "第一轮：这题答案与原文可能有出入，建议上报核对。";
      await openPanel();
      fireEvent.click(screen.getByTestId("qa-preset-simpler"));
      await screen.findByRole("button", { name: "上报这题" });
      QA_REPLY = "第二轮：普通回答 [S1]。";
      fireEvent.click(screen.getByTestId("qa-preset-parse-key"));
      await waitFor(() => expect(screen.getAllByTestId("qa-answer")).toHaveLength(2));
      fireEvent.click(screen.getByRole("button", { name: "上报这题" }));
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "提交上报" })); });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.content).toContain("第一轮");
      expect(body.content).not.toContain("第二轮");
    } finally {
      global.fetch = prev;
    }
  });

  test("提交到 /api/feedback，content 带 qid 且不超过 2000 字", async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    const prev = global.fetch;
    global.fetch = fetchMock;
    try {
      QA_REPLY = `这题答案与原文可能有出入，建议上报核对。${"很长".repeat(400)}`;
      await openPanel();
      fireEvent.click(screen.getByTestId("qa-preset-simpler"));
      fireEvent.click(await screen.findByRole("button", { name: "上报这题" }));
      fireEvent.change(screen.getByPlaceholderText(/补充一句/), { target: { value: "我也觉得 B 对" } });
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "提交上报" })); });
      expect(fetchMock).toHaveBeenCalledWith("/api/feedback", expect.anything());
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.userCode).toBe("ABC123");
      expect(body.content.length).toBeLessThanOrEqual(2000);
      expect(body.content).toContain("qid=rdl-1-q0");
      expect(body.content).toContain("[答疑上报]");
      expect(await screen.findByText(/已上报/)).toBeInTheDocument();
    } finally {
      global.fetch = prev;
    }
  });
});

describe("举一反三（练习记录里同题型的题，对错各至多 2 道）", () => {
  const right = (n, date) => ({
    id: 100 + n, type: "reading", date,
    details: { subtype: "rdl", itemId: `rdl-r${n}`, passage: "Lunch is served at noon.",
      questions: [{ question_type: "detail", stem: `When is lunch served? (${n})`, options: { A: "At noon", B: "At one" }, correct_answer: "A" }],
      results: [{ selected: "A", correct: "A", isCorrect: true }] },
  });

  test("有以前做过的同题型题才出按钮；点了 message 带对比题，回答里的 [题N] 可点开", async () => {
    SESSIONS = [MISTAKE_SESSION, right(1, "2026-10-02"), right(2, "2026-10-05"), right(3, "2026-10-03")];
    QA_REPLY = "先说本题 [S3]。再看 [题1]：你选了 \"At nine\"，和这题一样是偷换概念；[题2] 你做对了。[题9] 不存在。";
    await openPanel();
    fireEvent.click(screen.getByTestId("qa-preset-analogy"));
    await waitFor(() => expect(qaCalls()).toHaveLength(1));
    const message = qaCalls()[0][1];
    expect(message).toContain("学生以前做过的同题型题（共 4 道：做错 1、做对 3；挑了下面 3 道");
    expect(message).toContain("[题1] 2026-10-01 做错｜题目：When does the gym open?");
    // 做对的按时间挑最近 2 道
    expect(message).toContain("(2)");
    expect(message).toContain("(3)");
    expect(message).not.toContain("(1)");
    // 举一反三优先，不再另附错题
    expect(message).not.toContain("学生以前的同类错题");
    const answer = await screen.findByTestId("qa-answer");
    const tags = answer.querySelectorAll('[data-testid="qa-cite-past-tag"]');
    expect(tags).toHaveLength(2);
    expect(answer.querySelector('[data-testid="qa-bad-quote"]')).toBeNull();
    expect(answer.querySelectorAll('[data-testid="qa-cite-bad"]')).toHaveLength(1);
    fireEvent.click(tags[0]);
    expect(screen.getByTestId("qa-cite-past")).toHaveTextContent("When does the gym open?");
  });

  test("没有同题型的记录就不出按钮", async () => {
    SESSIONS = [];
    await openPanel();
    expect(screen.queryByTestId("qa-preset-analogy")).toBeNull();
  });

  test("自由提问说「这类题」也会触发", async () => {
    await openPanel();
    fireEvent.change(screen.getByTestId("qa-input"), { target: { value: "这类题一般怎么找答案？" } });
    fireEvent.click(screen.getByTestId("qa-send"));
    await waitFor(() => expect(qaCalls()).toHaveLength(1));
    expect(qaCalls()[0][1]).toContain("学生以前做过的同题型题");
  });
});

