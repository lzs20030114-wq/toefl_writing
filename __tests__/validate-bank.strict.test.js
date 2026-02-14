const { validateBankDataByFile } = require("../scripts/validate-bank");

function makeValidItem(id) {
  return {
    id,
    difficulty: "easy",
    context: "Could you send me the class notes by tonight?",
    responseSuffix: ".",
    given: "Could you",
    givenIndex: 1,
    bank: ["send", "me", "the notes", "by", "tonight", "after", "class", "please"],
    answerOrder: ["send", "me", "the notes", "by", "tonight", "after", "class", "please"],
    acceptedAnswerOrders: [],
    acceptedReasons: [],
  };
}

describe("validate-bank strict mode", () => {
  test("fails when acceptedAnswerOrders contains invalid permutation", () => {
    const bad = makeValidItem("bad_alt");
    bad.acceptedAnswerOrders = [["send", "me", "the notes", "by", "tonight", "after", "please", "please"]];
    bad.acceptedReasons = ["adverbial_shift"];

    const out = validateBankDataByFile(
      {
        "easy.json": [bad],
        "medium.json": [makeValidItem("m1")],
        "hard.json": [makeValidItem("h1")],
      },
      { strict: true }
    );

    expect(out.ok).toBe(false);
    expect(out.failures.join("\n")).toContain("acceptedAnswerOrders[0]: must be a permutation of bank");
  });
});

