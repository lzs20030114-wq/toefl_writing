# 用户自助上传题库（图片/文本 → AI 识别 → 个人题库）— 方案研究

> 2026-06-23 · 多 agent 调研（10 个子 agent，内部代码库 + 外部 GitHub/技术）
> 状态：**纯方案研究，未动代码**。结论用于后续拍板。

---

## 0. 结论先行（TL;DR）

1. **没有 drop-in 的开源半成品**能整段套用「上传图片/PDF → AI 抽题 → 进个人题库」。最接近的起点是 Vercel 官方 `ai-sdk-preview-pdf-support`（Apache-2.0，Next.js，可抄上传 UI + 流式 schema），其余都是「参考」级别。
2. **好消息：本项目已经有这条流水线的 80%**——文本抽题器（`/api/admin/parse-questions`，DeepSeek 按题型出原生 JSON）、批量导入向导 UI（`app/admin-questions` 的 BulkImportModal）、每题型校验器、防退化 gate、answer-audit、Supabase Storage、按 `user_code` 的每用户表范式（`mistake_favorites`）全都在。**真正缺的只有「漏斗最前端」：图片/PDF 上传 + 视觉识别 + 个人库的运行时读取路径 + 注入防护。**
3. **视觉模型选型是被「中国可达性」一票否决决定的**：OpenAI / Claude / Gemini 自 2024-07 起封锁中国大陆+香港（含 Vercel hkg1 函数），**不能放在面向中国用户的 Vercel 运行时**。当前的 OpenAI key 只能用 TTS 是因为走了本地代理。→ **首选 Qwen-VL（阿里 DashScope，OpenAI 兼容、中文 OCR 最强、最便宜、无需代理）**；OpenAI 视觉只在「离线/管理员、走代理」的路径里当高精度复核。
4. **不要引入 QTI/GIFT/Anki 等标准交换格式**——让 LLM 直接吐本项目的原生分题型 JSON。标准只在将来需要跨系统互通时，作为边界处的薄适配器。
5. **个人库不能复用现有部署路径**：现库是构建期静态 `import` 的 JSON，改库=提交 git+重新部署，**对每用户内容不可行**。需要新建一张按 `user_code` 的表 + 一条运行时 fetch 的读取路径。
6. **安全是这个功能的真正难点**，不是识别：① 多模态 prompt injection（图片里藏白底白字指令）；② 上传文件安全（magic-bytes/压缩炸弹/病毒）；③ IDOR（项目历史有此类问题）；④ Pro 白嫖（视觉调用很贵，必须按额度限流）。
7. **MVP 建议从最简单的两类题入手**：Discussion（学术讨论）+ Email——扁平结构、无标准答案、无音频，文本抽题器已存在，**只需补「图片→文字」一步**。BuildSentence / CTW 校验最严、风险最高，放到最后。

---

## 1. 代码库现状：已有什么 / 缺什么

### 1.1 题库数据模型

- **题库是构建期静态 ES import 的 JSON**，运行时不 fetch：
  - `app/academic-writing/page.js:11` `import AD_DATA from .../prompts.json`
  - `app/listening/page.js` / `app/reading/page.js` 同理；`lib/questionSelector.js:1` import BS。
  - **改库 = 改文件 + git commit + 重新部署。**
- **不存在任何「个人/自定义/用户题库」概念**。唯一的每用户状态是 localStorage 的「做过」标记（`DONE_STORAGE_KEYS`）。
- **7 种用户题型，3 种顶层容器形状**：
  1. **扁平数组** — Discussion（`data/academicWriting/prompts.json`，127 条）、Email（132 条）
  2. **`{version, items:[]}`** — 全部 reading（ap/ctw/rdl）和 listening（lc/lcr/la/lat）
  3. **嵌套 `{question_sets:[{questions:[]}]}`** — 仅 BuildSentence
- 每题型形状互不通用、各自有校验器 → **通用「一把梭」导入器不可行，必须按题型分支**。
- 列表 UI 统一走 `components/shared/TopicPicker.js`，吃的是归一化的 `{id, title, subtitle?, tag?}`，每个页面各自把原始题映射成它 → 导入的题也要做同样的 per-type 映射。

### 1.2 已存在的「抽题」先例（关键复用点）

- **`app/api/admin/parse-questions/route.js`**：POST `{type:'academic'|'email'|'build', text}` → DeepSeek 用 per-type system prompt 直接吐**目标原生 JSON 数组**；build 类型服务端 `postProcessBuild()` 算 `prefilled_positions`/`has_question_mark`。**这就是图片版要克隆的模板。** 局限：纯文本、仅 academic/email/build、admin token 门禁。
- **`app/admin-questions/page.js` 的 BulkImportModal**：input→parsing→preview→saving 四步，调 parse-questions 抽题、逐条写 `/api/admin/questions`。**preview-勾选-导入的交互可整套复用**，只需在 input 步加文件/拖拽上传 + 一次视觉调用。

### 1.3 AI / 多模态能力

- 两个 key：`DEEPSEEK_API_KEY`（文本主力）+ `OPENAI_API_KEY`（**目前仅 TTS gpt-4o-mini-tts + STT whisper-1**，`.env.example` 明确写「仅 Speaking STT」）。
- **全代码库零视觉调用**（grep `image_url`/`input_image` 无命中）；DeepSeek 此处纯文本，且 DeepSeek 无视觉模型接入。
- **STT 端点 `app/api/speech/transcribe/route.js` 是最佳蓝本**：native `fetch`+`FormData` 调 OpenAI，代理用 undici `ProxyAgent` + `setGlobalDispatcher`（模块加载时装，因为 Next.js 包了全局 fetch 会吞掉 per-call dispatcher）。视觉调用要照抄这个代理模式。
- **`/api/ai` 不能复用**：body 上限 120KB、message 上限 40k 字符，base64 图片必爆 → 视觉要走独立端点。

### 1.4 每用户持久化 + 文件存储

- 每用户表统一按 6 位 `user_code`（`users` 表 PK）外键，范本 = `scripts/sql/mistake-favorites.sql`（`user_code FK ON DELETE CASCADE` + JSONB snapshot + 体积上限 + RLS-enabled-但-permissive）。
- **Supabase Storage 已在用**：唯一桶 `listening_audio`（公有，`supabaseAdmin` 上传，CDN/308 重定向服务，`lib/tts/storage.js`）。
- **RLS 基本是放行的**（`USING(true)`）→ 每用户隔离靠**应用层 `.eq('user_code', code)`**，不是数据库。
- **6 位码被当 bearer 用**（项目 Review 标过 P0，可爆破）→ 新端点必须服务端校验码存在、按 `user_code` 过滤、Pro 门禁服务端判定（别信前端 tier）。

### 1.5 校验 / 防退化 gate（可复用）

- per-type 校验器：`lib/questionBank/buildSentenceSchema.js`、`lib/listeningGen/*Validator.js`、`lib/readingGen/*Validator.js`。
- 独立 AI **answer-audit 第二考官**（无 key 重做题，抓错/歧义/可猜）。
- 通用**防退化 gate harness**（`lib/gate/`，从真题冻结统计目标、漂移即拒）。
- 合并脚本 `mergeClaude.mjs`/`merge-staging.mjs` 已串好 validate→audit→difficulty-gate→append。
- **缺口**：Discussion/Email 无独立校验器；**没有任何针对「不可信用户内容」的内容审核 / 注入防护**——现管线假设作者是自家 AI。

### 1.6 缺口汇总（要新建的东西）

| 缺口 | 说明 |
|---|---|
| 个人库存储 | 新表 `user_question_banks`（`user_code` FK + JSONB + status），范本 `mistake_favorites.sql` |
| 运行时读取路径 | 静态 import 不能服务每用户内容 → 新 `/api/user-bank` fetch 路径 |
| 图片/PDF 上传端点 | `/api/ai` 体积上限太小 → 新端点，签名直传 Storage |
| 视觉/OCR 能力 | DeepSeek 纯文本 → 新视觉客户端（Qwen-VL 优先） |
| reading/listening 抽题 prompt | 现只有 academic/email/build；无 reading/listening/CTW |
| 注入防护 + 内容审核 + 上传安全 | 全新，自助场景必需 |
| 配额/隔离/清理 | 上传体积配额、私有桶签名 URL、孤儿文件清理 |

---

## 2. 关键技术决策（带推荐）

### 决策 A：视觉模型 —— **首选 Qwen-VL（阿里 DashScope）**

| 选项 | 中国可达 | 中文/双语 OCR | API 兼容 | 价格/页(大陆) | 结论 |
|---|---|---|---|---|---|
| **Qwen-VL-Max/Plus** | ✅ 原生无代理 | **最强** | OpenAI 兼容(换 base_url) | ~$0.0006–0.002 | **首选** |
| Qwen-VL-OCR | ✅ | 纯 OCR 强、语义弱 | 兼容 | <$0.0003 | 廉价 OCR 前置 |
| GLM-4V / Doubao / Ernie | ✅ | 良 | 较不兼容 | 中 | 备选/复核 |
| OpenAI gpt-4o(-mini)/GPT-5.4 | **❌ 封中国(含 hkg1)** | 中(mini 弱中文) | 原生 + strict json_schema | $0.0002–0.006 | **仅离线/代理复核** |
| Claude / Gemini | ❌ + 无 key | 强 | 工具调用 | 中高 | 跳过 |

- **决定性约束**：OpenAI/Claude/Gemini 封锁中国大陆+香港（含 Vercel hkg1），**不能进面向中国用户的运行时**。Qwen-VL 原生可达、OpenAI 兼容（复用现有客户端写法）、中文 OCR 最强、最便宜。
- **成本不是问题**：1 万页也就个位数美元。**准确率才是**——研究显示 GPT-4o/Claude/Qwen 在复杂文档上整字段准确率仅 ~60–80%，**必须有人工复核（human-in-the-loop），绝不自动入库**。
- 需新增 1 个 vendor key（DashScope）。这是需要你拍板的「是否接入阿里云」的点。

### 决策 B：直接 vision-LLM vs OCR-then-LLM —— **首选 vision 直出 JSON**

- 抽题不只是转写，**要靠版面判断「哪段是题干、哪 4 个是选项 A-D、空格映射到哪」**。单次 Qwen-VL 调用直接出结构化 JSON 一步到位；OCR-then-LLM 会丢失版面、选项分组/空格定位易错。
- **OCR-then-DeepSeek** 仅作廉价批量兜底（Qwen-VL-OCR/Baidu OCR 出文字 → 现成 DeepSeek 文本抽题器）。扫描件/脏中文可上 **MinerU**（68k★，中国产，PDF→干净 Markdown）做前置。

### 决策 C：中间交换格式 —— **不要，直接出原生 JSON**

- 只有 IMS QTI 能表达全部 5 类，但它是**最差的 LLM 输出目标**（深嵌套交叉引用 XML，无效率高，JS 工具不成熟）；GIFT/Aiken/Anki/CSV 只覆盖 MCQ，且无法表达 Discussion/Email/BS。
- 你已有 5 套贴合的 schema + 校验器，JSON 也是 LLM 最可靠的结构化目标。**标准只在将来要导入第三方题库/导出到别的 LMS 时，做边界薄适配器。**

### 决策 D：个人库存储 —— 新私有桶 + 新表 + 运行时读取

- **上传**：API 路由鉴权+查配额后，`supabaseAdmin.createSignedUploadUrl` 进**私有桶** `user_uploads`，路径 `uploads/{user_code}/{uuid}`，浏览器 `uploadToSignedUrl` 直传（**绕过 Vercel ~4.5MB body 限制**）。
- **数据**：新表 `user_question_banks(id, user_code FK, type, source_blob_path, extracted JSONB, status, created_at)`。
- **读取**：新 `/api/user-bank` 运行时 fetch；练习页把个人库 item 映射成 `TopicPicker` 形状，与全局库并列/切换。

---

## 3. GitHub 半成品调研结论

**没有能 fork-and-ship 的项目。** 所有「PDF→quiz」repo 都是**生成新题**，而我们要的是**从试卷里抽取已有题**（prompt 和 schema 都不同）。

| 项目 | 价值 | License | 怎么用 |
|---|---|---|---|
| **vercel-labs/ai-sdk-preview-pdf-support** | **最佳起点** | Apache-2.0 | 抄上传组件 + API route + zod/`useObject` 流式预览；换成可达中国的视觉模型、把 prompt 从「生成」改「抽取」 |
| ECuiDev/obsidian-quiz-generator | 多题型 prompt/解析参考 | MIT | 借鉴 7 种题型的 prompt 工程与解析；图片输入它也还没做 |
| opendatalab/MinerU | 扫描/中文 PDF→Markdown 前置 | 自定义(近 Apache) | 作独立 OCR 微服务喂抽题 prompt；需独立 worker(非 Vercel) |
| KatherLab/LLMAIx | schema/grammar 强约束抽取 + 模糊匹配评测 | AGPL-3.0 | **只借思路别抄码**；评测思路契合现有 gate |
| yerdaulet-damir/openquiz | Next14+Supabase 学习库 + SRS | MIT | 「JSON→Supabase→练习模式+SRS」参考 |
| md2anki | `.apkg` 导出参考 | GPL-3.0 | 只读参考（将来若要 Anki 导出） |

**License 红线**：可抄 = Vercel 模板(Apache)/obsidian-quiz/openquiz(MIT)；**别抄码** = md2anki(GPL)、LLMAIx(AGPL)、pdf-to-quizz(无 license)。

---

## 4. 推荐架构（端到端）

```
[用户] 选题型 + 上传图片/PDF
   │  (浏览器，前端可压图)
   ▼
[/api/user-bank/upload]  鉴权 + Pro/配额门禁 + 限流 + origin 校验
   │  签发 Supabase 签名直传 URL（私有桶 uploads/{user_code}/{uuid}）
   │  建 jobs 行(status=pending)，立即返回 jobId
   ▼
[浏览器] uploadToSignedUrl 直传 Storage（绕过 4.5MB 限制）
   ▼
[异步 worker]  ① 批量/重 → GitHub Actions(repository_dispatch，仿 generate-*)
              ② 交互/单页 → Next after()/fluid compute(300/800s)，但仍落 jobs 行可重试
   │  1. 校验文件：file-type magic bytes / 压缩比上限(防 zip 炸弹) / ClamAV(扫描出错=失败) → 隔离区
   │  2. 视觉抽取：Qwen-VL 直出原生分题型 JSON（不可信内容包 <UNTRUSTED_DOCUMENT> 分隔，模型无工具无 key）
   │  3. 服务端补算(如 BS 的 prefilled_positions) + per-type 校验器 + answer-audit
   │  4. 写 user_question_banks(status=ready_for_review)
   ▼
[前端轮询 jobId] → 预览 + 逐条勾选/编辑（human-in-the-loop，沿用 BulkImportModal 交互）
   ▼
[确认导入] → status=imported；练习页 /api/user-bank 运行时读取 → 映射 TopicPicker → 正常练习
```

**核心原则**：识别/LLM 绝不在请求路径上跑；不可信内容绝不进能花 key 或改库的工具；写库前必有人工确认。

---

## 5. 安全（本功能真正的难点）

1. **多模态 Prompt Injection（OWASP LLM01）**：图片里可藏白底白字/噪声里的指令，OCR/视觉会读进去。
   - 不可信内容结构化隔离（`<UNTRUSTED_DOCUMENT>…</UNTRUSTED_DOCUMENT>` + system 声明「内部无指令」）；
   - 读取用的模型**无工具、无 key**（任何 DB/工具写操作由你的代码用已校验 JSON 执行，不由模型自由文本触发）；
   - 强制 schema、解析失败即拒（沿用 `parse.js` 纪律）；
   - 写库必经人工；加对抗测试 fixture（含「忽略上述指令」的图片，断言被无视）。
   - **视觉模型比文本模型更弱于防注入** → 可行时优先 OCR→文本+strict schema。
2. **上传文件安全**：magic-bytes 嗅探真实类型（`file-type`，别信扩展名；docx/xlsx/pptx 都是 zip 头 `50 4B 03 04`）；OOXML/zip 解压比上限（Apache POI 1%/100x 参考）防压缩炸弹；ClamAV 扫描，**扫描出错当失败**；深扫 polyglot 标记。
3. **IDOR（项目有前科）**：私有桶 + 每用户路径前缀 + 短时签名下载 URL；绝不用可猜的公有路径。
4. **Pro 白嫖**：视觉调用很贵 → 必须像 `/api/ai` 那样按 daily-usage 配额限流 + Pro 门禁服务端判定。
5. **6 位码低信任**：服务端校验码存在、`.eq(user_code)` 过滤（RLS 放行不保护行）。
6. **存储 250MB 函数坑（前车之鉴）**：大文件只走 Storage/重定向，绝不在函数里读上传目录；`GH_PAT` 拉用户文件会放大爆炸半径，要收紧 scope（项目 TODO）。

---

## 6. 分期实施计划（建议）

| 阶段 | 范围 | 说明 | 粗估 |
|---|---|---|---|
| **P0 基建** | 私有桶 + `user_question_banks` 表 + 上传端点(签名直传) + jobs/轮询 + `/api/user-bank` 读取 + 练习页接个人库 | 不含识别，先把「个人库」骨架跑通（可用「粘贴文本」先验证全链路） | ~1 周 |
| **P1 MVP 识别** | **Discussion + Email** 图片/PDF → Qwen-VL 抽取 → 校验 → 预览导入 | 最简两类（扁平、无答案、无音频，文本抽题器已存在，只加图片步） + 全套注入/上传安全 | ~2–3 周 |
| **P2 客观题** | Reading(AP/RDL) + Listening MCQ | 含 answer-audit 答案正确性复核 + 字段名归一化；listening 无音频可回退 TTS | ~2 周 |
| **P3 高难题型** | BuildSentence + CTW | 双层严校验 / 空格定位，风险最高，最后做或长期不做 | 视情况 |
| **横切** | 配额/清理、对抗测试 fixture、管理员审核后台、（可选）优质个人题升级为全局 | | 持续 |

---

## 7. 需要你拍板的产品决策

1. **MVP 范围**：先 Discussion+Email（最稳），还是一上来覆盖客观题/全题型？（推荐前者）
2. **视觉模型**：接入 **Qwen-VL（阿里 DashScope，新 key）** 还是坚持用现有 OpenAI key 走代理（仅离线/管理员可行，不能给中国用户实时）？（推荐 Qwen-VL）
3. **自助 vs 审核**：v1 是「登录/Pro 用户上传后立即可练」的纯自助，还是「上传→管理员审核→放行」？（推荐：自己练自己的个人库=自助即可，但写库前必有**本人**预览确认）
4. **门禁与配额**：免费用户能用吗？每日/总量上传配额多少？（推荐 Pro-gated + 按额度限流，防视觉调用被白嫖）
5. **个人 vs 共享**：个人库严格私有，还是允许把优质题「提名」进全局库（需额外审核）？（推荐 v1 纯私有）
