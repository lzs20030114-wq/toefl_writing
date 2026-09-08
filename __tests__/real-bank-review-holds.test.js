/**
 * 真题成品复核清单（data/realBank/review-holds.json）的锁：
 *
 * 2026-09-07 对 data/realBank 全库做了一次独立复核（952 道选择题盲解 + 结构体检，
 * 报告 data/claudeGen/reports/REALBANK-RECHECK-2026-09-07.md），判定下架的条目记在清单里，
 * 由 scripts/realbank/apply_review.mjs 落地。源料在 .codex-tmp（不在 git），build_bank 重跑
 * 会把这些条目原样再产出来 —— 这里锁死：清单里的 id 不许重新出现在成品里，patch 不许回退。
 * 放行某条 = 从清单里删掉那一行，而不是改这个测试。
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..");
const review = JSON.parse(fs.readFileSync(path.join(ROOT, "data/realBank/review-holds.json"), "utf8"));
const bank = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, `data/realBank/${file}.json`), "utf8")).items;
const cache = {};
const items = (file) => (cache[file] = cache[file] || bank(file));

describe("真题复核清单：holds 已落地", () => {
  test("清单非空且每条都带 reason", () => {
    expect(review.holds.length).toBeGreaterThan(0);
    for (const h of review.holds) {
      expect(typeof h.reason).toBe("string");
      expect(h.reason.length).toBeGreaterThan(0);
    }
  });

  test("整条下架的 id 不在成品里", () => {
    const leaked = review.holds
      .filter((h) => h.scope === "unit")
      .filter((h) => items(h.file).some((it) => it.id === h.id))
      .map((h) => `${h.file}:${h.id}`);
    expect(leaked).toEqual([]);
  });

  test("单题下架：同一条里不再有以该 stem 开头的题", () => {
    const leaked = review.holds
      .filter((h) => h.scope === "question")
      .filter((h) => {
        const it = items(h.file).find((x) => x.id === h.id);
        return it && it.questions.some((q) => String(q.stem || "").startsWith(h.stem));
      })
      .map((h) => `${h.file}:${h.id}#${h.q}`);
    expect(leaked).toEqual([]);
  });

  test("复述句 / 面试题级下架的 id 不在成品里", () => {
    const leaked = review.holds
      .filter((h) => h.scope === "sentence" || h.scope === "iq")
      .filter((h) => {
        const it = items(h.file).find((x) => x.id === h.id);
        if (!it) return false;
        const arr = h.scope === "sentence" ? it.sentences : it.questions;
        return arr.some((x) => x.id === (h.sid || h.qid));
      })
      .map((h) => `${h.file}:${h.sid || h.qid}`);
    expect(leaked).toEqual([]);
  });

  // 同一份材料被录成两个题型（ap 与 rdl）时，保留的那条可能在另一个文件里：dup_of_file 指明去哪找。
  test("跨套重复只保留一份：dup_of 指向的那条必须还在库里（不许两头都删光）", () => {
    const missingKeeper = review.holds
      .filter((h) => h.dup_of && h.scope === "unit")
      .filter((h) => !items(h.dup_of_file || h.file).some((it) => it.id === h.dup_of))
      .map((h) => `${h.file}:${h.id} → ${h.dup_of}`);
    expect(missingKeeper).toEqual([]);
  });

  test("文本 patch 没有回退（replace/trim 的 from 片段不再出现）", () => {
    const regressed = [];
    for (const p of review.patches) {
      if (!["replace", "trim_tail", "trim_head"].includes(p.op)) continue;
      const it = items(p.file).find((x) => x.id === p.id);
      if (!it) continue; // 随整条下架作废
      const cur = p.path.split(".").reduce((o, k) => (o == null ? undefined : k.startsWith("#") ? o.find((x) => x?.id === k.slice(1)) : o[k]), it);
      if (typeof cur === "string" && cur.includes(p.from)) regressed.push(`${p.file}:${p.id} ${p.path}`);
    }
    expect(regressed).toEqual([]);
  });

  test("counts.json 与成品题量一致（apply_review 重算过）", () => {
    for (const [dir, keys] of Object.entries({ reading: ["ctw", "rdl", "ap"], listening: ["lcr", "lc", "la", "lat"], speaking: ["repeat", "interview"] })) {
      const c = JSON.parse(fs.readFileSync(path.join(ROOT, `data/realBank/${dir}/counts.json`), "utf8"));
      for (const k of keys) expect(c[k]).toBe(items(`${dir}/${k}`).length);
    }
  });
});
