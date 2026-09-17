/**
 * 听力「补抽」（scripts/realbank/listening_rescreen.js）。
 *
 * 盘子：题面 PDF 的一屏就是卷面上的一道题（题干 + 4 选项），结构化时整屏漏掉 / 抽成空题 / 选项被砍。
 * 做法：一屏一屏地补，DeepSeek 的活儿**只有恢复 OCR 吃掉的空格**。
 *
 * 这一组钉死四件事：
 *   1. 选屏 —— 已被认领 / 太短 / 组是跨卷重复 / 组没材料 / 答案页没字母，一律不进盘子；
 *   2. 反幻觉闸 —— 模型改一个词、漏一个词、把两个选项对调，都必须被机械验收拦下；
 *   3. 结构闸 —— 选项不是 4 个、答案盖不上、题干与同组既有题逐字相同，都不收；
 *   4. 写回 —— 只往对的题组里加这一道、按题号排好、留痕，不碰任何已有的题。
 */
const RS = require("../scripts/realbank/listening_rescreen.js");

const SCREEN = [
  "00:00:08 Hide Time",
  "Whydoesthewoman mentionthreenewstaff members?",
  "Tocorrect theman'smisunderstanding",
  "Tosuggest revisingatrainingschedule",
  "To communicate a sense ofurgency",
  "Topointoutsomeerrorsthatweremade",
  "===== PAGE 16 =====",
  "Listening",
  "Listen to a",
].join("\n");

const TX = {
  stem: "Why does the woman mention three new staff members?",
  options: [
    "To correct the man's misunderstanding",
    "To suggest revising a training schedule",
    "To communicate a sense of urgency",
    "To point out some errors that were made",
  ],
};

/** 让屏幕归一文本够长（真盘子的闸是 ≥200 个归一字符）。 */
const PAD = " Extra sentences that make this screen long enough to count as a real question screen on the exam paper.";
const longScreen = `${SCREEN}\n${PAD}`;

function group(over = {}) {
  return {
    section: "listening", status: "ok", type: "lc", key: "listening|1|4", module: 1,
    q_start: 4, q_end: 5, items: [{ q_number: 4, stem: "What can be inferred about the man?", options: ["a", "b", "c", "d"] }],
    transcript_final: "Woman: We just hired three new staff members…", problems: [],
    ...over,
  };
}

function scanOf(body, { module = 1, total = 32, start = 5, answer = "c" } = {}) {
  return {
    blocks: [{ section: "listening", start, end: start, total, body }],
    alignment: { listening: { modules: [{ module, matched: [{ n: start, answer }] }] } },
  };
}

describe("cleanScreenText：确定性清洗", () => {
  test("去掉计时器与页码横幅 / 翻页残尾，正文一字不动", () => {
    const out = RS.cleanScreenText(SCREEN).split("\n");
    expect(out[0]).toBe("Whydoesthewoman mentionthreenewstaff members?");
    expect(out).toHaveLength(5);
    expect(out.join(" ")).not.toMatch(/PAGE|Hide Time/);
  });
});

describe("candidateScreens：进盘子的条件", () => {
  const scan = scanOf(longScreen);

  test("屏上有题、structured 没认领 → 进盘子，带上答案页字母与所属题组", () => {
    const c = RS.candidateScreens({ scan, structured: { results: [group()] } });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ module: 1, q: 5, type: "lc", groupKey: "listening|1|4", answer: "c" });
  });

  test("这一屏已经被某道 structured 题认领 → 不补", () => {
    const g = group({ items: [{ q_number: 5, stem: "x", options: ["a", "b", "c", "d"] }] });
    expect(RS.candidateScreens({ scan, structured: { results: [g] } })).toHaveLength(0);
  });

  test("题组是跨卷重复（dup_of）→ 不补（补了也不上线，只是别名还槽位）", () => {
    expect(RS.candidateScreens({ scan, structured: { results: [group({ dup_of: "real_lc_310_2_04" })] } })).toHaveLength(0);
  });

  test("题组没有材料（transcript_final 空）→ 不补（盲审时没东西可读）", () => {
    expect(RS.candidateScreens({ scan, structured: { results: [group({ transcript_final: "" })] } })).toHaveLength(0);
  });

  test("题组 status 不是 ok / 题号出了题号带 → 不补", () => {
    expect(RS.candidateScreens({ scan, structured: { results: [group({ status: "flagged" })] } })).toHaveLength(0);
    expect(RS.candidateScreens({ scan, structured: { results: [group({ q_start: 6, q_end: 7 })] } })).toHaveLength(0);
  });

  test("答案页上没有这道题的字母 → 不补", () => {
    const noAns = scanOf(longScreen, { answer: "" });
    expect(RS.candidateScreens({ scan: noAns, structured: { results: [group()] } })).toHaveLength(0);
  });

  test("屏幕太短（横幅碎片）→ 不补", () => {
    const short = scanOf("00:00:08 Hide Time\nListening");
    expect(RS.candidateScreens({ scan: short, structured: { results: [group()] } })).toHaveLength(0);
  });
});

describe("transcriptionFaithful：模型只许把空格放回去", () => {
  test("逐字相同、只多了空格 → 过", () => {
    expect(RS.transcriptionFaithful(SCREEN, TX.stem, TX.options).ok).toBe(true);
  });

  test("改了一个词 → 拦", () => {
    const bad = [...TX.options];
    bad[0] = "To correct the man's confusion";
    expect(RS.transcriptionFaithful(SCREEN, TX.stem, bad)).toMatchObject({ ok: false });
  });

  test("补了原文没有的词 → 拦", () => {
    expect(RS.transcriptionFaithful(SCREEN, `${TX.stem} (in the office)`, TX.options).ok).toBe(false);
  });

  test("选项对调（顺序错了，答案字母就会盖歪）→ 拦", () => {
    const swapped = [TX.options[1], TX.options[0], TX.options[2], TX.options[3]];
    expect(RS.transcriptionFaithful(SCREEN, TX.stem, swapped)).toMatchObject({ ok: false });
  });

  test("空题干 / 空选项 → 拦", () => {
    expect(RS.transcriptionFaithful(SCREEN, "", TX.options).ok).toBe(false);
    expect(RS.transcriptionFaithful(SCREEN, TX.stem, ["", ...TX.options.slice(1)]).ok).toBe(false);
  });
});

describe("buildRescreenItem：结构闸", () => {
  const cand = { q: 5, module: 1, answer: "c", raw: SCREEN, group: group() };

  test("过闸 → 出 item，答案按答案页字母盖好", () => {
    const r = RS.buildRescreenItem(cand, TX);
    expect(r.ok).toBe(true);
    expect(r.item).toMatchObject({ q_number: 5, answer_index: 2, answer_key: "c", rescreened: true });
    expect(r.item.answer_text).toBe("To communicate a sense of urgency");
    expect(r.item.options).toHaveLength(4);
  });

  test("选项不是 4 个 → 不收", () => {
    expect(RS.buildRescreenItem(cand, { stem: TX.stem, options: TX.options.slice(0, 3) })).toMatchObject({ ok: false });
  });

  test("答案页字母越界 / 不是字母 → 不收", () => {
    expect(RS.buildRescreenItem({ ...cand, answer: "g" }, TX).ok).toBe(false);
    expect(RS.buildRescreenItem({ ...cand, answer: "" }, TX).ok).toBe(false);
  });

  test("题干与同组既有题逐字相同（同一屏抽过两遍的老病）→ 不收", () => {
    const g = group({ items: [{ q_number: 4, stem: TX.stem, options: ["a", "b", "c", "d"] }] });
    expect(RS.buildRescreenItem({ ...cand, group: g }, TX)).toMatchObject({ ok: false });
  });

  test("混入中文 → 不收", () => {
    const zh = { stem: TX.stem, options: [...TX.options.slice(0, 3), "为了指出一些错误"] };
    expect(RS.buildRescreenItem(cand, zh).ok).toBe(false);
  });
});

describe("applyRescreen：写回", () => {
  test("只往对的题组里加这一道，按题号排好、留痕，已有的题一个字不动", () => {
    const g = group();
    const other = group({ key: "listening|1|6", q_start: 6, q_end: 7, items: [] });
    const structured = { results: [g, other] };
    const built = RS.buildRescreenItem({ q: 5, module: 2, answer: "c", raw: SCREEN, group: g }, TX);
    const added = RS.applyRescreen(structured, [{ ...built, groupKey: "listening|1|4" }]);
    expect(added).toBe(1);
    expect(g.items.map((x) => x.q_number)).toEqual([4, 5]);
    expect(g.items[0].stem).toBe("What can be inferred about the man?");
    expect(g.problems.join(" ")).toContain("listening_rescreen:Q5");
    expect(other.items).toEqual([]);
  });

  test("题号已经被占 → 不重复插", () => {
    const g = group({ items: [{ q_number: 5, stem: "已有", options: ["a", "b", "c", "d"] }] });
    const built = RS.buildRescreenItem({ q: 5, module: 1, answer: "c", raw: SCREEN, group: group() }, TX);
    expect(RS.applyRescreen({ results: [g] }, [{ ...built, groupKey: "listening|1|4" }])).toBe(0);
    expect(g.items).toHaveLength(1);
  });

  test("没过闸的结果不写回", () => {
    const g = group();
    expect(RS.applyRescreen({ results: [g] }, [{ ok: false, why: "选项 3 个", groupKey: "listening|1|4" }])).toBe(0);
    expect(g.items).toHaveLength(1);
  });
});
