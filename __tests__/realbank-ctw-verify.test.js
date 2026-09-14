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
const { writeStructured, syncReadingToBase, syncListeningToMergeBases }
  = require("../scripts/realbank/structured_io.js");

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

/**
 * 2026-09-14 补充判据：答案页自己的毛病（错字 / 残片糊一个字母 / 前缀不是一半）。
 * 放宽的前提是「词典 + 屏幕 OCR」两份独立证据；fixture 取自真卷（1.27B / 1.28A / 2.23 …）的原样。
 */
describe("ctw_verify 补充判据（词典 + 屏幕）", () => {
  const { verifyCtwDetailed, screenFragments, editDistance, MAX_RELAXED } = require("../scripts/realbank/ctw_verify.js");
  const WORDS = new Set(("supply demand there more for product may it expensive increase profits promoting "
    + "studying cover cower carve ways people helps reduce and need chemical this decreases agriculture "
    + "extinctions events be by factors as changes loss catastrophic incidents").split(" "));
  const isWord = (w) => WORDS.has(String(w).toLowerCase());

  // 1.27B M1Q1：屏幕上真的印着 "When the__ is"（there 露 3 个字母，不是 floor(5/2)=2），答案页给后半截 "re"
  const supply = {
    passage: "Supply and demand are fundamental concepts in economics because they determine the price and availability "
      + "of goods or services. When there is more demand for a product, suppliers may make it more expensive to increase profits.",
    blanks: [["there", "the"], ["more", "mo"], ["for", "f"], ["product", "pro"], ["may", "m"], ["it", "i"],
      ["expensive", "expe"], ["increase", "incr"]].map(([word, given]) => ({ word, given })),
  };
  const supplyAnswers = ["re", "re", "or", "duct", "ay", "t", "nsive", "ease"];
  const supplyBody = "00:18:00 Hide Time Fill in the missing letters in the paragraph Supply and demand are fundamental concepts "
    + "in economics because they determine the price and availability of goods or services. When the is mo demand f a pro , "
    + "suppliers m make i more expe to incr profits.";

  test("screenFragments：OCR 吃掉空格也按左右完整词读出屏幕前缀；左右词不足 2 个字母不当锚（读不出给 null）", () => {
    // for 的右邻是 "a"、product 的左邻是 "a" —— 锚太短，宁可读不出
    expect(screenFragments(supply.passage, supply.blanks, supplyBody).slice(0, 4)).toEqual(["the", "mo", null, null]);
    // 1.28A：OCR 把空格吃光（"catast events. Stud extinctions"）
    const ext = { passage: "These incidents can be caused by varying factors such as environmental changes, habitat loss, and "
      + "catastrophic events. Studying extinctions helps scientists understand biodiversity.",
    blanks: [{ word: "catastrophic" }, { word: "Studying" }, { word: "helps" }] };
    expect(screenFragments(ext.passage, ext.blanks, "habitat lo ,and catast events. Stud extinctions he scientists understand"))
      .toEqual(["catast", "stud", "he"]);
    expect(screenFragments(supply.passage, supply.blanks, "").every((x) => x === null)).toBe(true);
  });

  test("editDistance：相邻换位算 1 步（impluses / strcutures）", () => {
    expect(editDistance("impulses", "impluses")).toBe(1);
    expect(editDistance("structures", "strcutures")).toBe(1);
    expect(editDistance("promoting", "promiting")).toBe(1);
    expect(editDistance("carve", "cover")).toBe(3);
  });

  test("前缀不是一半、屏幕印着这个前缀、前缀 + 残片 = 真词 → suffix_screen", () => {
    const out = verifyCtwDetailed(supply, supplyAnswers, { isWord, body: supplyBody });
    expect(out.problems).toEqual([]);
    expect(out.relaxed).toEqual([{ blank: 1, rule: "suffix_screen", word: "there", answer: "re", given: "the" }]);
  });

  test("没给词典（旧调用方）/ 没有屏幕 OCR → 与旧判据一样 flagged", () => {
    expect(verifyCtwDetailed(supply, supplyAnswers).problems.join("")).toMatch(/还原成 "there"，答案是 "re"/);
    expect(verifyCtwDetailed(supply, supplyAnswers, { isWord }).problems.length).toBeGreaterThan(0);
  });

  // 2.23 M1Q11：整词写法，答案页把 promoting 拼成 promiting
  const crop = (word9, answer9) => ({
    item: {
      passage: `${FILLER} This method helps to reduce pests and diseases; it also decreases the need for chemical fertilizers, `
        + `${word9} sustainable agriculture.`,
      blanks: [["this", "Th"], ["helps", "he"], ["reduce", "red"], ["and", "a"], ["decreases", "decr"], ["need", "ne"],
        ["chemical", "chem"], [word9, word9.slice(0, 4)], ["agriculture", "agric"]].map(([word, given]) => ({ word, given })),
    },
    answers: ["this", "helps", "reduce", "and", "decreases", "need", "chemical", answer9, "agriculture"],
  });

  test("整词写法的答案页错字：差 1 步、答案页那个拼写不是词 → full_typo", () => {
    const { item, answers } = crop("promoting", "promiting");
    const out = verifyCtwDetailed(item, answers, { isWord });
    expect(out.problems).toEqual([]);
    expect(out.relaxed.map((r) => r.rule)).toEqual(["full_typo"]);
  });

  test("答案页那个词本身也是真词（carve / cover）→ 错的可能是模型，不收", () => {
    const { item, answers } = crop("carve", "cover");
    expect(verifyCtwDetailed(item, answers, { isWord }).problems.join("")).toMatch(/还原成 "carve"，答案是 "cover"/);
  });

  // 1.28A M1Q11：残片写法；模型为了凑 "ing" 把前缀写成 Study，屏幕上是 "Stud extinctions"
  const ext = (restored, given, answer) => ({
    item: {
      passage: `${FILLER}. These incidents can be caused by varying factors such as environmental changes, habitat loss, and `
        + `catastrophic events. ${restored} extinctions helps scientists understand biodiversity.`,
      blanks: [["incidents", "inci"], ["be", "b"], ["by", "b"], ["factors", "fac"], ["as", "a"], ["changes", "cha"],
        ["loss", "lo"], ["catastrophic", "catast"], [restored, given], ["helps", "he"]].map(([word, g]) => ({ word, given: g })),
    },
    answers: ["dents", "e", "y", "tors", "s", "nges", "ss", "rophic", answer, "lps"],
    body: `${FILLER}. These inci canb causedb varying fac sucha environmental cha habitat lo ,and catast events. `
      + "Stud extinctions he scientists understand biodiversity.",
  });

  test("残片糊了 1 个字母 + 屏幕前缀与模型不一致 → suffix_fuzzy，前缀按屏幕改正", () => {
    const { item, answers, body } = ext("Studying", "Study", "ing");
    const out = verifyCtwDetailed(item, answers, { isWord, body });
    expect(out.problems).toEqual([]);
    expect(out.relaxed).toEqual([{ blank: 9, rule: "suffix_fuzzy", word: "studying", answer: "ing", given: "Stud", given_was: "Study" }]);
    expect(out.blanks[8]).toEqual({ word: "Studying", given: "Stud" });
    expect(out.blanks[7]).toEqual(item.blanks[7]);   // 别的空原样
  });

  test("屏幕前缀 + 答案残片本身拼成真词（co + ver = cover）而模型还原成 cower → 不收", () => {
    const { item, answers } = ext("Studying", "Study", "ing");
    item.passage = item.passage.replace("Studying extinctions", "cower extinctions");
    item.blanks[8] = { word: "cower", given: "co" };
    answers[8] = "ver";
    const body = ext().body.replace("Stud extinctions", "co extinctions");
    expect(verifyCtwDetailed(item, answers, { isWord, body }).problems.length).toBeGreaterThan(0);
  });

  test(`一块里要放宽的空超过 ${MAX_RELAXED} 个 → 整块没对齐，不是笔误，照旧 flagged`, () => {
    const { item, answers } = crop("promoting", "promiting");
    answers[0] = "thsi"; answers[1] = "hleps";
    expect(verifyCtwDetailed(item, answers, { isWord }).problems.length).toBeGreaterThan(0);
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

/**
 * 合流快照同步（2026-09-14）。
 * 两个来源的合流都「只在第一次把 structure_set 的原始产物快照一次，之后永不刷新」，
 * 于是重跑 structure_set 救回的听力块只写进 structured.json，下一次合流照旧从陈旧快照重建，
 * 刚救回来的题一声不响地消失 —— 听力恰好是全库丢题最多的一科。这里锁死同步行为。
 */
describe("structured_io.syncListeningToMergeBases", () => {
  const withDir = (fn) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "rb-mb-"));
    try { return fn(d); } finally { fs.rmSync(d, { recursive: true, force: true }); }
  };
  const snapshot = (d, name, results) =>
    fs.writeFileSync(path.join(d, name), JSON.stringify({ set: "卷A", results }));
  const readJson = (d, name) => JSON.parse(fs.readFileSync(path.join(d, name), "utf8"));

  test("救回的听力块写进第一来源快照，替换同 key 的旧记录并留一代备份", () => withDir((d) => {
    snapshot(d, "卷A.structured.fs_parsed.json", [
      { key: "listening|1|13-14|32", section: "listening", status: "flagged", items: [] },
      { key: "reading|1|1-10|35", section: "reading", status: "ok", items: [{ passage: "p" }] },
    ]);
    const fresh = { key: "listening|1|13-14|32", section: "listening", status: "ok", items: [{ q: 13 }] };
    const written = syncListeningToMergeBases(d, "卷A", [fresh], new Set([fresh.key]));

    expect(written).toEqual([{ file: "卷A.structured.fs_parsed.json", replaced: 1, added: 0 }]);
    const out = readJson(d, "卷A.structured.fs_parsed.json");
    expect(out.results.find((r) => r.section === "listening").status).toBe("ok");
    expect(out.results.find((r) => r.section === "reading").items).toEqual([{ passage: "p" }]);   // 别的科不动
    expect(out.tally).toEqual({ ok: 2 });
    expect(fs.existsSync(path.join(d, "卷A.fsparsed.prev.json"))).toBe(true);
  }));

  test("第二来源快照同理；两份都在就都写", () => withDir((d) => {
    snapshot(d, "卷A.structured.fs_parsed.json", []);
    snapshot(d, "卷A.structured.parsed.json", []);
    const fresh = { key: "speaking|1|1-7|11", section: "speaking", status: "ok", items: [] };
    const written = syncListeningToMergeBases(d, "卷A", [fresh], new Set([fresh.key]));
    expect(written.map((w) => w.file).sort())
      .toEqual(["卷A.structured.fs_parsed.json", "卷A.structured.parsed.json"]);
    expect(written.every((w) => w.added === 1)).toBe(true);
    expect(fs.existsSync(path.join(d, "卷A.parsedbase.prev.json"))).toBe(true);
  }));

  test("freshKeys 之外的记录不回灌 —— 合流过的结果灌回快照就毁掉幂等", () => withDir((d) => {
    snapshot(d, "卷A.structured.fs_parsed.json", [
      { key: "listening|1|13-14|32", section: "listening", status: "flagged", items: [] },
    ]);
    const merged = { key: "listening|1|13-14|32", section: "listening", status: "ok",
      items: [], transcript_final: "合流改写过的文本" };
    expect(syncListeningToMergeBases(d, "卷A", [merged], new Set())).toEqual([]);
    expect(readJson(d, "卷A.structured.fs_parsed.json").results[0].status).toBe("flagged");
  }));

  test("阅读/写作记录不进合流快照；没有快照文件就什么也不做", () => withDir((d) => {
    expect(syncListeningToMergeBases(d, "卷A", [
      { key: "reading|1|1-10|35", section: "reading", status: "ok" },
    ], null)).toEqual([]);
    snapshot(d, "卷A.structured.fs_parsed.json", []);
    expect(syncListeningToMergeBases(d, "卷A", [
      { key: "reading|1|1-10|35", section: "reading", status: "ok" },
    ], null)).toEqual([]);
  }));

  test("changedKeys：就地重判只把真改动过的记录算新鲜 —— 合流产出的听力记录原样不动就不会被灌回快照", () => withDir((d) => {
    const { changedKeys } = require("../scripts/realbank/structured_io.js");
    const merged = { key: "listening|1|lc:13-14", section: "listening", status: "ok", merged_by: "merge_first_source_asr", items: [{ q: 13 }] };
    const ctw = { key: "reading|1|1-10|35", section: "reading", status: "flagged", items: [{ passage: "p" }] };
    const before = [merged, ctw];
    const after = [{ ...merged, items: [{ q: 13 }] }, { ...ctw, status: "ok", problems: [] }];
    const fresh = changedKeys(before, after);
    expect([...fresh]).toEqual(["reading|1|1-10|35"]);

    snapshot(d, "卷A.structured.fs_parsed.json", [{ key: "listening|1|13-14|32", section: "listening", status: "ok", items: [] }]);
    fs.writeFileSync(path.join(d, "卷A.structured.json"), JSON.stringify({ set: "卷A", results: before }));
    expect(writeStructured(d, "卷A", { set: "卷A", results: after }, { freshKeys: fresh }).mergeBases).toEqual([]);
    expect(readJson(d, "卷A.structured.fs_parsed.json").results).toHaveLength(1);
  }));

  test("writeStructured 顺带把合流快照一起同步（这才是真正的调用路径）", () => withDir((d) => {
    snapshot(d, "卷A.structured.fs_parsed.json", [
      { key: "listening|1|13-14|32", section: "listening", status: "flagged", items: [] },
    ]);
    fs.writeFileSync(path.join(d, "卷A.structured.json"), JSON.stringify({ set: "卷A", results: [] }));
    const fresh = { key: "listening|1|13-14|32", section: "listening", status: "ok", items: [{ q: 13 }] };
    const res = writeStructured(d, "卷A", { set: "卷A", results: [fresh] }, { freshKeys: new Set([fresh.key]) });
    expect(res.mergeBases).toEqual([{ file: "卷A.structured.fs_parsed.json", replaced: 1, added: 0 }]);
    expect(readJson(d, "卷A.structured.fs_parsed.json").results[0].status).toBe("ok");
  }));
});
