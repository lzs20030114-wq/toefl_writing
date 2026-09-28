/** 单词本存储与同步的真实模块回归；网络只在测试里替身，不接生产。 */

const ok = (cards = [], nextCursor = null) => ({ ok: true, json: async () => ({ ok: true, cards, nextCursor }) });
const saved = () => ({ ok: true, json: async () => ({ ok: true }) });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

let store;
let logs;
beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  jest.resetModules();
  store = require("../lib/vocab/vocabStore");
  logs = require("../lib/vocab/reviewLog");
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  delete global.fetch;
});

function login(code) { localStorage.setItem("toefl-user-code", code); }
function card(word, updatedAt = "2026-09-27T00:00:00.000Z") {
  return { word, def: word, createdAt: updatedAt, updatedAt };
}

test("GET 期间的保存、评分、删除都参与合并与推送", async () => {
  login("AAAAAA");
  store.saveWord({ word: "grade" }, new Date("2026-09-26T00:00:00Z"));
  store.saveWord({ word: "delete" }, new Date("2026-09-26T00:00:00Z"));
  const get = deferred();
  const posts = [];
  global.fetch = jest.fn((url, options) => {
    if (!options?.method) return get.promise;
    if (url === "/api/vocab") posts.push(...JSON.parse(options.body).cards);
    return Promise.resolve(saved());
  });
  const task = store.syncVocabCloud();
  store.saveWord({ word: "new" }, new Date("2026-09-28T00:00:00Z"));
  store.gradeCard("grade", 3, new Date("2026-09-28T00:00:00Z"));
  store.removeWord("delete", new Date("2026-09-28T00:00:00Z"));
  get.resolve(ok([]));
  expect((await task).ok).toBe(true);
  expect(posts.map((c) => c.word).sort()).toEqual(["delete", "grade", "new"]);
  expect(posts.find((c) => c.word === "delete").deletedAt).toBeTruthy();
  expect(posts.find((c) => c.word === "grade").reps).toBeGreaterThan(0);
});

test("A 的 GET 迟到时不写入 B 或游客", async () => {
  login("AAAAAA");
  const get = deferred();
  global.fetch = jest.fn(() => get.promise);
  const task = store.syncVocabCloud();
  login("BBBBBB");
  get.resolve(ok([card("a-only")]));
  expect((await task).reason).toBe("account-changed");
  expect(store.loadBook()).toEqual([]);
  localStorage.removeItem("toefl-user-code");
  expect(store.loadBook()).toEqual([]);
});

test("POST 期间修改会在同一账号串行补跑，force 不并发", async () => {
  login("AAAAAA");
  store.saveWord({ word: "first" });
  const firstPost = deferred();
  let gets = 0;
  let posts = 0;
  global.fetch = jest.fn((url, options) => {
    if (!options?.method) { gets++; return Promise.resolve(ok([])); }
    if (url === "/api/vocab") { posts++; return posts === 1 ? firstPost.promise : Promise.resolve(saved()); }
    return Promise.resolve(saved());
  });
  const task = store.syncVocabCloud();
  for (let i = 0; i < 5 && posts === 0; i++) await tick();
  expect(posts).toBe(1);
  store.saveWord({ word: "during-post" });
  const forced = store.syncVocabCloud({ force: true });
  expect(gets).toBe(1);
  firstPost.resolve(saved());
  expect((await task).ok).toBe(true);
  expect((await forced).ok).toBe(true);
  expect(gets).toBe(2);
  expect(posts).toBe(2);
  expect(JSON.parse(global.fetch.mock.calls.findLast((c) => c[1]?.method === "POST" && c[0] === "/api/vocab")[1].body).cards.some((c) => c.word === "during-post")).toBe(true);
});

test("GET 尚未返回时的 force 也会串行补跑", async () => {
  login("AAAAAA");
  const first = deferred();
  let gets = 0;
  global.fetch = jest.fn(() => {
    gets++;
    return gets === 1 ? first.promise : Promise.resolve(ok([]));
  });
  const task = store.syncVocabCloud();
  const forced = store.syncVocabCloud({ force: true });
  expect(gets).toBe(1);
  first.resolve(ok([]));
  expect((await task).ok).toBe(true);
  expect((await forced).ok).toBe(true);
  expect(gets).toBe(2);
});

test("分页完整读取后才写盘；失败页不覆盖本地", async () => {
  login("AAAAAA");
  store.saveWord({ word: "local" });
  global.fetch = jest.fn((url, options) => {
    if (options?.method) return Promise.resolve(saved());
    if (url.includes("cursor=alpha")) return Promise.resolve(ok([card("omega")]));
    return Promise.resolve(ok([card("alpha")], "alpha"));
  });
  expect((await store.syncVocabCloud()).ok).toBe(true);
  expect(store.loadBook().map((c) => c.word).sort()).toEqual(["alpha", "local", "omega"]);
});

test("分页第二页失败不写部分云端数据，恢复网络后可重试", async () => {
  login("AAAAAA");
  store.saveWord({ word: "local" });
  let fail = true;
  global.fetch = jest.fn((url, options) => {
    if (options?.method) return Promise.resolve(saved());
    if (url.includes("cursor=alpha")) return Promise.resolve(fail ? { ok: false, status: 503 } : ok([card("omega")]));
    return Promise.resolve(ok([card("alpha")], "alpha"));
  });
  expect((await store.syncVocabCloud()).ok).toBe(false);
  expect(store.loadBook().map((c) => c.word)).toEqual(["local"]);
  fail = false;
  expect((await store.syncVocabCloud()).ok).toBe(true);
  expect(store.loadBook().map((c) => c.word).sort()).toEqual(["alpha", "local", "omega"]);
});

test("503 自动退避重试，400 不形成重复请求", async () => {
  login("AAAAAA");
  let calls = 0;
  global.fetch = jest.fn(() => {
    calls++;
    return Promise.resolve(calls === 1 ? { ok: false, status: 503 } : ok([]));
  });
  expect((await store.syncVocabCloud()).retryable).toBe(true);
  expect(calls).toBe(1);
  await jest.advanceTimersByTimeAsync(1999);
  expect(calls).toBe(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(calls).toBe(2);
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 400 }));
  expect((await store.syncVocabCloud()).retryable).toBe(false);
  await jest.advanceTimersByTimeAsync(60000);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test("响应头返回但 JSON 卡住仍会超时释放同步锁", async () => {
  login("AAAAAA");
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => new Promise(() => {}) }));
  const task = store.syncVocabCloud();
  await jest.advanceTimersByTimeAsync(15000);
  expect((await task).reason).toBe("request timeout");
  global.fetch = jest.fn(() => Promise.resolve(ok([])));
  expect((await store.syncVocabCloud()).ok).toBe(true);
});

test("日志暂时上传失败时卡片同步仍会退避补推", async () => {
  login("AAAAAA");
  logs.appendReviewLog({ word: "alpha", state: "review" }, {}, 3);
  let logCalls = 0;
  global.fetch = jest.fn((url) => {
    if (url === "/api/vocab/logs") {
      logCalls++;
      return Promise.resolve(logCalls === 1 ? { ok: false, status: 503 } : saved());
    }
    return Promise.resolve(ok([]));
  });
  expect((await store.syncVocabCloud()).reason).toBe("logs-pending");
  await jest.advanceTimersByTimeAsync(2000);
  expect(logCalls).toBe(2);
  expect(JSON.parse(localStorage.getItem("toefl-vocab-logs::user:AAAAAA")).synced).toBe(1);
});

test("容量和 localStorage 写失败均保留全部卡与 tombstone，恢复后可持久化", () => {
  login("AAAAAA");
  const many = Array.from({ length: 3002 }, (_, i) => card(`w${i}`));
  many[0].deletedAt = "2026-09-28T00:00:00Z";
  const realSet = Storage.prototype.setItem;
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
    if (key.startsWith("toefl-vocab-book::")) throw new Error("QuotaExceededError");
    return realSet.call(this, key, value);
  });
  store.writeBook(many);
  expect(store.getVocabStorageStatus()).toEqual({ persisted: false });
  expect(store.loadBook()).toHaveLength(3002);
  expect(store.loadBook()[0].deletedAt).toBeTruthy();
  jest.restoreAllMocks();
  store.writeBook(store.loadBook());
  expect(store.getVocabStorageStatus()).toEqual({ persisted: true });
  expect(JSON.parse(localStorage.getItem("toefl-vocab-book::user:AAAAAA")).cards).toHaveLength(3002);
});

test("配额失败的本标签和另一标签后写入的卡都能恢复", () => {
  login("AAAAAA");
  const key = "toefl-vocab-book::user:AAAAAA";
  const realSet = Storage.prototype.setItem;
  const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(function (k, value) {
    if (k === key) throw new Error("quota");
    return realSet.call(this, k, value);
  });
  store.saveWord({ word: "tab-a" });
  // 模拟另一个标签页随后成功写共享 localStorage。
  realSet.call(localStorage, key, JSON.stringify({ v: 1, cards: [card("tab-b", "2026-09-28T01:00:00Z")] }));
  expect(store.loadBook().map((c) => c.word).sort()).toEqual(["tab-a", "tab-b"]);
  spy.mockRestore();
  store.writeBook(store.loadBook());
  expect(JSON.parse(localStorage.getItem(key)).cards.map((c) => c.word).sort()).toEqual(["tab-a", "tab-b"]);
});

test("配额失败的日志不会覆盖另一标签后写的待推日志", async () => {
  login("AAAAAA");
  const key = "toefl-vocab-logs::user:AAAAAA";
  const realSet = Storage.prototype.setItem;
  const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(function (k, value) {
    if (k === key) throw new Error("quota");
    return realSet.call(this, k, value);
  });
  logs.appendReviewLog({ word: "tab-a", state: "review" }, {}, 3, new Date("2026-09-28T00:00:00Z"));
  realSet.call(localStorage, key, JSON.stringify({ logs: [{ w: "tab-b", mode: "reading", at: "2026-09-28T01:00:00Z", r: 3 }], synced: 0 }));
  expect(logs.localLogCount()).toBe(2);
  spy.mockRestore();
  const sent = [];
  global.fetch = jest.fn((_, options) => {
    sent.push(...JSON.parse(options.body).logs);
    return Promise.resolve(saved());
  });
  expect((await logs.pushReviewLogs()).pushed).toBe(2);
  expect(sent.map((x) => x.w).sort()).toEqual(["tab-a", "tab-b"]);
});

test("游客并入账号仅在落盘成功后清游客；旧全局日志不认领", async () => {
  store.saveWord({ word: "guestword" });
  logs.appendReviewLog({ word: "guestword", state: "new" }, {}, 3);
  localStorage.setItem("toefl-vocab-logs", JSON.stringify({ logs: [{ w: "legacy" }], synced: 0 }));
  login("AAAAAA");
  const realSet = Storage.prototype.setItem;
  const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
    if (key === "toefl-vocab-book::user:AAAAAA") throw new Error("quota");
    return realSet.call(this, key, value);
  });
  expect(store.loadBook().map((c) => c.word)).toEqual(["guestword"]);
  expect(localStorage.getItem("toefl-vocab-book::guest")).toBeTruthy();
  spy.mockRestore();
  store.loadBook();
  expect(localStorage.getItem("toefl-vocab-book::guest")).toBeNull();
  expect(logs.localLogCount()).toBe(0);
  expect(JSON.parse(localStorage.getItem("toefl-vocab-logs")).logs[0].w).toBe("legacy");
  expect(JSON.parse(localStorage.getItem("toefl-vocab-logs::guest")).logs).toHaveLength(1);
});

test("日志上传快照绑定账号，旧会话评分不能写新账号", async () => {
  login("AAAAAA");
  store.saveWord({ word: "alpha" });
  logs.appendReviewLog({ word: "alpha", state: "review" }, {}, 3);
  const post = deferred();
  global.fetch = jest.fn(() => post.promise);
  const task = logs.pushReviewLogs();
  login("BBBBBB");
  expect(store.gradeCard("alpha", 3, new Date(), undefined, null, null, "AAAAAA")).toBeNull();
  expect(logs.localLogCount()).toBe(0);
  post.resolve(saved());
  expect((await task).pushed).toBe(1);
  expect(JSON.parse(localStorage.getItem("toefl-vocab-logs::user:AAAAAA")).synced).toBe(1);
  expect(localStorage.getItem("toefl-vocab-logs::user:BBBBBB")).toBeNull();
});

test("上传回执期间另一标签裁剪旧日志并新增日志，只确认本批 ID", async () => {
  login("AAAAAA");
  const key = "toefl-vocab-logs::user:AAAAAA";
  const old = Array.from({ length: 4000 }, (_, i) => ({ w: `old${i}`, mode: "reading", at: new Date(1780000000000 + i * 1000).toISOString(), r: 3 }));
  const a = { w: "a", mode: "reading", at: "2026-09-28T02:00:00Z", r: 3 };
  const b = { w: "b", mode: "reading", at: "2026-09-28T03:00:00Z", r: 3 };
  localStorage.setItem(key, JSON.stringify({ logs: [...old, a], synced: 4000 }));
  const receipt = deferred();
  global.fetch = jest.fn(() => receipt.promise);
  const task = logs.pushReviewLogs();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  // 第二标签已经裁掉 3999 条已上传前缀，并追加了尚未上传的 b。
  localStorage.setItem(key, JSON.stringify({ logs: [old[3999], a, b], synced: 1 }));
  receipt.resolve(saved());
  expect((await task).pushed).toBe(1);
  const after = JSON.parse(localStorage.getItem(key));
  expect(after.logs.slice(0, after.synced).map((x) => x.w).sort()).toEqual(["a", "old3999"]);
  expect(after.logs.slice(after.synced).map((x) => x.w)).toContain("b");
});

test("日志仅裁已确认上传的历史，待上传尾部完整保留", async () => {
  login("AAAAAA");
  const key = "toefl-vocab-logs::user:AAAAAA";
  const history = Array.from({ length: 4002 }, (_, i) => ({ w: `w${i}`, mode: "reading", at: new Date(1780000000000 + i * 1000).toISOString(), r: 3 }));
  localStorage.setItem(key, JSON.stringify({ logs: history, synced: 0 }));
  global.fetch = jest.fn(() => Promise.resolve(saved()));
  expect((await logs.pushReviewLogs()).pushed).toBe(4002);
  const after = JSON.parse(localStorage.getItem(key));
  expect(after.logs).toHaveLength(4000);
  expect(after.synced).toBe(4000);
  logs.appendReviewLog({ word: "pending", state: "review" }, {}, 3);
  const withPending = JSON.parse(localStorage.getItem(key));
  expect(withPending.logs).toHaveLength(4001);
  expect(withPending.synced).toBe(4000);
});
