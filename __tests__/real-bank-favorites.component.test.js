/**
 * 真题收藏夹（题目级）：lib/realBankFavorites.js + 练习记录页的「☆ 收藏」/「★ 收藏夹」。
 * 锁：
 *  ①收藏身份 = 题型 + 题目 id，一题一条；按账号分 key；整卷模考记录本身不能收藏；
 *  ②练习明细每行、逐题回顾头部都能收藏 / 取消；收藏夹里能找到这道题、去做这道题、回看最近一次记录；
 *  ③记录删了收藏照样在（只是没有「看最近一次记录」）。
 */
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";

let mockCode = null;
jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => mockCode),
  getSavedTier: jest.fn(() => "pro"),
}));

let SESSIONS = [];
jest.mock("../lib/sessionStore", () => ({
  loadHist: jest.fn(() => ({ sessions: SESSIONS })),
  deleteSession: jest.fn(() => ({ sessions: [] })),
  patchSession: jest.fn(async () => true),
  clearAllSessions: jest.fn(() => ({ sessions: [] })),
  setCurrentUser: jest.fn(),
  SESSION_STORE_EVENTS: { HISTORY_UPDATED_EVENT: "toefl-history-updated" },
}));
jest.mock("../lib/ai/writingEval", () => ({ evaluateWritingResponse: jest.fn() }));

import {
  addRealFavorite,
  isRealFavorite,
  loadRealFavorites,
  realFavoriteHref,
  realFavoriteKey,
  toggleRealFavorite,
} from "../lib/realBankFavorites";
import { RealBankProgressView } from "../components/realBank/RealBankProgressView";

const realCtw = {
  id: 101, type: "reading", mode: "standard", date: "2026-09-02T10:00:00.000Z", correct: 1, total: 2, band: 3.5,
  details: {
    subtype: "ctw", itemId: "real_ctw_test_1", topic: "Campus housing notice",
    passage: "The dorm will close early this winter.",
    blanks: [
      { position: 1, original_word: "dorm", displayed_fragment: "do" },
      { position: 4, original_word: "early", displayed_fragment: "ea" },
    ],
    results: [{ isCorrect: true, userAnswer: "rm", fullWord: "dorm" }, { isCorrect: false, userAnswer: "rly", fullWord: "early" }],
  },
};
const realReadingMock = {
  id: 108, type: "mock", mode: "mock", date: "2026-09-08T10:00:00.000Z", score: 3,
  details: {
    real: true, source: "real-bank", realMock: true, subtype: "mock", section: "reading", mockSessionId: "mk1",
    seenItemIds: ["real_ctw_test_1"],
    aggregate: { raw: 1, maxRaw: 2 },
    tasks: [
      { taskType: "ctw", itemId: "real_ctw_test_1", module: 1, correct: 1, total: 2, results: realCtw.details.results, blanks: realCtw.details.blanks, passage: realCtw.details.passage, topic: "Campus housing notice" },
    ],
  },
};

beforeAll(() => { window.scrollTo = jest.fn(); });

beforeEach(() => {
  localStorage.clear();
  mockCode = null;
  SESSIONS = [];
});

describe("lib/realBankFavorites", () => {
  test("一题一条：重复收藏不加条目、保留原收藏时间；toggle 取消", () => {
    expect(realFavoriteKey("ctw", "")).toBe("");
    expect(addRealFavorite({ subtype: "ctw", itemId: "" })).toBe(false);
    expect(addRealFavorite({ subtype: "ctw", itemId: "real_ctw_1", subtitle: "A" })).toBe(true);
    const first = loadRealFavorites()[0].addedAt;
    addRealFavorite({ subtype: "ctw", itemId: "real_ctw_1", subtitle: "B" });
    const list = loadRealFavorites();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: "ctw:real_ctw_1", subtitle: "B", addedAt: first });
    expect(toggleRealFavorite({ subtype: "ctw", itemId: "real_ctw_1" })).toBe(false);
    expect(isRealFavorite("ctw:real_ctw_1")).toBe(false);
  });

  test("按账号分 key：换账号看不到别人的收藏", () => {
    mockCode = "AAA111";
    addRealFavorite({ subtype: "lc", itemId: "real_lc_1" });
    mockCode = "BBB222";
    expect(loadRealFavorites()).toEqual([]);
    mockCode = "AAA111";
    expect(loadRealFavorites().map((f) => f.key)).toEqual(["lc:real_lc_1"]);
  });

  test("去做这道题：真题专区同题型 + item", () => {
    expect(realFavoriteHref({ subtype: "bs", itemId: "real_bs_x_1" })).toBe("/real-bank?type=bs&item=real_bs_x_1");
  });
});

describe("练习记录页收藏夹", () => {
  test("练习明细里点 ☆ → 收藏夹找得到这道题，能去做、能回看最近一次记录、能取消", () => {
    SESSIONS = [realCtw];
    render(<RealBankProgressView onBack={() => {}} />);
    const row = screen.getByTestId("real-entry-row");
    const star = within(row).getByTestId("real-fav-toggle");
    expect(star).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(star);
    expect(star).toHaveAttribute("aria-pressed", "true");
    // 点星不该顺带展开这一行
    expect(row).toHaveAttribute("data-expanded", "0");

    fireEvent.click(screen.getByTestId("real-view-favorites"));
    const favRow = screen.getByTestId("real-fav-row");
    expect(favRow.textContent).toContain("Campus housing notice");
    expect(favRow.textContent).toContain("练过 1 次");
    expect(within(favRow).getByTestId("real-fav-practice")).toHaveAttribute("href", "/real-bank?type=ctw&item=real_ctw_test_1");

    fireEvent.click(within(favRow).getByTestId("real-fav-open"));
    expect(screen.getByTestId("real-session-detail")).toBeInTheDocument();
    expect(within(screen.getByTestId("real-session-detail")).getByTestId("real-fav-toggle")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("← 返回列表"));
    // 返回到的是收藏夹
    fireEvent.click(within(screen.getByTestId("real-fav-row")).getByTestId("real-fav-toggle"));
    expect(screen.queryByTestId("real-fav-row")).toBeNull();
    expect(screen.getByText("收藏夹还是空的")).toBeInTheDocument();
  });

  test("整卷模考记录本身不能收藏；点进题组后收藏那一组的题", () => {
    SESSIONS = [realReadingMock];
    render(<RealBankProgressView onBack={() => {}} />);
    expect(within(screen.getByTestId("real-entry-row")).queryByTestId("real-fav-toggle")).toBeNull();
    fireEvent.click(screen.getByTestId("real-entry-row").querySelector("[role=button]"));
    fireEvent.click(screen.getByText(/查看模考报告|逐题回顾|进入/, { selector: "button" }));
    expect(within(screen.getByTestId("real-session-detail")).queryByTestId("real-fav-toggle")).toBeNull();
    fireEvent.click(within(screen.getByTestId("real-mock-review")).getByText("逐题回顾 →"));
    fireEvent.click(within(screen.getByTestId("real-session-detail")).getByTestId("real-fav-toggle"));
    expect(loadRealFavorites().map((f) => f.key)).toEqual(["ctw:real_ctw_test_1"]);
  });

  test("记录删了收藏照样在（快照显示），只是没有「看最近一次记录」", () => {
    addRealFavorite({ subtype: "lc", itemId: "real_lc_gone_1", subtitle: "Library hours talk", tier: "recalled", examDate: "2026.3.10" });
    render(<RealBankProgressView onBack={() => {}} />);
    fireEvent.click(screen.getByTestId("real-view-favorites"));
    const favRow = screen.getByTestId("real-fav-row");
    expect(favRow.textContent).toContain("Library hours talk");
    expect(within(favRow).queryByTestId("real-fav-open")).toBeNull();
    expect(within(favRow).getByTestId("real-fav-practice")).toHaveAttribute("href", "/real-bank?type=lc&item=real_lc_gone_1");
  });
});
