/**
 * sessionStore.patchSession 的云端路径 + cloudSessionStore.updateSessionCloud 的查询形状。
 * 真题「重试评分」要把新分数（score 列）与完整反馈（details 列）一起补回同一行；
 * 只更新 details 的 updateSessionDetailsCloud 不够用。锁：
 *   ①按行 id 找到记录、乐观更新缓存、再写云端；②写的是 score + details 两列，且带 user_code 防越权；
 *   ③云端写失败返回 false（不抛）；④找不到 id 不写。
 */
const calls = [];
let ROWS = [];
let UPDATE_ERROR = null;

function chain(kind, table) {
  const rec = { kind, table, ops: [] };
  const api = {
    select: (...a) => { rec.ops.push(["select", ...a]); return api; },
    update: (...a) => { rec.ops.push(["update", ...a]); return api; },
    eq: (...a) => { rec.ops.push(["eq", ...a]); return api; },
    order: (...a) => { rec.ops.push(["order", ...a]); return api; },
    limit: (...a) => { rec.ops.push(["limit", ...a]); return api; },
    insert: (...a) => { rec.ops.push(["insert", ...a]); return api; },
    delete: (...a) => { rec.ops.push(["delete", ...a]); return api; },
    then: (resolve) => {
      calls.push(rec);
      const isUpdate = rec.ops.some((o) => o[0] === "update");
      resolve(isUpdate ? { error: UPDATE_ERROR ? { message: UPDATE_ERROR } : null } : { data: ROWS, error: null });
    },
  };
  return api;
}
jest.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { from: (table) => chain("from", table) },
}));

import { loadHist, patchSession, setCurrentUser } from "../lib/sessionStore";
import { applyRescore } from "../lib/realBankRescore";

const failedRow = {
  id: 41, type: "email", date: "2026-09-28T20:48:00.000Z",
  score: { score: null, mode: "standard" },
  details: { promptId: "real_em_1", promptData: { id: "real_em_1" }, userText: "Dear Ms. Carter", feedback: null, scoringFailed: true, scoringError: "AI 响应超时，请重试" },
};
const FB = { score: 4, band: "4", summary: "ok", annotationSegments: [], comparison: { modelEssay: "", points: [] } };

async function login() {
  ROWS = [failedRow];
  await setCurrentUser("TESTCODE");
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  calls.length = 0;
  UPDATE_ERROR = null;
  await login();
  calls.length = 0;
});

const updates = () => calls.filter((c) => c.ops.some((o) => o[0] === "update"));

test("云端：按行 id 补丁 → 缓存立刻更新，并把 score + details 两列写回同一行（带 user_code）", async () => {
  const before = loadHist().sessions.find((s) => s.id === 41);
  expect(before.score).toBeNull();
  const ok = await patchSession(41, (cur) => applyRescore(cur, FB, new Date("2026-10-03T12:00:00.000Z")));
  expect(ok).toBe(true);

  const [u] = updates();
  expect(u.table).toBe("sessions");
  const payload = u.ops.find((o) => o[0] === "update")[1];
  expect(payload.score).toEqual({ score: 4, mode: "standard" });
  expect(payload.details.feedback).toEqual(FB);
  expect(payload.details.scoringFailed).toBe(false);
  expect(payload.details).not.toHaveProperty("scoringError");
  const eqs = u.ops.filter((o) => o[0] === "eq").map((o) => [o[1], o[2]]);
  expect(eqs).toEqual([["id", 41], ["user_code", "TESTCODE"]]);

  const after = loadHist().sessions.find((s) => s.id === 41);
  expect(after.score).toBe(4);
  expect(after.details.feedback.score).toBe(4);
});

test("云端写失败：返回 false，不抛错", async () => {
  UPDATE_ERROR = "permission denied";
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  expect(await patchSession(41, (cur) => applyRescore(cur, FB))).toBe(false);
  warn.mockRestore();
});

test("云端：id 不在缓存里 / 不是整数 → 不写", async () => {
  expect(await patchSession(999, (cur) => cur)).toBe(false);
  expect(await patchSession("abc", (cur) => cur)).toBe(false);
  expect(updates()).toHaveLength(0);
});
