import { loadBook, saveWord, setProductive } from "../lib/vocab/vocabStore";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: () => "",
  AUTH_CHANGED_EVENT: "auth-changed",
}));

beforeEach(() => localStorage.clear());

test("新词默认要会写，逐词剔除后重新读取仍有效", () => {
  saveWord({ word: "Cell", def: "细胞", source: "reading" });
  expect(loadBook()[0].productive).toBe(true);

  const excluded = setProductive("cell", false);
  expect(excluded.productive).toBe(false);
  expect(excluded.spellingOptOut).toBe(true);
  expect(loadBook()[0].productive).toBe(false);
  expect(loadBook()[0].state).toBe(excluded.state);

  setProductive("cell", true);
  expect(loadBook()[0].productive).toBe(true);
  expect(loadBook()[0].spellingOptOut).toBe(false);
});

test("旧卡存过的默认 false 自动视为要会写", () => {
  localStorage.setItem("toefl-vocab-book::guest", JSON.stringify({
    v: 1,
    cards: [{ word: "old", source: "writing", productive: false }],
  }));
  expect(loadBook()[0].productive).toBe(true);
});
