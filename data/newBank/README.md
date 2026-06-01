# newBank — staging area for a one-shot bank replacement

This folder holds a **fresh question bank, built separately from the live bank**, so we can
generate + review it in isolation and then swap it in wholesale. **The live bank is never
touched until you explicitly run `promote`.**

Layout mirrors the live bank exactly (drop-in shape), for all 12 types:

```
buildSentence/questions.json          reading/bank/{ap,ctw,rdl-long,rdl-short}.json
listening/bank/{lat,lc,la,lcr}.json   speaking/bank/{repeat,interview}.json
academicWriting/prompts.json          emailWriting/prompts.json
```

## Workflow

```bash
# 1. (once) create the empty mirror
node scripts/newbank.mjs init

# 2. deposit freshly-generated questions HERE (not live) by running the merges with
#    NEWBANK_ROOT set. Both merge scripts honour it; the live bank stays untouched.
NEWBANK_ROOT=data/newBank node scripts/merge-staging.mjs           # reading + listening + speaking
NEWBANK_ROOT=data/newBank node scripts/mergeClaude.mjs bs   <file> # build-sentence
NEWBANK_ROOT=data/newBank node scripts/mergeClaude.mjs disc <file> # academic discussion
NEWBANK_ROOT=data/newBank node scripts/mergeClaude.mjs email <file># email

# 3. check progress any time
node scripts/newbank.mjs status

# 4. when ready, the ONE-SHOT swap (dry-run first; --yes to apply; live files backed up)
node scripts/newbank.mjs promote --mode=replace        # live becomes exactly newBank
node scripts/newbank.mjs promote --mode=append         # append newBank items into live (dedup by id)
node scripts/newbank.mjs promote --mode=replace --yes  # actually write it
```

`promote --yes` backs up every live file it overwrites to `data/newBank/.backup-<timestamp>/`
before writing, so the swap is reversible.

Every item deposited here passes the **same validators as the live merge** (the BS
coherence gate, the CTW blanker, AP/RDL/listening/speaking validators) — newBank can only
ever contain shippable items.
