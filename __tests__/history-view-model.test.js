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
      { sourceIndex: 0, session: { type: "bs", date: "2026-01-01T00:00:00.000Z" } },
      { sourceIndex: 1, session: { type: "email", date: "2026-01-03T00:00:00.000Z" } },
      { sourceIndex: 2, session: { type: "discussion", date: "2026-01-02T00:00:00.000Z" } },
    ];
    const recent = buildRecentEntries(entries, 2);
    expect(recent[0].sourceIndex).toBe(1);
    expect(recent[1].sourceIndex).toBe(2);
  });

  test("dedupes mock sessions correctly for cloud-desc ordered history", () => {
    const hist = {
      sessions: [
        { id: 101, type: "mock", date: "2026-02-10T10:00:00.000Z", details: { mockSessionId: "m1" }, score: 80 },
        { id: 88, type: "email", date: "2026-02-09T10:00:00.000Z", score: 4 },
        { id: 70, type: "mock", date: "2026-02-08T10:00:00.000Z", details: { mockSessionId: "m1" }, score: 60 },
      ],
    };
    const entries = buildHistoryEntries(hist);
    const mock = entries.find((e) => e.session.type === "mock");
    expect(entries.length).toBe(2);
    expect(mock.session.score).toBe(80);
  });
});
