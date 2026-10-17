import { getCard, saveWord, saveWordGroup, scheduleSync, setWordFamily, VOCAB_UPDATED_EVENT } from "../lib/vocab/vocabStore";
import { normalizeCard } from "../lib/vocab/book";

jest.mock("../lib/AuthContext", () => ({
  getSavedCode: () => localStorage.getItem("toefl-user-code"),
  AUTH_CHANGED_EVENT: "toefl-auth-changed",
}));
const now = new Date("2026-10-16T08:00:00Z");
const key = account => `toefl-vocab-book::${account === "guest" ? "guest" : `user:${account}`}`;
const seed = (account, cards) => localStorage.setItem(key(account), JSON.stringify({ v: 1, cards: cards.map(c => normalizeCard(c, now)) }));
const snapshot = () => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith("toefl-vocab-book")).map(k => [k, localStorage.getItem(k)]));
beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  localStorage.setItem("toefl-user-code", "BBBBBB");
  seed("BBBBBB", [{ word: "nectar", def: "B only", family: "original", reps: 7 }]);
  seed("guest", [{ word: "unrelated", def: "guest only" }]);
  global.fetch = jest.fn();
});
afterEach(() => { jest.restoreAllMocks(); jest.clearAllTimers(); jest.useRealTimers(); });

test.each(["BBBBBB", "guest"])("storage rejects stale A writes while %s is current, before migration/events/sync", target => {
  if (target === "guest") localStorage.removeItem("toefl-user-code");
  const before = snapshot(), onUpdate = jest.fn();
  window.addEventListener(VOCAB_UPDATED_EVENT, onUpdate);
  try {
    expect(saveWord({ word: "nectar", sentence: "A's sentence." }, now, "AAAAAA")).toBeNull();
    expect(setWordFamily(["nectar"], "wrong", now, "AAAAAA")).toEqual([]);
    expect(saveWordGroup([{ word: "nectarous" }], ["nectar", "nectarous"], "wrong", now, "AAAAAA")).toBeNull();
    expect(snapshot()).toEqual(before);
    expect(onUpdate).not.toHaveBeenCalled();
    jest.advanceTimersByTime(3000);
    expect(fetch).not.toHaveBeenCalled();
  } finally { window.removeEventListener(VOCAB_UPDATED_EVENT, onUpdate); }
});

test("a valid batch commits once, preserves existing progress, and never migrates guest data", () => {
  const guest = localStorage.getItem(key("guest"));
  const onUpdate = jest.fn();
  window.addEventListener(VOCAB_UPDATED_EVENT, onUpdate);
  const writes = jest.spyOn(Storage.prototype, "setItem");
  try {
    const cards = saveWordGroup([{ word: "nectarous", sentence: "A nectarous scent." }], ["nectar", "nectarous"], "nectar", now, "BBBBBB");
    expect(cards).toHaveLength(2);
    expect(cards.find(c => c.word === "nectar")).toMatchObject({ def: "B only", family: "nectar", reps: 7 });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0]).toBe(key("BBBBBB"));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(key("guest"))).toBe(guest);
    expect(getCard("unrelated", "BBBBBB")).toBeNull();
  } finally { window.removeEventListener(VOCAB_UPDATED_EVENT, onUpdate); }
});

test("an invalid later entry cancels the whole batch and leaves existing groups intact", () => {
  const before = snapshot();
  expect(saveWordGroup([{ word: "nectarous" }, { word: "" }], ["nectar", "nectarous"], "nectar", now, "BBBBBB")).toBeNull();
  expect(snapshot()).toEqual(before);
  jest.advanceTimersByTime(3000);
  expect(fetch).not.toHaveBeenCalled();
});

test("identity changes during staging cannot redirect or partially commit a group", () => {
  const before = snapshot();
  const entry = { get word() { localStorage.setItem("toefl-user-code", "CCCCCC"); return "nectarous"; } };
  expect(saveWordGroup([entry], ["nectarous"], "nectar", now, "BBBBBB")).toBeNull();
  expect(snapshot()).toEqual(before);
  jest.advanceTimersByTime(3000);
  expect(fetch).not.toHaveBeenCalled();
});

test("an account switch in a synchronous update listener cannot split the group or schedule sync for B", () => {
  localStorage.setItem("toefl-user-code", "AAAAAA");
  const beforeB = localStorage.getItem(key("BBBBBB"));
  const switchAccount = () => localStorage.setItem("toefl-user-code", "BBBBBB");
  window.addEventListener(VOCAB_UPDATED_EVENT, switchAccount);
  try {
    saveWordGroup([{ word: "nectar" }, { word: "nectarous" }], ["nectar", "nectarous"], "nectar", now, "AAAAAA");
    const a = JSON.parse(localStorage.getItem(key("AAAAAA"))).cards;
    expect(a).toHaveLength(2);
    expect(a.every(c => c.family === "nectar")).toBe(true);
    expect(localStorage.getItem(key("BBBBBB"))).toBe(beforeB);
    jest.advanceTimersByTime(3000);
    expect(fetch).not.toHaveBeenCalled();
  } finally { window.removeEventListener(VOCAB_UPDATED_EVENT, switchAccount); }
});

test("legacy saveWord and setWordFamily calls remain compatible", () => {
  expect(saveWord({ word: "legacy" }, now).word).toBe("legacy");
  expect(setWordFamily(["legacy"], "family", now)[0].family).toBe("family");
});

test("sync scheduling uses one identity snapshot even if another tab changes the stored code", () => {
  const getItem = Storage.prototype.getItem;
  let switched = false;
  jest.spyOn(Storage.prototype, "getItem").mockImplementation(function (key) {
    const value = getItem.call(this, key);
    if (key === "toefl-user-code" && !switched) {
      switched = true;
      localStorage.setItem(key, "CCCCCC");
    }
    return value;
  });
  scheduleSync(2500, "BBBBBB");
  jest.advanceTimersByTime(3000);
  expect(fetch).not.toHaveBeenCalled();
});

test("quota failure retains the complete batch in memory", () => {
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(saveWordGroup([{ word: "nectarous" }], ["nectar", "nectarous"], "nectar", now, "BBBBBB")).toHaveLength(2);
  expect(getCard("nectar", "BBBBBB").family).toBe("nectar");
  expect(getCard("nectarous", "BBBBBB").family).toBe("nectar");
});
