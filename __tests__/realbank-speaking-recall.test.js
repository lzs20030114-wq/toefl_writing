/**
 * 口语补录（data/realBank/speaking-recall.json ← scripts/realbank/recall_speaking.mjs）。
 *
 * 库里 32 套面试 / 30 套复述全部来自 rf* / rp* 第二来源，1–5 月的数字卷一套面试都没有；
 * 真题 GT（data/realExam2026/speaking/）里却按卷逐题转写着 14 套面试 + 13 套复述。
 * 这组测试锁住账本的形状与「模型碰不到一个字」这条红线。
 */
import fs from "fs";
import path from "path";
import GT_INTERVIEW from "../data/realExam2026/speaking/interview.json";
import GT_REPEAT from "../data/realExam2026/speaking/repeat-from-audio.json";
import BANK_REPEAT from "../data/realBank/speaking/repeat.json";
import BANK_INTERVIEW from "../data/realBank/speaking/interview.json";

const LEDGER_PATH = path.join(__dirname, "..", "data/realBank/speaking-recall.json");
const ledger = fs.existsSync(LEDGER_PATH) ? JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8")) : null;
const gtItems = (j) => (Array.isArray(j) ? j : j.items || []);

describe("口语补录账本", () => {
  // 原先这里断言「账本里的卷都不在库里」—— 那是**记账那一刻**的条件，不是长期不变量：
  // 账本是 build_bank 的输入，verdict=ok 的条目被收进库正是它的用途，收完再断言「不在库里」
  // 必然红（2026-09-15 面试补录落库后就红了）。事后能验的是「卷名不是凭空冒出来的」。
  test("账本在，每一卷都来自真题 GT（不许凭空出现的卷名）", () => {
    expect(ledger).toBeTruthy();
    const gtR = new Set(gtItems(GT_REPEAT).map((x) => String(x.source).trim()));
    const gtI = new Set(gtItems(GT_INTERVIEW).map((x) => String(x.source).trim()));
    const repeatSets = Object.keys(ledger.repeat || {});
    const interviewSets = Object.keys(ledger.interview || {});
    expect(repeatSets.length + interviewSets.length).toBeGreaterThan(0);
    for (const set of repeatSets) expect(gtR.has(set)).toBe(true);
    for (const set of interviewSets) expect(gtI.has(set)).toBe(true);
  });

  test("同一卷在库里只有一条补录来源（补录不与源料产出并存）", () => {
    for (const [bank, bucket] of [[BANK_REPEAT, "repeat"], [BANK_INTERVIEW, "interview"]]) {
      for (const set of Object.keys(ledger[bucket] || {})) {
        // 面试大集会被 interview-splits 拆成 _cN 的若干套，按**根 id** 归一再数
        const roots = new Set((bank.items || [])
          .filter((x) => String(x.source || "").trim() === set)
          .map((x) => String(x.id).replace(/_c\d+$/, "")));
        expect(roots.size).toBeLessThanOrEqual(1);
      }
    }
  });

  test("复述：句子逐字来自 GT，一个字不改", () => {
    const gt = new Map(gtItems(GT_REPEAT).map((x) => [String(x.source).trim(), x]));
    const entries = Object.entries(ledger.repeat || {});
    expect(entries.length).toBeGreaterThan(0);
    for (const [set, v] of entries) {
      const src = gt.get(set);
      expect(src).toBeTruthy();
      expect(v.content.sentences).toEqual(src.sentences.map((s) => String(s).trim()));
    }
  });

  test("复述缺情境说明时用管线自己那句兜底（不是判 review 丢掉）", () => {
    const gt = new Map(gtItems(GT_REPEAT).map((x) => [String(x.source).trim(), x]));
    for (const [set, v] of Object.entries(ledger.repeat || {})) {
      expect(String(v.content.scenario || "").length).toBeGreaterThan(0);
      if (!String(gt.get(set)?.setting || "").trim()) {
        expect(v.content.scenario).toMatch(/repeat each sentence exactly as you hear it/);
      }
      expect(v.verdict).toBe("ok");
    }
  });

  test("面试：每一题都必须是 GT 原句按序拼出来的（模型只给边界，不产出文本）", () => {
    const gt = new Map(gtItems(GT_INTERVIEW).map((x) => [String(x.source).trim(), x]));
    for (const [set, v] of Object.entries(ledger.interview || {})) {
      if (v.verdict !== "ok") continue;
      const src = gt.get(set);
      expect(src).toBeTruthy();
      const qs = src.questions.map((q) => String(q).trim());
      // 把补录的题面首尾相接，必须与 GT 的逐句首尾相接逐字相同 —— 既不许漏句，也不许多字
      const joined = v.content.questions.map((q) => q.question).join(" ");
      expect(joined).toBe(qs.join(" "));
      expect(v.content.questions.length).toBeGreaterThanOrEqual(3);
      expect(v.content.questions.length).toBeLessThanOrEqual(4);
    }
  });

  test("verdict 只有 ok / review 两种，review 的必须写明原因", () => {
    for (const bucket of ["repeat", "interview"]) {
      for (const [set, v] of Object.entries(ledger[bucket] || {})) {
        expect(["ok", "review"]).toContain(v.verdict);
        if (v.verdict === "review") expect((v.problems || []).length).toBeGreaterThan(0);
        expect(v.provenance?.gt_id).toBeTruthy();
      }
    }
  });
});
