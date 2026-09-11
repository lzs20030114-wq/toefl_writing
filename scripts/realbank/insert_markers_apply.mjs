#!/usr/bin/env node
/**
 * 真题阅读「插入句题 ■ 标记」候选 → 正式标记表。
 *
 * restore_insert_markers.py --fill 产出的
 * `.codex-tmp/realbank/insert-markers.candidates.json` 只过了一道最粗的初检
 * （恰好 4 个 ■）。这里补上真正的闸门：拿候选正文与**库里那道题的材料**逐条过
 * `insert_markers.js` 的 validateMarked（4 个 ■ / 不在首尾 / 不连着 / 与原材料
 * token 覆盖率 ≥0.92），过了才合并进
 * `data/realBank/reading/insert-markers.json`。
 *
 * 为什么闸门放在这里而不是 python 侧：判据必须与 build_bank.mjs 落库时用的**同一份代码**，
 * 两边各写一遍迟早会漂 —— 落库那一刻真正生效的是 insert_markers.js，那就在这里调它。
 *
 * 合并规则：同 (set, module, q_number) 覆盖，其余保留；写进去的条目一律
 * `verified: true, by: "qwen3-vl"`。校验不过的只打印原因，绝不落表
 * （表里进了一段错的正文，等于把**另一篇文章**塞进这道题）。
 *
 * 用法:
 *   node scripts/realbank/insert_markers_apply.mjs --dry-run   # 只打印，不写文件
 *   node scripts/realbank/insert_markers_apply.mjs
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { validateMarked } = require("./insert_markers.js");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, ".codex-tmp", "realbank");
const BANK_DIR = path.join(ROOT, "data", "realBank", "reading");
const CANDIDATES = path.join(OUT_DIR, "insert-markers.candidates.json");
const TABLE = path.join(BANK_DIR, "insert-markers.json");

const BY = "qwen3-vl";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** ap/rdl 的材料正文（字段名不同，与 build_bank.buildMcqGroup 一致）。 */
function bankMaterial(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item.passage === "string") return item.passage;
  if (typeof item.text === "string") return item.text;
  return "";
}

function loadBankIndex(bankDir) {
  const byId = new Map();
  for (const kind of ["ap", "rdl"]) {
    const j = readJson(path.join(bankDir, `${kind}.json`), null);
    for (const it of (j && j.items) || []) {
      if (it && it.id) byId.set(it.id, it);
    }
  }
  return byId;
}

/** (set, module, q_number) 的表键。**不用 bank_id 做键**：插入题被丢会让 id 里的簇首题号漂移。 */
function entryKey(e) {
  return `${e.set}|M${e.module}|Q${e.q_number}`;
}

function main() {
  const dry = process.argv.includes("--dry-run");
  const candFile = process.argv.includes("--candidates")
    ? process.argv[process.argv.indexOf("--candidates") + 1]
    : CANDIDATES;
  const tableFile = process.argv.includes("--table")
    ? process.argv[process.argv.indexOf("--table") + 1]
    : TABLE;
  const bankDir = process.argv.includes("--bank-dir")
    ? process.argv[process.argv.indexOf("--bank-dir") + 1]
    : BANK_DIR;

  const cand = readJson(candFile, null);
  if (!cand || !Array.isArray(cand.candidates)) {
    console.error(`读不到候选文件 ${candFile}（先跑 restore_insert_markers.py --fill）`);
    return 2;
  }
  const bank = loadBankIndex(bankDir);
  const table = readJson(tableFile, null) || { entries: [] };
  const entries = Array.isArray(table.entries) ? table.entries.slice() : [];
  const index = new Map(entries.map((e, i) => [entryKey(e), i]));

  let added = 0;
  let updated = 0;
  const rejected = [];

  for (const c of cand.candidates) {
    const key = entryKey(c);
    const item = c.bank_id ? bank.get(c.bank_id) : null;
    if (!item) {
      rejected.push({ key, why: c.bank_id ? `bank_id 不在库里:${c.bank_id}` : "候选没有 bank_id" });
      continue;
    }
    const v = validateMarked(c.marked, bankMaterial(item));
    if (!v.ok) {
      rejected.push({ key, why: v.problems.join(" / ") });
      continue;
    }
    const entry = {
      set: c.set,
      module: c.module,
      q_number: c.q_number,
      bank_id: c.bank_id,
      marked: c.marked,
      by: BY,
      verified: true,
    };
    if (c.source_page) entry.note = `源截图 ${c.source_page}${c.model ? ` / ${c.model}` : ""}`;
    if (index.has(key)) {
      entries[index.get(key)] = entry;
      updated += 1;
    } else {
      index.set(key, entries.length);
      entries.push(entry);
      added += 1;
    }
    console.log(`  ✓ ${key}  ■×${v.squares}  ${c.bank_id}`);
  }

  for (const r of rejected) console.log(`  ✗ ${r.key}  ${r.why}`);

  console.log(`\n候选 ${cand.candidates.length} 条：新增 ${added} / 覆盖 ${updated} / 拒收 ${rejected.length}`);
  if (dry) {
    console.log("（--dry-run，未写任何文件）");
    return 0;
  }
  if (!added && !updated) {
    console.log("没有可写入的条目，表未改动。");
    return 0;
  }
  entries.sort((a, b) => String(entryKey(a)).localeCompare(String(entryKey(b))));
  const out = { ...table, entries };
  fs.writeFileSync(tableFile, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(`标记表 ${entries.length} 条 → ${tableFile}`);
  console.log("下一步：node scripts/realbank/build_bank.mjs（日志里看『查 insert-markers.json 找回标记救回 N 题』）");
  return 0;
}

process.exit(main());
