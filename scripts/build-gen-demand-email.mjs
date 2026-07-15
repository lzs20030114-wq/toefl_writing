#!/usr/bin/env node
/**
 * build-gen-demand-email.mjs — 从 data/.gen-demand.json 生成每晚对账邮件。
 *
 * 为什么要有这封邮件：demand 为空的夜晚 routine 按设计不出题，但从外面看
 * 和 routine 挂了一模一样。这封邮件把两种情况区分开——它本身就是信号
 * workflow 的心跳（发不出去 = workflow 红掉，绝不 continue-on-error）。
 *
 * 输出：
 *   - stdout 打一行 `subject=...`（workflow grep 进 GITHUB_OUTPUT）
 *   - 正文（中文纯文本）写到 --out 指定的文件（默认 /tmp/gen-demand-email.txt）
 *
 * 用法: node scripts/build-gen-demand-email.mjs [--out <path>]
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEMAND_PATH = resolve(ROOT, "data/.gen-demand.json");

const outIdx = process.argv.indexOf("--out");
const OUT_PATH = outIdx !== -1 && process.argv[outIdx + 1]
  ? resolve(process.argv[outIdx + 1])
  : "/tmp/gen-demand-email.txt";

// 心跳语义：文件缺失/坏 JSON 就让脚本炸，workflow 变红比静默假绿好。
const demand = JSON.parse(readFileSync(DEMAND_PATH, "utf8"));

// ---- 北京时间格式化 ----
function beijing(date, opts) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", ...opts }).format(date);
}
const todayBJ = beijing(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" }); // YYYY-MM-DD
const generatedAtBJ = (() => {
  const d = new Date(demand.generated_at);
  if (!Number.isFinite(d.getTime())) return "未知";
  const day = beijing(d, { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = beijing(d, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${time}`;
})();

// ---- 主题 ----
const instructions = Array.isArray(demand.routine_instructions) ? demand.routine_instructions : [];
const banks = demand.banks || {};
// routine 今晚会出的库（与 routine_instructions 同口径：generate 且非 not_in_routine）
const planned = Object.entries(banks).filter(([, b]) => b.generate && !b.not_in_routine);

let subject;
if (instructions.length === 0) {
  subject = `【按需出题】今晚无需出题 ✅ (${todayBJ})`;
} else {
  const list = planned.map(([k, b]) => `${k}×${b.n}`).join(", ");
  subject = `【按需出题】今晚计划: ${list}`;
}

// ---- 正文 ----
const lines = [];
lines.push("按需出题信号 · 每晚对账");
lines.push("");
lines.push(`信号生成时间: ${demand.generated_at}（北京时间 ${generatedAtBJ}）`);
lines.push(`近 ${demand.window_days ?? 7} 天活跃用户: ${demand.active_users ?? 0}`);
lines.push("");

if (instructions.length === 0) {
  lines.push("【今晚计划】所有库存充足，routine 今晚按设计跳过出题（不是故障）。");
} else {
  lines.push("【今晚计划】");
  for (const ins of instructions) lines.push(`  - ${ins}`);
}

// interview 特例：触发了但 routine 不会出，需要人看见。
const interview = banks.interview;
if (interview && interview.generate) {
  lines.push("");
  lines.push(`⚠ interview 已触发生成（n=${interview.n}），但标记 not_in_routine：routine 不会出，需人工关注。`);
}

lines.push("");
lines.push("【各库状态】（需出题的排前面）");
const header =
  "bank".padEnd(16) + "库存".padEnd(6) + "top用户%".padEnd(10) + "最小跑道(天)".padEnd(13) + "触发".padEnd(10) + "n";
lines.push(header);

const entries = Object.entries(banks);
// generate=true 在前（按 n 降序），其余保持文件内顺序。
const sorted = [
  ...entries.filter(([, b]) => b.generate).sort((a, b) => (b[1].n || 0) - (a[1].n || 0)),
  ...entries.filter(([, b]) => !b.generate),
];
for (const [key, b] of sorted) {
  const pct = `${Math.round((b.top_user_pct || 0) * 1000) / 10}%`;
  const runway = b.min_user_runway_days === null || b.min_user_runway_days === undefined
    ? "-" : String(b.min_user_runway_days);
  const trig = (b.triggers || []).join(",") || "-";
  const mark = b.not_in_routine ? "*" : "";
  lines.push(
    (key + mark).padEnd(16) + String(b.bank_size).padEnd(6) + pct.padEnd(10) +
    runway.padEnd(13) + trig.padEnd(10) + String(b.n ?? 0),
  );
}
lines.push("（* = not_in_routine，routine 不出这个库）");

lines.push("");
lines.push("【判读指南】");
lines.push("  - 没收到本邮件 = 信号 workflow 没跑成（去 GitHub Actions 查 gen-demand）。");
lines.push("  - 收到「无需出题」+ 明早无出题 commit = 正常。");
lines.push("  - 收到「计划出题」+ 明早无出题 commit = routine 没跑，需检查。");
lines.push("");

writeFileSync(OUT_PATH, lines.join("\n"));
console.log(`subject=${subject}`);
console.log(`[gen-demand-email] body written to ${OUT_PATH} (${lines.length} lines)`);
