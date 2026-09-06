/**
 * 「真题专区 · 按考试场次」数据层契约（lib/realBank.js 的 getRealExamSets 一支）。
 *
 * 用真数据跑（data/realBank/reading/*.json 是 build_bank 构建产物，54 套卷会持续入库），
 * 所以锁的是形状不变量而不是具体场次数：
 *   1. 每道阅读真题恰好归属一场（按卷名 source），不丢不重；
 *   2. 场次按考试日期倒序（最近一场最前）；
 *   3. 场内分组顺序 = REAL_SET_SECTIONS 顺序（ctw → rdl → ap），空组不出现；
 *   4. 场次 flags 是场内所有题 source_flags 的并集（按 code 去重）——场次页只提示一次；
 *   5. 场次 id 可以在 URL 里往返（encodeURIComponent → searchParams.get）。
 */
import {
  getRealAPItems,
  getRealCTWItems,
  getRealExamSet,
  getRealExamSets,
  getRealRDLItems,
  parseRealSetName,
  REAL_SET_SECTIONS,
  realSetId,
  realSourceFlagNote,
} from "../lib/realBank";

const sets = getRealExamSets();
const allReading = [...getRealCTWItems(), ...getRealRDLItems(), ...getRealAPItems()];

describe("真题场次：分组不变量", () => {
  test("至少有一场（空 = 场次页只剩空态）", () => {
    expect(sets.length).toBeGreaterThan(0);
  });

  test("每道阅读真题恰好归属一场，题目总数不丢不重", () => {
    const seen = new Map();
    for (const s of sets) {
      for (const sec of s.sections) {
        for (const it of sec.items) {
          expect(seen.has(it.id)).toBe(false);
          seen.set(it.id, s.id);
        }
      }
    }
    expect(seen.size).toBe(allReading.length);
    for (const it of allReading) expect(seen.get(it.id)).toBe(realSetId(it.source));
  });

  test("set.total = 各分组题数之和", () => {
    for (const s of sets) {
      expect(s.total).toBe(s.sections.reduce((n, sec) => n + sec.items.length, 0));
      expect(s.total).toBeGreaterThan(0);
    }
  });

  test("按考试日期倒序（最近一场最前）", () => {
    for (let i = 1; i < sets.length; i += 1) {
      expect((sets[i - 1].date || "") >= (sets[i].date || "")).toBe(true);
    }
  });

  test("场内分组顺序 = REAL_SET_SECTIONS 顺序，且没有空组", () => {
    const order = REAL_SET_SECTIONS.map((s) => s.key);
    for (const s of sets) {
      const keys = s.sections.map((sec) => sec.key);
      expect(keys).toEqual(order.filter((k) => keys.includes(k)));
      for (const sec of s.sections) expect(sec.items.length).toBeGreaterThan(0);
    }
  });

  test("场内每道题都带 picker 需要的 id / title / type", () => {
    for (const s of sets) {
      for (const sec of s.sections) {
        for (const it of sec.items) {
          expect(it.id).toMatch(/^real_/);
          expect(typeof it.title).toBe("string");
          expect(it.title.length).toBeGreaterThan(0);
          expect(it.type).toBe(sec.key);
        }
      }
    }
  });

  test("flags 是场内题 source_flags 的并集（按 code 去重）", () => {
    for (const s of sets) {
      const codes = s.flags.map((f) => f.code);
      expect(new Set(codes).size).toBe(codes.length);
      const expected = new Set();
      for (const it of allReading) {
        if (realSetId(it.source) !== s.id) continue;
        for (const f of it.source_flags || []) expected.add(f.code);
      }
      expect(new Set(codes)).toEqual(expected);
    }
  });

  test("来源分档一律回忆版（这批是机经，不许冒充官方）", () => {
    for (const s of sets) expect(s.tier).toBe("recalled");
  });
});

describe("真题场次：查找 + URL 往返", () => {
  test("getRealExamSet 按 id 命中，找不到返回 null", () => {
    expect(getRealExamSet(sets[0].id)?.id).toBe(sets[0].id);
    expect(getRealExamSet("不存在的卷")).toBeNull();
    expect(getRealExamSet("")).toBeNull();
  });

  test("场次 id 经 encodeURIComponent → URLSearchParams 往返后仍能命中", () => {
    for (const s of sets) {
      const roundTrip = new URLSearchParams(`set=${encodeURIComponent(s.id)}`).get("set");
      expect(getRealExamSet(roundTrip)?.id).toBe(s.id);
    }
  });

  test("realSetId 去空白，其它字符原样（卷名本身就是唯一键）", () => {
    expect(realSetId(" 1.21 新托福真题 A卷 ")).toBe("1.21新托福真题A卷");
    expect(realSetId("")).toBe("");
    expect(realSetId(null)).toBe("");
  });
});

describe("真题场次：卷名解析（日期块显示）", () => {
  test.each([
    ["1.21新托福真题A卷", "", { month: "1", day: "21", variant: "A卷" }],
    ["5.10新托福真题", "", { month: "5", day: "10", variant: "" }],
    ["11.3托福真题B卷", "", { month: "11", day: "3", variant: "B卷" }],
    ["某机构整理卷", "2026-03-10", { month: "3", day: "10", variant: "" }],
    ["某机构整理卷", "", { month: "", day: "", variant: "" }],
  ])("%s / date=%s", (source, date, expected) => {
    expect(parseRealSetName(source, date)).toEqual(expected);
  });

  test("真库里每一场都解析得出月日（否则日期块显示「—」）", () => {
    for (const s of sets) {
      const { month, day } = parseRealSetName(s.source, s.date);
      expect(month).not.toBe("");
      expect(day).not.toBe("");
    }
  });
});

describe("真题场次：来源提示文案", () => {
  test("无 flag → 空串；有 detail → 带前缀；只有 code 没 detail → 通用一句", () => {
    expect(realSourceFlagNote([])).toBe("");
    expect(realSourceFlagNote(null)).toBe("");
    expect(realSourceFlagNote([{ code: "duplicate_cluster", severity: "warn", detail: "与 5.3 同题簇" }])).toBe("已知来源提示：与 5.3 同题簇");
    expect(realSourceFlagNote([{ code: "x", severity: "warn", detail: "" }])).toContain("已知瑕疵");
  });
});
