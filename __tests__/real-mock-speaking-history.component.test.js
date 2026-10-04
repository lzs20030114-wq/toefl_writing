/**
 * 口语练习记录（SpeakingProgressView）不收口语真题模考：
 * 真题模考也存成 type "speaking" + subtype "mock"，但它住在「真题练习记录」（/real-bank/progress），
 * 原始分口径也不同（55 分制、未作答按 0 计）。混进来会多一条记录、把「模考」统计卡的平均 Band 拉偏。
 */
import { render, screen } from "@testing-library/react";

const day = (n) => `2026-10-0${n}T10:00:00.000Z`;
const mockSessions = [
  { type: "speaking", mode: "practice", date: day(1), details: { subtype: "repeat", averageScore: 4, attempted: 7, total: 7 } },
  { type: "speaking", mode: "mock", date: day(2), band: 4, details: { subtype: "mock", band: 4, repeatScore: 4, interviewScore: 3 } },
  { type: "speaking", mode: "mock", date: day(3), band: 1, details: {
    subtype: "mock", real: true, source: "real-bank", realMock: true, section: "speaking", band: 1, rawTotal: 0, unanswered: 11, unscored: 0,
  } },
];

jest.mock("../lib/AuthContext", () => ({ getSavedCode: () => "ABC123", getSavedTier: () => "pro" }));
jest.mock("../lib/history/subscribeHistory", () => ({
  subscribeHistory: (onChange) => { onChange({ sessions: mockSessions }); return () => {}; },
}));
jest.mock("../lib/sessionStore", () => ({
  loadHist: jest.fn(() => ({ sessions: mockSessions })),
  deleteSession: jest.fn(),
  clearAllSessions: jest.fn(),
}));
jest.mock("../components/listening/AudioPlayer", () => ({ AudioPlayer: () => null, default: () => null }));

import { SpeakingProgressView } from "../components/speaking/SpeakingProgressView";

test("口语练习记录只列练习与常规模考，口语真题模考不进列表也不进统计", () => {
  render(<SpeakingProgressView onBack={jest.fn()} />);

  expect(screen.getByText("2 条记录")).toBeInTheDocument();
  expect(screen.getAllByText("口语模考")).toHaveLength(1);
  // 常规模考 Band 4 → 行内与「模考」统计卡都是 Band 4；真题那条（Band 1）若混进来，平均会变成 Band 2.5。
  expect(screen.getAllByText("Band 4").length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText("Band 1")).toBeNull();
  expect(screen.queryByText("Band 2.5")).toBeNull();
});
