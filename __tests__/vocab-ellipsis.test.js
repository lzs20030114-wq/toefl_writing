import { hasUsableSense, isThinEntry, parseSenses, splitSenses } from "../lib/dict/core";
import { cardDirection, needsDictFill, normalizeCard } from "../lib/vocab/book";
import { chooseSense, getCard, saveWord } from "../lib/vocab/vocabStore";
import { STATE } from "../lib/vocab/srs";

const addresses = require("../public/dict/a.json").addresses;

beforeEach(() => localStorage.clear());

test("真实 addresses 词条的独立省略号不会成为可选义项", () => {
  const groups = splitSenses(addresses.t);
  expect(groups.flatMap((g) => g.senses)).toEqual([
    "称呼( address的名词复数 )",
    "（在信封、包裹等上）书写（收件人姓名、地址）",
    "（收件人的）姓名和地址",
  ]);
  expect(groups.flatMap((g) => g.senses)).not.toContain("…");
});

test.each(["…", "……", "...", ". . .", "⋯"])("%s 是占位符，不是释义", (ellipsis) => {
  expect(parseSenses(`n. ${ellipsis}`)).toEqual([]);
  expect(hasUsableSense(`n. ${ellipsis}`)).toBe(false);
  expect(isThinEntry({ p: "əˈdresiz", t: `n. ${ellipsis}` })).toBe(true);
});

test.each(["使…受到影响", "与…联系", "提高…价值"])("保留含省略号的真实义项：%s", (sense) => {
  expect(parseSenses(`vt. ${sense}`)[0].senses).toEqual([sense]);
});

test("旧卡用有效备份修复主释义，复习状态与听力状态原样保留", () => {
  const readingState = { state: STATE.REVIEW, reps: 8, due: "2026-10-01T00:00:00.000Z", readingUpdatedAt: "2026-09-20T00:00:00.000Z" };
  const listeningState = { state: STATE.LEARNING, reps: 2, due: "2026-09-28T08:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z" };
  const card = normalizeCard({ word: "addresses", def: "n. …", defFull: addresses.t,
    sentence: "It addresses fundamental questions.", ...readingState, listeningState });
  expect(card.def).toBe(addresses.t);
  expect(needsDictFill(card)).toBe(false);
  expect(cardDirection(card)).toBe("recall");
  expect(card).toMatchObject({ ...readingState, listeningState });
});

test("无备份的旧卡不能变成空提示拼写题，并会进入词典补全", () => {
  const card = normalizeCard({ word: "addresses", def: "n. …", state: STATE.REVIEW,
    sentence: "It addresses fundamental questions." });
  expect(card.def).toBe("");
  expect(needsDictFill(card)).toBe(true);
  expect(cardDirection(card)).toBe("context");
});

test("存储入口拒绝省略号，仍保留已有的有效手选义项", () => {
  saveWord({ word: "addresses", def: "n. 姓名和地址", defFull: addresses.t });
  const before = getCard("addresses");
  expect(chooseSense("addresses", "n. …", addresses.t)).toBeNull();
  expect(getCard("addresses")).toEqual(before);
});
