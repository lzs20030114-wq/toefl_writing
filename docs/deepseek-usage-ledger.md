# DeepSeek 调用台账与成本护栏

**起因（2026-09-01）**：一次本地 Remote Control 会话「真题模块自动化录入」反复 `--force` 全量重跑
真题 OCR 结构化脚本，一天 518 次 DeepSeek 调用 / 2,285,703 tokens / ¥11.97，而线上真实用户当天只有
2 次评分。事后只能靠账单柱状图 + Supabase 日志倒推，因为本地脚本直连 API、没有任何计数。
这份机制让「跑了多少次、花了多少钱、是哪个脚本」在本地随时可查，并在真题结构化脚本上加了熔断。

## 台账文件

- 路径：`<仓库根>/.ops/deepseek-usage.jsonl`（`.ops/` 已在 `.gitignore`，不进仓库；每台机器各自一份）
- 一行一次调用（成功/失败都记）：

```json
{"ts":"2026-09-05T18:02:11.482Z","script":"structure_with_deepseek.py","label":"2.23","model":"deepseek-v4-flash",
 "prompt_tokens":2300,"completion_tokens":1200,"total_tokens":3500,"cached_tokens":0,"ms":8400,"ok":true,"pid":1234}
```

- 谁在写：
  - **Node**：`lib/ai/deepseekHttp.js` 的 `callDeepSeekViaCurl` 内部自动记（几乎所有 `scripts/*.mjs` 生成/审核脚本
    都走它）；`script` 默认取 `process.argv[1]` 的文件名，可传第五个参数 `meta: { script, label }` 覆盖。
    4 个保留裸 `fetch` 回退的测试脚本（`fix-did-distractors` / `test-build-prefilled` / `test-parse-questions` /
    `verify-new-prompt`）也补了记账。
  - **Python**：`scripts/ops/_usage_ledger.py`；`structure_with_deepseek.py` / `structure_ap.py` 已接入。
  - Vercel 上（`VERCEL` / edge runtime）自动 no-op——线上 `/api/ai` 的计量仍以 `daily_usage` 表为准。
- 每记满 25 次在 stderr 打一行 `[deepseek-usage] 本进程已调用 N 次 · X tokens · ≈¥Y`，进程退出再打一次总计。
  跑长脚本的 agent 看到这行就知道钱在往外流。

## 对账

```bash
node scripts/ops/deepseek-usage-report.mjs                      # 最近 7 天，按北京日期 × 脚本
node scripts/ops/deepseek-usage-report.mjs --since=2026-09-01 --until=2026-09-01 --by=label
node scripts/ops/deepseek-usage-report.mjs --rate=5.24 --file=D:/somewhere/deepseek-usage.jsonl
```

估价用混合单价 `DEEPSEEK_CNY_PER_MTOK`（¥/百万 tokens），默认 **5.24 = 9/1 账单 ¥11.97 ÷ 2,285,703 tokens 实测**，
不是官方牌价；对得上账单量级就够用，要精确以 DeepSeek 控制台为准。

## 真题结构化脚本的护栏（`scripts/ops/structure_with_deepseek.py` / `structure_ap.py`）

| 机制 | 行为 |
|---|---|
| 哈希缓存 | 缓存键 = sha1(model + system prompt + 截断后的输入)，写在输出 JSON 的 `_cache.hash`。改 prompt 或 OCR 只重跑受影响的套卷。**迁移前的老输出（没有 `_cache`）仍视为新鲜、照旧跳过**，只有 `--force` 才全量重来——升级后第一次跑不会无意花钱 |
| `--dry-run` | 只打印计划：`将调用 N 次 · 跳过 M 套(缓存新鲜) · 无输入 K 套 · 预计 ≈tokens ≈ ¥`，输出 token 按台账最近 50 次同名脚本均值估（没有历史时按 1500/次兜底）。不需要 API key |
| 熔断 | 真跑前同样先打印计划；计划调用数 > `--max-calls`（默认 200）且没带 `--yes` → 退出码 2、一次不调 |
| 范围 | `--limit=N`、位置参数做套卷子串过滤（`python structure_with_deepseek.py 2.23 3.16`）照旧 |
| 仓库根 | 不再写死 `D:\toefl_writing`，按脚本位置推；`TOEFL_ROOT` 可覆盖 |

**建议的操作顺序**：改完 prompt → `--dry-run` 看要花多少 → 先 `--limit=3` 看质量 → 再放开。
`merge_struct.py` 只读已知字段，`_cache` 对它透明。

## 环境变量

```bash
# DEEPSEEK_USAGE_LOG=            # 可选：台账路径；设为 0 关闭
# DEEPSEEK_CNY_PER_MTOK=5.24     # 可选：估价混合单价 ¥/M tokens
# TOEFL_ROOT=                    # 可选：Python ops 脚本的仓库根覆盖
# DEEPSEEK_USAGE_QUIET=1        # 可选：Node 侧不打「本进程已调用 N 次」进度行（jest 里用）
```

## 没覆盖到的

- 线上 `/api/ai` 直连路径（无代理时走 `fetch`）不记台账——它有 `daily_usage` 计量，且 Vercel 无法落盘。
- Node 生成脚本（`generate-*.mjs`）只记账、不熔断：它们由 routine/workflow 调度，有各自的 count 上限，
  加中止会打断自动化。真要控它们的成本，看台账 + `--count`。
