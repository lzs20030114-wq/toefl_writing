import { render, screen, act } from "@testing-library/react";

// The ordinary reading / listening progress pages must not show real mocks
// (details.realMock === true): those live on 真题练习记录 (the results page links
// there), and this page's 换算分 / CEFR / Upper-Lower view doesn't fit their raw-35
// score or practice-extra items. Standard mocks and real-bank single-item
// practice records stay.

if (typeof global.fetch !== "function") {
  global.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });
}

let mockSessions = [];
jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
  getSavedTier: jest.fn(() => "free"),
}));
jest.mock("../lib/sessionStore", () => ({
  loadHist: jest.fn(() => ({ sessions: mockSessions })),
  deleteSession: jest.fn(() => ({ sessions: [] })),
  clearAllSessions: jest.fn(() => ({ sessions: [] })),
  setCurrentUser: jest.fn(),
  SESSION_STORE_EVENTS: { HISTORY_UPDATED_EVENT: "toefl-history-updated" },
}));

import { ReadingProgressView } from "../components/reading/ReadingProgressView";
import { ListeningProgressView } from "../components/listening/ListeningProgressView";

const REAL_MOCK_DATE = "2026-10-03T08:00:00.000Z";

function realMock(section) {
  return {
    id: 2, type: section, mode: "mock", source: "real-bank", real: true, realMock: true, section,
    date: REAL_MOCK_DATE, correct: 7, total: 35, band: 2,
    details: {
      subtype: "mock", source: "real-bank", real: true, realMock: true, section,
      path: "lower", band: 2, cefr: "A2", seenItemIds: ["real_x"], itemIds: ["real_x"],
      m1: { correct: 5, total: 20, extraCorrect: 3, extraTotal: 15, accuracy: 0.25 },
      m2: { correct: 2, total: 15, extraCorrect: 0, extraTotal: 0, accuracy: 2 / 15 },
      tasks: [],
    },
  };
}
function standardMock(section) {
  return {
    id: 1, type: section, mode: "mock", date: "2026-10-01T08:00:00.000Z", correct: 30, total: 50, band: 4.5,
    details: { subtype: "mock", path: "upper", band: 4.5, cefr: "B2", m1: { correct: 20, total: 30 }, m2: { correct: 10, total: 20 } },
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("ReadingProgressView", () => {
  beforeEach(() => {
    mockSessions = [
      standardMock("reading"),
      realMock("reading"),
      {
        id: 3, type: "reading", mode: "practice", date: "2026-10-02T08:00:00.000Z", correct: 1, total: 1,
        details: { subtype: "ctw", itemId: "real_ctw_1", topic: "Real CTW topic", results: [{ isCorrect: true }] },
      },
    ];
  });

  test("leaves real mocks out of the mock list, latest-mock card and practice stats", () => {
    render(<ReadingProgressView onBack={() => {}} />);
    expect(screen.getByText("🎯 模考记录 (1)")).toBeInTheDocument();
    expect(screen.getAllByText("4.5").length).toBeGreaterThan(0); // latest = the standard mock
    expect(screen.queryByText("2.0")).toBeNull();
    expect(screen.queryByText("CEFR A2")).toBeNull();
    // Real-bank single-item practice stays in the practice list.
    expect(screen.getByText("Real CTW topic")).toBeInTheDocument();
    expect(screen.getByText("1 条记录")).toBeInTheDocument();
  });

  test("a ?mock= link to a real mock is not opened here", () => {
    window.history.replaceState(null, "", `/reading/progress?mock=${encodeURIComponent(REAL_MOCK_DATE)}`);
    render(<ReadingProgressView onBack={() => {}} />);
    expect(screen.getByText(/未找到本次模考的记录/)).toBeInTheDocument();
  });

  test("a history with only a real mock shows no mock at all", () => {
    mockSessions = [realMock("reading")];
    render(<ReadingProgressView onBack={() => {}} />);
    expect(screen.getByText("还没有阅读练习记录")).toBeInTheDocument();
  });
});

describe("ListeningProgressView", () => {
  beforeEach(() => {
    mockSessions = [
      standardMock("listening"),
      realMock("listening"),
      {
        id: 3, type: "listening", mode: "practice", date: "2026-10-02T08:00:00.000Z", correct: 1, total: 1,
        details: { subtype: "lcr", real: true, itemIds: ["real_lcr_1"], topic: "Real LCR topic", results: [{ selected: "A", correct: "A", isCorrect: true }], items: [] },
      },
    ];
  });

  test("leaves real mocks out of the list and stats", () => {
    render(<ListeningProgressView onBack={() => {}} />);
    expect(screen.getAllByText("听力模考")).toHaveLength(1); // the standard mock's row only
    expect(screen.getByText("Real LCR topic")).toBeInTheDocument();
    expect(screen.getByText("2 条记录")).toBeInTheDocument();
  });

  test("a ?mock= link to a real mock is not opened here", async () => {
    window.history.replaceState(null, "", `/listening/progress?mock=${encodeURIComponent(REAL_MOCK_DATE)}`);
    render(<ListeningProgressView onBack={() => {}} />);
    await act(async () => {});
    expect(screen.getByText(/未找到本次模考的记录/)).toBeInTheDocument();
    expect(screen.queryByText("题目回顾 (0)")).toBeNull();
  });
});
