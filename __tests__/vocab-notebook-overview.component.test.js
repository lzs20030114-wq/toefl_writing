/**
 * 单词本概览页（真实 hook + 真实 localStorage）：今日计划、筛选/排序、记忆分布、7 天预测、
 * 暂停/编辑释义、存档续做、复习专注模式回调。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import VocabNotebook from "../components/vocab/VocabNotebook";
import { writeReviewSave } from "../lib/vocab/reviewSave";
import { STATE } from "../lib/vocab/srs";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
  AUTH_CHANGED_EVENT: "auth-changed",
}));
jest.mock("../components/vocab/RootExplorer", () => () => null);
jest.mock("../components/shared/SpeakButton", () => ({ SpeakButton: () => null }));
// 听力复习的「播放单词发音」：同步走完 开始→结束，等于立刻听完
jest.mock("../lib/audio/speakWord", () => ({
  canSpeak: () => true,
  cancelSpeakWord: () => {},
  speakWord: (word, cb) => { cb.onStart?.(); cb.onEnd?.(); cb.onDone?.(); return true; },
}));

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const base = () => Date.now();

function seed() {
  const now = base();
  const due = (word, over = {}) => ({
    word, def: `n. ${word}义`, sentence: `We saw the ${word} again.`, source: "reading", state: STATE.REVIEW,
    stability: 6, difficulty: 5, scheduledDays: 6, reps: 3, lastReview: iso(now - 8 * DAY), due: iso(now - DAY),
    introducedAt: iso(now - 20 * DAY), createdAt: iso(now - 30 * DAY), ...over,
  });
  const cards = [
    due("alpha"), due("bravo", { lapses: 4, spellingOptOut: true }), due("charlie", { spellingOptOut: true }),
    due("delta", { scheduledDays: 40, stability: 60, due: iso(now + 30 * DAY), lastReview: iso(now - 10 * DAY) }),
    due("echo", { due: iso(now + 2 * DAY), lastReview: iso(now - 4 * DAY) }),
    { word: "fresh", def: "n. 新词", source: "reading", createdAt: iso(now - DAY) },
    { word: "heard", def: "n. 听到", source: "listening", reviewMode: "listening", createdAt: iso(now - DAY) },
  ];
  localStorage.setItem("toefl-vocab-book::guest", JSON.stringify({ v: 1, cards }));
}

const library = () => screen.getByRole("region", { name: "词库列表" });
const wordsShown = () => within(library()).getAllByRole("button", { name: /更多操作$/ }).map((b) => b.getAttribute("aria-label").replace(" 更多操作", ""));

beforeEach(() => { localStorage.clear(); seed(); });

test("今日计划：总量、预计时间、进度，以及阅读/听力两列的到期·新词·考拼写", () => {
  render(<VocabNotebook embedded />);
  expect(screen.getByText("今日复习 5 词")).toBeInTheDocument(); // alpha bravo charlie + fresh + heard
  expect(screen.getByText("预计约 1 分钟")).toBeInTheDocument();
  expect(screen.getByText("0 / 5")).toBeInTheDocument();
  expect(screen.getByText("到期 3")).toBeInTheDocument();
  expect(screen.getAllByText("新词 1")).toHaveLength(2); // 阅读、听力各 1
  expect(screen.getByText("考拼写 1")).toBeInTheDocument(); // 只有 alpha 要拼
  expect(screen.getByRole("button", { name: /^阅读复习，今天 4 个词/ })).toHaveTextContent("开始阅读复习");
  expect(screen.getByRole("button", { name: /^听力复习，今天 1 个词/ })).toHaveTextContent("开始听力复习");
});

test("状态筛选 chip 带数量；易忘词带标；排序可切换", () => {
  render(<VocabNotebook embedded />);
  const chips = screen.getByRole("group", { name: "状态筛选" });
  expect(within(chips).getByRole("button", { name: /^全部\s*7$/ })).toBeInTheDocument();
  expect(within(chips).getByRole("button", { name: /^今天要复习\s*3$/ })).toBeInTheDocument();
  expect(within(chips).getByRole("button", { name: /^易忘\s*1$/ })).toBeInTheDocument();
  expect(within(chips).getByRole("button", { name: /^已记牢\s*1$/ })).toBeInTheDocument();
  expect(within(chips).getByRole("button", { name: /^未开始\s*2$/ })).toBeInTheDocument();

  fireEvent.click(within(chips).getByRole("button", { name: /^易忘\s*1$/ }));
  expect(wordsShown()).toEqual(["bravo"]);
  expect(within(library()).getByText("易忘 · 忘过 4 次")).toBeInTheDocument();

  fireEvent.click(within(chips).getByRole("button", { name: /^全部\s*7$/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "排序方式" }), { target: { value: "alpha" } });
  expect(wordsShown()).toEqual(["alpha", "bravo", "charlie", "delta", "echo", "fresh", "heard"]);
  fireEvent.change(screen.getByRole("combobox", { name: "排序方式" }), { target: { value: "forgettable" } });
  expect(wordsShown()[0]).toBe("bravo");
});

test("记忆分布：数字按阶段互斥，点一行就筛到那一类；未来 7 天卡有总数", () => {
  render(<VocabNotebook embedded />);
  const side = screen.getByRole("complementary", { name: "单词本工具" });
  expect(within(side).getByRole("button", { name: "查看已记牢的词，1 个" })).toBeInTheDocument();
  expect(within(side).getByRole("button", { name: "查看未开始的词，2 个" })).toBeInTheDocument();
  expect(within(side).getByRole("button", { name: "查看复习中的词，4 个" })).toBeInTheDocument();
  fireEvent.click(within(side).getByRole("button", { name: "查看已记牢的词，1 个" }));
  expect(wordsShown()).toEqual(["delta"]);

  const forecast = within(side).getByRole("region", { name: "未来 7 天" });
  expect(within(forecast).getByText(/^共 \d+ 词$/)).toBeInTheDocument();
  expect(within(forecast).getByText("今天")).toBeInTheDocument();
});

test("暂停复习：不再进今日计划、出现「已暂停」筛选，可恢复", () => {
  render(<VocabNotebook embedded />);
  fireEvent.click(screen.getByRole("button", { name: "alpha 更多操作" }));
  fireEvent.click(screen.getByRole("button", { name: "暂停复习" }));
  expect(screen.getByText("今日复习 4 词")).toBeInTheDocument();
  const chips = screen.getByRole("group", { name: "状态筛选" });
  fireEvent.click(within(chips).getByRole("button", { name: /^已暂停\s*1$/ }));
  expect(wordsShown()).toEqual(["alpha"]);
  expect(within(library()).getAllByText("已暂停").length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole("button", { name: "alpha 更多操作" }));
  fireEvent.click(screen.getByRole("button", { name: "恢复复习" }));
  expect(screen.getByText("今日复习 5 词")).toBeInTheDocument();
});

test("行内编辑释义：保存后列表立刻显示，空释义不能保存", () => {
  render(<VocabNotebook embedded />);
  fireEvent.click(screen.getByRole("button", { name: "alpha 更多操作" }));
  expect(screen.getByText(/We saw the/)).toBeInTheDocument(); // 语境句
  fireEvent.click(screen.getByRole("button", { name: "编辑释义" }));
  const box = screen.getByRole("textbox", { name: "alpha的释义" });
  fireEvent.change(box, { target: { value: "  " } });
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  fireEvent.change(box, { target: { value: "我改的释义" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(screen.getByText("我改的释义")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("toefl-vocab-book::guest")).cards.find((c) => c.word === "alpha")).toMatchObject({ def: "我改的释义", definitionLocked: true });
});

test("有存档时主按钮变成「从存档继续」，可重新开始（清存档）", () => {
  writeReviewSave("guest", "reading", { words: ["alpha", "bravo"], answered: 10, tally: { good: 8, again: 2 }, first: {}, seen: {}, lost: [], segNo: 1, elapsedMs: 1000, startStats: null });
  render(<VocabNotebook embedded />);
  expect(screen.getByRole("button", { name: /从存档继续 · 第 11 张起/ })).toBeInTheDocument();
  expect(screen.getByText(/存档于第 1 段结束（已答 10 张）/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新开始" }));
  expect(screen.queryByText(/存档于第/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^阅读复习，今天 4 个词/ })).toHaveTextContent("开始阅读复习");
});

test("开始复习 → 通知外层进入专注模式；退出后还原", () => {
  const onReviewingChange = jest.fn();
  render(<VocabNotebook embedded onReviewingChange={onReviewingChange} />);
  expect(onReviewingChange).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole("button", { name: /^阅读复习，今天 4 个词/ }));
  expect(screen.getByRole("button", { name: "← 退出" })).toBeInTheDocument();
  expect(onReviewingChange).toHaveBeenLastCalledWith(true);
  expect(screen.getByText("本段 0 / 10")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "← 退出" }));
  expect(screen.getByText("今日复习 5 词")).toBeInTheDocument();
  expect(onReviewingChange).toHaveBeenLastCalledWith(false);
});

test("评分后今日进度推进，撤销后退回", () => {
  render(<VocabNotebook embedded />);
  fireEvent.click(screen.getByRole("button", { name: /^阅读复习，今天 4 个词/ }));
  const reveal = () => fireEvent.click(screen.getByRole("button", { name: /显示答案/ }));
  // 第一张可能是拼写卡（alpha），按「想不起来」走；其余认词卡直接翻面评「记得」
  const answerOne = () => {
    if (screen.queryByRole("textbox", { name: "拼写英文单词" })) {
      fireEvent.click(screen.getByRole("button", { name: "想不起来，显示答案" }));
      fireEvent.click(screen.getByRole("button", { name: "忘了，下一词" }));
    } else {
      reveal();
      fireEvent.click(screen.getByRole("button", { name: /记得/ }));
    }
  };
  answerOne();
  expect(screen.getByText(/已答 1 · 剩 /)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /撤销上一张/ }));
  expect(screen.getByText(/已答 0 · 剩 4/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "← 退出" }));
  expect(screen.getByText("0 / 5")).toBeInTheDocument();
});

test("听力复习接上撤销与结算页：评分/撤销写进真实存储，练完可接着做阅读复习", () => {
  const book = JSON.parse(localStorage.getItem("toefl-vocab-book::guest"));
  book.cards.push({ word: "heard2", def: "n. 又听到", source: "listening", reviewMode: "listening", createdAt: iso(base() - DAY) });
  localStorage.setItem("toefl-vocab-book::guest", JSON.stringify(book));
  const touched = () => JSON.parse(localStorage.getItem("toefl-vocab-book::guest")).cards
    .filter((c) => c.reviewMode === "listening" && c.listeningState && c.listeningState.state !== STATE.NEW).length;

  render(<VocabNotebook embedded />);
  fireEvent.click(screen.getByRole("button", { name: /^听力复习，今天 2 个词/ }));
  const answer = (label) => {
    fireEvent.click(screen.getByRole("button", { name: "播放单词发音" }));
    fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
  };
  expect(screen.getByRole("button", { name: /撤销上一张/ })).toBeDisabled();

  answer("没听懂");
  expect(touched()).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: /撤销上一张/ }));
  expect(touched()).toBe(0); // 评分写进存储的状态被退回
  expect(screen.getByRole("button", { name: "听懂了" })).toBeInTheDocument(); // 同一张卡，已翻面

  fireEvent.click(screen.getByRole("button", { name: "听懂了" }));
  answer("没听懂");
  expect(touched()).toBe(2);
  expect(screen.getByText("这一轮听力复习完成")).toBeInTheDocument();
  expect(screen.getByText("这一轮没听懂的词")).toBeInTheDocument();
  expect(screen.getByText("阅读复习还有 4 词")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "开始阅读复习" }));
  expect(screen.getByText("本段 0 / 10")).toBeInTheDocument();
});
