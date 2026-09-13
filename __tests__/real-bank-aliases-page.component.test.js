/**
 * 真题专区独立页（app/real-bank/page.js）× 旧 id 别名：
 *   ① 阅读选题页的「已练」：旧 id（含跨题型、同篇合并）记在旧 key 里的已练照样亮；
 *   ② 按旧 id 找题：接到新条目（跨题型按新题型渲染、存记录、打已练），不摆「暂不可用」。
 * mock 手法照搬 __tests__/real-bank-upgrade.component.test.js；别名账本用 virtual mock
 * （流水线生成的真账本存在与否都不影响这里）。
 */
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("../components/shared/UpgradeModal", () => ({ __esModule: true, default: () => null }));

jest.mock("../lib/AuthContext", () => ({
  getSavedTier: jest.fn(() => "pro"),
  getSavedCode: jest.fn(() => "REAL01"),
}));

let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => mockSearch,
}));

jest.mock("../components/shared/UsageGateWrapper", () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));

// 选题卡：pick-id 按钮模拟「拿着一个 id 来选题」（旧 id 入口的最小替身）。
let mockPickId = "";
jest.mock("../components/shared/TopicPicker", () => ({
  TopicPicker: ({ title, items, doneIds, onSelect }) => (
    <div data-testid="topic-picker">
      <div data-testid="picker-title">{title}</div>
      <div data-testid="picker-ids">{items.map((it) => it.id).join(",")}</div>
      <div data-testid="picker-done">{[...(doneIds || [])].join(",")}</div>
      <button data-testid="pick-id" onClick={() => onSelect(mockPickId)}>pick</button>
    </div>
  ),
}));

jest.mock("../lib/history/retry", () => ({ stashPromptSnapshot: jest.fn() }));

jest.mock("../components/reading/CTWTask", () => ({ CTWTask: () => <div data-testid="ctw-task" /> }));
jest.mock("../components/reading/RDLTask", () => ({
  RDLTask: ({ item, title, timeLimit, onComplete }) => (
    <div data-testid="rdl-task">
      id={item.id} title={String(title || "")} limit={String(timeLimit)}
      <button data-testid="rdl-finish" onClick={() => onComplete({ results: [], correct: 1, total: 1 })}>finish</button>
    </div>
  ),
}));

// jest.mock 工厂先于本文件的顶层语句执行（会被提升），夹具只能写在工厂里面。
jest.mock("../data/realBank/reading/ctw.json", () => ({ tier: "recalled", items: [] }));
jest.mock("../data/realBank/reading/rdl.json", () => {
  const q = (stem) => ({ question_type: "detail", stem, options: { A: "One", B: "Two", C: "Three", D: "Four" }, correct_answer: "B" });
  const p = { real: true, tier: "recalled", source: "3.10新托福真题", date: "2026-03-10" };
  return {
    tier: "recalled",
    items: [
      { id: "real_rdl_310_1_25", genre: "poster", text: "How Well Did You Sleep? Join the sleep study.", questions: [q("What is offered?")], format_metadata: {}, ...p },
      { id: "real_rdl_other_1_1", genre: "notice", text: "The gym closes early on Friday.", questions: [q("When?")], format_metadata: {}, ...p },
    ],
  };
});
jest.mock("../data/realBank/reading/ap.json", () => ({
  tier: "recalled",
  items: [{
    id: "real_ap_128a_1_27", topic: "passage", subtopic: "",
    passage: "Noise Control in Urban Areas\n\nCities are loud.",
    paragraphs: ["Noise Control in Urban Areas", "Cities are loud."],
    questions: [{ question_type: "detail", stem: "Why?", options: { A: "One", B: "Two", C: "Three", D: "Four" }, correct_answer: "B" }],
    real: true, tier: "recalled", source: "1.28新托福真题A卷", date: "2026-01-28",
  }],
}));
jest.mock("../data/realBank/reading/id-aliases.json", () => ({
  generated_by: "fixture",
  generated: "2026-09-13",
  aliases: [
    { from: "real_ap_310_1_25", to: "real_rdl_310_1_25", from_type: "ap", to_type: "rdl", reason: "reclassified" },
    { from: "real_ap_53_1_32", to: "real_ap_128a_1_27", from_type: "ap", to_type: "ap", reason: "consolidated" },
    { from: "real_ap_gone_1_9", to: null, from_type: "ap", to_type: null, reason: "consolidated" },
  ],
}), { virtual: true });

import RealBankPage from "../app/real-bank/page";
import { addDoneIds, loadDoneIds, loadHist } from "../lib/sessionStore";
import { DONE_STORAGE_KEYS } from "../lib/questionSelector";
import { getRealBankTimeSeconds } from "../lib/realBankModes";

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch {}
  mockPickId = "";
});

describe("阅读选题页「已练」认旧 id", () => {
  test("日常阅读列表：旧 AP id 记在 READING_AP 里 → 归位来的新条目亮已练；没做过的不亮", async () => {
    addDoneIds(DONE_STORAGE_KEYS.READING_AP, ["real_ap_310_1_25"]);
    mockSearch = new URLSearchParams("type=rdl");
    render(<RealBankPage />);
    const done = (await screen.findByTestId("picker-done")).textContent.split(",");
    expect(done).toContain("real_rdl_310_1_25");
    expect(done).not.toContain("real_rdl_other_1_1");
  });

  test("学术阅读列表：做过同篇副本 → 代表条目亮已练；归位走的条目不在这里亮", async () => {
    addDoneIds(DONE_STORAGE_KEYS.READING_AP, ["real_ap_53_1_32", "real_ap_310_1_25"]);
    mockSearch = new URLSearchParams("type=ap");
    render(<RealBankPage />);
    const done = (await screen.findByTestId("picker-done")).textContent.split(",");
    expect(done).toContain("real_ap_128a_1_27");
    expect(done).not.toContain("real_rdl_310_1_25");
    expect(screen.getByTestId("picker-ids").textContent).toBe("real_ap_128a_1_27");
  });

  test("新 id 直接记在自己 key 里的老路照旧", async () => {
    addDoneIds(DONE_STORAGE_KEYS.READING_RDL, ["real_rdl_other_1_1"]);
    mockSearch = new URLSearchParams("type=rdl");
    render(<RealBankPage />);
    expect((await screen.findByTestId("picker-done")).textContent.split(",")).toEqual(["real_rdl_other_1_1"]);
  });
});

describe("按旧 id 打开题目", () => {
  test("跨题型：学术阅读页拿着旧 AP id → 按日常阅读渲染新条目；交卷记成 rdl、打 READING_RDL 已练", async () => {
    mockSearch = new URLSearchParams("type=ap");
    mockPickId = "real_ap_310_1_25";
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-id"));

    const task = screen.getByTestId("rdl-task");
    expect(task.textContent).toContain("id=real_rdl_310_1_25");
    // 日常阅读分支：不带 Academic Passage 标题，限时按日常阅读档
    expect(task.textContent).toContain("title=");
    expect(task.textContent).not.toContain("Academic Passage");
    expect(task.textContent).toContain(`limit=${getRealBankTimeSeconds("rdl", "standard")}`);
    expect(screen.queryByText("这道真题暂不可用")).toBeNull();

    fireEvent.click(screen.getByTestId("rdl-finish"));
    const sess = (loadHist().sessions || []).find((s) => s.details?.itemId === "real_rdl_310_1_25");
    expect(sess).toBeTruthy();
    expect(sess.details.subtype).toBe("rdl");
    expect([...loadDoneIds(DONE_STORAGE_KEYS.READING_RDL)]).toContain("real_rdl_310_1_25");
  });

  test("同题型：旧副本 id → 代表条目（仍按学术阅读渲染）", async () => {
    mockSearch = new URLSearchParams("type=ap");
    mockPickId = "real_ap_53_1_32";
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-id"));
    const task = screen.getByTestId("rdl-task");
    expect(task.textContent).toContain("id=real_ap_128a_1_27");
    expect(task.textContent).toContain("title=Academic Passage");
  });

  test("已下线 / 查无此题 → 逃生口，不白屏", async () => {
    mockSearch = new URLSearchParams("type=ap");
    mockPickId = "real_ap_gone_1_9";
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-id"));
    expect(screen.getByText("这道真题暂不可用")).toBeInTheDocument();
    fireEvent.click(screen.getByText("返回列表"));
    expect(screen.getByTestId("topic-picker")).toBeInTheDocument();
  });
});
