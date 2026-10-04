jest.mock("../lib/supabaseAdmin", () => ({ supabaseAdmin: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock("../lib/realMockExam/planner", () => ({ loadRealMockPool: jest.fn(() => ({})), planRealMockExam: jest.fn() }));
import { prepareAttempt } from "../lib/realMockExam/repository";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { planRealMockExam } from "../lib/realMockExam/planner";

// sessions 行的 details->>realMock 投影：布尔 true → "true"；缺字段 / 数组 details → null（与 PostgREST 一致）。
const realMockText = (row) => {
  const d = row.details;
  return d && typeof d === "object" && !Array.isArray(d) && d.realMock != null ? String(d.realMock) : null;
};

let SESSION_ROWS = [];
let FAIL_SPLIT = false;
const queries = [];

function sessionRows(filters) {
  if (filters.some(([op, col]) => op === "eq" && col === "details->>realMock")) {
    // The light query only projects seenItemIds out of a real-mock row's details.
    return SESSION_ROWS.filter((row) => realMockText(row) === "true")
      .map((row) => ({ id: row.id, type: row.type, seenItemIds: row.details.seenItemIds ?? null }));
  }
  if (filters.some(([op, col]) => op === "is" && col === "details->>realMock")) return SESSION_ROWS.filter((row) => realMockText(row) === null);
  return SESSION_ROWS;
}

function queryFor(table) {
  const rec = { table, select: "", filters: [] };
  queries.push(rec);
  const q = {
    select: (cols) => { rec.select = cols; return q; },
    eq: (col, value) => { rec.filters.push(["eq", col, value]); return q; },
    is: (col, value) => { rec.filters.push(["is", col, value]); return q; },
    gt: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
    range: async (from, to) => {
      if (table !== "sessions") return { data: [], error: null };
      if (FAIL_SPLIT && rec.filters.some(([, col]) => col === "details->>realMock")) return { data: null, error: { message: "failed to parse filter" } };
      return { data: sessionRows(rec.filters).slice(from, to + 1), error: null };
    },
  };
  return q;
}

const sessionQueries = () => queries.filter((rec) => rec.table === "sessions");
const doneIdsPassedToPlanner = () => planRealMockExam.mock.calls.at(-1)[1].doneIds;

beforeEach(() => {
  jest.clearAllMocks();
  queries.length = 0;
  FAIL_SPLIT = false;
  SESSION_ROWS = [];
  supabaseAdmin.from.mockImplementation((table) => queryFor(table));
  planRealMockExam.mockImplementation(() => ({ ok: false, code: "REAL_MOCK_EXHAUSTED", deficits: [] }));
});

test("prepare reads all cloud session pages beyond the former 200-row limit", async () => {
  SESSION_ROWS = Array.from({ length: 501 }, (_, i) => ({ id: i + 1, type: "reading", details: { itemId: `real_ctw_${i + 1}` } }));
  const result = await prepareAttempt("ABC123", "reading", ["real_local_done"]);
  expect(result.code).toBe("REAL_MOCK_EXHAUSTED");
  const doneIds = doneIdsPassedToPlanner();
  expect(doneIds).toHaveLength(502);
  expect(doneIds).toContain("real_ctw_501");
  expect(doneIds).toContain("real_local_done");
});

const practiceRow = { id: 1, type: "reading", details: { itemId: "real_ctw_practice" } };
const bsRow = { id: 2, type: "bs", details: [{ qid: "real_bs_a" }] };
const bigMockRow = {
  id: 3, type: "reading",
  details: { realMock: true, seenItemIds: ["real_ctw_seen"], itemIds: ["real_ctw_unseen"], items: [{ id: "real_ctw_unseen", passage: "x".repeat(1000) }], tasks: [{ itemId: "real_ctw_unseen" }] },
};

test("real mock rows are read without their details: only seenItemIds are projected (both queries paged)", async () => {
  const mocks = Array.from({ length: 501 }, (_, i) => ({ id: 100 + i, type: "listening", details: { realMock: true, seenItemIds: [`real_lcr_${i + 1}`], items: [{ id: `real_lcr_unseen_${i + 1}` }] } }));
  SESSION_ROWS = [practiceRow, bsRow, bigMockRow, ...mocks];
  await prepareAttempt("ABC123", "reading", []);

  // allRows builds one query per 500-row page: the light query needs 2 pages here, the full one 1.
  const light = sessionQueries().filter((rec) => rec.filters.some(([op, col]) => op === "eq" && col === "details->>realMock"));
  const full = sessionQueries().filter((rec) => rec.filters.some(([op, col]) => op === "is" && col === "details->>realMock"));
  expect(light).toHaveLength(2);
  expect(full).toHaveLength(1);
  expect(sessionQueries()).toHaveLength(3);
  for (const rec of light) {
    expect(rec.select).toBe("id,type,seenItemIds:details->seenItemIds");
    expect(rec.filters).toEqual(expect.arrayContaining([["eq", "user_code", "ABC123"], ["eq", "details->>realMock", "true"]]));
  }
  expect(full[0].select).toBe("id,type,details");
  expect(full[0].filters).toEqual(expect.arrayContaining([["eq", "user_code", "ABC123"], ["is", "details->>realMock", null]]));

  const doneIds = doneIdsPassedToPlanner();
  expect(doneIds).toEqual(expect.arrayContaining(["real_ctw_practice", "real_bs_a", "real_ctw_seen", "real_lcr_1", "real_lcr_501"]));
  expect(doneIds).not.toContain("real_ctw_unseen");
  expect(doneIds).not.toContain("real_lcr_unseen_1");
  expect(doneIds).toHaveLength(3 + 501);
});

test("if the split query fails, the original full-details query is used and gives the same ids", async () => {
  SESSION_ROWS = [practiceRow, bsRow, bigMockRow];
  FAIL_SPLIT = true;
  await prepareAttempt("ABC123", "reading", []);

  const fallback = sessionQueries().filter((rec) => !rec.filters.some(([, col]) => col === "details->>realMock"));
  expect(fallback).toHaveLength(1);
  expect(fallback[0].select).toBe("id,type,details");
  const doneIds = doneIdsPassedToPlanner();
  expect([...doneIds].sort()).toEqual(["real_bs_a", "real_ctw_practice", "real_ctw_seen"]);
});

test("a reservation that keeps colliding asks the user to retry in Chinese", async () => {
  planRealMockExam.mockImplementation(() => ({ ok: true, paper: { items: [{ id: "real_ctw_a", realMockKeys: ["id:real_ctw_a"] }] } }));
  supabaseAdmin.rpc.mockResolvedValue({ data: { status: "collision" }, error: null });
  const result = await prepareAttempt("ABC123", "reading", []);
  expect(result).toMatchObject({ ok: false, code: "RESERVATION_CONFLICT", error: "同时有别的组卷请求，请稍后重试。" });
  expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(4);
});
