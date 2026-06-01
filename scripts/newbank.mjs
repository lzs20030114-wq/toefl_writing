#!/usr/bin/env node
/**
 * newbank.mjs — stage a fresh question bank in data/newBank/, separate from the live bank,
 * for a later ONE-SHOT replacement. Generation deposits here (live is never touched until
 * you promote), so we can build + review the new bank in isolation and swap it in wholesale.
 *
 * Subcommands:
 *   init             Create data/newBank/ mirroring the live bank layout, EMPTY (drop-in shape).
 *                    Idempotent: never clobbers a newBank file that already has items unless --force.
 *   status           Per-type counts: newBank vs live.
 *   promote          One-shot swap. Requires --mode and --yes.
 *     --mode=replace   newBank/<file>  ->  live/<file>   (live becomes exactly newBank; a
 *                      timestamped backup of each live file is written to data/newBank/.backup-<ts>/)
 *     --mode=append    append newBank items into the live bank (dedup by id), live keeps its current items
 *     --yes            required to actually write (otherwise dry-run preview only)
 *
 * The merge scripts (merge-staging.mjs, mergeClaude.mjs) honour NEWBANK_ROOT=data/newBank to
 * deposit validated, deduped output here instead of the live bank — that is how questions get IN.
 * This tool only inits / reports / promotes.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NEWBANK_REL = "data/newBank";

// The 12 live bank files we mirror. `key` is the array property; null = the file IS a bare array.
const BANKS = [
  { id: "bs",        file: "data/buildSentence/questions.json", key: "question_sets" },
  { id: "ap",        file: "data/reading/bank/ap.json",         key: "items" },
  { id: "ctw",       file: "data/reading/bank/ctw.json",        key: "items" },
  { id: "rdl-long",  file: "data/reading/bank/rdl-long.json",   key: "items" },
  { id: "rdl-short", file: "data/reading/bank/rdl-short.json",  key: "items" },
  { id: "lat",       file: "data/listening/bank/lat.json",      key: "items" },
  { id: "lc",        file: "data/listening/bank/lc.json",       key: "items" },
  { id: "la",        file: "data/listening/bank/la.json",       key: "items" },
  { id: "lcr",       file: "data/listening/bank/lcr.json",      key: "items" },
  { id: "repeat",    file: "data/speaking/bank/repeat.json",    key: "items" },
  { id: "interview", file: "data/speaking/bank/interview.json", key: "items" },
  { id: "disc",      file: "data/academicWriting/prompts.json", key: null },
  { id: "email",     file: "data/emailWriting/prompts.json",    key: null },
];

const argv = process.argv.slice(2);
const cmd = argv[0];
const hasFlag = (f) => argv.includes(f);
const flagVal = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
};

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJSON = (p, d) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(d, null, 2) + "\n"); };
const livePath = (b) => join(ROOT, b.file);
const newPath = (b) => join(ROOT, NEWBANK_REL, b.file.replace(/^data\//, ""));

function arrOf(obj, key) {
  if (key === null) return Array.isArray(obj) ? obj : [];
  return Array.isArray(obj?.[key]) ? obj[key] : [];
}

// An EMPTY mirror that preserves the live file's wrapper shape (so a replace is drop-in).
function emptyMirror(live, key) {
  if (key === null) return [];
  const shell = {};
  for (const k of Object.keys(live)) {
    if (k === key) continue;
    if (k === "generated_at") { shell[k] = null; continue; }
    if (Array.isArray(live[k])) continue; // drop other incidental arrays
    shell[k] = live[k];
  }
  shell[key] = [];
  return shell;
}

function cmdInit() {
  const force = hasFlag("--force");
  let created = 0, skipped = 0;
  for (const b of BANKS) {
    const lp = livePath(b), np = newPath(b);
    if (!existsSync(lp)) { console.log(`  ! live missing, skipping: ${b.file}`); continue; }
    if (existsSync(np) && !force) {
      const existing = arrOf(readJSON(np), b.key);
      if (existing.length > 0) { console.log(`  = ${b.id}: keep (${existing.length} items already staged)`); skipped++; continue; }
    }
    const live = readJSON(lp);
    writeJSON(np, emptyMirror(live, b.key));
    console.log(`  + ${b.id}: empty mirror -> ${NEWBANK_REL}/${b.file.replace(/^data\//, "")}`);
    created++;
  }
  console.log(`\ninit done: ${created} created, ${skipped} kept.`);
}

function cmdStatus() {
  console.log(`type        newBank    live`);
  console.log(`--------------------------------`);
  let nb = 0, lv = 0;
  for (const b of BANKS) {
    const np = newPath(b), lp = livePath(b);
    const n = existsSync(np) ? arrOf(readJSON(np), b.key).length : "-";
    const l = existsSync(lp) ? arrOf(readJSON(lp), b.key).length : "-";
    if (typeof n === "number") nb += n;
    if (typeof l === "number") lv += l;
    console.log(`  ${b.id.padEnd(10)}${String(n).padStart(6)}${String(l).padStart(9)}`);
  }
  console.log(`--------------------------------`);
  console.log(`  ${"TOTAL".padEnd(10)}${String(nb).padStart(6)}${String(lv).padStart(9)}`);
}

function cmdPromote() {
  const mode = flagVal("mode");
  const go = hasFlag("--yes");
  if (mode !== "replace" && mode !== "append") {
    console.error("promote requires --mode=replace or --mode=append");
    process.exit(2);
  }
  // Build a stable backup dir name from the newest mtime is not allowed (no Date in worktrees,
  // but this is a normal script) — use process arg or a fixed counter dir.
  const stamp = flagVal("stamp") || new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(ROOT, NEWBANK_REL, `.backup-${stamp}`);
  let totalNew = 0, plan = [];
  for (const b of BANKS) {
    const np = newPath(b);
    if (!existsSync(np)) continue;
    const newItems = arrOf(readJSON(np), b.key);
    if (newItems.length === 0) continue;
    const live = existsSync(livePath(b)) ? readJSON(livePath(b)) : (b.key === null ? [] : { [b.key]: [] });
    const liveItems = arrOf(live, b.key);
    if (mode === "replace") {
      plan.push({ b, action: `replace ${liveItems.length} -> ${newItems.length}` });
      totalNew += newItems.length;
    } else {
      const ids = new Set(liveItems.map((i) => i && i.id).filter(Boolean));
      const add = newItems.filter((i) => !i.id || !ids.has(i.id));
      plan.push({ b, action: `append +${add.length} (live ${liveItems.length} -> ${liveItems.length + add.length})`, add });
      totalNew += add.length;
    }
  }
  if (plan.length === 0) { console.log("newBank is empty — nothing to promote."); return; }
  console.log(`PROMOTE (mode=${mode})${go ? "" : "  [DRY RUN — pass --yes to apply]"}`);
  for (const p of plan) console.log(`  ${p.b.id.padEnd(10)} ${p.action}`);
  if (!go) { console.log(`\nDry run only. Re-run with --yes to write (live files backed up to ${NEWBANK_REL}/.backup-${stamp}/).`); return; }

  for (const p of plan) {
    const { b } = p;
    if (existsSync(livePath(b))) {
      const bp = join(backupDir, b.file.replace(/^data\//, ""));
      mkdirSync(dirname(bp), { recursive: true });
      copyFileSync(livePath(b), bp);
    }
    if (mode === "replace") {
      copyFileSync(newPath(b), livePath(b));
    } else {
      const live = existsSync(livePath(b)) ? readJSON(livePath(b)) : (b.key === null ? [] : { [b.key]: [] });
      if (b.key === null) { writeJSON(livePath(b), arrOf(live, null).concat(p.add)); }
      else { live[b.key] = arrOf(live, b.key).concat(p.add); writeJSON(livePath(b), live); }
    }
  }
  console.log(`\npromoted ${totalNew} items (mode=${mode}). Live backups in ${NEWBANK_REL}/.backup-${stamp}/`);
}

switch (cmd) {
  case "init": cmdInit(); break;
  case "status": cmdStatus(); break;
  case "promote": cmdPromote(); break;
  default:
    console.log("usage: node scripts/newbank.mjs <init|status|promote>");
    console.log("  init                       create empty data/newBank/ mirror (drop-in shape)");
    console.log("  status                     per-type counts: newBank vs live");
    console.log("  promote --mode=replace|append [--yes]   one-shot swap (dry-run without --yes)");
    console.log("\nput questions IN newBank by running the merges with NEWBANK_ROOT=data/newBank.");
    process.exit(cmd ? 1 : 0);
}
