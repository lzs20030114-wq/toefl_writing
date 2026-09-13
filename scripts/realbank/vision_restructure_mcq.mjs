#!/usr/bin/env node
/**
 * 真题阅读选择题「看图重抽」（AP + RDL）—— 选目标 / 写回 / 回滚。看图那一步在同名 .py 里。
 *
 * 为什么要这条链、判据是什么：见 scripts/realbank/vision_mcq.js 顶部注释。
 *
 * 链路（第一来源卷；第二来源 rf/rp 的 <卷>.json 没有 alignment，这条链够不着）：
 *   1. node  vision_restructure_mcq.mjs --plan          扫 structured + 答案页 + 盲审，列出目标 → vision-mcq.todo.json
 *   2. python vision_restructure_mcq.py --fill --dry-run / --fill
 *                                                        按题号找回源截图，Qwen3-VL 只转写 → vision-mcq.candidates.json
 *   3. node  vision_restructure_mcq.mjs --apply --dry   每条打印 卷/module/q/题干/四选项/答案字母，不写盘
 *      node  vision_restructure_mcq.mjs --apply         过 stampAnswer + verifyMcq 的写回 structured（同步 rw 基线），
 *                                                        记录带 vision_restored 可追溯；被替换题的旧盲审条目摘掉
 *                                                        （内容变了，旧 verdict 作废），全部留底在 vision-mcq.applied.json
 *   4. audit_answers.mjs <卷> --section=reading --only-missing，再 --second-vote
 *   5. node  vision_restructure_mcq.mjs --revert-failed [--dry]
 *                                                        两票都不一致的撤回：记录恢复原状、摘掉的旧盲审条目放回
 *      node  vision_restructure_mcq.mjs --revert --keys "<卷>|M1|Q27,..." [--dry]   指名撤回
 *
 * 幂等：已经 vision_restored 且转写没变的记录跳过；applied 台账按 key 覆盖。
 *
 * 退出码：0 正常；2 用法/输入缺失。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const V = require("./vision_mcq.js");
const { writeStructured } = require("./structured_io.js");
const { holdDecision, sectionAgreement, auditPassed } = require("./hold_policy.js");
const { parseJsonLoose } = require("./model_output.js");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, ".codex-tmp", "realbank");
const OCR_DIRS = [path.join(ROOT, ".codex-tmp", "ocr"), path.join(ROOT, ".codex-tmp", "exam_txt")];
const TODO = path.join(OUT_DIR, "vision-mcq.todo.json");
const CANDIDATES = path.join(OUT_DIR, "vision-mcq.candidates.json");
const APPLIED = path.join(OUT_DIR, "vision-mcq.applied.json");
const FLAGS_FILE = path.join(ROOT, "data", "realBank", "source-flags.json");
const FIRST_SOURCE = /新托福真题/;
const CTW_BODY = /fill\s*in\s*the\s*missing\s*letters/i;

const readJson = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } };
const argVal = (k) => { const a = process.argv.find((x) => x.startsWith(`${k}=`)); return a ? a.slice(k.length + 1) : null; };
const argList = (k) => (argVal(k) || "").split(",").map((s) => s.trim()).filter(Boolean);
const keyOf = (set, module, q) => `${set}|M${module}|Q${q}`;

/* ── 与 build_bank.mjs 同口径：哪些卷的阅读根本不会进库（跨卷同文件 / 源料体检扣下） ── */
function readingSourceHashes(set) {
  const j = readJson(path.join(OUT_DIR, `${set}.json`));
  if (!j) return null;
  const hs = (j.files || []).filter((x) => x.role === "questions" && x.hash
    && (x.anchors ? x.anchors.reading > 0 : x.section === "reading")).map((x) => x.hash);
  return hs.length ? hs : null;
}
function setsSkippedByBuild() {
  const flags = (readJson(FLAGS_FILE, {}) || {}).sets || {};
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".structured.json")).sort();
  const seen = new Map();
  const skipped = new Map();
  for (const f of files) {
    const set = f.replace(/\.structured\.json$/, "");
    const au = readJson(path.join(OUT_DIR, `${set}.audit.json`));
    if (!au || !Array.isArray(au.audited)) { skipped.set(set, "no_audit_file"); continue; }
    const hs = readingSourceHashes(set);
    const dup = (hs || []).find((h) => seen.has(h));
    if (dup) { skipped.set(set, `dup_source_of:${seen.get(dup)}`); continue; }
    for (const h of hs || []) seen.set(h, set);
    const hold = holdDecision(flags[set] || [], "reading", { agreement: sectionAgreement(au.audited, "reading"), set });
    if (hold.held) skipped.set(set, `held:${hold.heldBy.join("/")}`);
  }
  return skipped;
}

/* ── OCR 屏幕文本：按「Question q of total」切段 ── */
const screenCache = new Map();
function screensOf(set) {
  if (screenCache.has(set)) return screenCache.get(set);
  const out = [];
  for (const d of OCR_DIRS) {
    let files = [];
    try { files = fs.readdirSync(d).filter((f) => f.startsWith(`${set}__`) && !/__img\d+\.txt$/.test(f) && !/答案|原文|听力|口语|写作|listening|speaking|writing/i.test(f)); } catch { /* 没有这个目录 */ }
    for (const f of files) {
      const txt = fs.readFileSync(path.join(d, f), "utf8");
      const hits = [...txt.matchAll(V.HEADER_RE)];
      hits.forEach((h, i) => {
        const end = i + 1 < hits.length ? hits[i + 1].index : Math.min(txt.length, h.index + 4000);
        out.push({ q: Number(h[1]), qEnd: h[2] ? Number(h[2]) : Number(h[1]), total: Number(h[3]), text: txt.slice(h.index, end) });
      });
    }
  }
  screenCache.set(set, out);
  return out;
}

/* ── --plan ── */
function plan() {
  const only = new Set(process.argv.filter((a) => a.startsWith("--set=")).map((a) => a.slice(6)));
  const cats = new Set(argList("--cats").length ? argList("--cats") : V.VISION_CATS);
  const skippedSets = setsSkippedByBuild();
  const sets = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".structured.json")).map((f) => f.replace(/\.structured\.json$/, ""))
    .filter((s) => FIRST_SOURCE.test(s) && (!only.size || only.has(s))).sort();
  const entries = [];
  const tally = {};
  const bump = (k) => { tally[k] = (tally[k] || 0) + 1; };
  for (const set of sets) {
    const scan = readJson(path.join(OUT_DIR, `${set}.json`));
    const st = readJson(path.join(OUT_DIR, `${set}.structured.json`));
    const au = readJson(path.join(OUT_DIR, `${set}.audit.json`));
    const mods = scan && scan.alignment && scan.alignment.reading && scan.alignment.reading.modules;
    if (!st || !Array.isArray(mods)) continue;
    const auditByQ = new Map(((au && au.audited) || []).filter((a) => a.section === "reading").map((a) => [Number(a.q), a]));
    for (const mod of mods) {
      const perBlock = new Map();
      for (const m of mod.matched || []) {
        const k = `${m.block.start}-${m.block.end}-${m.block.total}`;
        perBlock.set(k, (perBlock.get(k) || 0) + 1);
      }
      for (const m of mod.matched || []) {
        const blockAnswers = perBlock.get(`${m.block.start}-${m.block.end}-${m.block.total}`);
        if (blockAnswers >= 5 && CTW_BODY.test(m.block.body || "")) continue;          // 真填词块
        const q = Number(m.n);
        const letter = String(m.answer || "").trim().toLowerCase();
        if (!/^[a-h]$/.test(letter)) { bump("skip:non_letter_answer"); continue; }       // 选句题答案页给的是句首词
        const recs = (st.results || []).filter((r) => r && r.section === "reading" && Number(r.module) === Number(mod.module)
          && ((r.items || []).some((i) => i && Number(i.q_number) === q) || (Number(r.q_start) === q && Number(r.q_end) === q)));
        const rec = recs.length === 1 ? recs[0] : null;
        const audit = auditByQ.get(q) || null;
        const cat = recs.length > 1 ? "ambiguous_record" : V.classifyTarget(rec, q, audit, auditPassed(audit));
        const screens = screensOf(set).filter((s) => s.q === q && s.total === Number(m.block.total));
        const screenText = screens.map((s) => s.text).join("\n");
        const existing = rec && rec.status === "ok" ? ((rec.items || []).find((i) => Number(i.q_number) === q) || rec.items[0]) : null;
        let kind = cat;
        if (V.VISION_CATS.includes(cat)) {
          if (V.isSelectText(screenText) || V.isSelectText(existing && existing.stem)) kind = "skip:sentence_select";
          else if (V.isInsertText(screenText) || (existing && V.looksLikeInsertQuestion(existing))) kind = "skip:insert";
          else if (skippedSets.has(set)) kind = `skip:set_${skippedSets.get(set).split(":")[0]}`;
          else if (!cats.has(cat)) kind = `skip:cat_${cat}`;
        }
        bump(kind);
        if (kind !== cat || !V.VISION_CATS.includes(cat)) continue;
        entries.push({
          key: keyOf(set, mod.module, q), set, module: Number(mod.module), q, total: Number(m.block.total), answer: letter,
          category: cat, record_key: rec.key, record_type: rec.type, record_status: rec.status,
          problems: (rec.problems || []).slice(0, 3),
          existing: existing ? { stem: existing.stem, options: existing.options, answer_index: existing.answer_index } : null,
          audit: audit ? { stamped: audit.stamped, model: audit.model, second_vote: audit.second_vote || null } : null,
          has_screen_text: screens.length > 0,
        });
      }
    }
  }
  fs.writeFileSync(TODO, `${JSON.stringify({ generated: new Date().toISOString(), tally, entries }, null, 2)}\n`, "utf8");
  const byCat = entries.reduce((o, e) => { o[e.category] = (o[e.category] || 0) + 1; return o; }, {});
  console.log(`扫 ${sets.length} 卷（第一来源）。分类计数：`, tally);
  console.log(`看图重抽目标 ${entries.length} 题：`, byCat);
  console.log(`→ ${TODO}`);
  console.log("下一步：python scripts/realbank/vision_restructure_mcq.py --fill --dry-run");
  return 0;
}

/* ── --apply ── */
function loadApplied() {
  const j = readJson(APPLIED, null);
  return j && j.entries ? j : { entries: {} };
}
function saveApplied(j) {
  fs.writeFileSync(APPLIED, `${JSON.stringify(j, null, 2)}\n`, "utf8");
}

function apply() {
  const dry = process.argv.includes("--dry");
  const cand = readJson(argVal("--candidates") || CANDIDATES);
  if (!cand || !Array.isArray(cand.candidates)) {
    console.error(`读不到候选 ${argVal("--candidates") || CANDIDATES}（先跑 vision_restructure_mcq.py --fill）`);
    return 2;
  }
  const only = new Set(argList("--keys"));
  const applied = loadApplied();
  const bySet = new Map();
  for (const c of cand.candidates) {
    if (only.size && !only.has(c.key)) continue;
    if (!bySet.has(c.set)) bySet.set(c.set, []);
    bySet.get(c.set).push(c);
  }
  const at = new Date().toISOString();
  const tally = { applied: 0, rejected: 0, unchanged_audit_disagree: 0, already: 0, stale: 0 };
  const report = [];
  const touchedSets = [];
  for (const [set, list] of [...bySet.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const stPath = path.join(OUT_DIR, `${set}.structured.json`);
    const auPath = path.join(OUT_DIR, `${set}.audit.json`);
    const st = readJson(stPath);
    const au = readJson(auPath);
    if (!st || !au) { console.log(`✗ ${set}：缺 structured / audit`); continue; }
    let changedSt = false, changedAu = false;
    list.sort((a, b) => a.module - b.module || a.q - b.q);
    for (const c of list) {
      const tag = `${c.key}（${c.category}）`;
      const idx = (st.results || []).findIndex((r) => r && r.key === c.record_key);
      const rec = idx >= 0 ? st.results[idx] : null;
      if (!rec) { tally.stale += 1; console.log(`✗ ${tag}：记录 ${c.record_key} 不在了`); continue; }
      const parsed = c.parsed || parseJsonLoose(c.raw);
      if (rec.vision_restored && rec.status === "ok") {
        const cur = (rec.items || [])[0];
        if (cur && parsed && V.sameQuestion(cur, parsed)) { tally.already += 1; console.log(`= ${tag}：已写回过，转写未变，跳过`); continue; }
      }
      // 池：同卷同 module 已 ok 的选择题材料（排除本条），外加本轮先写回的同篇新题。
      // 先只在「盲审已过」（= 已在库里那一篇）的里面找：新题要并进的是库里已有的那一组，
      // 沿用一份没过审的变体材料，build_bank 可能把新题单独成组。找不到再放宽到全部 ok 记录。
      const passedQ = new Set((au.audited || []).filter((a) => a.section === "reading" && auditPassed(a)).map((a) => Number(a.q)));
      const pool = (st.results || []).filter((r) => r && r !== rec && r.section === "reading" && Number(r.module) === Number(c.module)
        && r.status === "ok" && r.type !== "ctw")
        .flatMap((r) => (r.items || []).map((it) => ({
          material: it.material, material_kind: it.material_kind, type: r.type, key: r.key, passed: passedQ.has(Number(it.q_number)),
        })));
      let pick = V.pickMaterial(parsed && parsed.material, pool.filter((p) => p.passed));
      if (!pick.from) pick = V.pickMaterial(parsed && parsed.material, pool);
      const type = pick.type
        || (c.record_type && c.record_type !== "ctw" ? c.record_type : null)
        || (String(pick.material).trim().split(/\s+/).filter(Boolean).length >= 160 ? "ap" : "rdl");
      const built = V.buildItem(parsed, { q: c.q, answer: c.answer, material: pick.material, material_kind: pick.material_kind });
      console.log(`\n[${c.set} M${c.module} Q${c.q}] ${c.category} 答案页=${c.answer.toUpperCase()} 源=${c.source_page || "?"}`
        + ` 材料=${pick.from ? `沿用 ${pick.from}` : "转写正文"} → ${type}`);
      if (parsed) {
        console.log(`  题干：${String(parsed.stem || "").slice(0, 110)}`);
        (Array.isArray(parsed.options) ? parsed.options : []).forEach((o, i) => console.log(`    ${"ABCDEFGH"[i]}. ${String(o).slice(0, 90)}${i === "abcdefgh".indexOf(c.answer) ? "   ←答案页" : ""}`));
      }
      const row = { key: c.key, category: c.category, answer: c.answer, type, material_from: pick.from, source_page: c.source_page || null,
        stem: parsed && parsed.stem, options: parsed && parsed.options };
      report.push(row);
      if (!built.ok) { tally.rejected += 1; row.decision = "rejected"; row.problems = built.problems; console.log(`  ✗ 不收：${built.problems.join("；")}`); continue; }
      const prevItem = rec.status === "ok" ? ((rec.items || []).find((i) => Number(i.q_number) === c.q) || rec.items[0]) : null;
      if (c.category === "audit_disagree" && prevItem && V.sameQuestion(prevItem, built.item)) {
        tally.unchanged_audit_disagree += 1;
        row.decision = "unchanged_keep_excluded";
        console.log("  = 重转写与原结构化逐字一致（不是转写错位）→ 保持排除，不做第三票");
        continue;
      }
      if (c.category === "audit_disagree") {
        console.log(`  ≠ 与原结构化不同${V.sameOptionsDifferentOrder(prevItem, built.item) ? "（选项同集合、顺序变了：原转写错位）" : ""} → 替换并重审`);
      }
      const next = V.restoredRecord(rec, built.item, {
        type, model: c.model, at, category: c.category, source_page: c.source_page || null, material_from: pick.from,
      });
      // 旧盲审条目：内容变了就作废（只摘本题，其余原样），留底以便回滚
      const removedAudit = (au.audited || []).filter((a) => a.section === "reading" && Number(a.q) === Number(c.q));
      const removedDisagree = (au.disagree || []).filter((d) => d.section === "reading" && Number(d.q) === Number(c.q));
      const prevApplied = applied.entries[c.key];
      applied.entries[c.key] = {
        key: c.key, set: c.set, module: c.module, q: c.q, category: c.category, record_key: rec.key, at,
        material_from: pick.from, type,
        stem: built.item.stem, options: built.item.options, answer: c.answer,
        // 回滚基准：第一次写回之前的原记录与原盲审条目（重复 apply 不覆盖原状）
        prev_record: prevApplied ? prevApplied.prev_record : rec,
        removed_audit: prevApplied ? prevApplied.removed_audit : removedAudit,
        removed_disagree: prevApplied ? prevApplied.removed_disagree : removedDisagree,
        status: "applied",
      };
      st.results[idx] = next;
      changedSt = true;
      if (removedAudit.length || removedDisagree.length) {
        au.audited = (au.audited || []).filter((a) => !(a.section === "reading" && Number(a.q) === Number(c.q)));
        au.disagree = (au.disagree || []).filter((d) => !(d.section === "reading" && Number(d.q) === Number(c.q)));
        changedAu = true;
        console.log(`  摘掉旧盲审条目 ${removedAudit.length} 条（内容变了，待 --only-missing 重审）`);
      }
      tally.applied += 1;
      row.decision = "applied";
      row.prev = prevItem ? { stem: prevItem.stem, options: prevItem.options, answer_index: prevItem.answer_index } : null;
      row.reordered = !!(prevItem && V.sameOptionsDifferentOrder(prevItem, built.item));
      console.log("  ✓ 写回");
    }
    if ((changedSt || changedAu) && !dry) {
      if (changedSt) writeStructured(OUT_DIR, set, st);
      if (changedAu) {
        fs.copyFileSync(auPath, path.join(OUT_DIR, `${set}.audit.prev.json`));
        au.auditable = au.audited.length;
        au.agree = au.audited.filter((a) => a && a.agree === true).length;
        au.nulls = au.audited.filter((a) => a && a.model == null).length;
        fs.writeFileSync(auPath, JSON.stringify(au, null, 2), "utf8");
      }
      touchedSets.push(set);
    }
  }
  if (!dry) saveApplied(applied);
  const reportPath = argVal("--report");
  if (reportPath) fs.writeFileSync(reportPath, `${JSON.stringify({ dry, at, tally, rows: report }, null, 2)}\n`, "utf8");
  console.log(`\n写回 ${tally.applied} / 不收 ${tally.rejected} / audit_disagree 转写未变保持排除 ${tally.unchanged_audit_disagree}`
    + ` / 已写回跳过 ${tally.already} / 记录不在 ${tally.stale}${dry ? "（--dry，未写盘）" : ""}`);
  if (!dry && touchedSets.length) {
    console.log("下一步（只审写回的题）：");
    for (const s of touchedSets) console.log(`  node scripts/realbank/audit_answers.mjs "${s}" --section=reading --only-missing`);
  }
  return 0;
}

/* ── --revert / --revert-failed ── */
function revert() {
  const dry = process.argv.includes("--dry");
  const failedOnly = process.argv.includes("--revert-failed");
  const applied = loadApplied();
  const keys = failedOnly ? null : new Set(argList("--keys"));
  if (!failedOnly && !keys.size) { console.error("--revert 需要 --keys=<卷>|M1|Q27,..."); return 2; }
  const bySet = new Map();
  for (const e of Object.values(applied.entries)) {
    if (e.status !== "applied") continue;
    if (keys && !keys.has(e.key)) continue;
    if (!bySet.has(e.set)) bySet.set(e.set, []);
    bySet.get(e.set).push(e);
  }
  let reverted = 0, kept = 0, pending = 0;
  for (const [set, list] of bySet) {
    const stPath = path.join(OUT_DIR, `${set}.structured.json`);
    const auPath = path.join(OUT_DIR, `${set}.audit.json`);
    const st = readJson(stPath);
    const au = readJson(auPath);
    let changed = false;
    for (const e of list) {
      const cur = (au.audited || []).find((a) => a.section === "reading" && Number(a.q) === Number(e.q));
      if (failedOnly) {
        if (!cur) { pending += 1; console.log(`… ${e.key}：还没盲审，先跑 --only-missing`); continue; }
        if (auditPassed(cur)) { kept += 1; continue; }
        if (cur.agree !== true && !cur.second_vote) { pending += 1; console.log(`… ${e.key}：第一票不一致，还没第二票，先跑 --second-vote`); continue; }
      }
      const idx = (st.results || []).findIndex((r) => r && r.key === e.record_key);
      if (idx >= 0) st.results[idx] = e.prev_record;
      au.audited = (au.audited || []).filter((a) => !(a.section === "reading" && Number(a.q) === Number(e.q))).concat(e.removed_audit || []);
      au.disagree = (au.disagree || []).filter((d) => !(d.section === "reading" && Number(d.q) === Number(e.q))).concat(e.removed_disagree || []);
      e.status = "reverted";
      e.reverted_at = new Date().toISOString();
      e.revert_reason = failedOnly ? `两票都不一致（第一票 ${cur.model || "-"} / 第二票 ${(cur.second_vote && cur.second_vote.pick) || "-"} / 答案页 ${cur.stamped}）` : "指名撤回";
      e.reverted_audit = cur || null;
      changed = true;
      reverted += 1;
      console.log(`↩ ${e.key}：${e.revert_reason}`);
    }
    if (changed && !dry) {
      writeStructured(OUT_DIR, set, st);
      fs.copyFileSync(auPath, path.join(OUT_DIR, `${set}.audit.prev.json`));
      au.auditable = au.audited.length;
      au.agree = au.audited.filter((a) => a && a.agree === true).length;
      au.nulls = au.audited.filter((a) => a && a.model == null).length;
      fs.writeFileSync(auPath, JSON.stringify(au, null, 2), "utf8");
    }
  }
  if (!dry) saveApplied(applied);
  console.log(`\n撤回 ${reverted}${failedOnly ? ` / 过审保留 ${kept} / 待审 ${pending}` : ""}${dry ? "（--dry，未写盘）" : ""}`);
  return 0;
}

function main() {
  if (process.argv.includes("--plan")) return plan();
  if (process.argv.includes("--apply")) return apply();
  if (process.argv.includes("--revert") || process.argv.includes("--revert-failed")) return revert();
  console.error("用法: node scripts/realbank/vision_restructure_mcq.mjs --plan [--set=<卷>] [--cats=a,b]"
    + " | --apply [--dry] [--keys=k1,k2] | --revert-failed [--dry] | --revert --keys=k1,k2 [--dry]");
  return 2;
}

process.exit(main());
