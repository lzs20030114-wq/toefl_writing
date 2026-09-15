/**
 * 词块可以重复（2026-09-15 放开）。
 *
 * 真题里同一个词块真的会摆两块 —— "my phone battery died and I couldn't find my charger"
 * 那一屏就有两块 my。老断言「bank must not contain duplicates」把这类题整题挡在库外，
 * 实测 2026 真题造句有 10 道栽在它上面（data/claudeGen/reports/BS-REJECTS-2026-09-15.json）。
 *
 * 放开的前提是运行时本来就不靠「文本唯一」认块：拖拽块的身份是下标
 * （useBuildSentenceSession：id = `${i}-${j}`），判分比的是渲染出来的词序
 * （sentenceEngine.buildWordSlots 只用文本）。这组测试把这件事钉死 ——
 * 谁要是再把去重断言加回来，这里会红。
 */
const runtimeModel = require("../lib/questionBank/runtimeModel");
const { evaluateBuildSentenceOrder } = require("../lib/utils");
import { __internal } from "../components/buildSentence/useBuildSentenceSession";

const DUP = {
  id: "real_bs_329_06",
  prompt: "Why were you out of touch last night?",
  answer: "My phone battery died and I couldn't find my charger.",
  chunks: ["my", "phone battery", "died and", "I couldn't", "find", "my", "charger"],
  prefilled: [],
  prefilled_positions: {},
  distractor: null,
  has_question_mark: false,
  grammar_points: [],
};

describe("造句：词块允许重复", () => {
  test("两块一样的 my 能过 runtime 校验（不再判 bank duplicates）", () => {
    const q = runtimeModel.normalizeRuntimeQuestion(DUP);
    expect(() => runtimeModel.validateRuntimeQuestion(q)).not.toThrow();
    expect(q.bank.filter((c) => c === "my")).toHaveLength(2);
  });

  test("prepareQuestions 收下它（以前整题被当成「题库数据异常」丢掉）", () => {
    const prepared = __internal.prepareQuestions([DUP]);
    expect(prepared.errors).toHaveLength(0);
    expect(prepared.questions).toHaveLength(1);
  });

  test("按正确顺序拼出来判对；顺序拼错判错", () => {
    const q = runtimeModel.normalizeRuntimeQuestion(DUP);
    expect(evaluateBuildSentenceOrder(q, q.answerOrder).isCorrect).toBe(true);
    const swapped = [...q.answerOrder];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(evaluateBuildSentenceOrder(q, swapped).isCorrect).toBe(false);
  });

  test("两块同文本互换位置 → 拼出同一句，照样判对（块的身份是下标不是文本）", () => {
    const q = runtimeModel.normalizeRuntimeQuestion(DUP);
    const idx = q.answerOrder.reduce((acc, c, i) => (c === "my" ? [...acc, i] : acc), []);
    expect(idx).toHaveLength(2);
    const swapped = [...q.answerOrder];
    [swapped[idx[0]], swapped[idx[1]]] = [swapped[idx[1]], swapped[idx[0]]];
    expect(evaluateBuildSentenceOrder(q, swapped).isCorrect).toBe(true);
  });

  test("多重集判定仍然拦得住真错：answerOrder 要两块、bank 只给一块", () => {
    const broken = runtimeModel.normalizeRuntimeQuestion(DUP);
    broken.bank = broken.bank.filter((c, i) => !(c === "my" && i === broken.bank.lastIndexOf("my")));
    expect(() => runtimeModel.validateRuntimeQuestion(broken)).toThrow(/needs 2× "my"|bank length/);
  });

  test("带干扰块时，重复块不会被当成干扰块", () => {
    const withDistractor = runtimeModel.normalizeRuntimeQuestion({
      ...DUP, id: "real_bs_329_06_d", chunks: [...DUP.chunks, "yesterday"], distractor: "yesterday",
    });
    expect(() => runtimeModel.validateRuntimeQuestion(withDistractor)).not.toThrow();
    expect(evaluateBuildSentenceOrder(withDistractor, withDistractor.answerOrder).isCorrect).toBe(true);
  });
});
