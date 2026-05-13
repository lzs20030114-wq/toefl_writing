/**
 * QQ Mail SMTP wrapper for transactional notifications.
 *
 * Used by the referral system to notify inviters when their reward lands,
 * and by future features that need to send transactional email.
 *
 * Configuration (set in .env.local on Vercel / locally):
 *   MAIL_HOST       SMTP host (default: smtp.qq.com)
 *   MAIL_PORT       SMTP port (default: 465 for SSL)
 *   MAIL_SECURE     "true" for 465/SSL, "false" for 587/STARTTLS (default: true)
 *   MAIL_USER       SMTP username = the sending QQ mailbox (e.g. xxx@qq.com)
 *   MAIL_PASS       SMTP authorization code (NOT your QQ password — the
 *                   16-char code from QQ Mail → 设置 → 账户 → 开启 SMTP)
 *   MAIL_FROM_NAME  Display name in the From header (default: TreePractice)
 *   MAIL_FROM       Override from address (default: MAIL_USER)
 *
 * QQ Mail SMTP free quota: ~50 outbound emails / 24h per personal account.
 * Enterprise QQ Mail: 500-2000 / day depending on plan. For higher volume,
 * upgrade to enterprise or swap in Resend/SES by changing this file only.
 *
 * IMPORTANT: This module is server-only. Never import from a client file —
 * doing so would leak SMTP credentials into the browser bundle.
 */

import nodemailer from "nodemailer";
import { createLogger } from "../logger";

const log = createLogger("mail");

let cachedTransporter = null;
let configErrorLogged = false;

function readConfig() {
  return {
    host: process.env.MAIL_HOST || "smtp.qq.com",
    port: Number(process.env.MAIL_PORT) || 465,
    secure: process.env.MAIL_SECURE === undefined
      ? true
      : process.env.MAIL_SECURE !== "false",
    user: process.env.MAIL_USER || "",
    pass: process.env.MAIL_PASS || "",
    fromName: process.env.MAIL_FROM_NAME || "TreePractice",
    from: process.env.MAIL_FROM || process.env.MAIL_USER || "",
  };
}

export function isMailConfigured() {
  const cfg = readConfig();
  return !!cfg.user && !!cfg.pass;
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const cfg = readConfig();
  if (!cfg.user || !cfg.pass) {
    if (!configErrorLogged) {
      log.warn("Mail not configured — MAIL_USER / MAIL_PASS missing");
      configErrorLogged = true;
    }
    return null;
  }
  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    // Keep the connection short-lived for serverless friendliness
    pool: false,
    maxConnections: 1,
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return cachedTransporter;
}

/**
 * Send a transactional email. Server-only.
 *
 * @param {object} params
 * @param {string} params.to       Recipient address
 * @param {string} params.subject  Subject line (plain text)
 * @param {string} [params.text]   Plain-text body (recommended for compatibility)
 * @param {string} [params.html]   HTML body (optional)
 * @param {string} [params.replyTo] Optional reply-to address
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string, skipped?: boolean}>}
 */
export async function sendMail({ to, subject, text, html, replyTo } = {}) {
  if (!to || typeof to !== "string") {
    return { ok: false, error: "missing recipient" };
  }
  if (!subject || typeof subject !== "string") {
    return { ok: false, error: "missing subject" };
  }
  if (!text && !html) {
    return { ok: false, error: "missing body (text or html required)" };
  }

  const transporter = getTransporter();
  if (!transporter) {
    return { ok: false, skipped: true, error: "mail not configured" };
  }

  const cfg = readConfig();
  const fromAddress = cfg.from || cfg.user;
  const fromLine = `"${cfg.fromName}" <${fromAddress}>`;

  try {
    const info = await transporter.sendMail({
      from: fromLine,
      to,
      subject,
      text,
      html,
      replyTo: replyTo || undefined,
    });
    log.info("Mail sent", { to, subject, messageId: info?.messageId });
    return { ok: true, messageId: info?.messageId };
  } catch (e) {
    log.error("Mail send failed", { to, subject, error: e?.message });
    return { ok: false, error: e?.message || "send failed" };
  }
}
