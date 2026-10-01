import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListeningMCQTask } from "../components/listening/ListeningMCQTask";
import { LCRTask } from "../components/listening/LCRTask";
import { getCard } from "../lib/vocab/vocabStore";

jest.mock("../lib/AuthContext", () => ({ getSavedCode: () => null, getSavedTier: () => "free" }));
jest.mock("../components/listening/AudioPlayer", () => ({
  AudioPlayer: require("react").forwardRef(() => <button>Replay audio</button>),
}));

const realFetch = global.fetch;
const realCaret = document.caretRangeFromPoint;
const realRect = Range.prototype.getBoundingClientRect;
beforeAll(() => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({
    notebook: { p: "", t: "n. 笔记本", g: "cet4" },
    seminar: { p: "", t: "n. 研讨会", g: "cet4" },
    camera: { p: "", t: "n. 相机", g: "cet4" },
  }) }));
  Range.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 116, left: 40, right: 100, width: 60, height: 16 });
});
afterAll(() => {
  global.fetch = realFetch;
  document.caretRangeFromPoint = realCaret;
  Range.prototype.getBoundingClientRect = realRect;
});
beforeEach(() => localStorage.clear());

async function collect(host, word) {
  document.caretRangeFromPoint = () => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const offset = node.textContent.indexOf(word);
      if (offset < 0) continue;
      const range = document.createRange();
      range.setStart(node, offset + 2);
      range.collapse(true);
      return range;
    }
    return null;
  };
  fireEvent.mouseUp(host, { clientX: 60, clientY: 108 });
  fireEvent.click(await screen.findByText("☆ 收藏到单词本"));
  return getCard(word);
}

const question = { stem: "What should students bring to the seminar?", options: { A: "A notebook", B: "A camera" }, answer: "A", explanation: "A camera is unnecessary." };
function finishMCQ(isPractice = true) {
  render(<ListeningMCQTask item={{ id: "result-dict", transcript: "Bring your notebook to the seminar.", audio_url: "/example.mp3", questions: [question] }} taskType="la" isPractice={isPractice} />);
  fireEvent.click(screen.getByRole("button", { name: /ready to answer|开始答题/i }));
  fireEvent.click(screen.getByText("A notebook"));
  fireEvent.click(screen.getByRole("button", { name: "提交" }));
}

test("MCQ答题中不接词典，交卷后题干收藏保留纯题干原句", async () => {
  render(<ListeningMCQTask item={{ id: "no-dict-before", questions: [question] }} taskType="la" isPractice />);
  fireEvent.click(screen.getByRole("button", { name: /ready to answer/i }));
  expect(screen.getByText(/What should students/).closest("[data-sentence-index]")).toBeNull();
  fireEvent.click(screen.getByText("A notebook"));
  fireEvent.click(screen.getByRole("button", { name: "提交" }));
  const card = await collect(screen.getByText(question.stem), "seminar");
  expect(card.source).toBe("listening");
  expect(card.sentence).toBe(question.stem);
  expect(card.listeningContext).toBeFalsy();
});

test("MCQ考试态结果仍不展示原文；选项和静态解析能收藏且不夹带标签/录音", async () => {
  finishMCQ(false);
  expect(screen.queryByText("Bring your notebook to the seminar.")).not.toBeInTheDocument();
  const option = await collect(screen.getByText("A notebook"), "notebook");
  expect(option.sentence).toBe("A notebook");
  expect(option.listeningContext).toBeFalsy();
  fireEvent.mouseDown(document.body);
  const explanation = await collect(screen.getByText(question.explanation), "camera");
  expect(explanation.sentence).toBe(question.explanation);
  expect(explanation.source).toBe("listening");
});

test("LCR交卷展开原句和选项可收藏；题面音频与选项语境分开", async () => {
  const item = { id: "lcr-result-dict", speaker: "Please bring your notebook.", options: question.options, answer: "A", explanation: question.explanation, audio_url: "/api/audio/lcr.mp3", sentence_timings: [{ text: "Please bring your notebook.", start: 0, end: 2 }] };
  render(<LCRTask item={item} isPractice />);
  fireEvent.click(screen.getByRole("button", { name: /show options/i }));
  fireEvent.click(screen.getByText("A notebook"));
  fireEvent.click(screen.getByRole("button", { name: /submit/i }));
  fireEvent.click(screen.getByRole("button", { name: /Q1/ }));
  const card = await collect(document.querySelector('[data-sentence-index="0"]'), "notebook");
  expect(card.source).toBe("listening");
  expect(card.sentence).toBe(item.speaker);
  expect(card.listeningContext).toEqual({ audioUrl: "/api/audio/lcr.mp3", text: item.speaker, start: 0, end: 2 });
  expect(screen.getByRole("button", { name: "Replay audio" }).closest("[data-no-dict]")).toBeTruthy();
});
