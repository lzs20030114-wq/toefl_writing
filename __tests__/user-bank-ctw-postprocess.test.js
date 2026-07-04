const { postProcessCtw } = require("../lib/ai/prompts/questionExtraction");
const { processPassage } = require("../lib/readingGen/cTestBlanker");

// CTW (单词补全 / C-test) import post-processor — «贴原文自动挖空» path.
// The AI only cleans/transcribes; postProcessCtw runs cTestBlanker (pure mechanical) server-side.
// Because the answer IS the original passage, the produced item is zero-error by construction.

// A 4-sentence academic passage that reliably yields exactly 10 blanks under the C-test rule.
const GOOD_PASSAGE =
  "Clownfish and sea anemones form a remarkable partnership. The clownfish shelters among the " +
  "stinging tentacles, which protect it from predators and provide a safe home. In return, the " +
  "fish defends the anemone from other creatures and its waste supplies nutrients. This mutual " +
  "arrangement benefits both organisms in the shallow ocean reef environment.";

function wordsOf(n) {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

describe("postProcessCtw (个人题库导入：贴原文自动挖空)", () => {
  test("valid passage → 完整 bank item，恰好 10 空，无 invalid", () => {
    const out = postProcessCtw({ passage: GOOD_PASSAGE, topic: "biology" });
    expect(out.invalid).toBeUndefined();
    expect(out.blanks).toHaveLength(10);
    expect(out.blank_count).toBe(10);
    expect(out.topic).toBe("biology");
    expect(out.difficulty).toBe("medium");
    expect(out.first_sentence).toMatch(/^Clownfish and sea anemones/);
    expect(out.passage).toBe(GOOD_PASSAGE);
    expect(typeof out.blanked_text).toBe("string");
    // Every blank carries the fields CTWTask needs to locate + score it.
    for (const b of out.blanks) {
      expect(typeof b.position).toBe("number");
      expect(typeof b.original_word).toBe("string");
      expect(b.original_word.trim().length).toBeGreaterThan(0);
      expect(typeof b.displayed_fragment).toBe("string");
    }
  });

  test("产物与 processPassage 逐字一致（同一段机械代码，绝不让 AI 手填）", () => {
    const out = postProcessCtw({ passage: GOOD_PASSAGE, topic: "biology" });
    const { item: direct } = processPassage(
      { passage: GOOD_PASSAGE, topic: "biology", subtopic: "", difficulty: "medium" },
      "ctw_import_probe"
    );
    // postProcessCtw strips the placeholder id + may add advisory warnings; everything else is identical.
    const { warnings: _w, ...outNoWarn } = out;
    const { id: _id, ...directNoId } = direct;
    expect(outNoWarn).toEqual(directNoId);
  });

  test("词数 <45 → invalid（中文原因），不产出 blanks", () => {
    const out = postProcessCtw({ passage: "This is a short passage. It has too few words.", topic: "x" });
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/原文过短/);
    expect(out.invalid_reason).toMatch(/45 词/);
    expect(out.blanks).toBeUndefined();
  });

  test("词数 >120 → warning only（不拦用户真题，仍产出完整 item）", () => {
    // 130 tokens with 2 sentence breaks so blanking succeeds.
    const long = Array.from({ length: 130 }, (_, i) => (i === 40 || i === 90 ? `word${i}.` : `word${i}`)).join(" ");
    const out = postProcessCtw({ passage: long, topic: "x" });
    expect(out.invalid).toBeUndefined();
    expect(out.blanks).toHaveLength(10);
    expect((out.warnings || []).join(" ")).toMatch(/偏长/);
    expect((out.warnings || []).join(" ")).toMatch(/词数 130/);
  });

  test("≥45 词但只有 1 句 → 无法按 C-test 挖空 → invalid（cTestBlanker 实际逻辑：需≥2句）", () => {
    const oneSentence = wordsOf(50) + "."; // 50 words, single sentence
    const out = postProcessCtw({ passage: oneSentence, topic: "x" });
    expect(out.invalid).toBe(true);
    expect(out.invalid_reason).toMatch(/无法按 C-test 规则挖空/);
  });

  test("topic 缺省 'other'；空/非对象输入安全降级为 invalid", () => {
    const noTopic = postProcessCtw({ passage: GOOD_PASSAGE });
    expect(noTopic.topic).toBe("other");
    expect(noTopic.invalid).toBeUndefined();

    expect(postProcessCtw({}).invalid).toBe(true);
    expect(postProcessCtw(null).invalid).toBe(true);
    expect(postProcessCtw({ passage: "   " }).invalid).toBe(true);
  });

  test("ctwValidator 告警塞进 warnings（single-char fragment 等），但其 errors 不拦用户内容", () => {
    // 这段含第一人称 (we/our)，ctwValidator 会记为 error——但 postProcessCtw 只取 warnings，
    // 用户真题里的 I/we 是合法的，绝不因此拒绝。
    const firstPerson =
      "We study coral reefs closely. Our team observed that the clownfish shelters among the " +
      "stinging tentacles, which protect it from predators and provide a safe home for the little fish. " +
      "In return, the fish defends the anemone from other creatures and supplies vital nutrients daily.";
    const out = postProcessCtw({ passage: firstPerson, topic: "biology" });
    expect(out.invalid).toBeUndefined(); // first_person error NOT propagated
    expect(out.blanks).toHaveLength(10);
    // warnings is present when the validator surfaces any (deterministic given the passage).
    if (out.warnings) {
      expect(Array.isArray(out.warnings)).toBe(true);
    }
  });

  test("deterministic：同输入两次结果一致（除 warnings 顺序也稳定）", () => {
    const a = postProcessCtw({ passage: GOOD_PASSAGE, topic: "biology" });
    const b = postProcessCtw({ passage: GOOD_PASSAGE, topic: "biology" });
    expect(a).toEqual(b);
  });
});
