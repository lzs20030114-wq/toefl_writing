#!/usr/bin/env node
/**
 * 真题录入 —— 一次性回填：给旧盲审明细补上 `module`（幂等）。
 *
 * 背景见 scripts/realbank/audit_key.js 顶部：`.audit.json` 的 `audited[]` 原来按 `section#q`
 * 认题，听力 M1/M2 题号都从 1 起编 → 撞号 → 落库的 `passedKeys` 成了并集（误放行）、
 * `--second-vote` 送审的可能是另一个 module 的题（第二票不可信）。
 *
 * 81 套卷的既有明细不能全量重审（要花钱），所以走这一步：
 *   · 唯一命中 → 填 module（占绝大多数）；
 *   · 孤儿（题已不在当前 structured 里）→ 删掉计数；
 *   · 歧义（同 type 同题号同答案字母、跨 module）→ 删掉，列进重审清单；
 *   · 撞号 (section,q) 上的 `second_vote` 一律作废（那一票解的可能是另一道题），列进重跑清单。
 *
 * 用法：
 *   node scripts/realbank/audit_backfill_module.mjs            # --dry：只打统计，不写文件
 *   node scripts/realbank/audit_backfill_module.mjs --write    # 写回（先备份 <卷>.audit.prev.json）
 *   node scripts/realbank/audit_backfill_module.mjs --write --set=3.16新托福真题   # 只处理一卷
 *
 * 写模式会产出重审计划 .codex-tmp/realbank/_module_backfill_plan.json，里面每卷给出：
 *   reaudit[]     —— 要重跑第一票的题（`--only-missing --only-key=...`）
 *   secondVote[]  —— 要重跑第二票的题（`--second-vote --only-key=...`）
 * 跑重审的命令行也一并打印出来。
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  auditKey, backfillModules, crossModuleDupKeys, stripCollidedSecondVotes, entryKey,
} = require("./audit_key.js");

const OUT_DIR = path.join(process.cwd(), ".codex-tmp", "realbank");
const PLAN_FILE = path.join(OUT_DIR, "_module_backfill_plan.json");
const LETTERS = "ABCDEFGH";

/** 与 audit_answers.mjs 的可审判据同源：带选项 + 带答案下标的题才进盲审。 */
function auditableItems(structured) {
  const items = [];
  for (const r of structured.results || []) {
    if (r.status !== "ok") continue;
    for (const it of r.items || []) {
      if (!Array.isArray(it.options) || typeof it.answer_index !== "number") continue;
      items.push({
        section: r.section, type: r.type, module: r.module,
        q: it.q_number, stamped: LETTERS[it.answer_index],
      });
    }
  }
  return items;
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const onlySet = (args.find((a) => a.startsWith("--set=")) || "").split("=")[1] || null;
  if (!fs.existsSync(OUT_DIR)) { console.error(`没有产物目录：${OUT_DIR}`); process.exit(2); }

  const files = fs.readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".audit.json"))
    .filter((f) => !onlySet || f === `${onlySet}.audit.json`)
    .sort();
  if (!files.length) { console.error("没有 .audit.json"); process.exit(2); }

  const total = { sets: 0, entries: 0, filled: 0, alreadyHad: 0, orphan: 0, ambiguous: 0, strippedSecond: 0, reaudit: 0 };
  const plan = {};
  const skipped = [];

  for (const f of files) {
    const setname = f.replace(/\.audit\.json$/, "");
    const sp = path.join(OUT_DIR, `${setname}.structured.json`);
    if (!fs.existsSync(sp)) { skipped.push(`${setname}（没有 structured 产物）`); continue; }
    const au = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8"));
    if (!Array.isArray(au.audited)) { skipped.push(`${setname}（旧格式，没有 audited）`); continue; }
    const items = auditableItems(JSON.parse(fs.readFileSync(sp, "utf8")));

    const bf = backfillModules(au.audited, items);
    const collided = crossModuleDupKeys(items);
    const sv = stripCollidedSecondVotes(bf.audited, collided);

    // 歧义条目删掉后，它的每个候选题都得重跑第一票（谁是谁分不出来，只能各审各的）
    const reaudit = [];
    for (const amb of bf.ambiguous) {
      for (const c of amb.candidates) reaudit.push(auditKey(c.section, c.module, c.q));
    }
    const secondVote = sv.stripped.map((a) => entryKey(a)).filter(Boolean);

    total.sets += 1;
    total.entries += bf.stats.total;
    total.filled += bf.stats.filled;
    total.alreadyHad += bf.stats.alreadyHad;
    total.orphan += bf.stats.orphan;
    total.ambiguous += bf.stats.ambiguous;
    total.strippedSecond += sv.stripped.length;
    total.reaudit += reaudit.length;

    const touched = bf.stats.filled || bf.stats.orphan || bf.stats.ambiguous || sv.stripped.length;
    if (touched) {
      console.log(`■ ${setname}：${bf.stats.total} 条 → 填 module ${bf.stats.filled}`
        + `（已有 ${bf.stats.alreadyHad}）· 孤儿删 ${bf.stats.orphan}`
        + ` · 歧义删 ${bf.stats.ambiguous}（重审 ${reaudit.length} 题）`
        + ` · 作废第二票 ${sv.stripped.length}`);
      for (const o of bf.orphans) console.log(`    孤儿 [${o.section}/${o.type} Q${o.q}] 答案页=${o.stamped}`);
      for (const a of bf.ambiguous) {
        console.log(`    歧义 [${a.entry.section}/${a.entry.type} Q${a.entry.q}] 答案页=${a.entry.stamped}`
          + ` → module ${a.candidates.map((c) => c.module).join("/")}`);
      }
    }
    if (reaudit.length || secondVote.length) plan[setname] = { reaudit, secondVote };

    if (write) {
      const prev = path.join(OUT_DIR, `${setname}.audit.prev.json`);
      fs.copyFileSync(path.join(OUT_DIR, f), prev);
      // 顶层计数跟着重算（口径同 audit_answers.mjs 结尾：按合并后的 audited 全量算）
      const out = { ...au, audited: sv.audited };
      out.auditable = sv.audited.length;
      out.agree = sv.audited.filter((a) => a && a.agree === true).length;
      out.nulls = sv.audited.filter((a) => a && a.model == null).length;
      fs.writeFileSync(path.join(OUT_DIR, f), JSON.stringify(out, null, 2), "utf8");
    }
  }

  console.log(`\n── 合计（${write ? "已写回" : "--dry，未写"}）──`);
  console.log(`卷 ${total.sets} · 明细 ${total.entries} 条`);
  console.log(`  填上 module ${total.filled}（本来就有 ${total.alreadyHad}）`);
  console.log(`  孤儿删除 ${total.orphan} · 歧义删除 ${total.ambiguous} → 待重审 ${total.reaudit} 题`);
  console.log(`  作废撞号第二票 ${total.strippedSecond} 条 → 待重跑第二票 ${total.strippedSecond} 题`);
  console.log(`  预计 API 调用 ${total.reaudit + total.strippedSecond} 次（第一票 ${total.reaudit} · 第二票 ${total.strippedSecond}）`);
  for (const s of skipped) console.log(`  跳过 ${s}`);

  if (write) {
    fs.writeFileSync(PLAN_FILE, JSON.stringify({
      _generated: new Date().toISOString().slice(0, 10),
      _purpose: "撞号修复后的重审计划：reaudit=重跑第一票，secondVote=重跑第二票",
      sets: plan,
    }, null, 2), "utf8");
    console.log(`\n重审计划 → ${PLAN_FILE}`);
    for (const [setname, p] of Object.entries(plan)) {
      if (p.reaudit.length) {
        console.log(`node scripts/realbank/audit_answers.mjs "${setname}" --only-missing --only-key=${p.reaudit.join(",")}`);
      }
      if (p.secondVote.length) {
        console.log(`node scripts/realbank/audit_answers.mjs "${setname}" --second-vote --only-key=${p.secondVote.join(",")}`);
      }
    }
  } else {
    console.log("\n确认无误后加 --write 写回（会先备份 <卷>.audit.prev.json）。");
  }
}

main();
