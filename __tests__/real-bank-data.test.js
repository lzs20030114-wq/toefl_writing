/**
 * 「真题专区」数据层契约测试（lib/realBank.js）。
 *
 * 锁三件事：
 *   1. 题量与来源分档（125 / 13 / 20；来源标签不许把未核验语料吹成 ETS 官方）；
 *   2. id 全部带 `real_` 前缀且全局唯一 —— real_tpo_reference.json 有 27 条 ad* id 与 live
 *      库 data/academicWriting/prompts.json 重叠，前缀是「已练 / 历史记录不互相污染」的唯一保障；
 *   3. 三种题型规范化后能被各自的消费方直接吃下（写作 normalizePrompt 的必填字段、
 *      造句 runtimeModel.validateRuntimeQuestion）。
 */

const runtimeModel = require("../lib/questionBank/runtimeModel");
const { evaluateBuildSentenceOrder } = require("../lib/utils");

import AD_TPO_REFERENCE from "../data/academicWriting/real_tpo_reference.json";
import AD_RECALLED from "../data/academicWriting/recalled_supplement.json";
import EM_TPO_REFERENCE from "../data/emailWriting/tpo_reference.json";
import BS_TPO_OFFICIAL from "../data/buildSentence/tpo_official.json";
import AD_LIVE from "../data/academicWriting/prompts.json";

import {
  getRealBSBatches,
  getRealBSQuestions,
  getRealDiscussionPrompts,
  getRealEmailPrompts,
  isRealBankId,
  mapRealBSToPicker,
  mapRealDiscussionToPicker,
  mapRealEmailToPicker,
  REAL_TIER_LABELS,
  realTierLabel,
} from "../lib/realBank";

const discussion = getRealDiscussionPrompts();
const email = getRealEmailPrompts();
const bsQuestions = getRealBSQuestions();
const bsBatches = getRealBSBatches();

describe("真题专区：题量", () => {
  test("学术讨论 125 题（81 参考版 + 44 回忆版），一条不丢", () => {
    expect(AD_TPO_REFERENCE.length).toBe(81);
    expect(AD_RECALLED.length).toBe(44);
    expect(discussion.length).toBe(125);
  });

  test("邮件 13 题", () => {
    expect(EM_TPO_REFERENCE.length).toBe(13);
    expect(email.length).toBe(13);
  });

  test("造句官方 20 题，拆成 2 批各 10 题", () => {
    expect(BS_TPO_OFFICIAL.length).toBe(20);
    expect(bsQuestions.length).toBe(20);
    expect(bsBatches.length).toBe(2);
    expect(bsBatches.map((b) => b.questions.length)).toEqual([10, 10]);
    expect(bsBatches.map((b) => b.id)).toEqual(["real-bs-set-1", "real-bs-set-2"]);
  });
});

describe("真题专区：id 前缀与全局唯一", () => {
  const allIds = [...discussion, ...email, ...bsQuestions].map((x) => x.id);

  test("158 个 id 全部带 real_ 前缀", () => {
    expect(allIds.length).toBe(158);
    const bad = allIds.filter((id) => !isRealBankId(id));
    expect(bad).toEqual([]);
  });

  test("id 全局唯一", () => {
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  test("与 live 学术讨论题库 id 零碰撞（不加前缀会撞 27 条）", () => {
    const liveIds = new Set(AD_LIVE.map((p) => String(p.id)));
    // 前提复核：不加前缀确实有大量重叠 —— 前缀不是多余的防御。
    const rawOverlap = AD_TPO_REFERENCE.filter((p) => liveIds.has(String(p.id)));
    expect(rawOverlap.length).toBeGreaterThan(0);
    // 加了前缀后一条都不碰。
    expect(discussion.filter((p) => liveIds.has(p.id))).toEqual([]);
  });

  test("不占用个人题库的 usr_ 保留前缀", () => {
    expect(allIds.filter((id) => id.includes("usr_"))).toEqual([]);
  });
});

describe("真题专区：来源分档标注诚实", () => {
  // data/REFERENCE_BANKS.md：「Items with no tier field are legacy（provenance unverified）」。
  // real_tpo_reference.json 全 81 条都没有 tier 字段 → 只能标「参考版」，绝不能标 ETS官方。
  test("real_tpo_reference.json 源文件确实没有 tier 字段", () => {
    expect(AD_TPO_REFERENCE.some((p) => "tier" in p)).toBe(false);
  });

  test("讨论题分档 = 44 回忆版 + 81 参考版，零官方", () => {
    const byTier = discussion.reduce((acc, p) => { acc[p.tier] = (acc[p.tier] || 0) + 1; return acc; }, {});
    expect(byTier).toEqual({ recalled: 44, legacy: 81 });
  });

  test("邮件题只有 tpo1 / tpo2 是 ETS 官方，其余 11 条是参考版", () => {
    const official = email.filter((p) => p.tier === "official").map((p) => p.id);
    expect(official).toEqual(["real_tpo1", "real_tpo2"]);
    expect(email.filter((p) => p.tier === "legacy").length).toBe(11);
  });

  test("造句 20 题全部 ETS 官方", () => {
    expect(bsQuestions.every((q) => q.tier === "official")).toBe(true);
  });

  test("标签映射：未知 / 缺失 tier 一律降级到「参考版」", () => {
    expect(realTierLabel("official")).toBe(REAL_TIER_LABELS.official);
    expect(realTierLabel("recalled")).toBe(REAL_TIER_LABELS.recalled);
    expect(realTierLabel(undefined)).toBe(REAL_TIER_LABELS.legacy);
    expect(realTierLabel("uncertain")).toBe(REAL_TIER_LABELS.legacy);
  });
});

describe("真题专区：写作题规范化形状", () => {
  // WritingTask.js:38-59 normalizeDiscussionPrompt 的硬要求：professor.name + professor.text
  // + 至少 2 个 name/text 齐全的 student。任一缺失 → 写作页报「指定题目不存在或已下线」。
  test("125 条讨论题满足 normalizeDiscussionPrompt 的必填字段", () => {
    const bad = discussion.filter(
      (p) => !p.professor?.name || !p.professor?.text ||
        !Array.isArray(p.students) || p.students.length < 2 ||
        p.students.some((s) => !s.name || !s.text)
    );
    expect(bad.map((p) => p.id)).toEqual([]);
  });

  // WritingTask.js:19-36 normalizeEmailPrompt 的硬要求：scenario + direction + goals ≥ 3。
  test("13 条邮件题满足 normalizeEmailPrompt 的必填字段", () => {
    const bad = email.filter((p) => !p.scenario || !p.direction || (p.goals || []).length < 3 || !p.to);
    expect(bad.map((p) => p.id)).toEqual([]);
  });
});

describe("真题专区：造句题适配 runtime 形状", () => {
  test("20 题全部通过 prepareQuestions（strictThrow）零错误", () => {
    expect(() => runtimeModel.prepareQuestions(bsQuestions, { strictThrow: true })).not.toThrow();
    const prepared = runtimeModel.prepareQuestions(bsQuestions, { strictThrow: false });
    expect(prepared.errors).toEqual([]);
    expect(prepared.questions.length).toBe(20);
  });

  test("逐题 normalize + validate 通过，且 answerOrder/givenSlots 能重建出 answer", () => {
    bsQuestions.forEach((raw) => {
      const q = runtimeModel.normalizeRuntimeQuestion(raw);
      expect(() => runtimeModel.validateRuntimeQuestion(q)).not.toThrow();
      // validateRuntimeQuestion 内部已比对，这里再显式断言一次渲染结果，防止未来放宽校验后静默退化。
      expect(runtimeModel.normalizeWord(runtimeModel.renderCorrectSentence(q)))
        .toBe(runtimeModel.normalizeWord(raw.answer));
    });
  });

  test("blanks 模板里的固定词都落到 prefilled_positions（题干给定词不进词块池）", () => {
    // 源文件里 6 道题带固定词（句首 / 句中 / 句尾），适配后必须表达为 prefilled_positions；
    // 其余全空位题的 prefilled 必须为空，不许凭空造给定词。
    const withPrefilled = bsQuestions.filter((q) => q.prefilled.length > 0);
    expect(withPrefilled.length).toBeGreaterThan(0);
    bsQuestions.forEach((q) => {
      const blanksHasLiteral = /[A-Za-z']/.test(String(BS_TPO_OFFICIAL.find((r) => `real_${r.id}` === q.id).blanks).replace(/_{2,}/g, " "));
      expect(q.prefilled.length > 0).toBe(blanksHasLiteral);
      // 每个 prefilled 都有位置，且位置在 answer 词数范围内。
      const answerWordCount = String(q.answer).trim().split(/\s+/).length;
      q.prefilled.forEach((key) => {
        expect(typeof q.prefilled_positions[key]).toBe("number");
        expect(q.prefilled_positions[key]).toBeGreaterThanOrEqual(0);
        expect(q.prefilled_positions[key]).toBeLessThan(answerWordCount);
      });
    });
  });

  test("干扰块进 chunks、单数 distractor；has_question_mark 按 answer 结尾推导", () => {
    bsQuestions.forEach((q) => {
      if (q.distractor) expect(q.chunks).toContain(q.distractor);
      expect(q.has_question_mark).toBe(/\?$/.test(String(q.answer).trim()));
      expect(Array.isArray(q.grammar_points)).toBe(true);
    });
    // 源文件带 distractor 的题数量必须原样传导（不多不少）。
    const srcWith = BS_TPO_OFFICIAL.filter((r) => (r.distractors || []).length > 0).length;
    expect(bsQuestions.filter((q) => q.distractor).length).toBe(srcWith);
  });

  // 判分闭环：BuildSentenceTask 的桌面端是纯拖拽交互，UI 里点不出来，所以这里直接打到
  // 判分函数本体 —— 拼对了必须判对、拼错了必须判错，否则真题会变成「怎么拼都错」的死题。
  test("按官方答案顺序拼出来 → evaluateBuildSentenceOrder 判对（20/20）", () => {
    bsQuestions.forEach((raw) => {
      const q = runtimeModel.normalizeRuntimeQuestion(raw);
      expect(evaluateBuildSentenceOrder(q, q.answerOrder).isCorrect).toBe(true);
    });
  });

  test("顺序拼错 → 判错（不会因为固定词占位而误判全对）", () => {
    bsQuestions.forEach((raw) => {
      const q = runtimeModel.normalizeRuntimeQuestion(raw);
      if (q.answerOrder.length < 2) return;
      const swapped = [...q.answerOrder];
      [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
      expect(evaluateBuildSentenceOrder(q, swapped).isCorrect).toBe(false);
    });
  });

  test("干扰块顶掉正确块 → 判错", () => {
    bsQuestions.filter((raw) => raw.distractor).forEach((raw) => {
      const q = runtimeModel.normalizeRuntimeQuestion(raw);
      const withDistractor = [...q.answerOrder.slice(0, -1), q.distractor];
      expect(evaluateBuildSentenceOrder(q, withDistractor).isCorrect).toBe(false);
    });
  });

  test("每批题都带批次 __sourceGroupId（useBuildSentenceSession 靠它写「已练」）", () => {
    bsBatches.forEach((batch) => {
      expect(batch.questions.every((q) => q.__sourceGroupId === batch.id)).toBe(true);
      // 不带 __sourceSetId —— 否则会污染全局 BS「已做套」集合。
      expect(batch.questions.every((q) => q.__sourceSetId === undefined)).toBe(true);
    });
  });
});

describe("真题专区：TopicPicker 映射", () => {
  test("讨论题 item 契约齐全，且分类基数够低（不会撑爆筛选栏）", () => {
    const items = mapRealDiscussionToPicker(discussion);
    expect(items.length).toBe(125);
    items.forEach((it) => {
      expect(typeof it.id).toBe("string");
      expect(it.title).toBeTruthy();
      expect(it.subtitle).toBeTruthy();
      expect(it.tag).toBeTruthy();
    });
    // 回忆版 44 条的 course 是逐题一句话描述（43 个互不相同），必须归到「回忆版」一类，
    // 否则 TopicPicker 的分类栏会变成 56 个几乎全为 (1) 的 pill。
    const tags = new Set(items.map((it) => it.tag));
    expect(tags.has(REAL_TIER_LABELS.recalled)).toBe(true);
    expect(tags.size).toBeLessThanOrEqual(16);
  });

  test("每张卡都能看到来源分档（tag 或 subtitle 里）", () => {
    const items = mapRealDiscussionToPicker(discussion);
    const byId = new Map(discussion.map((p) => [p.id, p]));
    items.forEach((it) => {
      const label = realTierLabel(byId.get(it.id).tier);
      expect(`${it.tag} ${it.subtitle}`).toContain(label);
    });
  });

  test("邮件题 tag 单一（picker 自动不显示筛选栏），subtitle 前缀标来源", () => {
    const items = mapRealEmailToPicker(email);
    expect(items.length).toBe(13);
    expect(new Set(items.map((it) => it.tag))).toEqual(new Set(["TPO"]));
    const byId = new Map(email.map((p) => [p.id, p]));
    items.forEach((it) => {
      expect(it.subtitle.startsWith(realTierLabel(byId.get(it.id).tier))).toBe(true);
      expect(it.title).toBeTruthy();
    });
  });

  test("造句题 = 2 张批次卡，id 与 __sourceGroupId 同源（已练标记才对得上）", () => {
    const items = mapRealBSToPicker(bsBatches);
    expect(items.map((it) => it.id)).toEqual(bsBatches.map((b) => b.id));
    items.forEach((it, i) => {
      expect(it.title).toContain("10 题");
      expect(it.tag).toBe(REAL_TIER_LABELS.official);
      expect(it.subtitle).toBe(bsBatches[i].label);
    });
  });
});

describe("真题专区：源文件只读", () => {
  test("映射不修改源 JSON（id 仍是裸 id，无 real_ 前缀 / 无注入字段）", () => {
    expect(AD_TPO_REFERENCE[0].id).toBe("ad1");
    expect(AD_RECALLED[0].id).toBe("adr01");
    expect(EM_TPO_REFERENCE[0].id).toBe("tpo1");
    expect(BS_TPO_OFFICIAL[0].id).toBe("bs_official_01");
    expect("prefilled_positions" in BS_TPO_OFFICIAL[0]).toBe(false);
    expect("__sourceGroupId" in BS_TPO_OFFICIAL[0]).toBe(false);
  });
});
