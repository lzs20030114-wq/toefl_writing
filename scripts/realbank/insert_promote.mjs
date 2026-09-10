#!/usr/bin/env node
/**
 * 真题阅读「0 个选项、被结构化判 flagged 的插入句题」转正。
 *
 * 链路：
 *   restore_insert_markers.py --list --include-flagged   todo 里带 flagged / answer_key
 *   → restore_insert_markers.py --fill                   Qwen 看源截图找回 ■
 *   → insert_markers_apply.mjs                           validateMarked 过闸进标记表
 *   → **本脚本**                                          标记表里有这段材料的带 ■ 版本 → 把 structured 里那道题改成
 *                                                        「材料标好 [A]~[D] / 选项 [A]~[D] / 按答案页字母盖 answer_index」，记录转 ok
 *   → audit_answers.mjs <卷> --section=reading --only-missing   转正的题照常盲审，不免审
 *   → build_bank.mjs
 *
 * 判据全在 insert_markers.promoteInsertItem（与 build_bank 换材料同一套 decideInsertMaterial），这里只管 IO。
 * 写回走 structured_io.writeStructured：第一来源卷同步 rw 阅读基线，免得重跑合流被冲掉。
 * 转正前的状态与 problems 留在记录的 `promoted` 字段上，可追溯、可回滚（另有 .structured.prev.json 一代备份）。
 *
 * 用法:
 *   node scripts/realbank/insert_promote.mjs --dry-run
 *   node scripts/realbank/insert_promote.mjs
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { promoteInsertItem } = require("./insert_markers.js");
const { writeStructured } = require("./structured_io.js");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, ".codex-tmp", "realbank");
const TODO = path.join(OUT_DIR, "insert-markers.todo.json");
const TABLE = path.join(ROOT, "data", "realBank", "reading", "insert-markers.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function main() {
  const dry = process.argv.includes("--dry-run");
  const todo = readJson(TODO, null);
  if (!todo || !Array.isArray(todo.entries)) {
    console.error(`读不到 ${TODO}（先跑 restore_insert_markers.py --list --include-flagged）`);
    return 2;
  }
  const table = readJson(TABLE, { entries: [] }).entries || [];
  const flagged = todo.entries.filter((e) => e && e.flagged);

  const bySet = new Map();
  for (const e of flagged) {
    if (!bySet.has(e.set)) bySet.set(e.set, []);
    bySet.get(e.set).push(e);
  }

  let promoted = 0;
  const skipped = [];
  const touched = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const [setname, entries] of bySet) {
    const st = readJson(path.join(OUT_DIR, `${setname}.structured.json`), null);
    if (!st) {
      for (const e of entries) skipped.push({ key: `${setname}|M${e.module}|Q${e.q_number}`, why: "no_structured" });
      continue;
    }
    const done = [];
    for (const e of entries) {
      const key = `${setname}|M${e.module}|Q${e.q_number}`;
      const sameQ = (it) => it && String(it.q_number) === String(e.q_number);
      const rec = (st.results || []).find((r) => r && r.section === "reading" && r.status === "flagged"
        && Number(r.module) === Number(e.module) && (r.items || []).some(sameQ));
      if (!rec) {
        skipped.push({ key, why: "record_not_flagged_or_missing" });
        continue;
      }
      const k = rec.items.findIndex(sameQ);
      const res = promoteInsertItem(rec.items[k], table, e.answer_key || rec.items[k].answer_key);
      if (!res.ok) {
        skipped.push({ key, why: res.problems.join(" / ") });
        continue;
      }
      rec.items[k] = { ...res.item, q_number: Number(e.q_number) };
      rec.promoted = { from_status: rec.status, problems: rec.problems || [], by: "insert_promote", on: today };
      rec.status = "ok";
      rec.problems = [];
      done.push(e.q_number);
      promoted += 1;
      console.log(`  ✓ ${key}  答案 ${res.item.answer_text}${res.problems.length ? `（${res.problems.join("/")}）` : ""}`);
    }
    if (done.length) {
      touched.push({ set: setname, q: done });
      if (!dry) {
        const { synced } = writeStructured(OUT_DIR, setname, st);
        if (synced) console.log(`    ${setname}：已同步 rw 阅读基线`);
      }
    }
  }

  for (const s of skipped) console.log(`  ✗ ${s.key}  ${s.why}`);
  console.log(`\nflagged 插入题 ${flagged.length} 道：转正 ${promoted} / 跳过 ${skipped.length}`
    + `${dry ? "（--dry-run，未写盘）" : ""}`);
  if (!dry && touched.length) {
    console.log("下一步（只审转正的题）：");
    for (const t of touched) {
      console.log(`  node scripts/realbank/audit_answers.mjs "${t.set}" --section=reading --only-missing`);
    }
  }
  return 0;
}

process.exit(main());
