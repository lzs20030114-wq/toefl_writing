---
name: bs-stats
description: Quick stats dashboard for Build a Sentence question bank and generation pipeline.
user-invocable: true
argument-hint: [--last N]
---

# Build a Sentence — Quick Stats

> **⚠️ 管线现状(2026-07-05)**：现行生产管线 = claude.ai 云端 routine 每晚生成 + `lib/gate/` 冻结门（`BS_GATE_ENFORCE` 默认开启，`mergeClaude`/`appendBSSets` 默认强制）。本 skill 描述的本地 DeepSeek 管线是**手动后备**。live 库 = `data/buildSentence/questions.json`（`question_sets` 键，约 534 题 = `cg_bs_*` 194 + `ets_*` 340，nightly 持续增长）。质量问题优先走 `/calibration-fix` 和 `lib/quality/scoreBatch` + `data/eval-profiles/`，不要按本文的旧硬编码比例目标修"假回归"。

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

3. ⚠️ `answer_hashes.json` / `reserve_pool.json` / `run_history.json` 是旧本地管线的产物，**停更于 2026-05-14**，读出来的数字不反映现在的 live 库（live 库靠 nightly routine + gate 增长，走的是完全不同的路径）。展示这些数字时要标注"来自旧管线，仅供参考"，不要拿来判断当前库健康度。

   Check reserve pool and global hashes:
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
