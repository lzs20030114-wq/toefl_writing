/**
 * 听力练后记录里的原文能不能点词查词典。
 *
 * 阅读复盘早就有划词词典，听力这边原文只是块死文本——精听时看到生词得自己另开词典。
 * 这里钉住三件事：
 *  1. 讲座/通知的原文、对话气泡、逐题的题干选项都能点词；
 *  2. 收藏进单词本时来源记成「听力」，并且带上原文里的那一句（挖空卡的原料）；
 *  3. 播放器和 AI 讲解块不参与查词——点播放键弹出个词典弹窗是纯干扰。
 */
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { LADetail, LCDetail, LCRDetail } from "../components/listening/ListeningProgressView";
import { getCard, saveWord } from "../lib/vocab/vocabStore";
import VocabNotebook from "../components/vocab/VocabNotebook";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: jest.fn(() => null),
  getSavedTier: jest.fn(() => "free"), // 本文件不测 AI 讲解那条路
}));

const TRANSCRIPT =
  "The seminar will focus on photosynthesis in arid climates. Please bring your lab notebook.";

const SHARDS = {
  p: { photosynthesis: { p: ",fәutәu'sinθisis", t: "n. 光合作用", g: "GRE" } },
  n: { notebook: { p: "'nәutbuk", t: "n. 笔记本", g: "cet4" } },
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

function clickIn(el) {
  fireEvent.mouseUp(el, { clientX: 60, clientY: 108 });
}

const LA_SESSION = {
  id: "s-la",
  details: {
    subtype: "lat",
    transcript: TRANSCRIPT,
    questions: [{
      stem: "What should students bring?",
      options: { A: "A notebook", B: "A camera" },
      answer: "A",
    }],
    results: [{ selected: "B", correct: "A", isCorrect: false }],
  },
};

describe("听力复盘 · 原文划词", () => {
  test("讲座原文里点词能弹出词典", async () => {
    render(<LADetail session={LA_SESSION} />);
    const host = screen.getByText(/The seminar will focus/);
    aimAt("photosynthesis");
    clickIn(host);
    expect(await screen.findByText("n. 光合作用")).toBeInTheDocument();
  });

  test("收藏时来源记成听力，并带上原文里的那一句", async () => {
    render(<LADetail session={LA_SESSION} />);
    const host = screen.getByText(/The seminar will focus/);
    aimAt("photosynthesis");
    clickIn(host);
    fireEvent.click(await screen.findByText("☆ 收藏到单词本"));

    const card = getCard("photosynthesis");
    expect(card).toBeTruthy();
    expect(card.source).toBe("listening");
    // 挖空卡要用原句：必须是原文那一句，而不是整段
    expect(card.sentence).toBe("The seminar will focus on photosynthesis in arid climates.");
  });

  test("题干和选项也能查词（词只出现在选项里时也有句可依）", async () => {
    render(<LADetail session={LA_SESSION} />);
    const host = screen.getByText(/A notebook/);
    aimAt("notebook");
    clickIn(host);
    expect(await screen.findByText("n. 笔记本")).toBeInTheDocument();
  });

  test("AI 讲解块在查词豁免区里，原文和选项不在", () => {
    render(<LADetail session={LA_SESSION} />);
    // 答错的题才挂 AI 讲解块（free tier 下它自己渲染成空，但外壳带着 data-no-dict）
    expect(document.querySelectorAll("[data-no-dict]").length).toBeGreaterThan(0);
    // 真正要能查词的那两块不能被豁免掉
    expect(screen.getByText(/The seminar will focus/).closest("[data-no-dict]")).toBeNull();
    expect(screen.getByText(/A notebook/).closest("[data-no-dict]")).toBeNull();
  });
});

describe("听力复盘 · 对话与应答", () => {
  const LC_SESSION = {
    id: "s-lc",
    details: {
      subtype: "lc",
      conversation: [
        { speaker: "Student", text: "I am reading about photosynthesis for class." },
        { speaker: "Professor", text: "Start with the chapter on arid climates." },
      ],
      questions: [{ stem: "What is the student reading about?", options: { A: "Plants" }, answer: "A" }],
      results: [{ selected: "A", correct: "A", isCorrect: true }],
    },
  };

  test("对话气泡里也能点词", async () => {
    render(<LCDetail session={LC_SESSION} />);
    const host = screen.getByText(/I am reading about photosynthesis/);
    aimAt("photosynthesis");
    clickIn(host);
    expect(await screen.findByText("n. 光合作用")).toBeInTheDocument();
  });

  test("应答题的刺激句能点词，播放器不参与查词", async () => {
    const LCR_SESSION = {
      id: "s-lcr",
      details: {
        subtype: "lcr",
        results: [{ selected: "A", correct: "C", isCorrect: false }],
        items: [{
          id: "lcr-1",
          speaker: "Did you finish the photosynthesis lab?",
          options: { A: "I already left.", C: "Almost done." },
          answer: "C",
        }],
      },
    };
    render(<LCRDetail session={LCR_SESSION} />);
    const host = screen.getByText(/Did you finish the photosynthesis lab/);
    aimAt("photosynthesis");
    clickIn(host);
    expect(await screen.findByText("n. 光合作用")).toBeInTheDocument();

    // 播放键必须落在豁免区里：点播放还弹出个词典是纯干扰
    expect(screen.getByText("Replay").closest("[data-no-dict]")).toBeTruthy();
    // 刺激句本身不在豁免区（否则就查不了词了）
    expect(host.closest("[data-no-dict]")).toBeNull();
  });
});

describe("单词本列表 · 发音钮", () => {
  test("每个词条都有一个能念的按钮", async () => {
    // 这里只验列表页挂上了按钮且真的调了朗读；发音本身的行为在 dict-speak-word.test.js 里钉
    const spoken = [];
    window.speechSynthesis = {
      cancel() {}, speak: (u) => spoken.push(u.text),
      getVoices: () => [{ name: "Samantha", lang: "en-US" }],
      addEventListener() {}, removeEventListener() {},
    };
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };

    saveWord({
      word: "photosynthesis", display: "photosynthesis", phonetic: ",f\u0259ut\u0259u'sin\u03b8isis",
      def: "n. 光合作用", source: "listening",
    });
    render(<VocabNotebook />);
    const btns = await screen.findAllByLabelText("朗读这个词");
    expect(btns.length).toBeGreaterThan(0);
    fireEvent.click(btns[0]);
    expect(spoken).toContain("photosynthesis");

    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
  });
});
