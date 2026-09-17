/**
 * 听力题号重排的「别被合流冲掉」闸（scripts/realbank/listening_renumber_guard.js）
 * 与计划签名（scripts/realbank/listening_renumber.js 的 planSignature）。
 *
 * 病：重排是**就地改** `<卷>.structured.json` 的，而三个合流器 + structure_set 都会整份重写那个文件。
 * 重跑一次合流就把重排冲掉 —— 不会出错题，只会静默少题（题号打回旧号 → 配不上按新号记的盲审明细 → 不收）。
 * 落库（build_bank）是唯一不漏的口子，所以闸放那里；这一组钉住闸的两件事：
 *   1. 有待重排的卷要被列出来、没待办时一个字都不打（不然每次 build 都刷一屏噪声）；
 *   2. 计划签名只随「会写进 structured 的那部分」变 —— 相似度分数抖动不算变，
 *      因为签名相同时 `--write` 要**保留**盲审明细（那份是重排之后审出来的），签名一抖就会把它误删。
 */
const G = require("../scripts/realbank/listening_renumber_guard.js");
const { planSignature } = require("../scripts/realbank/listening_renumber.js");

describe("pendingRows：只留有动作的卷，按待重排题数倒序", () => {
  const plans = [
    { set: "3.10新托福真题", plan: { moves: [{}, {}, {}, {}, {}], removed: [{}, {}] } },
    { set: "4.6新托福真题", plan: { moves: [], removed: [] } },
    { set: "3.25新托福真题", plan: { moves: [{}, {}, {}, {}, {}, {}, {}], removed: [{}] } },
    { set: "5.3新托福真题", plan: { moves: [], removed: [{}] } },
  ];

  test("重排完的卷（moves/removed 都空）不出现在清单里", () => {
    expect(G.pendingRows(plans).map((r) => r.set)).toEqual([
      "3.25新托福真题", "3.10新托福真题", "5.3新托福真题",
    ]);
  });

  test("只剩空题要清、没有题要搬的卷也算待办", () => {
    const row = G.pendingRows(plans).find((r) => r.set === "5.3新托福真题");
    expect(row).toEqual({ set: "5.3新托福真题", moves: 0, removed: 1 });
  });

  test("空输入 / 缺字段不炸", () => {
    expect(G.pendingRows([])).toEqual([]);
    expect(G.pendingRows(undefined)).toEqual([]);
    expect(G.pendingRows([{ set: "x", plan: {} }])).toEqual([]);
  });
});

describe("pendingLines：没待办就一个字都不打", () => {
  test("清单为空 → 零行", () => {
    expect(G.pendingLines([])).toEqual([]);
    expect(G.pendingLines(undefined)).toEqual([]);
  });

  test("有待办 → 抬头给总数、逐卷一行、末行给修法", () => {
    const lines = G.pendingLines([
      { set: "3.25新托福真题", moves: 7, removed: 1 },
      { set: "3.10新托福真题", moves: 5, removed: 2 },
    ]);
    expect(lines[0]).toContain("2 套卷共 12 题可重排、3 条空题该清");
    expect(lines[1]).toContain("3.25新托福真题：重排 7、清空题 1");
    expect(lines[2]).toContain("3.10新托福真题：重排 5、清空题 2");
    expect(lines[lines.length - 1]).toContain("listening_renumber_run.mjs");
    expect(lines[lines.length - 1]).toContain("--only-missing");
  });
});

describe("planSignature：只随会写进 structured 的那部分变", () => {
  const base = {
    moves: [
      { module: 1, fromQ: 27, toQ: 26, toLetter: "b", score: 0.912, stem: "What does the professor say" },
      { module: 2, fromQ: 8, toQ: 9, toLetter: "c", score: 0.874, stem: "Why does the student" },
    ],
    removed: [{ module: 1, q: 30 }],
  };

  test("同一份计划 → 同一个签名", () => {
    expect(planSignature(base)).toBe(planSignature(JSON.parse(JSON.stringify(base))));
  });

  test("相似度分数变了不算变（浮点会随 OCR 文本抖）", () => {
    const jitter = JSON.parse(JSON.stringify(base));
    jitter.moves[0].score = 0.9119999;
    jitter.moves[1].stem = "Why does the student ask about";
    expect(planSignature(jitter)).toBe(planSignature(base));
  });

  test("moves 顺序变了不算变", () => {
    const shuffled = { moves: [base.moves[1], base.moves[0]], removed: base.removed };
    expect(planSignature(shuffled)).toBe(planSignature(base));
  });

  test("题号 / 答案字母 / 清掉的空题任一变化都要换签名", () => {
    const toQ = JSON.parse(JSON.stringify(base)); toQ.moves[0].toQ = 25;
    const letter = JSON.parse(JSON.stringify(base)); letter.moves[0].toLetter = "d";
    const rm = JSON.parse(JSON.stringify(base)); rm.removed = [];
    const mod = JSON.parse(JSON.stringify(base)); mod.moves[0].module = 2;
    for (const p of [toQ, letter, rm, mod]) expect(planSignature(p)).not.toBe(planSignature(base));
  });

  test("空计划的签名是空串（没盖过章的卷不会被误判成 replay）", () => {
    expect(planSignature({ moves: [], removed: [] })).toBe("");
    expect(planSignature(null)).toBe("");
  });
});
