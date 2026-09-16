/**
 * `section_gap` flag 重算（scripts/realbank/refresh_section_gap.mjs）。
 *
 * 这条 flag 的 blocking 后果是**整科不入库**，而 source-flags.json 是 2026-09-06 的一次性体检产物：
 * 源料补齐、解析器修过、卷重扫之后没人重算，陈旧的 blocking 就等于凭 9 天前的残缺源料扣着今天的好题
 * （2026-09-16 实测 2.23 / 3.4 / 4.18 三卷听力：体检时 31~32/47，现在 47/47）。
 *
 * 钉死三件事：判据与 source-flags.json 自己写的一致；满分取蓝图（不是扫描模块之和）；
 * 只碰 section_gap、读不出就保留（fail-closed 到「照旧扣着」）。
 */
const bp = require("../lib/realExam/blueprint.mjs");
const R = require("../scripts/realbank/refresh_section_gap.mjs");

const scanOf = (section, modules) => ({ alignment: { [section]: { modules } } });
const mod = (total, matched) => ({ total, matched: Array.from({ length: matched }, (_, i) => ({ n: i + 1 })) });
const gapFlag = (section, severity, detail) => ({ code: "section_gap", severity, sections: [section], detail });

describe("section_gap 的缺口判据", () => {
  test("≤2 不记 flag / 3–9 warn / ≥10 blocking（与 source-flags.json 的 _note 同一条）", () => {
    expect([0, 1, 2].map(R.gapSeverity)).toEqual([null, null, null]);
    expect([3, 5, 9].map(R.gapSeverity)).toEqual(["warn", "warn", "warn"]);
    expect([10, 15, 47].map(R.gapSeverity)).toEqual(["blocking", "blocking", "blocking"]);
  });

  test("算不出缺口（非数）保留原状那一侧", () => {
    expect(R.gapSeverity(NaN)).toBeNull();
  });
});

describe("满分取蓝图，不取扫描里各 module 的 total 之和", () => {
  test("整个 module 在源料里就没有 → 算成缺口，不是缺口 0", () => {
    // 3.8 的听力只有 M1：模块和是 32/32，但蓝图满分 47 → 缺 15，仍该 blocking
    const pair = R.scanPairing(scanOf("listening", [mod(32, 32)]), "listening");
    expect(pair).toEqual({ matched: 32, total: bp.LISTENING.total });
    expect(R.gapSeverity(pair.total - pair.matched)).toBe("blocking");
  });

  test("答案页多出来的题号重启块撑大模块和 → 不会把缺口算成负数", () => {
    // 3.24 的阅读模块和是 65（> 蓝图 50）
    const pair = R.scanPairing(scanOf("reading", [mod(35, 20), mod(30, 15)]), "reading");
    expect(pair).toEqual({ matched: 35, total: bp.READING.total });
  });

  test("配满了就是缺口 0", () => {
    const pair = R.scanPairing(scanOf("listening", [mod(32, 32), mod(15, 15)]), "listening");
    expect(pair.total - pair.matched).toBe(0);
  });

  test("没有 alignment / 没有 modules → null（调用方据此保留原状）", () => {
    expect(R.scanPairing(null, "listening")).toBeNull();
    expect(R.scanPairing({}, "listening")).toBeNull();
    expect(R.scanPairing(scanOf("listening", []), "listening")).toBeNull();
  });
});

describe("refreshSet 只动 section_gap", () => {
  const scan = scanOf("listening", [mod(32, 32), mod(15, 15)]);

  test("源料补齐后缺口归零 → 删掉这条 flag", () => {
    const { flags, changes } = R.refreshSet("2.23新托福真题",
      [gapFlag("listening", "blocking", "listening 科缺 16 题（配对 31／满分 47）。")], scan);
    expect(flags).toEqual([]);
    expect(changes[0]).toMatchObject({ action: "删除", from: "blocking" });
  });

  test("别的 code 一个字不动", () => {
    const other = { code: "ingest_blocker", severity: "blocking", sections: ["*"], detail: "题号重启块" };
    const { flags } = R.refreshSet("x", [other, gapFlag("listening", "blocking", "旧明细")], scan);
    expect(flags).toEqual([other]);
  });

  test("读不出扫描产物 → 保留原样（fail-closed 到照旧扣着）", () => {
    const f = gapFlag("listening", "blocking", "listening 科缺 16 题（配对 31／满分 47）。");
    const { flags, changes } = R.refreshSet("x", [f], null);
    expect(flags).toEqual([f]);
    expect(changes[0]).toMatchObject({ action: "保留" });
  });

  test("缺口还在就按新数字改级别 / 改明细，从不新增 flag", () => {
    const half = scanOf("listening", [mod(32, 32)]);          // 47 里只配上 32
    const { flags } = R.refreshSet("3.8新托福真题",
      [gapFlag("listening", "warn", "旧明细")], half);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ code: "section_gap", severity: "blocking" });
    expect(flags[0].detail).toBe("listening 科缺 15 题（配对 32／满分 47）。");
    // 没有 section_gap 的卷不会平白多出一条
    expect(R.refreshSet("y", [], scan).flags).toEqual([]);
  });
});
