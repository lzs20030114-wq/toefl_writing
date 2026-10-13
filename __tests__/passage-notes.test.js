/**
 * 原文批注提问的纯函数层：文章签名、选区定位、分段高亮、合并 / 封顶、入库校验、提示词拼装。
 */
import {
  passageKey, isPhrase, presetsFor, locateQuote, paragraphSpans, placeNotes,
  highlightSegments, notesByParagraph, makeNote, mergeNotes, capNotes, NOTE_PRESETS,
} from "../lib/notes/passageNotes";
import { toNoteRow, NOTE_MAX_BYTES } from "../lib/notes/noteRow";
import { buildNoteMessage, dictTermOfQuote, sentencesOfQuote, NOTE_SYSTEM } from "../lib/notes/noteQa";
import { numberSentences } from "../lib/qa/questionQa";

const PASSAGE =
  "Bees and Flowers\n\n" +
  "Bees visit flowers to collect nectar. In doing so, they carry pollen from one flower to another.\n\n" +
  "Some flowers attract only one kind of bee. Such flowers depend on that bee, and the bee depends on them.";

describe("passageKey", () => {
  it("只看文字，不看空白排版：补过分段的同一篇认得出来", () => {
    expect(passageKey(PASSAGE)).toBe(passageKey(PASSAGE.replace(/\n\n/g, " ")));
    expect(passageKey(PASSAGE)).toMatch(/^p[a-z0-9]+-[a-z0-9]+$/);
    expect(passageKey("")).toBe("");
    expect(passageKey(PASSAGE)).not.toBe(passageKey(PASSAGE + " Extra."));
  });
});

describe("短语 / 句子与快捷问题", () => {
  it("≤6 词按短语，更长按句子", () => {
    expect(isPhrase("depends on")).toBe(true);
    expect(isPhrase("In doing so, they carry pollen from one flower")).toBe(false);
    expect(presetsFor("nectar")).toBe(NOTE_PRESETS.phrase);
    expect(presetsFor("Bees visit flowers to collect nectar today now")).toBe(NOTE_PRESETS.sentence);
  });
});

describe("locateQuote", () => {
  it("唯一命中直接给位置", () => {
    const loc = locateQuote(PASSAGE, "collect nectar");
    expect(PASSAGE.slice(loc.start, loc.end)).toBe("collect nectar");
  });
  it("跨段选区：浏览器给的空白和原文不一致也找得到", () => {
    const loc = locateQuote(PASSAGE, "to another. Some flowers");
    expect(PASSAGE.slice(loc.start, loc.end)).toBe("to another.\n\nSome flowers");
  });
  it("多处命中：落在选区那句里的优先，其次离 hint 最近的", () => {
    const second = PASSAGE.indexOf("depends on them");
    expect(locateQuote(PASSAGE, "depends on", { sentenceText: "Such flowers depend on that bee, and the bee depends on them." }).start)
      .toBe(PASSAGE.indexOf("depends on"));
    const bee = [...PASSAGE.matchAll(/bee\b/g)].map((m) => m.index);
    expect(locateQuote(PASSAGE, "bee", { hint: bee[1] - 2 }).start).toBe(bee[1]);
    expect(second).toBeGreaterThan(0);
  });
  it("原文改过、找不到就返回 null", () => {
    expect(locateQuote(PASSAGE, "butterflies")).toBeNull();
  });
});

describe("分段与高亮", () => {
  it("paragraphSpans 的起点能切回原文", () => {
    const paras = paragraphSpans(PASSAGE);
    expect(paras).toHaveLength(3);
    paras.forEach((p) => expect(PASSAGE.slice(p.start, p.end)).toBe(p.text));
  });

  it("placeNotes 按出现顺序编号，找不到的排最后，已删的不出", () => {
    const a = { id: "na", quote: "Such flowers", createdAt: "2026-10-13T01:00:00Z" };
    const b = { id: "nb", quote: "collect nectar", createdAt: "2026-10-13T02:00:00Z" };
    const c = { id: "nc", quote: "not in passage", createdAt: "2026-10-13T00:00:00Z" };
    const d = { id: "nd", quote: "Bees", createdAt: "2026-10-13T00:00:00Z", deletedAt: "x" };
    const placed = placeNotes(PASSAGE, [a, b, c, d]);
    expect(placed.map((p) => [p.note.id, p.index])).toEqual([["nb", 1], ["na", 2], ["nc", 3]]);
    expect(placed[2].start).toBeNull();
  });

  it("highlightSegments 处理重叠高亮，序号挂在各自结尾", () => {
    const text = "Bees visit flowers to collect nectar.";
    const placed = [
      { start: 5, end: 18, index: 1 }, // visit flowers
      { start: 11, end: 36, index: 2 }, // flowers to collect nectar
    ];
    const segs = highlightSegments(text, 0, placed);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.find((s) => s.text === "flowers")).toMatchObject({ marks: [1, 2], endsNote: [1] });
    expect(segs.find((s) => s.text === " to collect nectar")).toMatchObject({ marks: [2], endsNote: [2] });
    expect(segs[0]).toMatchObject({ text: "Bees ", marks: [] });
  });

  it("笔记卡挂在高亮结尾所在的段；找不到位置的挂最后一段", () => {
    const paras = paragraphSpans(PASSAGE);
    const placed = placeNotes(PASSAGE, [
      { id: "n1", quote: "to another. Some flowers" },
      { id: "n2", quote: "nowhere" },
    ]);
    const by = notesByParagraph(paras, placed);
    expect(by.get(2).map((p) => p.note.id)).toEqual(["n1", "n2"]);
  });
});

describe("合并与封顶", () => {
  it("updatedAt 新的赢，删除也同步", () => {
    const old = { id: "n1", quote: "x", updatedAt: "2026-10-13T01:00:00Z" };
    const del = { ...old, deletedAt: "2026-10-13T02:00:00Z", updatedAt: "2026-10-13T02:00:00Z" };
    expect(mergeNotes([old], [del])).toEqual([del]);
    expect(mergeNotes([del], [old])).toEqual([del]);
  });
  it("超量时先丢已删的，再丢最旧的", () => {
    const list = [
      { id: "a", updatedAt: "2026-10-01" },
      { id: "b", updatedAt: "2026-10-02", deletedAt: "2026-10-02" },
      { id: "c", updatedAt: "2026-10-03" },
    ];
    expect(capNotes(list, 2).map((n) => n.id).sort()).toEqual(["a", "c"]);
    expect(capNotes(list, 1).map((n) => n.id)).toEqual(["c"]);
  });
  it("makeNote 带文章签名、截断超长选区", () => {
    const n = makeNote({ passage: PASSAGE, quote: "x".repeat(900) });
    expect(n.passageKey).toBe(passageKey(PASSAGE));
    expect(n.quote).toHaveLength(600);
    expect(n.id).toMatch(/^n[a-z0-9]{6,24}$/);
  });
});

describe("toNoteRow（入库校验）", () => {
  const good = makeNote({ passage: PASSAGE, quote: "nectar" });
  it("合法笔记转成行", () => {
    const { row, error } = toNoteRow("ABC", good);
    expect(error).toBeUndefined();
    expect(row).toMatchObject({ user_code: "ABC", note_id: good.id, passage_key: good.passageKey });
  });
  it("拒绝坏 id、坏签名、超大笔记", () => {
    expect(toNoteRow("ABC", { ...good, id: "../x" }).error).toBeTruthy();
    expect(toNoteRow("ABC", { ...good, passageKey: "zzz" }).error).toBeTruthy();
    const huge = { ...good, turns: [{ q: "q", a: "a".repeat(NOTE_MAX_BYTES) }] };
    expect(toNoteRow("ABC", huge).error).toBeTruthy();
  });
});

describe("noteQa 提示词", () => {
  it("message 带编号原文、选中处所在句、词典与历史", () => {
    const { message, sentences } = buildNoteMessage({
      passage: PASSAGE,
      quote: "collect nectar",
      history: [{ q: "什么意思", a: "采花蜜 [S2]" }],
      question: "列出所有词形",
      dict: { word: "collect", p: "kə'lekt", t: "v. 收集\nn. 募捐" },
    });
    expect(sentences.length).toBeGreaterThan(3);
    expect(message).toContain("【原文】");
    expect(message).toMatch(/【学生选中的原文】"collect nectar"（在 S2）/);
    expect(message).toContain("【词典】（ECDICT）collect /kə'lekt/：v. 收集；n. 募捐");
    expect(message).toContain("学生1：什么意思");
    expect(message.trim().endsWith("【学生现在的问题】列出所有词形")).toBe(true);
    expect(NOTE_SYSTEM).toContain("格式 [S3]");
    expect(NOTE_SYSTEM).not.toContain("非本题材料");
    // 只问意思不写「为什么」（2026-10-13 用户要求）：快捷问题不夹带「为什么」，提示词写明只答问到的。
    const meaning = NOTE_PRESETS.phrase.find((p) => p.id === "meaning");
    expect(meaning.text).not.toContain("为什么");
    expect(NOTE_SYSTEM).toContain("只答学生问到的");
  });
  it("跨句选区落在两句", () => {
    const sentences = numberSentences(PASSAGE);
    const ids = sentencesOfQuote(sentences, "to another. Some flowers attract");
    expect(ids.length).toBe(2);
  });
  it("只有单个英文词才查词典", () => {
    expect(dictTermOfQuote(" Nectar ")).toBe("nectar");
    expect(dictTermOfQuote("depends on")).toBeNull();
  });
});

describe("tidyNoteSegments（笔记回答的显示整理）", () => {
  const { tidyNoteSegments } = require("../lib/notes/noteQa");
  const { parseAnswer, sentenceLabel } = require("../lib/qa/questionQa");
  const sentences = numberSentences(PASSAGE);
  const tidy = (text) => tidyNoteSegments(parseAnswer(text, sentences, []), sentences, (s) => sentenceLabel(s, sentences));

  it("同一句的出处只留第一次，核不上的照留", () => {
    const segs = tidy("意思是采蜜 [S2]。中心词是 nectar [S2]。另见 [S2]，还有 [S99]。");
    const cites = segs.filter((s) => s.type === "cite");
    expect(cites.filter((c) => c.id === "S2")).toHaveLength(1);
    expect(cites.some((c) => c.id === "S99" && !c.valid)).toBe(true);
  });

  it("正文里漏出的 S 编号换成段句写法，「（非本题材料）」换成「补充：」", () => {
    const text = tidy("S2 讲的是采蜜。（非本题材料）collect 还可以作名词。").filter((s) => s.type === "text").map((s) => s.text).join("");
    expect(text).toContain("第 1 段第 1 句 讲的是采蜜");
    expect(text).not.toMatch(/\bS2\b/);
    expect(text).toContain("补充：collect");
    expect(text).not.toContain("非本题材料");
  });

  it("换行拆段，行首小标题单独拿出来", () => {
    const segs = tidy("意思：蜜蜂去采花蜜 [S2]。\n\n语法：to collect 是目的状语。");
    expect(segs.map((s) => s.type)).toEqual(["heading", "text", "cite", "text", "break", "heading", "text"]);
    expect(segs[0].text).toBe("意思");
    expect(segs[5].text).toBe("语法");
  });
});

import { splitWordForms, parseFormLine, formVocabEntry, exampleHasForm } from "../lib/notes/wordForms";

describe("词形表", () => {
  it("拆出词形段：表前表后文字保留，同词去重，坏行跳过", () => {
    const text = "词条：analysis 是名词。\n[词形]\n- analysis｜n.｜分析｜原词｜Further analysis is needed.\nanalyses｜n.｜分析（复数）｜复数｜\nanalyze | v. | 分析 | 动词 | Engineers analyze the signal.\nAnalysis｜n.｜重复\n这一行不是词形\n[/词形]\n补充：analyse 是英式拼写。";
    const r = splitWordForms(text);
    expect(r.before).toBe("词条：analysis 是名词。");
    expect(r.after).toBe("补充：analyse 是英式拼写。");
    expect(r.forms.map((f) => f.word)).toEqual(["analysis", "analyses", "analyze"]);
    expect(r.forms[2]).toEqual({ word: "analyze", pos: "v.", zh: "分析", note: "动词", example: "Engineers analyze the signal." });
    expect(r.forms[1].example).toBe("");
  });

  it("没有词形段、或段里没有能用的行，就按普通回答显示", () => {
    expect(splitWordForms("意思：花蜜。")).toBeNull();
    expect(splitWordForms("[词形]\n没有内容\n[/词形]")).toBeNull();
    expect(parseFormLine("只有中文｜n.")).toBeNull();
  });

  it("缺了结束标记也能拆（回答被截断时）", () => {
    const r = splitWordForms("[词形]\nnectar｜n.｜花蜜｜原词｜Bees collect nectar.");
    expect(r.forms).toHaveLength(1);
    expect(r.after).toBe("");
  });

  it("收藏 entry：释义带词性并锁定；例句含这个词形才当语境句；音标只取同一个词的", () => {
    const e = formVocabEntry({ word: "Analyzed", pos: "v.", zh: "分析（过去式）", example: "They analyzed it." }, { dict: { word: "analyze", p: "x" } });
    expect(e).toMatchObject({ word: "analyzed", display: "Analyzed", def: "v. 分析（过去式）", definitionLocked: true, sentence: "They analyzed it.", phonetic: "", source: "passage-note" });
    expect(formVocabEntry({ word: "analysis", pos: "n.", zh: "分析", example: "An analyst works." }).sentence).toBe("");
    expect(exampleHasForm("Data analysis matters.", "analysis")).toBe(true);
    expect(exampleHasForm("Data analyses matter.", "analysis")).toBe(false);
  });

  it("提示词要求列词形时用词形表", () => {
    expect(NOTE_SYSTEM).toContain("[词形]");
    expect(NOTE_PRESETS.phrase.find((p) => p.id === "forms").text).toContain("词形表");
  });
});

