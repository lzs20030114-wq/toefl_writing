#!/usr/bin/env node

import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  ensureOpsDirs,
  getRequiredEnv,
  loadEnv,
  opsStateDir,
  parseArgs,
  readJson,
  sendTelegramMessage,
  truncate,
  writeJson,
} from "./_shared.mjs";

const stateFilePath = resolve(opsStateDir, "feedback-state.json");

function printHelp() {
  console.log("Usage: node scripts/ops/check-feedback.mjs [--limit 20] [--notify] [--bootstrap-now]");
}

function isAfterState(row, state) {
  if (!state?.lastCreatedAt) return true;
  const createdAt = String(row.created_at || "");
  const stateTime = String(state.lastCreatedAt || "");
  if (createdAt > stateTime) return true;
  if (createdAt < stateTime) return false;
  return Number(row.id || 0) > Number(state.lastId || 0);
}

function formatFeedbackRows(rows) {
  return rows
    .slice(0, 5)
    .map((row) => {
      const header = `#${row.id} user=${row.user_code || "unknown"} page=${row.page || "/"}`;
      const body = truncate(row.content || "", 220);
      return `${header}\n${body}`;
    })
    .join("\n\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("--help")) {
    printHelp();
    return;
  }

  loadEnv();
  ensureOpsDirs();

  const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const limit = Number(args.get("--limit", 20)) || 20;
  const notify = args.has("--notify");
  const bootstrapNow = args.has("--bootstrap-now");
  const state = readJson(stateFilePath, null);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("user_feedback")
    .select("id,user_code,content,status,admin_reply,page,created_at")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }

  const rows = data || [];
  const latest = rows.at(-1) || null;

  if (!state || bootstrapNow) {
    writeJson(stateFilePath, latest ? { lastId: latest.id, lastCreatedAt: latest.created_at } : { lastId: 0, lastCreatedAt: null });
    console.log(latest ? `Feedback baseline saved at id=${latest.id}` : "Feedback baseline saved with no rows.");
    return;
  }

  const freshRows = rows.filter((row) => isAfterState(row, state));
  if (freshRows.length === 0) {
    console.log("No new feedback.");
    return;
  }

  const newest = freshRows.at(-1);
  writeJson(stateFilePath, { lastId: newest.id, lastCreatedAt: newest.created_at });

  const message = [
    `New feedback items: ${freshRows.length}`,
    formatFeedbackRows(freshRows),
  ].join("\n\n");

  console.log(message);
  if (notify) {
    await sendTelegramMessage(message);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
