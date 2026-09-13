/**
 * 真题阅读成品里「管线新增字段」的数据不变量：点选句子题（sentence-select）与 id 别名账本（id-aliases）。
 *
 * 单独成文件、不塞进 real-bank-reading-data.test.js：那份文件前端分支也在改（四选一校验跳过选句题等），
 * 两边往同一个文件里加用例，集成时必然文本冲突。
 *
 * 数据源是 build_bank.mjs 的构建产物：没有选句题 / 没有账本（主工作树重建之前）时对应用例 skip，
 * 不让还没重建的主树刷红。
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..");
const readJ = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); } catch { return null; } };
const AP = (readJ("data/realBank/reading/ap.json") || { items: [] }).items || [];
const RDL = (readJ("data/realBank/reading/rdl.json") || { items: [] }).items || [];
const SS = require("../scripts/realbank/sentence_select.js");

describe("真题阅读：点选句子题契约（前端按 paragraph_index 顺序 indexOf 定位高亮）", () => {
  const withSS = AP.flatMap((it) => (it.questions || [])
    .filter((q) => q.question_type === "sentence_selection" && q.options && Object.keys(q.options).every((k) => /^S\d+$/.test(k)))
    .map((q) => ({ it, q })));
  const t = withSS.length ? test : test.skip;

  t("契约形状：paragraph_index 在范围内、选项 S1… 连号且按顺序是该段精确子串、答案键存在、题干不带界面指令", () => {
    const bad = [];
    for (const { it, q } of withSS) {
      const tag = `${it.id}#${q.q_number}`;
      const paras = it.paragraphs || [];
      if (!Number.isInteger(q.paragraph_index) || q.paragraph_index < 0 || q.paragraph_index >= paras.length) { bad.push(`${tag} paragraph_index`); continue; }
      if (!Number.isInteger(q.paragraph) || q.paragraph < 1) bad.push(`${tag} paragraph`);
      const text = paras[q.paragraph_index];
      const keys = Object.keys(q.options);
      if (keys.join(",") !== keys.map((_, i) => `S${i + 1}`).join(",")) bad.push(`${tag} keys`);
      let cursor = 0;
      for (const v of Object.values(q.options)) {
        const at = text.indexOf(v, cursor);
        if (at < 0) { bad.push(`${tag} 不是该段子串: ${v.slice(0, 40)}`); break; }
        cursor = at + v.length;
      }
      if (!(q.correct_answer in q.options)) bad.push(`${tag} answer`);
      if (/select\s+the\s+sentence\s+to\s+make/i.test(q.stem)) bad.push(`${tag} 题干带界面指令`);
    }
    expect(bad).toEqual([]);
  });

  t("paragraph_index 与题干段号一致（按标题检测数正文段），且正确句只出现在这一段", () => {
    const bad = [];
    for (const { it, q } of withSS) {
      const tag = `${it.id}#${q.q_number}`;
      if (SS.expectedParagraphIndex(it.paragraphs, q.paragraph) !== q.paragraph_index) bad.push(`${tag} 段号换算对不上`);
      const want = SS.correctSentenceOf(q);
      const where = (it.paragraphs || []).map((p, i) => [i, SS.splitSentences(p).some((s) => SS.jaccard(s, want) >= 0.9)]).filter(([, hit]) => hit);
      if (where.length !== 1 || where[0][0] !== q.paragraph_index) bad.push(`${tag} 正确句所在段 ${where.map(([i]) => i).join(",")}`);
    }
    expect(bad).toEqual([]);
  });

  t("上线的每道都有对得上「题干 + paragraphs[paragraph_index]」哈希与正确句的通过盲审记录", () => {
    const ledger = readJ("data/realBank/reading/sentence-select.json") || { entries: [] };
    const passes = SS.passingHashes(ledger);
    const unaudited = withSS
      .filter(({ it, q }) => !SS.auditPasses(passes, SS.auditHash(q.stem, it.paragraphs[q.paragraph_index]), SS.correctSentenceOf(q)))
      .map(({ it, q }) => `${it.id}#${q.q_number}`);
    expect(unaudited).toEqual([]);
  });
});

describe("真题阅读：点选句子题账本（data/realBank/reading/sentence-select.json，进仓库）", () => {
  const ledger = readJ("data/realBank/reading/sentence-select.json");
  const t = ledger ? test : test.skip;

  t("每条账本都带题干 / 段号 / 答案开头词，key 唯一且按 key 排序；审计记录带哈希", () => {
    const keys = (ledger.entries || []).map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    for (const e of ledger.entries || []) {
      expect(typeof e.stem).toBe("string");
      expect(e.stem).not.toMatch(/select\s+the\s+sentence\s+to\s+make/i);
      expect(Number.isInteger(e.paragraph)).toBe(true);
      expect(String(e.answer_prefix || "").length).toBeGreaterThan(0);
      for (const a of e.audits || []) expect(a.hash).toMatch(/^[0-9a-f]{40}$/);
    }
  });
});

describe("真题阅读：复核整条下架按题号不残留（按 id 精确比会被补题改名骗过去）", () => {
  // 补回一道更靠前的题，被下架那组的 id 改名（组内最小题号变小），id 沿用又认不回从没在线过的下架条目 ——
  // 精确比 id 看不出它复活了。题号是卷面上固定的：同卷同 module 同题号只属于同一篇材料，所以按题号查。
  const review = readJ("data/realBank/review-holds.json") || { holds: [] };
  const ledger = readJ("data/realBank/reading/id-aliases.json") || { aliases: [] };
  const hop = new Map((ledger.aliases || []).filter((a) => a.to).map((a) => [a.from, a.to]));
  const resolve = (id) => { let cur = String(id); const seen = new Set(); while (hop.has(cur) && !seen.has(cur)) { seen.add(cur); cur = hop.get(cur); } return cur; };
  const parse = (id) => { const m = /^real_(ap|rdl)_(.+)_(\d+)_(\d+)$/.exec(String(id)); return m ? { slug: m[2], module: m[3], q: Number(m[4]) } : null; };

  test("每条阅读 unit 下架（slug/module/题号）：库里没有同 slug、同 module、自有题含该题号的条目（dup_of 保留方除外）", () => {
    const pool = [...AP, ...RDL].map((it) => ({ it, p: parse(it.id) })).filter((x) => x.p);
    const leaked = [];
    for (const h of review.holds || []) {
      if (h.scope !== "unit" || !/^reading\/(ap|rdl)$/.test(String(h.file)) || !parse(h.id)) continue;
      const p = parse(h.id);
      const keeper = h.dup_of ? resolve(h.dup_of) : null;
      for (const { it, p: ip } of pool) {
        if (ip.slug !== p.slug || ip.module !== p.module || it.id === keeper || it.id === h.dup_of) continue;
        if ((it.questions || []).some((q) => !q.merged_from && Number(q.q_number) === p.q)) leaked.push(`${h.file}:${h.id} ← ${it.id}`);
      }
    }
    expect(leaked).toEqual([]);
  });
});

describe("真题阅读：id 别名账本（前端靠它把旧 id 的练习记录接到新 id）", () => {
  const ledger = readJ("data/realBank/reading/id-aliases.json");
  const t = ledger ? test : test.skip;

  t("契约形状 + 按 from 升序 + to 收敛到活着的条目（题型与所在文件一致）", () => {
    const live = { ap: new Set(AP.map((x) => x.id)), rdl: new Set(RDL.map((x) => x.id)) };
    const bad = [];
    const froms = ledger.aliases.map((a) => a.from);
    expect(froms).toEqual([...froms].sort((a, b) => a.localeCompare(b)));
    expect(new Set(froms).size).toBe(froms.length);
    for (const a of ledger.aliases) {
      if (!["reclassified", "consolidated"].includes(a.reason)) bad.push(`${a.from} reason=${a.reason}`);
      if (a.from_type !== (/^real_(ap|rdl)_/.exec(a.from) || [])[1]) bad.push(`${a.from} from_type`);
      if (a.to == null) { if (a.to_type != null) bad.push(`${a.from} to_type 应为 null`); continue; }
      if (!live[a.to_type] || !live[a.to_type].has(a.to)) bad.push(`${a.from} → ${a.to} 不在 ${a.to_type}.json 里`);
    }
    expect(bad).toEqual([]);
  });

  t("被别名接走的旧 id 不再以原 id 活在库里（to 指向自己的例外：那条又活过来了）", () => {
    const live = new Set([...AP, ...RDL].map((x) => x.id));
    expect(ledger.aliases.filter((a) => a.to && a.to !== a.from && live.has(a.from)).map((a) => a.from)).toEqual([]);
  });
});
