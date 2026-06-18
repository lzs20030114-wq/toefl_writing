const { extractShortTitle } = require("../lib/academicWriting/topicTitle");
const AD_DATA = require("../data/academicWriting/prompts.json");

describe("extractShortTitle (Discussion picker)", () => {
  test("no generated title starts with a mid-word 'ing'/'ion' fragment (P1.1 regression)", () => {
    const list = Array.isArray(AD_DATA) ? AD_DATA : [];
    const bad = list
      .filter((p) => p && p.professor && p.professor.text)
      .map((p) => ({ id: p.id, title: extractShortTitle(p.professor.text) }))
      .filter((t) => /^(ing|ion)\b/i.test(t.title));
    expect(bad).toEqual([]);
  });

  test("captures the fragment after a real trigger word", () => {
    expect(extractShortTitle("Let us discuss whether schools should grade. Why")).toBe("whether schools should grade");
    expect(extractShortTitle("Please talk about renewable energy adoption today.")).toBe("renewable energy adoption today");
    expect(extractShortTitle("Question: should cities ban cars downtown?")).toBe("should cities ban cars downtown");
  });

  test("does not match 'discuss' inside 'discussing' — falls back to first sentence", () => {
    const out = extractShortTitle("We have been discussing how cities cool down in summer. What is your view?");
    expect(out.startsWith("ing")).toBe(false);
    expect(out).toBe("We have been discussing how cities cool down in summer");
  });
});
