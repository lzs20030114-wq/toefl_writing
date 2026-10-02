import { aggregateRealBank } from "../lib/admin/realBankStats";
import { projectRealFields } from "../lib/admin/realSession";

test("a mock counts once as a session and credits every actually seen item", () => {
  const row = {
    user_code: "ABC123", type: "mock", date: "2026-10-02T10:00:00Z", score: { correct: 8, total: 10 },
    details: {
      real: true, source: "real-bank", realMock: true, section: "writing", subtype: "mock",
      itemIds: ["real_bs_seen", "real_bs_unseen"], seenItemIds: ["real_bs_seen", "real_bs_seen", "real_email_seen"],
    },
  };
  const summary = aggregateRealBank([{ ...row, ...projectRealFields(row) }]);
  expect(summary.realSessions).toBe(1);
  expect(summary.subtypes.find((x) => x.subject === "writing" && x.subtype === "mock")?.sessions).toBe(1);
  expect(summary.topItems.map((x) => x.id).sort()).toEqual(["real_bs_seen", "real_email_seen"]);
  expect(summary.topItems.every((x) => x.sessions === 1)).toBe(true);
});
