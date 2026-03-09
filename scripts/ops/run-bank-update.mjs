#!/usr/bin/env node

import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { basename, resolve } from "path";
import { spawnSync } from "child_process";
import {
  ensureOpsDirs,
  loadEnv,
  logBlock,
  opsLogsDir,
  parseArgs,
  repoRoot,
  sendTelegramMessage,
  truncate,
} from "./_shared.mjs";

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runStep(command, args, logFilePath, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
  });
  const title = `\n$ ${command} ${args.join(" ")}\n`;
  appendFileSync(logFilePath, title, "utf8");
  if (result.stdout) appendFileSync(logFilePath, result.stdout, "utf8");
  if (result.stderr) appendFileSync(logFilePath, result.stderr, "utf8");
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = truncate(result.stderr || result.stdout || "Unknown command failure", 600);
    throw new Error(`${basename(command)} failed: ${stderr}`);
  }
  return result.stdout || "";
}

function makeSummary({ sets, logFilePath, install, pull, reportOnly }) {
  return [
    "TOEFL bank update finished.",
    `sets=${sets}`,
    `pull=${pull ? "yes" : "no"}`,
    `install=${install ? "yes" : "no"}`,
    `reportOnly=${reportOnly ? "yes" : "no"}`,
    `log=${logFilePath}`,
  ].join("\n");
}

function printHelp() {
  console.log("Usage: node scripts/ops/run-bank-update.mjs [--sets 1] [--pull] [--install] [--report-only] [--notify]");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("--help")) {
    printHelp();
    return;
  }

  loadEnv();
  ensureOpsDirs();
  mkdirSync(opsLogsDir, { recursive: true });

  const sets = Number(args.get("--sets", 1)) || 1;
  const pull = args.has("--pull");
  const install = args.has("--install");
  const reportOnly = args.has("--report-only");
  const notify = args.has("--notify");
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const logFilePath = resolve(opsLogsDir, `bank-update-${stamp}.log`);
  writeFileSync(logFilePath, `TOEFL bank update run ${now.toISOString()}\n`, "utf8");

  try {
    if (pull) runStep("git", ["pull", "--ff-only"], logFilePath);
    if (install) runStep(npmCommand(), ["ci"], logFilePath);

    const commandArgs = ["scripts/produce-and-report.mjs"];
    if (reportOnly) {
      commandArgs.push("--report-only");
    } else {
      commandArgs.push("--sets", String(sets));
    }
    runStep("node", commandArgs, logFilePath);

    const message = makeSummary({ sets, logFilePath, install, pull, reportOnly });
    logBlock(message);
    if (notify) {
      await sendTelegramMessage(message);
    }
  } catch (error) {
    const message = [
      "TOEFL bank update failed.",
      truncate(error.message || String(error), 1000),
      `log=${logFilePath}`,
    ].join("\n");
    logBlock(message);
    if (notify) {
      await sendTelegramMessage(message).catch(() => {});
    }
    process.exit(1);
  }
}

main();
