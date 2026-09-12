/**
 * 复盘划词词典：查询逻辑 + 真实词库（public/dict）的防退化门。
 * 词库由 scripts/dict/build-dict.mjs 生成，重跑构建后这组用例必须仍然全绿。
 */
const fs = require("fs");
const path = require("path");
const {
  normalizeWord,
  naiveStems,
  shardOf,
  resolveFromShard,
  sentenceAround,
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

/** 前端 lookupWord 的同义实现（那边的 fetch 换成读文件）。 */
function lookup(raw) {
  const w = normalizeWord(raw);
  if (!w || w.length > 40) return null;
  const s = shard(shardOf(w));
  const direct = resolveFromShard(s, w);
  if (direct) return direct;
  if (w.includes("-")) {
    for (const alt of [w.replace(/-/g, ""), w.replace(/-/g, " ")]) {
      const hit = resolveFromShard(shard(shardOf(alt)), alt);
      if (hit) return hit;
    }
  }
  for (const stem of naiveStems(w)) {
    const hit = resolveFromShard(s, stem);
    if (hit) return hit;
  }
  if (w.includes(" ")) {
    const last = w.split(" ").pop();
    if (last && last !== w) return lookup(last);
  }
  return null;
}

describe("normalizeWord", () => {
  it("剥掉两侧标点、引号、括号", () => {
    expect(normalizeWord("cell.")).toBe("cell");
    expect(normalizeWord("(migration,")).toBe("migration");
    expect(normalizeWord("“canopy”")).toBe("canopy");
  });
  it("统一小写", () => {
    expect(normalizeWord("Photosynthesis")).toBe("photosynthesis");
  });
  it("去掉所有格", () => {
    expect(normalizeWord("student's")).toBe("student");
    expect(normalizeWord("students'")).toBe("students");
    expect(normalizeWord("student’s")).toBe("student");
  });
  it("保留词内连字符与词组空格", () => {
    expect(normalizeWord("hunter-gatherer")).toBe("hunter-gatherer");
    expect(normalizeWord("  in spite of ")).toBe("in spite of");
  });
  it("空输入不炸", () => {
    expect(normalizeWord("")).toBe("");
    expect(normalizeWord(null)).toBe("");
    expect(normalizeWord("...")).toBe("");
  });
});

describe("naiveStems", () => {
  it("剥常见屈折后缀", () => {
    expect(naiveStems("studies")).toContain("study");
    expect(naiveStems("cells")).toContain("cell");
    expect(naiveStems("running")).toContain("run");
    expect(naiveStems("larger")).toContain("large");
    expect(naiveStems("quickly")).toContain("quick");
  });
  it("不把原词本身算作词干", () => {
    expect(naiveStems("cells")).not.toContain("cells");
  });
});

describe("resolveFromShard", () => {
  const table = {
    study: { p: "st^di", t: "n. 学习", g: "CET-4" },
    studies: "study", // 同片别名
    went: { p: "went", t: "v. 去（go的过去式）", g: "", w: "go" }, // 跨片内联
  };
  it("直接命中", () => {
    expect(resolveFromShard(table, "study").word).toBe("study");
  });
  it("别名解开到原形，并保留查询词", () => {
    const hit = resolveFromShard(table, "studies");
    expect(hit.word).toBe("study");
    expect(hit.queried).toBe("studies");
    expect(hit.t).toBe("n. 学习");
  });
  it("内联条目用 w 字段报原形", () => {
    expect(resolveFromShard(table, "went").word).toBe("go");
  });
  it("查不到返回 null", () => {
    expect(resolveFromShard(table, "nope")).toBeNull();
    expect(resolveFromShard(null, "study")).toBeNull();
  });
});

describe("sentenceAround", () => {
  const passage =
    "Photosynthesis converts light into energy. Cells then store the sugar. It fuels growth.";
  it("取出词所在的整句", () => {
    expect(sentenceAround(passage, "sugar")).toBe("Cells then store the sugar.");
  });
  it("大小写无关", () => {
    expect(sentenceAround(passage, "photosynthesis")).toBe(
      "Photosynthesis converts light into energy."
    );
  });
  it("词不在文中时返回空串", () => {
    expect(sentenceAround(passage, "volcano")).toBe("");
  });
  it("正则元字符不炸", () => {
    expect(sentenceAround(passage, "a(b")).toBe("");
  });
});

describe("真实词库 public/dict", () => {
  it("26 个字母分片齐全且有 META", () => {
    expect(fs.existsSync(path.join(DICT_DIR, "META.json"))).toBe(true);
    for (const l of "abcdefghijklmnopqrstuvwxyz") {
      expect(Object.keys(shard(l)).length).toBeGreaterThan(0);
    }
  });

  it.each([
    ["photosynthesis", "光合作用"],
    ["sedimentary", "沉"],
    ["migration", "移"],
    ["canopy", "篷"],
  ])("学术词 %s 能查到", (word, expected) => {
    const hit = lookup(word);
    expect(hit).not.toBeNull();
    expect(hit.t).toContain(expected);
  });

  it.each(["went", "ran", "better", "mice", "children", "taught", "geese", "feet"])(
    "不规则变形 %s 能查到",
    (word) => {
      expect(lookup(word)).not.toBeNull();
    }
  );

  it.each(["studies", "hypothesized", "ecosystems", "adapting", "larger"])(
    "规则变形 %s 能查到",
    (word) => {
      expect(lookup(word)).not.toBeNull();
    }
  );

  it("带标点 / 大小写 / 所有格的选区能查到", () => {
    expect(lookup("Cell.")).not.toBeNull();
    expect(lookup("(species,")).not.toBeNull();
    expect(lookup("researchers'")).not.toBeNull();
  });

  it("词条形状合法：释义非空，别名指向同片真词条", () => {
    const s = shard("s");
    const keys = Object.keys(s);
    expect(keys.length).toBeGreaterThan(1000);
    for (const k of keys.slice(0, 500)) {
      const v = s[k];
      if (typeof v === "string") {
        expect(typeof s[v]).toBe("object");
      } else {
        expect(typeof v.t).toBe("string");
        expect(v.t.length).toBeGreaterThan(0);
      }
    }
  });

  it("查无此词返回 null 而不是抛错", () => {
    expect(lookup("zzzqqxnotaword")).toBeNull();
    expect(lookup("")).toBeNull();
  });
});
