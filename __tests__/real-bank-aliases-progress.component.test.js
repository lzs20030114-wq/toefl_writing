/**
 * 真题练习记录页（components/realBank/RealBankProgressView.js）× 旧 id 别名 × 选句题记录。
 *   ① 覆盖率 / 最新一次 / 列表题型按「解析后的当前 id + 题型」算：记录里 subtype=ap、已归位到日常阅读的
 *      算进 rdl；同一篇旧 id 与新 id 只算一篇；
 *   ② 逐题回顾复用 RDLDetail，选句题写出你选的句子与正确句子；「再练一套」指向归位后的题型。
 * 别名账本 virtual mock；记录形状照 app/real-bank/page.js 的 saveRealReadingSession。
 */
import { render, screen, fireEvent, within } from "@testing-library/react";

if (typeof global.fetch !== "function") {
  global.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });
}

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
  getSavedTier: jest.fn(() => "pro"),
}));

let SESSIONS = [];
jest.mock("../lib/sessionStore", () => ({
  loadHist: jest.fn(() => ({ sessions: SESSIONS })),
  deleteSession: jest.fn(() => ({ sessions: [] })),
  clearAllSessions: jest.fn(() => ({ sessions: [] })),
  setCurrentUser: jest.fn(),
  SESSION_STORE_EVENTS: { HISTORY_UPDATED_EVENT: "toefl-history-updated" },
}));

jest.mock("../data/realBank/reading/id-aliases.json", () => ({
  generated_by: "fixture",
  generated: "2026-09-13",
  aliases: [
    { from: "real_ap_fixture_old_1_25", to: "real_rdl_fixture_new_1_25", from_type: "ap", to_type: "rdl", reason: "reclassified" },
    { from: "real_ap_fixture_copy_1_32", to: "real_ap_fixture_ss_1", from_type: "ap", to_type: "ap", reason: "consolidated" },
  ],
}), { virtual: true });

import FIXTURE from "./fixtures/real-ap-sentence-selection.json";
import REAL_READING_COUNTS from "../data/realBank/reading/counts.json";
import { RealBankProgressView } from "../components/realBank/RealBankProgressView";

const RAW = FIXTURE.items[0];
const SS = RAW.questions[2];

function readingSession(id, itemId, date, { ssSelected = "S3" } = {}) {
  const results = [
    { selected: "B", correct: "B", isCorrect: true },
    { selected: "A", correct: "A", isCorrect: true },
    { selected: ssSelected, correct: "S2", isCorrect: ssSelected === "S2" },
  ];
  return {
    id, type: "reading", mode: "standard", date,
    correct: results.filter((r) => r.isCorrect).length, total: 3, band: 4.5,
    details: { subtype: "ap", itemId, topic: RAW.topic, genre: "", results, passage: RAW.passage, questions: RAW.questions },
  };
}

beforeEach(() => {
  SESSIONS = [
    // 最新：学术阅读列表里做的、后来归位到日常阅读的那篇（带选句题）
    readingSession(301, "real_ap_fixture_old_1_25", "2026-09-12T10:00:00.000Z"),
    // 同一篇的副本 id 与代表 id 各做了一次 → 覆盖只算一篇
    readingSession(302, "real_ap_fixture_copy_1_32", "2026-09-11T10:00:00.000Z", { ssSelected: "S2" }),
    readingSession(303, "real_ap_fixture_ss_1", "2026-09-10T10:00:00.000Z", { ssSelected: "S2" }),
  ];
});

function coverageRow(short) {
  const card = screen.getByTestId("real-coverage-card");
  const label = within(card).getAllByText(short).find((el) => el.tagName === "SPAN");
  return label.parentElement;
}

describe("RealBankProgressView × 旧 id 别名", () => {
  test("覆盖率按当前 id / 题型：归位的算进日常阅读，同篇两次只算一篇", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    expect(coverageRow("日常").textContent).toContain(`1/${REAL_READING_COUNTS.rdl || "?"}`);
    expect(coverageRow("学术").textContent).toContain(`1/${REAL_READING_COUNTS.ap || "?"}`);
  });

  test("最新一次 + 列表题型按归位后的题型显示；三条记录一条不少", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    expect(within(screen.getByTestId("real-latest-card")).getByText(/日常阅读真题/)).toBeInTheDocument();
    const rows = screen.getAllByTestId("real-entry-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("日常阅读真题");
    expect(rows[1].textContent).toContain("学术阅读真题");
    expect(rows[2].textContent).toContain("学术阅读真题");
  });

  test("点开归位的那条：逐题回顾里选句题写出你选的句子与正确句子；「再练一套」指向日常阅读", () => {
    render(<RealBankProgressView onBack={() => {}} />);
    fireEvent.click(screen.getAllByTestId("real-entry-row")[0]);
    const detail = screen.getByTestId("real-session-detail");
    const ss = within(detail).getByTestId("ss-history-detail");
    expect(within(ss).getByText(`你选的句子：${SS.options.S3}`)).toBeInTheDocument();
    expect(within(ss).getByText(`正确句子：${SS.options.S2}`)).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "再练一套" }).getAttribute("href")).toBe("/real-bank?type=rdl");
  });
});
