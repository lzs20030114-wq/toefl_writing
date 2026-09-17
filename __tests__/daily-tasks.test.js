/**
 * 每日任务（lib/dailyTasks.js）纯函数 + 存储清洗测试。
 * session 形状以各练习页 saveSess 的真实写入为准（见 lib/dailyTasks.js 头注的对照表）。
 *
 * 固定时间锚点：NOW = 2026-09-16（周三）本地时间。
 * 本周 = 周一 2026-09-14 ~ 周日 2026-09-20；上周日 = 2026-09-13。
 */

import {
  DAILY_TASK_TYPES, MAX_DAILY_TASKS, MAX_DAILY_TARGET,
  FREQ_DAILY, FREQ_ALTERNATE, FREQ_WEEKLY,
  countTodayByTask, countByTaskOnDay, countByTaskInRange, startOfWeek,
  summarizeDailyTasks, sanitizeTasks,
  loadDailyTasks, saveDailyTasks, clearDailyTasks, hasDailyTasks,
} from "../lib/dailyTasks";

const NOW = new Date(2026, 8, 16, 14, 0, 0); // 周三
const at = (day, h = 10) => new Date(2026, 8, day, h, 0, 0).toISOString();
const today = (h = 10) => at(16, h);
const yesterday = (h = 10) => at(15, h);

/** 造一条某题型的练习记录 */
const sess = (key, date) => {
  const map = {
    bs: { type: "bs", details: [{ qid: "bs_1" }] },
    email: { type: "email", details: { promptId: "tpo3_1" } },
    discussion: { type: "discussion", details: { promptId: "ad12" } },
    ctw: { type: "reading", details: { subtype: "ctw", itemId: "ctw_1" } },
    rdl: { type: "reading", details: { subtype: "rdl", itemId: "rdl_1" } },
    ap: { type: "reading", details: { subtype: "ap", itemId: "ap_1" } },
    lcr: { type: "listening", details: { subtype: "lcr", itemIds: ["lcr_1"] } },
    la: { type: "listening", details: { subtype: "la", itemIds: ["la_1"] } },
    lc: { type: "listening", details: { subtype: "lc", itemIds: ["lc_1"] } },
    lat: { type: "listening", details: { subtype: "lat", itemIds: ["lat_1"] } },
    repeat: { type: "speaking", details: { subtype: "repeat", setId: "rp_1" } },
    interview: { type: "speaking", details: { subtype: "interview", setId: "iv_1" } },
    mock: { type: "mock", details: { tasks: [] } },
  };
  return { ...map[key], date };
};

describe("countTodayByTask / countByTaskOnDay", () => {
  test("按 type / details.subtype 归类各题型（一条记录 = 1 次）", () => {
    const sessions = [
      sess("bs", today()), sess("bs", today(11)),
      sess("email", today()), sess("discussion", today()),
      sess("ctw", today()), sess("rdl", today()), sess("ap", today()),
      sess("lcr", today()), sess("la", today()), sess("lc", today()), sess("lat", today()),
      sess("repeat", today()), sess("interview", today()),
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
      { type: "mock", date: today(), details: { tasks: [] } },
      { type: "reading", mode: "mock", date: today(), details: { subtype: "mock" } },
      { type: "listening", mode: "mock", date: today(), details: { subtype: "mock" } },
      { type: "speaking", mode: "mock", date: today(), details: { subtype: "mock" } },
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

  test("昨天的记录不计入今天；countByTaskOnDay 可取任意一天", () => {
    const sessions = [sess("bs", yesterday()), sess("bs", today())];
    expect(countTodayByTask(sessions, NOW).bs).toBe(1);
    expect(countByTaskOnDay(sessions, "2026-09-15").bs).toBe(1);
    expect(countByTaskOnDay(sessions, "2026-09-14").bs).toBe(0);
    expect(countByTaskOnDay(sessions, null).bs).toBe(0);
  });

  test("无效 / 缺失 date 的记录跳过，不抛错", () => {
    const counts = countTodayByTask(
      [{ type: "bs" }, { type: "bs", date: null }, { type: "bs", date: "不是日期" }, sess("ctw", today()), null],
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

describe("startOfWeek / countByTaskInRange", () => {
  test("周一 00:00 起算（本地时区）", () => {
    const ws = startOfWeek(NOW);
    expect(ws.getFullYear()).toBe(2026);
    expect(ws.getMonth()).toBe(8);
    expect(ws.getDate()).toBe(14); // 2026-09-14 周一
    expect(ws.getHours()).toBe(0);
    // 周一当天本身就是周首
    expect(startOfWeek(new Date(2026, 8, 14, 23, 0, 0)).getDate()).toBe(14);
    // 周日属于同一周（周一起算）
    expect(startOfWeek(new Date(2026, 8, 20, 1, 0, 0)).getDate()).toBe(14);
  });

  test("区间含起始日、不含结束日", () => {
    const sessions = [sess("bs", at(13)), sess("bs", at(14)), sess("bs", at(16)), sess("bs", at(21))];
    const counts = countByTaskInRange(sessions, new Date(2026, 8, 14), new Date(2026, 8, 21));
    expect(counts.bs).toBe(2); // 14 与 16；13（上周日）和 21（下周一）都不算
  });
});

describe("sanitizeTasks（含 v1 → v2 迁移）", () => {
  test("旧形状 { key, target } 迁移成 keys/freq/id", () => {
    expect(sanitizeTasks([{ key: "bs", target: 3 }])).toEqual([
      { id: "bs@daily", keys: ["bs"], target: 3, freq: FREQ_DAILY },
    ]);
  });

  test("keys 去重、截到 2 个、未知 key 丢掉", () => {
    expect(sanitizeTasks([{ keys: ["bs", "bs", "ctw", "ap"], target: 1, freq: FREQ_DAILY }])[0].keys)
      .toEqual(["bs", "ctw"]);
    expect(sanitizeTasks([{ keys: ["bs", "ghost"], target: 1 }])[0].keys).toEqual(["bs"]);
  });

  test("keys 为空 / target 非法 → 整条丢弃", () => {
    expect(sanitizeTasks([{ keys: [], target: 2 }])).toEqual([]);
    expect(sanitizeTasks([{ keys: ["ghost"], target: 2 }])).toEqual([]);
    expect(sanitizeTasks([{ keys: ["bs"], target: 0 }])).toEqual([]);
    expect(sanitizeTasks([{ keys: ["bs"], target: -1 }])).toEqual([]);
    expect(sanitizeTasks([{ keys: ["bs"], target: "abc" }])).toEqual([]);
    expect(sanitizeTasks([null, "x", 3])).toEqual([]);
  });

  test("target 夹到 1~10 并取整", () => {
    expect(sanitizeTasks([{ keys: ["bs"], target: 99 }])[0].target).toBe(MAX_DAILY_TARGET);
    expect(sanitizeTasks([{ keys: ["bs"], target: 2.6 }])[0].target).toBe(3);
    expect(sanitizeTasks([{ keys: ["bs"], target: "3" }])[0].target).toBe(3);
  });

  test("freq 非法回落 daily", () => {
    expect(sanitizeTasks([{ keys: ["bs"], target: 1, freq: "每天" }])[0].freq).toBe(FREQ_DAILY);
    expect(sanitizeTasks([{ keys: ["bs"], target: 1, freq: FREQ_WEEKLY }])[0].freq).toBe(FREQ_WEEKLY);
  });

  test("keys 集合 + freq 完全相同的任务丢后者（顺序无关），不同频率可共存", () => {
    const out = sanitizeTasks([
      { keys: ["bs", "ctw"], target: 1, freq: FREQ_DAILY },
      { keys: ["ctw", "bs"], target: 5, freq: FREQ_DAILY },   // 同一集合 → 丢
      { keys: ["bs", "ctw"], target: 2, freq: FREQ_WEEKLY },  // 频率不同 → 留
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].target).toBe(1);
    expect(out[1].freq).toBe(FREQ_WEEKLY);
  });

  test("id 缺失则生成；id 重复自动加序号", () => {
    const out = sanitizeTasks([
      { keys: ["bs"], target: 1, freq: FREQ_DAILY },
      { id: "bs@daily", keys: ["ctw"], target: 1, freq: FREQ_DAILY }, // 撞 id 但任务不同
    ]);
    expect(out[0].id).toBe("bs@daily");
    expect(out[1].id).toBe("bs@daily#2");
  });

  test(`最多保留 ${MAX_DAILY_TASKS} 条`, () => {
    const many = DAILY_TASK_TYPES.map((t) => ({ keys: [t.key], target: 1, freq: FREQ_DAILY }));
    expect(many.length).toBeGreaterThan(MAX_DAILY_TASKS);
    expect(sanitizeTasks(many)).toHaveLength(MAX_DAILY_TASKS);
  });

  test("非数组输入返回空数组", () => {
    expect(sanitizeTasks(null)).toEqual([]);
    expect(sanitizeTasks("x")).toEqual([]);
    expect(sanitizeTasks(undefined)).toEqual([]);
  });
});

describe("summarizeDailyTasks · 每天(daily)", () => {
  const sessions = [sess("bs", today()), sess("bs", today(11)), sess("bs", today(12)), sess("ctw", today())];

  test("done = 今日计数；展示值封顶 target", () => {
    const s = summarizeDailyTasks(
      [{ keys: ["bs"], target: 2, freq: FREQ_DAILY }, { keys: ["ctw"], target: 2, freq: FREQ_DAILY }],
      sessions, NOW
    );
    const bs = s.items[0];
    expect(bs.done).toBe(3);
    expect(bs.shown).toBe(2);
    expect(bs.complete).toBe(true);
    expect(bs.restToday).toBe(false);
    expect(bs.unit).toBe("day");
    expect(bs.labels).toEqual(["拖拽造句"]);
    expect(bs.hrefs).toEqual(["/build-sentence"]);

    expect(s.items[1].done).toBe(1);
    expect(s.items[1].complete).toBe(false);
  });

  test("总计：dueCount / completeCount / allComplete", () => {
    const partial = summarizeDailyTasks(
      [{ keys: ["bs"], target: 2, freq: FREQ_DAILY }, { keys: ["ctw"], target: 2, freq: FREQ_DAILY }],
      sessions, NOW
    );
    expect(partial.dueCount).toBe(2);
    expect(partial.completeCount).toBe(1);
    expect(partial.allComplete).toBe(false);
    expect(partial.allRest).toBe(false);

    const all = summarizeDailyTasks(
      [{ keys: ["bs"], target: 2, freq: FREQ_DAILY }, { keys: ["ctw"], target: 1, freq: FREQ_DAILY }],
      sessions, NOW
    );
    expect(all.completeCount).toBe(2);
    expect(all.allComplete).toBe(true);
  });

  test("空任务清单：allComplete / allRest 都为 false", () => {
    const s = summarizeDailyTasks([], sessions, NOW);
    expect(s.items).toEqual([]);
    expect(s.dueCount).toBe(0);
    expect(s.allComplete).toBe(false);
    expect(s.allRest).toBe(false);
  });

  test("汇总前也会清洗脏任务", () => {
    const s = summarizeDailyTasks([{ keys: ["不存在"], target: 3 }, { key: "bs", target: 99 }], sessions, NOW);
    expect(s.items).toHaveLength(1);
    expect(s.items[0].target).toBe(MAX_DAILY_TARGET);
    expect(s.items[0].freq).toBe(FREQ_DAILY);
  });
});

describe("summarizeDailyTasks · 二选一", () => {
  test("两个题型的记录相加计数", () => {
    const sessions = [sess("ctw", today()), sess("rdl", today()), sess("rdl", today(12))];
    const s = summarizeDailyTasks([{ keys: ["ctw", "rdl"], target: 3, freq: FREQ_DAILY }], sessions, NOW);
    expect(s.items[0].done).toBe(3);
    expect(s.items[0].complete).toBe(true);
    expect(s.items[0].labels).toEqual(["阅读填词", "日常阅读"]);
    expect(s.items[0].hrefs).toEqual(["/reading?type=ctw", "/reading?type=rdl"]);
  });

  test("只练其中一个也算数", () => {
    const s = summarizeDailyTasks(
      [{ keys: ["repeat", "interview"], target: 2, freq: FREQ_DAILY }],
      [sess("interview", today()), sess("interview", today(12))], NOW
    );
    expect(s.items[0].done).toBe(2);
    expect(s.items[0].complete).toBe(true);
  });
});

describe("summarizeDailyTasks · 隔天(alternate)", () => {
  const task = [{ keys: ["bs"], target: 2, freq: FREQ_ALTERNATE }];

  test("昨天达标 + 今天没练 → 今天休息", () => {
    const s = summarizeDailyTasks(task, [sess("bs", yesterday()), sess("bs", yesterday(12))], NOW);
    expect(s.items[0].restToday).toBe(true);
    expect(s.items[0].done).toBe(0);
    expect(s.items[0].shown).toBe(0);
    expect(s.items[0].complete).toBe(false);
    expect(s.dueCount).toBe(0);
    expect(s.allRest).toBe(true);
    expect(s.allComplete).toBe(false);
  });

  test("昨天达标 + 今天已经练了 → 不算休息，正常显示进度", () => {
    const s = summarizeDailyTasks(
      task, [sess("bs", yesterday()), sess("bs", yesterday(12)), sess("bs", today())], NOW
    );
    expect(s.items[0].restToday).toBe(false);
    expect(s.items[0].done).toBe(1);
    expect(s.items[0].complete).toBe(false);
    expect(s.dueCount).toBe(1);
    expect(s.allRest).toBe(false);
  });

  test("昨天完全没练 → 今天是应练日（漏练自动顺延，不看单双日）", () => {
    const s = summarizeDailyTasks(task, [], NOW);
    expect(s.items[0].restToday).toBe(false);
    expect(s.items[0].done).toBe(0);
    expect(s.dueCount).toBe(1);
  });

  test("昨天练了但没到 target → 今天仍是应练日", () => {
    const s = summarizeDailyTasks(task, [sess("bs", yesterday())], NOW);
    expect(s.items[0].restToday).toBe(false);
    expect(s.items[0].done).toBe(0);
  });

  test("二选一 + 隔天：昨天两个题型凑够 target 也算达标 → 今天休息", () => {
    const s = summarizeDailyTasks(
      [{ keys: ["ctw", "rdl"], target: 2, freq: FREQ_ALTERNATE }],
      [sess("ctw", yesterday()), sess("rdl", yesterday(12))], NOW
    );
    expect(s.items[0].restToday).toBe(true);
  });
});

describe("summarizeDailyTasks · 每周(weekly)", () => {
  const task = [{ keys: ["bs"], target: 3, freq: FREQ_WEEKLY }];

  test("本周内的都算（含今天），上周日的不算", () => {
    const s = summarizeDailyTasks(
      task,
      [sess("bs", at(13)), sess("bs", at(14)), sess("bs", at(16))], // 13=上周日, 14=本周一, 16=今天
      NOW
    );
    expect(s.items[0].done).toBe(2);
    expect(s.items[0].unit).toBe("week");
    expect(s.items[0].complete).toBe(false);
  });

  test("凑满 target 即达标", () => {
    const s = summarizeDailyTasks(task, [sess("bs", at(14)), sess("bs", at(15)), sess("bs", at(16))], NOW);
    expect(s.items[0].done).toBe(3);
    expect(s.items[0].complete).toBe(true);
    expect(s.allComplete).toBe(true);
  });

  test("weekly 永不 restToday（哪怕昨天已经做满）", () => {
    const s = summarizeDailyTasks(task, [sess("bs", at(15)), sess("bs", at(15, 12)), sess("bs", at(15, 14))], NOW);
    expect(s.items[0].restToday).toBe(false);
    expect(s.items[0].done).toBe(3);
    expect(s.dueCount).toBe(1);
  });

  test("超额展示封顶 target", () => {
    const s = summarizeDailyTasks(
      [{ keys: ["bs"], target: 2, freq: FREQ_WEEKLY }],
      [sess("bs", at(14)), sess("bs", at(15)), sess("bs", at(16))], NOW
    );
    expect(s.items[0].done).toBe(3);
    expect(s.items[0].shown).toBe(2);
  });
});

describe("summarizeDailyTasks · 总计混合场景", () => {
  test("dueCount 排除休息项；allComplete 只看应练项", () => {
    const s = summarizeDailyTasks(
      [
        { keys: ["bs"], target: 1, freq: FREQ_ALTERNATE },   // 昨天达标、今天没练 → 休息
        { keys: ["ctw"], target: 1, freq: FREQ_DAILY },      // 今天练了 → 达标
      ],
      [sess("bs", yesterday()), sess("ctw", today())],
      NOW
    );
    expect(s.total).toBe(2);
    expect(s.dueCount).toBe(1);
    expect(s.completeCount).toBe(1);
    expect(s.allComplete).toBe(true);
    expect(s.allRest).toBe(false);
  });

  test("全部任务都在休息 → allRest，且 allComplete 为 false", () => {
    const s = summarizeDailyTasks(
      [
        { keys: ["bs"], target: 1, freq: FREQ_ALTERNATE },
        { keys: ["ctw", "rdl"], target: 1, freq: FREQ_ALTERNATE },
      ],
      [sess("bs", yesterday()), sess("rdl", yesterday())],
      NOW
    );
    expect(s.dueCount).toBe(0);
    expect(s.allRest).toBe(true);
    expect(s.allComplete).toBe(false);
  });
});

describe("localStorage 读写（按用户隔离 + 脏数据容错）", () => {
  beforeEach(() => { localStorage.clear(); });

  test("save → load 往返，按 userCode 隔离", () => {
    saveDailyTasks("abc", [{ keys: ["bs"], target: 2, freq: FREQ_WEEKLY }]);
    expect(loadDailyTasks("ABC").tasks).toEqual([
      { id: "bs@weekly", keys: ["bs"], target: 2, freq: FREQ_WEEKLY },
    ]);
    expect(loadDailyTasks("OTHER").tasks).toEqual([]);
    expect(loadDailyTasks(null).tasks).toEqual([]);
  });

  test("载入一期存下的旧形状会自动迁移", () => {
    localStorage.setItem(
      "toefl-daily-tasks::user:V1",
      JSON.stringify({ tasks: [{ key: "bs", target: 2 }, { key: "ctw", target: 1 }], updatedAt: "x" })
    );
    expect(loadDailyTasks("V1").tasks).toEqual([
      { id: "bs@daily", keys: ["bs"], target: 2, freq: FREQ_DAILY },
      { id: "ctw@daily", keys: ["ctw"], target: 1, freq: FREQ_DAILY },
    ]);
  });

  test("载入时清洗脏数据", () => {
    localStorage.setItem(
      "toefl-daily-tasks::user:U1",
      JSON.stringify({ tasks: [{ keys: ["bs"], target: 999 }, { keys: ["ghost"], target: 1 }] })
    );
    expect(loadDailyTasks("U1").tasks).toEqual([
      { id: "bs@daily", keys: ["bs"], target: MAX_DAILY_TARGET, freq: FREQ_DAILY },
    ]);
  });

  test("损坏的 JSON / 非数组 tasks 一律 fail-open 返回空", () => {
    localStorage.setItem("toefl-daily-tasks::user:U2", "{不是 json");
    expect(loadDailyTasks("U2")).toEqual({ tasks: [], updatedAt: null });
    localStorage.setItem("toefl-daily-tasks::user:U3", JSON.stringify({ tasks: "nope" }));
    expect(loadDailyTasks("U3").tasks).toEqual([]);
  });

  test("clear 清空该用户的任务", () => {
    saveDailyTasks("U4", [{ keys: ["bs"], target: 1 }]);
    expect(hasDailyTasks(loadDailyTasks("U4"))).toBe(true);
    clearDailyTasks("U4");
    expect(hasDailyTasks(loadDailyTasks("U4"))).toBe(false);
  });

  test("保存会广播更新事件", () => {
    const spy = jest.fn();
    window.addEventListener("toefl-daily-tasks-updated", spy);
    saveDailyTasks("U5", [{ keys: ["bs"], target: 1 }]);
    expect(spy).toHaveBeenCalled();
    window.removeEventListener("toefl-daily-tasks-updated", spy);
  });
});
