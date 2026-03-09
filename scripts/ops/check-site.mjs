#!/usr/bin/env node

import {
  loadEnv,
  parseArgs,
  sendTelegramMessage,
  truncate,
  withTimeout,
} from "./_shared.mjs";

async function fetchCheck(url, timeoutMs) {
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "toefl-writing-ops-check/1.0" },
      signal: timeout.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      url,
      body: truncate(text, 180),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      body: truncate(error.message || String(error), 180),
    };
  } finally {
    timeout.done();
  }
}

function printHelp() {
  console.log("Usage: node scripts/ops/check-site.mjs --base-url https://example.com [--notify] [--notify-ok]");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("--help")) {
    printHelp();
    return;
  }

  loadEnv();

  const baseUrl = String(args.get("--base-url", process.env.SITE_BASE_URL || "")).replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("Missing --base-url or SITE_BASE_URL");
  }

  const notify = args.has("--notify");
  const notifyOk = args.has("--notify-ok");
  const timeoutMs = Number(args.get("--timeout-ms", 10000)) || 10000;
  const targets = [
    `${baseUrl}/`,
    `${baseUrl}/api/health/supabase`,
  ];

  const results = [];
  for (const target of targets) {
    results.push(await fetchCheck(target, timeoutMs));
  }

  const failed = results.filter((item) => !item.ok);
  const message = [
    `Site check: ${failed.length === 0 ? "OK" : "FAILED"}`,
    ...results.map((item) => `${item.status || "ERR"} ${item.url} :: ${item.body}`),
  ].join("\n");

  console.log(message);
  if (notify && (failed.length > 0 || notifyOk)) {
    await sendTelegramMessage(message);
  }

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
