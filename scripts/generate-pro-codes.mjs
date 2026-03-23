#!/usr/bin/env node
/**
 * Generate pre-paid Pro login codes with variable durations.
 *
 * Usage:
 *   node scripts/generate-pro-codes.mjs
 *   node scripts/generate-pro-codes.mjs --7d 10 --30d 20 --90d 5 --365d 5
 *
 * Outputs SQL to stdout. Redirect to a file or paste into Supabase SQL Editor.
 */

import { randomBytes } from "crypto";

// ── Config ──────────────────────────────────────────────
const DEFAULT_COUNTS = { 7: 20, 30: 20, 90: 20, 365: 20 };

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) return DEFAULT_COUNTS;

  const counts = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const num = parseInt(args[i + 1], 10);
    const match = flag.match(/^--(\d+)d$/);
    if (!match || !Number.isFinite(num) || num <= 0) {
      console.error(`Invalid argument: ${flag} ${args[i + 1]}`);
      process.exit(1);
    }
    counts[parseInt(match[1], 10)] = num;
  }
  return counts;
}

// Generate a 6-char alphanumeric code (uppercase, no ambiguous chars)
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
function generateCode() {
  const bytes = randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return code;
}

// ── Main ────────────────────────────────────────────────
const counts = parseArgs();
const allCodes = [];
const usedCodes = new Set();

for (const [days, count] of Object.entries(counts)) {
  for (let i = 0; i < count; i++) {
    let code;
    do {
      code = generateCode();
    } while (usedCodes.has(code));
    usedCodes.add(code);
    allCodes.push({ code, days: Number(days) });
  }
}

// ── Output SQL ──────────────────────────────────────────
const now = new Date().toISOString();
const lines = [];

lines.push("-- Auto-generated Pro login codes");
lines.push(`-- Generated at: ${now}`);
lines.push(`-- Total: ${allCodes.length} codes`);
lines.push("");

// Ensure pro_days column exists
lines.push("ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS pro_days INTEGER NULL;");
lines.push("");

// Group by duration for readability
const grouped = {};
for (const { code, days } of allCodes) {
  if (!grouped[days]) grouped[days] = [];
  grouped[days].push(code);
}

for (const [days, codes] of Object.entries(grouped).sort((a, b) => a[0] - b[0])) {
  lines.push(`-- ═══ ${days}-day Pro codes (${codes.length}) ═══`);
  lines.push("");

  // Insert into access_codes
  lines.push("INSERT INTO access_codes (code, status, issued_to, issued_at, pro_days, note) VALUES");
  const accessRows = codes.map(
    (c, i) =>
      `  ('${c}', 'issued', 'pre-generated', '${now}', ${days}, '${days}-day Pro code')${i < codes.length - 1 ? "," : ";"}`
  );
  lines.push(...accessRows);
  lines.push("");

  // Insert into users with status='pending', tier='pro'
  lines.push("INSERT INTO users (code, status, tier, created_at) VALUES");
  const userRows = codes.map(
    (c, i) =>
      `  ('${c}', 'pending', 'pro', '${now}')${i < codes.length - 1 ? "," : ""}`
  );
  lines.push(...userRows);
  lines.push("ON CONFLICT (code) DO NOTHING;");
  lines.push("");
}

// ── Print SQL ───────────────────────────────────────────
const sql = lines.join("\n");
console.log(sql);

// ── Print summary table to stderr ───────────────────────
console.error("\n┌─────────┬───────┬────────────────────────────────────────────┐");
console.error("│ Duration│ Count │ Codes                                      │");
console.error("├─────────┼───────┼────────────────────────────────────────────┤");
for (const [days, codes] of Object.entries(grouped).sort((a, b) => a[0] - b[0])) {
  const label = `${days}d`.padEnd(7);
  const cnt = String(codes.length).padEnd(5);
  // Print codes in rows of 5
  for (let i = 0; i < codes.length; i += 5) {
    const chunk = codes.slice(i, i + 5).join("  ");
    if (i === 0) {
      console.error(`│ ${label} │ ${cnt} │ ${chunk.padEnd(42)}│`);
    } else {
      console.error(`│         │       │ ${chunk.padEnd(42)}│`);
    }
  }
}
console.error("└─────────┴───────┴────────────────────────────────────────────┘");
console.error(`\nTotal: ${allCodes.length} codes generated.`);
console.error("Paste the SQL output into Supabase SQL Editor to activate.\n");
