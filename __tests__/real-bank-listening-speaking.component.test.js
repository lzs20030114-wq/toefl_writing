/**
 * 「真题专区 · 听力 / 口语」路由接线测试（app/real-bank/page.js 的六个新入口）。
 * 范式照 __tests__/real-bank-upgrade.component.test.js：任务组件与数据源都换成夹具，
 * 只验「接线」——picker 供题、任务组件拿到的 props、来源标注、做完写历史 / 打已练。
 *
 * 为什么用夹具而不是真库：data/realBank/{listening,speaking}/*.json 是 build_bank.mjs 的
 * 构建产物（54 套卷持续入库，题量天天变），接线测试不能吊在供给上。
 * 「库里到底有没有能上屏的题」由 __tests__/real-bank-listening-speaking-mapper.test.js
 * 和 …-data.test.js 用真数据把关。
 */

import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("../components/shared/UpgradeModal", () => ({
  __esModule: true,
  default: () => <div data-testid="upgrade-modal" />,
}));
jest.mock("../lib/AuthContext", () => ({
  getSavedTier: jest.fn(() => "pro"),
  getSavedCode: jest.fn(() => "REAL01"),
}));

let mockSearch = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => mockSearch,
}));

jest.mock("../components/shared/UsageGateWrapper", () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));
jest.mock("../components/shared/TopicPicker", () => ({
  TopicPicker: ({ title, section, description, items, doneIds, accent, onSelect }) => (
    <div data-testid="topic-picker">
      <div data-testid="picker-title">{title}</div>
      <div data-testid="picker-section">{section}</div>
      <div data-testid="picker-desc">{description}</div>
      <div data-testid="picker-count">{items.length}</div>
      <div data-testid="picker-accent">{accent?.color}</div>
      <div data-testid="picker-done">{[...(doneIds || [])].join(",")}</div>
      <div data-testid="picker-first-tag">{items[0]?.tag}</div>
      <div data-testid="picker-first-title">{items[0]?.title}</div>
      <div data-testid="picker-first-subtitle">{items[0]?.subtitle}</div>
      <div data-testid="picker-first-badge">{items[0]?.badge}</div>
      <button data-testid="pick-first" onClick={() => onSelect(items[0].id)}>first</button>
    </div>
  ),
}));
jest.mock("../lib/history/retry", () => ({ stashPromptSnapshot: jest.fn() }));

// 听力 / 口语任务组件：只回显关键 props + 提供一个「交卷」按钮。
jest.mock("../components/listening/LCRTask", () => ({
  LCRTask: ({ item, isPractice, onComplete }) => (
    <div data-testid="lcr-task">
      id={item.id} speaker={item.speaker} audio={String(item.audio_url)} practice={String(isPractice)}
      <button data-testid="lcr-finish" onClick={() => onComplete({ correct: 1, total: 1, results: [{ correct: true }] })}>finish</button>
    </div>
  ),
}));
jest.mock("../components/listening/ListeningMCQTask", () => ({
  ListeningMCQTask: ({ item, taskType, title, section, isPractice, onComplete }) => (
    <div data-testid="mcq-task">
      id={item.id} type={taskType} title={title} section={section}
      q={item.questions.length} audio={String(item.audio_url)} practice={String(isPractice)}
      <button data-testid="mcq-finish" onClick={() => onComplete({ correct: 2, total: 2, results: [{ correct: true }, { correct: true }] })}>finish</button>
    </div>
  ),
}));
jest.mock("../components/speaking/RepeatTask", () => ({
  RepeatTask: ({ items, setInfo, isPractice, onComplete }) => (
    <div data-testid="repeat-task">
      n={items.length} first={items[0]?.sentence} audio={String(items[0]?.audio_url)}
      set={setInfo?.id} scenario={String(setInfo?.scenario || "").slice(0, 10)} practice={String(isPractice)}
      <button data-testid="repeat-finish" onClick={() => onComplete({ avgScore: 4 })}>finish</button>
    </div>
  ),
}));
jest.mock("../components/speaking/InterviewTask", () => ({
  InterviewTask: ({ items, setInfo, isPractice, onComplete }) => (
    <div data-testid="interview-task">
      n={items.length} first={items[0]?.question} audio={String(items[0]?.audio_url)}
      intro={String(setInfo?.intro || "").slice(0, 10)} practice={String(isPractice)}
      <button data-testid="interview-finish" onClick={() => onComplete({ avgScore: 3 })}>finish</button>
    </div>
  ),
}));

/* ── 数据夹具 ─────────────────────────────────────────────────── */

// jest.mock 工厂是 hoist 到文件顶部执行的，闭包外的常量在工厂里不可见 ——
// 所以每份夹具都把 provenance / options / audio_url 原样写全，不抽公共常量。

jest.mock("../data/realBank/listening/lcr.json", () => ({
  tier: "recalled", count: 1,
  items: [{
    id: "real_lcr_fx_1", speaker: "How will you plan the weekend trip?",
    options: { A: "Alpha option", B: "Bravo option", C: "Charlie option", D: "Delta option" },
    answer: "D", context: "campus_academic", difficulty: "medium",
    audio_url: "https://cdn.example.com/listening_audio/real/lcr_fx_1.mp3",
    real: true, tier: "recalled", source: "rf0610", date: "2026-06-10",
    source_flags: [{ code: "vendor_reformatted", severity: "warn", detail: "商家重排版 docx，答案 AI 补写" }],
  }],
}));
jest.mock("../data/realBank/listening/lc.json", () => ({
  tier: "recalled", count: 1,
  items: [{
    id: "real_lc_fx_1", context: "campus_daily", situation: "Two students plan a conference trip.",
    speakers: [{ name: "Man", role: "student", gender: "male" }, { name: "Woman", role: "student", gender: "female" }],
    conversation: [
      { speaker: "Man", text: "Should we take the train or fly?" },
      { speaker: "Woman", text: "The train station is closer to the hotel." },
    ],
    questions: [
      { type: "detail", stem: "What do they decide?", options: { A: "Alpha option", B: "Bravo option", C: "Charlie option", D: "Delta option" }, answer: "A" },
      { type: "detail", stem: "When do they leave?", options: { A: "Alpha option", B: "Bravo option", C: "Charlie option", D: "Delta option" }, answer: "B" },
    ],
    audio_url: "https://cdn.example.com/listening_audio/real/lc_fx_1.mp3",
    real: true, tier: "recalled", source: "rf0610", date: "2026-06-10",
    source_flags: [{ code: "vendor_reformatted", severity: "warn", detail: "商家重排版 docx，答案 AI 补写" }],
  }],
}));
jest.mock("../data/realBank/listening/la.json", () => ({
  tier: "recalled", count: 1,
  items: [{
    id: "real_la_fx_1", context: "announcement", speaker_role: "staff",
    announcement: "The bookstore has been busier than ever since we expanded the building.",
    questions: [
      { type: "detail", stem: "Why is the store busy?", options: { A: "Alpha option", B: "Bravo option", C: "Charlie option", D: "Delta option" }, answer: "A" },
      { type: "detail", stem: "What should staff do?", options: { A: "Alpha option", B: "Bravo option", C: "Charlie option", D: "Delta option" }, answer: "C" },
    ],
    audio_url: "https://cdn.example.com/listening_audio/real/la_fx_1.mp3",
    real: true, tier: "recalled", source: "rf0610", date: "2026-06-10",
    source_flags: [{ code: "vendor_reformatted", severity: "warn", detail: "商家重排版 docx，答案 AI 补写" }],
  }],
}));
jest.mock("../data/realBank/listening/lat.json", () => ({
  tier: "recalled", count: 1,
  items: [{
    id: "real_lat_fx_1", subject: "art", topic: "Surrealism",
    transcript: "Today we explore surrealism, which focused on inner reality and dreams.",
    questions: [
      { type: "main_idea", stem: "What is the lecture about?", options: { A: "Alpha option", B: "Bravo option", C: "Charlie option", D: "Delta option" }, answer: "B" },
      { type: "detail", stem: "Who is mentioned?", options: { A: "Alpha option", B: "Bravo option", C: "Charlie option", D: "Delta option" }, answer: "D" },
    ],
    audio_url: "https://cdn.example.com/listening_audio/real/lat_fx_1.mp3",
    real: true, tier: "recalled", source: "rf0610", date: "2026-06-10",
    source_flags: [{ code: "vendor_reformatted", severity: "warn", detail: "商家重排版 docx，答案 AI 补写" }],
  }],
}));
jest.mock("../data/realBank/listening/counts.json", () => ({ lcr: 1, lc: 1, la: 1, lat: 1 }));
jest.mock("../data/realBank/speaking/repeat.json", () => ({
  tier: "recalled", count: 1,
  items: [{
    id: "real_repeat_fx_1",
    scenario: "You are working at a university library. Repeat what the manager says.",
    speaker_role: "staff",
    sentences: [
      { id: "real_repeat_fx_1_s1", sentence: "Use keywords when you look for any books.", difficulty: "medium", word_count: 8, timing_seconds: 8, audio_url: "https://cdn.example.com/listening_audio/real/repeat_fx_1_s1.mp3" },
      { id: "real_repeat_fx_1_s2", sentence: "Download materials to read offline.", difficulty: "easy", word_count: 5, timing_seconds: 8, audio_url: "https://cdn.example.com/listening_audio/real/repeat_fx_1_s2.mp3" },
    ],
    real: true, tier: "recalled", source: "rf0610", date: "2026-06-10",
    source_flags: [{ code: "vendor_reformatted", severity: "warn", detail: "商家重排版 docx，答案 AI 补写" }],
  }],
}));
jest.mock("../data/realBank/speaking/interview.json", () => ({
  tier: "recalled", count: 1,
  items: [{
    id: "real_interview_fx_1",
    intro: "You have agreed to take part in a short research interview about work-life balance.",
    questions: [
      { id: "real_interview_fx_1_q1", position: "Q1", question: "Do you have a good work-life balance?", difficulty: "personal", audio_url: "https://cdn.example.com/listening_audio/real/interview_fx_1_q1.mp3" },
      { id: "real_interview_fx_1_q2", position: "Q2", question: "What strategies do you use?", difficulty: "descriptive", audio_url: "https://cdn.example.com/listening_audio/real/interview_fx_1_q2.mp3" },
    ],
    real: true, tier: "recalled", source: "rf0610", date: "2026-06-10",
    source_flags: [{ code: "vendor_reformatted", severity: "warn", detail: "商家重排版 docx，答案 AI 补写" }],
  }],
}));
jest.mock("../data/realBank/speaking/counts.json", () => ({ repeat: 1, interview: 1 }));

import RealBankPage from "../app/real-bank/page";
import { getSavedTier } from "../lib/AuthContext";
import { addDoneIds, loadDoneIds, loadHist } from "../lib/sessionStore";
import { DONE_STORAGE_KEYS } from "../lib/questionSelector";

beforeEach(() => {
  mockSearch = new URLSearchParams();
  getSavedTier.mockReturnValue("pro");
  try { sessionStorage.clear(); localStorage.clear(); } catch {}
});

describe("真题专区：听力 / 口语六个入口都有 picker", () => {
  test.each([
    ["lcr", "听力应答真题", "真题专区 | Choose a Response"],
    ["lc", "听力对话真题", "真题专区 | Listen to a Conversation"],
    ["la", "听力通知真题", "真题专区 | Listen to an Announcement"],
    ["lat", "听力讲座真题", "真题专区 | Listen to an Academic Talk"],
    ["repeat", "口语跟读真题", "真题专区 | Listen & Repeat"],
    ["interview", "口语访谈真题", "真题专区 | Take an Interview"],
  ])("?type=%s → %s（1 条夹具）", async (type, title, section) => {
    mockSearch = new URLSearchParams(`type=${type}`);
    render(<RealBankPage />);
    expect(await screen.findByTestId("picker-title")).toHaveTextContent(title);
    expect(screen.getByTestId("picker-section").textContent).toBe(section);
    expect(screen.getByTestId("picker-count").textContent).toBe("1");
    expect(screen.getByTestId("picker-accent").textContent).toBe("#B45309");
    // tag 只放考试日期（真题没有可信的学科标签），来源分档在卡片第二行。
    expect(screen.getByTestId("picker-first-tag").textContent).toBe("2026.06.10");
    expect(screen.getByTestId("picker-first-subtitle").textContent).toContain("回忆版");
  });

  test("?mode=practice → isPractice 仍为 true（不限时挡位可达）", async () => {
    mockSearch = new URLSearchParams("type=lcr&mode=practice");
    render(<RealBankPage />);
    expect(screen.getByTestId("picker-desc").textContent).toContain("不限时间");
    fireEvent.click(await screen.findByTestId("pick-first"));
    expect(screen.getByTestId("lcr-task").textContent).toContain("practice=true");
  });

  test("standard / challenge 档：picker 文案说「每题限时」，任务组件按题自己计时", async () => {
    mockSearch = new URLSearchParams("type=lat&mode=challenge");
    render(<RealBankPage />);
    const desc = screen.getByTestId("picker-desc").textContent;
    expect(desc).toContain("每题限时");
    expect(desc).not.toContain("不限时");
    fireEvent.click(await screen.findByTestId("pick-first"));
    expect(screen.getByTestId("mcq-task").textContent).toContain("practice=false");
  });

  test("免费用户仍被 Pro 门禁拦下（听力入口不能绕过）", async () => {
    getSavedTier.mockReturnValue("free");
    mockSearch = new URLSearchParams("type=lcr");
    render(<RealBankPage />);
    expect(await screen.findByText("Pro 专属功能")).toBeTruthy();
    expect(screen.queryByTestId("topic-picker")).toBeNull();
  });
});

describe("真题专区：听力选题 → 任务组件", () => {
  test("?type=lcr → LCRTask 拿到 item + 真题音频 URL（practice 不限次重听）", async () => {
    mockSearch = new URLSearchParams("type=lcr");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));

    const task = screen.getByTestId("lcr-task");
    expect(task.textContent).toContain("id=real_lcr_fx_1");
    expect(task.textContent).toContain("audio=https://cdn.example.com/listening_audio/real/lcr_fx_1.mp3");
    // 默认档 = standard → 每题限时作答（isPractice=false，倒计时由 LCRTask 自己走）。
    expect(task.textContent).toContain("practice=false");
  });

  test.each([
    ["lc", "real_lc_fx_1", "Listen to a Conversation"],
    ["la", "real_la_fx_1", "Listen to an Announcement"],
    ["lat", "real_lat_fx_1", "Listen to an Academic Talk"],
  ])("?type=%s → ListeningMCQTask（taskType 正确 + 2 题 + 音频）", async (type, id, title) => {
    mockSearch = new URLSearchParams(`type=${type}`);
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));

    const task = screen.getByTestId("mcq-task");
    expect(task.textContent).toContain(`id=${id}`);
    expect(task.textContent).toContain(`type=${type}`);
    expect(task.textContent).toContain(`title=${title}`);
    expect(task.textContent).toContain("q=2");
    expect(task.textContent).toContain("audio=https://");
  });

  // 来源信息全部落在选题卡上（答题页与常规练习逐像素同款，不挂来源条）：
  // 考试日期 + 分档 + source_flags 的一句话说明，都要在用户点进去之前看得到。
  test("选题卡带来源：考试日期 + 回忆版 + 重排版双票复核（source_flags 上屏）", async () => {
    mockSearch = new URLSearchParams("type=la");
    render(<RealBankPage />);

    const sub = (await screen.findByTestId("picker-first-subtitle")).textContent;
    expect(sub).toContain("2026.06.10");
    expect(sub).toContain("回忆版");
    expect(sub).not.toContain("ETS官方");
    // source_flags 走徽章位（subtitle 是 nowrap 窄行，塞进去会被 ellipsis 吃掉）。
    expect(screen.getByTestId("picker-first-badge")).toHaveTextContent("双票复核");
    expect(screen.getByTestId("picker-desc").textContent).toContain("回忆版 = 2026 考生回忆整理");
    expect(screen.getByTestId("picker-desc").textContent).toContain("答案经两家模型复核一致后才收录");

    fireEvent.click(screen.getByTestId("pick-first"));
    expect(screen.queryByTestId("real-source-banner")).toBeNull();
  });
});

describe("真题专区：口语选题 → 任务组件（录音 + STT 链路复用）", () => {
  test("?type=repeat → RepeatTask 收到逐句 items + setInfo", async () => {
    mockSearch = new URLSearchParams("type=repeat");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));

    const task = screen.getByTestId("repeat-task");
    expect(task.textContent).toContain("n=2");
    expect(task.textContent).toContain("first=Use keywords");
    expect(task.textContent).toContain("audio=https://");
    expect(task.textContent).toContain("set=real_repeat_fx_1");
    expect(task.textContent).toContain("practice=false");
  });

  test("?type=interview → InterviewTask 收到逐题 items + intro", async () => {
    mockSearch = new URLSearchParams("type=interview");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));

    const task = screen.getByTestId("interview-task");
    expect(task.textContent).toContain("n=2");
    expect(task.textContent).toContain("first=Do you have a good work-life balance?");
    expect(task.textContent).toContain("audio=https://");
    expect(task.textContent).toContain("intro=You have a");
  });
});

describe("真题专区：听力 / 口语做完 → 历史 + 已练", () => {
  test("LCR 交卷 → listening 历史（details.items 形状照 app/listening/page.js）+ LISTENING_LCR 已练", async () => {
    mockSearch = new URLSearchParams("type=lcr");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    fireEvent.click(screen.getByTestId("lcr-finish"));

    expect([...loadDoneIds(DONE_STORAGE_KEYS.LISTENING_LCR)]).toContain("real_lcr_fx_1");

    const sess = (loadHist().sessions || []).find((s) => s.details?.itemIds?.includes("real_lcr_fx_1"));
    expect(sess).toBeTruthy();
    expect(sess.type).toBe("listening");
    expect(sess.details.subtype).toBe("lcr");
    expect(sess.details.real).toBe(true);
    expect(sess.band).toBe(6);
    // lib/listeningMistakes.js 抽 LCR 错题只认 details.items[]，缺了错题本捡不着。
    expect(sess.details.items[0].id).toBe("real_lcr_fx_1");
    expect(sess.details.items[0].options.A).toBeTruthy();
  });

  test.each([
    ["lc", "real_lc_fx_1", DONE_STORAGE_KEYS.LISTENING_LC],
    ["la", "real_la_fx_1", DONE_STORAGE_KEYS.LISTENING_LA],
    ["lat", "real_lat_fx_1", DONE_STORAGE_KEYS.LISTENING_LAT],
  ])("%s 交卷 → 历史带 transcript/questions + 各自的已练 key", async (type, id, doneKey) => {
    mockSearch = new URLSearchParams(`type=${type}`);
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    fireEvent.click(screen.getByTestId("mcq-finish"));

    expect([...loadDoneIds(doneKey)]).toContain(id);

    const sess = (loadHist().sessions || []).find((s) => s.details?.itemIds?.includes(id));
    expect(sess.type).toBe("listening");
    expect(sess.details.subtype).toBe(type);
    expect(sess.details.questions.length).toBe(2);
    // lc 的 TTS / 复习文本走 conversation，la/lat 走 transcript —— 两条支路都得有内容。
    expect(sess.details.conversation || sess.details.transcript).toBeTruthy();
  });

  test("repeat / interview 交卷 → speaking 历史 + 各自已练 key", async () => {
    mockSearch = new URLSearchParams("type=repeat");
    const { unmount } = render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    fireEvent.click(screen.getByTestId("repeat-finish"));
    unmount();

    expect([...loadDoneIds(DONE_STORAGE_KEYS.SPEAKING_REPEAT)]).toContain("real_repeat_fx_1");
    const rs = (loadHist().sessions || []).find((s) => s.details?.setId === "real_repeat_fx_1");
    expect(rs.type).toBe("speaking");
    expect(rs.details.subtype).toBe("repeat");
    expect(rs.details.real).toBe(true);
    expect(rs.details.avgScore).toBe(4);

    mockSearch = new URLSearchParams("type=interview");
    render(<RealBankPage />);
    fireEvent.click(await screen.findByTestId("pick-first"));
    fireEvent.click(screen.getByTestId("interview-finish"));

    expect([...loadDoneIds(DONE_STORAGE_KEYS.SPEAKING_INTERVIEW)]).toContain("real_interview_fx_1");
    const is = (loadHist().sessions || []).find((s) => s.details?.setId === "real_interview_fx_1");
    expect(is.details.subtype).toBe("interview");
  });

  test("常规练习做过的题在真题专区也亮「已练」（同一把 done key）", async () => {
    addDoneIds(DONE_STORAGE_KEYS.LISTENING_LAT, ["real_lat_fx_1"]);
    mockSearch = new URLSearchParams("type=lat");
    render(<RealBankPage />);
    expect((await screen.findByTestId("picker-done")).textContent).toContain("real_lat_fx_1");
  });
});
