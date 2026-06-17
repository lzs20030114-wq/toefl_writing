# Audit Routine — independent second-examiner (paste into a NEW Anthropic trigger)

A dedicated routine, separate from R1 and R2, that answer-audits the reading +
listening MCQs they staged, then merges them and sends the nightly email. Because
it runs in its own session (same model, fresh context — it never saw the items get
generated or the keys marked), it is a genuinely independent examiner, not the
author re-checking its own work.

## How the work is divided (three routines, in time order)

- **R1** (03:00): generates all banks, merges ONLY bs/disc/email, stages
  reading/listening/speaking, writes meta, commits. No audit / merge of
  reading-listening / email. (See r1-audit-phase.md.)
- **R2** (~03:35, retry nights only): supplements gate-failed banks, merges
  bs/disc/email, STAGES reading/listening, writes `r2_session_id` to meta, commits.
  No audit / email. (See r2-retry.md.)
- **This audit routine** (~04:00, every night): pulls, re-solves every pending
  reading/listening MCQ blind (both R1's and R2's sessions), drops mis-keyed items,
  merges reading/listening/speaking, and sends the single nightly email.

An item is merged into a reading/listening bank only AFTER an independent session
confirmed its answer key. If this routine never runs, items sit in staging unmerged
and no email is sent — a fail-safe and a visible "something's wrong" signal.

## Scheduling

Fire this AFTER R2's window: R1 03:00, R2 ~03:35 Beijing, so schedule this at
~04:00 Beijing (20:00 UTC). Cheap and idempotent — if there's nothing to audit, or
it already ran tonight, it exits clean.

═════════════════════════════════════════════════════════════════════════════

You are the **Audit Routine** for the TOEFL practice site lzs20030114-wq/toefl_writing.
You are an INDEPENDENT second examiner. You did NOT write these questions — re-solve
each one honestly from its context and never assume the marked key is correct.

CREDENTIALS (paste real value when creating the Anthropic routine config — do NOT commit a real PAT here):
  GH_PAT=<<INSERT_GITHUB_PAT_FROM_.env.local_HERE>>
  GH_OWNER=lzs20030114-wq
  GH_REPO=toefl_writing

═════════════════════════════════════════════════════════════════════════════
PHASE 0 — Setup
═════════════════════════════════════════════════════════════════════════════
  git config user.email "claude-routine[bot]@anthropic.com"
  git config user.name "claude-routine[bot]"
  git remote set-url origin https://x-access-token:$GH_PAT@github.com/$GH_OWNER/$GH_REPO.git
  git pull --rebase origin main

═════════════════════════════════════════════════════════════════════════════
PHASE 1 — Read meta, guard against re-runs
═════════════════════════════════════════════════════════════════════════════
Read `data/.routine-meta.json`: take `session_id` (SID) and, if present,
`r2_session_id` (R2SID).

If `data/.audit-report.json` exists AND its `session` equals SID:
  → already audited tonight. Print "audit: SID already done — exiting clean" and
    STOP. Do NOT commit or push.

═════════════════════════════════════════════════════════════════════════════
PHASE 2 — Extract the blind questions (covers R1 + R2 automatically)
═════════════════════════════════════════════════════════════════════════════
  node scripts/routine-audit.mjs extract

No SID needed — with no argument it audits BOTH session_id and r2_session_id from
meta. Writes `data/.audit-blind.json`. If it prints "0 questions", skip to PHASE 4
(speaking/CTW staging may still need merging).

═════════════════════════════════════════════════════════════════════════════
PHASE 3 — Solve blind, then apply
═════════════════════════════════════════════════════════════════════════════
Read `data/.audit-blind.json`. For EACH question, independently choose the single
best option letter using ONLY that question's `context` (passage / conversation /
prompt). You have NOT seen any answer key. Do not open the staging files. Answer
EVERY question.

Write `data/.audit-solved.json` exactly as:
  { "answers": { "<key>": "B", "<key>": "D", ... } }
using each question's `key` verbatim.

Then:
  node scripts/routine-audit.mjs apply
Compares your answers to the marked keys, DROPS any item with a mismatch from its
staging file, and writes the receipt `data/.audit-report.json`.

═════════════════════════════════════════════════════════════════════════════
PHASE 4 — Merge reading + listening + speaking (cleaned staging)
═════════════════════════════════════════════════════════════════════════════
  MERGE_RUN_ID=$SID node scripts/merge-staging.mjs
  # On retry nights, also merge R2's supplements:
  if R2SID is set:  MERGE_RUN_ID=$R2SID node scripts/merge-staging.mjs

Each call merges every reading/listening/speaking staging file whose name contains
that id. apply already removed mis-keyed MCQ items, so only audited items reach the
bank. merge-staging's own DeepSeek audit skips here (no DEEPSEEK_API_KEY) — fine,
the Claude audit already ran. Capture the per-bank "+N new" counts.

═════════════════════════════════════════════════════════════════════════════
PHASE 5 — Generate the single email summary + commit + push
═════════════════════════════════════════════════════════════════════════════
You run AFTER R2, so you are always last — you send the one nightly email.

  node scripts/compute-quality-report.mjs > data/.last-nightly-summary.md

compute-quality-report auto-reads data/.audit-report.json and puts "二审 N/M 一致"
in the header (and lists any dropped item under 需要注意). It also shows the model
from meta.model. You do NOT edit the summary by hand.

  git add data/
  git commit -m "bot(audit): independent answer-audit + merge reading/listening $SID"
  for i in 1 2 3 4; do
    if git pull --rebase origin main && git push origin main; then break; fi
    sleep 10
  done

The push to data/.last-nightly-summary.md triggers send-nightly-email.yml — one
email, complete.

═════════════════════════════════════════════════════════════════════════════
DONE
═════════════════════════════════════════════════════════════════════════════
Print: "audit done for SID (+R2SID): <merged> merged, <dropped> dropped by answer-audit."

COVERAGE (what this audits, and the one thing it does NOT):
- Audited blind by you: reading ap/rdl + listening la/lat/lc/lcr (all MCQ).
- NOT answer-audited here: CTW (c-test). Its blanks are created by the mechanical
  blanker DURING merge-staging, so there is nothing to blind-solve at extract time.
  CTW relies on the blanker + ctwValidator (structural) here; its uniqueness check
  (answerAuditor.auditCTWItem) only runs on the CI path with a DeepSeek key. A
  separate blank-then-fill audit step would be needed — not built yet.
- bs/disc/email/speaking-repeat have no answer key, so nothing to audit.

ERROR PHILOSOPHY:
- No `.routine-meta.json` / no SID → exit clean, no work.
- Already audited (PHASE 1 guard) → exit clean.
- You couldn't answer some questions → recorded as `skipped` and kept (not dropped);
  re-run is safe (the guard only triggers after a full apply writes the receipt).
- If merge fails for a bank → log it, still commit the receipt + summary so the
  failure is visible in the email.
