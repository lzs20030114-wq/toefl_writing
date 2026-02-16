import { buildHistoryEntries, buildHistoryStats, buildRecentEntries } from "../lib/history/viewModel";

describe("history view model", () => {
  test("dedupes mock sessions by mockSessionId and keeps latest", () => {
    const hist = {
      sessions: [
        { type: "mock", details: { mockSessionId: "m1" }, score: 10 },
        { type: "email", score: 4 },
        { type: "mock", details: { mockSessionId: "m1" }, score: 80 },
      ],
    };
    const entries = buildHistoryEntries(hist);
    expect(entries.length).toBe(2);
    expect(entries[0].session.type).toBe("email");
    expect(entries[1].session.score).toBe(80);
  });

  test("builds stats and pending flag", () => {
    const entries = [
      { sourceIndex: 0, session: { type: "bs", correct: 8, total: 10 } },
      { sourceIndex: 1, session: { type: "mock", details: { tasks: [{ score: null }, { score: 5 }] } } },
    ];
    const stats = buildHistoryStats(entries);
    expect(stats.byType.bs.length).toBe(1);
    expect(stats.byType.mock.length).toBe(1);
    expect(stats.hasPendingMock).toBe(true);
  });

  test("returns recent entries in reverse chronological order", () => {
    const entries = [
      { sourceIndex: 0, session: { type: "bs" } },
      { sourceIndex: 1, session: { type: "email" } },
      { sourceIndex: 2, session: { type: "discussion" } },
    ];
    const recent = buildRecentEntries(entries, 2);
    expect(recent[0].sourceIndex).toBe(2);
    expect(recent[1].sourceIndex).toBe(1);
  });
});
