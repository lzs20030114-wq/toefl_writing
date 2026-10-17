import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WordFormList } from "../components/notes/WordFormList";
import { normalizeCard } from "../lib/vocab/book";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: () => localStorage.getItem("toefl-user-code"),
  AUTH_CHANGED_EVENT: "toefl-auth-changed",
}));
jest.mock("../lib/dict/lookup", () => ({ lookupWord: jest.fn() }));
const { lookupWord } = require("../lib/dict/lookup");

const forms = [
  { word: "nectar", pos: "n.", zh: "花蜜", example: "Bees collect nectar." },
  { word: "nectarous", pos: "adj.", zh: "甜的", example: "A nectarous scent." },
];
const key = account => `toefl-vocab-book::${account === "guest" ? "guest" : `user:${account}`}`;
const read = account => localStorage.getItem(key(account));
function identity(account, event = "auth") {
  const oldValue = localStorage.getItem("toefl-user-code");
  if (account === "guest") localStorage.removeItem("toefl-user-code");
  else localStorage.setItem("toefl-user-code", account);
  if (event === "auth") window.dispatchEvent(new Event("toefl-auth-changed"));
  if (event === "storage") window.dispatchEvent(new StorageEvent("storage", {
    key: "toefl-user-code", oldValue, newValue: account === "guest" ? null : account,
    storageArea: localStorage,
  }));
}
let resolveLookup;
beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  identity("AAAAAA");
  lookupWord.mockReset();
  const pending = new Promise(resolve => { resolveLookup = resolve; });
  lookupWord.mockImplementation(() => pending);
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, cards: [] }) }));
});
afterEach(() => { cleanup(); jest.clearAllTimers(); jest.useRealTimers(); });
async function finish() {
  await act(async () => { resolveLookup(null); });
  await act(async () => { jest.advanceTimersByTime(3000); });
}

describe.each(["single", "group"])("delayed %s word-form save", mode => {
  const click = () => fireEvent.click(screen.getByTestId(mode === "group" ? "word-forms-save-group" : "word-form-save-nectar"));
  test.each([
    ["BBBBBB", "auth"], ["guest", "auth"], ["BBBBBB", "storage"],
    ["guest", "storage"], ["BBBBBB", "none"],
  ])("cancels A → %s (%s) without writes or sync", async (target, event) => {
    localStorage.setItem(key("BBBBBB"), JSON.stringify({ v: 1, cards: [normalizeCard({
      word: "nectarous", def: "B's definition", sentence: "B's sentence.", family: "original", reps: 7,
    })] }));
    const beforeB = read("BBBBBB");
    render(<WordFormList forms={forms} quote="nectar" grouping />);
    click();
    expect(lookupWord).toHaveBeenCalled();
    act(() => identity(target, event));
    await finish();
    expect(read("AAAAAA")).toBeNull();
    expect(read("guest")).toBeNull();
    expect(read("BBBBBB")).toBe(beforeB);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("word-form-save-nectar")).not.toHaveTextContent("已收藏");
  });
  test.each(["auth", "storage"])("cancels A → guest → A (%s)", async event => {
    render(<WordFormList forms={forms} quote="nectar" grouping />);
    click();
    act(() => { identity("guest", event); identity("AAAAAA", event); });
    await finish();
    expect(read("AAAAAA")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test("unmount cancels pending lookup", async () => {
    const view = render(<WordFormList forms={forms} quote="nectar" grouping />);
    click();
    view.unmount();
    await finish();
    expect(read("AAAAAA")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test("queued cross-tab A → B → A events invalidate the original operation", async () => {
    render(<WordFormList forms={forms} quote="nectar" grouping />);
    click();
    act(() => {
      identity("BBBBBB", "none");
      identity("AAAAAA", "none");
      window.dispatchEvent(new StorageEvent("storage", {
        key: "toefl-user-code", oldValue: "AAAAAA", newValue: "BBBBBB", storageArea: localStorage,
      }));
    });
    await finish();
    expect(read("AAAAAA")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test("same-account lookup succeeds and syncs only that account", async () => {
    render(<WordFormList forms={forms} quote="nectar" grouping />);
    click();
    // A tier refresh isn't an account change.
    act(() => window.dispatchEvent(new Event("toefl-auth-changed")));
    await finish();
    expect(screen.getByTestId("word-form-save-nectar")).toHaveTextContent("已收藏");
    const cards = JSON.parse(read("AAAAAA")).cards;
    expect(cards).toHaveLength(mode === "group" ? 2 : 1);
    expect(cards.find(c => c.word === "nectar")).toMatchObject({
      sentence: "Bees collect nectar.", def: "n. 花蜜", family: "nectar",
    });
    const posts = global.fetch.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(posts.length).toBeGreaterThan(0);
    for (const [, options] of posts) expect(JSON.parse(options.body).code).toBe("AAAAAA");
    expect(read("BBBBBB")).toBeNull();
    expect(read("guest")).toBeNull();
  });
});

test("old A completion cannot clear B's newer pending operation", async () => {
  let resolveB;
  render(<WordFormList forms={forms} quote="nectar" grouping />);
  fireEvent.click(screen.getByTestId("word-form-save-nectar"));
  act(() => identity("BBBBBB"));
  lookupWord.mockImplementation(() => new Promise(resolve => { resolveB = resolve; }));
  fireEvent.click(screen.getByTestId("word-form-save-nectar"));
  await act(async () => resolveLookup(null));
  expect(screen.getByTestId("word-form-save-nectar")).toHaveTextContent("收藏中");
  expect(read("AAAAAA")).toBeNull();
  expect(read("BBBBBB")).toBeNull();
  await act(async () => resolveB(null));
  expect(screen.getByTestId("word-form-save-nectar")).toHaveTextContent("已收藏");
  expect(JSON.parse(read("BBBBBB")).cards).toHaveLength(1);
});

test("same-account group preserves existing definition, sentence and SRS while regrouping", async () => {
  localStorage.setItem(key("AAAAAA"), JSON.stringify({ v: 1, cards: [normalizeCard({
    word: "nectarous", def: "original definition", sentence: "Original sentence.", family: "old", reps: 7,
  })] }));
  render(<WordFormList forms={forms} quote="nectar" grouping />);
  fireEvent.click(screen.getByTestId("word-forms-save-group"));
  expect(lookupWord).toHaveBeenCalledTimes(1);
  await act(async () => resolveLookup(null));
  expect(JSON.parse(read("AAAAAA")).cards.find(c => c.word === "nectarous")).toMatchObject({
    def: "original definition", sentence: "Original sentence.", family: "nectar", reps: 7,
  });
  expect(screen.getByTestId("word-forms-save-group")).toHaveTextContent("已成组");
});
