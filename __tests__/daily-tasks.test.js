/**
 * 每日任务（lib/dailyTasks.js）纯函数 + 存储清洗测试。
 * session 形状以各练习页 saveSess 的真实写入为准（见 lib/dailyTasks.js 头注的对照表）。
 */

import {
  DAILY_TASK_TYPES, MAX_DAILY_TASKS, MAX_DAILY_TARGET,
  countTodayByTask, summarizeDailyTasks, sanitizeTasks,
  loadDailyTasks, saveDailyTasks, clearDailyTasks, hasDailyTasks,
} from "../lib/dailyTasks";

const NOW = new Date(2026, 8, 17, 14, 0, 0); // 2026-09-17 本地时间
const today = (h = 10) => new Date(2026, 8, 17, h, 0, 0).toISOString();
const yesterday = () => new Date(2026, 8, 16, 10, 0, 0).toISOString();

describe("countTodayByTask", () => {
  test("按 type / details.subtype 归类各题型（一条记录 = 1 次）", () => {
    const sessions = [
      { type: "bs", date: today(), details: [{ qid: "bs_1", isCorrect: true }] },
      { type: "bs", date: today(11), details: [] },
      { type: "email", date: today(), details: { promptId: "tpo3_1" } },
      { type: "discussion", date: today(), details: { promptId: "ad12" } },
      { type: "reading", date: today(), details: { subtype: "ctw", itemId: "ctw_1" } },
      { type: "reading", date: today(), details: { subtype: "rdl", itemId: "rdl_1" } },
      { type: "reading", date: today(), details: { subtype: "ap", itemId: "ap_1" } },
      { type: "listening", date: today(), details: { subtype: "lcr", itemIds: ["lcr_1"] } },
      { type: "listening", date: today(), details: { subtype: "la", itemIds: ["la_1"] } },
      { type: "listening", date: today(), details: { subtype: "lc", itemIds: ["lc_1"] } },
      { type: "listening", date: today(), details: { subtype: "lat", itemIds: ["lat_1"] } },
      { type: "speaking", date: today(), details: { subtype: "repeat", setId: "rp_1" } },
      { type: "speaking", date: today(), details: { subtype: "interview", setId: "iv_1" } },
    ];
    const counts = countTodayByTask(sessions, NOW);
    expect(counts.bs).toBe(2);
    expect(counts.email).toBe(1);
    expect(counts.discussion).toBe(1);
    expect(counts.ctw).toBe(1);
    expect(counts.rdl).toBe(1);
    expect(counts.ap).toBe(1);
    expect(counts.lcr).toBe(1);
    expect(counts.la).toBe(1);
    expect(counts.lc).toBe(1);
    expect(counts.lat).toBe(1);
    expect(counts.repeat).toBe(1);
    expect(counts.interview).toBe(1);
    expect(counts.mock).toBe(0);
  });

  test("目录里每个 key 都有计数字段（默认 0）", () => {
    const counts = countTodayByTask([], NOW);
    for (const t of DAILY_TASK_TYPES) expect(counts[t.key]).toBe(0);
  });

  test("四科模考都并入 mock 一项，且不算进各自题型", () => {
    const sessions = [
      { type: "mock", date: today(), details: { tasks: [] } },                           // 写作模考
      { type: "reading", mode: "mock", date: today(), details: { subtype: "mock" } },     // 阅读模考
      { type: "listening", mode: "mock", date: today(), details: { subtype: "mock" } },   // 听力模考
      { type: "speaking", mode: "mock", date: today(), details: { subtype: "mock" } },    // 口语模考
    ];
    const counts = countTodayByTask(sessions, NOW);
    expect(counts.mock).toBe(4);
    expect(counts.ctw + counts.rdl + counts.ap).toBe(0);
    expect(counts.lcr + counts.la + counts.lc + counts.lat).toBe(0);
    expect(counts.repeat + counts.interview).toBe(0);
  });

  test("真题专区记录计入对应题型（details.real 只是额外标记）", () => {
    const sessions = [
      { type: "reading", date: today(), details: { subtype: "ap", itemId: "real_ap_511_1_26", real: true } },
      { type: "listening", date: today(), details: { subtype: "lcr", itemIds: ["real_lcr_01"], real: true } },
      { type: "speaking", date: today(), details: { subtype: "repeat", setId: "real_rp_3", real: true } },
      { type: "bs", date: today(), details: [{ qid: "real_bs_t1_01" }] },
    ];
    const counts = countTodayByTask(sessions, NOW);
    expect(counts.ap).toBe(1);
    expect(counts.lcr).toBe(1);
    expect(counts.repeat).toBe(1);
    expect(counts.bs).toBe(1);
  });

  test("昨天的记录不计入今天", () => {
    const counts = countTodayByTask(
      [
        { type: "bs", date: yesterday() },
        { type: "bs", date: today() },
      ],
      NOW
    );
    expect(counts.bs).toBe(1);
  });

  test("无效 / 缺失 date 的记录跳过，不抛错", () => {
    const counts = countTodayByTask(
      [
        { type: "bs" },
        { type: "bs", date: null },
        { type: "bs", date: "不是日期" },
        { type: "reading", date: today(), details: { subtype: "ctw" } },
        null,
      ],
      NOW
    );
    expect(counts.bs).toBe(0);
    expect(counts.ctw).toBe(1);
  });

  test("sessions 为空 / undefined 时返回全 0", () => {
    expect(countTodayByTask(undefined, NOW).bs).toBe(0);
    expect(countTodayByTask(null, NOW).mock).toBe(0);
  });
});

describe("summarizeDailyTasks", () => {
  const sessions = [
    { type: "bs", date: today() },
    { type: "bs", date: today(11) },
    { type: "bs", date: today(12) },
    { type: "reading", date: today(), details: { subtype: "ctw" } },
  ];

  test("逐项算 done/complete，展示值封顶到 target", () => {
    const s = summarizeDailyTasks([{ key: "bs", target: 2 }, { key: "ctw", target: 2 }], sessions, NOW);
    const bs = s.items.find((i) => i.key === "bs");
    expect(bs.done).toBe(3);
    expect(bs.shown).toBe(2);        // 超额不溢出进度条
    expect(bs.complete).toBe(true);
    expect(bs.label).toBe("拖拽造句");
    expect(bs.href).toBe("/build-sentence");

    const ctw = s.items.find((i) => i.key === "ctw");
    expect(ctw.done).toBe(1);
    expect(ctw.shown).toBe(1);
    expect(ctw.complete).toBe(false);
  });

  test("总计 = 已完成项数 / 任务项数；allComplete 只在全达标时为真", () => {
    const partial = summarizeDailyTasks([{ key: "bs", target: 2 }, { key: "ctw", target: 2 }], sessions, NOW);
    expect(partial.total).toBe(2);
    expect(partial.completed).toBe(1);
    expect(partial.allComplete).toBe(false);

    const all = summarizeDailyTasks([{ key: "bs", target: 2 }, { key: "ctw", target: 1 }], sessions, NOW);
    expect(all.completed).toBe(2);
    expect(all.allComplete).toBe(true);
  });

  test("空任务清单：allComplete 为 false（不该显示「今日达标」）", () => {
    const s = summarizeDailyTasks([], sessions, NOW);
    expect(s.items).toEqual([]);
    expect(s.total).toBe(0);
    expect(s.allComplete).toBe(false);
  });

  test("汇总前也会清洗脏任务", () => {
    const s = summarizeDailyTasks([{ key: "不存在", target: 3 }, { key: "bs", target: 99 }], sessions, NOW);
    expect(s.items).toHaveLength(1);
    expect(s.items[0].target).toBe(MAX_DAILY_TARGET);
  });
});

describe("sanitizeTasks / load 清洗", () => {
  test("丢未知 key、去重、target 夹到 1~10 的整数", () => {
    expect(
      sanitizeTasks([
        { key: "bs", target: 3 },
        { key: "nope", target: 2 },
        { key: "bs", target: 5 },      // 重复 key，保留第一条
        { key: "ctw", target: 0 },     // 0 = 未选，丢弃
        { key: "ap", target: -4 },     // 负数丢弃
        { key: "rdl", target: 99 },    // 夹到 10
        { key: "lcr", target: 2.6 },   // 取整
        { key: "la", target: "3" },    // 字符串数字可用
        { key: "lc", target: "abc" },  // 非数字丢弃
      ])
    ).toEqual([
      { key: "bs", target: 3 },
      { key: "rdl", target: 10 },
      { key: "lcr", target: 3 },
      { key: "la", target: 3 },
    ]);
  });

  test("非数组输入返回空数组", () => {
    expect(sanitizeTasks(null)).toEqual([]);
    expect(sanitizeTasks("x")).toEqual([]);
    expect(sanitizeTasks(undefined)).toEqual([]);
  });

  test(`最多保留 ${MAX_DAILY_TASKS} 项`, () => {
    const many = DAILY_TASK_TYPES.map((t) => ({ key: t.key, target: 1 }));
    expect(many.length).toBeGreaterThan(MAX_DAILY_TASKS);
    expect(sanitizeTasks(many)).toHaveLength(MAX_DAILY_TASKS);
  });
});

describe("localStorage 读写（按用户隔离 + 脏数据容错）", () => {
  beforeEach(() => { localStorage.clear(); });

  test("save → load 往返，按 userCode 隔离", () => {
    saveDailyTasks("abc", [{ key: "bs", target: 2 }]);
    expect(loadDailyTasks("ABC").tasks).toEqual([{ key: "bs", target: 2 }]);  // code 大小写归一
    expect(loadDailyTasks("OTHER").tasks).toEqual([]);
    expect(loadDailyTasks(null).tasks).toEqual([]);                           // 游客独立 key
  });

  test("载入时清洗脏数据", () => {
    localStorage.setItem(
      "toefl-daily-tasks::user:U1",
      JSON.stringify({ tasks: [{ key: "bs", target: 999 }, { key: "ghost", target: 1 }], updatedAt: "x" })
    );
    expect(loadDailyTasks("U1").tasks).toEqual([{ key: "bs", target: MAX_DAILY_TARGET }]);
  });

  test("损坏的 JSON / 非数组 tasks 一律 fail-open 返回空", () => {
    localStorage.setItem("toefl-daily-tasks::user:U2", "{不是 json");
    expect(loadDailyTasks("U2")).toEqual({ tasks: [], updatedAt: null });
    localStorage.setItem("toefl-daily-tasks::user:U3", JSON.stringify({ tasks: "nope" }));
    expect(loadDailyTasks("U3").tasks).toEqual([]);
  });

  test("clear 清空该用户的任务", () => {
    saveDailyTasks("U4", [{ key: "bs", target: 1 }]);
    expect(hasDailyTasks(loadDailyTasks("U4"))).toBe(true);
    clearDailyTasks("U4");
    expect(hasDailyTasks(loadDailyTasks("U4"))).toBe(false);
  });

  test("保存会广播更新事件", () => {
    const spy = jest.fn();
    window.addEventListener("toefl-daily-tasks-updated", spy);
    saveDailyTasks("U5", [{ key: "bs", target: 1 }]);
    expect(spy).toHaveBeenCalled();
    window.removeEventListener("toefl-daily-tasks-updated", spy);
  });
});
