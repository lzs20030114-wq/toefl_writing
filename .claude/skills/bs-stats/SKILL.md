---
name: bs-stats
description: Quick stats dashboard for Build a Sentence question bank and generation pipeline.
user-invocable: true
argument-hint: [--last N]
---

# Build a Sentence — Quick Stats

Show a concise overview of the question bank and pipeline status.

## Steps

1. Run stats dashboard:
   ```bash
   node scripts/run-stats.mjs $ARGUMENTS
   ```

2. Run bank summary:
   ```bash
   node scripts/review-bank.mjs --summary
   ```

3. Check reserve pool and global hashes:
   ```bash
   node -e "
   const fs = require('fs');
   const p = f => { try { return JSON.parse(fs.readFileSync(f,'utf8')); } catch(_) { return null; } };
   const r = p('data/buildSentence/reserve_pool.json');
   const h = p('data/buildSentence/answer_hashes.json');
   const a = (() => { try { return fs.readdirSync('data/buildSentence/archive').filter(f=>f.endsWith('.json')); } catch(_) { return []; } })();
   console.log(JSON.stringify({ reserve: Array.isArray(r)?r.length:0, hashes: Array.isArray(h)?h.length:0, archives: a.length }));
   "
   ```

## Present Results

Show the run-stats dashboard output directly, then append:

```
Bank: X sets, Y questions, score XX/100
Reserve: Z questions | Hashes: N | Archives: M files
```

Parse the review-bank summary JSON and note any DRIFT ratios or fatal issues in one line.
Use Chinese for commentary.
