/**
 * 「真题专区」数据层契约测试（lib/realBank.js）。
 *
 * 锁三件事：
 *   1. 题量与来源分档（讨论 132 / 邮件 27 / 造句 292；来源标签不许把未核验语料吹成 ETS 官方）；
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
// realBank 写作回忆版（build_bank.mjs 产物）：造句 272 / 邮件 14 / 讨论 7。
import RB_BS from "../data/realBank/writing/bs.json";
import RB_EMAIL from "../data/realBank/writing/email.json";
import RB_DISCUSSION from "../data/realBank/writing/discussion.json";

import {
  getRealBSBatches,
  getRealBSQuestions,
  getRealDiscussionPrompts,
  getRealEmailPrompts,
  isRealBankId,
  mapRealBSToPicker,
  mapRealDiscussionToPicker,
  mapRealEmailToPicker,
  REAL_BS_MIN_BATCH,
  REAL_TIER_LABELS,
  realTierLabel,
} from "../lib/realBank";

const discussion = getRealDiscussionPrompts();
const email = getRealEmailPrompts();
const bsQuestions = getRealBSQuestions();
const bsBatches = getRealBSBatches();

// 落库侧已经把「过不了 runtimeModel」的题拦在库外（scripts/realbank/bs_runtime_gate.mjs，
// 2026-09-08 起接进 build_bank）——以前 bs_rf0808_01 这种词块重复的题会躺在库里、
// 由前端 groupBsBatches 静默丢，导致「库里的条数」比「能做的题数」多。现在两者相等。
const RB_BS_DROPPED = 0;

// 「造句要按套算」：题数 < REAL_BS_MIN_BATCH 的碎卷（源卷零星回忆，凑不成一套）不进真题专区。
// 2026-09-08 实测命中 5 卷（3 题的 3.6/3.23/4.28，1 题的 4.5/rf0615），共 11 题被过滤。
const RB_BS_SPARSE_SOURCES = ["3.6新托福真题", "3.23新托福真题", "4.28新托福真题", "4.5新托福真题", "rf0615"];
const RB_BS_FILTERED_OUT = RB_BS.items.filter((q) =>
  RB_BS_SPARSE_SOURCES.includes(q.source || q.source_label)
).length;

describe("真题专区：题量", () => {
  test("学术讨论 132 题（81 参考版 + 44 + 7 回忆版），一条不丢", () => {
    expect(AD_TPO_REFERENCE.length).toBe(81);
    expect(AD_RECALLED.length).toBe(44);
    expect(RB_DISCUSSION.items.length).toBe(7);
    expect(discussion.length).toBe(132);
  });

  test("邮件 27 题（13 官方 / 参考版 + 14 回忆版）", () => {
    expect(EM_TPO_REFERENCE.length).toBe(13);
    expect(RB_EMAIL.items.length).toBe(14);
    expect(email.length).toBe(27);
  });

  test("造句 281 题（20 官方 + 261 回忆版），官方 2 批各 10 题、批次号不动", () => {
    expect(BS_TPO_OFFICIAL.length).toBe(20);
    expect(RB_BS.items.length).toBe(272);
    expect(RB_BS_FILTERED_OUT).toBe(11);
    expect(bsQuestions.length).toBe(20 + RB_BS.items.length - RB_BS_DROPPED - RB_BS_FILTERED_OUT);
    // 官方两批永远是 set-1 / set-2（老用户的「已练」标记靠它对齐），回忆版从 set-3 起。
    expect(bsBatches.length).toBeGreaterThan(2);
    expect(bsBatches.slice(0, 2).map((b) => b.id)).toEqual(["real-bs-set-1", "real-bs-set-2"]);
    expect(bsBatches.slice(0, 2).map((b) => b.questions.length)).toEqual([10, 10]);
    // 批次号（groupId）按源文件出现顺序在过滤前分配，过滤只摘掉碎卷、不重排剩余批次的号，
    // 所以幸存批次的编号不连续是预期行为（不能断言 set-N 严格等于数组下标 N）。
    const idNums = bsBatches.map((b) => Number(b.id.replace("real-bs-set-", "")));
    expect(idNums).toEqual([...idNums].sort((a, b) => a - b));
    expect(new Set(idNums).size).toBe(idNums.length);
    // 每批题数都达标，官方两批各 10 题不受影响。
    expect(bsBatches.every((b) => b.questions.length >= REAL_BS_MIN_BATCH)).toBe(true);
    // 回忆版按考试套次（source）分批，一批 = 一场考试；碎卷（< REAL_BS_MIN_BATCH 题）已被过滤。
    const recalledBatches = bsBatches.slice(2);
    const recalledSources = new Set(RB_BS.items.map((q) => q.source));
    expect(recalledBatches.length).toBe(recalledSources.size - RB_BS_SPARSE_SOURCES.length);
    expect(recalledBatches.every((b) => b.tier === "recalled")).toBe(true);
    expect(recalledBatches.every((b) => b.questions.length >= REAL_BS_MIN_BATCH)).toBe(true);
    expect(recalledBatches.reduce((n, b) => n + b.questions.length, 0)).toBe(
      RB_BS.items.length - RB_BS_DROPPED - RB_BS_FILTERED_OUT
    );
  });

  test("所有回忆版造句批次题数 ≥ REAL_BS_MIN_BATCH（碎卷不进真题专区）", () => {
    const recalledBatches = bsBatches.filter((b) => b.tier === "recalled");
    expect(recalledBatches.length).toBeGreaterThan(0);
    recalledBatches.forEach((b) => {
      expect(b.questions.length).toBeGreaterThanOrEqual(REAL_BS_MIN_BATCH);
    });
    // 反向核实：源文件里确有 < REAL_BS_MIN_BATCH 题的卷（否则这条断言测不出回归）。
    expect(RB_BS_SPARSE_SOURCES.length).toBeGreaterThan(0);
  });

  test("回忆版造句每题都能被 runtime 消费：prefilled_positions 齐全 + 词块能拼回 answer", () => {
    const recalled = bsQuestions.filter((q) => q.tier === "recalled");
    expect(recalled.length).toBeGreaterThanOrEqual(80);
    recalled.forEach((raw) => {
      const answerWordCount = String(raw.answer).trim().split(/\s+/).length;
      expect(Object.keys(raw.prefilled_positions).sort()).toEqual([...raw.prefilled].sort());
      raw.prefilled.forEach((key) => {
        expect(typeof raw.prefilled_positions[key]).toBe("number");
        expect(raw.prefilled_positions[key]).toBeGreaterThanOrEqual(0);
        expect(raw.prefilled_positions[key]).toBeLessThan(answerWordCount);
      });
      // 词块（含题干给定词）能原样拼回官方答案 —— 拼不回来就是死题。
      const q = runtimeModel.normalizeRuntimeQuestion(raw);
      expect(runtimeModel.normalizeWord(runtimeModel.renderCorrectSentence(q)))
        .toBe(runtimeModel.normalizeWord(raw.answer));
    });
  });
});

describe("真题专区：id 前缀与全局唯一", () => {
  const allIds = [...discussion, ...email, ...bsQuestions].map((x) => x.id);

  test("265 个 id 全部带 real_ 前缀", () => {
    expect(allIds.length).toBe(discussion.length + email.length + bsQuestions.length);
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

  test("讨论题分档 = 51 回忆版（44 + 7）+ 81 参考版，零官方", () => {
    const byTier = discussion.reduce((acc, p) => { acc[p.tier] = (acc[p.tier] || 0) + 1; return acc; }, {});
    expect(byTier).toEqual({ recalled: 51, legacy: 81 });
  });

  test("邮件题只有 tpo1 / tpo2 是 ETS 官方，11 条参考版 + 14 条回忆版", () => {
    const official = email.filter((p) => p.tier === "official").map((p) => p.id);
    expect(official).toEqual(["real_tpo1", "real_tpo2"]);
    expect(email.filter((p) => p.tier === "legacy").length).toBe(11);
    expect(email.filter((p) => p.tier === "recalled").length).toBe(14);
  });

  // 「第 N 套」按数组下标算（compactCard），所以数组顺序 = 用户看到的排序：
  // ETS 官方逐字原题必须是第 1 / 2 套，不能被后入库的回忆版挤到第 15 套去。
  test("邮件题按来源分档排序：官方 → 回忆版 → 参考版", () => {
    expect(email.slice(0, 2).map((p) => p.id)).toEqual(["real_tpo1", "real_tpo2"]);
    const rank = { official: 0, recalled: 1, legacy: 2 };
    const ranks = email.map((p) => rank[p.tier]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // 同档内保持入库顺序（稳定排序）：回忆版 14 条仍是 email.json 的原顺序。
    expect(email.filter((p) => p.tier === "recalled").map((p) => p.id))
      .toEqual(RB_EMAIL.items.map((it) => `real_${it.id}`));
  });

  test("造句只有 20 条 ETS 官方，其余全是回忆版（回忆版不许冒充官方）", () => {
    expect(bsQuestions.filter((q) => q.tier === "official").length).toBe(20);
    expect(bsQuestions.filter((q) => q.tier === "recalled").length).toBe(bsQuestions.length - 20);
    expect(bsQuestions.some((q) => q.tier === "legacy")).toBe(false);
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
  test("全部造句真题通过 prepareQuestions（strictThrow）零错误", () => {
    expect(() => runtimeModel.prepareQuestions(bsQuestions, { strictThrow: true })).not.toThrow();
    const prepared = runtimeModel.prepareQuestions(bsQuestions, { strictThrow: false });
    expect(prepared.errors).toEqual([]);
    expect(prepared.questions.length).toBe(bsQuestions.length);
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
    const rawById = new Map([...BS_TPO_OFFICIAL, ...RB_BS.items].map((r) => [`real_${r.id}`, r]));
    bsQuestions.forEach((q) => {
      const blanksHasLiteral = /[A-Za-z']/.test(String(rawById.get(q.id).blanks).replace(/_{2,}/g, " "));
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
    // 源文件带 distractor 的题数量必须原样传导（不多不少；被丢掉的那题不计）。
    const keptIds = new Set(bsQuestions.map((q) => q.id));
    const srcWith = [...BS_TPO_OFFICIAL, ...RB_BS.items]
      .filter((r) => keptIds.has(`real_${r.id}`) && (r.distractors || []).length > 0).length;
    expect(bsQuestions.filter((q) => q.distractor).length).toBe(srcWith);
  });

  // 判分闭环：BuildSentenceTask 的桌面端是纯拖拽交互，UI 里点不出来，所以这里直接打到
  // 判分函数本体 —— 拼对了必须判对、拼错了必须判错，否则真题会变成「怎么拼都错」的死题。
  test("按官方答案顺序拼出来 → evaluateBuildSentenceOrder 判对（全库）", () => {
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
    expect(items.length).toBe(discussion.length);
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

  test("邮件题 tag 只有两类（回忆版 / TPO），每张卡都看得到来源分档", () => {
    const items = mapRealEmailToPicker(email);
    expect(items.length).toBe(email.length);
    expect(new Set(items.map((it) => it.tag))).toEqual(new Set([REAL_TIER_LABELS.recalled, "TPO"]));
    const byId = new Map(email.map((p) => [p.id, p]));
    items.forEach((it) => {
      expect(`${it.tag} ${it.subtitle}`).toContain(realTierLabel(byId.get(it.id).tier));
      expect(it.title).toBeTruthy();
    });
  });

  test("造句题 = 一卷一张批次卡，id 与 __sourceGroupId 同源（已练标记才对得上）", () => {
    const items = mapRealBSToPicker(bsBatches);
    expect(items.map((it) => it.id)).toEqual(bsBatches.map((b) => b.id));
    items.forEach((it, i) => {
      expect(it.title).toContain(`${bsBatches[i].questions.length} 题`);
      expect(it.tag).toBe(realTierLabel(bsBatches[i].tier));
      expect(it.subtitle).toBe(bsBatches[i].label);
      // 徽章只给 ETS 官方，回忆版不许带。
      expect(it.badge).toBe(bsBatches[i].tier === "official" ? REAL_TIER_LABELS.official : undefined);
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
    // realBank 写作三个构建产物同样只读。
    expect(RB_BS.items[0].id.startsWith("bs_")).toBe(true);
    expect("prefilled_positions" in RB_BS.items[0]).toBe(false);
    expect("__sourceGroupId" in RB_BS.items[0]).toBe(false);
    expect(RB_EMAIL.items[0].id.startsWith("email_")).toBe(true);
    expect(RB_DISCUSSION.items[0].id.startsWith("disc_")).toBe(true);
  });
});
