#!/usr/bin/env node
/**
 * 真题录入 —— AP 学术短文的 ground-truth 兜底。
 *
 * 解决的问题：`structure_set.mjs` 的转写轮 + 修复轮都救不回来的阅读块（典型是「模型输出
 * 无法解析为 JSON」后连题干带选项一起空着），但**同一道题的干净文本其实已经躺在
 * `data/realExam2026/reading/academicPassage.json` 里** —— 那是早前人工校过的真题 ground truth，
 * 只有 stem + options，没有题号也没有答案。
 *
 * 所以这里做的事只有一件：**把 GT 的 stem/options 认回到正确的题号上**，答案照旧由代码从
 * `<卷>.json` 的答案 key 盖章（`stampAnswer`），与 structure_set 的铁律一致 —— 不解题、不让模型碰答案。
 *
 * ── 认题号为什么不能只靠 OCR 页眉 ───────────────────────────────────────────
 * 屏幕 OCR 是左右分栏的汤：正文在左、题干选项在右。实测 1.28A 的 Q28（European cities 推断题）
 * 题干被 OCR 甩到了 Q29 页眉**之后**，按「最近的上一条 Reading | Question N of M」去认就会认成 Q29
 * （而该卷压根没有 Q29 块）。所以这里用三段式：
 *
 *   1. 锚点：GT 题干若与某个块**已经抽出来的** stem 逐字（归一化后）相符，直接钉死。
 *   2. 槽位：同一篇材料下、状态不是 ok 的块就是「洞」。已经抽出非空 stem 却对不上任何 GT 题干的洞
 *      （典型是插入句题 "There are four locations…"）要**排除**，它不是 GT 覆盖的那道题。
 *   3. 唯一性：剩余 GT 题数 == 剩余槽位数。
 *      - 恰好 1 对 1：唯一解，直接落笔（1.28A Q28 就是这种：屏幕右栏被 OCR 整列吞了，
 *        题干和选项一个字都没留下，只能靠「只剩这一个洞」定位）。
 *      - N 对 N（N≥2）：**不能**按 GT 数组顺序硬填 —— 实测 GT 的题序不等于屏幕题序
 *        （1.21A 的 "mantra" 题在 GT 里排第 2、屏幕上却是 Q29）。改为拿 GT 的四个选项去比
 *        每个洞的屏幕 OCR 正文（`<卷>.json` 的 block.body，右栏没被吞时选项原文就在里面），
 *        必须每个洞都能选出唯一赢家才落笔，否则整篇跳过。
 *      对不上就整篇跳过并说明原因 —— 宁可不补，不许补错位。
 *
 * 兜底注入的题**照旧要过盲审**（`audit_answers.mjs --section=reading --only-missing`）：万一题号认错，
 * 盖上去的答案就会跟题文对不上，独立模型盲解必然选到别处去，那一刀会把它丢掉。
 *
 * 用法：
 *   node scripts/realbank/gt_fallback_ap.mjs --dry              # 全部卷，只打印不落盘
 *   node scripts/realbank/gt_fallback_ap.mjs "1.28新托福真题A卷"   # 只跑一卷
 *   node scripts/realbank/gt_fallback_ap.mjs --report <path>     # 另存一份注入清单 JSON
 *
 * 幂等：注入过的记录带 `gt_injected: true`，重复跑直接跳过；状态已是 ok 的块也不碰。
 * 零 LLM 调用。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
// 就地修补写回统一走这里：同步第一来源的 rw 阅读基线（否则下一次重跑 ASR 合流会把修补冲掉）。
const { writeStructured } = require("./structured_io.js");

const OUT_DIR = path.join(process.cwd(), ".codex-tmp", "realbank");
const GT_FILE = path.join(process.cwd(), "data", "realExam2026", "reading", "academicPassage.json");

/* ── 以下四段与 structure_set.mjs 逐字相同（无法 import：那个文件顶层就 main()，
      import 进来等于把 CLI 跑一遍）。来源行号：
        LETTERS      structure_set.mjs:253
        CJK          structure_set.mjs:254
        WATERMARK    structure_set.mjs:255
        stampAnswer  structure_set.mjs:258-277
        verifyMcq    structure_set.mjs:279-294
      改那边记得同步改这里。 ──────────────────────────────────────────────── */
const LETTERS = "abcdefgh";
const CJK = /[一-鿿]/;
const WATERMARK = /闲鱼|盗卖|退款|店铺|甜茶|满分小屋|唯一闲/;
const countWords = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

function stampAnswer(item, answerLetter) {
  const problems = [];
  const letter = String(answerLetter || "").trim().toLowerCase();
  if (!/^[a-h]$/.test(letter)) {
    problems.push(`答案不是单个字母：${JSON.stringify(answerLetter)}`);
    return problems;
  }
  const idx = LETTERS.indexOf(letter);
  if (!Array.isArray(item.options) || item.options.length < 2) {
    problems.push("选项数组缺失或不足 2 个");
    return problems;
  }
  if (idx >= item.options.length) {
    problems.push(`答案 ${letter} 越界：只转写出 ${item.options.length} 个选项`);
    return problems;
  }
  item.answer_index = idx;
  item.answer_text = item.options[idx];
  return problems;
}

function verifyMcq(item) {
  const p = [];
  if (!item.stem || countWords(item.stem) < 2) p.push("题干缺失或过短");
  if (!Array.isArray(item.options)) p.push("options 不是数组");
  else {
    if (item.options.length < 3 || item.options.length > 5) p.push(`选项数异常：${item.options.length}`);
    if (new Set(item.options.map((o) => String(o).trim().toLowerCase())).size !== item.options.length) {
      p.push("存在重复选项（多半是分栏没理干净）");
    }
    item.options.forEach((o, i) => { if (!String(o || "").trim()) p.push(`第 ${i + 1} 个选项为空`); });
  }
  const blob = [item.stem, item.material, ...(item.options || [])].join(" ");
  if (CJK.test(blob)) p.push("英文字段里混入中文");
  if (WATERMARK.test(blob)) p.push("水印未清干净");
  return p;
}
/* ── 复制段结束 ─────────────────────────────────────────────────────────── */

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const wordSet = (s) => new Set(String(s || "").toLowerCase().match(/[a-z]{3,}/g) || []);

/** 与 build_bank.groupByMaterial 的 isSameMaterial 同口径：Jaccard≥0.8 或归一化前 60 字相同。 */
function sameMaterial(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na.slice(0, 60) === nb.slice(0, 60)) return true;
  const A = wordSet(a), B = wordSet(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter) >= 0.8;
}

/** GT 题干与已抽出的 stem 算不算同一道题（归一化后互为前缀即可，OCR 常把尾巴吃掉）。 */
function sameStem(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  return short.length >= 20 && long.startsWith(short);
}

/** 从 <卷>.json 的 alignment 取 (module,q) → 答案字母。 */
function answerMap(scan) {
  const m = new Map();
  const rd = scan && scan.alignment && scan.alignment.reading;
  for (const mod of (rd && rd.modules) || []) {
    for (const hit of mod.matched || []) m.set(`${mod.module}#${hit.n}`, hit.answer);
  }
  return m;
}

/**
 * 从 <卷>.json 的 alignment 取 (module,q) → 该屏的 OCR 原文。
 * 两个用途：① 块里压根没抽出 material 时（items 为空的块就是这样，164 个待修块里占 118 个）
 * 拿它来判断这块属不属于这篇材料；② 拿 GT 选项去比中它，给 N 对 N 的洞定位。
 */
function bodyMap(scan) {
  const m = new Map();
  const rd = scan && scan.alignment && scan.alignment.reading;
  for (const mod of (rd && rd.modules) || []) {
    for (const hit of mod.matched || []) {
      const b = hit.block || {};
      m.set(`${mod.module}#${hit.n}`, String(b.body || ""));
    }
  }
  return m;
}

/**
 * GT 题在某个洞的屏幕正文里比中几个选项（+ 题干算 2 分）。
 * 选项要够长才算数：OCR 粘连之后短选项（"Yes"/"Both"）会到处误命中。
 */
function bodyScore(q, rawBody) {
  const body = norm(rawBody);
  if (!body) return 0;
  let s = 0;
  for (const o of q.options || []) {
    const n = norm(o);
    if (n.length >= 12 && body.includes(n)) s += 1;
  }
  const ns = norm(q.stem);
  if (ns.length >= 20 && body.includes(ns)) s += 2;
  return s;
}

const parseKey = (k) => {
  const m = /^reading\|(\d+)\|(\d+)-(\d+)\|(\d+)$/.exec(String(k || ""));
  return m ? { module: Number(m[1]), qs: Number(m[2]), qe: Number(m[3]), total: Number(m[4]) } : null;
};

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const repIdx = args.indexOf("--report");
  const reportPath = repIdx >= 0 ? args[repIdx + 1] : null;
  const named = args.filter((a, i) => !a.startsWith("--") && !(repIdx >= 0 && i === repIdx + 1));

  const gtAll = JSON.parse(fs.readFileSync(GT_FILE, "utf8")).items || [];
  const bySet = new Map();
  for (const p of gtAll) { if (!bySet.has(p.source)) bySet.set(p.source, []); bySet.get(p.source).push(p); }

  const sets = named.length ? named : [...bySet.keys()];
  const injected = [], skipped = [];
  let touchedSets = 0;

  for (const setname of sets) {
    const passages = bySet.get(setname) || [];
    if (!passages.length) continue;
    const sp = path.join(OUT_DIR, `${setname}.structured.json`);
    const jp = path.join(OUT_DIR, `${setname}.json`);
    if (!fs.existsSync(sp) || !fs.existsSync(jp)) { skipped.push({ set: setname, why: "缺 structured/ingest 产物" }); continue; }
    const data = JSON.parse(fs.readFileSync(sp, "utf8"));
    const scan = JSON.parse(fs.readFileSync(jp, "utf8"));
    const ansOf = answerMap(scan);
    const bodies = bodyMap(scan);

    const blocks = (data.results || [])
      .filter((r) => r.section === "reading" && parseKey(r.key))
      .map((r) => ({ r, k: parseKey(r.key) }))
      .sort((a, b) => a.k.module - b.k.module || a.k.qs - b.k.qs);

    let changed = false;
    for (const P of passages) {
      // 该篇材料下的所有块：材料对得上，或块里压根没材料时拿 GT 正文的词做粗筛
      // 块自己没抽出 material（items 为空的块）就拿该屏的 OCR 原文顶上判归属。
      const matOf = (b) => (b.r.items || []).map((i) => i.material).find(Boolean)
        || bodies.get(`${b.k.module}#${b.k.qs}`) || "";
      const cand = blocks.filter((b) => {
        const mat = matOf(b);
        return mat && sameMaterial(mat, P.passage);
      });
      if (!cand.length) { skipped.push({ set: setname, id: P.id, why: "找不到同篇材料的块" }); continue; }

      const stemOf = (b) => ((b.r.items || [])[0] || {}).stem || "";
      const isOk = (b) => b.r.status === "ok" && countWords(stemOf(b)) >= 2;

      // 1. 锚点
      const anchor = new Map();           // gtIdx -> block
      const usedBlocks = new Set();
      P.questions.forEach((q, gi) => {
        for (const b of cand) {
          if (usedBlocks.has(b.r.key)) continue;
          if (sameStem(q.stem, stemOf(b))) { anchor.set(gi, b); usedBlocks.add(b.r.key); break; }
        }
      });

      // 2. 槽位：非 ok 的块，且已抽出的 stem 为空（非空却对不上任何 GT 题干 = 别的题，排除）
      const slots = cand.filter((b) => !usedBlocks.has(b.r.key) && !isOk(b) && countWords(stemOf(b)) < 2);
      const excluded = cand.filter((b) => !usedBlocks.has(b.r.key) && !isOk(b) && countWords(stemOf(b)) >= 2);
      const restGi = P.questions.map((_, gi) => gi).filter((gi) => !anchor.has(gi));

      if (!restGi.length) continue;                       // GT 每题都已落位，没什么可补的
      if (restGi.length !== slots.length) {
        skipped.push({
          set: setname, id: P.id,
          why: `槽位数对不上：待补 GT 题 ${restGi.length} vs 可填空块 ${slots.length}`
            + (excluded.length ? `（另有 ${excluded.length} 个块已抽出别的题干，已排除：${excluded.map((b) => "Q" + b.k.qs).join(",")}）` : ""),
        });
        continue;
      }

      // 3. 定位剩余 GT 题 → 剩余洞
      const assign = new Map(anchor);
      let how = "";
      if (restGi.length === 1) {
        assign.set(restGi[0], slots[0]);                  // 一对一，唯一解
        how = "唯一洞";
      } else {
        // N 对 N：拿选项去比屏幕正文，每个洞必须有唯一赢家（严格大于次高分且 ≥1 分）
        const pairs = [];
        let ok = true;
        for (const gi of restGi) {
          const scored = slots.map((b) => ({ b, s: bodyScore(P.questions[gi], bodies.get(`${b.k.module}#${b.k.qs}`)) }))
            .sort((x, y) => y.s - x.s);
          if (!(scored[0].s >= 1 && scored[0].s > scored[1].s)) { ok = false; break; }
          pairs.push({ gi, b: scored[0].b, s: scored[0].s });
        }
        if (!ok || new Set(pairs.map((p) => p.b.r.key)).size !== pairs.length) {
          skipped.push({
            set: setname, id: P.id,
            why: `${restGi.length} 道待补题对 ${slots.length} 个洞（Q${slots.map((b) => b.k.qs).join(",")}），`
              + `选项比对分不出唯一解，整篇跳过`,
          });
          continue;
        }
        for (const p of pairs) assign.set(p.gi, p.b);
        how = `选项比中屏幕正文(${pairs.map((p) => "Q" + p.b.k.qs + ":" + p.s + "分").join(" ")})`;
      }

      // 4. 注入
      for (const gi of restGi) {
        const b = assign.get(gi);
        const q = P.questions[gi];
        const rec = b.r;
        if (rec.gt_injected) continue;                                   // 幂等
        const cur = (rec.items || [])[0] || {};
        const letter = cur.answer_key || ansOf.get(`${b.k.module}#${b.k.qs}`) || null;
        // 材料：优先用同篇已 ok 块里最长的那份（保证 build_bank 的 groupByMaterial 并进同一篇）
        let material = String(cur.material || "");
        for (const o of cand) {
          if (!isOk(o)) continue;
          const m = String(((o.r.items || [])[0] || {}).material || "");
          if (m.length > material.length) material = m;
        }
        if (countWords(material) < 12) material = String(P.passage || "");
        const kind = String(cur.material_kind
          || (((cand.find(isOk) || {}).r || { items: [] }).items || [])[0]?.material_kind
          || "passage");

        const item = {
          q_number: b.k.qs,
          material,
          material_kind: kind,
          stem: String(q.stem || "").trim(),
          options: (q.options || []).map((o) => String(o).trim()),
          answer_key: letter,
          gt_source: P.id,
        };
        const problems = [...verifyMcq(item), ...stampAnswer(item, letter)];
        if (problems.length || item.options.length !== 4) {
          skipped.push({ set: setname, id: P.id, q: b.k.qs, why: `校验不过：${problems.join("；") || "选项数不是 4"}` });
          continue;
        }
        rec.items = [item];
        rec.status = "ok";
        rec.problems = [];
        rec.gt_injected = true;
        changed = true;
        injected.push({
          set: setname, gt_id: P.id, module: b.k.module, q: b.k.qs, type: rec.type,
          stem: item.stem, options: item.options, answer: LETTERS[item.answer_index].toUpperCase(),
          anchored: anchor.size, slots: slots.length, located_by: how,
        });
        console.log(`\n【注入】${setname}  M${b.k.module} Q${b.k.qs}  (${rec.type}, ${P.id}, 锚点 ${anchor.size}/${P.questions.length}, 定位=${how})`);
        console.log(`  题干：${item.stem}`);
        item.options.forEach((o, i) => console.log(`    ${LETTERS[i].toUpperCase()}. ${o}${i === item.answer_index ? "   ← 答案页" : ""}`));
        console.log(`  答案字母：${LETTERS[item.answer_index].toUpperCase()}（来自 ${cur.answer_key ? "item.answer_key" : "alignment"}）`);
      }
    }

    if (changed) {
      touchedSets += 1;
      if (!dry) {
        const { synced } = writeStructured(OUT_DIR, setname, data);
        console.log(`  → 写回 ${setname}.structured.json${synced ? "（已同步 rw 阅读基线）" : ""}`);
      }
    }
  }

  console.log(`\n■ GT 兜底${dry ? "（--dry，未写盘）" : ""}：注入 ${injected.length} 题 / ${touchedSets} 卷；跳过 ${skipped.length} 处`);
  const bySetCount = injected.reduce((m, x) => { m[x.set] = (m[x.set] || 0) + 1; return m; }, {});
  console.log("  按卷：", JSON.stringify(bySetCount));
  if (skipped.length) {
    console.log("\n-- 跳过原因（前 30）--");
    skipped.slice(0, 30).forEach((s) => console.log(`  ${s.set} ${s.id || ""}${s.q ? " Q" + s.q : ""}：${s.why}`));
  }
  if (reportPath) {
    fs.writeFileSync(reportPath, JSON.stringify({ generated_at: new Date().toISOString(), dry, injected, skipped }, null, 2), "utf8");
    console.log(`\n清单 → ${reportPath}`);
  }
}

main();
