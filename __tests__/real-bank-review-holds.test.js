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

const ROOT = path.join(__dirname, "..");
const review = JSON.parse(fs.readFileSync(path.join(ROOT, "data/realBank/review-holds.json"), "utf8"));
const bank = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, `data/realBank/${file}.json`), "utf8")).items;
const cache = {};
const items = (file) => (cache[file] = cache[file] || bank(file));

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
    for (const [dir, keys] of Object.entries({ reading: ["ctw", "rdl", "ap"], listening: ["lcr", "lc", "la", "lat"], speaking: ["repeat", "interview"] })) {
      const c = JSON.parse(fs.readFileSync(path.join(ROOT, `data/realBank/${dir}/counts.json`), "utf8"));
      for (const k of keys) expect(c[k]).toBe(items(`${dir}/${k}`).length);
    }
  });
});
