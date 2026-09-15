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
const sources = (bank) => new Set((bank.items || []).map((x) => String(x.source || "").trim()));

describe("口语补录账本", () => {
  test("账本在，且只收库里没有的那些卷（只追加、不顶替）", () => {
    expect(ledger).toBeTruthy();
    for (const set of Object.keys(ledger.repeat || {})) expect(sources(BANK_REPEAT).has(set)).toBe(false);
    for (const set of Object.keys(ledger.interview || {})) expect(sources(BANK_INTERVIEW).has(set)).toBe(false);
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
