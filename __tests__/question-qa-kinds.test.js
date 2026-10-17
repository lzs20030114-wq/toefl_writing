import {
  buildEvidence,
  conversationKey,
  sentenceLabel,
  presetText,
  qaPresetsFor,
  qaSystemFor,
  parseAnswer,
  QA_SYSTEM,
  QA_PRESETS,
} from "../lib/qa/questionQa";
import { listeningQaDetail, ctwQaDetail, numberListening, blankSentenceId } from "../lib/qa/qaKinds";
import { splitSentences } from "../lib/tts/wavTools";

const LC = listeningQaDetail({
  subtype: "lc",
  qid: "lc_1-q0",
  stem: "Why does the woman visit the office?",
  contextText: "Woman: Hi. I lost my card.\nMan: Oh no!",
  conversation: [
    { speaker: "Woman", text: "Hi there. I lost my student card yesterday." },
    { speaker: "Man", text: "Oh no! Did you check with Dr. Lee at 9 a.m. today?" },
  ],
  options: { A: "To pay a fee", B: "To replace a card" },
  selected: "A",
  correct: "B",
  isCorrect: false,
});

const LAT = listeningQaDetail({
  subtype: "lat",
  qid: "lat_1-q2",
  stem: "What is the main point?",
  contextText: "Today we discuss bees. Bees pollinate crops. However, their numbers are falling.",
  options: { A: "Bees", B: "Birds" },
  selected: "",
  correct: "A",
});

const LCR = listeningQaDetail({
  subtype: "lcr",
  qid: "lcr_7",
  speaker: "Could you lend me your notes from Monday?",
  situation: "Two classmates",
  options: { A: "Sure, here you go.", B: "On Monday." },
  selected: "B",
  correct: "A",
});

const CTW_PASSAGE = "The Spix's Macaw is critically endangered. The population of this bird declined because of habitat loss.";
const CTW = ctwQaDetail({
  itemId: "ctw_9",
  position: 7,
  displayed_fragment: "popul",
  original_word: "population",
  fullWord: "popular",
  userAnswer: "ar",
  passage: CTW_PASSAGE,
  blankIndex: 2,
  blankTotal: 10,
  isCorrect: false,
});

describe("听力原文编号", () => {
  test("对话按轮切句、与配音同一个切句函数，标签带说话人", () => {
    const s = numberListening(LC);
    const expected = [...splitSentences(LC.turns[0].text), ...splitSentences(LC.turns[1].text)];
    expect(s.map((x) => x.text)).toEqual(expected);
    expect(s.map((x) => x.speaker)).toEqual(["Woman", "Woman", "Man", "Man"]);
    expect(sentenceLabel(s[2], s)).toBe("第 3 句（Man）");
    // Dr. 和 9 a.m. today 不切开（和 sentence_timings 一致）
    expect(s[3].text).toBe("Did you check with Dr. Lee at 9 a.m. today?");
  });

  test("讲座整段切；应答题只有一句时叫「原话」", () => {
    const s = numberListening(LAT);
    expect(s.map((x) => x.text)).toEqual(splitSentences(LAT.transcript));
    expect(sentenceLabel(s[1], s)).toBe("第 2 句");
    const r = numberListening(LCR);
    expect(r).toHaveLength(1);
    expect(sentenceLabel(r[0], r)).toBe("原话");
  });
});

describe("各题型证据包", () => {
  test("听力选择题：原文按句编号带说话人，作答与答案带选项原文", () => {
    const ev = buildEvidence(LC);
    expect(ev.text).toContain("[S1] （Woman）Hi there.");
    expect(ev.text).toContain("听力·对话选择题");
    expect(ev.text).toContain("学生作答：A. To pay a fee");
    expect(ev.text).toContain("标准答案：B. To replace a card");
    expect(ev.materials).toContain("To replace a card");
    // 引文核对：原文里的原话认，编的不认
    const ok = parseAnswer('"lost my student card" [S2]', ev.sentences, ev.materials);
    expect(ok.find((x) => x.type === "cite").valid).toBe(true);
    const bad = parseAnswer('"found my card" [S2]', ev.sentences, ev.materials);
    expect(bad.find((x) => x.type === "cite").valid).toBe(false);
  });

  test("应答题：原话 + 场景 + 回应", () => {
    const ev = buildEvidence(LCR);
    expect(ev.text).toContain("说话人原话");
    expect(ev.text).toContain("[S1] Could you lend me your notes from Monday?");
    expect(ev.text).toContain("场景：Two classmates");
    expect(ev.text).toContain("学生选的回应：B. On Monday.");
    expect(ev.text).toContain("正确回应：A. Sure, here you go.");
  });

  test("填词：定位到空所在的句子，给出字母、学生填写、正确答案", () => {
    const ev = buildEvidence(CTW);
    expect(blankSentenceId(CTW_PASSAGE, ev.sentences, 7)).toBe("S2");
    expect(blankSentenceId(CTW_PASSAGE, ev.sentences, 0)).toBe("S1");
    expect(ev.text).toContain("本题：第 3 个空（共 10 个），在 [S2]");
    expect(ev.text).toContain("已给出的字母：popul");
    expect(ev.text).toContain("学生填写：popular");
    expect(ev.text).toContain("正确答案：population");
    expect(sentenceLabel(ev.sentences[1], ev.sentences)).toBe("第 2 句");
  });

  test("填词没作答时写「未作答」", () => {
    const ev = buildEvidence(ctwQaDetail({ ...CTW, userAnswer: "", fullWord: "popul" }));
    expect(ev.text).toContain("学生填写：未作答");
  });
});

describe("存档键、预设、提示词", () => {
  test("非阅读题的存档键带题型前缀，阅读题的键不变", () => {
    expect(conversationKey(LC).startsWith("listening|lc_1-q0|")).toBe(true);
    expect(conversationKey(LCR).startsWith("lcr|")).toBe(true);
    expect(conversationKey(CTW).startsWith("ctw|ctw_9#7|")).toBe(true);
    const reading = { qid: "ap_1-q0", stem: "Q", selected: "A", correct: "B", passage: "P." };
    expect(conversationKey(reading).startsWith("ap_1-q0|Q|||A|||B|||")).toBe(true);
  });

  test("每个题型有自己的预设与提示词", () => {
    expect(qaPresetsFor("reading")).toBe(QA_PRESETS);
    expect(qaPresetsFor("ctw").map((p) => p.id)).toEqual(["parse-blank", "why-form", "my-thinking", "simpler"]);
    expect(qaPresetsFor("lcr").map((p) => p.id)).toContain("other-replies");
    expect(presetText("my-thinking", { kind: "ctw", selectedLabel: "popular" })).toBe("我当时填 popular，是因为");
    expect(presetText("my-thinking", { kind: "listening", selectedLabel: "A" })).toBe("我当时选 A，是因为");
    expect(presetText("listen-cue", { kind: "listening" })).toContain("信号词");
    expect(qaSystemFor("reading")).toBe(QA_SYSTEM);
    expect(qaSystemFor("listening")).toContain("听力辅导老师");
    expect(qaSystemFor("listening")).toContain("先用英文双引号引出原文里支撑这个结论的原话");
    expect(qaSystemFor("lcr")).toContain("自己写的英文例句");
    expect(qaSystemFor("ctw")).toContain("给出的字母前缀");
    // 规则编号连续
    for (const k of ["ctw", "listening", "lcr"]) {
      const nums = [...qaSystemFor(k).matchAll(/(\d+)）/g)].map((m) => Number(m[1]));
      expect(nums).toEqual(nums.map((_, i) => i + 1));
    }
  });
});

describe("拖拽造句", () => {
  const { bsQaDetail, numberBs } = require("../lib/qa/qaKinds");
  const { QA_SYSTEM_BS } = require("../lib/qa/questionQa");
  const BS = bsQaDetail({
    prompt: "What did your advisor say when you ran into her?",
    userAnswer: "She asked whether had I already registered for classes.",
    correctAnswer: "She asked whether I had already registered for classes.",
    grammar_points: ["indirect question", "past perfect"],
    isCorrect: false,
  });

  test("题目和正确句子各自编号，学生拼的句子能被引用核对", () => {
    const s = numberBs(BS);
    expect(s.map((x) => x.label)).toEqual(["题目", "正确句子"]);
    const ev = buildEvidence(BS);
    expect(ev.text).toContain("[S1] What did your advisor say when you ran into her?");
    expect(ev.text).toContain("[S2] She asked whether I had already registered for classes.");
    expect(ev.text).toContain('学生拼出的句子："She asked whether had I');
    expect(ev.text).toContain("涉及语法点（题库标注）：indirect question, past perfect");
    const seg = parseAnswer('"whether I had" [S2] 间接疑问句不倒装，你写成了 "whether had I"。', ev.sentences, ev.materials);
    expect(seg.find((x) => x.type === "cite").valid).toBe(true);
    expect(seg.filter((x) => x.type === "quote").every((x) => x.valid)).toBe(true);
    expect(sentenceLabel(ev.sentences[1], ev.sentences)).toBe("正确句子");
  });

  test("没作答写「未作答」；存档键带 bs 前缀；预设和提示词是造句那套", () => {
    expect(buildEvidence(bsQaDetail({ prompt: "Hi.", userAnswer: "", correctAnswer: "Nice to meet you." })).text).toContain("学生拼出的句子：未作答");
    expect(conversationKey(BS).startsWith("bs|")).toBe(true);
    expect(qaPresetsFor("bs").map((p) => p.id)).toEqual(["parse-sentence", "why-order", "my-thinking", "try-similar", "simpler"]);
    expect(presetText("my-thinking", { kind: "bs", selectedLabel: "x" })).toBe("我当时这么排，是因为");
    expect(qaSystemFor("bs")).toBe(QA_SYSTEM_BS);
    expect(QA_SYSTEM_BS).toContain("间接疑问句不倒装");
    const nums = [...QA_SYSTEM_BS.matchAll(/(\d+)）/g)].map((m) => Number(m[1]));
    expect(nums).toEqual(nums.map((_, i) => i + 1));
  });
});
