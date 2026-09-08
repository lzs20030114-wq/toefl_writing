#!/usr/bin/env node
/**
 * 群发「真题专区上线」公告邮件（lib/mail/templates/realBankLaunch.js）。
 *
 * 收件人：users 表里有 email、且不是从未激活的预生成码（status='pending'）的用户，
 * 同一邮箱只发一次。发过的邮箱记在 .ops/state/real-bank-announcement.json，
 * 重复运行自动跳过（QQ SMTP 有日发送上限，分几天跑完是常态）。
 *
 * 默认 dry-run（只列名单不发信）。用法：
 *   node scripts/ops/send-real-bank-announcement.mjs                    # dry-run：统计 + 前 20 个收件人
 *   node scripts/ops/send-real-bank-announcement.mjs --to me@x.com      # 只发一封测试信到指定邮箱（不记台账）
 *   node scripts/ops/send-real-bank-announcement.mjs --to me@x.com --as-free   # 以免费用户视角预览
 *   node scripts/ops/send-real-bank-announcement.mjs --yes              # 真发，默认每次最多 80 封、间隔 45s
 *   node scripts/ops/send-real-bank-announcement.mjs --yes --max 50 --delay-ms 30000
 *   node scripts/ops/send-real-bank-announcement.mjs --yes --tier pro   # 只发给当前 Pro 用户（free|pro|all）
 *   node scripts/ops/send-real-bank-announcement.mjs --preview out.html # 把 HTML 写到文件看效果，不连库不发信
 *
 * Env（.env.local 自动读取）：NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY，
 *   MAIL_USER + MAIL_PASS（QQ SMTP 授权码），可选 MAIL_HOST/MAIL_PORT/MAIL_SECURE/MAIL_FROM_NAME/MAIL_FROM。
 */

import { resolve } from "path";
import { writeFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import {
  ensureOpsDirs,
  getRequiredEnv,
  loadEnv,
  opsStateDir,
  parseArgs,
  readJson,
  writeJson,
} from "./_shared.mjs";
import { buildRealBankLaunchEmail } from "../../lib/mail/templates/realBankLaunch.js";

const STATE_FILE = resolve(opsStateDir, "real-bank-announcement.json");
const DEFAULT_MAX = 80; // QQ 个人邮箱日上限约 100，留余量
const DEFAULT_DELAY_MS = 45_000; // lib/mail/send.js 注释：~45s 间隔避开 "550 Ip frequency limited"

loadEnv();
ensureOpsDirs();
const args = parseArgs(process.argv.slice(2));

function isProNow(row) {
  const tier = String(row.tier || "").toLowerCase();
  if (tier !== "pro" && tier !== "legacy") return false;
  if (!row.tier_expires_at) return true;
  const exp = new Date(row.tier_expires_at).getTime();
  return !Number.isFinite(exp) || exp > Date.now();
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

function makeTransporter() {
  const user = getRequiredEnv("MAIL_USER");
  const pass = getRequiredEnv("MAIL_PASS");
  return {
    transporter: nodemailer.createTransport({
      host: process.env.MAIL_HOST || "smtp.qq.com",
      port: Number(process.env.MAIL_PORT) || 465,
      secure: process.env.MAIL_SECURE === undefined ? true : process.env.MAIL_SECURE !== "false",
      auth: { user, pass },
      pool: false,
      maxConnections: 1,
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    }),
    from: `"${process.env.MAIL_FROM_NAME || "TreePractice"}" <${process.env.MAIL_FROM || user}>`,
  };
}

async function sendOne({ transporter, from }, to, payload) {
  const info = await transporter.sendMail({ from, to, subject: payload.subject, text: payload.text, html: payload.html });
  return info?.messageId || "";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchRecipients(tierFilter) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("users")
      .select("code,email,tier,tier_expires_at,status,created_at")
      .not("email", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`users query failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }

  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const email = String(r.email || "").trim().toLowerCase();
    if (!isValidEmail(email)) continue;
    if (String(r.status || "").toLowerCase() === "pending") continue;
    if (seen.has(email)) continue;
    const pro = isProNow(r);
    if (tierFilter === "pro" && !pro) continue;
    if (tierFilter === "free" && pro) continue;
    seen.add(email);
    out.push({ email, code: r.code, isPro: pro });
  }
  return { out, rawCount: rows.length };
}

async function main() {
  const previewPath = args.get("--preview");
  if (previewPath) {
    const { html } = buildRealBankLaunchEmail({ userCode: "ABC123", isPro: !args.has("--as-free") });
    writeFileSync(resolve(String(previewPath)), html, "utf8");
    console.log(`[preview] wrote ${previewPath}`);
    return;
  }

  const testTo = args.get("--to");
  if (testTo) {
    const payload = buildRealBankLaunchEmail({ userCode: "ABC123", isPro: !args.has("--as-free") });
    const id = await sendOne(makeTransporter(), String(testTo), payload);
    console.log(`[test] sent to ${testTo} (${args.has("--as-free") ? "free" : "pro"} view) messageId=${id}`);
    return;
  }

  const tierFilter = String(args.get("--tier", "all")).toLowerCase();
  if (!["all", "pro", "free"].includes(tierFilter)) throw new Error(`--tier must be all|pro|free, got ${tierFilter}`);
  const max = Number(args.get("--max", DEFAULT_MAX));
  const delayMs = Number(args.get("--delay-ms", DEFAULT_DELAY_MS));
  const execute = args.has("--yes");

  const state = readJson(STATE_FILE, { sent: {}, failed: {} });
  state.sent = state.sent || {};
  state.failed = state.failed || {};

  const { out: recipients, rawCount } = await fetchRecipients(tierFilter);
  const pending = recipients.filter((r) => !state.sent[r.email]);
  const proCount = recipients.filter((r) => r.isPro).length;

  console.log(`[recipients] users 表有 email 行 ${rawCount} → 去重/去 pending 后 ${recipients.length}（pro ${proCount} / free ${recipients.length - proCount}），tier=${tierFilter}`);
  console.log(`[state] 已发 ${Object.keys(state.sent).length}，本轮待发 ${pending.length}，本轮上限 ${max}`);

  if (!execute) {
    console.log("[dry-run] 未加 --yes，不发信。前 20 个待发：");
    for (const r of pending.slice(0, 20)) console.log(`  ${r.email}  ${r.code}  ${r.isPro ? "pro" : "free"}`);
    return;
  }

  const mailer = makeTransporter();
  const batch = pending.slice(0, max);
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < batch.length; i += 1) {
    const r = batch[i];
    const payload = buildRealBankLaunchEmail({ userCode: r.code, isPro: r.isPro });
    try {
      const id = await sendOne(mailer, r.email, payload);
      state.sent[r.email] = { at: new Date().toISOString(), code: r.code, isPro: r.isPro, messageId: id };
      delete state.failed[r.email];
      ok += 1;
      console.log(`[${i + 1}/${batch.length}] ok   ${r.email}`);
    } catch (e) {
      const msg = e?.message || String(e);
      state.failed[r.email] = { at: new Date().toISOString(), error: msg };
      fail += 1;
      console.log(`[${i + 1}/${batch.length}] FAIL ${r.email}: ${msg}`);
      if (/frequency|limited|too many|quota/i.test(msg)) {
        console.log("[stop] SMTP 触发频率/配额限制，停止本轮；台账已保存，明天再跑。");
        writeJson(STATE_FILE, state);
        break;
      }
    }
    writeJson(STATE_FILE, state); // 每封落盘，中断不丢进度
    if (i < batch.length - 1) await sleep(delayMs);
  }
  console.log(`[done] 本轮成功 ${ok} / 失败 ${fail}；累计已发 ${Object.keys(state.sent).length}，剩余 ${pending.length - ok}`);
}

main().catch((e) => {
  console.error(`[error] ${e?.message || e}`);
  process.exit(1);
});
