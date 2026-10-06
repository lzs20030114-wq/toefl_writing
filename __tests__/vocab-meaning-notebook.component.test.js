import { act, fireEvent, render, screen } from "@testing-library/react";
import VocabNotebook from "../components/vocab/VocabNotebook";
import { getCard } from "../lib/vocab/vocabStore";
import { writeReviewSave, readReviewSave } from "../lib/vocab/reviewSave";
import { STATE } from "../lib/vocab/srs";

jest.mock("../lib/AuthContext", () => ({ getSavedCode: () => null, AUTH_CHANGED_EVENT: "auth-changed" }));
jest.mock("../components/vocab/RootExplorer", () => () => null);
jest.mock("../components/shared/SpeakButton", () => ({ SpeakButton: () => null }));
let mockStart, mockReview;
jest.mock("../components/vocab/MeaningExplorer", () => (props) => {
  mockStart = props.onStudyGroup;
  return <button onClick={() => props.onStudyGroup({ words: ["alpha", "heard", "paused", "deleted", "ALPHA", "missing"], mode: "reading", account: props.accountKey, query: "妨碍" })}>练整组</button>;
});
function mockReviewPanel(props) {
  mockReview = props;
  return <div>
    <span>{props.initialQueue.map((card) => `${card.word}:${card.reps}`).join(",")}</span>
    <button onClick={() => props.onGrade(props.initialQueue[0].word, 3, 100)}>评分</button>
    <button onClick={() => props.onUndo(props.initialQueue[0].word)}>撤销</button>
    <button onClick={props.onExit}>退出组</button>
  </div>;
}
jest.mock("../components/vocab/VocabReview", () => ({ VocabReview: (props) => mockReviewPanel(props) }));
jest.mock("../components/vocab/ListeningVocabReview", () => ({ ListeningVocabReview: (props) => mockReviewPanel(props) }));

beforeEach(() => {
  localStorage.clear(); mockReview = null;
  const now = new Date().toISOString();
  const card = (word, extra = {}) => ({ word, def: "n. 释义", state: STATE.REVIEW, reps: 5, stability: 10, difficulty: 5, scheduledDays: 10, due: new Date(Date.now() + 86400000).toISOString(), lastReview: new Date(Date.now() - 86400000).toISOString(), updatedAt: now, readingUpdatedAt: now, ...extra });
  localStorage.setItem("toefl-vocab-book::guest", JSON.stringify({ v: 1, cards: [card("alpha"), card("heard", { reviewMode: "listening", listeningState: { state: STATE.REVIEW, reps: 8, stability: 20, difficulty: 5, scheduledDays: 20, due: now, lastReview: now, updatedAt: now } }), card("paused", { suspended: true }), card("deleted", { deletedAt: now })] }));
});

test("指定组去重并排除暂停、删除、缺失词，允许未到期词，保留原复习类型", () => {
  render(<VocabNotebook embedded />);
  let result;
  act(() => { result = mockStart({ words: ["alpha", "heard", "paused", "deleted", "ALPHA", "missing"], mode: "reading", account: "guest", query: "妨碍" }); });
  expect(result).toEqual({ started: true, count: 2, skipped: 3 });
  expect(screen.getByText("alpha:5,heard:5")).toBeVisible();
  expect(getCard("heard").reviewMode).toBe("listening");
  expect(mockReview.onCheckpoint).toBeUndefined(); expect(mockReview.onFinish).toBeUndefined();
});

test("听力组投影独立轨道，评分撤销保留阅读进度且不污染日常断点", () => {
  writeReviewSave("guest", "listening", { words: ["heard"], answered: 2 });
  const beforeSave = readReviewSave("guest", "listening");
  render(<VocabNotebook embedded />);
  const beforeCard = getCard("heard");
  act(() => { mockStart({ words: ["heard"], mode: "listening", account: "guest", query: "妨碍" }); });
  expect(screen.getByText("heard:8")).toBeVisible();
  fireEvent.click(screen.getByText("评分"));
  expect(getCard("heard").reps).toBe(beforeCard.reps);
  expect(getCard("heard").listeningState.reps).toBe(9);
  fireEvent.click(screen.getByText("撤销"));
  expect(getCard("heard").listeningState.reps).toBe(8);
  expect(getCard("heard").reviewMode).toBe("listening");
  fireEvent.click(screen.getByText("退出组"));
  expect(readReviewSave("guest", "listening")).toEqual(beforeSave);
});

test("旧账号回调拒绝启动且没有写入新账号", () => {
  render(<VocabNotebook embedded />);
  localStorage.setItem("toefl-user-code", "TESTAA");
  let result;
  act(() => { result = mockStart({ words: ["alpha"], account: "guest", mode: "reading", query: "妨碍" }); });
  expect(result.started).toBe(false); expect(mockReview).toBeNull();
  expect(localStorage.getItem("toefl-vocab-book::user:TESTAA")).toBeNull();
});
