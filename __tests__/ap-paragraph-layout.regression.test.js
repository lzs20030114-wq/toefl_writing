// AP 学术阅读「正文不分段」的回归锁（2026-09-18）。
//
// 事故: AP 条目的正文有两个字段 —— passage（渲染用）与 paragraphs[]（题干「paragraph N」的
// 下标空间）。出题模型分别产出这两个字段，偶尔给出一个用单空格拼起来、不带空行的 passage；
// 渲染层（components/reading/RDLTask.js 的 whiteSpace: "pre-wrap"）只认空行 —— 整篇糊成一坨，
// 而 AP 505 道题里有 398 道题干写着「According to paragraph 2」。
// 实测常规库 101 条里 15 条中招、staging 353 条里 59 条中招。
//
// 修法三层: 数据修（scripts/fix-ap-paragraph-breaks.mjs）+ 渲染兜底（apPassageText）+
// 管线闸（merge-staging 先修、apValidator 后拦）。这份测试把三层都钉住。

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const {
  restoreParagraphBreaks,
  isParagraphLayoutSynced,
  paragraphBlocks,
  apPassageText,
} = require("../lib/reading/passageLayout.js");
const { validateAPItem } = require("../lib/readingGen/apValidator.js");

const P1 = "Chain migration is a process in which migrants follow earlier arrivals from the same origin.";
const P2 = "Each settled migrant lowers the cost and risk of moving for those who follow.";
const P3 = "This concentration, however, carries ambiguous consequences for later arrivals.";

const bare = (s) => String(s).replace(/\s+/g, "");

describe("restoreParagraphBreaks —— 只动段间空白", () => {
  test("单空格拼起来的正文能补回空行", () => {
    const joined = [P1, P2, P3].join(" ");
    const out = restoreParagraphBreaks(joined, [P1, P2, P3]);
    expect(paragraphBlocks(out)).toEqual([P1, P2, P3]);
    expect(isParagraphLayoutSynced(out, [P1, P2, P3])).toBe(true);
  });

  test("非空白字符一个都不许变（本函数唯一被允许的改动就是空白）", () => {
    const joined = [P1, P2, P3].join(" ");
    expect(bare(restoreParagraphBreaks(joined, [P1, P2, P3]))).toBe(bare(joined));
  });

  test("插入句标记 [■] 不会被吃掉 —— 所以补分段不能写成 paragraphs.join()", () => {
    // 库里 7 条带标记的条目：标记只在 passage 里，paragraphs 是去标记版本。
    const marked = `${P1} [■] ${P2} [■] ${P3}`;
    const out = restoreParagraphBreaks(marked, [P1, P2, P3]);
    expect((out.match(/\[■\]/g) || []).length).toBe(2);
    expect(bare(out)).toBe(bare(marked));
    expect(paragraphBlocks(out).length).toBe(3);
  });

  test("已经分好段的正文原样返回（幂等）", () => {
    const fine = [P1, P2, P3].join("\n\n");
    expect(restoreParagraphBreaks(fine, [P1, P2, P3])).toBe(fine);
    expect(restoreParagraphBreaks(restoreParagraphBreaks(fine, [P1, P2, P3]), [P1, P2, P3])).toBe(fine);
  });

  test("段落在正文里错序 / 找不到 → 原样返回，不猜", () => {
    const shuffled = [P1, P3, P2].join(" "); // paragraphs 声明的顺序对不上正文
    expect(restoreParagraphBreaks(shuffled, [P1, P2, P3])).toBe(shuffled);
    const foreign = [P1, P2].join(" ");
    expect(restoreParagraphBreaks(foreign, [P1, "一段正文里根本没有的文字。", P3])).toBe(foreign);
  });

  test("段落数组缺失 / 只有一段 → 原样返回", () => {
    const one = [P1, P2].join(" ");
    expect(restoreParagraphBreaks(one, undefined)).toBe(one);
    expect(restoreParagraphBreaks(one, [P1])).toBe(one);
  });

  test("段首粘着的开引号跟着走，不会被留在上一段", () => {
    const quoted = '"Networks are infrastructure," the author writes.';
    const joined = `${P1} ${quoted}`;
    const out = restoreParagraphBreaks(joined, [P1, quoted]);
    expect(paragraphBlocks(out)).toEqual([P1, quoted]);
  });

  test("apPassageText 认 text / passage 两种字段名", () => {
    const joined = [P1, P2].join(" ");
    expect(apPassageText({ passage: joined, paragraphs: [P1, P2] })).toBe([P1, P2].join("\n\n"));
    expect(apPassageText({ text: joined, paragraphs: [P1, P2] })).toBe([P1, P2].join("\n\n"));
    expect(apPassageText({})).toBe("");
  });
});

describe("apValidator 段落版面闸", () => {
  const mk = (passage, paragraphs) => ({ passage, paragraphs, questions: [] });
  const layoutErrors = (item) => (validateAPItem(item).errors || []).filter((e) => e.startsWith("paragraph_layout"));

  test("passage 与 paragraphs 段数对不上 → 拒收", () => {
    expect(layoutErrors(mk([P1, P2, P3].join(" "), [P1, P2, P3]))).toHaveLength(1);
  });

  test("补好分段之后就放行", () => {
    expect(layoutErrors(mk([P1, P2, P3].join("\n\n"), [P1, P2, P3]))).toHaveLength(0);
  });

  test("既无空行又无 paragraphs → 拒收（没有任何东西可以据以还原版面）", () => {
    expect(layoutErrors(mk([P1, P2, P3].join(" "), []))).toHaveLength(1);
  });

  test("带 [■] 标记的条目不算对不上（比的是字母数字，不是逐字相等）", () => {
    const marked = [`${P1} [■]`, P2, P3].join("\n\n");
    expect(layoutErrors(mk(marked, [P1, P2, P3]))).toHaveLength(0);
  });
});

describe("题库体检 —— 常规 AP 库不许再出现糊成一坨的正文", () => {
  const bank = JSON.parse(fs.readFileSync(path.join(ROOT, "data/reading/bank/ap.json"), "utf8"));

  test("每条 passage 的空行分段都与 paragraphs 对得上", () => {
    const broken = bank.items
      .filter((it) => !isParagraphLayoutSynced(it.passage, it.paragraphs))
      .map((it) => `${it.id}: passage ${paragraphBlocks(it.passage).length} 块 vs paragraphs ${(it.paragraphs || []).length} 段`);
    expect(broken).toEqual([]);
  });

  test("每条正文都至少有两段（题干四分之三写着「paragraph N」）", () => {
    const single = bank.items.filter((it) => paragraphBlocks(it.passage).length < 2).map((it) => it.id);
    expect(single).toEqual([]);
  });
});

describe("管线接线没被拆掉", () => {
  test("merge-staging 合库前会跑 restoreParagraphBreaks", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts/merge-staging.mjs"), "utf8");
    expect(src).toMatch(/restoreParagraphBreaks\(item\.passage, item\.paragraphs\)/);
  });

  test("三个答题入口都不再直接把裸 passage 塞给组件", () => {
    for (const f of ["app/reading/page.js", "app/real-bank/page.js"]) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      expect(src).toMatch(/text: apPassageText\(item\)/);
      expect(src).not.toMatch(/\{ \.\.\.item, text: item\.passage,/);
    }
    const shell = fs.readFileSync(path.join(ROOT, "components/mockExam/AdaptiveExamShell.js"), "utf8");
    expect(shell).toMatch(/taskType === "ap"\) return apPassageText\(item\)/);
  });
});

describe("不许碰到真题专区的选句题定位", () => {
  // 选句题（真题专区独有）是拿 paragraphs[i] 去正文里做精确 indexOf 定位的。
  // 补分段只往段与段之间插空白、段内逐字不动，所以定位必须照样成立 —— 这两条就是钉这件事的。
  const {
    sentenceSelectionLayout,
  } = require("../lib/reading/sentenceSelection.js");

  test("真题 AP 库逐条过 apPassageText 都是原样返回（段落本来就是从 passage 切出来的）", () => {
    const bank = JSON.parse(fs.readFileSync(path.join(ROOT, "data/realBank/reading/ap.json"), "utf8"));
    const items = bank.items || bank;
    const changed = items.filter((it) => apPassageText(it) !== (it.text || it.passage)).map((it) => it.id);
    expect(changed).toEqual([]);
  });

  test("补过分段的正文里，选句题照样排得出版面", () => {
    const s1 = "Each settled migrant lowers the cost of moving.";
    const s2 = "Over time these networks become self-perpetuating.";
    const para2 = `${s1} ${s2}`;
    const item = {
      passage: [P1, para2, P3].join(" "), // 事故形状：整篇用单空格拼起来
      paragraphs: [P1, para2, P3],
    };
    const question = {
      question_type: "sentence_selection",
      stem: "Identify the sentence in paragraph 2 that ...",
      paragraph: 2,
      paragraph_index: 1,
      options: { S1: s1, S2: s2 },
      correct_answer: "S2",
    };
    const restored = { ...item, text: apPassageText(item) };
    expect(paragraphBlocks(restored.text).length).toBe(3);

    const layout = sentenceSelectionLayout(restored, question);
    expect(layout).not.toBeNull();
    expect(restored.text.slice(layout.start, layout.end)).toBe(para2);
    expect(layout.sentences.map((s) => restored.text.slice(s.start, s.end))).toEqual([s1, s2]);
  });
});
