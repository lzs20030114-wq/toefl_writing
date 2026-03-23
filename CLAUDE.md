# TOEFL Writing Practice App — Architecture Guide

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: Supabase (PostgreSQL + Auth)
- **AI**: DeepSeek API (via curl-based HTTP client)
- **Payments**: XorPay (QR code) / Afdian (redirect)
- **Hosting**: Vercel-compatible (serverless)

## Directory Structure

```
app/                          # Next.js App Router
├── page.js                   # Homepage (task cards + sidebar)
├── layout.js                 # Root layout (metadata, fonts)
├── build-sentence/           # Task 1: 拖拽造句
├── academic-writing/         # Task 2: 学术讨论 (Academic Discussion)
├── email-writing/            # Task 3: 邮件写作
├── mock-exam/                # 模考 (3-task exam with timer)
├── post-writing-practice/    # 写后练习
├── progress/                 # 练习历史
├── terms/                    # 条款页
└── api/
    ├── ai/                   # DeepSeek 评分接口 (rate limited 45/min)
    ├── auth/                 # 认证 (email OTP / 6位码 / 密码)
    ├── iap/                  # 支付 (checkout, webhook, entitlements)
    ├── usage/                # 每日用量追踪 (free: 3次/天)
    ├── admin/                # 管理后台 (题库、用户、分析)
    ├── analytics/            # 事件追踪
    └── feedback/             # 用户反馈

components/
├── LoginGate.js              # 登录入口 (email/code/password 三种方式)
├── ToeflApp.js               # App root provider
├── ProgressView.js           # 历史记录展示
├── home/                     # 首页组件
│   ├── HomePageClient.js     # 首页主体
│   ├── HomeSidebar.js        # 侧边栏 (任务快捷入口 + 统计)
│   └── HomeTaskCard.js       # 任务卡片
├── buildSentence/            # 造句任务
│   ├── BuildSentenceTask.js  # 拖拽 UI
│   └── useBuildSentenceSession.js  # 会话管理 hook
├── writing/                  # 写作任务
│   ├── WritingTask.js        # 提示 + 输入 + 提交
│   ├── WritingFeedbackPanel.js  # AI 批改展示 (annotation 渲染)
│   └── ScoringReport.js      # 评分详情
├── mockExam/                 # 模考
│   ├── MockExamShell.js      # 考试容器
│   └── MockExamResult.js     # 成绩单
└── shared/
    ├── ui.js                 # 设计系统 (C=颜色, FONT, Btn, PageShell...)
    ├── UpgradeModal.js       # 付费弹窗 (XorPay QR / Afdian 跳转)
    ├── UsageGateWrapper.js   # 免费用户次数限制拦截
    └── TopicPicker.js        # 题目/语法点选择器

lib/
├── AuthContext.js            # 认证持久化 (localStorage: code, email, tier)
├── supabase.js               # Supabase 客户端初始化
├── supabaseAdmin.js          # Supabase admin 客户端 (service role)
├── sessionStore.js           # 练习历史 (localStorage + 云同步)
├── dailyUsage.js             # 每日用量 (daily_usage 表)
├── rateLimit.js              # API 限流 (内存滑动窗口)
├── ai/
│   ├── client.js             # 前端 AI 调用封装 → POST /api/ai
│   ├── deepseekHttp.js       # 后端 DeepSeek HTTP (curl-based)
│   ├── calibration.js        # 分数校准 → ETS band
│   ├── parse.js              # AI 响应解析 (提取分数/批注/问题)
│   └── prompts/
│       ├── academicWriting.js  # Discussion 评分 prompt + 出题 prompt
│       └── emailWriting.js     # Email 评分 prompt
├── iap/
│   ├── service.js            # 支付核心 (checkout, webhook, tier升级)
│   ├── catalog.js            # 商品定义 (周¥9.99 → 年¥259.88)
│   ├── repository.js         # 数据层 (entitlements, webhook去重)
│   └── providers/
│       ├── xorpayProvider.js # XorPay (扫码支付)
│       ├── afdianProvider.js # 爱发电 (赞助跳转, ifdian.net)
│       └── mockProvider.js   # 测试用
├── bsGen/                    # Build Sentence 生成管线
│   ├── promptBuilders.js     # prompt 构建 (纯函数, 无副作用)
│   └── circuitBreaker.js     # 熔断器 (acceptance<20% 时阻断该类型)
├── questionBank/             # 题目验证
│   ├── buildSentenceSchema.js  # 题目 JSON schema 校验
│   └── difficultyControl.js    # 自适应难度
├── mockExam/                 # 模考逻辑
│   ├── service.js            # 会话管理 + 评分
│   ├── stateMachine.js       # 状态机 (started→running→scoring→done)
│   └── bandScore.js          # TOEFL band 分数计算

data/                         # 静态题库 (JSON)
├── buildSentence/            # 造句题 (按 easy/medium/hard 分文件)
│   ├── questions.json        # 主题库
│   └── staging/              # AI 生成暂存区 (待审核)
├── academicWriting/
│   ├── prompts.json          # Discussion 题目 (ad61-ad99)
│   └── real_tpo_reference.json  # 真题参考 (ad1-ad25)
└── emailWriting/
    └── prompts.json          # 邮件写作题目
```

## Key Data Flows

### 1. 认证 (Auth)

```
用户 → LoginGate
  ├── 邮箱 OTP: emailAuth.js → Supabase Auth → users 表 (自动创建)
  ├── 6位码: authCode.js → users 表验证
  └── 密码: emailAuth.js → Supabase Auth
→ AuthContext (localStorage 持久化: code, email, tier)
→ 新用户自动赠送 3 天 Pro 试用
```

### 2. AI 评分 (Scoring)

```
WritingTask 提交 →
  lib/ai/client.js → POST /api/ai →
    rateLimit (45/min per IP) →
    deepseekHttp.js (curl → DeepSeek API) →
    parse.js (提取 ===SCORE=== / ===ANNOTATION=== / ===ACTION===) →
    calibration.js (校准到 ETS band) →
  → WritingFeedbackPanel 渲染批注
```

### 3. 支付 (Payment)

```
UpgradeModal →
  XorPay: POST /api/iap/checkout → QR码 → 用户扫码 → webhook 回调
  Afdian: 复制登录码 → 跳转 ifdian.net → 留言栏粘贴码 → webhook 回调
→ POST /api/iap/webhook →
  webhook_events 去重 → iap_entitlements 记录 → users.tier='pro' 升级
→ 前端轮询 user-info 检测到 tier 变化 → 显示成功
```

### 4. 题目生成 (Build Sentence)

```
Admin → POST /api/admin/generate-bs → GitHub Actions workflow →
  bsGen/promptBuilders.js (构建 prompt) →
  DeepSeek 生成 → questionBank/ 校验 →
  circuitBreaker (熔断低通过率类型) →
  data/buildSentence/staging/ (暂存) →
  Admin 审核 → deploy → questions.json
```

## Database (Supabase)

| Table | Purpose |
|-------|---------|
| `users` | code(PK), email, tier, tier_expires_at, auth_uid, pro_trial |
| `daily_usage` | user_code, date, usage_count (免费用户 3次/天) |
| `sessions` | user_code, session_data(JSON) — 练习历史云同步 |
| `iap_entitlements` | user_code, product_id, provider, provider_ref |
| `webhook_events` | provider, event_id, processed_at — 支付回调去重 |

## Tier System

- **free**: 3 次/天, 基础功能
- **pro**: 无限次, 完整 AI 批改, 有过期时间 (tier_expires_at)
- **legacy**: 旧版 tier, 等同 pro

## Environment Variables

```bash
# AI
DEEPSEEK_API_KEY=              # DeepSeek API 密钥
DEEPSEEK_PROXY_URL=            # 可选代理 (国内访问)

# Database
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Payment (选其一)
IAP_PROVIDER=xorpay|afdian|mock
IAP_WEBHOOK_SECRET=
XORPAY_AID=                   # XorPay 商户号
XORPAY_APP_SECRET=             # XorPay 密钥
AFDIAN_API_TOKEN=              # 爱发电 token
AFDIAN_USER_ID=                # 爱发电用户 ID

# Admin
ADMIN_DASHBOARD_TOKEN=         # 管理后台认证

# Build Sentence 生成 (GitHub Actions)
GH_OWNER=
GH_REPO=
GH_PAT=
```

## Conventions

- **Styling**: 内联 style objects, 设计系统在 `components/shared/ui.js` (C=颜色常量, FONT)
- **State**: 无 Redux/Zustand, 用 useState + localStorage + Supabase
- **API**: 所有 API 返回 `{ ok: boolean, ...data }` 格式, 见 `lib/apiResponse.js`
- **Prompts**: AI prompt 模板集中在 `lib/ai/prompts/`, 纯字符串拼接, 不要引入模板引擎
- **题库格式**: Discussion 题 `{ id, course, professor: {name, text}, students: [{name, text}] }`
- **安全**: middleware.js 设置安全头, admin API 需 token, /api/ai 有限流 + origin 校验
