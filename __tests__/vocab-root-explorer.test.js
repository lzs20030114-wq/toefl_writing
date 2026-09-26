import { buildRootPrompts, normalizeRoot, parseRootResult } from "../lib/vocab/rootExplorer";

test("词根只接受单个英文字母串，提示词不会把结果说成官方词频", () => {
  expect(normalizeRoot(" Organ ")).toBe("organ");
  expect(normalizeRoot("organ/script")).toBe("");
  expect(normalizeRoot("a")).toBe("");
  const { system, message } = buildRootPrompts("organ");
  expect(system).toContain("不要宣称 ETS 官方高频");
  expect(message).toContain('"organ"');
});

test("只显示结构完整、与词根匹配且不重复的词", () => {
  const data = {
    rootMeaning: "器官；组织",
    memoryTip: "从组织的核心理解",
    words: [
      { word: "organ", partOfSpeech: "n.", meaning: "器官", formation: "词族核心", difference: "指身体部位" },
      { word: "organ", partOfSpeech: "n.", meaning: "器官", formation: "重复", difference: "重复" },
      { word: "organism", partOfSpeech: "n.", meaning: "生物体", formation: "organ + ism", difference: "指完整的生物" },
      { word: "organza", partOfSpeech: "n.", meaning: "纱", formation: "", difference: "无构词" },
      { word: "structure", partOfSpeech: "n.", meaning: "结构", formation: "struct + ure", difference: "无关" },
    ],
  };
  const result = parseRootResult(`\`\`\`json\n${JSON.stringify(data)}\n\`\`\``, "organ");
  expect(result.words.map((w) => w.word)).toEqual(["organ", "organism"]);
  expect(result.rootMeaning).toBe("器官；组织");
});

test("AI 格式错误或没有可用词时给出可重试的错误", () => {
  expect(() => parseRootResult("not json", "organ")).toThrow("AI 返回格式有误");
  expect(() => parseRootResult('{"words":[]}', "organ")).toThrow("没有得到可用");
});
