/**
 * @jest-environment node
 *
 * 真题收藏夹云同步：lib/realBankFavorites（本地真源 + 合并 + 推拉）、lib/realBankFavoriteRow（入库校验）、
 * app/api/real-favorites（谁新谁赢、不覆盖云端更新的版本）。
 * 锁：取消收藏是软删除并会同步，换设备不会把取消的收藏复活。
 */
// node 环境（路由要 Request/Response）下补一个最小的 window + localStorage。
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
global.window = new EventTarget();

let mockCode = "SYNC01";
jest.mock("../lib/AuthContext", () => ({ getSavedCode: jest.fn(() => mockCode) }));

// 内存版 supabaseAdmin：实现路由的条件更新与唯一约束插入。
let mockRows = [];
jest.mock("../lib/supabaseAdmin", () => {
  const from = () => {
    const filters = [];
    let lim = Infinity;
    let update = null;
    const run = () => {
      const rows = mockRows.filter((r) => filters.every((f) => f(r))).slice(0, lim);
      if (update) rows.forEach((r) => Object.assign(r, update));
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const q = {
      select: () => q,
      eq: (c, v) => { filters.push((r) => r[c] === v); return q; },
      in: (c, vs) => { filters.push((r) => vs.includes(r[c])); return q; },
      order: () => q,
      limit: (n) => { lim = n; return q; },
      update: (value) => { update = value; return q; },
      insert: async (row) => {
        if (mockRows.some((r) => r.user_code === row.user_code && r.fav_key === row.fav_key)) {
          return { error: { code: "23505", message: "duplicate key" } };
        }
        mockRows.push({ ...row });
        return { error: null };
      },
      maybeSingle: async () => {
        const result = run();
        return { ...result, data: result.data[0] || null };
      },
      then: (res) => res(run()),
    };
    return q;
  };
  return { isSupabaseAdminConfigured: true, supabaseAdmin: { from } };
});

import { GET, POST } from "../app/api/real-favorites/route";
import { toFavRow } from "../lib/realBankFavoriteRow";
import {
  addRealFavorite,
  loadRealFavorites,
  mergeRealFavorites,
  removeRealFavorite,
  syncRealFavoritesOnce,
} from "../lib/realBankFavorites";

const fav = (over = {}) => ({ key: "lc:real_lc_1", subtype: "lc", itemId: "real_lc_1", subtitle: "Talk", addedAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...over });
const req = (url, body) => new Request(`http://localhost${url}`, body ? { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : undefined);

// 用路由本身当「服务器」：客户端 fetch 直接打到 GET/POST。
beforeAll(() => {
  global.fetch = jest.fn(async (url, init) => {
    const r = init?.method === "POST" ? await POST(req(url, JSON.parse(init.body))) : await GET(req(url));
    return r;
  });
});

beforeEach(() => {
  localStorage.clear();
  mockRows = [];
  mockCode = "SYNC01";
});

describe("toFavRow（入库校验）", () => {
  test("key 必须是「题型:real_ 题目 id」且与 subtype/itemId 一致", () => {
    expect(toFavRow("A", fav()).row).toMatchObject({ user_code: "A", fav_key: "lc:real_lc_1" });
    expect(toFavRow("A", fav({ key: "lc:real_lc_2" })).error).toMatch(/match/);
    expect(toFavRow("A", fav({ key: "lc:x", itemId: "x" })).error).toMatch(/invalid/);
    expect(toFavRow("A", fav({ subtitle: "x".repeat(3000) })).error).toMatch(/too large/);
  });
});

describe("mergeRealFavorites", () => {
  test("按 key 取 updatedAt 新的一份，软删除也参与比较", () => {
    const local = { [fav().key]: fav() };
    const remote = { [fav().key]: fav({ deletedAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" }) };
    expect(mergeRealFavorites(local, remote)[fav().key].deletedAt).toBeTruthy();
    expect(mergeRealFavorites(remote, local)[fav().key].deletedAt).toBeTruthy();
  });
});

describe("推拉", () => {
  test("A 设备收藏 → 推上云 → B 设备（清空本地）拉回来", async () => {
    addRealFavorite({ subtype: "lc", itemId: "real_lc_1", subtitle: "Talk" });
    await syncRealFavoritesOnce("SYNC01");
    expect(mockRows.map((r) => r.fav_key)).toEqual(["lc:real_lc_1"]);

    localStorage.clear();
    expect(loadRealFavorites()).toEqual([]);
    await syncRealFavoritesOnce("SYNC01");
    expect(loadRealFavorites().map((f) => f.subtitle)).toEqual(["Talk"]);
  });

  test("取消收藏同步到云端，另一台设备的旧副本不会把它复活", async () => {
    addRealFavorite({ subtype: "lc", itemId: "real_lc_1" });
    await syncRealFavoritesOnce("SYNC01");
    const stale = localStorage.getItem("toefl-real-favorites-v1::user:SYNC01"); // 「另一台设备」的旧副本

    await new Promise((r) => setTimeout(r, 5));
    removeRealFavorite("lc:real_lc_1");
    await syncRealFavoritesOnce("SYNC01");
    expect(mockRows[0].fav.deletedAt).toBeTruthy();

    localStorage.setItem("toefl-real-favorites-v1::user:SYNC01", stale);
    expect(loadRealFavorites()).toHaveLength(1);
    await syncRealFavoritesOnce("SYNC01");
    expect(loadRealFavorites()).toEqual([]);
    expect(mockRows[0].fav.deletedAt).toBeTruthy();
  });

  test("POST 不覆盖云端更新的版本；账号之间互不可见", async () => {
    mockRows = [{ user_code: "SYNC01", fav_key: "lc:real_lc_1", fav: fav({ subtitle: "NEW", updatedAt: "2026-10-05T00:00:00.000Z" }), updated_at: "2026-10-05T00:00:00.000Z" }];
    const r = await (await POST(req("/api/real-favorites", { code: "sync01", favorites: [fav({ subtitle: "OLD" })] }))).json();
    expect(r).toEqual({ ok: true, saved: 0 });
    expect(mockRows[0].fav.subtitle).toBe("NEW");
    const other = await (await GET(req("/api/real-favorites?code=OTHER"))).json();
    expect(other.favorites).toEqual([]);
  });

  test("游客不同步", async () => {
    expect(await syncRealFavoritesOnce("guest")).toBe(false);
  });
});
