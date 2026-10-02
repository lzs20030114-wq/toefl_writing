jest.mock("../lib/supabaseAdmin", () => ({ supabaseAdmin: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock("../lib/realMockExam/planner", () => ({ loadRealMockPool: jest.fn(() => ({})), planRealMockExam: jest.fn(() => ({ ok: false, code: "REAL_MOCK_EXHAUSTED", deficits: [] })) }));
import { prepareAttempt } from "../lib/realMockExam/repository";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { planRealMockExam } from "../lib/realMockExam/planner";

function queryFor(table) {
  const q = {
    select: () => q, eq: () => q, gt: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
    range: async (from, to) => {
      if (table !== "sessions") return { data: [], error: null };
      const all = Array.from({ length: 501 }, (_, i) => ({ id: i + 1, details: { itemId: `real_ctw_${i + 1}` } }));
      return { data: all.slice(from, to + 1), error: null };
    },
  };
  return q;
}

test("prepare reads all cloud session pages beyond the former 200-row limit", async () => {
  supabaseAdmin.from.mockImplementation((table) => queryFor(table));
  const result = await prepareAttempt("ABC123", "reading", ["real_local_done"]);
  expect(result.code).toBe("REAL_MOCK_EXHAUSTED");
  const options = planRealMockExam.mock.calls[0][1];
  expect(options.doneIds).toHaveLength(502);
  expect(options.doneIds).toContain("real_ctw_501");
  expect(options.doneIds).toContain("real_local_done");
});
