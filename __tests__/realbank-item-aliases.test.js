/**
 * 听力 / 口语的跨卷重出别名（`<科目>/id-aliases.json`）。
 *
 * 与造句同一个病：机经里同一段材料会在多场考试重出，build_bank 去重只留一条 —— 这没错，
 * 错在丢掉之后什么都不记：那几场的槽位被丢题账本算成缺题，前端那一场也少题，
 * 整套都是重复的卷（rf0902 的复述 / 面试）连卡片都不出现。实测听力 111 题 + 口语 11 题这么丢的。
 */
import LIST_ALIASES from "../data/realBank/listening/id-aliases.json";
import SPK_ALIASES from "../data/realBank/speaking/id-aliases.json";
import LCR from "../data/realBank/listening/lcr.json";
import LC from "../data/realBank/listening/lc.json";
import LA from "../data/realBank/listening/la.json";
import LAT from "../data/realBank/listening/lat.json";
import REPEAT from "../data/realBank/speaking/repeat.json";
import INTERVIEW from "../data/realBank/speaking/interview.json";
import LISTENING_COUNTS from "../data/realBank/listening/counts.json";
import SPEAKING_COUNTS from "../data/realBank/speaking/counts.json";
import {
  getRealLCRSets, getRealLCItems, getRealLAItems, getRealLATItems,
  getRealRepeatSets, getRealInterviewSets, mapRealLCToPicker,
} from "../lib/realBank";

const BANKS = { lcr: LCR, lc: LC, la: LA, lat: LAT, repeat: REPEAT, interview: INTERVIEW };
const ALL = [...(LIST_ALIASES.aliases || []), ...(SPK_ALIASES.aliases || [])];

describe("听力 / 口语跨卷重出别名账本", () => {
  test("两份账本各管各的科目，不串台", () => {
    expect((LIST_ALIASES.aliases || []).every((a) => ["lcr", "lc", "la", "lat"].includes(a.from_type))).toBe(true);
    expect((SPK_ALIASES.aliases || []).every((a) => ["repeat", "interview"].includes(a.from_type))).toBe(true);
    expect(ALL.length).toBeGreaterThan(0);
  });

  test("每条都指向库里活着的题，from 不与库里已有 id 撞车，且是跨卷", () => {
    const bad = [];
    for (const a of ALL) {
      const ids = new Set((BANKS[a.from_type].items || []).map((x) => x.id));
      if (!ids.has(a.to)) bad.push(`${a.from}→${a.to} 保留方不在库里`);
      if (ids.has(a.from)) bad.push(`${a.from} 库里已有同 id`);
      if (a.from === a.to) bad.push(`${a.from} 自指`);
    }
    expect(bad).toEqual([]);
  });

  test("from_source / from_date 一条不缺（缺了 assemble_sets 会把别名整条丢掉）", () => {
    expect(ALL.filter((a) => !a.from_source || !a.from_date).map((a) => a.from)).toEqual([]);
  });

  test("保留方来自别的卷（同一卷内不该记别名）", () => {
    for (const a of ALL) {
      const kept = (BANKS[a.to_type].items || []).find((x) => x.id === a.to);
      expect(kept).toBeTruthy();
      expect(String(kept.source).trim()).not.toBe(String(a.from_source).trim());
    }
  });

  test("前端把它们还回各自那一场，内容取保留的那条、id 归自己这一场", () => {
    const all = [
      ...getRealLCRSets().flatMap((s) => s.items), ...getRealLCItems(), ...getRealLAItems(),
      ...getRealLATItems(), ...getRealRepeatSets(), ...getRealInterviewSets(),
    ];
    const recycled = all.filter((x) => x.recycled_of);
    expect(recycled.length).toBeGreaterThan(0);
    recycled.forEach((x) => {
      expect(x.id).not.toBe(x.recycled_of);
      expect(x.source).not.toBe(x.recycled_from);   // 出自另一场考试
      expect(x.date).toBeTruthy();
    });
    // id 全局唯一（子条目 id 也换了前缀，否则跨套撞车）
    const ids = all.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("选题卡如实标注「跨场重复」——不写「往期」（留的是先入库那条，不一定考得更早）", () => {
    const cards = mapRealLCToPicker(getRealLCItems());
    const marked = cards.filter((c) => /跨场重复/.test(c.title));
    expect(marked.length).toBe(getRealLCItems().filter((x) => x.recycled_of).length);
    expect(cards.every((c) => !/往期/.test(c.title))).toBe(true);
  });

  test("counts.json 把还回去的那些算进题量（它是「题库覆盖」的分母）", () => {
    const n = (t) => (BANKS[t].items || []).length + ALL.filter((a) => a.from_type === t).length;
    ["lcr", "lc", "la", "lat"].forEach((t) => expect(LISTENING_COUNTS[t]).toBe(n(t)));
    ["repeat", "interview"].forEach((t) => expect(SPEAKING_COUNTS[t]).toBe(n(t)));
  });
});
