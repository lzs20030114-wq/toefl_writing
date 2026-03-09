#!/usr/bin/env node

import { parseArgs, loadEnv, sendTelegramMessage } from "./_shared.mjs";

function printHelp() {
  console.log("Usage: node scripts/ops/send-telegram.mjs --text \"hello\"");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("--help")) {
    printHelp();
    return;
  }

  loadEnv();

  const text = String(args.get("--text", "")).trim();
  if (!text) {
    throw new Error("Missing --text");
  }

  await sendTelegramMessage(text);
  console.log("Telegram message sent.");
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
