# TOEFL Practice App — Architecture Guide

一款 TOEFL 全科备考 App：写作(讨论/邮件/造句) + 阅读 + 听力 + 口语 + 模考 + 个人题库。
早期只有写作，现已扩到四大科目 12+ 题型；本文件是每个 agent 会话的第一手上下文，
请优先信任「路径 + 一句话职责」，需要细节时再打开对应文件。

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: Supabase (PostgreSQL + Auth)
- **AI 评分/出题**: DeepSeek(写作评分, curl-based HTTP) + Claude(云端 routine 出题)
- **视觉识别**: 通义千问 Qwen3-VL (个人题库图片抽题, OpenAI 兼容接口)
- **语音**: TTS 双 provider(edge-tts 免费 / gpt-4o-mini-tts) + STT(OpenAI Whisper, 口语评分)
- **Payments**: XorPay (扫码) / Afdian 爱发电 (跳转)
- **Hosting**: Vercel (serverless + edge runtime)

## Directory Structure

```
app/                          # Next.js App Router
├── page.js                   # 首页 (任务卡 + 侧栏 + 右栏备考日历/打卡)
├── build-sentence/           # 写作 Task: 拖拽造句 (BS)
├── academic-writing/         # 写作 Task: 学术讨论 (Discussion)
├── email-writing/            # 写作 Task: 邮件
├── reading/                  # 阅读 (?type=ctw|rdl|ap, ?variant=short|long, ?mode=practice) Pro 专属
├── listening/                # 听力 (?type=lcr|lc|la|lat) Pro 专属
├── speaking/                 # 口语 (?type=repeat|interview) Pro 专属
├── mock-exam/                # 写作模考 (3-task + 计时)
├── reading-exam/             # 阅读自适应模考 (M1 路由→M2 分档)
├── listening-exam/           # 听力自适应模考
├── speaking-exam/            # 口语模考
├── post-writing-practice/    # 写后练习
├── mistake-notebook/         # 错题本
├── progress/                 # 练习历史 (+ reading/ listening/ speaking/ 分科历史页)
├── my-bank/                  # 个人题库 (Pro 专属)
├── terms/                    # 条款页
├── admin*/                   # 后台页 (codes/users/questions/staging/analytics/
│                             #   retention/report/voice-vote/surveys/referrals/…)
└── api/                      # 见下方「API」
    ├── ai/                   # DeepSeek 写作评分 (限流 45/min + origin 校验)
    ├── audio/[...path]/      # 听力音频同源流式代理 (Edge, 国内可达 Supabase Storage)
    ├── speech/               # 口语 STT (transcribe) + 录音授权 (consent)
    ├── user-bank/            # 个人题库 (extract / extract-image / render-audio / verify)
    ├── auth/ iap/ usage/ admin/ analytics/ feedback/ referral/ survey/ mistakes/

components/                   # 分科任务 UI + 后台
├── reading/                  # CTWTask, RDLTask (+ AP 复用 RDLTask)
├── listening/                # LCRTask, ListeningMCQTask (LA/LC/LAT), AudioPlayer
├── speaking/                 # RepeatTask, InterviewTask (含录音 + STT)
├── writing/                  # WritingTask, WritingFeedbackPanel, ScoringReport
├── buildSentence/            # 拖拽造句 UI + useBuildSentenceSession hook
├── mockExam/                 # MockExamShell, MockExamResult (+ 自适应壳)
├── userBank/                 # 个人题库导入/管理 UI
├── referral/                 # 推荐邀请浮层/入口
├── home/ history/ mistakes/ login/ admin/
└── shared/                   # ui.js(设计系统 C/FONT/Btn/PageShell), UpgradeModal,
                              #   UsageGateWrapper, TopicPicker

lib/
├── AuthContext.js supabase.js supabaseAdmin.js sessionStore.js cloudSessionStore.js
├── dailyUsage.js rateLimit.js apiResponse.js featureFlags.js draftPersist.js
├── studyPlan.js studyStreak.js        # 备考日历 + 火苗打卡 streak
├── ai/                       # 写作侧：client, deepseekHttp(curl), calibration, parse
│   └── prompts/              #   academicWriting.js, emailWriting.js
├── readingGen/               # 阅读出题：ctw/ap/rdl PromptBuilder + Validator + answerAuditor
├── readingBank/              # 阅读 schema + ETS profile
├── listeningGen/             # 听力出题：lc/lcr/la/lat PromptBuilder + Validator + Auditor
├── speakingGen/              # 口语出题：repeat/interview PromptBuilder + Validator
├── speakingEval/             # 口语评分逻辑
├── bsGen/                    # BS 出题：promptBuilders(纯函数) + circuitBreaker(熔断低通过率)
├── tts/                      # edgeTts / openaiTts / toneDirector(persona) / renderListening / storage
├── userBank/                 # personalBank(拉取+映射picker), imageSniff, listeningAudioRender
├── gate/                     # 通用防退化门：gateHarness + gate-registry + measurers/
├── quality/                  # scoreBatch.mjs (真题校准打分器)
├── mockExam/                 # 模考：service, planner(reading/listening/speaking),
│                             #   adaptiveScoring(M1/M2), adaptiveCheckpoint, bandScore, stateMachine
├── iap/                      # 支付：service, catalog, repository, providers/(xorpay/afdian/mock)
├── referral/                 # 推荐体系：service, state, useReferralFlow
├── questionBank/ mistakeFavorites listeningMistakes readingMistakes
└── mail/                     # 事务性邮件 (QQ SMTP)

data/                         # 题库 + 校准语料 (JSON)
├── buildSentence/            # BS: questions.json(主库) + easy/medium/hard + staging/
├── academicWriting/          # Discussion: prompts.json + real_tpo_reference.json + sample_answers
├── emailWriting/             # Email: prompts.json + tpo_reference.json
├── reading/bank/             # ctw.json, ap.json, rdl-short.json, rdl-long.json (+ staging/, profile/)
├── listening/bank/           # lcr.json, lc.json, la.json, lat.json (+ staging/, profile/)
├── speaking/bank/            # repeat.json, interview.json (+ staging/, profile/)
├── realExam2026/             # ★真题 ground truth (reading/listening/speaking/writing) — 校准基准
├── eval-profiles/            # 各题型 eval 画像 + gate 标准 (bs/ad/email/ctw/ap/listening/...)
├── vocabulary/               # 词表
├── announcements.json        # 应用内更新公告 (发版时改)
└── claudeGen/reports/        # 历次 review 报告
```

## Key Data Flows

### 1. 认证 (Auth)

```
用户 → LoginGate
  ├── 邮箱 OTP / 密码: emailAuth.js → Supabase Auth → users 表 (自动创建)
  └── 6位码: authCode.js → users 表验证
→ AuthContext (localStorage 持久化: code, email, tier)
→ 新用户自动赠送 3 天 Pro 试用
```

### 2. 写作 AI 评分 (Scoring)

```
WritingTask 提交 → lib/ai/client.js → POST /api/ai →
  rateLimit (45/min per IP) → deepseekHttp.js (curl → DeepSeek) →
  parse.js (提取 ===SCORE=== / ===ANNOTATION=== / ===ACTION===) →
  calibration.js (校准到 ETS band) → WritingFeedbackPanel 渲染批注
```
阅读/听力客观题在前端本地判分算 band(见各 page.js 的 saveSession)；口语走 STT + speakingEval。

### 3. 支付 (Payment)

```
UpgradeModal → XorPay(扫码/webhook) 或 Afdian(跳转 ifdian.net/webhook)
→ POST /api/iap/webhook → iap_webhook_events 去重 → iap_entitlements 记录
→ users.tier='pro' 升级 → 前端轮询 user-info 检测到 tier 变化
```

### 4. 题目生成 (Generation)

```
【主链路】Claude 云端 routine (每晚 03:00 北京时间, trig_01SmJeXr8ySEZRo2dEoohzTP)
  → 跑校准过的 prompt (lib/*Gen/) 生成 → Validator/Auditor 校验 →
  → lib/gate 冻结防退化门 (BS_GATE_ENFORCE 默认=1, FAIL 即拒合) →
  → 合进 data/**/bank/ live 库 → 直接 push
  文本生成走 Claude 订阅(边际~¥0)；只有听力 TTS 配音按量掏钱。

【配音回填】backfill-audio.yml 自动给缺 audio_url 的听力题补 TTS。

【后备/手动】.github/workflows/nightly-bank-refresh.yml 是手动 fallback(仅当 routine 挂了);
  nightly-quality-monitor.yml 是唯一还在自动 cron 的 workflow(质量监控, 非生成)。
  admin-generate* 页 + generate-*.yml 仅剩人工触发后备，不再是常规产线。
```

### 5. 质量校准 (Calibration)

```
data/realExam2026/ (真题 ground truth) = 唯一标准锚点
  → lib/quality/scoreBatch.mjs + data/eval-profiles/ 打分 → docs/eval-spec/ 逐题型标准
  → lib/gate/gate-registry.js 声明「维度(检测器+policy+tol+precision+why)」→ 自动从真题 derive 冻结带
质量退化了走 /calibration-fix (诊断 → 修 → 锁死不再回退)。
hard-gate 要求 detector_precision≥0.95，否则只能 monitor/drift。
```

### 6. 模考自适应 (Adaptive Mock)

```
阅读/听力/口语模考: Module 1 做完 → 按正确率路由 (≥0.6 → upper, 否则 lower)
  → Module 2 按 upper/lower 供不同难度档题 → calculateAdaptiveScore:
     rawScore = M1正确率*0.4 + M2正确率*0.6，band = rawScore * maxBand(四舍五入到 0.5)
     maxBand: upper 路 6.0 / lower 路 4.0 (下行路即使满分也封顶 4.0)
  lib/mockExam/adaptiveScoring.js + adaptiveCheckpoint.js(可中途续考)
写作模考仍是 3-task 固定卷(lib/mockExam/service.js + stateMachine)。
```

### 7. 个人题库 (User Bank, Pro 专属, v1.11.0 全 12 题型)

```
my-bank/ 上传(文本或图片) → /api/user-bank/extract(-image):
  图片走 Qwen3-VL 抽题；听力题 render-audio 用 edge-tts 免费配音(fail-open → 浏览器朗读)
→ user_question_banks 表 → lib/userBank/personalBank.js 运行时拉取
→ 只并入各科 practice picker(带「我的」标签)，不进 standard 随机池。
```

## API 一览 (app/api/*)

- `ai/` 写作评分 · `audio/[...path]/` 听力音频 Edge 代理 · `speech/{transcribe,consent}` 口语 STT
- `user-bank/{extract,extract-image,render-audio,verify}` 个人题库
- `auth/` 认证 · `iap/{checkout,webhook,entitlements,products}` 支付 · `usage/` 每日用量
- `referral/{bind,activate,stats}` 推荐 · `survey/` 问卷/投票 · `mistakes/favorites` 错题收藏
- `analytics/track` 事件 · `feedback/` 反馈
- `admin/` 后台：questions/staging/generate-*/users/codes/grant-pro/analytics/retention/report/voice-vote/surveys/referrals

## Database (Supabase)

| Table | Purpose |
|-------|---------|
| `users` | code(PK), email, tier, tier_expires_at, auth_uid, pro_trial |
| `access_codes` | 登录码管理 |
| `daily_usage` | user_code, date, usage_count (免费 3次/天) |
| `daily_speech_usage` | 口语 STT 每日配额 |
| `sessions` | user_code, session_data(JSON) — 练习历史云同步 |
| `iap_entitlements` | user_code, product_id, provider, provider_ref |
| `iap_webhook_events` | provider, event_id — 支付回调去重 |
| `user_question_banks` | 个人题库 (widen-types 迁移后支持全 12 题型) |
| `referrals` / `referral_events` | 推荐关系 + 事件 |
| `mistake_favorites` | 错题收藏 |
| `user_surveys` | 问卷/语音投票 |
| `page_views` | 埋点 |
| `api_error_feedback` | 用户上报的 API 错误 |

迁移文件在 `scripts/sql/`；执行台账见 `scripts/sql/MIGRATIONS.md`(SQL 走 /sql-migrate)。

## Tier System

- **free**: 3 次/天, 写作基础功能；阅读/听力/口语/个人题库均为 Pro 专属
- **pro**: 无限次, 完整 AI 批改 + 全科解锁, 有过期时间 (tier_expires_at)
- **legacy**: 旧版 tier, 等同 pro

## Environment Variables

```bash
# AI (写作评分)
DEEPSEEK_API_KEY=             # DeepSeek API 密钥
# DEEPSEEK_PROXY_URL=         # 可选代理 (国内服务器访问)

# OpenAI (口语 STT Whisper-1；Vercel 美区直连，本地调试用 HTTPS_PROXY)
OPENAI_API_KEY=
# HTTPS_PROXY=http://127.0.0.1:10808

# Qwen3-VL (个人题库图片抽题, OpenAI 兼容；默认大陆 endpoint 直连)
DASHSCOPE_API_KEY=
# DASHSCOPE_BASE_URL=         # 默认大陆；国际/免费额度区用 dashscope-intl
# QWEN_VL_MODEL=qwen3-vl-plus # 批量可换 qwen3-vl-flash

# Database
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Admin / SEO / Mail
ADMIN_DASHBOARD_TOKEN=
NEXT_PUBLIC_SITE_URL=
MAIL_HOST= MAIL_PORT= MAIL_SECURE= MAIL_USER= MAIL_PASS= MAIL_FROM_NAME=  # QQ SMTP 授权码

# Payment 开关 + provider
NEXT_PUBLIC_IAP_ENABLED= IAP_ENABLED=
IAP_PROVIDER=xorpay|afdian|mock
IAP_WEBHOOK_SECRET=
XORPAY_AID= XORPAY_APP_SECRET= XORPAY_NOTIFY_URL=       # xorpay
AFDIAN_API_TOKEN= AFDIAN_USER_ID= AFDIAN_SPONSOR_URL=   # afdian

# 出题生成后备 (GitHub Actions, 可选；主链路是 Claude routine 不吃这些)
# GH_OWNER= GH_REPO= GH_PAT=
```
注：**TTS provider 是脚本 CLI 参数(`--tts-provider edge|openai`)不是 env var**；OpenAI TTS 复用 `OPENAI_API_KEY`。

## Conventions

- **Styling**: 内联 style objects, 设计系统在 `components/shared/ui.js` (C=颜色常量, FONT)
- **State**: 无 Redux/Zustand, 用 useState + localStorage + Supabase
- **API**: 所有 API 返回 `{ ok: boolean, ...data }` 格式, 见 `lib/apiResponse.js`
- **Prompts**: AI prompt 模板集中在 `lib/*Gen/` 与 `lib/ai/prompts/`, 纯字符串拼接, 不引入模板引擎
- **题库格式**: 各题型 bank 为 `{ items: [...] }`；Discussion 题 `{ id, course, professor, students }`；
  阅读/听力/口语 item 形状见各 `lib/*Gen/*Validator.js`
- **出题不许自由发挥**: 一切以 `data/realExam2026/` 真题为锚，改 prompt 前先看 `docs/eval-spec/` 对应文件
- **安全**: middleware.js 设安全头, admin API 需 token, /api/ai 有限流 + origin 校验；
  个人题库 strip audio_url/白名单删桶；音频代理拒 `..`/反斜杠/非白名单扩展名

## 协作约定 (Agent Conventions)

- **模型分工**: 主线程(Fable)只做规划/决策/审查。派 Agent 必须显式传 model 参数——实施类=opus、搜索/整理/机械改动=sonnet、只读探索用 Explore 类型；不传 model 会静默继承贵模型。spec 必须自包含。
- **环境**: Windows 11 + PowerShell 5.1(Bash 工具=Git Bash)。禁止假设 Unix：没有 /tmp、install.sh 类脚本通常不适用、路径用正斜杠或转义。
- **后台长任务**: Workflow/子代理/长脚本每完成一个阶段要向用户回报一行进度，不许黑盒静默跑。
- **报告语言**: 一律中文。
- **固定入口**: 开工先看 docs/BACKLOG.md（统一挂起清单）；推送走 /ship；发版走 /release-notes；SQL 迁移走 /sql-migrate；题库质量退化先走 /calibration-fix；GitHub 方案调研走 /research-reuse。
- **发版前置**: 未跑迁移(scripts/sql/MIGRATIONS.md)/未翻 flag/未勾 Vercel env 必须在推送前核对。
