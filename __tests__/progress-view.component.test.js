import { render, screen } from "@testing-library/react";
import { ProgressView } from "../components/ProgressView";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
}));

jest.mock("../lib/sessionStore", () => ({
  loadHist: jest.fn(() => ({
    sessions: [
      {
        type: "mock",
        date: "2026-02-15T10:00:00.000Z",
        band: 4.5,
        scaledScore: 24,
        details: {
          tasks: [null, { taskId: "email-writing", score: 3, maxScore: 5 }],
        },
      },
      {
        type: "bs",
        date: "2026-02-14T10:00:00.000Z",
        correct: 0,
        total: 0,
        details: [],
      },
      {
        id: 11,
        type: "email",
        date: "2026-02-13T10:00:00.000Z",
        score: 3,
        details: { practiceRootId: "root-a", practiceAttempt: 1, userText: "a", feedback: {} },
      },
      {
        id: 12,
        type: "email",
        date: "2026-02-13T11:00:00.000Z",
        score: 4,
        details: { practiceRootId: "root-a", practiceAttempt: 2, userText: "b", feedback: {} },
      },
    ],
  })),
  deleteSession: jest.fn(() => ({ sessions: [] })),
  clearAllSessions: jest.fn(() => ({ sessions: [] })),
  setCurrentUser: jest.fn(),
  SESSION_STORE_EVENTS: { HISTORY_UPDATED_EVENT: "toefl-history-updated" },
}));

describe("ProgressView", () => {
  test("renders with malformed history data without crashing", () => {
    render(<ProgressView onBack={() => {}} />);
    expect(screen.getAllByText("练习记录").length).toBeGreaterThan(0);
    expect(screen.getByText(/模考记录/)).toBeInTheDocument();
    expect(screen.getByText(/日常练习明细/)).toBeInTheDocument();
  });

  test("renders all practice entries including retries", () => {
    render(<ProgressView onBack={() => {}} />);
    expect(screen.getAllByText("邮件写作").length).toBeGreaterThanOrEqual(2);
  });
});
