# R1 change for the independent audit routine (edit the Anthropic R1 config)

The answer-audit is done by a **separate** routine (see `audit-routine.md`) running
in its own session — an independent second examiner, not R1 re-checking its own
work. For that to work, R1 must stop merging reading/listening and leave them in
staging for the audit routine.

R1's prompt lives in the Anthropic console (trigger `trig_01SmJeXr8ySEZRo2dEoohzTP`),
not this repo, so apply this change there by hand.

## The only change R1 needs

In R1's merge phase, **merge only the no-MCQ banks** and **stop calling
`merge-staging.mjs`**:

- KEEP (R1 still merges these — they have no answer key to audit):
  ```
  bs    → node scripts/mergeClaude.mjs bs    <staging>
  disc  → node scripts/mergeClaude.mjs disc  <staging>
  email → node scripts/mergeClaude.mjs email <staging>
  ```
- REMOVE from R1 (the audit routine does these after auditing):
  ```
  MERGE_RUN_ID=... node scripts/merge-staging.mjs      ← delete all such calls
  ```
  i.e. R1 no longer merges reading (ap/ctw/rdl) or listening (la/lat/lc/lcr) or
  speaking (repeat). It just **writes their staging files** as before.

R1 still does everything else unchanged: generate all banks, write every staging
file, run `scripts/check-quality-gates.mjs`, write `data/.routine-meta.json`, then
commit + push `data/`. The committed staging files are what the audit routine
reads.

## Why staging-only is safe

- Reading/listening items are not live until the audit routine merges them, so a
  mis-keyed item can never reach a bank before an independent session has checked
  it.
- If the audit routine fails to run, those items simply stay in staging (fail-safe)
  — nothing unverified ships.
- bs/disc/email have no multiple-choice answer key, so R1 merging them directly is
  fine.
- CTW (c-test) and speaking (repeat) have no MCQ key either, but they live in the
  reading/speaking staging dirs that `merge-staging.mjs` handles, so the audit
  routine merges them too (the blank/validator vetting still runs at that merge).

## Net effect

- R1: generate + stage everything + merge bs/disc/email + commit/push.
- Audit routine (separate trigger, `audit-routine.md`): extract → solve blind →
  apply (drop mis-keyed) → `merge-staging.mjs` → commit/push.

No code change is needed for this — only the two prompt edits above (R1 here, plus
creating the audit routine from `audit-routine.md`).
