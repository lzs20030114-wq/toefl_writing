/**
 * 原文里标出「在这篇里查词典收藏过的词」（lib/vocab/passageMarks + findWordRanges + useVocabMarks）。
 */
import React, { useRef } from "react";
import { render, act } from "@testing-library/react";
import { savedWordsInPassage, wordPattern } from "../lib/vocab/passageMarks";
import { findWordRanges } from "../lib/notes/passageFlash";

const PASSAGE = "In the world of classical music, wind ensemble conducting requires a blend of artistry and precision. One challenge is balancing the ensemble.";

describe("savedWordsInPassage", () => {
  const card = (word, sentence, extra = {}) => ({ word, sentence, ...extra });
  it("语境句在这篇原文里才标；别的文章收藏的词不标；删掉的不标", () => {
    const cards = [
      card("blend", "In the world of classical music, wind ensemble conducting requires a blend of artistry and precision."),
      card("ensemble", "Some other article mentions an ensemble."),
      card("precision", "In the world of classical music, wind ensemble conducting requires a blend of artistry and precision.", { deletedAt: "x" }),
      card("balance", "x", { sentences: ["One challenge is balancing the ensemble."] }),
    ];
    expect(savedWordsInPassage(cards, PASSAGE).sort()).toEqual(["balance", "blend"]);
  });
  it("标点、大小写、空白不同也认得出语境句", () => {
    const cards = [card("artistry", "in the world of classical music  wind ensemble conducting requires a blend of artistry and precision")];
    expect(savedWordsInPassage(cards, PASSAGE)).toEqual(["artistry"]);
  });
});

describe("wordPattern + findWordRanges", () => {
  function ranges(text, words) {
    const div = document.createElement("div");
    div.innerHTML = text;
    document.body.appendChild(div);
    const out = findWordRanges(div, words.map(wordPattern)).map((r) => r.toString());
    div.remove();
    return out;
  }
  it("整词匹配并认常见词尾变化，不误标词中间", () => {
    expect(ranges("<p>One challenge is <b>balancing</b> the ensemble; balanced. Imbalance.</p>", ["balance"])).toEqual(["balancing", "balanced"]);
    expect(ranges("<p>Studies show the student studied.</p>", ["study"])).toEqual(["Studies", "studied"]);
    expect(ranges("<p>wind ensemble conducting</p>", ["ensemble conducting"])).toEqual(["ensemble conducting"]);
  });
  it("笔记卡、序号角标里的字不算原文", () => {
    expect(ranges('<p>blend<sup data-testid="note-badge">1</sup></p><div data-note-card>blend</div>', ["blend"])).toEqual(["blend"]);
  });
});

describe("useVocabMarks", () => {
  it("收藏了这篇里的词就画高亮，单词本更新后跟着变", () => {
    const set = jest.fn();
    const del = jest.fn();
    global.CSS = { highlights: { set, delete: del } };
    global.Highlight = function Highlight(...r) { this.ranges = r; };
    const { useVocabMarks, VOCAB_HIGHLIGHT } = require("../components/notes/useVocabMarks");
    const { saveWord } = require("../lib/vocab/vocabStore");
    localStorage.clear();
    function Probe() {
      const ref = useRef(null);
      useVocabMarks(ref, PASSAGE);
      return <div ref={ref}>{PASSAGE}</div>;
    }
    render(<Probe />);
    expect(set).not.toHaveBeenCalled();
    act(() => {
      saveWord({ word: "blend", def: "n. 混合", sentence: "In the world of classical music, wind ensemble conducting requires a blend of artistry and precision." });
    });
    const last = set.mock.calls[set.mock.calls.length - 1];
    expect(last[0]).toBe(VOCAB_HIGHLIGHT);
    expect(last[1].ranges.map((r) => r.toString())).toEqual(["blend"]);
    delete global.CSS;
    delete global.Highlight;
  });
});
