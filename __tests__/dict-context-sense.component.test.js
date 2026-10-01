import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { WordLookupLayer } from "../components/reading/WordLookupLayer";
import { callAI } from "../lib/ai/client";
import { getCard, saveWord } from "../lib/vocab/vocabStore";
import { definitionForContext } from "../lib/vocab/book";
import { AUTH_CHANGED_EVENT } from "../lib/AuthContext";

jest.mock("../lib/ai/client", () => ({ ...jest.requireActual("../lib/ai/client"), callAI: jest.fn() }));
const FIRST = "The involuntary reaction surprised the researchers.";
const SECOND = "An involuntary payment was taken from her account.";
const SMALL = "A small fish swam nearby.";
const DICT = "a. 不由自主的, 无意识的";
const RESPONSE = { sense: "a. 非自愿的；被迫的", explanation: "这里强调并非自己主动选择。它可以修饰付款或行为。" };
const realFetch = global.fetch;
const realCaret = document.caretRangeFromPoint;
const realRect = Range.prototype.getBoundingClientRect;
beforeAll(() => {
  global.fetch = jest.fn((url) => Promise.resolve({ ok: true, json: () => Promise.resolve(String(url).includes("/dict/") ? {
    involuntary: { p: "in'vɔləntəri", t: DICT, g: "TOEFL" }, small: { p: "", t: "a. 小的", g: "" },
  } : {}) }));
  Range.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 116, left: 40, right: 100, width: 60, height: 16 });
});
afterAll(() => {
  global.fetch = realFetch;
  document.caretRangeFromPoint = realCaret;
  Range.prototype.getBoundingClientRect = realRect;
});
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("toefl-user-tier", "pro");
  callAI.mockReset();
  callAI.mockResolvedValue(JSON.stringify(RESPONSE));
});
function mount() {
  return render(<WordLookupLayer passage={[FIRST, SECOND, SMALL].join(" ")}>
    <span data-sentence-index="first">{FIRST}</span><span data-sentence-index="second">{SECOND}</span><span data-sentence-index="third">{SMALL}</span>
  </WordLookupLayer>);
}
async function open(sentence = FIRST, word = "involuntary") {
  const host = screen.getByText(sentence, { normalizer: (text) => text });
  document.caretRangeFromPoint = () => {
    const range = document.createRange();
    range.setStart(host.firstChild, sentence.indexOf(word) + 2);
    range.collapse(true);
    return range;
  };
  fireEvent.mouseUp(host, { clientX: 60, clientY: 108 });
  return screen.findByRole("button", { name: "讲讲这句里的用法" });
}
async function analyze(sentence = FIRST) {
  fireEvent.click(await open(sentence));
  return screen.findByRole("button", { name: "用这个意思复习" });
}

test("请求与收藏只由用户动作触发；采用同时保存原句、音标、完整词典备份", async () => {
  mount();
  await open();
  expect(callAI).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "讲讲这句里的用法" }));
  const adopt = await screen.findByRole("button", { name: "用这个意思复习" });
  expect(getCard("involuntary")).toBeNull();
  fireEvent.click(adopt);
  const card = getCard("involuntary");
  expect(card.def).toBe(RESPONSE.sense);
  expect(card.defFull).toBe(DICT);
  expect(card.phonetic).toBe("in'vɔləntəri");
  expect(card.sentence).toBe(FIRST);
  expect(screen.getByRole("button", { name: "✓ 已用于这句的复习" })).toBeDisabled();
  expect(callAI).toHaveBeenCalledTimes(1);
});

test("既有词卡采用或编辑保留复习进度；取消与空释义不写卡，不重复调用AI", async () => {
  const existing = saveWord({ word: "involuntary", def: DICT, sentence: SECOND, reps: 8, state: 2, due: "2030-01-01T00:00:00.000Z" });
  mount();
  fireEvent.click(await analyze());
  expect(getCard("involuntary").reps).toBe(existing.reps);
  fireEvent.click(screen.getByRole("button", { name: "编辑释义" }));
  expect(screen.getByLabelText("这句的短释义")).toHaveValue(RESPONSE.sense);
  fireEvent.change(screen.getByLabelText("这句的短释义"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "保存释义" }));
  expect(screen.getByRole("alert")).toHaveTextContent("请输入");
  expect(getCard("involuntary").def).toBe(RESPONSE.sense);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑释义" }));
  fireEvent.change(screen.getByLabelText("这句的短释义"), { target: { value: "a. 不受意识控制的" } });
  fireEvent.click(screen.getByRole("button", { name: "保存释义" }));
  const edited = getCard("involuntary");
  expect(definitionForContext(edited, FIRST)).toBe("a. 不受意识控制的");
  expect(edited.reps).toBe(existing.reps);
  expect(edited.due).toBe(existing.due);
  expect(callAI).toHaveBeenCalledTimes(1);
});

test("旧缓存解释可手填采用，且没有自动补发AI请求", async () => {
  localStorage.setItem("dict-ai-explain-cache", JSON.stringify({ [`involuntary|||${FIRST.slice(0, 80)}`]: "这里不是自愿，而是被迫的意思。" }));
  mount();
  fireEvent.click(await open());
  expect(await screen.findByText("这里不是自愿，而是被迫的意思。")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "用这个意思复习" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "编辑释义" }));
  expect(screen.getByLabelText("这句的短释义")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("这句的短释义"), { target: { value: RESPONSE.sense } });
  fireEvent.click(screen.getByRole("button", { name: "保存释义" }));
  expect(getCard("involuntary").def).toBe(RESPONSE.sense);
  expect(callAI).not.toHaveBeenCalled();
});

test("旧prefix缓存对象的候选不被误用，可显式重新分析", async () => {
  localStorage.setItem("dict-ai-explain-cache", JSON.stringify({ [`involuntary|||${FIRST.slice(0, 80)}`]: RESPONSE }));
  mount();
  fireEvent.click(await open());
  expect(await screen.findByText(RESPONSE.explanation)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "用这个意思复习" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新分析" }));
  expect(await screen.findByRole("button", { name: "用这个意思复习" })).toBeInTheDocument();
  expect(callAI).toHaveBeenCalledTimes(1);
});

test.each([[SECOND, "involuntary"], [SMALL, "small"]])("在途请求换句或换词后不会污染新弹窗 %#", async (nextSentence, nextWord) => {
  let resolveOld;
  callAI.mockImplementation(() => new Promise((resolve) => { resolveOld = resolve; }));
  mount();
  fireEvent.click(await open());
  await open(nextSentence, nextWord);
  await act(async () => { resolveOld(JSON.stringify(RESPONSE)); });
  expect(screen.queryByText(RESPONSE.explanation)).toBeNull();
  expect(screen.getByRole("button", { name: "讲讲这句里的用法" })).toBeInTheDocument();
  expect(getCard("involuntary")).toBeNull();
});

test("在途请求关闭或账户切换后失效；旧编辑不能写到新账户", async () => {
  let resolveOld;
  callAI.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  mount();
  fireEvent.click(await open());
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await act(async () => { resolveOld(JSON.stringify(RESPONSE)); });
  expect(screen.queryByText(RESPONSE.explanation)).toBeNull();
  await analyze();
  fireEvent.click(screen.getByRole("button", { name: "编辑释义" }));
  localStorage.setItem("toefl-user-code", "ABCDEF");
  fireEvent.click(screen.getByRole("button", { name: "保存释义" }));
  expect(getCard("involuntary")).toBeNull();
  expect(screen.queryByLabelText("这句的短释义")).toBeNull();
});

test("账户变更事件关闭编辑弹窗并使AI响应失效", async () => {
  let resolveOld;
  callAI.mockImplementation(() => new Promise((resolve) => { resolveOld = resolve; }));
  mount();
  fireEvent.click(await open());
  localStorage.setItem("toefl-user-code", "ABCDEF");
  act(() => window.dispatchEvent(new Event(AUTH_CHANGED_EVENT)));
  await act(async () => { resolveOld(JSON.stringify(RESPONSE)); });
  expect(screen.queryByText(RESPONSE.explanation)).toBeNull();
  expect(getCard("involuntary")).toBeNull();
});

test("跨句选择可以读讲解，但不能保存错误的句义绑定", async () => {
  mount();
  const range = document.createRange();
  range.setStart(screen.getByText(FIRST).firstChild, FIRST.indexOf("involuntary"));
  range.setEnd(screen.getByText(SECOND).firstChild, 2);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  await act(async () => {
    fireEvent.mouseUp(screen.getByText(FIRST), { clientX: 60, clientY: 108 });
  });
  fireEvent.click(await screen.findByRole("button", { name: "讲讲这句里的用法" }));
  expect(await screen.findByRole("button", { name: "用这个意思复习" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "编辑释义" }));
  fireEvent.click(screen.getByRole("button", { name: "保存释义" }));
  expect(screen.getByRole("alert")).toHaveTextContent("原文语境");
  expect(getCard("involuntary")).toBeNull();
  selection.removeAllRanges();
});


test("普通词典义项可以反选替换当前句的AI义项", async () => {
  mount();
  fireEvent.click(await analyze());
  fireEvent.click(screen.getByRole("button", { name: "无意识的" }));
  expect(definitionForContext(getCard("involuntary"), FIRST)).toBe("a. 无意识的");
  expect(callAI).toHaveBeenCalledTimes(1);
});

test("没有完整句时可读AI讲解，但采用和编辑保存不能绑定残片", async () => {
  render(<WordLookupLayer passage="involuntary"><span>involuntary</span></WordLookupLayer>);
  const host = screen.getByText("involuntary");
  document.caretRangeFromPoint = () => {
    const range = document.createRange(); range.setStart(host.firstChild, 2); range.collapse(true); return range;
  };
  fireEvent.mouseUp(host, { clientX: 60, clientY: 108 });
  fireEvent.click(await screen.findByRole("button", { name: "讲讲这句里的用法" }));
  expect(await screen.findByRole("button", { name: "用这个意思复习" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "编辑释义" }));
  fireEvent.click(screen.getByRole("button", { name: "保存释义" }));
  expect(screen.getByRole("alert")).toHaveTextContent("原文语境");
  expect(getCard("involuntary")).toBeNull();
});

test("完整句缓存不因前80字相同误用其他句候选", async () => {
  const prefix = "The involuntary reaction " + "during the detailed experiment ".repeat(3);
  const one = prefix + "surprised the researchers.";
  const two = prefix + "was expected by the researchers.";
  render(<WordLookupLayer passage={one + two}><span data-sentence-index="one">{one}</span><span data-sentence-index="two">{two}</span></WordLookupLayer>);
  const first = await analyze(one);
  expect(first).toBeInTheDocument();
  fireEvent.click(await open(two));
  expect(await screen.findByRole("button", { name: "用这个意思复习" })).toBeInTheDocument();
  expect(callAI).toHaveBeenCalledTimes(2);
  fireEvent.click(await open(one));
  expect(await screen.findByRole("button", { name: "用这个意思复习" })).toBeInTheDocument();
  expect(callAI).toHaveBeenCalledTimes(2);
});


test("已采用句子重开读取缓存仍显示选中态；反选词典义后可重新采用", async () => {
  mount();
  fireEvent.click(await analyze());
  const after = getCard("involuntary").updatedAt;
  fireEvent.click(await open());
  expect(await screen.findByRole("button", { name: "✓ 已用于这句的复习" })).toBeDisabled();
  expect(getCard("involuntary").updatedAt).toBe(after);
  fireEvent.click(screen.getByRole("button", { name: "无意识的" }));
  expect(screen.getByRole("button", { name: "用这个意思复习" })).toBeEnabled();
  expect(callAI).toHaveBeenCalledTimes(1);
});

test("来源短语没有句末标点仍可明确采用", async () => {
  const phrase = "An involuntary payment";
  render(<WordLookupLayer passage={phrase}><span data-sentence-index="phrase">{phrase}</span></WordLookupLayer>);
  fireEvent.click(await analyze(phrase));
  expect(getCard("involuntary").sentence).toBe(phrase);
  expect(getCard("involuntary").def).toBe(RESPONSE.sense);
});


test("听力实际原句保留内部空白，采用义项精确绑定同一录音语境", async () => {
  const sentence = "An  involuntary payment was taken.";
  const timings = [{ text: sentence, start: 1, end: 3 }];
  render(<WordLookupLayer passage={sentence} source="listening" listeningAudio={{ audioUrl: "/api/audio/context.mp3", timings }}>
    <span data-sentence-index="0" data-sentence-playable="1">{sentence}</span>
  </WordLookupLayer>);
  fireEvent.click(await analyze(sentence));
  const card = getCard("involuntary");
  expect(card.listeningContext.text).toBe(sentence);
  expect(card.contextSenses[0].sentence).toBe(card.listeningContext.text);
  expect(definitionForContext(card, card.listeningContext.text)).toBe(RESPONSE.sense);
});


test("普通义项操作验证失败原位反馈，不要求先点AI且旧卡完整保留", async () => {
  const card = saveWord({ word: "involuntary", def: DICT, sentence: FIRST });
  const longSentence = FIRST + " Further observation".repeat(25) + " was reported.";
  render(<WordLookupLayer passage={longSentence}><span data-sentence-index="long">{longSentence}</span></WordLookupLayer>);
  await open(longSentence);
  fireEvent.click(screen.getByRole("button", { name: "无意识的" }));
  expect(screen.getByRole("alert")).toHaveTextContent("过长");
  expect(getCard("involuntary")).toEqual(card);
  expect(callAI).not.toHaveBeenCalled();
});
