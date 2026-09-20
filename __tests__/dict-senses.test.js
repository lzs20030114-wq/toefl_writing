/**
 * 词典释义的「人话化」：词性中文名、领域标展开、薄条目回落原形。
 *
 * 起因是一张真实的复习卡：varying 的背面只有一句 `[计] 改变` —— 学生既不知道
 * 「计」是什么，也看不到这个词其实是 vary 的分词（vt. 改变 / vi. 变化）。
 * 这组用例把三件事钉住：拆得出结构、缩写翻得成中文、薄条目能找回原形。
 */
const fs = require("fs");
const path = require("path");
const {
  naiveStems,
  shardOf,
  resolveFromShard,
  parseSenses,
  splitSenses,
  posLabel,
  domainLabel,
  humanizeDef,
  isThinEntry,
  pickLemma,
} = require("../lib/dict/core");

const DICT_DIR = path.join(__dirname, "..", "public", "dict");
const shardCache = {};
function shard(letter) {
  if (!(letter in shardCache)) {
    const f = path.join(DICT_DIR, `${letter}.json`);
    shardCache[letter] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
  }
  return shardCache[letter];
}

/** lib/dict/lookup.lookupWord 的同义实现（那边的 fetch 换成读文件）。 */
function lookup(w) {
  const s = shard(shardOf(w));
  const direct = resolveFromShard(s, w);
  if (direct && !isThinEntry(direct)) return direct;
  if (direct) {
    const lemma = pickLemma(s, w);
    return lemma ? { ...lemma, queried: w } : direct;
  }
  for (const stem of naiveStems(w)) {
    const hit = resolveFromShard(s, stem);
    if (hit) return hit;
  }
  return null;
}

describe("posLabel / domainLabel", () => {
  it("词性缩写翻成中文", () => {
    expect(posLabel("vt.")).toBe("及物动词");
    expect(posLabel("vi.")).toBe("不及物动词");
    expect(posLabel("a.")).toBe("形容词");
    expect(posLabel("ad.")).toBe("副词");
    expect(posLabel("n.")).toBe("名词");
  });
  it("领域单字标展开成全称 —— 学生不可能猜出「计」是计算机", () => {
    expect(domainLabel("计")).toBe("计算机");
    expect(domainLabel("医")).toBe("医学");
    expect(domainLabel("法")).toBe("法律");
  });
  it("表里没有的原样回显，不瞎猜", () => {
    expect(posLabel("zzz.")).toBe("zzz.");
    expect(domainLabel("人名")).toBe("人名");
  });
});

describe("parseSenses", () => {
  const PATTERN = "n. 模范, 典型, 图案\nvt. 模仿, 仿造\nvi. 形成图案";

  it("一行一个词性，带上中文名", () => {
    const g = parseSenses(PATTERN);
    expect(g.map((x) => x.posLabels.join())).toEqual(["名词", "及物动词", "不及物动词"]);
    expect(g[0].senses).toEqual(["模范", "典型", "图案"]);
  });

  it("pos 字段保持原样前缀 —— 存量卡的 def 就是 `${pos} ${sense}` 拼的，改了义项选中态就全对不上", () => {
    expect(parseSenses(PATTERN)[1].pos).toBe("vt.");
    expect(parseSenses("[计] 改变")[0].pos).toBe("[计]");
  });

  it("领域标单独拆出来，不混进词性", () => {
    const [g] = parseSenses("[计] 改变");
    expect(g.posTags).toEqual([]);
    expect(g.domains).toEqual(["计"]);
    expect(g.domainLabels).toEqual(["计算机"]);
    expect(g.senses).toEqual(["改变"]);
  });

  it("领域标和词性同时出现时两个都认", () => {
    const [g] = parseSenses("[医] n. 心脏, 心房");
    expect(g.posLabels).toEqual(["名词"]);
    expect(g.domainLabels).toEqual(["医学"]);
    expect(g.senses).toEqual(["心脏", "心房"]);
  });

  it("连写的多词性前缀一起收下", () => {
    const [g] = parseSenses("n. vt. 计划");
    expect(g.posLabels).toEqual(["名词", "及物动词"]);
  });

  it("splitSenses 仍然在总义项 ≤ 1 时退回空数组（弹窗据此走纯文本）", () => {
    expect(splitSenses("[计] 改变")).toEqual([]);
    expect(splitSenses("n. 光合作用")).toEqual([]);
    expect(splitSenses(PATTERN).length).toBe(3);
  });
});

describe("humanizeDef", () => {
  it("列表里的一行也说人话", () => {
    expect(humanizeDef("vt. 改变, 使多样化")).toBe("及物动词 改变、使多样化");
    expect(humanizeDef("[计] 改变")).toBe("〔计算机〕改变");
  });
  it("拆不出结构就原样回显", () => {
    expect(humanizeDef("自己写的备注")).toBe("自己写的备注");
    expect(humanizeDef("")).toBe("");
  });
});

describe("isThinEntry", () => {
  it("没音标 + 义项全是领域标 = 薄", () => {
    expect(isThinEntry({ p: "", t: "[计] 改变" })).toBe(true);
    expect(isThinEntry({ p: "", t: "[计] 缩写的\n[医] 减短的" })).toBe(true);
  });
  it("有音标、或有通用词性，就不薄", () => {
    expect(isThinEntry({ p: "'vєәri", t: "vt. 改变" })).toBe(false);
    expect(isThinEntry({ p: "", t: "n. 光合作用" })).toBe(false);
  });
});

describe("真实词库：薄条目回落原形", () => {
  it("varying 不再只给一句 [计] 改变，而是落到 vary", () => {
    const hit = lookup("varying");
    expect(hit).toBeTruthy();
    expect(hit.word).toBe("vary");
    expect(hit.queried).toBe("varying");
    expect(hit.p).toBeTruthy();
    // 拿回了完整的动词词性
    expect(parseSenses(hit.t).some((g) => g.posTags.includes("vt."))).toBe(true);
  });

  it("其它被薄条目挡住的常见分词也一起救回来", () => {
    expect(lookup("using").word).toBe("use"); // naiveStems 先给 us（代词），不能取第一个
    expect(lookup("pacing").word).toBe("pace"); // 先给 pac（[医] 农药），同理
    expect(lookup("accessing").word).toBe("access");
    expect(lookup("altering").word).toBe("alter");
  });

  it("正常词条不受影响", () => {
    expect(lookup("vary").word).toBe("vary");
    expect(lookup("building").word).toBe("building"); // 自己就是好条目，别回落到 build
    expect(lookup("pattern").word).toBe("pattern");
  });

  it("两字母词干一概不认 —— abs → ab 那种纯属巧合", () => {
    const hit = lookup("abs");
    expect(hit.word).toBe("abs");
  });
});
