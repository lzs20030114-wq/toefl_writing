import { loadBook, saveWord, setWordProductive } from "../lib/vocab/vocabStore";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: () => "",
  AUTH_CHANGED_EVENT: "auth-changed",
}));

beforeEach(() => localStorage.clear());

test("逐词剔除会写要求会落到本地卡片，重新读取仍有效", () => {
  saveWord({ word: "Cell", def: "细胞", source: "reading" });
  expect(loadBook()[0].productive).toBe(true);

  const excluded = setWordProductive("cell", false);
  expect(excluded.productive).toBe(false);
  expect(loadBook()[0].productive).toBe(false);
  expect(loadBook()[0].state).toBe(excluded.state);

  setWordProductive("cell", true);
  expect(loadBook()[0].productive).toBe(true);
});

test("找不到的词不创建卡片", () => {
  expect(setWordProductive("missing", false)).toBeNull();
  expect(loadBook()).toEqual([]);
});
