/**
 * sessionStore.upsertMockSess 的云端路径 + cloudSessionStore.upsertMockSessionCloud。
 * 写作模考评分失败后「重试 AI 评分」会把整条记录再存一次；以前云端每次都 insert，同一场模考多出一行。锁：
 *   ①同一 mockSessionId 再存 = 原地更新那一行（score + details），date 保留首存时间，不再多插；
 *   ②两次保存并发（第一次还没落库）也只落一行；③查找出错退回 insert（最坏与从前一样）；④没 key 直接 insert；
 *   ⑤删除一场模考时同 mockSessionId 的旧重复行一起删（本地路径本来就这样），不会在同步后「复活」。
 */
const calls = [];
let ROWS = [];
let nextId = 100;
let SELECT_ERROR = null;

const eqsOf = (rec) => Object.fromEntries(rec.ops.filter((o) => o[0] === "eq").map((o) => [o[1], o[2]]));

function respond(rec) {
  const [kind, arg] = rec.ops[0];
  const eq = eqsOf(rec);
  if (kind === "insert") {
    ROWS.push({ id: nextId++, ...arg });
    return { error: null };
  }
  if (kind === "update") {
    ROWS = ROWS.map((row) => (row.id === eq.id && row.user_code === eq.user_code ? { ...row, ...arg } : row));
    return { error: null };
  }
  if (kind === "delete") {
    ROWS = ROWS.filter((row) => row.id !== eq.id);
    return { error: null };
  }
  if (arg === "id") {
    if (SELECT_ERROR) return { data: null, error: { message: SELECT_ERROR } };
    const hits = ROWS
      .filter((row) => row.user_code === eq.user_code && row.type === eq.type && row.details?.mockSessionId === eq["details->>mockSessionId"])
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    return { data: hits.slice(0, 1).map((row) => ({ id: row.id })), error: null };
  }
  return { data: ROWS.filter((row) => row.user_code === eq.user_code), error: null };
}

function chain(table) {
  const rec = { table, ops: [] };
  const api = {};
  for (const op of ["select", "insert", "update", "delete", "eq", "order", "limit"]) {
    api[op] = (...a) => { rec.ops.push([op, ...a]); return api; };
  }
  api.then = (resolve) => { calls.push(rec); resolve(respond(rec)); };
  return api;
}

jest.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { from: (table) => chain(table) },
}));

import { deleteSession, loadHist, setCurrentUser, upsertMockSess } from "../lib/sessionStore";

const settle = () => new Promise((r) => setTimeout(r, 20));
const ofKind = (kind) => calls.filter((c) => c.ops[0][0] === kind);
const lookups = () => calls.filter((c) => c.ops[0][0] === "select" && c.ops[0][1] === "id");

function mockSession(date, raw, extra = {}) {
  return { type: "mock", mode: "mock", date, score: raw, band: null, details: { realMock: true, source: "real-bank", section: "writing", mockSessionId: "ms-1", aggregate: { raw, maxRaw: 20 }, ...extra } };
}

beforeAll(() => {
  global.fetch = jest.fn(() => new Promise(() => {})); // referral activation: never resolves, never matters here
});

beforeEach(async () => {
  ROWS = [];
  SELECT_ERROR = null;
  setCurrentUser(null);
  await setCurrentUser("TESTCODE");
  await settle();
  calls.length = 0;
});

test("同一 mockSessionId 再存：更新同一行（score + details），date 保留首存时间，不再多插一行", async () => {
  upsertMockSess(mockSession("2026-10-01T10:00:00.000Z", 7), "ms-1");
  await settle();
  expect(ofKind("insert")).toHaveLength(1);
  expect(ROWS).toHaveLength(1);
  const id = ROWS[0].id;

  calls.length = 0;
  upsertMockSess(mockSession("2026-10-01T10:05:00.000Z", 15), "ms-1");
  await settle();
  expect(ofKind("insert")).toHaveLength(0);
  const [lookup] = lookups();
  expect(eqsOf(lookup)).toEqual({ user_code: "TESTCODE", type: "mock", "details->>mockSessionId": "ms-1" });
  const [update] = ofKind("update");
  expect(eqsOf(update)).toEqual({ id, user_code: "TESTCODE" });
  expect(Object.keys(update.ops[0][1]).sort()).toEqual(["details", "score"]);
  expect(ROWS).toHaveLength(1);
  expect(ROWS[0]).toMatchObject({ id, date: "2026-10-01T10:00:00.000Z" });
  expect(ROWS[0].details.aggregate.raw).toBe(15);

  // 同步回来的缓存：仍一条、新内容、首存时间
  const mocks = loadHist().sessions.filter((s) => s.type === "mock");
  expect(mocks).toHaveLength(1);
  expect(mocks[0]).toMatchObject({ id, date: "2026-10-01T10:00:00.000Z" });
  expect(mocks[0].details.aggregate.raw).toBe(15);
});

test("两次保存并发（第一次还没落库）：同一 key 排队执行，仍只落一行", async () => {
  upsertMockSess(mockSession("2026-10-01T10:00:00.000Z", 7), "ms-1");
  upsertMockSess(mockSession("2026-10-01T10:00:00.000Z", 9), "ms-1");
  await settle();
  expect(ofKind("insert")).toHaveLength(1);
  expect(ofKind("update")).toHaveLength(1);
  expect(ROWS).toHaveLength(1);
  expect(ROWS[0].details.aggregate.raw).toBe(9);
});

test("查找出错：退回 insert（最坏与从前一样多一行，不丢记录）", async () => {
  SELECT_ERROR = "column does not exist";
  upsertMockSess(mockSession("2026-10-01T10:00:00.000Z", 7), "ms-1");
  await settle();
  expect(ofKind("insert")).toHaveLength(1);
  expect(ROWS).toHaveLength(1);
});

test("没有 mockSessionId：直接 insert，不查", async () => {
  upsertMockSess(mockSession("2026-10-01T10:00:00.000Z", 7, { mockSessionId: "" }), "");
  await settle();
  expect(lookups()).toHaveLength(0);
  expect(ofKind("insert")).toHaveLength(1);
});

test("删除一场模考：同 mockSessionId 的旧重复行一起删；其余记录照旧只删一行", async () => {
  ROWS = [
    { id: 1, user_code: "TESTCODE", type: "mock", date: "2026-10-01T10:00:00.000Z", score: { band: null }, details: { mockSessionId: "ms-1", aggregate: { raw: 7 } } },
    { id: 2, user_code: "TESTCODE", type: "mock", date: "2026-10-01T10:05:00.000Z", score: { band: null }, details: { mockSessionId: "ms-1", aggregate: { raw: 15 } } },
    { id: 3, user_code: "TESTCODE", type: "email", date: "2026-10-02T10:00:00.000Z", score: { score: 4 }, details: { promptId: "real_em_1" } },
    { id: 4, user_code: "TESTCODE", type: "email", date: "2026-10-03T10:00:00.000Z", score: { score: 3 }, details: { promptId: "real_em_2" } },
  ];
  setCurrentUser(null);
  await setCurrentUser("TESTCODE");
  await settle();
  calls.length = 0;

  deleteSession(2);
  expect(loadHist().sessions.map((s) => s.id).sort()).toEqual([3, 4]);
  await settle();
  expect(ofKind("delete").map((c) => eqsOf(c).id).sort()).toEqual([1, 2]);
  expect(ROWS.map((r) => r.id).sort()).toEqual([3, 4]);

  calls.length = 0;
  deleteSession(3);
  await settle();
  expect(ofKind("delete").map((c) => eqsOf(c).id)).toEqual([3]);
  expect(ROWS.map((r) => r.id)).toEqual([4]);
});
