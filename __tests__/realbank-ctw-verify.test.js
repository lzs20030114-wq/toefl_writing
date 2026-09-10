/**
 * 真题 CTW 逐空校验（scripts/realbank/ctw_verify.js）+ 就地修阅读的落盘（structured_io.js）。
 *
 * 13 套第一来源卷的答案页只写「要填的后半截」（"ma" 屏幕 + "le" 答案 = male），旧判据一律拒收。
 * 放宽只放宽到下面两条**同时**成立为止，这里锁死：
 *   · word === given + 答案残片；
 *   · given.length === floor(word.length / 2)（C-test 屏幕保留前一半）。
 * 整词写法的旧判据与报错文案不变。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveBlank, verifyCtw } = require("../scripts/realbank/ctw_verify.js");
const { writeStructured, syncReadingToBase } = require("../scripts/realbank/structured_io.js");

const FILLER = "Researchers have long studied how animals share space and resources across many different habitats"
  + " and seasons while scientists record the patterns they observe in careful detail every single year";

describe("ctw_verify.resolveBlank", () => {
  test("整词写法：word=答案词、given 是真前缀 → full", () => {
    expect(resolveBlank("male", "male", "ma")).toMatchObject({ ok: true, form: "full", word: "male" });
  });

  test("后半截写法：given + 残片 = word 且前缀恰为一半 → suffix", () => {
    expect(resolveBlank("le", "male", "ma")).toMatchObject({ ok: true, form: "suffix", word: "male" });
    expect(resolveBlank("ation", "innovation", "innov")).toMatchObject({ ok: true, form: "suffix" });
    expect(resolveBlank("s", "is", "i")).toMatchObject({ ok: true, form: "suffix" });
    expect(resolveBlank("he", "the", "t")).toMatchObject({ ok: true, form: "suffix" });
  });

  test("大小写不敏感（Ocean / Oc / ean）", () => {
    expect(resolveBlank("ean", "Ocean", "Oc")).toMatchObject({ ok: true, form: "suffix", word: "ocean" });
  });

  test("残片拼不回模型还原的词 → 不收", () => {
    const r = resolveBlank("tion", "innovation", "innov");
    expect(r.ok).toBe(false);
    expect(r.problems.join("")).toMatch(/还原成 "innovation"，答案是 "tion"/);
  });

  test("前缀不是一半 → 不收（防整词 + 前缀重复的假阳性：pl + place = plplace）", () => {
    expect(resolveBlank("place", "plplace", "pl").ok).toBe(false);
    expect(resolveBlank("ment", "development", "develop").ok).toBe(false); // 7 ≠ floor(11/2)=5
  });

  test("整词写法的旧报错文案不变", () => {
    const r = resolveBlank("place", "place", "xy", 2);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['第 3 空：给定前缀 "xy" 不是 "place" 的前缀']);
    expect(resolveBlank("place", "place", "place").problems.join("")).toMatch(/没留下要填的部分/);
  });
});

describe("ctw_verify.verifyCtw", () => {
  const item = {
    passage: `${FILLER} and the male bird is known for its bright colors.`,
    blanks: [{ word: "male", given: "ma" }, { word: "is", given: "i" }, { word: "known", given: "kn" }],
  };

  test("后半截写法整块通过：段落里找的是完整词而不是残片", () => {
    expect(verifyCtw(item, ["le", "s", "own"])).toEqual([]);
  });

  test("整词与后半截混排（源 PDF 里 11/30 是残片、其余是整词）同样通过", () => {
    expect(verifyCtw(item, ["male", "s", "known"])).toEqual([]);
  });

  test("空位数对不上直接报错", () => {
    expect(verifyCtw({ passage: FILLER, blanks: [{ word: "male", given: "ma" }] }, ["le", "s"]))
      .toEqual(["空位数 1 ≠ 答案词数 2"]);
  });

  test("段落里真没有这个词 → 报找不到", () => {
    expect(verifyCtw({ passage: FILLER, blanks: [{ word: "male", given: "ma" }] }, ["le"]).join(""))
      .toMatch(/找不到答案词 "male"/);
  });
});

describe("structured_io：就地修阅读要同步 rw 基线（否则重跑合流会被冲掉）", () => {
  test("有 rw 基线：阅读记录同步进去，写作原样保留；两边都有一代备份", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "rb-io-"));
    try {
      const rw = { set: "卷A", results: [
        { key: "reading|1|1-10|35", section: "reading", status: "flagged", items: [] },
        { key: "writing|1|1-10|12", section: "writing", status: "ok", items: [{ n: 1 }] },
      ] };
      fs.writeFileSync(path.join(d, "卷A.structured.rw.json"), JSON.stringify(rw));
      fs.writeFileSync(path.join(d, "卷A.structured.json"), JSON.stringify({ set: "卷A", results: [] }));
      const next = { set: "卷A", merged_asr: { x: 1 }, results: [
        { key: "reading|1|1-10|35", section: "reading", status: "ok", items: [{ passage: "p" }] },
        { key: "listening|1|1-1|32", section: "listening", status: "ok", items: [] },
      ] };
      expect(writeStructured(d, "卷A", next).synced).toBe(true);

      const outRw = JSON.parse(fs.readFileSync(path.join(d, "卷A.structured.rw.json"), "utf8"));
      expect(outRw.results.map((r) => `${r.section}:${r.status}`).sort()).toEqual(["reading:ok", "writing:ok"]);
      expect(outRw.tally).toEqual({ ok: 2 });
      expect(fs.existsSync(path.join(d, "卷A.structured.prev.json"))).toBe(true);
      expect(fs.existsSync(path.join(d, "卷A.rwbase.prev.json"))).toBe(true);

      const out = JSON.parse(fs.readFileSync(path.join(d, "卷A.structured.json"), "utf8"));
      expect(out.merged_asr).toEqual({ x: 1 });
      expect(out.tally).toEqual({ ok: 2 });
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test("没有 rw 基线：只写 structured.json", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "rb-io-"));
    try {
      expect(syncReadingToBase(d, "rf0610", [{ section: "reading", status: "ok" }])).toBe(false);
      expect(writeStructured(d, "rf0610", { results: [] }).synced).toBe(false);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});
