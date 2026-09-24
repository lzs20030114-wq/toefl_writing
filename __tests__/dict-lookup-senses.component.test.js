/**
 * 划词弹窗的「义项 chips + 语境池」。
 *
 * 词典条目的 t 是整条词条（好几个词性、七八个义项），整条存进单词本，复习时对不上
 * 原句那个意思；chips 让用户点定「这句里是哪个意思」。语境池则解决另一半问题：
 * 同一个词永远在同一句里复习，容易记住句子而不是词。
 *
 * 为什么另起一个文件而不是并进 dict-lookup-layer.component.test.js：
 * lib/dict/lookup 的分片缓存是模块级的，那个文件里的「预热分片」用例会先把
 * /dict/p.json 缓存成空表，同一个文件里后面再查 pattern 就永远查不到了。
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { WordLookupLayer } from "../components/reading/WordLookupLayer";
import { getCard, isSaved, saveWord } from "../lib/vocab/vocabStore";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
  getSavedTier: jest.fn(() => "free"), // 本文件不测 AI 讲解那条路
  AUTH_CHANGED_EVENT: "toefl-auth-changed",
}));

// pattern 是真实词条的形状（多词性多义项），photosynthesis 是单义项的对照组
const PATTERN_T = "n. 模范, 典型, 图案\nvt. 模仿, 仿造";
const PASSAGE = "The pattern of migration changed. A second pattern appeared later.";
const OTHER_PASSAGE = "Every pattern tells a story about the past.";
const SHARDS = {
  p: {
    pattern: { p: "'pætәn", t: PATTERN_T, g: "IELTS" },
    photosynthesis: { p: ",fәutәu'sinθisis", t: "n. 光合作用", g: "GRE" },
  },
};

const realFetch = global.fetch;
const realCaret = document.caretRangeFromPoint;
const realRect = Range.prototype.getBoundingClientRect;

beforeAll(() => {
  global.fetch = jest.fn((url) => {
    const m = String(url).match(/\/dict\/(.)\.json/);
    if (!m) return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(SHARDS[m[1]] || {}) });
  });
  Range.prototype.getBoundingClientRect = () => ({
    top: 100, bottom: 116, left: 40, right: 100, width: 60, height: 16,
  });
});

afterAll(() => {
  global.fetch = realFetch;
  document.caretRangeFromPoint = realCaret;
  Range.prototype.getBoundingClientRect = realRect;
});

beforeEach(() => {
  localStorage.clear();
});

/** jsdom 没有 caretRangeFromPoint：把「点击」定向到页面上某个词所在的文本节点。 */
function aimAt(word) {
  document.caretRangeFromPoint = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.textContent.indexOf(word);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(node, i + 2);
        r.collapse(true);
        return r;
      }
    }
    return null;
  };
}

/** 在某段原文里点开某个词的弹窗。 */
function openPopup(word, passage = PASSAGE) {
  render(
    <WordLookupLayer passage={passage} source="reading">
      {passage}
    </WordLookupLayer>
  );
  const host = screen.getByText(passage);
  aimAt(word);
  fireEvent.mouseUp(host, { clientX: 60, clientY: 108 });
}

describe("划词弹窗 · 义项 chips", () => {
  test("多义项拆成 chips；点一条就按这条义项收藏，整条留作 defFull", async () => {
    openPopup("pattern");
    const chip = await screen.findByText("图案");
    // 整条释义不再直接铺开，词性变成行首的小标题（而且是中文 —— vt. 这种行话
    // 对着弹窗的学生没有义务认得）
    expect(screen.queryByText(PATTERN_T)).not.toBeInTheDocument();
    expect(screen.getByText("名词")).toBeInTheDocument();
    expect(screen.getByText("及物动词")).toBeInTheDocument();
    expect(screen.getByText("点一个义项收藏，复习时就按这个意思考")).toBeInTheDocument();

    fireEvent.click(chip);
    const card = getCard("pattern");
    expect(card.def).toBe("n. 图案");
    expect(card.defFull).toBe(PATTERN_T);
    // 收藏时连词所在的那一句一起存
    expect(card.sentence).toBe("The pattern of migration changed.");
    // 选中的那颗 chip 立刻变成选中态
    expect(chip).toHaveStyle({ color: "#0891B2" });
  });

  test("已收藏的词换一条义项：主释义跟着换，整条备份不动", async () => {
    saveWord({ word: "pattern", def: "n. 模范", defFull: PATTERN_T, sentence: "Old pattern.", source: "reading" });
    openPopup("pattern");
    fireEvent.click(await screen.findByText("模仿"));
    const card = getCard("pattern");
    expect(card.def).toBe("vt. 模仿");
    expect(card.defFull).toBe(PATTERN_T);
    // 复习进度不因为换义项被重置
    expect(card.reps).toBe(0);
  });

  test("单义项的词不拆 chips，但词性照样说人话；收藏走整条释义", async () => {
    openPopup("photosynthesis", "Plants rely on photosynthesis every day.");
    expect(await screen.findByText("光合作用")).toBeInTheDocument();
    expect(screen.getByText("名词")).toBeInTheDocument();
    fireEvent.click(screen.getByText("☆ 收藏到单词本"));
    const card = getCard("photosynthesis");
    expect(card.def).toBe("n. 光合作用");
    expect(card.defFull).toBe("");
  });
});

describe("划词弹窗 · 语境池", () => {
  test("已收藏时出现「＋ 加这句语境」，点了把当前这句加进池", async () => {
    saveWord({
      word: "pattern", def: "n. 图案",
      sentence: "The pattern of migration changed.", source: "reading",
    });
    openPopup("pattern", OTHER_PASSAGE);
    fireEvent.click(await screen.findByText("＋ 加这句语境"));
    expect(getCard("pattern").sentences).toEqual([OTHER_PASSAGE]);
    // 加完当场变成「已在卡上」且点不动了
    expect(await screen.findByText("✓ 这句已在卡上")).toBeDisabled();
  });

  test("当前这句已经在卡上时，一打开就是 disabled 的「已在卡上」", async () => {
    saveWord({ word: "pattern", def: "n. 图案", sentence: OTHER_PASSAGE, source: "reading" });
    openPopup("pattern", OTHER_PASSAGE);
    expect(await screen.findByText("✓ 这句已在卡上")).toBeDisabled();
  });

  test("池满 3 句后不再收，按钮直说满了", async () => {
    saveWord({ word: "pattern", def: "n. 图案", sentence: "Main pattern.", source: "reading" });
    ["a pattern", "b pattern", "c pattern"].forEach((sentence) =>
      saveWord({ word: "pattern", sentence, source: "reading" })
    );
    expect(getCard("pattern").sentences).toHaveLength(3);
    openPopup("pattern", OTHER_PASSAGE);
    expect(await screen.findByText("语境已满 3 句")).toBeDisabled();
  });

  test("「移出单词本」才是删除入口；删完回到未收藏态", async () => {
    saveWord({ word: "pattern", def: "n. 图案", sentence: "Main pattern.", source: "reading" });
    openPopup("pattern");
    // 已收藏时不再有那颗「★ 已在单词本」（点一下就误删的老入口）
    expect(screen.queryByText("★ 已在单词本")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("移出单词本"));
    expect(isSaved("pattern")).toBe(false);
    expect(await screen.findByText("☆ 收藏到单词本")).toBeInTheDocument();
  });
});
