/**
 * 薄释义的自动顶替（lib/vocab/vocabStore.adoptDictEntry）+ lemma 字段的落地。
 *
 * ECDICT 给几百个屈折形单收了「没音标、只有领域义项」的条目（varying → `[计] 改变`），
 * 收藏时命中的就是它。复习时查到原形就把主释义换成原形那条，并记下原形词形 ——
 * 这样列表页、别的设备、下一次复习都不用再查。
 *
 * 这组用例守的是三条边界：什么卡该换、什么卡绝对不能碰、换的时候什么字段不许动。
 */
import { adoptDictEntry, getCard, saveWord } from "../lib/vocab/vocabStore";
import { mergeCards, needsDictFill, normalizeCard } from "../lib/vocab/book";

const VARY = {
  word: "vary",
  p: "'vєәri",
  t: "vt. 改变, 使多样化\nvi. 变化, 有不同, 违反",
  g: "TOEFL",
};

beforeEach(() => localStorage.clear());

describe("needsDictFill", () => {
  it("只有领域义项 = 不够用", () => {
    expect(needsDictFill({ def: "[计] 改变" })).toBe(true);
    expect(needsDictFill({ def: "[计] 缩写的\n[医] 减短的" })).toBe(true);
  });
  it("有任何通用词性 = 够用", () => {
    expect(needsDictFill({ def: "vt. 改变" })).toBe(false);
    // 主释义是用户点的单条义项，整条备份里有词性也算够
    expect(needsDictFill({ def: "图案", defFull: "n. 模范, 图案" })).toBe(false);
  });
  it("压根没释义 = 不够用", () => {
    expect(needsDictFill({ def: "" })).toBe(true);
  });
});

describe("adoptDictEntry", () => {
  it("把薄释义换成词典条目，并记下原形", () => {
    saveWord({ word: "varying", def: "[计] 改变", sentence: "By varying the pressure." });
    const out = adoptDictEntry("varying", VARY);
    expect(out.def).toBe(VARY.t);
    expect(out.lemma).toBe("vary");
    expect(getCard("varying").def).toBe(VARY.t);
  });

  it("主键 word 和音标一律不动 —— 换掉 word 会把复习进度和另一张 vary 卡搅在一起；" +
     "卡面上的词形是 varying，挂 vary 的音标是错的", () => {
    saveWord({ word: "varying", def: "[计] 改变" });
    const out = adoptDictEntry("varying", VARY);
    expect(out.word).toBe("varying");
    expect(out.phonetic).toBe("");
  });

  it("复习进度原样保留", () => {
    saveWord({ word: "varying", def: "[计] 改变" });
    const before = getCard("varying");
    const out = adoptDictEntry("varying", VARY);
    expect(out.reps).toBe(before.reps);
    expect(out.due).toBe(before.due);
    expect(out.state).toBe(before.state);
  });

  it("用户点定过义项的卡不碰 —— 主释义是他选的，词典没资格覆盖", () => {
    saveWord({ word: "pattern", def: "n. 图案", defFull: "n. 模范, 图案\nvt. 模仿" });
    const out = adoptDictEntry("pattern", { word: "pattern", t: "n. 别的什么" });
    expect(out.def).toBe("n. 图案");
    expect(getCard("pattern").def).toBe("n. 图案");
  });

  it("查来的条目自己也薄就不换 —— 换了还是看不懂，白写一次盘和一次同步", () => {
    saveWord({ word: "varying", def: "[计] 改变" });
    expect(adoptDictEntry("varying", { word: "varying", t: "[医] 变动的" })).toBeNull();
    expect(getCard("varying").def).toBe("[计] 改变");
  });

  it("命中的就是这个词形本身时不记 lemma", () => {
    saveWord({ word: "vary", def: "" });
    expect(adoptDictEntry("vary", VARY).lemma).toBe("");
  });

  it("词不在本子里 / 已移出 / 入参残缺 → null，不写盘", () => {
    expect(adoptDictEntry("nosuchword", VARY)).toBeNull();
    expect(adoptDictEntry("", VARY)).toBeNull();
    saveWord({ word: "varying", def: "[计] 改变" });
    expect(adoptDictEntry("varying", null)).toBeNull();
    expect(adoptDictEntry("varying", { word: "vary", t: "" })).toBeNull();
  });

  it("重复调用是幂等的（一场复习里同一个词会回插好几次）", () => {
    saveWord({ word: "varying", def: "[计] 改变" });
    const first = adoptDictEntry("varying", VARY);
    const second = adoptDictEntry("varying", VARY);
    expect(second.def).toBe(first.def);
    expect(second.updatedAt).toBe(first.updatedAt); // 第二次直接返回，没再写盘
  });
});

describe("lemma 字段跟着卡走", () => {
  it("normalizeCard 收下并小写化", () => {
    expect(normalizeCard({ word: "varying", lemma: " Vary " }).lemma).toBe("vary");
    expect(normalizeCard({ word: "varying" }).lemma).toBe("");
  });

  it("云同步合并时取并集 —— 一端修好的原形不该因为另一端打了一次分就丢", () => {
    const fixed = normalizeCard({ word: "varying", lemma: "vary", def: "vt. 改变", updatedAt: "2026-01-01T00:00:00.000Z" });
    const graded = normalizeCard({ word: "varying", def: "vt. 改变", reps: 3, updatedAt: "2026-02-01T00:00:00.000Z" });
    const [merged] = mergeCards([fixed], [graded]);
    expect(merged.reps).toBe(3);
    expect(merged.lemma).toBe("vary");
  });
});
