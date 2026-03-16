---
name: bs-diagnose
description: Diagnose Build a Sentence generation pipeline issues. Use when generation fails, produces low quality, or to understand reject patterns and bottlenecks.
disable-model-invocation: true
user-invocable: true
argument-hint: [--last-run | --rejects | --circuit-breakers | --trend]
---

# Build a Sentence — Pipeline Diagnostics

You are diagnosing the question generation pipeline. Analyze logs, identify bottlenecks, and suggest fixes.

## Parse Arguments

- No args: comprehensive diagnosis (all sections)
- `--last-run`: focus on last run output
- `--rejects`: analyze reject reason patterns
- `--circuit-breakers`: circuit breaker history
- `--trend`: cross-run acceptance rate trends
- `$ARGUMENTS`

## Data Collection

Read these files (handle missing files gracefully):

1. `data/buildSentence/run_history.json` — cross-run metrics array
2. `data/buildSentence/circuit_breaker_log.json` — CB events (check both `events` and `all_events` fields; `all_events` is the persistent cross-run history)
3. `data/buildSentence/reserve_pool.json` — current reserve size
4. `data/buildSentence/questions.json` — check `_meta` for last run stats
5. `data/buildSentence/questions.diagnostics.json` — detailed diagnostics (may not exist)

Also run: `node scripts/run-stats.mjs` for formatted dashboard.

## Diagnosis Sections

### 1. Last Run Analysis

From `questions.json._meta`:
- Target vs assembled sets
- Rounds used, acceptance rate
- Did it hit max rounds? (= stuck)
- Duration

Health assessment:
- Acceptance rate >20%: healthy
- 10-20%: concerning (some bottleneck)
- <10%: critical (pipeline is struggling)

### 2. Reject Pattern Analysis

From run_history `top_reject_reasons` and circuit breaker log:

Categorize rejections:
| Category | Patterns | Meaning |
|----------|----------|---------|
| Pool gates | `pool:low_assembly_value`, `pool:embedded_overflow`, `pool:no_prefilled_quota`, `pool:i_quota_exceeded` | Question is valid but doesn't help assembly |
| Quality gates | `review:score<78`, `review:blocker:*` | AI reviewer rejected |
| Structure gates | `fatal:*` (word count mismatch, distractor issues) | Structural validation failed |
| Dedup gates | `topic:repeat`, `dedup:global_hash` | Content overlap |

For each category: count, percentage of total rejections, whether it's pathological (>40% of rejections from one category = bottleneck).

### 3. Circuit Breaker Analysis

From `all_events` array in circuit_breaker_log.json:
- Which types trigger most? (type frequency table)
- Root cause per type (from event `reasons` field)
- Cooldown effectiveness
- `interrogative` is exempt from circuit breaking

Timeline format:
```
[2026-03-16 14:00] negation breaker @round 6 (i_quota_exceeded ×3) → blocked until round 9
[2026-03-16 14:05] 1st-embedded breaker @round 9 (embedded_overflow ×1, review:blocker ×1)
```

### 4. Cross-Run Trend Analysis

From `run_history.json`:
- Acceptance rate trend (compute: improving/declining/stable)
- Duration trend (increasing = generation harder)
- Global hash count growth (saturation risk if growing fast relative to bank size)
- Reserve pool trend

Flag:
- 3+ consecutive declining acceptance rates
- Last rate below 15%
- Duration >50% increase over last 3 runs
- Global hashes > 500 with bank < 100 questions (high saturation risk)

### 5. Bottleneck Identification

Synthesize findings into PRIMARY bottleneck:

| Bottleneck | Signature | Fix |
|---|---|---|
| Topic exhaustion | `topic:repeat` + `dedup:global_hash` dominant | Diversify generator prompt topics |
| Difficulty imbalance | `low_assembly_value` dominant, easy/hard shortage | Adjust planner difficulty targeting |
| Embedded overflow | `embedded_overflow` frequent | Lower embedded generation, increase cap |
| Prefilled quota | `no_prefilled_quota` dominant | Relax prefilled constraints or adjust generation |
| Reviewer too strict | `review:score<78` or `review:blocker:*` high | Lower MIN_REVIEW_SCORE or adjust reviewer prompt |
| Last-mile stall | 99% progress then stuck 5 rounds | Relax assembly constraints for final set |
| Saturation | high global hashes, `dedup:global_hash` growing | Archive old hashes, refresh topic pool |

## Output Format

Use Chinese. Structure as:

```
## 诊断报告

### 基本状态
(concise summary table)

### 主要发现
1. ...
2. ...

### 瓶颈分析
(primary bottleneck with evidence)

### 建议修复
1. (most impactful)
2. ...

### 健康评分
Pipeline health: X/10
```
