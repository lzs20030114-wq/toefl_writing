#!/usr/bin/env node
/**
 * 听力题号重建 —— 驱动脚本（默认 --dry，只打表不写盘）。
 *
 * 算法与硬护栏见 scripts/realbank/listening_renumber.js 的头注。这里只负责 IO：
 * 读 `.codex-tmp/realbank/<卷>.json` + `<卷>.structured.json`（+ `<卷>.audit.json` 做交叉验证），
 * `--write` 时先备份 `<卷>.structured.prev.json`（与 structure_set / structured_io 同一口径），
 * 再把重排写回 structured.json，并**作废**受影响题目的旧盲审明细（旧号、新号两边都作废），
 * 让紧随其后的 `audit_answers.mjs <卷> --section=listening --only-missing` 只重审这些题。
 *
 * ── 插在哪一层、为什么 ────────────────────────────────────────────────────
 * 插在**合流之后、build_bank / audit_answers 之前**，就地改 `.structured.json`：
 *   · 重排只在**题组自己的题号带内**挪（护栏 G3），所以不会把题挪到另一段材料的转写上 ——
 *     合流已经挂好的 transcript_final / turns / audio_span 一律不受影响，不必重跑合流；
 *   · 判据（屏幕块）与产物（structured）都是现成文件，纯派生、零 API、可重复跑，幂等；
 *   · 改动面最小：merge_*_asr.py（118KB，43 套卷共用）与 build_bank.mjs 一行不动。
 * 代价：合流产物的**原始快照**（`<卷>.structured.fs_parsed.json` / `.structured.parsed.json`）
 * 里仍是旧题号，所以**重跑合流之后必须重跑本脚本**。重跑合流而忘了跑这一步不会静默出错：
 * 盲审明细是按新题号记的，旧号题配不上明细 → 按「没审过」不收（fail-closed）。
 *
 * 用法:
 *   node scripts/realbank/listening_renumber_run.mjs "3.16新托福真题"              # dry
 *   node scripts/realbank/listening_renumber_run.mjs "3.16新托福真题" --write
 *   node scripts/realbank/listening_renumber_run.mjs --all                          # 全库 dry 预估
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const R = require("./listening_renumber.js");

const OUT_DIR = path.join(process.cwd(), ".codex-tmp", "realbank");

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

/** 既有盲审明细 → { 'module#q': {model, second} }（只取听力）。 */
function auditIndexOf(audit) {
  const out = {};
  for (const a of (audit && audit.audited) || []) {
    if (a.section !== "listening" || a.module == null || a.q == null) continue;
    out[`${a.module}#${a.q}`] = { model: a.model, second: a.second_vote ? a.second_vote.pick : null, agree: a.agree };
  }
  return out;
}

/** 屏幕里有整道题、structured 却没抽出来的屏（第二阶段「补抽」的盘子）。 */
const UNCLAIMED_MIN_CHARS = 200;
function unclaimedScreens(scan, structured, plan) {
  const byMod = R.blocksByModule((scan && scan.blocks) || []);
  // 占位按**重排后**的题号算：搬走的题按新号占位，被清掉的空题不占位，其余按原号占位。
  const moved = new Map(plan.moves.map((m) => [m.item, m]));
  const gone = new Set(plan.removed.map((r) => r.item));
  const claimed = new Set();
  for (const r of (structured.results || [])) {
    if (r.section !== "listening") continue;
    for (const it of r.items || []) {
      if (gone.has(it)) continue;
      const m = moved.get(it);
      claimed.add(`${r.module}#${m ? m.toQ : it.q_number}`);
    }
  }
  const out = [];
  for (const [module, blocks] of byMod) {
    const { screens } = R.buildScreenMap(blocks);
    for (const [n, txt] of screens) {
      if (claimed.has(`${module}#${n}`)) continue;
      if (txt.length < UNCLAIMED_MIN_CHARS) continue;
      out.push({ module, q: n, chars: txt.length });
    }
  }
  return out;
}

function planFor(setname) {
  const scan = readJson(path.join(OUT_DIR, `${setname}.json`));
  const structured = readJson(path.join(OUT_DIR, `${setname}.structured.json`));
  if (!scan || !structured) return null;
  const audit = readJson(path.join(OUT_DIR, `${setname}.audit.json`));
  const plan = R.planSet({ scan, structured, auditIndex: auditIndexOf(audit) });
  return { scan, structured, audit, plan };
}

function printPlan(setname, ctx) {
  const { plan } = ctx;
  const badRuns = plan.runs.filter((r) => !r.ok);
  console.log(`\n■ ${setname}`);
  console.log(`  屏幕段 ${plan.runs.length} 段，其中 fail-closed ${badRuns.length} 段`
    + (badRuns.length ? `：${badRuns.map((r) => `M${r.module}[${r.nums.join(",")}] ${r.why}`).join("；")}` : ""));
  if (plan.moves.length) {
    console.log(`  -- 重排 ${plan.moves.length} 题 --`);
    for (const m of plan.moves) {
      const vote = m.votes && m.votes.length
        ? `  盲审票=${m.votes.map((v) => v.toUpperCase()).join("/")} ${m.voteAgrees ? "✓" : "✗"}`
        : "  盲审票=无";
      console.log(`   M${m.module} ${m.type} Q${m.fromQ}→Q${m.toQ}  答案 ${m.fromLetter.toUpperCase()}→${m.toLetter.toUpperCase()}`
        + `  相似度 ${m.score.toFixed(3)}（领先 ${m.margin.toFixed(3)}）${vote}`);
      console.log(`     ${m.stem}`);
    }
  } else {
    console.log("  -- 无题可重排 --");
  }
  if (plan.removed.length) {
    console.log(`  -- 清掉撞号的空题/残题 ${plan.removed.length} 条 --`);
    for (const r of plan.removed) console.log(`   M${r.module} Q${r.q}  ${r.detail}`);
  }
  const byReason = plan.blocked.reduce((m, b) => { m[b.reason] = (m[b.reason] || 0) + 1; return m; }, {});
  console.log(`  -- 护栏拦下 ${plan.blocked.length} 题 --  ${Object.entries(byReason).map(([k, v]) => `${k} ${v}`).join("，") || "无"}`);
  for (const b of plan.blocked) console.log(`   M${b.module} Q${b.q} [${b.reason}] ${b.detail}`);
  const unclaimed = unclaimedScreens(ctx.scan, ctx.structured, plan);
  console.log(`  -- 屏上有题、structured 没抽出来：${unclaimed.length} 屏 --`
    + (unclaimed.length ? `  ${unclaimed.map((u) => `M${u.module}Q${u.q}`).join(" ")}` : ""));
  const bad = plan.crossCheck.filter((c) => !c.ok);
  if (plan.crossCheck.length) {
    console.log(`  -- 交叉验证：${plan.crossCheck.length - bad.length}/${plan.crossCheck.length} 条重排与既有盲审票一致 --`);
    for (const c of bad) console.log(`   M${c.module} Q${c.fromQ}→Q${c.toQ} 新答案 ${c.toLetter.toUpperCase()} ≠ 票 ${c.votes.map((v) => v.toUpperCase()).join("/")}（不改判，该题按常规盲审闸走）`);
  }
  return { unclaimed };
}

/**
 * 作废受影响题目的旧盲审明细：旧号、新号两边都删，另清掉指不到任何题的孤儿条目。
 *
 * `keepAudited=true`（计划与上次逐字相同，见 R.planSignature）时只清孤儿：那份明细本来就是
 * 重排之后审出来的、按新题号记的，再删一遍等于把刚花钱审完的结果扔掉。
 */
function pruneAudit(setname, structured, plan, keepAudited) {
  const auditPath = path.join(OUT_DIR, `${setname}.audit.json`);
  const audit = readJson(auditPath);
  if (!audit || !Array.isArray(audit.audited)) return { pruned: 0, orphans: 0, path: null };
  const touched = new Set();
  if (!keepAudited) {
    for (const m of plan.moves) { touched.add(`${m.module}#${m.fromQ}`); touched.add(`${m.module}#${m.toQ}`); }
    for (const r of plan.removed) touched.add(`${r.module}#${r.q}`);
  }
  const live = new Set();
  for (const r of (structured.results || [])) {
    if (r.section !== "listening") continue;
    for (const it of r.items || []) live.add(`${r.module}#${it.q_number}`);
  }
  let pruned = 0;
  let orphans = 0;
  const next = audit.audited.filter((a) => {
    if (a.section !== "listening") return true;
    const k = `${a.module}#${a.q}`;
    if (touched.has(k)) { pruned += 1; return false; }
    if (!live.has(k)) { orphans += 1; return false; }
    return true;
  });
  if (!pruned && !orphans) return { pruned: 0, orphans: 0, path: auditPath };
  fs.copyFileSync(auditPath, path.join(OUT_DIR, `${setname}.audit.prev.json`));
  const disagree = Array.isArray(audit.disagree)
    ? audit.disagree.filter((d) => d.section !== "listening" || next.some((a) => a.module === d.module && a.q === d.q))
    : audit.disagree;
  fs.writeFileSync(auditPath, JSON.stringify({ ...audit, audited: next, disagree }, null, 2), "utf8");
  return { pruned, orphans, path: auditPath };
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const all = args.includes("--all");
  const names = args.filter((a) => !a.startsWith("--"));

  let sets = names;
  if (all) {
    sets = fs.readdirSync(OUT_DIR)
      .filter((f) => f.endsWith(".structured.json"))
      .map((f) => f.replace(/\.structured\.json$/, ""))
      .sort();
  }
  if (!sets.length) {
    console.error('用法: node scripts/realbank/listening_renumber_run.mjs "<卷名>" [--write] | --all');
    process.exit(2);
  }
  if (all && write) { console.error("--all 只做 dry 预估，不允许同时 --write"); process.exit(2); }

  const rows = [];
  for (const setname of sets) {
    const ctx = planFor(setname);
    if (!ctx) { if (!all) console.error(`缺少产物: ${setname}`); continue; }
    const hasListening = (ctx.structured.results || []).some((r) => r.section === "listening" && (r.items || []).length);
    if (all && !hasListening) continue;
    if (all) {
      const unclaimed = unclaimedScreens(ctx.scan, ctx.structured, ctx.plan);
      const badVotes = ctx.plan.crossCheck.filter((c) => !c.ok).length;
      rows.push({
        set: setname, moves: ctx.plan.moves.length, removed: ctx.plan.removed.length,
        blocked: ctx.plan.blocked.length, badRuns: ctx.plan.runs.filter((r) => !r.ok).length,
        unclaimed: unclaimed.length, crossOk: ctx.plan.crossCheck.length - badVotes, crossAll: ctx.plan.crossCheck.length,
        reasons: ctx.plan.blocked.reduce((m, b) => { m[b.reason] = (m[b.reason] || 0) + 1; return m; }, {}),
      });
      continue;
    }
    printPlan(setname, ctx);
    if (!write) { console.log("  （--dry：没有写盘。加 --write 落盘）"); continue; }
    if (!ctx.plan.moves.length && !ctx.plan.removed.length) { console.log("  没有要写的改动。"); continue; }
    const p = path.join(OUT_DIR, `${setname}.structured.json`);
    fs.copyFileSync(p, path.join(OUT_DIR, `${setname}.structured.prev.json`));
    // 计划签名：与上次逐字相同 = 这次只是在重跑合流之后把同一份重排再落一遍，盲审明细不能再作废一次。
    const stampPath = path.join(OUT_DIR, `${setname}.renumber.json`);
    const sig = R.planSignature(ctx.plan);
    const stamp = readJson(stampPath);
    const replay = Boolean(stamp && stamp.signature && stamp.signature === sig);
    const applied = R.applyPlan(ctx.structured, ctx.plan);
    fs.writeFileSync(p, JSON.stringify(ctx.structured, null, 2), "utf8");
    const pr = pruneAudit(setname, ctx.structured, ctx.plan, replay);
    fs.writeFileSync(stampPath, JSON.stringify({
      at: new Date().toISOString(), signature: sig, moves: ctx.plan.moves.length, removed: ctx.plan.removed.length,
    }, null, 2), "utf8");
    console.log(`  ✔ 写盘：重排 ${applied.renumbered} 题、清掉 ${applied.removed} 条空题；`
      + (replay
        ? `计划与上次（${stamp.at}）逐字相同 → 盲审明细保留（只清孤儿 ${pr.orphans} 条）`
        : `盲审明细作废 ${pr.pruned} 条（另清孤儿 ${pr.orphans} 条）`));
    if (!replay) console.log(`    下一步：node scripts/realbank/audit_answers.mjs "${setname}" --section=listening --only-missing`);
  }

  if (all) {
    rows.sort((a, b) => b.moves - a.moves || b.unclaimed - a.unclaimed);
    const tot = rows.reduce((m, r) => {
      m.moves += r.moves; m.removed += r.removed; m.blocked += r.blocked;
      m.badRuns += r.badRuns; m.unclaimed += r.unclaimed; m.crossOk += r.crossOk; m.crossAll += r.crossAll;
      return m;
    }, { moves: 0, removed: 0, blocked: 0, badRuns: 0, unclaimed: 0, crossOk: 0, crossAll: 0 });
    console.log("\n卷 | 重排 | 清空题 | 拦下 | 坏段 | 未抽出屏 | 交叉验证");
    for (const r of rows) {
      if (!r.moves && !r.unclaimed && !r.removed) continue;
      console.log(`${r.set} | ${r.moves} | ${r.removed} | ${r.blocked} | ${r.badRuns} | ${r.unclaimed} | ${r.crossOk}/${r.crossAll}`);
    }
    console.log(`\n合计（${rows.length} 套有听力的卷）：重排 ${tot.moves} 题、清空题 ${tot.removed} 条、`
      + `护栏拦下 ${tot.blocked} 题、fail-closed 段 ${tot.badRuns} 段、未抽出的整题屏 ${tot.unclaimed} 屏、`
      + `交叉验证 ${tot.crossOk}/${tot.crossAll}`);
    const allReasons = rows.reduce((m, r) => { for (const [k, v] of Object.entries(r.reasons)) m[k] = (m[k] || 0) + v; return m; }, {});
    console.log(`拦下原因：${Object.entries(allReasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("，")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
