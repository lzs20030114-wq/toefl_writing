# 真题自动录入（后台拖入 → 云端 Worker → 自动上线）— 共享契约

> 2026-09-09 定案。两条实施线（A=后台/API/迁移，B=Worker/脚本/Actions）都以本文件为准；
> 改契约先改这里。术语：一个「job」= 一套真题源文件的一次录入。

## 0. 总链路

```
/admin-real-bank-ingest 拖入一套源文件
→ POST /api/admin/real-bank-ingest/jobs 建 job(status=uploading) + 拿每个文件的 signed upload URL
→ 浏览器 supabase-js uploadToSignedUrl 直传桶 real_bank_sources/jobs/<jobId>/<相对路径>
→ POST /jobs/<id>/start：核对文件齐全 → status=queued → GH_PAT workflow_dispatch real-bank-ingest.yml(inputs.job_id) → status=dispatched
→ GitHub Actions(ubuntu) 跑 node scripts/realbank/worker.mjs --job <id>：
    pull 中间产物桶 → 下载源 → 判格式 → ingest → 结构化(DeepSeek) → 盲审(DeepSeek)
    → 音频转写(OpenAI Whisper API) → 听力口语合流 → 造句识图 → build_bank(全量重建)
    → TTS 配音(串行) → 材料原图裁剪+上传 → 写作题量常量同步 → commit+push main
    → push 中间产物桶 → 删源文件 → status=done(result 含 holds)
→ Vercel 自动部署
→ 后台「复核队列」看 holds：放行整科 / 下架单题 → 改 data/realBank/review-overrides.json 或 review-holds.json(经 GitHub Contents API 直接提交 main) → 派一个 rebuild job 重建推库
```

## 1. Supabase 表 `real_bank_ingest_jobs`（迁移文件 `scripts/sql/real-bank-ingest-jobs.sql`）

| 列 | 类型 | 说明 |
|---|---|---|
| id | uuid pk default gen_random_uuid() | jobId |
| set_name | text not null | 用户给的套名（如 `9.12新托福真题`），也是源目录名 |
| set_key | text | Worker 派生的产物 key（第一来源=set_name；第二来源 rf/rp 前缀，见 parse_reformatted.py） |
| kind | text not null default 'ingest' | `ingest` / `rebuild`（rebuild 无源文件，只重跑 build 尾段并推 main） |
| source_kind | text not null default 'auto' | `auto` / `first_pdf` / `vendor_docx` / `screenshot_docx` |
| detected_kind | text | Worker 探测结果 |
| status | text not null default 'uploading' | `uploading` `queued` `dispatched` `running` `needs_format` `done` `failed` `cancelled` |
| stage | text | 当前阶段：`pull_artifacts` `download` `detect` `ingest` `structure` `audit` `asr` `merge_audio` `bs_extract` `build` `audio` `images` `counts` `push` `push_artifacts` `cleanup` |
| progress | jsonb not null default '[]' | `[{ts, stage, msg, level:"info"|"warn"|"error"}]`，Worker 每阶段 append |
| files | jsonb not null default '[]' | `[{path, size, uploaded:boolean}]`，path 为相对源目录路径 |
| cost_cny | numeric not null default 0 | 本 job 实际花费（DeepSeek 余额差 + TTS 估算 + Whisper 估算） |
| result | jsonb | 见 §5 |
| error | text | 失败原因（人能读） |
| gh_run_id | text | Actions run id（Worker 从 `GITHUB_RUN_ID` 写入） |
| created_at / updated_at | timestamptz default now() | updated_at 由应用层写 |

RLS 开启、不建 policy（只 service role 访问，和 `audio_events` 一致）。索引：`(status, created_at desc)`。

## 2. Storage 桶

> 两个桶通用：对象键经 `lib/realBankIngest/objectKey.mjs` 编码（非 `[A-Za-z0-9._-]` 的路径段整段换成 `!<base64url>`），桶内不存原始中文路径；`jobs.files[].path`、API 返回的 `path`、清单 `_manifest.json` 的键仍是原始相对路径。

- `real_bank_sources`（私有）：`jobs/<jobId>/<相对路径>`。job done 后 Worker 删除整目录；failed 保留供 retry。
  单文件上限 50MB（Supabase 免费档限制；超过的后台前端直接拒收并提示）。
- `real_bank_artifacts`（私有）：Worker 的中间产物持久化，布局与本机 `.codex-tmp/` **一一对应**：
  `realbank/<文件或子目录相对路径>` ↔ `.codex-tmp/realbank/...`；`ocr/...` ↔ `.codex-tmp/ocr/...`。
  同步范围（白名单，其余不传）：
  - `.codex-tmp/realbank/*.json`（排除 `*.prev.json`）
  - `.codex-tmp/realbank/{asr,asr-vendor,bs-ocr,_review}/**`
  - `.codex-tmp/realbank/material-images/manifest.json`（图片不传，成品图已在 `real_bank_images` 桶）
  - `.codex-tmp/ocr/**`
  排除：`src-converted/`、`bs-pages/`、`audio/`、`_bank_before/`、`logs/`。
  同步脚本 `scripts/realbank/artifacts_sync.mjs --pull|--push [--dry]`，按 (size, mtime/etag) 增量；push 只上传本次新增/变更文件。
  建桶：首次用 service role 自动建（复用 `lib/wechatQr/storage.js` 的 ensureBucket 模式）。

## 3. 后台 API（全部走 `lib/adminAuth.js` 的 isAdminAuthorized；返回 `{ ok, ... }` 走 lib/apiResponse.js）

| 方法 路径 | 入参 | 出参/行为 |
|---|---|---|
| POST `/api/admin/real-bank-ingest/jobs` | `{set_name, source_kind, files:[{path,size}]}` | 建 job(uploading)；对每个文件 `createSignedUploadUrl(bucket, "jobs/<id>/<path>")`；返回 `{job, uploads:[{path, token, signedUrl}]}`。校验：set_name 只允许 `[\p{L}\p{N}._\-（）() ]`，≤60 字；files ≤ 200 个；单文件 ≤ 50MB；总量 ≤ 400MB；path 不含 `..`/反斜杠。 |
| POST `/api/admin/real-bank-ingest/jobs/[id]/start` | — | 用 service role list 桶目录核对 files 全在 → status=queued → 触发 workflow_dispatch（`real-bank-ingest.yml`, ref main, inputs `{job_id}`）→ status=dispatched。GH_PAT 缺/dispatch 非 204 → status 回 queued 并返回错误。 |
| GET `/api/admin/real-bank-ingest/jobs?limit=50` | — | 列表（不含 progress 全文，带最后一条 progress） |
| GET `/api/admin/real-bank-ingest/jobs/[id]` | — | 详情（含 progress、result） |
| POST `/api/admin/real-bank-ingest/jobs/[id]/format` | `{source_kind}` | 只允许 status=needs_format；写 source_kind → 重新 dispatch |
| POST `/api/admin/real-bank-ingest/jobs/[id]/retry` | — | 只允许 failed；status=queued → dispatch |
| POST `/api/admin/real-bank-ingest/jobs/[id]/cancel` | — | uploading/queued/needs_format/failed → cancelled，并删源目录 |
| POST `/api/admin/real-bank-ingest/rebuild` | `{reason}` | 建 kind=rebuild 的 job 并 dispatch |
| GET `/api/admin/real-bank-ingest/review` | — | 汇总：① 所有 done job 的 `result.holds`（按 set_key 去重，若 review-overrides 已放行则标 resolved）② `data/realBank/review-holds.json` 的 holds ③ `review-overrides.json` 的 allow。读仓库文件走 `lib/githubApi.js`（主分支最新）。 |
| POST `/api/admin/real-bank-ingest/review/decision` | `{action:"allow_section", set_key, section, code, reason}` 或 `{action:"hold_unit", file, id, scope, reason}` | allow_section → 追加进 `review-overrides.json.allow[]`；hold_unit → 追加进 `review-holds.json.holds[]`（格式同现有条目）。用 githubApi putRepoFile 提交 main（message `chore(realbank): review decision …`）→ 自动建 rebuild job 并 dispatch → 返回 `{ok, job}`。 |

Worker 端**不**经这些 API，直接用 service-role supabase-js 读写 jobs 表。

## 4. `data/realBank/review-overrides.json`（新文件，B 线负责让 hold_policy 读它，A 线负责写它）

```json
{
  "_purpose": "后台复核放行清单。allow[] 里的 (set,section,code) 让 hold_policy 对该科该 blocking code 视为放行；删条目 = 恢复扣下。",
  "allow": [
    { "set": "3.24新托福真题", "section": "reading", "code": "section_gap", "reason": "人工核过", "by": "admin", "at": "2026-09-09T10:00:00Z" }
  ]
}
```
`code:"*"` 表示该科全部 blocking code 放行。`hold_policy.holdDecision` 在判扣留前先查 allow。

## 5. `result` 结构（Worker 在 done 时写）

```json
{
  "set_key": "9.12新托福真题",
  "detected_kind": "first_pdf",
  "audit": { "reading": {"agree": 34, "total": 36}, "listening": {...}, "writing": {...}, "speaking": {...} },
  "added": { "ap": 6, "rdl": 8, "ctw": 2, "lcr": 9, "lc": 3, "la": 2, "lat": 4, "repeat": 1, "interview": 1, "bs": 8, "email": 1, "discussion": 1 },
  "holds": [
    { "set": "9.12新托福真题", "section": "listening", "code": "audit_low_agreement", "detail": "盲审 58%", "agreement": 0.58, "questions": 24 }
  ],
  "disagreed": [ { "section": "reading", "qid": "...", "stem": "前 60 字", "key": "B", "model": "C" } ],
  "audio": { "rendered": 21, "cost_cny": 1.9 },
  "images": { "uploaded": 5, "skipped": 3 },
  "commit": "abc1234",
  "counts_after": { "reading": {"ap": 105, "rdl": 118, "ctw": 89}, "listening": {...}, "speaking": {...}, "writing": {"bs": 289, "email": 28, "discussion": 133} }
}
```

## 6. 源格式探测（B 线，`scripts/realbank/detect_source.mjs`，纯函数可单测）

输入：文件相对路径+大小列表（以及必要时读几个文件头）。输出 `{kind, confidence, reason}`：
- `first_pdf`：≥1 个 `.pdf` 且 pdf 文本层密度足够（复用 ingest_common 的判据）或有「答案」pdf；音频 `.mp3/.m4a/.mp4/.mov/.wav` 可有可无。
- `vendor_docx`：`.docx` 文本原生（段落词数 ≥ 500）且（有逐题 mp3 或文件名带 `Q\d`/`第.题`）。
- `screenshot_docx`：`.docx` 内嵌图片 ≥ 10 张且文本词数 < 200。
- 其它 / 置信度 < 0.8 → Worker 置 status=needs_format 并停；后台让人选。

## 7. Actions 工作流 `.github/workflows/real-bank-ingest.yml`

- `workflow_dispatch` inputs: `job_id`(required)。`concurrency: {group: real-bank-ingest, cancel-in-progress: false}`。`timeout-minutes: 300`。`permissions: contents: write`。
- 步骤：checkout → setup-node(.nvmrc)+npm ci → setup-python 3.12 + `pip install -r scripts/realbank/requirements.txt` → `apt-get install -y ffmpeg` → `node scripts/realbank/worker.mjs --job ${{ inputs.job_id }}`。
- 环境（secrets）：`DEEPSEEK_API_KEY` `DASHSCOPE_API_KEY` `OPENAI_API_KEY` `NEXT_PUBLIC_SUPABASE_URL` `SUPABASE_SERVICE_ROLE_KEY`；固定 `REALBANK_ASR_BACKEND=openai`。
- `if: failure()` 兜底步骤：`node scripts/realbank/worker.mjs --job … --mark-failed "actions job failed"`（Worker 自己没来得及写 failed 时补写）。
- git 身份 `realbank-ingest[bot]`，push 用 generate-bs.yml 同款 fetch/rebase/push 重试 ×4（放在 worker.mjs 内部，本机跑同样走这段）。commit message：`data(realbank): ingest <set_name> +<n>题 [job <id前8>]`，**不加 [skip ci]**。

## 8. Worker 行为要点（B 线）

- 同一份 `worker.mjs` 本机与 Actions 都能跑：本机读 `.env.local`；路径一律相对 `process.cwd()`（仓库根）；源目录 = `.codex-tmp/realbank-jobs/<jobId>/<set_name>/`（下载落地处），通过 `REALBANK_SRC` 传给各脚本；Python 解释器 = `process.env.REALBANK_PY || "python"`。
- 阶段推进即写 jobs.progress（append）+ stage；任何阶段抛错 → status=failed + error，且已 pull 的中间产物不 push（避免半截产物污染）。例外：`ingest/structure/audit` 成功而后段失败时，把这三段的产物 push 上去（可 --resume）。
- 付费闸沿用 run_pipeline 的三道（余额预检、每套花费、退出码 3 即停）。
- 全量重建的正确性依赖 pull 到的中间产物完整；pull 后校验 `.codex-tmp/realbank/*.structured.json` 数量 ≥ 上次 push 时记录的数量（记在桶根 `realbank/_manifest.json`），少了就 fail 不 build。
- `build_bank` 与 `render_real_audio` 串行；`crop_materials.py --all` → `upload_material_images.mjs` 串行。
- 写作题量常量：`scripts/realbank/sync_counts.mjs` 从 `data/realBank/writing/*.json` 算出并重写 `components/home/realExamCounts.js` 的 `REAL_WRITING_COUNTS`。
- 转写：`scripts/ops/audio_transcribe.py` 增加 `openai` 后端（env `REALBANK_ASR_BACKEND=openai`，默认 `local` 保持原样）：`whisper-1` + `response_format=verbose_json`，返回同形 `segments(start,end,text)`；文件 > 24MB 用 ffmpeg 切 ≤10 分钟片段再拼时间偏移；走 `HTTPS_PROXY` 若设置。费用按 ¥0.043/分钟计入 cost。

## 9. 环境变量 / secrets 清单（发版前核对）

- Vercel：`GH_PAT`（需 actions:write + contents:write）、`GH_OWNER`、`GH_REPO`、`ADMIN_DASHBOARD_TOKEN`、`SUPABASE_SERVICE_ROLE_KEY`（已有）。
- GitHub secrets：`DEEPSEEK_API_KEY` `DASHSCOPE_API_KEY` `OPENAI_API_KEY` `NEXT_PUBLIC_SUPABASE_URL` `SUPABASE_SERVICE_ROLE_KEY`。
- 首次上线前：本机跑一次 `artifacts_sync.mjs --push` 把现有 `.codex-tmp` 中间产物灌进桶（≈45MB）。
