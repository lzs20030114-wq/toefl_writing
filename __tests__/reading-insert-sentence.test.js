/**
 * 插入句题题干拆分（lib/reading/insertSentence.js）契约。
 *
 * 题干来源三条（真题 OCR / 生成 prompt / 个人题库抽题）写法各异，这里把实测到的每一种写法都钉死，
 * 再对两个 AP 库全量扫一遍：每道 insert_text 都得拆出一句干净的待插入句（不带套话、不带方块），
 * 否则做题页会回落到整段堆在一起的老样子，用户又得在一段黑体里自己找句子。
 */
import { splitInsertStem, insertStemParts, unwrapInsertSentence, DEFAULT_INSERT_LEAD, DEFAULT_INSERT_TAIL } from "../lib/reading/insertSentence";
import RB_AP from "../data/realBank/reading/ap.json";
import GEN_AP from "../data/reading/bank/ap.json";

const LEAD = "There are four locations [■] in the passage that indicate where the following sentence could be added.";
const TAIL = "Where would the sentence best fit? Select a location to add the sentence to the passage.";
const SENT = "Changes in educational practices or shifts in societal values could account for the downturn.";

describe("splitInsertStem：指令 + 句子 + 提问（主流写法）", () => {
  test("真题 OCR：无引号无方块，句子夹在中间", () => {
    const stem = `There are four locations in the passage that indicate where the following sentence could be added. ${SENT} Where would the sentence best fit? Select a location to add the sentence in the passage.`;
    expect(splitInsertStem(stem)).toEqual({
      lead: "There are four locations in the passage that indicate where the following sentence could be added.",
      sentence: SENT,
      tail: "Where would the sentence best fit? Select a location to add the sentence in the passage.",
      filled: false,
    });
  });

  test.each([
    ["[■]", "There are four locations [■] in the passage that indicate where the following sentence could be added."],
    ["■", "There are four locations ■ in the passage that indicate where the following sentence could be added."],
    ["[ ]", "There are four locations [ ] in the passage that indicate where the following sentence could be added."],
    ["[]", "There are four locations [] in the passage that indicate where the following sentence could be added."],
    ["[A]-[D]", "There are four locations [A]-[D] in the passage that indicate where the following sentence could be added."],
  ])("指令里的方块写法 %s 原样留在指令里，不会漏进句子", (_label, lead) => {
    const r = splitInsertStem(`${lead} ${SENT} ${TAIL}`);
    expect(r.lead).toBe(lead);
    expect(r.sentence).toBe(SENT);
    expect(r.tail).toBe(TAIL);
  });

  test("生成库把句子包成 **'…'**：剥掉包装，句内标点原样", () => {
    const inner = "For example, a section of a plate boundary may remain locked for centuries, quietly building strain until it suddenly gives way.";
    expect(splitInsertStem(`${LEAD} **'${inner}'** ${TAIL}`).sentence).toBe(inner);
    expect(splitInsertStem(`${LEAD} '${inner}' ${TAIL}`).sentence).toBe(inner);
    expect(splitInsertStem(`${LEAD} “${inner}” ${TAIL}`).sentence).toBe(inner);
  });

  test("提问里带方块（Select a location [ ] / [A]-[D] / ■）也照拆", () => {
    for (const tail of [
      "Where would the sentence best fit? Select a location [ ] to add the sentence to the passage.",
      "Where would the sentence best fit? Select a location [A]-[D] to add the sentence to the passage.",
      "Where would the sentence best fit? Select a location ■ to add the sentence to the passage.",
      "Where would the sentence best fit?",
    ]) {
      const r = splitInsertStem(`${LEAD} ${SENT} ${tail}`);
      expect(r.sentence).toBe(SENT);
      expect(r.tail).toBe(tail);
    }
  });

  test("换行 / 多空格归一", () => {
    const r = splitInsertStem(`  ${LEAD}\n\n  ${SENT}\n ${TAIL}  `);
    expect(r.sentence).toBe(SENT);
    expect(r.lead).toBe(LEAD);
  });
});

describe("splitInsertStem：OCR 残缺写法", () => {
  test("B：提问在前、句子在最后（问号后没空格也行）", () => {
    const lead = "There are four locations [A]-[D] in the passage. Where would the following sentence best fit?";
    expect(splitInsertStem(`${lead} ${SENT}`)).toEqual({ lead, sentence: SENT, tail: "", filled: false });
    expect(splitInsertStem(`${lead}${SENT}`)).toEqual({ lead, sentence: SENT, tail: "", filled: false });
  });

  test("C：只剩句子 + 提问 → 指令用标准套话补齐", () => {
    const r = splitInsertStem(`${SENT} ${TAIL}`);
    expect(r).toEqual({ lead: DEFAULT_INSERT_LEAD, sentence: SENT, tail: TAIL, filled: true });
  });

  test("D：只剩句子 → 指令和提问都补齐", () => {
    const r = splitInsertStem("Careful consideration is needed to assess the long-term impacts.");
    expect(r).toEqual({
      lead: DEFAULT_INSERT_LEAD,
      sentence: "Careful consideration is needed to assess the long-term impacts.",
      tail: DEFAULT_INSERT_TAIL,
      filled: true,
    });
  });

  test("指令 + 句子、没有提问 → 提问补齐", () => {
    const r = splitInsertStem(`There are four locations [] in the passage that indicate where the following sentence could be added. ${SENT}`);
    expect(r.sentence).toBe(SENT);
    expect(r.tail).toBe(DEFAULT_INSERT_TAIL);
    expect(r.filled).toBe(true);
  });
});

describe("splitInsertStem：拆不出句子时返回 null（渲染层回落整段原样）", () => {
  test.each([
    ["空", ""],
    ["null", null],
    ["只有指令和提问", `${LEAD} ${TAIL}`],
    ["只有指令", LEAD],
    ["句子位置只剩方块", `${LEAD} [■] ${TAIL}`],
    ["错标成插入题的普通问句", "According to paragraph 2, why did the population decline?"],
  ])("%s", (_label, stem) => {
    expect(splitInsertStem(stem)).toBeNull();
  });
});

describe("insertStemParts / unwrapInsertSentence", () => {
  test("只对 insert_text 生效，其它题型一律 null", () => {
    expect(insertStemParts({ question_type: "insert_text", stem: `${LEAD} ${SENT} ${TAIL}` }).sentence).toBe(SENT);
    expect(insertStemParts({ question_type: "factual_detail", stem: `${LEAD} ${SENT} ${TAIL}` })).toBeNull();
    expect(insertStemParts({ stem: SENT })).toBeNull();
    expect(insertStemParts(null)).toBeNull();
  });

  test("unwrap 只剥两端包装，句内引号保留", () => {
    expect(unwrapInsertSentence("**'He said \"no\" twice.'**")).toBe('He said "no" twice.');
    expect(unwrapInsertSentence("  plain sentence.  ")).toBe("plain sentence.");
  });
});

describe("题库全量：每道 insert_text 都拆得出干净的待插入句", () => {
  const BOILERPLATE = /four locations|following sentence|best fit|Select a location/i;
  const allInsert = (bank) =>
    bank.items.flatMap((it) => (it.questions || []).filter((q) => q.question_type === "insert_text").map((q) => [it.id, q]));

  test.each([
    ["data/realBank/reading/ap.json", RB_AP],
    ["data/reading/bank/ap.json", GEN_AP],
  ])("%s", (_name, bank) => {
    const qs = allInsert(bank);
    expect(qs.length).toBeGreaterThan(0);
    const failures = [];
    for (const [id, q] of qs) {
      const r = splitInsertStem(q.stem);
      if (!r) { failures.push(`${id}: 拆不出句子 ← ${q.stem.slice(0, 80)}`); continue; }
      if (BOILERPLATE.test(r.sentence)) failures.push(`${id}: 套话漏进句子 ← ${r.sentence}`);
      // 句内的 *斜体* 片名是句子自己的（生成库有一例），只查方块和 ** 包装
      if (/■|\*\*/.test(r.sentence)) failures.push(`${id}: 方块/加粗标记漏进句子 ← ${r.sentence}`);
      if (!/\bfollowing sentence\b/i.test(r.lead)) failures.push(`${id}: 指令不完整 ← ${r.lead}`);
      if (r.tail && !/\bbest fit\b/i.test(r.tail)) failures.push(`${id}: 提问不完整 ← ${r.tail}`);
    }
    expect(failures).toEqual([]);
  });
});
