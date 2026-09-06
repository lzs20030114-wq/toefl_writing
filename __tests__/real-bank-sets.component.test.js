/**
 * 「真题专区 · 按考试场次」路由接线（app/real-bank/sets/page.js）+ 题型页深链接
 * （app/real-bank/page.js 的 ?item= / ?set=）。
 *
 * mock 手法照搬 real-bank-upgrade.component.test.js：阅读三库换成两场固定夹具，
 * 任务组件只验接线。
 */
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("../components/shared/UpgradeModal", () => ({
  __esModule: true,
  default: ({ userCode, currentTier }) => (
    <div data-testid="upgrade-modal">code={String(userCode)} tier={String(currentTier)}</div>
  ),
}));

jest.mock("../lib/AuthContext", () => ({
  getSavedTier: jest.fn(() => "free"),
  getSavedCode: jest.fn(() => "REAL01"),
}));

let mockSearch = new URLSearchParams();
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearch,
}));

jest.mock("../components/shared/UsageGateWrapper", () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));
jest.mock("../components/shared/TopicPicker", () => ({
  TopicPicker: ({ title, items }) => (
    <div data-testid="topic-picker">
      <div data-testid="picker-title">{title}</div>
      <div data-testid="picker-count">{items.length}</div>
    </div>
  ),
}));
jest.mock("../components/writing/WritingTask", () => ({ WritingTask: () => <div data-testid="writing-task" /> }));
jest.mock("../components/buildSentence/BuildSentenceTask", () => ({ BuildSentenceTask: () => <div data-testid="bs-task" /> }));
jest.mock("../components/reading/CTWTask", () => ({
  CTWTask: ({ item, onExit, onComplete }) => (
    <div data-testid="ctw-task">
      id={item.id}
      <button data-testid="ctw-exit" onClick={onExit}>exit</button>
      <button data-testid="ctw-finish" onClick={() => onComplete({ results: [], correct: 2, total: 2 })}>finish</button>
    </div>
  ),
}));
jest.mock("../components/reading/RDLTask", () => ({
  RDLTask: ({ item, onExit }) => (
    <div data-testid="rdl-task">
      id={item.id}
      <button data-testid="rdl-exit" onClick={onExit}>exit</button>
    </div>
  ),
}));

// 两场：9.9 A 卷（ctw 1 + rdl 1 + ap 1，带 warn flag）和 8.1（ap 1，无 flag）。
jest.mock("../data/realBank/reading/ctw.json", () => ({
  tier: "recalled", count: 1,
  items: [{
    id: "real_ctw_fx_1_1",
    passage: "Coral reefs support marine life. The tiny polyps build limestone skeletons over many centuries.",
    word_count: 14, topic: "biology", subtopic: "",
    blanks: [
      { position: 7, original_word: "polyps", displayed_fragment: "pol" },
      { position: 13, original_word: "centuries", displayed_fragment: "cent" },
    ],
    blank_count: 2, first_sentence: "Coral reefs support marine life.", difficulty: "medium",
    real: true, tier: "recalled", source: "9.9新托福真题A卷", date: "2026-09-09",
    source_flags: [{ code: "duplicate_cluster", severity: "warn", detail: "与 9.12 同题簇" }],
  }],
}));
jest.mock("../data/realBank/reading/rdl.json", () => ({
  tier: "recalled", count: 1,
  items: [{
    id: "real_rdl_fx_1_21", genre: "notice",
    text: "Campus Notice: the library closes at six on Friday.",
    questions: [{ question_type: "detail", stem: "When?", options: { A: "5", B: "6", C: "7", D: "8" }, correct_answer: "B" }],
    format_metadata: {}, difficulty: "medium",
    real: true, tier: "recalled", source: "9.9新托福真题A卷", date: "2026-09-09",
    source_flags: [{ code: "duplicate_cluster", severity: "warn", detail: "与 9.12 同题簇" }],
  }],
}));
jest.mock("../data/realBank/reading/ap.json", () => ({
  tier: "recalled", count: 2,
  items: [
    {
      id: "real_ap_fx_2_24", topic: "biology", subtopic: "",
      passage: "Photosynthesis converts light energy into chemical energy.", paragraphs: [],
      questions: [{ question_type: "main_idea", stem: "Main idea?", options: { A: "P", B: "E", C: "M", D: "V" }, correct_answer: "A" }],
      difficulty: "medium", real: true, tier: "recalled", source: "9.9新托福真题A卷", date: "2026-09-09",
      source_flags: [{ code: "duplicate_cluster", severity: "warn", detail: "与 9.12 同题簇" }],
    },
    {
      id: "real_ap_fx_3_25", topic: "history", subtopic: "",
      passage: "The printing press changed how information spread across Europe.", paragraphs: [],
      questions: [
        { question_type: "detail", stem: "Q1", options: { A: "a", B: "b", C: "c", D: "d" }, correct_answer: "A" },
        { question_type: "detail", stem: "Q2", options: { A: "a", B: "b", C: "c", D: "d" }, correct_answer: "B" },
      ],
      difficulty: "medium", real: true, tier: "recalled", source: "8.1新托福真题", date: "2026-08-01",
      source_flags: [],
    },
  ],
}));

import RealSetsPage from "../app/real-bank/sets/page";
import RealBankPage from "../app/real-bank/page";
import { getSavedTier } from "../lib/AuthContext";
import { addDoneIds, loadDoneIds, loadHist } from "../lib/sessionStore";
import { DONE_STORAGE_KEYS } from "../lib/questionSelector";

const SET_A = "9.9新托福真题A卷";
const SET_B = "8.1新托福真题";

beforeEach(() => {
  mockSearch = new URLSearchParams();
  mockPush.mockClear();
  getSavedTier.mockReturnValue("pro");
  try { sessionStorage.clear(); localStorage.clear(); } catch {}
});

describe("场次页：Pro 门禁（自持 UpgradeModal，与题型页同一套）", () => {
  test("免费用户看到锁定屏，点「升级 Pro」弹 UpgradeModal", async () => {
    getSavedTier.mockReturnValue("free");
    render(<RealSetsPage />);
    const btn = await screen.findByRole("button", { name: /升级 Pro/ });
    expect(screen.queryByTestId(`real-set-${SET_A}`)).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByTestId("upgrade-modal").textContent).toContain("REAL01");
  });
});

describe("场次总览", () => {
  test("Pro 用户看到两场，最近一场在前，每场链接到自己的详情页", async () => {
    render(<RealSetsPage />);
    const a = await screen.findByTestId(`real-set-${SET_A}`);
    const b = screen.getByTestId(`real-set-${SET_B}`);
    expect(a.getAttribute("href")).toBe(`/real-bank/sets?set=${encodeURIComponent(SET_A)}`);
    expect(b.getAttribute("href")).toBe(`/real-bank/sets?set=${encodeURIComponent(SET_B)}`);
    // DOM 顺序：9.9 在 8.1 之前
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("场次行显示卷名、各题型题量 chip、进度 0/N，来源 warn 只提示一次", async () => {
    render(<RealSetsPage />);
    const a = await screen.findByTestId(`real-set-${SET_A}`);
    expect(a.textContent).toContain(SET_A);
    expect(a.textContent).toContain("阅读填词");
    expect(a.textContent).toContain("日常阅读");
    expect(a.textContent).toContain("学术阅读");
    expect(a.textContent).toContain("0/3 题");
    expect(a.textContent).toContain("回忆版");
    expect((a.textContent.match(/与 9\.12 同题簇/g) || []).length).toBe(1);
    const b = screen.getByTestId(`real-set-${SET_B}`);
    expect(b.textContent).not.toContain("阅读填词");
    expect(b.textContent).toContain("0/1 题");
  });

  test("已练进度读的是常规练习页写入的那把 key", async () => {
    addDoneIds(DONE_STORAGE_KEYS.READING_AP, ["real_ap_fx_2_24"]);
    render(<RealSetsPage />);
    const a = await screen.findByTestId(`real-set-${SET_A}`);
    expect(a.textContent).toContain("1/3 题");
  });

  test("按题型快捷入口六个都在（两种找题方式并存）", async () => {
    render(<RealSetsPage />);
    await screen.findByTestId(`real-set-${SET_A}`);
    ["discussion", "email", "bs", "ctw", "rdl", "ap"].forEach((t) => {
      expect(document.querySelector(`a[href="/real-bank?type=${t}"]`)).toBeTruthy();
    });
  });
});

describe("场次详情", () => {
  test("?set= 命中 → 按题型分组列题，点题跳深链接（type + item + set）", async () => {
    mockSearch = new URLSearchParams(`set=${encodeURIComponent(SET_A)}`);
    render(<RealSetsPage />);
    expect((await screen.findByTestId("real-set-header")).textContent).toContain(SET_A);
    expect(screen.getByTestId("real-set-item-real_ctw_fx_1_1")).toBeTruthy();
    expect(screen.getByTestId("real-set-item-real_rdl_fx_1_21")).toBeTruthy();
    expect(screen.getByTestId("real-set-item-real_ap_fx_2_24")).toBeTruthy();
    expect(screen.queryByTestId("real-set-item-real_ap_fx_3_25")).toBeNull();

    fireEvent.click(screen.getByTestId("real-set-item-real_rdl_fx_1_21"));
    expect(mockPush).toHaveBeenCalledWith(
      `/real-bank?type=rdl&item=real_rdl_fx_1_21&set=${encodeURIComponent(SET_A)}`
    );
  });

  test("「开始这一场 / 接着练」跳到第一道没做过的题", async () => {
    addDoneIds(DONE_STORAGE_KEYS.READING_CTW, ["real_ctw_fx_1_1"]);
    mockSearch = new URLSearchParams(`set=${encodeURIComponent(SET_A)}`);
    render(<RealSetsPage />);
    const btn = await screen.findByTestId("real-set-continue");
    expect(btn.textContent).toBe("接着练");
    fireEvent.click(btn);
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("type=rdl&item=real_rdl_fx_1_21"));
  });

  test("全部做完 → 没有「接着练」按钮，进度满", async () => {
    addDoneIds(DONE_STORAGE_KEYS.READING_AP, ["real_ap_fx_3_25"]);
    mockSearch = new URLSearchParams(`set=${encodeURIComponent(SET_B)}`);
    render(<RealSetsPage />);
    await screen.findByTestId("real-set-header");
    expect(screen.queryByTestId("real-set-continue")).toBeNull();
    expect(screen.getByTestId("real-set-item-real_ap_fx_3_25").textContent).toContain("已练");
  });

  test("?set= 找不到 → 逃生口回场次列表，不白屏", async () => {
    mockSearch = new URLSearchParams("set=不存在的卷");
    render(<RealSetsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /返回场次列表/ }));
    expect(mockPush).toHaveBeenCalledWith("/real-bank/sets");
  });
});

describe("题型页深链接（?item= / ?set=）", () => {
  test("?type=ctw&item=… 跳过 picker 直接进答题，banner 带来源提示", async () => {
    mockSearch = new URLSearchParams(`type=ctw&item=real_ctw_fx_1_1&set=${encodeURIComponent(SET_A)}`);
    render(<RealBankPage />);
    expect((await screen.findByTestId("ctw-task")).textContent).toContain("id=real_ctw_fx_1_1");
    expect(screen.queryByTestId("topic-picker")).toBeNull();
    expect(screen.getByTestId("real-source-flag").textContent).toContain("与 9.12 同题簇");
  });

  test("带 set 深链进来的，退出回那一场详情页（不是题型 picker）", async () => {
    mockSearch = new URLSearchParams(`type=rdl&item=real_rdl_fx_1_21&set=${encodeURIComponent(SET_A)}`);
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("rdl-exit"));
    expect(mockPush).toHaveBeenCalledWith(`/real-bank/sets?set=${encodeURIComponent(SET_A)}`);
    expect(screen.queryByTestId("topic-picker")).toBeNull();
  });

  test("不带 set 的 item 深链，退出回本题型 picker", async () => {
    mockSearch = new URLSearchParams("type=rdl&item=real_rdl_fx_1_21");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("rdl-exit"));
    expect(mockPush).not.toHaveBeenCalled();
    expect(await screen.findByTestId("topic-picker")).toBeTruthy();
  });

  test("深链答完 → 历史 + 已练照常写入（判分链路与 picker 路径同一套）", async () => {
    mockSearch = new URLSearchParams(`type=ctw&item=real_ctw_fx_1_1&set=${encodeURIComponent(SET_A)}`);
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("ctw-finish"));
    expect(loadDoneIds(DONE_STORAGE_KEYS.READING_CTW).has("real_ctw_fx_1_1")).toBe(true);
    const sess = (loadHist().sessions || []).find((x) => x.details?.itemId === "real_ctw_fx_1_1");
    expect(sess).toBeTruthy();
    expect(sess.type).toBe("reading");
    expect(sess.details.subtype).toBe("ctw");
  });

  test("item 不在库里 → 「暂不可用」逃生口回列表，不白屏", async () => {
    mockSearch = new URLSearchParams("type=ap&item=real_ap_nope");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByRole("button", { name: /返回列表/ }));
    expect(await screen.findByTestId("topic-picker")).toBeTruthy();
  });

  test("没有 item 参数 → 行为不变，先看 picker", async () => {
    mockSearch = new URLSearchParams("type=ap");
    render(<RealBankPage />);
    expect((await screen.findByTestId("picker-count")).textContent).toBe("2");
  });
});

describe("首页入口", () => {
  test("桌面 section 有「按考试场次练」入口卡，题量读 counts.json", () => {
    // 组件层不 import lib/realBank（bundle 体积门），入口文案只能来自 counts.json。
    const { realSetsEntryCopy } = require("../components/home/RealExamSectionContent");
    expect(realSetsEntryCopy({ sets: 4, latest: "2026-05-10" })).toEqual({
      badge: "4 场",
      description: expect.stringContaining("最近一场 5.10"),
    });
    expect(realSetsEntryCopy({ sets: 0, latest: "" }).badge).toBe("录入中");
  });
});
