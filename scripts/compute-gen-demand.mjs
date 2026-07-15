#!/usr/bin/env node
/**
 * compute-gen-demand.mjs — the on-demand generation signal.
 *
 * Every night (GitHub Action gen-demand.yml, ~01:30 Beijing) this reads the
 * Supabase `sessions` table, works out which of the 12 live banks are close to
 * being exhausted (a top user刷穿 / low runway / below the hard floor), and
 * writes data/.gen-demand.json. The Claude routine reads that file at 03:00 and
 * only generates the banks flagged `generate:true`, at the suggested `n`.
 *
 * PRIVACY: the emitted file contains only aggregate counts. No user_code, ever
 * (the pure function in lib/genDemand/computeDemand.js enforces this).
 *
 * Env (same secrets the other data jobs use):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage: node scripts/compute-gen-demand.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");
const { computeDemand } = require("../lib/genDemand/computeDemand.js");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = resolve(ROOT, "data/.gen-demand.json");

// ---- Bank registry: routine bank key → live file + kind + id extraction ----
// `kind` drives the hard floor (text 40 / audio 30) and nightly caps (20 / 10).
// `notInRoutine` marks banks the routine does NOT yet generate (interview — its
// prompt calibration is deferred); it is still measured, just flagged.
const BANK_FILES = {
  bs: { file: "data/buildSentence/questions.json", kind: "text", special: "bs" },
  discussion: { file: "data/academicWriting/prompts.json", kind: "text" },
  email: { file: "data/emailWriting/prompts.json", kind: "text" },
  "reading-ap": { file: "data/reading/bank/ap.json", kind: "text" },
  ctw: { file: "data/reading/bank/ctw.json", kind: "text" },
  "rdl-short": { file: "data/reading/bank/rdl-short.json", kind: "text" },
  "rdl-long": { file: "data/reading/bank/rdl-long.json", kind: "text" },
  "listening-lat": { file: "data/listening/bank/lat.json", kind: "audio" },
  lc: { file: "data/listening/bank/lc.json", kind: "audio" },
  la: { file: "data/listening/bank/la.json", kind: "audio" },
  lcr: { file: "data/listening/bank/lcr.json", kind: "audio" },
  "speaking-repeat": { file: "data/speaking/bank/repeat.json", kind: "audio" },
  interview: { file: "data/speaking/bank/interview.json", kind: "audio", notInRoutine: true },
};

function loadBankArray(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.question_sets)) return json.question_sets;
  return [];
}

function buildBankConfigs() {
  const configs = {};
  for (const [key, meta] of Object.entries(BANK_FILES)) {
    const json = JSON.parse(readFileSync(resolve(ROOT, meta.file), "utf8"));
    const arr = loadBankArray(json);
    const ids = new Set();
    // BS is counted by session, not id — leave ids empty, size = set count.
    if (!meta.special) {
      for (const it of arr) {
        const id = it && (it.id ?? it.set_id);
        if (id !== undefined && id !== null) ids.add(String(id));
      }
    }
    configs[key] = {
      size: arr.length,
      ids,
      kind: meta.kind,
      notInRoutine: !!meta.notInRoutine,
      special: meta.special || null,
    };
  }
  return configs;
}

// ---- Fetch every sessions row (paginated) ----
async function fetchAllSessions(supabase) {
  const PAGE = 1000;
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("sessions")
      .select("user_code,type,date,details")
      .neq("type", "mock") // drop the writing 3-task mock — not counted in v1
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "[gen-demand] Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cannot query sessions.",
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log("[gen-demand] fetching sessions…");
  const sessions = await fetchAllSessions(supabase);
  console.log(`[gen-demand] fetched ${sessions.length} session rows (mock excluded).`);

  const bankConfigs = buildBankConfigs();
  const demand = computeDemand(sessions, bankConfigs, { now: new Date() });

  writeFileSync(OUT_PATH, JSON.stringify(demand, null, 2) + "\n");

  // Summary to stdout (aggregate only — no user data).
  const toGen = Object.entries(demand.banks).filter(([, b]) => b.generate);
  console.log(`[gen-demand] active_users=${demand.active_users}`);
  console.log(`[gen-demand] banks flagged for generation: ${toGen.length}`);
  for (const [k, b] of toGen) {
    console.log(`  - ${k}: n=${b.n} triggers=[${b.triggers.join(",")}] size=${b.bank_size} topPct=${b.top_user_pct}`);
  }
  console.log(`[gen-demand] wrote ${OUT_PATH}`);
}

main().catch((e) => {
  console.error("[gen-demand] fatal:", e && e.message ? e.message : e);
  process.exit(1);
});
