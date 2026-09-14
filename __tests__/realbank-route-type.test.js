/**
 * 真题题块类型路由（scripts/realbank/route_type.js）。
 *
 * 两个 2026-09-14 补的口子（理由见模块头注）：
 *   · 模块 1 最后一题那一屏的 OCR 带上下一屏的「Fill in the missing letters」→ 单题块被当成填词 → 每次重扫都失败；
 *   · 「Fil in the missing letters」（OCR 吃掉一个 l）→ 真填词块被当成日常阅读 → 选项 0 个。
 */
const { routeType, blockQuestionCount, CTW_MIN_BLOCK_QUESTIONS } = require("../scripts/realbank/route_type.js");

const PASSAGE = Array.from({ length: 40 }, (_, i) => `Augmented reality sentence number ${i} explains training.`).join(" ");

describe("routeType", () => {
  test("正常填词块（题号 1-10）→ ctw", () => {
    expect(routeType({ section: "reading", start: 1, end: 10, body: "Fill in the missing letters in the paragraph. The h__ of..." })).toBe("ctw");
    expect(routeType({ section: "reading", start: 11, end: 20, body: "Fill inthemissingletters intheparagraph." })).toBe("ctw");
  });

  test("单题块串进下一屏的填词指令语（1.21B M1 Q35 原样形态）→ 按阅读默认规则，不是 ctw", () => {
    const body = `Augmented Reality for Training ${PASSAGE} What is one problem the passage mentions? `
      + "===== PAGE 11 ===== Reading Module 2 Fill in the missing letters in the paragraph.";
    expect(routeType({ section: "reading", start: 35, end: 35, body })).toBe("ap");
    // 短材料照旧落日常阅读
    expect(routeType({ section: "reading", start: 35, end: 35, body: "Read a notice. Fill in the missing letters" })).toBe("rdl");
  });

  test("OCR 吃掉一个 l：「Fil in the missing letters」照样认成填词（5.6_v2 M2）", () => {
    expect(routeType({ section: "reading", start: 1, end: 10, body: "00:08:59 Hide Time Fil in the missing letters in the paragraph. Music has long..." })).toBe("ctw");
  });

  test("没有题号范围的老调用方：不据题数拦（行为与改动前一致）", () => {
    expect(routeType({ section: "reading", body: "Fill in the missing letters" })).toBe("ctw");
    expect(blockQuestionCount({ body: "x" })).toBeNull();
  });

  test("其它路由不受题数影响：听力单题块照旧按指令语", () => {
    expect(routeType({ section: "listening", start: 3, end: 3, body: "Choose the best response." })).toBe("lcr");
    expect(routeType({ section: "writing", start: 1, end: 10, body: "Make an appropriate sentence." })).toBe("build");
  });

  test(`阈值 ${CTW_MIN_BLOCK_QUESTIONS}：与 structure_set 的 CTW_MIN_ANSWERS 同值（真填词块恒 10 空）`, () => {
    expect(CTW_MIN_BLOCK_QUESTIONS).toBe(5);
    expect(routeType({ section: "reading", start: 1, end: 5, body: "Fill in the missing letters" })).toBe("ctw");
    expect(routeType({ section: "reading", start: 1, end: 4, body: "Fill in the missing letters" })).not.toBe("ctw");
  });
});
