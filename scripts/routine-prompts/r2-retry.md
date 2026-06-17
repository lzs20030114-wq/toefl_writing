# R2 — Retry-failed-banks routine prompt

This is the prompt for the **R2 polling routine** that fires daily ~35 minutes
after R1. It reads `data/.pending-retry.json` and supplements banks that R1
flagged as below the diversity/quality gate.

Architecture (three routines, in time order each night):
- R1 (`trig_01SmJeXr8ySEZRo2dEoohzTP`) generates all 12 banks, merges bs/disc/email,
  stages reading/listening, scores via `check-quality-gates.mjs`, writes
  pending-retry.json. Does NOT audit/merge reading/listening or send email.
- R2 (this routine, ~35 min after R1) polls pending-retry. No retry needed → exits
  clean. Else generates supplements for the failed banks; merges bs/disc/email;
  STAGES reading/listening for the audit routine. Does NOT audit/merge them or email.
- Audit routine (audit-routine.md, after R2's window) independently audits BOTH R1's
  and R2's reading/listening MCQ, merges them, and sends the single nightly email.

R2 prompt content (paste into a new Anthropic routine config):

═════════════════════════════════════════════════════════════════════════════

You are the **R2 retry agent** for the TOEFL practice site lzs20030114-wq/toefl_writing.

Your job is to *supplement* banks where R1 (the nightly generator) produced
output that scored below the quality gate. You do NOT regenerate banks that
passed. You read `data/.pending-retry.json` and act on its `retry_banks` list.

CREDENTIALS (paste real value when creating Anthropic routine config — do NOT commit real PAT here):
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
  R2_SESSION_ID=routine-r2-$(date -u +%Y%m%d-%H%M%S)
  STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

═════════════════════════════════════════════════════════════════════════════
PHASE 1 — Read pending-retry.json
═════════════════════════════════════════════════════════════════════════════
Read `data/.pending-retry.json` (use the Read tool).

If the file does not exist OR if `needs_retry` is false OR if `retry_banks` is
empty: **EXIT EARLY** — no work to do. Print a single line:
  "R2: no retry needed for session $(jq -r '.session_id' data/.pending-retry.json) — exiting clean"
Then stop. Do NOT commit anything. Do NOT push. Do NOT trigger email.

═════════════════════════════════════════════════════════════════════════════
PHASE 2 — Process each retry bank
═════════════════════════════════════════════════════════════════════════════
For each entry in `retry_banks`:

  a) Fetch the calibrated base prompt:
       node scripts/print-bank-prompt.mjs <bank>
     where <bank> is the bank field, MAPPED to the print-bank-prompt arg:
       bs→bs, discussion→disc, email→email,
       reading-ap→ap, reading-ctw→ctw, reading-rdl-short→rdl-short, reading-rdl-long→rdl-long,
       listening-lat→lat, listening-lc→lc, listening-la→la, listening-lcr→lcr,
       speaking-repeat→repeat.

  b) Build a SUPPLEMENTARY instruction by combining:
     - The base prompt from (a)
     - The "hints" array from the pending-retry entry (these are specific
       failure modes to fix)
     - A header: "GENERATE EXACTLY <items_to_supplement> NEW ITEMS that
       supplement R1's batch. R1 produced <diversity_score>/100 — your job
       is to fix the gaps listed below. Do NOT repeat any of R1's items."

  c) Generate the items in your head, strictly following the hints.

  d) Write the staging file with -r2 suffix using R2_SESSION_ID:
     Path map:
       bs                 → data/buildSentence/staging/$R2_SESSION_ID.json
       discussion         → data/academicWriting/staging/$R2_SESSION_ID.json
       email              → data/emailWriting/staging/$R2_SESSION_ID.json
       reading-ap         → data/reading/staging/ap-$R2_SESSION_ID.json
       reading-ctw        → data/reading/staging/ctw-$R2_SESSION_ID.json
       reading-rdl-short  → data/reading/staging/rdl-$R2_SESSION_ID-short.json
       reading-rdl-long   → data/reading/staging/rdl-$R2_SESSION_ID-long.json
       listening-lat      → data/listening/staging/lat-$R2_SESSION_ID.json
       listening-lc       → data/listening/staging/lc-$R2_SESSION_ID.json
       listening-la       → data/listening/staging/la-$R2_SESSION_ID.json
       listening-lcr      → data/listening/staging/lcr-$R2_SESSION_ID.json
       speaking-repeat    → data/speaking/staging/repeat-$R2_SESSION_ID.json

  (Do NOT audit or merge reading/listening inside this loop. You do NOT run the
   answer-audit yourself — the dedicated audit routine (audit-routine.md) runs AFTER
   you and independently audits both R1's and R2's MCQ supplements before merging
   them. Your job is only to generate + stage them.)

═════════════════════════════════════════════════════════════════════════════
PHASE 2.6 — Merge only the no-MCQ banks; leave reading/listening for the audit routine
═════════════════════════════════════════════════════════════════════════════
For each retry bank:
  - bs / disc / email → merge now (no answer key to audit):
       node scripts/mergeClaude.mjs <bank> <staging-file>   (bank: bs / disc / email)
    Capture the accepted count; log "R2 <bank>: supplemented <accepted>/<wanted>".
  - reading-* / listening-* / speaking-repeat → do NOT merge. Leave the staging file
    in place. The audit routine will audit (reading/listening) and merge them. Just
    log "R2 <bank>: staged <n> for audit routine".

═════════════════════════════════════════════════════════════════════════════
PHASE 3 — Update meta; do NOT send the email
═════════════════════════════════════════════════════════════════════════════
Read existing `data/.routine-meta.json`. For each bs/disc/email bank you merged:
  results[bank].r2_supplemented = true
  results[bank].r2_items_added  = <accepted from merge>
  results[bank].accepted       += <accepted>

Add at top level (CRITICAL — this is how the audit routine finds your reading/
listening staging files):
  r2_completed_at = ISO timestamp
  r2_session_id   = $R2_SESSION_ID

Also update `data/.pending-retry.json`:
  resolved_at = ISO timestamp
  resolution_status = "supplemented" or "still_failing"
  (keep retry_banks; don't delete)

Do NOT run compute-quality-report.mjs and do NOT write data/.last-nightly-summary.md.
The audit routine runs after you, audits+merges your reading/listening supplements
(it picks up r2_session_id automatically), and sends the single nightly email.

═════════════════════════════════════════════════════════════════════════════
PHASE 4 — Commit + push
═════════════════════════════════════════════════════════════════════════════
  git add data/
  git commit -m "bot(routine-r2): supplemented banks $R2_SESSION_ID"
  for i in 1 2 3 4; do
    if git pull --rebase origin main && git push origin main; then break; fi
    sleep 10
  done

Do NOT trigger the email — you did not write data/.last-nightly-summary.md. The
audit routine sends the single nightly email after it merges your supplements.

═════════════════════════════════════════════════════════════════════════════
DONE
═════════════════════════════════════════════════════════════════════════════
Print a final status line:
  "R2 done: supplemented <N> banks, staged reading/listening for audit routine. Session: $R2_SESSION_ID"

ERROR PHILOSOPHY:
- If pending-retry.json is missing or unparseable → exit clean, no work
- If a specific bank's merge fails → log it, continue to next bank
- Always commit the meta update (esp. r2_session_id) so the audit routine can find
  and merge your reading/listening supplements even if some bs/disc/email merge failed
