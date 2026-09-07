/**
 * 「真题专区」独立路由的 Pro 门禁契约（app/real-bank/page.js）。
 *
 * /real-bank 不在 HomePageClient 组件树下，挂在 HomePageClient 上的全局 open-upgrade-modal
 * 监听者到不了这里 —— 所以锁定屏必须**自持** UpgradeModal，否则「升级 Pro」就是个死按钮
 * （阅读 / 听力页曾经就是这个 bug，见 __tests__/reading-listening-upgrade.component.test.js）。
 *
 * mock 手法照搬 reading-listening-upgrade.component.test.js。
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
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => mockSearch,
}));

// 锁定屏在这些组件之前 return；Pro 路径只需要证明 picker / 任务组件接线正确，本体不参与断言。
jest.mock("../components/writing/WritingTask", () => ({
  WritingTask: ({ type, initialPromptId, practiceMode, timeLimitSeconds }) => (
    <div data-testid="writing-task">
      type={type} id={initialPromptId} mode={practiceMode} limit={String(timeLimitSeconds)}
    </div>
  ),
}));
jest.mock("../components/buildSentence/BuildSentenceTask", () => ({
  BuildSentenceTask: ({ questions, practiceMode, timeLimitSeconds }) => (
    <div data-testid="bs-task">
      n={questions.length} group={questions[0]?.__sourceGroupId} mode={practiceMode}
      limit={String(timeLimitSeconds)}
    </div>
  ),
}));
jest.mock("../components/shared/UsageGateWrapper", () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));
jest.mock("../components/shared/TopicPicker", () => ({
  TopicPicker: ({ title, items, accent, doneIds, onSelect, onExit, eyebrow, description, headerExtra }) => (
    <div data-testid="topic-picker">
      <div data-testid="picker-title">{title}</div>
      <div data-testid="picker-eyebrow">{eyebrow}</div>
      <div data-testid="picker-desc">{description}</div>
      <div data-testid="picker-header-extra">{headerExtra}</div>
      <button data-testid="picker-exit" onClick={onExit}>exit</button>
      <div data-testid="picker-count">{items.length}</div>
      <div data-testid="picker-accent">{accent?.color}</div>
      <div data-testid="picker-done">{[...(doneIds || [])].join(",")}</div>
      <div data-testid="picker-first-tag">{items[0]?.tag}</div>
      <div data-testid="picker-first-subtitle">{items[0]?.subtitle}</div>
      <button data-testid="pick-first" onClick={() => onSelect(items[0].id)}>first</button>
      <button data-testid="pick-last" onClick={() => onSelect(items[items.length - 1].id)}>last</button>
    </div>
  ),
}));

jest.mock("../lib/history/retry", () => ({ stashPromptSnapshot: jest.fn() }));

// 阅读任务组件同样只验接线（本体在 __tests__ 里另有覆盖）。
jest.mock("../components/reading/CTWTask", () => ({
  CTWTask: ({ item, isPractice, timeLimit, onComplete }) => (
    <div data-testid="ctw-task">
      id={item.id} blanks={item.blanks.length} practice={String(isPractice)} limit={String(timeLimit)}
      <button data-testid="ctw-finish" onClick={() => onComplete({ results: [], correct: 1, total: 2 })}>finish</button>
    </div>
  ),
}));
jest.mock("../components/reading/RDLTask", () => ({
  RDLTask: ({ item, isPractice, timeLimit, title, section, onComplete }) => (
    <div data-testid="rdl-task">
      id={item.id} text={String(item.text || "").slice(0, 14)} genre={String(item.genre || "")}
      title={String(title || "")} section={String(section || "")}
      practice={String(isPractice)} limit={String(timeLimit)}
      <button data-testid="rdl-finish" onClick={() => onComplete({ results: [], correct: 2, total: 2 })}>finish</button>
    </div>
  ),
}));

// 阅读题库是 scripts/realbank/build_bank.mjs 的构建产物（题量随入库进度变，还可能为空）——
// 接线测试不能吊在供给上，所以这里换成固定夹具；「库里到底有没有题」由
// __tests__/real-bank-reading-data.test.js 用真数据把关。
jest.mock("../data/realBank/reading/ctw.json", () => ({
  tier: "recalled",
  count: 1,
  items: [{
    id: "real_ctw_fx_1_1",
    passage: "Coral reefs support marine life. The tiny polyps build limestone skeletons over many centuries.",
    word_count: 14,
    topic: "biology",
    subtopic: "",
    blanks: [
      { position: 7, original_word: "polyps", displayed_fragment: "pol", hidden_length: 3 },
      { position: 13, original_word: "centuries", displayed_fragment: "cent", hidden_length: 5 },
    ],
    blank_count: 2,
    first_sentence: "Coral reefs support marine life.",
    difficulty: "medium",
    real: true,
    tier: "recalled",
    source: "9.9新托福真题A卷",
    date: "2026-09-09",
  }],
}));
jest.mock("../data/realBank/reading/rdl.json", () => ({
  tier: "recalled",
  count: 1,
  items: [{
    id: "real_rdl_fx_1_21",
    genre: "notice",
    text: "Campus Notice: the library closes at six on Friday for annual maintenance work.",
    questions: [{
      question_type: "detail",
      stem: "When does the library close?",
      options: { A: "At five", B: "At six", C: "At seven", D: "At eight" },
      correct_answer: "B",
    }],
    format_metadata: {},
    difficulty: "medium",
    real: true,
    tier: "recalled",
    source: "9.9新托福真题A卷",
    date: "2026-09-09",
  }],
}));
jest.mock("../data/realBank/reading/ap.json", () => ({
  tier: "recalled",
  count: 1,
  items: [{
    id: "real_ap_fx_2_24",
    topic: "biology",
    subtopic: "",
    passage: "Photosynthesis converts light energy into chemical energy stored in sugar molecules inside the leaf.",
    // 带材料原图：进入题目前要先过预加载门（见「阅读真题：材料原图预加载」）。
    material_image: {
      url: "https://abc123.supabase.co/storage/v1/object/public/real_bank_images/reading/real_ap_fx_2_24.webp",
      w: 700, h: 400,
    },
    paragraphs: [],
    questions: [{
      question_type: "main_idea",
      stem: "What is the passage mainly about?",
      options: { A: "Photosynthesis", B: "Erosion", C: "Migration", D: "Volcanoes" },
      correct_answer: "A",
    }],
    difficulty: "medium",
    real: true,
    tier: "recalled",
    source: "9.9新托福真题A卷",
    date: "2026-09-09",
  }],
}));

import RealBankPage from "../app/real-bank/page";
import { getSavedTier } from "../lib/AuthContext";
import { stashPromptSnapshot } from "../lib/history/retry";
import { getRealDiscussionPrompts, getRealEmailPrompts } from "../lib/realBank";
import { addDoneIds, loadDoneIds, loadHist } from "../lib/sessionStore";
import { DONE_STORAGE_KEYS } from "../lib/questionSelector";

describe("真题专区独立页：Pro 锁定屏自持 UpgradeModal", () => {
  beforeEach(() => {
    mockSearch = new URLSearchParams();
    getSavedTier.mockReturnValue("free");
  });

  test("免费用户看到锁定屏，看不到 picker", async () => {
    render(<RealBankPage />);
    expect(await screen.findByText("Pro 专属功能")).toBeTruthy();
    expect(screen.queryByTestId("topic-picker")).toBeNull();
  });

  test("免费用户点「升级 Pro」→ 弹出 UpgradeModal（带 userCode/tier），不是死按钮", async () => {
    render(<RealBankPage />);

    const btn = await screen.findByRole("button", { name: /升级 Pro/ });
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();

    fireEvent.click(btn);

    const modal = screen.getByTestId("upgrade-modal");
    expect(modal.textContent).toContain("REAL01");
    expect(modal.textContent).toContain("free");
  });
});

describe("真题专区独立页：Pro 用户看到 picker", () => {
  beforeEach(() => {
    mockSearch = new URLSearchParams();
  });

  test.each([
    ["pro"],
    ["legacy"],
  ])("tier=%s 解锁学术讨论 125 题", async (tier) => {
    getSavedTier.mockReturnValue(tier);
    render(<RealBankPage />);

    expect(await screen.findByTestId("topic-picker")).toBeTruthy();
    expect(screen.getByTestId("picker-title").textContent).toBe("学术讨论真题");
    expect(screen.getByTestId("picker-count").textContent).toBe("125");
    expect(screen.getByTestId("picker-accent").textContent).toBe("#B45309");
    expect(screen.queryByText("Pro 专属功能")).toBeNull();
  });

  test("?type=email → 邮件 13 题", async () => {
    getSavedTier.mockReturnValue("pro");
    mockSearch = new URLSearchParams("type=email");
    render(<RealBankPage />);
    expect(await screen.findByTestId("picker-title")).toHaveTextContent("邮件真题");
    expect(screen.getByTestId("picker-count").textContent).toBe("13");
  });

  test("?type=bs → 造句 2 张批次卡", async () => {
    getSavedTier.mockReturnValue("pro");
    mockSearch = new URLSearchParams("type=bs");
    render(<RealBankPage />);
    expect(await screen.findByTestId("picker-title")).toHaveTextContent("造句官方真题");
    expect(screen.getByTestId("picker-count").textContent).toBe("2");
  });

  test("非法 type 落回学术讨论，不白屏", async () => {
    getSavedTier.mockReturnValue("pro");
    mockSearch = new URLSearchParams("type=bogus");
    render(<RealBankPage />);
    expect(await screen.findByTestId("picker-title")).toHaveTextContent("学术讨论真题");
  });
});

describe("真题专区独立页：选题 → 答题接线", () => {
  beforeEach(() => {
    mockSearch = new URLSearchParams();
    getSavedTier.mockReturnValue("pro");
    stashPromptSnapshot.mockClear();
    try { sessionStorage.clear(); localStorage.clear(); } catch {}
  });

  test("选讨论题 → 先 stash 整题快照再挂 WritingTask（real_ id 不在 live 库，缺快照必报「已下线」）", async () => {
    const prompts = getRealDiscussionPrompts();
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));

    expect(stashPromptSnapshot).toHaveBeenCalledTimes(1);
    const [type, raw] = stashPromptSnapshot.mock.calls[0];
    expect(type).toBe("discussion");
    expect(raw.id).toBe(prompts[0].id);
    expect(raw.professor.text).toBe(prompts[0].professor.text);

    const task = screen.getByTestId("writing-task");
    expect(task.textContent).toContain("type=discussion");
    expect(task.textContent).toContain(`id=${prompts[0].id}`);
    // 默认档 = standard（与 app/academic-writing 等常规入口一致），限时 600s。
    expect(task.textContent).toContain("mode=standard");
    expect(task.textContent).toContain("limit=600");
  });

  test("答题页可见来源标注（回忆版题）", async () => {
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    const banner = screen.getByTestId("real-source-banner");
    expect(banner.textContent).toContain("真题专区");
    expect(banner.textContent).toContain("回忆版");
  });

  test("答题页对参考版题标「来源未核验」，不冒充官方", async () => {
    render(<RealBankPage />);
    // 列表尾部是参考版（real_tpo_reference 的 81 条）。
    fireEvent.click(await screen.findByTestId("pick-last"));
    const banner = screen.getByTestId("real-source-banner");
    expect(banner.textContent).toContain("参考版");
    expect(banner.textContent).toContain("来源未核验");
    expect(banner.textContent).not.toContain("ETS官方");
  });

  test("选邮件题 → stash type=email，官方题标 ETS官方", async () => {
    mockSearch = new URLSearchParams("type=email");
    const emails = getRealEmailPrompts();
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));

    expect(stashPromptSnapshot).toHaveBeenCalledWith("email", expect.objectContaining({ id: emails[0].id }));
    expect(screen.getByTestId("writing-task").textContent).toContain("type=email");
    expect(screen.getByTestId("real-source-banner").textContent).toContain("ETS官方");
  });

  test("讨论 picker 的「已练」读的正是 WritingTask 写入的 key（real_ id 能落进去）", async () => {
    // WritingTask 评分成功后调 addDoneIds(DONE_STORAGE_KEYS.DISCUSSION, [pd.id])；
    // 这里用同一个 API 写入，证明 picker 读的是同一把 key，否则「已练」永远不亮。
    addDoneIds(DONE_STORAGE_KEYS.DISCUSSION, ["real_adr01"]);
    render(<RealBankPage />);
    expect((await screen.findByTestId("picker-done")).textContent).toContain("real_adr01");
  });

  test("造句 picker 的「已练」读 BUILD_SENTENCE_GP（useBuildSentenceSession 按 __sourceGroupId 写）", async () => {
    addDoneIds(DONE_STORAGE_KEYS.BUILD_SENTENCE_GP, ["real-bs-set-1"]);
    mockSearch = new URLSearchParams("type=bs");
    render(<RealBankPage />);
    expect((await screen.findByTestId("picker-done")).textContent).toContain("real-bs-set-1");
  });

  test("选造句批次 → BuildSentenceTask 收到 10 题 + 批次 __sourceGroupId", async () => {
    mockSearch = new URLSearchParams("type=bs");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));

    const task = screen.getByTestId("bs-task");
    expect(task.textContent).toContain("n=10");
    expect(task.textContent).toContain("group=real-bs-set-1");
    expect(task.textContent).toContain("mode=standard");
    expect(task.textContent).toContain("limit=410");
    expect(screen.getByTestId("real-source-banner").textContent).toContain("Full-Length Practice Test 1");
  });
});

/* ── 三档模式（Standard / Practice / Challenge） ───────────────── */

describe("真题专区独立页：三档模式与常规练习同一限时口径", () => {
  beforeEach(() => {
    getSavedTier.mockReturnValue("pro");
    mockReplace.mockClear();
    mockPush.mockClear();
    try { sessionStorage.clear(); localStorage.clear(); } catch {}
  });

  test("默认档 = standard（picker eyebrow + 文案都不再写「不限时间」）", async () => {
    mockSearch = new URLSearchParams("type=ctw");
    render(<RealBankPage />);
    expect((await screen.findByTestId("picker-eyebrow")).textContent).toBe("Standard Mode");
    const desc = screen.getByTestId("picker-desc").textContent;
    expect(desc).toContain("5 min");
    expect(desc).not.toContain("不限时");
  });

  test("?mode=practice → 不限时 + isPractice（旧行为仍可达）", async () => {
    mockSearch = new URLSearchParams("type=ctw&mode=practice");
    render(<RealBankPage />);
    expect(screen.getByTestId("picker-eyebrow").textContent).toBe("Practice Mode");
    fireEvent.click(await screen.findByTestId("pick-first"));

    const task = screen.getByTestId("ctw-task");
    expect(task.textContent).toContain("practice=true");
    expect(task.textContent).toContain("limit=0");
  });

  test("?mode=challenge → CTW 240s、写作 510s、邮件 360s、造句 330s", async () => {
    mockSearch = new URLSearchParams("type=ctw&mode=challenge");
    const { unmount } = render(<RealBankPage />);
    expect(screen.getByTestId("picker-eyebrow").textContent).toBe("Challenge Mode");
    fireEvent.click(await screen.findByTestId("pick-first"));
    expect(screen.getByTestId("ctw-task").textContent).toContain("limit=240");
    expect(screen.getByTestId("ctw-task").textContent).toContain("practice=false");
    unmount();

    mockSearch = new URLSearchParams("mode=challenge");            // 讨论
    const r2 = render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    expect(screen.getByTestId("writing-task").textContent).toContain("mode=challenge");
    expect(screen.getByTestId("writing-task").textContent).toContain("limit=510");
    r2.unmount();

    mockSearch = new URLSearchParams("type=email&mode=challenge");
    const r3 = render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    expect(screen.getByTestId("writing-task").textContent).toContain("limit=360");
    r3.unmount();

    mockSearch = new URLSearchParams("type=bs&mode=challenge");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    expect(screen.getByTestId("bs-task").textContent).toContain("mode=challenge");
    expect(screen.getByTestId("bs-task").textContent).toContain("limit=330");
  });

  test("非法 mode 落回 standard（不会把 undefined 喂给倒计时）", async () => {
    mockSearch = new URLSearchParams("type=ctw&mode=bogus");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    expect(screen.getByTestId("ctw-task").textContent).toContain("limit=300");
  });

  test("picker 头部有三档切换，点一下换 URL（保留 type，standard 不带 mode 参数）", async () => {
    mockSearch = new URLSearchParams("type=ctw&mode=challenge");
    render(<RealBankPage />);
    expect(await screen.findByTestId("real-mode-switch")).toBeTruthy();

    fireEvent.click(screen.getByTestId("real-mode-practice"));
    expect(mockReplace).toHaveBeenCalledWith("/real-bank?type=ctw&mode=practice");

    fireEvent.click(screen.getByTestId("real-mode-standard"));
    expect(mockReplace).toHaveBeenCalledWith("/real-bank?type=ctw");
  });

  test("答题页顶部带档位 chip（standard 不渲染 chip）", async () => {
    mockSearch = new URLSearchParams("type=ctw&mode=challenge");
    const { unmount } = render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    expect(screen.getByTestId("real-source-banner").textContent).toContain("挑战模式");
    unmount();

    mockSearch = new URLSearchParams("type=ctw");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    expect(screen.getByTestId("real-source-banner").textContent).not.toContain("挑战模式");
  });

  test("交卷写历史时 mode 跟着档位走（不再硬编码 practice）", async () => {
    mockSearch = new URLSearchParams("type=ctw&mode=challenge");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    fireEvent.click(screen.getByTestId("ctw-finish"));

    const sess = (loadHist().sessions || []).find((x) => x.details?.itemId === "real_ctw_fx_1_1");
    expect(sess.mode).toBe("challenge");
  });

  test("返回首页把档位带回去（HomePageClient 从 ?mode 读初始档）", async () => {
    mockSearch = new URLSearchParams("type=ctw&mode=practice");
    const { unmount } = render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("picker-exit"));
    expect(mockPush).toHaveBeenCalledWith("/?section=real-bank&mode=practice");
    unmount();

    mockPush.mockClear();
    mockSearch = new URLSearchParams("type=ctw");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("picker-exit"));
    expect(mockPush).toHaveBeenCalledWith("/?section=real-bank");
  });
});

/* ── 阅读真题（?type=ctw|rdl|ap） ─────────────────────────────────── */

// 预加载门里的隐藏 <img> 在 jsdom 不会真的加载，手动触发 load 放行。
function passPreload() {
  for (const img of screen.queryAllByTestId("asset-preload-img")) fireEvent.load(img);
}

describe("真题专区独立页：阅读真题材料原图预加载", () => {
  beforeEach(() => {
    getSavedTier.mockReturnValue("pro");
    try { sessionStorage.clear(); localStorage.clear(); } catch {}
  });

  test("带原图的题：先出加载页，图没到之前不挂 RDLTask（计时不起跑）", async () => {
    mockSearch = new URLSearchParams("type=ap");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));

    expect(screen.getByTestId("asset-preload-gate")).toBeTruthy();
    expect(screen.queryByTestId("rdl-task")).toBeNull();
    expect(screen.queryByTestId("real-source-banner")).toBeNull();
    // 预热的正是同源代理地址（与 RDLTask 里 <img> 的 src 一致，才能命中缓存）。
    const imgs = screen.getAllByTestId("asset-preload-img");
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(["/api/img/reading/real_ap_fx_2_24.webp"]);

    passPreload();
    expect(screen.queryByTestId("asset-preload-gate")).toBeNull();
    expect(screen.getByTestId("rdl-task").textContent).toContain("id=real_ap_fx_2_24");
    expect(screen.getByTestId("real-source-banner")).toBeTruthy();
  });

  test("加载页的「返回」回到 picker，不留在加载页", async () => {
    mockSearch = new URLSearchParams("type=ap");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    fireEvent.click(screen.getByText("返回"));
    expect(screen.getByTestId("topic-picker")).toBeTruthy();
  });

  test("没有原图的题（rdl 夹具）直接进任务，不经过加载页", async () => {
    mockSearch = new URLSearchParams("type=rdl");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    expect(screen.queryByTestId("asset-preload-gate")).toBeNull();
    expect(screen.getByTestId("rdl-task")).toBeTruthy();
  });
});

describe("真题专区独立页：阅读真题路由", () => {
  beforeEach(() => {
    getSavedTier.mockReturnValue("pro");
    try { sessionStorage.clear(); localStorage.clear(); } catch {}
  });

  test.each([
    ["ctw", "阅读填词真题"],
    ["rdl", "日常阅读真题"],
    ["ap", "学术阅读真题"],
  ])("?type=%s → 对应 picker（各 1 条夹具题）", async (type, title) => {
    mockSearch = new URLSearchParams(`type=${type}`);
    render(<RealBankPage />);
    expect(await screen.findByTestId("picker-title")).toHaveTextContent(title);
    expect(screen.getByTestId("picker-count").textContent).toBe("1");
    expect(screen.getByTestId("picker-accent").textContent).toBe("#B45309");
    // tag 只放考试日期，不查学科表（真题没有学科标签）；来源分档在卡片第二行。
    expect(screen.getByTestId("picker-first-tag").textContent).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
    expect(screen.getByTestId("picker-first-subtitle").textContent).toContain("回忆版");
  });

  test("非法 type 仍然落回学术讨论（阅读分支不会吞掉兜底）", async () => {
    mockSearch = new URLSearchParams("type=reading");
    render(<RealBankPage />);
    expect(await screen.findByTestId("picker-title")).toHaveTextContent("学术讨论真题");
  });

  test("?type=ctw 选题 → CTWTask（standard 限时 300s），题面标回忆版且不冒充官方", async () => {
    mockSearch = new URLSearchParams("type=ctw");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));

    const task = screen.getByTestId("ctw-task");
    expect(task.textContent).toContain("id=real_ctw_fx_1_1");
    expect(task.textContent).toContain("blanks=2");
    expect(task.textContent).toContain("practice=false");
    expect(task.textContent).toContain("limit=300");

    const banner = screen.getByTestId("real-source-banner");
    expect(banner.textContent).toContain("回忆版");
    expect(banner.textContent).toContain("非 ETS 官方原题");
    expect(banner.textContent).not.toContain("ETS官方");
  });

  test("?type=rdl 选题 → RDLTask 直接吃 item（text/genre 原样）", async () => {
    mockSearch = new URLSearchParams("type=rdl");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));

    const task = screen.getByTestId("rdl-task");
    expect(task.textContent).toContain("id=real_rdl_fx_1_21");
    expect(task.textContent).toContain("text=Campus Notice");
    expect(task.textContent).toContain("genre=notice");
    expect(task.textContent).toContain("practice=false");
    expect(task.textContent).toContain("limit=240");
  });

  test("?type=ap 选题 → RDLTask 收到适配对象（passage→text、topic→genre）+ 官方任务名", async () => {
    mockSearch = new URLSearchParams("type=ap");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    passPreload();

    const task = screen.getByTestId("rdl-task");
    expect(task.textContent).toContain("id=real_ap_fx_2_24");
    expect(task.textContent).toContain("text=Photosynthesi");   // passage 被搬进 text
    expect(task.textContent).toContain("genre=biology");        // topic 被搬进 genre
    expect(task.textContent).toContain("title=Academic Passage");
    expect(task.textContent).toContain("section=Reading | Task 3");
  });
});

describe("真题专区独立页：阅读做完 → 历史 + 已练", () => {
  beforeEach(() => {
    getSavedTier.mockReturnValue("pro");
    try { sessionStorage.clear(); localStorage.clear(); } catch {}
  });

  test("CTW 交卷 → 写 reading 历史（details 形状照 app/reading/page.js）+ 打 READING_CTW 已练", async () => {
    mockSearch = new URLSearchParams("type=ctw");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    fireEvent.click(screen.getByTestId("ctw-finish"));

    expect([...loadDoneIds(DONE_STORAGE_KEYS.READING_CTW)]).toContain("real_ctw_fx_1_1");

    const sess = (loadHist().sessions || []).find((s) => s.details?.itemId === "real_ctw_fx_1_1");
    expect(sess).toBeTruthy();
    expect(sess.type).toBe("reading");
    expect(sess.details.subtype).toBe("ctw");
    expect(sess.correct).toBe(1);
    expect(sess.total).toBe(2);
    expect(sess.band).toBe(3.5);                    // 1/2 = 50% → band 3.5（与常规练习同一档表）
    expect(sess.details.passage).toContain("Coral reefs");
    expect(Array.isArray(sess.details.blanks)).toBe(true);
  });

  test("AP 交卷 → 打的是 READING_AP 已练（不是 RDL），历史存原 item 的 questions", async () => {
    mockSearch = new URLSearchParams("type=ap");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    passPreload();
    fireEvent.click(screen.getByTestId("rdl-finish"));

    expect([...loadDoneIds(DONE_STORAGE_KEYS.READING_AP)]).toContain("real_ap_fx_2_24");
    expect([...loadDoneIds(DONE_STORAGE_KEYS.READING_RDL)]).not.toContain("real_ap_fx_2_24");

    const sess = (loadHist().sessions || []).find((s) => s.details?.itemId === "real_ap_fx_2_24");
    expect(sess.details.subtype).toBe("ap");
    expect(sess.details.questions.length).toBe(1);
    expect(sess.band).toBe(6);                      // 2/2 全对
  });

  test("picker 的「已练」读的正是交卷写入的那把 key", async () => {
    addDoneIds(DONE_STORAGE_KEYS.READING_RDL, ["real_rdl_fx_1_21"]);
    mockSearch = new URLSearchParams("type=rdl");
    render(<RealBankPage />);
    expect((await screen.findByTestId("picker-done")).textContent).toContain("real_rdl_fx_1_21");
  });
});
