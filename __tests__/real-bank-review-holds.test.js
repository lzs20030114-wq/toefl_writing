/**
 * 真题成品复核清单（data/realBank/review-holds.json）的锁：
 *
 * 2026-09-07 对 data/realBank 全库做了一次独立复核（952 道选择题盲解 + 结构体检，
 * 报告 data/claudeGen/reports/REALBANK-RECHECK-2026-09-07.md），判定下架的条目记在清单里，
 * 由 scripts/realbank/apply_review.mjs 落地。源料在 .codex-tmp（不在 git），build_bank 重跑
 * 会把这些条目原样再产出来 —— 这里锁死：清单里的 id 不许重新出现在成品里，patch 不许回退。
 * 放行某条 = 从清单里删掉那一行，而不是改这个测试。
 *
 * 阅读条目的 id 会变（data/realBank/reading/id-aliases.json）：
 *   · reclassified（ap ↔ rdl 归位）是**同一份材料换了 file+id** —— 清单记在旧 id 上的下架 / patch
 *     必须在新 file+id 上照样成立。只按旧 id 查会被「旧 id 已经不在 ap.json 里」糊弄过去，
 *     下架的题换个前缀就复活了，所以下面每条都先顺着归位链翻译再查。
 *   · consolidated（跨卷同篇合并）是**另一份副本**并进了保留方 —— 下架记在副本上，副本不在库里就算成立，
 *     绝不能把保留方当成副本来查（那会误报）。
 */
import fs from "fs";
import path from "path";
import os from "os";

const ROOT = path.join(__dirname, "..");
const review = JSON.parse(fs.readFileSync(path.join(ROOT, "data/realBank/review-holds.json"), "utf8"));
const bank = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, `data/realBank/${file}.json`), "utf8")).items;
const cache = {};
const items = (file) => (cache[file] = cache[file] || bank(file));

describe("3.14 AP 第 15 题：待插入句原卷补全", () => {
  const id = "real_ap_314_2_11";
  const sentence = "They also disagree about why responses vary among individual patients and what the long-term effects of EMF therapies may be.";
  const expectedStem = `There are four locations in the passage that indicate where the following sentence could be added. ${sentence} Where would the sentence best fit? Select a location to add the sentence in the passage.`;
  const oldStem = "There are four locations in the passage that indicate where the following sentence could be added. what the long-term effects of EMF therapies may be. Where would the sentence best fit? Select a location to add the sentence in the passage.";
  const live = () => items("reading/ap").find((it) => it.id === id);

  test("成品第 15 题包含完整原句，答案 D 与四个插入位齐全", () => {
    const it = live();
    const q = it.questions.find((q) => q.q_number === 15);
    expect(q).toMatchObject({ question_type: "insert_text", stem: expectedStem, correct_answer: "D", options: { A: "[A]", B: "[B]", C: "[C]", D: "[D]" } });
    for (const marker of ["[A]", "[B]", "[C]", "[D]"]) expect(it.passage).toContain(marker);
  });

  test("原始坏题干经正式清单重放只改该字段，二次应用幂等", () => {
    const { applyReview } = require("../scripts/realbank/apply_review.mjs");
    const patch = review.patches.find((p) => p.file === "reading/ap" && p.id === id && p.path === "questions.4.stem");
    expect(patch).toMatchObject({ op: "replace", from: oldStem, to: expectedStem });
    const original = JSON.parse(JSON.stringify(live()));
    expect(original.questions[4].q_number).toBe(15);
    original.questions[4].stem = oldStem;
    const expected = JSON.parse(JSON.stringify(original));
    expected.questions[4].stem = expectedStem;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "realbank-ap-insert-"));
    const bankDir = path.join(root, "data", "realBank");
    try {
      for (const dir of ["reading", "listening", "speaking"]) fs.mkdirSync(path.join(bankDir, dir), { recursive: true });
      const apPath = path.join(bankDir, "reading", "ap.json");
      fs.writeFileSync(apPath, JSON.stringify({ items: [original], count: 1 }));
      fs.writeFileSync(path.join(bankDir, "review-holds.json"), JSON.stringify({ patches: [patch], holds: [] }));
      expect(applyReview({ root }).stats.patched).toBe(1);
      const afterFirst = fs.readFileSync(apPath, "utf8");
      expect(JSON.parse(afterFirst).items).toEqual([expected]);
      expect(applyReview({ root }).stats.patched).toBe(0);
      expect(fs.readFileSync(apPath, "utf8")).toBe(afterFirst);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("3.16 AP：Landscape connectivity 首行原卷补全", () => {
  test("首行已补全，正文与 paragraphs 同步；原始截断库重放幂等且题目不变", () => {
    const { applyReview } = require("../scripts/realbank/apply_review.mjs");
    const id = "real_ap_316_2_11";
    const prefix = "Landscape connectivity refers to how easily organisms can move ";
    const live = items("reading/ap").find((it) => it.id === id);
    expect(live.passage.startsWith(`${prefix}across a landscape to access resources, find mates, disperse  \n`)).toBe(true);
    expect(live.paragraphs).toEqual(live.passage.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
    const patch = review.patches.find((p) => p.file === "reading/ap" && p.id === id && p.path === "passage" && p.op === "set");
    expect(patch).toMatchObject({ op: "set", to: live.passage });
    const original = JSON.parse(JSON.stringify(live));
    original.passage = original.passage.slice(prefix.length);
    original.paragraphs[0] = original.paragraphs[0].slice(prefix.length);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "realbank-ap-head-"));
    const bankDir = path.join(root, "data", "realBank");
    try {
      for (const dir of ["reading", "listening", "speaking"]) fs.mkdirSync(path.join(bankDir, dir), { recursive: true });
      const apPath = path.join(bankDir, "reading", "ap.json");
      fs.writeFileSync(apPath, JSON.stringify({ items: [original], count: 1 }));
      fs.writeFileSync(path.join(bankDir, "review-holds.json"), JSON.stringify({ patches: [patch], holds: [] }));
      expect(applyReview({ root }).stats.patched).toBe(1);
      const afterFirst = fs.readFileSync(apPath, "utf8");
      expect(JSON.parse(afterFirst).items).toEqual([live]);
      expect(applyReview({ root }).stats.patched).toBe(0);
      expect(fs.readFileSync(apPath, "utf8")).toBe(afterFirst);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("3.24 AP：绿地维护末句原卷补全", () => {
  test.each(["trimmed", "truncated"])("%s 输入重放补回完整句，正文段落同步且题目不变", (kind) => {
    const { applyReview } = require("../scripts/realbank/apply_review.mjs");
    const id = "real_ap_324_1_31";
    const sentence = " Another challenge is preserving these spaces—it can be difficult to secure the funding necessary to maintain them.";
    const live = items("reading/ap").find((it) => it.id === id);
    expect(live.passage.endsWith(sentence)).toBe(true);
    expect(live.paragraphs).toEqual(live.passage.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
    const patch = review.patches.find((p) => p.file === "reading/ap" && p.id === id && p.path === "passage");
    expect(patch).toMatchObject({ op: "set", to: live.passage, source: "truncation-sweep-2026-09-14" });
    expect(patch.verified_source).toContain("source-recheck-2026-10-11");
    const original = JSON.parse(JSON.stringify(live));
    original.passage = kind === "trimmed" ? original.passage.slice(0, -sentence.length) : original.passage.replace(/ them\.$/, "");
    original.paragraphs = original.passage.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "realbank-ap-tail-"));
    const bankDir = path.join(root, "data", "realBank");
    try {
      for (const dir of ["reading", "listening", "speaking"]) fs.mkdirSync(path.join(bankDir, dir), { recursive: true });
      const apPath = path.join(bankDir, "reading", "ap.json");
      fs.writeFileSync(apPath, JSON.stringify({ items: [original], count: 1 }));
      fs.writeFileSync(path.join(bankDir, "review-holds.json"), JSON.stringify({ patches: [patch], holds: [] }));
      expect(applyReview({ root }).stats.patched).toBe(1);
      const afterFirst = fs.readFileSync(apPath, "utf8");
      expect(JSON.parse(afterFirst).items).toEqual([live]);
      expect(applyReview({ root }).stats.patched).toBe(0);
      expect(fs.readFileSync(apPath, "utf8")).toBe(afterFirst);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("5 月 AP：旧裁切规则替换为原卷完整正文", () => {
  test.each([
    ["real_ap_511_2_11", "trimmed"],
    ["real_ap_511_2_11", "truncated"],
    ["real_ap_510v2_1_31", "Using"],
    ["real_ap_510v2_1_31", "Using transparent"],
  ])("%s %s 输入恢复原文，二次幂等且题目不变", (id, kind) => {
    const { applyReview } = require("../scripts/realbank/apply_review.mjs");
    const live = items("reading/ap").find((it) => it.id === id);
    const patches = review.patches.filter((p) => p.file === "reading/ap" && p.id === id && p.path === "passage");
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ op: "set", to: live.passage });
    expect(patches[0].source).toContain("source-recheck-2026-10-11");
    expect(live.paragraphs).toEqual(live.passage.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
    const original = JSON.parse(JSON.stringify(live));
    if (id === "real_ap_511_2_11") {
      expect(live.passage).toContain("potentially hospitable to life.");
      expect(live.passage).toMatch(/Others are trying to optimize algorithms to reduce unnecessary computations and the need for constant high-speed corrections\.$/);
      original.passage = original.passage.replace("potentially hospitable to life", "potentially habitable to life").replace(/ and the need for constant high-speed corrections\.$/, kind === "trimmed" ? "." : " and the need for constant");
    } else {
      const suffix = " Using sociocybernetic principles, urban planners design more resilient cities by modeling traffic patterns, resource distribution, and emergency response strategies. This approach helps create sustainable urban environments that better respond to changes.";
      expect(live.passage.endsWith(suffix)).toBe(true);
      original.passage = original.passage.slice(0, -suffix.length) + ` ${kind}`;
    }
    original.paragraphs = original.passage.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "realbank-ap-may-tail-"));
    const bankDir = path.join(root, "data", "realBank");
    try {
      for (const dir of ["reading", "listening", "speaking"]) fs.mkdirSync(path.join(bankDir, dir), { recursive: true });
      const apPath = path.join(bankDir, "reading", "ap.json");
      fs.writeFileSync(apPath, JSON.stringify({ items: [original], count: 1 }));
      fs.writeFileSync(path.join(bankDir, "review-holds.json"), JSON.stringify({ patches, holds: [] }));
      expect(applyReview({ root }).stats.patched).toBe(1);
      const afterFirst = fs.readFileSync(apPath, "utf8");
      expect(JSON.parse(afterFirst).items).toEqual([live]);
      expect(applyReview({ root }).stats.patched).toBe(0);
      expect(fs.readFileSync(apPath, "utf8")).toBe(afterFirst);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("2.8 AP：智能织物 charge 原卷词形核实", () => {
  test("charge 修正与 paragraphs 同步，原始 change 输入重放仅改此词且幂等", () => {
    const { applyReview } = require("../scripts/realbank/apply_review.mjs");
    const id = "real_ap_28_1_26";
    const correct = "Envision clothing that can charge your smartphone simply through your daily activities.";
    const wrong = "Envision clothing that can change your smartphone simply through your daily activities.";
    const live = items("reading/ap").find((it) => it.id === id);
    expect(live.passage).toContain(correct);
    expect(live.passage).not.toContain(wrong);
    expect(live.paragraphs).toEqual(live.passage.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean));
    const patch = review.patches.find((p) => p.file === "reading/ap" && p.id === id && p.path === "passage");
    expect(patch).toMatchObject({ op: "replace", from: wrong, to: correct });
    const original = JSON.parse(JSON.stringify(live));
    original.passage = original.passage.replace(correct, wrong);
    original.paragraphs = original.passage.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "realbank-ap-charge-"));
    const bankDir = path.join(root, "data", "realBank");
    try {
      for (const dir of ["reading", "listening", "speaking"]) fs.mkdirSync(path.join(bankDir, dir), { recursive: true });
      const apPath = path.join(bankDir, "reading", "ap.json");
      fs.writeFileSync(apPath, JSON.stringify({ items: [original], count: 1 }));
      fs.writeFileSync(path.join(bankDir, "review-holds.json"), JSON.stringify({ patches: [patch], holds: [] }));
      expect(applyReview({ root }).stats.patched).toBe(1);
      const afterFirst = fs.readFileSync(apPath, "utf8");
      expect(JSON.parse(afterFirst).items).toEqual([live]);
      expect(applyReview({ root }).stats.patched).toBe(0);
      expect(fs.readFileSync(apPath, "utf8")).toBe(afterFirst);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── id 别名账本（没有 = 老产物，行为与接线前一致）──
const aliasPath = path.join(ROOT, "data/realBank/reading/id-aliases.json");
const ALIASES = fs.existsSync(aliasPath) ? (JSON.parse(fs.readFileSync(aliasPath, "utf8")).aliases || []) : [];
const reclassified = new Map(ALIASES.filter((a) => a.reason === "reclassified" && a.to && a.to_type).map((a) => [a.from, a]));
/** 清单里的 (file, id) → 成品里实际该查的 (file, id)：旧 id 在原文件里找得到就原样查，找不到才顺着归位链。 */
function target(file, id) {
  if (!/^reading\/(ap|rdl)$/.test(file) || items(file).some((it) => it.id === id)) return { file, id };
  const a = reclassified.get(id);
  return a ? { file: `reading/${a.to_type}`, id: a.to } : { file, id };
}
const PATCH_PATH = { "ap>rdl": { passage: "text", topic: "genre" }, "rdl>ap": { text: "passage", genre: "topic" } };

describe("真题复核清单：holds 已落地", () => {
  test("清单非空且每条都带 reason", () => {
    expect(review.holds.length).toBeGreaterThan(0);
    for (const h of review.holds) {
      expect(typeof h.reason).toBe("string");
      expect(h.reason.length).toBeGreaterThan(0);
    }
  });

  test("整条下架的 id 不在成品里（归位后的新 id 同样不许在）", () => {
    const leaked = review.holds
      .filter((h) => h.scope === "unit")
      .filter((h) => { const t = target(h.file, h.id); return items(t.file).some((it) => it.id === t.id); })
      .map((h) => `${h.file}:${h.id}`);
    expect(leaked).toEqual([]);
  });

  // 按 id 精确比会漏：补回一道更靠前的题，被下架那组的 id 改名（组内最小题号变小），换个名字就复活了
  // （实测 real_ap_21a_1_33 → _31、real_ap_46_2_13 → _11、real_rdl_128b_1_30 → _28，精确比全部放过）。
  // 题号是卷面上固定的：同卷、同 module、同一个题号只属于同一篇材料 —— 所以再按题号查一遍。
  test("整条下架按题号也不许残留：库里没有同 slug、同 module、自有题含该题号的条目（dup_of 保留方除外）", () => {
    const parse = (id) => { const m = /^real_(ap|rdl)_(.+)_(\d+)_(\d+)$/.exec(String(id)); return m ? { slug: m[2], module: m[3], q: Number(m[4]) } : null; };
    const pool = [...items("reading/ap"), ...items("reading/rdl")].map((it) => ({ it, p: parse(it.id) })).filter((x) => x.p);
    const leaked = [];
    for (const h of review.holds) {
      if (h.scope !== "unit" || !/^reading\/(ap|rdl)$/.test(h.file)) continue;
      const p = parse(h.id);
      if (!p) continue;
      const keeper = h.dup_of ? resolveKeeper(h.dup_of_file || h.file, h.dup_of).id : null;
      for (const { it, p: ip } of pool) {
        if (ip.slug !== p.slug || ip.module !== p.module || it.id === keeper || it.id === h.dup_of) continue;
        if ((it.questions || []).some((q) => !q.merged_from && Number(q.q_number) === p.q)) leaked.push(`${h.file}:${h.id} ← ${it.id}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  test("单题下架：同一条里不再有以该 stem 开头的题（归位后的新条目同样查）", () => {
    const leaked = review.holds
      .filter((h) => h.scope === "question")
      .filter((h) => {
        const t = target(h.file, h.id);
        const it = items(t.file).find((x) => x.id === t.id);
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
  //
  // 另两种「按原 id 找不到」是合法的，都顺着 id-aliases.json 收敛一次再找：
  //   · dup_of 指着的那条被跨卷同篇合并进了同一篇的另一条（它的题一道没丢，全并过去了）；
  //   · dup_of 指着的那条按考卷位置归位了（real_ap_310_1_25 → real_rdl_310_1_25）。
  // 没有账本的老产物退回 consolidation.json 的 dropped → kept。
  const consPath = path.join(ROOT, "data/realBank/reading/consolidation.json");
  const foldedInto = new Map(ALIASES.filter((a) => a.to).map((a) => [String(a.from), { id: String(a.to), type: a.to_type }]));
  if (!ALIASES.length && fs.existsSync(consPath)) {
    for (const c of JSON.parse(fs.readFileSync(consPath, "utf8")).clusters || []) {
      for (const d of c.dropped || []) foldedInto.set(String(d), { id: String(c.kept), type: null });
    }
  }
  const resolveKeeper = (file, id) => {
    let cur = { file, id: String(id) };
    const seen = new Set();
    while (foldedInto.has(cur.id) && !seen.has(cur.id) && !items(cur.file).some((it) => it.id === cur.id)) {
      seen.add(cur.id);
      const nx = foldedInto.get(cur.id);
      cur = { file: nx.type ? `reading/${nx.type}` : cur.file, id: nx.id };
    }
    return cur;
  };

  test("跨套重复只保留一份：dup_of 指向的那条必须还在库里（不许两头都删光）", () => {
    const missingKeeper = review.holds
      .filter((h) => h.dup_of && h.scope === "unit")
      .filter((h) => {
        const k = resolveKeeper(h.dup_of_file || h.file, h.dup_of);
        return !items(k.file).some((it) => it.id === k.id);
      })
      .map((h) => `${h.file}:${h.id} → ${h.dup_of}`);
    expect(missingKeeper).toEqual([]);
  });

  test("文本 patch 没有回退（replace/trim 的 from 片段不再出现；归位后按新题型的字段查）", () => {
    const regressed = [];
    for (const p of review.patches) {
      if (!["replace", "trim_tail", "trim_head"].includes(p.op)) continue;
      const t = target(p.file, p.id);
      const it = items(t.file).find((x) => x.id === t.id);
      if (!it) continue; // 随整条下架作废
      const move = `${p.file.slice(8)}>${t.file.slice(8)}`;
      const pth = (PATCH_PATH[move] && PATCH_PATH[move][p.path]) || p.path;
      const cur = pth.split(".").reduce((o, k) => (o == null ? undefined : k.startsWith("#") ? o.find((x) => x?.id === k.slice(1)) : o[k]), it);
      if (typeof cur === "string" && cur.includes(p.from)) regressed.push(`${p.file}:${p.id} ${p.path}`);
    }
    expect(regressed).toEqual([]);
  });

  test("counts.json 与成品题量一致（apply_review 重算过）", () => {
    // 听力 / 口语的 counts 从 2026-09-15 起还含「跨卷重出还回原卷」的那些（`<科目>/id-aliases.json`）——
    // 它们不在库文件里，但前端 withRecycled 会摆进各自那一场，counts 是「题库覆盖」的分母。
    // 这条测试本来要防的是「复核下架了、counts 没跟着减」，把别名计进来后那个保护照旧成立。
    // 只有听力 / 口语的别名是「同一道题在另一场也考过、还回那一场」= 多出来的题量。
    // 阅读那份 id-aliases.json 语义完全不同（reclassified 归位 / consolidated 合并，都是**改名**，
    // 不是多出来的条目），算进去会把分母吹大。
    const RECYCLING_DIRS = new Set(["listening", "speaking"]);
    const aliasN = (dir, type) => {
      if (!RECYCLING_DIRS.has(dir)) return 0;
      const p = path.join(ROOT, `data/realBank/${dir}/id-aliases.json`);
      if (!fs.existsSync(p)) return 0;
      return (JSON.parse(fs.readFileSync(p, "utf8")).aliases || []).filter((a) => a.from_type === type).length;
    };
    for (const [dir, keys] of Object.entries({ reading: ["ctw", "rdl", "ap"], listening: ["lcr", "lc", "la", "lat"], speaking: ["repeat", "interview"] })) {
      const c = JSON.parse(fs.readFileSync(path.join(ROOT, `data/realBank/${dir}/counts.json`), "utf8"));
      for (const k of keys) expect(c[k]).toBe(items(`${dir}/${k}`).length + aliasN(dir, k));
    }
  });
});
