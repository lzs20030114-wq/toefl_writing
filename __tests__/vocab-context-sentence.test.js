/** @jest-environment jsdom */
import { cleanContextSentence, contextSentence, normalizeCard } from "../lib/vocab/book";
import { sentenceAtOffsets } from "../lib/dict/core";
import { lookupTextAt } from "../components/reading/WordLookupLayer";

const DIRTY = "45); text-decoration: underline 2px #F59E0B; text-underline-offset: 3px; } Augmented Reality for Training¶1Augmented reality (AR) has emerged as a groundbreaking tool in the field of human performance technology, offering new ways to train workers.";

test("旧卡里混进的 CSS 文字、段号和标题，展示时清掉", () => {
  expect(cleanContextSentence(DIRTY, "augmented")).toBe(
    "Augmented reality (AR) has emerged as a groundbreaking tool in the field of human performance technology, offering new ways to train workers.",
  );
  const card = normalizeCard({ word: "groundbreaking", sentence: DIRTY });
  expect(contextSentence(card)).toMatch(/^Augmented reality \(AR\) has emerged/);
});

test("干净的句子原样不动", () => {
  const s = "The value of {x} is high; see figure 2.";
  expect(cleanContextSentence(s, "value")).toBe(s);
  expect(cleanContextSentence("[■] The machine broke.", "machine")).toBe("The machine broke.");
});

test("段落分隔符算句子边界", () => {
  const text = "A Title First sentence here. Second one.";
  const i = text.indexOf("First");
  expect(sentenceAtOffsets(text, i, i + 5)).toBe("First sentence here.");
});

test("收藏时取句子跳过 <style>、段号和标题", () => {
  const root = document.createElement("div");
  root.innerHTML = `<style>.n{background:rgba(251,191,36,0.45); text-decoration: underline 2px #F59E0B;}</style>`
    + `<h3>Augmented Reality for Training</h3>`
    + `<p><span data-no-dict="true">¶1</span>Augmented reality (AR) has emerged as a tool. It is new.</p>`;
  document.body.appendChild(root);
  const textNode = root.querySelector("p").lastChild;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, "Augmented".length);
  const { text, start, end } = lookupTextAt(root, range);
  expect(text.slice(start, end)).toBe("Augmented");
  expect(sentenceAtOffsets(text, start, end)).toBe("Augmented reality (AR) has emerged as a tool.");
});
