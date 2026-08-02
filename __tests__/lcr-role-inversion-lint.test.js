/**
 * 角色反转 lint 冻结测试 — detectRoleInversion (lcrValidator)
 *
 * 基线来自 2026-08-02 LCR 全量审计（data/claudeGen/reports/lcr-answer-audit-20260802.md）：
 * 9 道改键/重写的旧错题里 8 道属于可确定性识别的「观察者-帮助」句式，必须全部命中；
 * lcr_mqiq4y26_1（"I'll post a sample report…"）依赖 situation 角色语义，超出确定性
 * lint 能力，由 AI 盲审（lcrAuditor）负责——它不在本测试断言范围内。
 * 误报侧：三个「双方共同行动/自我报告」合法键是当初调参时的真实误报，冻结为必须放行。
 */

const { detectRoleInversion, validateLCR } = require("../lib/listeningGen/lcrValidator");
const fs = require("fs");
const path = require("path");

// 2026-08-02 审计修掉的 8 道可确定性识别的旧错题（speaker + 旧键原文）
const OLD_INVERTED_KEYS = [
  ["You look completely wiped out today.", "Want me to grab you a coffee?"],
  ["Have you decided on a major yet?", "Let's go over your options together."],
  ["You seem pretty worn out after practice.", "Maybe sit out the next drill and rest."],
  ["Have you signed up for next semester's classes yet?", "Don't worry, I'll walk you through it now."],
  ["What are you going to do about your rent?", "I can lend you some money if you need."],
  ["Have you been getting any sleep lately?", "Let me cover your shift tonight."],
  ["Have you decided on a major yet?", "Let's look at your options together."],
  ["Why are you carrying all those boxes yourself?", "Here, let me grab a couple."],
];

// 结构相似但合法的键：共同行动不涉及「你的事情」/ 自我报告式安抚 / 服务性提问下的帮助
const LEGIT_KEYS = [
  ["Are you doing okay after that exam result?", "Let's study together this weekend."],
  ["Do you think we can finish the project by Friday?", "Why don't we ask the professor for an extension?"],
  ["Are you sure you're okay after yesterday?", "Don't worry, I'm back on my feet."],
  ["Do you carry any books on Persian poetry?", "Absolutely — let me show you the section."],
  ["Are you okay to keep going?", "Let me catch my breath first."],
];

describe("detectRoleInversion — 8 道审计旧错键全部命中", () => {
  test.each(OLD_INVERTED_KEYS)("%s → %s 判为角色反转", (speaker, key) => {
    expect(detectRoleInversion(speaker, key)).toBeTruthy();
  });
});

describe("detectRoleInversion — 合法键零误报", () => {
  test.each(LEGIT_KEYS)("%s → %s 放行", (speaker, key) => {
    expect(detectRoleInversion(speaker, key)).toBeNull();
  });

  test("live 库全量键零误报", () => {
    const bank = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../data/listening/bank/lcr.json"), "utf8")
    );
    const hits = bank.items
      .map(it => ({ id: it.id, r: detectRoleInversion(it.speaker, it.options[it.answer]) }))
      .filter(x => x.r);
    expect(hits).toEqual([]);
  });
});

describe("validateLCR 集成 — 反转键即硬拒", () => {
  test("旧错题整题过 validateLCR 必须 invalid + role_inversion_key", () => {
    const item = {
      speaker: "You look completely wiped out today.",
      options: {
        A: "Want me to grab you a coffee?",
        B: "This towel is completely wiped down.",
        C: "I cleaned the whole kitchen last night.",
        D: "No, that movie wasn't very good.",
      },
      answer: "A",
    };
    const r = validateLCR(item);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.startsWith("role_inversion_key"))).toBe(true);
  });
});
