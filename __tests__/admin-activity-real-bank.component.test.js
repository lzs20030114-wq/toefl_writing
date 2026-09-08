/**
 * 后台「答题情况」页的真题板块：
 *   - 顶部「真题专区练习统计」面板按 /api/admin/real-bank 渲染卡片 / 分题型 / Top 真题
 *   - 按登录码表多一列「真题」（usageByCode[code].realSessions）
 *   - 展开详情后真题作答带「真题」标签（attempt.real）
 */
import React from "react";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  usePathname: () => "/admin-activity",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const REAL_BANK_BODY = {
  ok: true, days: 30, allSessions: 40, allUsers: 10, realSessions: 12, realUsers: 4,
  realSharePct: 30, userSharePct: 40, accuracyPct: 85,
  subtypes: [
    { subject: "writing", subtype: "build", sessions: 3, users: 2, correct: 25, total: 30, accuracyPct: 83, avgScore: null },
    { subject: "writing", subtype: "discussion", sessions: 2, users: 2, correct: 0, total: 0, accuracyPct: null, avgScore: 3.5 },
    { subject: "reading", subtype: "ap", sessions: 7, users: 3, correct: 60, total: 70, accuracyPct: 86, avgScore: null },
    { subject: "listening", subtype: "lcr", sessions: 0, users: 0, correct: 0, total: 0, accuracyPct: null, avgScore: null },
  ],
  topItems: [{ id: "real_ap_511_1_26", subject: "reading", subtype: "ap", sessions: 5, users: 3 }],
  daily: [{ date: "2026-09-06", count: 2 }, { date: "2026-09-07", count: 1 }],
};

const CODES_BODY = {
  codes: [{ code: "ABC234", status: "issued", issued_to: "tester", note: "" }],
  stats: { available: 0, issued: 1, revoked: 0, total: 1 },
  usageByCode: {
    ABC234: {
      sessions: 9, realSessions: 4, lastActiveAt: "2026-09-07T00:00:00Z", tier: "pro", userStatus: "active",
      answered: { writing: { build: 1, email: 0, discussion: 0, total: 1 }, reading: { ctw: 0, rdl: 0, ap: 8, total: 8 }, listening: { lcr: 0, la: 0, lc: 0, lat: 0, total: 0 }, speaking: { interview: 0, repeat: 0, total: 0 }, build: 1, email: 0, discussion: 0, total: 1 },
      answeredReal: { writing: { build: 0, email: 0, discussion: 0, total: 0 }, reading: { ctw: 0, rdl: 0, ap: 4, total: 4 }, listening: { lcr: 0, la: 0, lc: 0, lat: 0, total: 0 }, speaking: { interview: 0, repeat: 0, total: 0 }, build: 0, email: 0, discussion: 0, total: 0 },
    },
  },
};

const ACTIVITY_BODY = {
  code: "ABC234",
  summary: { sessions: 9, realSessions: 4 },
  attempts: [
    { id: "s1-reading-ap-0", subject: "reading", subtype: "ap", date: "2026-09-07T00:00:00Z", topic: "Real AP passage", correct: 4, total: 5, pct: 80, scoreText: "4/5", real: true },
    { id: "s2-reading-ap-0", subject: "reading", subtype: "ap", date: "2026-09-06T00:00:00Z", topic: "Live AP passage", correct: 5, total: 5, pct: 100, scoreText: "5/5", real: false },
  ],
};

function mockFetch() {
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    const body = u.includes("/api/admin/real-bank") ? REAL_BANK_BODY
      : u.includes("/activity") ? ACTIVITY_BODY
        : u.includes("/api/admin/codes") ? CODES_BODY
          : {};
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
}

beforeEach(() => {
  localStorage.setItem("toefl-admin-token", "secret");
  mockFetch();
});

test("真题板块：面板 + 真题列 + 真题标签", async () => {
  const Page = require("../app/admin-activity/page").default;
  render(<Page />);

  // 面板
  await waitFor(() => expect(screen.getByText("真题专区练习统计")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText("真题练习场次")).toBeInTheDocument());
  expect(screen.getByText("12")).toBeInTheDocument();
  expect(screen.getByText("占全部练习 30%")).toBeInTheDocument();
  expect(screen.getByText("85%")).toBeInTheDocument();
  expect(screen.getByText("real_ap_511_1_26")).toBeInTheDocument();
  // 分题型：客观题给正确率、写作给均分
  expect(screen.getByText("86%")).toBeInTheDocument();
  expect(screen.getByText("3.5")).toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([u]) => String(u).includes("/api/admin/real-bank?days=30"))).toBe(true);

  // 切换到「全部」重新拉
  fireEvent.click(screen.getByRole("button", { name: "全部" }));
  await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => String(u).includes("/api/admin/real-bank?days=0"))).toBe(true));

  // 表头 + 真题列
  await waitFor(() => expect(screen.getByText("ABC234")).toBeInTheDocument());
  const row = screen.getByText("ABC234").closest("tr");
  const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
  // 登录码 / 备注 / 写作 / 阅读 / 听力 / 口语 / 场次 / 真题 / 最近 / 详情
  expect(cells.slice(2, 8)).toEqual(["1", "8", "—", "—", "9", "4"]);

  // 展开 → 阅读 → AP，真题作答带标签，普通作答不带
  fireEvent.click(within(row).getByRole("button", { name: "展开" }));
  // 阅读分区有 2 条记录（等详情请求回来再找它的「展开」按钮）
  await waitFor(() => expect(screen.getByText("2 条记录")).toBeInTheDocument());
  const readingHeader = screen.getByText("2 条记录").closest("div").parentElement.parentElement;
  fireEvent.click(within(readingHeader).getByRole("button", { name: "展开" }));
  // 面板的分题型表里也有一行 Academic Passage，只点用户详情里那一个（它后面跟着「2 条」）
  const apRow = screen.getAllByText("Academic Passage", { selector: "span" })
    .map((el) => el.parentElement)
    .find((el) => el && el.textContent.includes("2 条"));
  fireEvent.click(apRow);
  await waitFor(() => expect(screen.getByText("Real AP passage")).toBeInTheDocument());
  const realRow = screen.getByText("Real AP passage").parentElement;
  expect(within(realRow).getByText("真题")).toBeInTheDocument();
  const liveRow = screen.getByText("Live AP passage").parentElement;
  expect(within(liveRow).queryByText("真题")).toBeNull();
});
