/**
 * 真题阅读选择题「看图重抽」判据（scripts/realbank/vision_mcq.js）。
 *
 * 锁死的东西：
 *   · stampAnswer / verifyMcq 是 structure_set.mjs 的逐字复制（那边改了这里就红，免得两套闸漂开）；
 *   · 目标分类：哪些状态算「源截图上有、结构化没接住」；
 *   · 材料沿用：同篇已在库的那份逐字沿用（新题并进已有那一篇、已有条目一个字不变），不同篇不乱沿用；
 *   · audit_disagree 只在重转写确实与原结构化不同时才替换；
 *   · 插入句题 / 选句题不走这条链；写回记录可追溯。
 */
const fs = require("fs");
const path = require("path");
const V = require("../scripts/realbank/vision_mcq.js");

const STRUCTURE_SET = path.join(__dirname, "..", "scripts", "realbank", "structure_set.mjs");

function functionSource(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end + 2);
}
const lf = (s) => String(s).replace(/\r\n/g, "\n");

describe("vision_mcq：与 structure_set.mjs 同一套盖答案 / 结构闸（逐字复制防漂移）", () => {
  const original = lf(fs.readFileSync(STRUCTURE_SET, "utf8"));
  const copy = lf(fs.readFileSync(path.join(__dirname, "..", "scripts", "realbank", "vision_mcq.js"), "utf8"));
  // gt_fallback_ap.mjs 也抄了同一份闸。2026-09-14 改「选项恒 4 个」时发现它不在这条测试里，
  // 三份能各改各的而不被发现 —— 一并纳入。
  const copy2 = lf(fs.readFileSync(path.join(__dirname, "..", "scripts", "realbank", "gt_fallback_ap.mjs"), "utf8"));
  test.each(["stampAnswer", "verifyMcq"])("%s 与原件逐字相同", (name) => {
    const a = functionSource(original, name);
    const b = functionSource(copy, name);
    expect(a).toBeTruthy();
    expect(b).toBe(a);
  });
  test.each(["verifyMcq"])("gt_fallback_ap 的 %s 也与原件逐字相同", (name) => {
    expect(functionSource(copy2, name)).toBe(functionSource(original, name));
  });
  test("两边的 LETTERS / CJK / WATERMARK / countWords 常量也一致", () => {
    for (const line of [
      'const LETTERS = "abcdefgh";',
      "const CJK = /[一-鿿]/;",
      "const WATERMARK = /闲鱼|盗卖|退款|店铺|甜茶|满分小屋|唯一闲/;",
      'const countWords = (s) => String(s || "").trim().split(/\\s+/).filter(Boolean).length;',
    ]) {
      expect(original).toContain(line);
      expect(copy).toContain(line);
    }
  });
});

describe("vision_mcq.screenHeaders：OCR 顶栏容错", () => {
  test.each([
    ["Reading | Question 26 of 35", 26, 35],
    ["Reading1Question24of35 00:12:02 Hide Time", 24, 35],
    ["Reading 1Question 23 of35", 23, 35],
    ["ReadingQuestion29of35", 29, 35],
    ["Reading/ Question 31of 35", 31, 35],
    ["Reading|Question13of 15", 13, 15],
  ])("%s → Q%i of %i", (text, q, total) => {
    expect(V.screenHeaders(text)[0]).toMatchObject({ q, total });
  });
  test("CTW 区段屏带 qEnd", () => {
    expect(V.screenHeaders("Reading | Question 1-10 of 35")[0]).toEqual({ q: 1, qEnd: 10, total: 35 });
  });
});

describe("vision_mcq.classifyTarget", () => {
  const item4 = { q_number: 26, stem: "What is X?", options: ["a", "b", "c", "d"], answer_index: 1 };
  test("缺记录 / 被路由成填词 / 材料屏", () => {
    expect(V.classifyTarget(null, 26, null, false)).toBe("no_record");
    expect(V.classifyTarget({ type: "ctw", status: "flagged", items: [] }, 35, null, false)).toBe("misrouted_ctw");
    expect(V.classifyTarget({ type: "rdl", status: "passage_screen", items: [] }, 27, null, false)).toBe("passage_screen");
  });
  test("ok 但选项不是恰好四个 → bad_options（build_bank 会丢）", () => {
    expect(V.classifyTarget({ type: "ap", status: "ok", items: [{ ...item4, options: ["a", "b", "c"] }] }, 26, null, false)).toBe("bad_options");
    expect(V.classifyTarget({ type: "ap", status: "ok", items: [{ ...item4, options: ["a", "b", "c", "d", "e"] }] }, 26, null, false)).toBe("bad_options");
    expect(V.classifyTarget({ type: "ap", status: "ok", items: [{ ...item4, options: ["a", " ", "c", "d"] }] }, 26, null, false)).toBe("bad_options");
  });
  test("ok 四选项：没审 / 过了 / 两票都不一致", () => {
    const rec = { type: "ap", status: "ok", items: [item4] };
    expect(V.classifyTarget(rec, 26, null, false)).toBe("no_audit");
    expect(V.classifyTarget(rec, 26, { agree: true }, true)).toBe("ok");
    expect(V.classifyTarget(rec, 26, { agree: false }, false)).toBe("audit_disagree");
  });
  test("flagged：坏 JSON 与内容残缺分开", () => {
    expect(V.classifyTarget({ type: "ap", status: "flagged", problems: ["模型输出无法解析为 JSON", "修复轮输出不是 JSON 数组"] }, 26)).toBe("flagged_json");
    expect(V.classifyTarget({ type: "ap", status: "flagged", problems: ["选项数异常：2"] }, 26)).toBe("flagged_content");
    expect(V.classifyTarget({ type: "ap", status: "flagged", problems: ["题干缺失或过短"] }, 26)).toBe("flagged_content");
  });
  test("VISION_CATS 不含 ok / no_audit / no_record", () => {
    expect(V.VISION_CATS).not.toContain("ok");
    expect(V.VISION_CATS).not.toContain("no_audit");
    expect(V.VISION_CATS).not.toContain("no_record");
  });
});

describe("vision_mcq.pickMaterial：同篇逐字沿用，不同篇不沿用", () => {
  const noise = "Glaciers are massive slow moving bodies of ice that form in areas where snow accumulates over time and compresses into ice they can change landscapes through processes like erosion and deposition scientists study glaciers to understand past climate conditions";
  const libraryPoster = "Campus Library Summer Hours The main library will be open from nine in the morning until five in the afternoon Monday through Friday Weekend access requires a valid student card at the front entrance";
  test("转写只露出长文的一截（Jaccard 被长度差拉低）→ 按包含度认同篇，逐字沿用池里那份", () => {
    const partial = noise.split(" ").slice(0, 30).join(" ");
    const pool = [
      { material: libraryPoster, type: "rdl", key: "k-poster" },
      { material: noise, material_kind: "passage", type: "ap", key: "k-ap" },
    ];
    const r = V.pickMaterial(partial, pool);
    expect(r.from).toBe("k-ap");
    expect(r.material).toBe(noise);
    expect(r.type).toBe("ap");
    expect(r.material_kind).toBe("passage");
  });
  test("池里没有同一篇 → 用转写正文，不借别的文章", () => {
    const r = V.pickMaterial(noise, [{ material: libraryPoster, type: "rdl", key: "k-poster" }]);
    expect(r.from).toBeNull();
    expect(r.material).toBe(noise);
  });
  test("build_bank 会并的（前 60 字相同）也算同篇", () => {
    const a = `${libraryPoster} extra closing line about holidays`;
    expect(V.buildWouldMerge(a, libraryPoster)).toBe(true);
    expect(V.pickMaterial(a, [{ material: libraryPoster, type: "rdl", key: "k" }]).from).toBe("k");
  });
  test("太短的转写不按包含度硬认（少于 15 个实词）", () => {
    expect(V.pickMaterial("library hours weekend", [{ material: libraryPoster, key: "k" }]).from).toBeNull();
  });
});

describe("vision_mcq.sameQuestion / sameOptionsDifferentOrder", () => {
  const a = { stem: "What does the author imply?", options: ["It rains.", "It snows.", "It is windy.", "It is hot."] };
  test("大小写 / 标点差异不算不同", () => {
    expect(V.sameQuestion(a, { stem: "what does the author imply", options: ["it rains", "It snows", "it is windy", "It is hot"] })).toBe(true);
  });
  test("选项换了顺序 = 不同（且识别为错位）", () => {
    const b = { stem: a.stem, options: [a.options[1], a.options[0], a.options[2], a.options[3]] };
    expect(V.sameQuestion(a, b)).toBe(false);
    expect(V.sameOptionsDifferentOrder(a, b)).toBe(true);
  });
  test("选项内容不同（串栏）= 不同，但不是纯错位", () => {
    const b = { stem: a.stem, options: ["It rains.", "It snows.", "It is windy.", "Something else."] };
    expect(V.sameQuestion(a, b)).toBe(false);
    expect(V.sameOptionsDifferentOrder(a, b)).toBe(false);
  });
});

describe("vision_mcq.buildItem：过同一套闸，插入/选句题不收", () => {
  const parsed = { material: "raw", material_kind: "notice", stem: "What can be inferred about the event?", options: ["A one", "B two", "C three", "D four"] };
  test("正常题：盖答案、带 q_number / answer_key，材料用调用方挑好的", () => {
    const r = V.buildItem(parsed, { q: 27, answer: "c", material: "Chosen material text here", material_kind: "notice" });
    expect(r.ok).toBe(true);
    expect(r.item).toMatchObject({ q_number: 27, answer_key: "c", answer_index: 2, answer_text: "C three", material: "Chosen material text here" });
    expect(parsed.answer_index).toBeUndefined(); // 不改入参
  });
  test("三个选项、答案 d → 越界不收（与结构化阶段同一句报错）", () => {
    const r = V.buildItem({ ...parsed, options: ["x", "y", "z"] }, { q: 1, answer: "d", material: "m" });
    expect(r.ok).toBe(false);
    expect(r.problems.join("")).toMatch(/越界/);
  });
  test("重复选项 / 混中文不收", () => {
    expect(V.buildItem({ ...parsed, options: ["same", "same", "c", "d"] }, { q: 1, answer: "a", material: "m" }).ok).toBe(false);
    expect(V.buildItem({ ...parsed, stem: "这是什么？ what is it" }, { q: 1, answer: "a", material: "m" }).ok).toBe(false);
  });
  test("插入句题 / 选句题交给别的链", () => {
    const ins = V.buildItem({ ...parsed, stem: "Where would the following sentence best fit? Insert it." }, { q: 35, answer: "b", material: "m" });
    expect(ins.ok).toBe(false);
    expect(ins.problems.join("")).toMatch(/插入句题/);
    const sel = V.buildItem({ ...parsed, stem: "Identify the sentence in paragraph 2 that explains X." }, { q: 30, answer: "a", material: "m" });
    expect(sel.ok).toBe(false);
  });
  test("选项不是恰好四个 → 不收（build_bank 只收 A–D）", () => {
    const r = V.buildItem({ ...parsed, options: ["a1", "b2", "c3", "d4", "e5"] }, { q: 1, answer: "a", material: "m" });
    expect(r.ok).toBe(false);
    expect(r.problems.join("")).toMatch(/恰好 4 个/);
  });
  test("题干折行被切成选项（…closest in + A.meaning to）→ 不收", () => {
    const wrapped = { ...parsed, stem: 'The word "equanimity" in the passage is closest in', options: ["meaning to", "concern", "calmness", "exceptions"] };
    const r = V.buildItem(wrapped, { q: 32, answer: "c", material: "m" });
    expect(r.ok).toBe(false);
    expect(r.problems.join("")).toMatch(/折行/);
    const tail = { ...parsed, stem: 'The word "consistent" in the passage is closest in meaning', options: ["to", "rapid", "steady", "large"] };
    expect(V.buildItem(tail, { q: 31, answer: "c", material: "m" }).ok).toBe(false);
    // 正常的 closest in meaning to 题不误伤
    const ok = { ...parsed, stem: 'The word "respite" in the passage is closest in meaning to', options: ["break", "addition", "symbol", "surprise"] };
    expect(V.buildItem(ok, { q: 31, answer: "a", material: "m" }).ok).toBe(true);
  });
  test("不是对象 → 不收", () => {
    expect(V.buildItem(null, { q: 1, answer: "a" }).ok).toBe(false);
    expect(V.buildItem(["a"], { q: 1, answer: "a" }).ok).toBe(false);
  });
});

describe("vision_mcq.restoredRecord：可追溯", () => {
  test("原状态 / problems / type / items 全留在 vision_restored，不改入参", () => {
    const rec = { key: "reading|1|35-35|35", section: "reading", module: 1, type: "ctw", status: "flagged", problems: ["x"], items: [] };
    const item = { q_number: 35, stem: "s", options: ["a", "b", "c", "d"], answer_index: 3 };
    const out = V.restoredRecord(rec, item, { type: "ap", model: "qwen3-vl-plus", at: "2026-09-13T00:00:00Z", category: "misrouted_ctw", source_page: "p7 #3" });
    expect(out).toMatchObject({ key: rec.key, type: "ap", status: "ok", problems: [], items: [item] });
    expect(out.vision_restored).toMatchObject({ by: "qwen3-vl", prev_status: "flagged", prev_type: "ctw", prev_problems: ["x"], prev_items: [], category: "misrouted_ctw" });
    expect(rec.status).toBe("flagged");
    expect(rec.type).toBe("ctw");
  });
});

/**
 * 选项数闸：恒 4 个（2026-09-14）。
 *
 * 为什么这条值得单测：它是「AP 每篇不足 5 题」的一条真实成因，而且旧口径（3~5 都放行）
 * 制造了一个死循环——3 选项的题拿到 status=ok，`--only-failed` 判它 already_done 永不重扫，
 * 落库时 build_bank.optionsMap 又因为「不是恰好 4 个」整题作废，中间还白花一笔盲审的钱。
 * 早拒才能把它放进重扫名单。
 */
describe("verifyMcq：选项必须恰好 4 个", () => {
  const ok4 = { stem: "What does the author suggest?", options: ["alpha one", "beta two", "gamma three", "delta four"] };
  const run = (item) => V.verifyMcq(item);

  test("恰好 4 个 → 无问题", () => {
    expect(run(ok4)).toEqual([]);
  });

  test("3 个 / 5 个都要报出来（旧口径这两种都放行，正是死循环的入口）", () => {
    for (const n of [3, 5]) {
      const item = { ...ok4, options: ok4.options.slice(0, n).concat(n === 5 ? ["epsilon five"] : []) };
      const p = run(item);
      expect(p.some((x) => /选项数异常/.test(x))).toBe(true);
    }
  });

  test("2 个 / 1 个 / 0 个照样报", () => {
    for (const n of [0, 1, 2]) {
      expect(run({ ...ok4, options: ok4.options.slice(0, n) }).some((x) => /选项数异常/.test(x))).toBe(true);
    }
  });

  test("报错文案要说清是「恒 4 个」，让看日志的人知道该去找丢掉的那一项", () => {
    const p = run({ ...ok4, options: ok4.options.slice(0, 3) });
    const msg = p.find((x) => /选项数异常/.test(x));
    expect(msg).toMatch(/恒 4 个/);
    expect(msg).toMatch(/3/);
  });

  test("其余判据不受影响：重复选项 / 空选项 / 题干过短 / 中文 / 水印", () => {
    expect(run({ ...ok4, options: ["a one", "a one", "b two", "c three"] })
      .some((x) => /重复选项/.test(x))).toBe(true);
    expect(run({ ...ok4, options: ["a one", "", "b two", "c three"] })
      .some((x) => /选项为空/.test(x))).toBe(true);
    expect(run({ ...ok4, stem: "x" }).some((x) => /题干缺失或过短/.test(x))).toBe(true);
    expect(run({ ...ok4, stem: "这是中文题干 really" }).some((x) => /混入中文/.test(x))).toBe(true);
  });
});

describe("PROMPTS.mcq：不许诱导模型编选项", () => {
  const src = lf(fs.readFileSync(STRUCTURE_SET, "utf8"));

  test("说明真题恒 4 个选项", () => {
    expect(src).toMatch(/恒 4 个选项/);
  });

  test("同时明令禁止凑数 —— 编一个假选项比这道题作废严重得多", () => {
    expect(src).toMatch(/不要自己编一个凑满 4 个/);
    expect(src).toMatch(/不要编一个凑数/);
  });

  test("旧的「也可能是 3 个」已经删掉（它在邀请模型少给选项）", () => {
    expect(src).not.toMatch(/也可能是 3 个/);
  });
});
