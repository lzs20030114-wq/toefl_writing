#!/usr/bin/env node
// 回填 recalled_supplement.json 里缺失的考试日期。
//
// 背景：当初抓 examword 时，日期是从**列表页**（只显示最新 20 条）手抄成
// parse-examword.mjs 里的一张写死表，其余 24 条记 null。于是真题专区的学术讨论
// 卡片上，同样是「回忆版」，有的第二行带日期有的不带 —— 用户看着像 bug。
// 这个脚本直接从**详情页**把日期解析出来回填，从根上消掉那张写死表。
//
// 核心是「自校验」：库里已有 20 条可信日期，脚本必须先用同一套解析规则原样复现
// 这 20 条；复现不了就说明选取规则不对，**一个字都不写**并打印实际候选，
// 让人按真实页面结构改规则。宁可不补，不许补错 —— 这是真题库，日期是溯源信息。
//
// 用法（在能访问 examword.com 的机器上跑）：
//   node scripts/research/backfill-examword-dates.mjs              # 体检：抓页面 + 打印候选，不写文件
//   node scripts/research/backfill-examword-dates.mjs --write      # 自校验通过后回填
//   node scripts/research/backfill-examword-dates.mjs --refresh    # 忽略 .research/raw 缓存重抓
//   node scripts/research/backfill-examword-dates.mjs --listing <url>   # 详情页没日期时，改从列表页解析（可重复）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { dateCandidates, parseListing } from "./examwordDate.mjs";

const root = resolve(import.meta.dirname, "..", "..");
const rawDir = resolve(root, ".research/raw");
const bankPath = resolve(root, "data/academicWriting/recalled_supplement.json");

const P_MIN = 1500;
const P_MAX = 1543;
const PAGE_URL = (p) => `https://www.examword.com/writing/discussion-example?p=${p}`;

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const REFRESH = argv.includes("--refresh");
const LISTINGS = argv.reduce((acc, a, i) => (a === "--listing" && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);

/* ── 抓取（带本地缓存，避免反复打人家站点） ─────────────────────── */

async function getPage(p) {
  const file = resolve(rawDir, `ew-${p}.html`);
  if (!REFRESH && existsSync(file)) return { html: readFileSync(file, "utf8"), cached: true };
  const res = await fetch(PAGE_URL(p), {
    headers: { "user-agent": "Mozilla/5.0 (compatible; toefl-app-research/1.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(file, html);
  await new Promise((r) => setTimeout(r, 1200)); // 礼貌间隔
  return { html, cached: false };
}

/* ── 主流程 ─────────────────────────────────────────────────────── */

const bank = JSON.parse(readFileSync(bankPath, "utf8"));
const pOf = (item) => {
  const m = String(item?.source || "").match(/[?&]p=(\d+)/);
  return m ? Number(m[1]) : null;
};
const known = new Map(); // p -> 已有的可信日期（自校验基准）
for (const it of bank) {
  const p = pOf(it);
  if (p && it.date) known.set(p, it.date);
}
console.log(`库里 ${bank.length} 条，其中 ${known.size} 条已有日期（自校验基准），${bank.length - known.size} 条待补。`);

const parsed = new Map(); // p -> iso
const diag = new Map();   // p -> 候选列表
const failures = [];

for (let p = P_MIN; p <= P_MAX; p++) {
  try {
    const { html, cached } = await getPage(p);
    const cands = dateCandidates(html);
    diag.set(p, cands);
    const iso = cands.length ? cands[0].iso : null;
    if (iso) parsed.set(p, iso);
    process.stdout.write(`p=${p} ${cached ? "(缓存)" : "(抓取)"} → ${iso || "无日期"}\n`);
  } catch (e) {
    failures.push(`${p}:${e.message}`);
    process.stdout.write(`p=${p} 失败：${e.message}\n`);
  }
}

for (const url of LISTINGS) {
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; toefl-app-research/1.0)" } });
    const pairs = parseListing(await res.text());
    let added = 0;
    for (const [p, iso] of pairs) if (!parsed.has(p)) { parsed.set(p, iso); added++; }
    console.log(`列表页 ${url}：解析出 ${pairs.size} 组，补充 ${added} 条详情页没给到的。`);
  } catch (e) {
    console.log(`列表页 ${url} 抓取失败：${e.message}`);
  }
}

/* 自校验：已有的 20 条必须被同一套规则原样复现 */
const mismatches = [];
for (const [p, expect] of known) {
  const got = parsed.get(p) || null;
  if (got !== expect) mismatches.push({ p, expect, got });
}

console.log(`\n自校验：基准 ${known.size} 条，吻合 ${known.size - mismatches.length} 条，不符 ${mismatches.length} 条。`);
if (mismatches.length) {
  console.log("\n不符明细（解析规则需要按真实页面结构调整，本次不写任何文件）：");
  for (const { p, expect, got } of mismatches) {
    console.log(`  p=${p} 期望 ${expect}，解析得 ${got || "无"}`);
    for (const c of (diag.get(p) || []).slice(0, 4)) {
      console.log(`      候选 ${c.iso} (分 ${c.score}${c.inTitle ? " 标题" : ""}) …${c.ctx}…`);
    }
  }
  console.log("\n改 dateCandidates() 的打分规则后重跑（页面已缓存在 .research/raw，不会再打站点）。");
  process.exit(1);
}

const fills = [];
for (const it of bank) {
  const p = pOf(it);
  if (!p || it.date) continue;
  const iso = parsed.get(p) || null;
  if (iso) fills.push({ id: it.id, p, iso });
}
const stillEmpty = bank.filter((it) => !it.date && !parsed.get(pOf(it))).map((it) => it.id);

console.log(`\n可回填 ${fills.length} 条：`);
for (const f of fills) console.log(`  ${f.id} (p=${f.p}) → ${f.iso}`);
if (stillEmpty.length) console.log(`仍无日期 ${stillEmpty.length} 条（源站本身没标，保持 null）：${stillEmpty.join(", ")}`);
if (failures.length) console.log(`抓取失败 ${failures.length} 页：${failures.join(", ")}`);

if (!WRITE) {
  console.log("\n体检模式，未写文件。确认无误后加 --write 回填。");
  process.exit(0);
}
if (!fills.length) {
  console.log("\n没有可回填的条目，文件未改动。");
  process.exit(0);
}

const byId = new Map(fills.map((f) => [f.id, f.iso]));
for (const it of bank) if (byId.has(it.id)) it.date = byId.get(it.id);
writeFileSync(bankPath, JSON.stringify(bank, null, 2) + "\n");
const dated = bank.filter((b) => b.date).length;
console.log(`\n已回填 ${fills.length} 条 → ${bankPath}`);
console.log(`现在 ${bank.length} 条里 ${dated} 条带考试日期。`);
console.log("记得同步改 data/REFERENCE_BANKS.md 里「20 carry exam dates」那句，并重跑 node scripts/research/build-inventory.mjs。");
