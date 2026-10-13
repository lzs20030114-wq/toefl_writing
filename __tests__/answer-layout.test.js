import { answerLines, answerBlocks } from "../lib/qa/answerLayout";
import { parseAnswer, numberSentences, tidyCites } from "../lib/qa/questionQa";
import { tidyNoteSegments } from "../lib/notes/noteQa";
import { splitCollocations } from "../lib/notes/collocations";
import { formatFor, NOTE_FORMATS, QA_FORMATS } from "../lib/qa/answerFormats";
import { buildQaMessage } from "../lib/qa/questionQa";
import { buildNoteMessage, NOTE_SYSTEM } from "../lib/notes/noteQa";
import { NOTE_PRESETS } from "../lib/notes/passageNotes";
import { QA_PRESETS, QA_SYSTEM, EXPLAIN_SYSTEM, EXPLAIN_SYSTEM_CORRECT } from "../lib/qa/questionQa";

const PASSAGE = "Bats hunt at night. Each species calls at a different frequency, which helps it avoid confusion. This allows many species to share one cave.";
const sentences = numberSentences(PASSAGE);
const blocksOf = (text) => answerBlocks(tidyCites(parseAnswer(text, sentences), sentences));
const plain = (segs) => segs.map((s) => s.text || s.id).join("");

describe("answerBlocks：小标题 + 分条", () => {
  test("拆解这句：主干一行，修饰下面逐条，意思一行", () => {
    const { structured, blocks } = blocksOf(
      "主干：Each species calls — 每个物种发出叫声\n修饰：\n\"at a different frequency\" → 修饰 calls，说明用什么频率\n\"which helps it avoid confusion\" [S2] → 补充说明前面整件事\n意思：每个物种用不同的频率叫，这样就不会混淆。",
    );
    expect(structured).toBe(true);
    expect(blocks.map((b) => b.label)).toEqual(["主干", "修饰", "意思"]);
    expect(blocks[1].lines).toHaveLength(2);
    expect(blocks[1].lines[1].some((s) => s.type === "cite" && s.id === "S2")).toBe(true);
  });

  test("没有小标题：structured=false（界面照原来整段显示）", () => {
    expect(blocksOf("原文说 \"different frequency\" [S2]，意思是不同的频率。").structured).toBe(false);
  });

  test("隔着空行的普通段落另起一块，不并进上一个小标题", () => {
    const { blocks } = blocksOf("意思：不同的频率。\n\n这是一个形容词加名词的搭配。");
    expect(blocks.map((b) => b.label)).toEqual(["意思", null]);
  });

  test("行首的列表符号去掉；行尾空白不留", () => {
    const { blocks } = blocksOf("正确思路：\n1. 先找题干关键词  \n- 再回原文定位");
    expect(blocks[0].lines.map(plain)).toEqual(["先找题干关键词", "再回原文定位"]);
  });

  test("举一反三：[题N] 开头的行自成一块，做对 / 做错单独拿出来", () => {
    const segs = tidyCites(parseAnswer("本题：先定位关键词。\n[题1] 做错：当时把推测当成了原文的话。\n[题2] 做对：同样先找关键词。\n规律：先定位再比对。", sentences, [], { past: 2 }), sentences);
    const { blocks } = answerBlocks(segs);
    expect(blocks.map((b) => (typeof b.label === "string" ? b.label : b.label.id))).toEqual(["本题", "题1", "题2", "规律"]);
    expect(blocks[1].verdict).toBe("做错");
    expect(plain(blocks[1].lines[0])).toBe("当时把推测当成了原文的话。");
    expect(blocks[2].verdict).toBe("做对");
  });

  test("批注回答走 tidyNoteSegments 也一样（它先切好的 heading / break）", () => {
    const segs = tidyNoteSegments(parseAnswer("作用：举例。\n承上：接着上一句。\n启下：引出下一句。", sentences), sentences, () => "x");
    expect(answerBlocks(segs).blocks.map((b) => b.label)).toEqual(["作用", "承上", "启下"]);
    const lines = answerLines(tidyNoteSegments(parseAnswer("意思：a\n\n补充：b", sentences), sentences, () => "x"));
    expect(lines[1].blank).toBe(true);
  });
});

describe("常见搭配表", () => {
  test("拆出搭配行，表前表后的文字留着", () => {
    const r = splitCollocations("原文：different frequency，不同的频率。\n[搭配]\ndifferent frequency｜不同的频率｜Each station uses a different frequency.\ndiffer from sth｜与……不同｜Cats differ from dogs.\n不是搭配的一行\n[/搭配]\n提醒：different 后面接 from。");
    expect(r.forms.map((f) => f.word)).toEqual(["different frequency", "differ from sth"]);
    expect(r.forms[0]).toMatchObject({ zh: "不同的频率", example: "Each station uses a different frequency." });
    expect(r.before).toContain("原文：");
    expect(r.after).toContain("提醒：");
  });
  test("没有搭配段返回 null", () => {
    expect(splitCollocations("意思：不同的频率")).toBe(null);
  });
});

describe("一键提问的回答格式", () => {
  test("每个预设按钮都有格式", () => {
    for (const p of [...NOTE_PRESETS.phrase, ...NOTE_PRESETS.sentence]) expect(formatFor(NOTE_FORMATS, p.id)).not.toBe("");
    for (const p of QA_PRESETS) expect(formatFor(QA_FORMATS, p.id)).not.toBe("");
    expect(formatFor(QA_FORMATS, null)).toBe("");
  });
  test("格式只跟在本轮问题后面，不进历史", () => {
    const msg = buildQaMessage({ evidence: "E", history: [{ q: "上一问", a: "上一答" }], question: "拆解答案句", format: formatFor(QA_FORMATS, "parse-key") });
    expect(msg.indexOf("【回答格式】")).toBeGreaterThan(msg.indexOf("【学生本轮的问题】"));
    expect(msg).toContain("答案句：");
    expect(buildQaMessage({ evidence: "E", question: "自由提问" })).not.toContain("【回答格式】");
    const note = buildNoteMessage({ passage: PASSAGE, quote: "different frequency", question: "它在这句话里是什么意思？", format: formatFor(NOTE_FORMATS, "meaning") });
    expect(note.message).toMatch(/【学生现在的问题】[\s\S]*【回答格式】[\s\S]*意思：/);
  });
  test("举一反三的格式只管排版，内容仍按系统规则第 9 条（错因规则不在这里改）", () => {
    expect(QA_FORMATS.analogy).toContain("第 9 条");
    expect(QA_FORMATS.analogy).not.toMatch(/同一种错/);
  });
  test("系统提示词让【回答格式】优先；第一轮讲解按小标题写、陷阱行仍在最后", () => {
    expect(QA_SYSTEM).toContain("【回答格式】");
    expect(NOTE_SYSTEM).toContain("【回答格式】");
    expect(EXPLAIN_SYSTEM).toMatch(/依据：[\s\S]*错在哪：[\s\S]*陷阱：类型名/);
    expect(EXPLAIN_SYSTEM).toContain("怎么找：");
    expect(EXPLAIN_SYSTEM_CORRECT).toMatch(/依据：[\s\S]*怎么找：[\s\S]*为什么对：/);
  });
});
