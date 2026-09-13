/**
 * 真题丢题防退化闸（真数据）。
 *
 * 为什么要这一条：2026-09 几轮补题反复踩同一个坑 —— 补进来一批题，同时**悄悄丢掉**另一批：
 *   · 补回更靠前的题让 item id 改名 → 复核清单按 id 下架静默失配、15 道已下架的题复活；
 *   · 跨卷同篇合并「每簇只留一条」→ 被扔掉那份里多出来的题一起没了；
 *   · 归位/重建后没人对过账，数字是涨是跌全靠印象。
 * 涨跌都只有一个数字能证明：各题型的入库量。这里把它冻起来，
 * 重建后只许涨不许跌；真要跌，得先改基线文件，改动会出现在 diff 里，跑不掉。
 *
 * 数字涨了：`node scripts/realbank/loss_ledger.mjs --freeze` 重新冻结。
 */
const fs = require("fs");
const path = require("path");
const { buildLedger } = require("../scripts/realbank/loss_attribution.js");

const BANK = path.join(process.cwd(), "data", "realBank");
const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
};

const sets = readJson(path.join(BANK, "sets.json"), null);
const baseline = readJson(path.join(BANK, "loss-baseline.json"), null);

describe("真题入库量不许悄悄变少", () => {
  test("装卷产物与冻结基线都在（缺了说明有人删了账本，或 assemble_sets 没跑）", () => {
    expect(sets).toBeTruthy();
    expect(baseline).toBeTruthy();
    expect(baseline.byType).toBeTruthy();
  });

  test("各题型入库量 ≥ 冻结基线", () => {
    const ledger = buildLedger({ sets });
    const now = Object.fromEntries(Object.values(ledger.byType).map((b) => [b.type, b.got]));
    const drops = Object.entries(baseline.byType)
      .filter(([type, was]) => (now[type] ?? 0) < was)
      .map(([type, was]) => `${type}: ${was} → ${now[type] ?? 0}`);
    // 把差额整条列出来，红的时候一眼看见丢在哪个题型
    expect(drops).toEqual([]);
  });

  test("总入库量 ≥ 冻结基线", () => {
    const ledger = buildLedger({ sets });
    expect(ledger.summary.got).toBeGreaterThanOrEqual(baseline.total_got);
  });

  test("基线的蓝图版本与 sets.json 一致（换蓝图 = 分母变了，基线必须重冻）", () => {
    expect(baseline.blueprint_version).toBe(sets.blueprint_version);
  });
});

describe("账本自身对得平", () => {
  test("归因各桶加起来 = 缺口总数，且 got + 缺口 = need", () => {
    const ledger = buildLedger({
      sets,
      holds: readJson(path.join(BANK, "review-holds.json"), {}).holds || [],
      clusters: readJson(path.join(BANK, "reading", "consolidation.json"), {}).clusters || [],
      sourceFlags: readJson(path.join(BANK, "source-flags.json"), {}).sets || {},
    });
    const sum = Object.values(ledger.summary.causes).reduce((a, b) => a + b, 0);
    expect(sum).toBe(ledger.summary.missing);
    // 缺口按槽位算，装多了的槽不冲抵别处的空 —— 恒等式带上 overfilled
    expect(ledger.summary.got + ledger.summary.missing - ledger.summary.overfilled)
      .toBe(ledger.summary.need);
  });

  test("每一行的 charged 之和 = 该行缺口数（不许摊丢或摊多）", () => {
    const ledger = buildLedger({ sets });
    const bad = ledger.rows
      .filter((r) => Object.values(r.charged).reduce((a, b) => a + b, 0) !== r.missing)
      .slice(0, 5)
      .map((r) => `${r.set}/${r.section}/${r.slotKey}`);
    expect(bad).toEqual([]);
  });
});
