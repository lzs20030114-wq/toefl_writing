import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(__dirname, "..", "..");
export const opsRoot = resolve(repoRoot, ".ops");
export const opsStateDir = resolve(opsRoot, "state");
export const opsLogsDir = resolve(opsRoot, "logs");

function stripQuotes(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

export function loadEnv() {
  for (const filePath of [resolve(repoRoot, ".env.local"), resolve(repoRoot, ".env")]) {
    if (!existsSync(filePath)) continue;
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match) continue;
      if (process.env[match[1]]) continue;
      process.env[match[1]] = stripQuotes(match[2]);
    }
  }
}

export function ensureOpsDirs() {
  for (const dirPath of [opsRoot, opsStateDir, opsLogsDir]) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function getRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags.set(token, true);
      continue;
    }
    flags.set(token, next);
    i += 1;
  }
  return {
    has(name) {
      return flags.has(name);
    },
    get(name, fallback = undefined) {
      return flags.has(name) ? flags.get(name) : fallback;
    },
  };
}

export function withTimeout(ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer);
    },
  };
}

export function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function truncate(text, maxLength = 280) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 3)) + "...";
}

export async function sendTelegramMessage(text) {
  const botToken = getRequiredEnv("TG_BOT_TOKEN");
  const chatId = getRequiredEnv("TG_CHAT_ID");
  const body = {
    chat_id: chatId,
    text: String(text || "").slice(0, 4096),
    disable_web_page_preview: true,
  };

  const timeout = withTimeout(15000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.description || `Telegram API failed with ${response.status}`);
    }
    return payload;
  } finally {
    timeout.done();
  }
}

export function logBlock(title, lines = []) {
  const body = [title, ...lines].filter(Boolean).join("\n");
  process.stdout.write(body + "\n");
}
