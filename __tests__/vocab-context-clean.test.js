import { activeSentence, cleanContextSentence, clozeSentence, contextSentence, definitionForContext } from "../lib/vocab/book";

test.each([
  [" ¶ 2 [■] The bank  was crowded. □ ", "The bank was crowded."],
  ["• ● [ □ ] Rivers flow nearby.", "Rivers flow nearby."],
  ["The range [1, 2] matters.\nAnother line.", "The range [1, 2] matters.\nAnother line."],
])("cleanContextSentence removes layout marks without removing ordinary brackets or line breaks", (raw, clean) => {
  expect(cleanContextSentence(raw)).toBe(clean);
});

test.each(["reading", "listening"])("%s source keeps exact context sense keys while displaying clean inflected words", source => {
  const raw = "¶ 3 [■] It divides the region into two parts. □";
  const card = Object.freeze({ word: "divide", sentence: raw, source,
    def: "v. 分开", baseDef: "v. 划分", contextSenses: [{ sentence: raw, def: "v. 将区域分成", updatedAt: "2026-10-14T00:00:00Z" }] });
  expect(activeSentence(card)).toBe(raw);
  expect(definitionForContext(card, activeSentence(card))).toBe("v. 将区域分成");
  expect(contextSentence(card)).toBe("It divides the region into two parts.");
  expect(clozeSentence(card)).toBe("It ______ the region into two parts.");
  expect(card.sentence).toBe(raw);
  expect(card.contextSenses[0].sentence).toBe(raw);
});

test("cleaning does not break target matching or the long sentence window", () => {
  const sentence = `¶ 4 [■] ${Array(35).fill("before").join(" ")}, the banks remain nearby; ${Array(35).fill("after").join(" ")} □`;
  const card = { word: "bank", sentence };
  expect(activeSentence(card)).toBe(sentence);
  expect(clozeSentence(card)).toContain("____");
  expect(contextSentence(card)).toContain("banks");
  expect(contextSentence(card)).not.toMatch(/[¶■□]/);
  expect(contextSentence(card).split(/\s+/).length).toBeLessThanOrEqual(30);
  expect(clozeSentence({ word: "river", sentence })).toBeNull();
});
