/**
 * 划词问 AI 推广到所有划词词典的地方（components/notes/NotedLookup）：
 * children 原样渲染（挖空原文、逐句听力原文、题干选项），笔记卡排在最后；和 NotedPassage 共用笔记存档与额度。
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

let TIER = "pro";
jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => ""),
  getSavedTier: jest.fn(() => TIER),
  AUTH_CHANGED_EVENT: "auth-changed",
}));
jest.mock("../lib/dict/lookup", () => ({
  ...jest.requireActual("../lib/dict/lookup"),
  lookupWord: jest.fn(async (w) => ({ word: w, p: "", t: "n. 测试" })),
}));
const callAI = jest.fn(async () => "意思：选项说的是蜜蜂只采一种花。 [S3]");
jest.mock("../lib/ai/client", () => ({
  ...jest.requireActual("../lib/ai/client"),
  callAI: (...args) => callAI(...args),
}));

import { NotedLookup } from "../components/notes/NotedLookup";
import { makeNote } from "../lib/notes/passageNotes";
import { loadAllNotes, NOTE_STORE_PREFIX } from "../lib/notes/noteStore";
import { questionLookupContext } from "../lib/dict/core";

const TRANSCRIPT = "Bees visit flowers to collect nectar. They carry pollen from flower to flower.";
const OPTIONS = { A: "Bees visit only one kind of flower.", B: "Bees avoid pollen." };
const CONTEXT = questionLookupContext(TRANSCRIPT, [{ options: OPTIONS }]);

const realRect = Range.prototype.getBoundingClientRect;
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 116, left: 40, right: 100, width: 60, height: 16 });
  Element.prototype.scrollIntoView = jest.fn();
});
afterAll(() => {
  Range.prototype.getBoundingClientRect = realRect;
});
beforeEach(() => {
  localStorage.clear();
  TIER = "pro";
  callAI.mockClear();
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
});

function Options() {
  return Object.entries(OPTIONS).map(([k, v]) => <div key={k} data-testid={`opt-${k}`}>{k}. {v}</div>);
}

function select(node, text) {
  const host = [...node.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.includes(text));
  const at = host.nodeValue.indexOf(text);
  const r = document.createRange();
  r.setStart(host, at);
  r.setEnd(host, at + text.length);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  fireEvent.mouseUp(node);
}

describe("划词问 AI（非整篇纯文字的地方）", () => {
  it("在选项里选几个词 → 问 AI → 笔记卡出现在选项下面，AI 看到的原文带听力原文和选项", async () => {
    render(<NotedLookup passage={CONTEXT} source="listening"><Options /></NotedLookup>);
    select(screen.getByTestId("opt-A"), "only one kind of flower");
    expect(await screen.findByTestId("note-ask-bubble")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("note-preset-meaning"));
    expect(await screen.findByTestId("note-answer")).toHaveTextContent("蜜蜂只采一种花");
    const [, message] = callAI.mock.calls[0];
    expect(message).toContain("Bees visit flowers to collect nectar.");
    expect(message).toContain('【学生选中的原文】"only one kind of flower"');
    // children 原样在，笔记卡在它们后面
    const cards = screen.getByTestId("noted-lookup-cards");
    expect(screen.getByTestId("opt-B").compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(loadAllNotes("guest")[0]).toMatchObject({ quote: "only one kind of flower", source: "listening" });
  });

  it("已有笔记默认收起，点开看回答；非 Pro 不出提问气泡", async () => {
    const note = { ...makeNote({ passage: CONTEXT, quote: "carry pollen", source: "listening" }), turns: [{ q: "q", a: "带着花粉 [S2]", at: "x" }] };
    localStorage.setItem(`${NOTE_STORE_PREFIX}:guest`, JSON.stringify({ notes: [note] }));
    TIER = "free";
    render(<NotedLookup passage={CONTEXT} source="listening"><Options /></NotedLookup>);
    expect(screen.getByTestId("note-card")).toHaveTextContent("carry pollen");
    expect(screen.queryByTestId("note-answer")).toBeNull();
    fireEvent.click(screen.getByTestId("note-card-toggle"));
    expect(screen.getByTestId("note-answer")).toHaveTextContent("带着花粉");
    select(screen.getByTestId("opt-B"), "avoid pollen");
    expect(screen.queryByTestId("note-ask-bubble")).toBeNull();
  });
});
