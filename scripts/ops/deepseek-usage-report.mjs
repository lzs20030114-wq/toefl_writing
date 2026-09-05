#!/usr/bin/env node
/**
 * DeepSeek 调用台账对账工具
 *
 * 读 .ops/deepseek-usage.jsonl（lib/ai/usageLedger.js 写的），按北京时间(UTC+8)分日汇总，
 * 输出一张对齐的文本表，用来回答「这批脚本到底跑了多少次、烧了多少钱」。
 *
 * 用法:
 *   node scripts/ops/deepseek-usage-report.mjs
 *   node scripts/ops/deepseek-usage-report.mjs --since=2026-09-01 --until=2026-09-01
 *   node scripts/ops/deepseek-usage-report.mjs --by=script
 *   node scripts/ops/deepseek-usage-report.mjs --by=day,script,label --rate=5.24
 *   node scripts/ops/deepseek-usage-report.mjs --file=/path/to/other.jsonl
 */

import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { readLedger, resolveLedgerPath, cnyPerMtok, estimateCny, formatCny } = require(
  path.resolve(here, "../../lib/ai/usageLedger.js"),
);

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const GROUPABLE = new Set(["day", "script", "label"]);
const HEADERS = { day: "日期", script: "脚本", label: "标签" };

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    const arg = String(raw || "");
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) out[arg.slice(2, eq)] = arg.slice(eq + 1);
    else out[arg.slice(2)] = "true";
  }
  return out;
}

function printHelp() {
  console.log(
    [
      "用法: node scripts/ops/deepseek-usage-report.mjs [选项]",
      "",
      "  --since=YYYY-MM-DD    起始日期（北京时间，含当天；默认最近 7 天）",
      "  --until=YYYY-MM-DD    截止日期（北京时间，含当天；默认今天）",
      "  --by=day|script|label 分组维度，可逗号组合（默认 day,script）",
      "  --rate=<CNY/M>        估价费率，默认取 DEEPSEEK_CNY_PER_MTOK 或 5.24",
      "  --file=<path>         指定台账文件（默认 .ops/deepseek-usage.jsonl）",
      "  --help                显示本帮助",
    ].join("\n"),
  );
}

/** 北京时间的 YYYY-MM-DD */
function beijingDay(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  return new Date(t + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function todayBeijing() {
  return new Date(Date.now() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftDay(day, deltaDays) {
  const base = Date.parse(`${day}T00:00:00Z`);
  return new Date(base + deltaDays * 86400000).toISOString().slice(0, 10);
}

function isDayString(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}

// 终端等宽下 CJK 占两列，按显示宽度补空格才对得齐
function displayWidth(text) {
  let w = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

function pad(text, width, align) {
  const s = String(text);
  const gap = Math.max(0, width - displayWidth(s));
  return align === "right" ? " ".repeat(gap) + s : s + " ".repeat(gap);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true" || args.h === "true") {
    printHelp();
    return;
  }

  const filePath = args.file ? path.resolve(args.file) : resolveLedgerPath();
  if (!fs.existsSync(filePath)) {
    console.log(`台账文件还不存在: ${filePath}`);
    console.log("说明: 还没有任何 DeepSeek 调用被记录（或被 DEEPSEEK_USAGE_LOG=0 关掉了）。");
    console.log("跑一次走 lib/ai/deepseekHttp.js 的脚本后会自动生成。");
    process.exit(0);
  }

  const until = isDayString(args.until) ? args.until : todayBeijing();
  const since = isDayString(args.since) ? args.since : shiftDay(until, -6);
  const rateFromArg = Number(args.rate) > 0;
  const rate = rateFromArg ? Number(args.rate) : cnyPerMtok();

  const by = String(args.by || "day,script")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => GROUPABLE.has(s));
  const dims = by.length > 0 ? by : ["day", "script"];

  const rows = readLedger(filePath);
  const buckets = new Map();
  let skippedOutOfRange = 0;

  for (const row of rows) {
    const day = beijingDay(row.ts);
    if (day !== "unknown" && (day < since || day > until)) {
      skippedOutOfRange += 1;
      continue;
    }
    const values = dims.map((d) => {
      if (d === "day") return day;
      if (d === "script") return String(row.script || "unknown");
      return String(row.label || "-");
    });
    const key = values.join("\u001f"); // 分桶 key 分隔符：用转义写法，不要在源码里放裸控制字节;
    let b = buckets.get(key);
    if (!b) {
      b = { values, calls: 0, failed: 0, prompt: 0, completion: 0, total: 0, cached: 0 };
      buckets.set(key, b);
    }
    b.calls += 1;
    if (row.ok === false) b.failed += 1;
    b.prompt += num(row.prompt_tokens);
    b.completion += num(row.completion_tokens);
    b.total += num(row.total_tokens);
    b.cached += num(row.cached_tokens);
  }

  const list = [...buckets.values()].sort((a, b) => {
    for (let i = 0; i < a.values.length; i += 1) {
      if (a.values[i] !== b.values[i]) return a.values[i] < b.values[i] ? -1 : 1;
    }
    return 0;
  });

  const totals = list.reduce(
    (acc, b) => {
      acc.calls += b.calls;
      acc.failed += b.failed;
      acc.prompt += b.prompt;
      acc.completion += b.completion;
      acc.total += b.total;
      acc.cached += b.cached;
      return acc;
    },
    { calls: 0, failed: 0, prompt: 0, completion: 0, total: 0, cached: 0 },
  );

  console.log(`DeepSeek 调用台账 · ${since} ~ ${until}（北京时间）`);
  console.log(`台账: ${filePath}`);
  console.log(
    `记录: ${rows.length} 行，命中区间 ${totals.calls} 次` +
      (skippedOutOfRange ? `，区间外 ${skippedOutOfRange} 次` : ""),
  );
  console.log("");

  if (list.length === 0) {
    console.log("该区间没有任何调用记录。");
    return;
  }

  const headerCells = [
    ...dims.map((d) => HEADERS[d]),
    "调用次数",
    "失败次数",
    "prompt tokens",
    "completion tokens",
    "total tokens",
    "≈¥",
  ];
  const aligns = [...dims.map(() => "left"), "right", "right", "right", "right", "right", "right"];

  const bodyRows = list.map((b) => [
    ...b.values,
    String(b.calls),
    String(b.failed),
    String(b.prompt),
    String(b.completion),
    String(b.total),
    formatCny(estimateCny(b.total, rate)),
  ]);
  const totalRow = [
    "合计",
    ...dims.slice(1).map(() => ""),
    String(totals.calls),
    String(totals.failed),
    String(totals.prompt),
    String(totals.completion),
    String(totals.total),
    formatCny(estimateCny(totals.total, rate)),
  ];

  const all = [headerCells, ...bodyRows, totalRow];
  const widths = headerCells.map((_, i) => Math.max(...all.map((r) => displayWidth(r[i] ?? ""))));
  const render = (cells) => cells.map((c, i) => pad(c ?? "", widths[i], aligns[i])).join("  ");

  console.log(render(headerCells));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  bodyRows.forEach((r) => console.log(render(r)));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  console.log(render(totalRow));
  console.log("");
  const rateSource = rateFromArg
    ? `费率：按 ¥${rate}/M 估算（本次由 --rate 指定；默认 ¥5.24/M 混合单价来自 9/1 账单实测）`
    : `费率：按 ¥${rate}/M 混合单价估算，9/1 账单实测`;
  console.log(
    `${rateSource}。命中缓存 ${totals.cached} tokens（缓存 token 实际更便宜，此处未打折，属保守估计）。`,
  );
}

main();
