# Changelog

## 2026-06-05 — v1.8.2

- **模考贴近真考（6.4 反馈批量）** (`4458d45` + `21e743a` + `2959de8` + `992016e`)：
  - tier-1：阅读/听力模考返回改回各自板块（`/?section=reading|listening`，原先一律回写作首页）；造句句首字母自动大写（`formatChunkDisplay` 加 `capitalizeFirst`，只大写答题区首 token）；模考态造句按钮 `embedded ? "提交" : "完成并查看结果"` + 顶部「第 X/Y 题」；错题本返回键移右上对齐全站。
  - **模考过程不再泄露答案**：`AdaptiveExamShell` 内联答题组件加 `revealAnswers`（默认 false）门，提交后不再染红绿/显示正确答案；内部判分与自适应分流不变，复盘仍在历史记录。同步收紧填空 `maxLength`（`missingLen+2` → `missingLen`）并移除内联填空的回车直接提交。
  - **模考续考**：新增 `lib/mockExam/adaptiveCheckpoint.js`（section-keyed、2h TTL、仅 module1/2）。`AdaptiveExamShell` 在进度里程碑落盘（timeLeft 走 ref 不每秒写；guard 跳过「整模块刚答完」瞬态保证 `currentItemIndex===results.length`，恢复不重复计分）；intro 提供「继续上次模考 / 重新开始」，退出保留、交卷/重开/新开清空。
  - **造句自由导航**：去 `disabled={!allFilled}`（可跳题），保留「上一题」；`recordAndSaveCurrent()` 让 goBack 离开即记录避免丢答案。曾加的题号索引条按真考无此功能移除（`992016e`，删 `jumpTo`/`navStrip`/`bs-nav`）。
  - **学术文章词汇题高亮**：新增纯函数 `lib/reading/vocabHighlight.js`（`getVocabTargetWord` 解析题干 `The word/phrase "X"`、`splitForHighlight` 整词大小写不敏感切分、共享 `VOCAB_HIGHLIGHT_STYLE`，8 单测）；接入 `MCQInlineTask`（模考）+ `RDLTask`（练习），仅当前题为 vocab-in-context 时高亮。
- **听力节奏 + 回放** (`0f35211` + `ea3e27a` + `697b6fa` + `1d6ea46` + `15c1c8e`)：答题计时改为音频结束后才起、按题型配速；练习/模考移除重播按钮 + 加「真实考试只播一次」提示；LCR 结果复盘加回放音频按钮；LCR 答题计时缩短到 15s。
- **历史记录复盘** (`9d441ef` + `7f2bdea` + `0d6614c`)：听力模考记录逐题复盘；修复听力/写作练习记录题目内容不显示；模考成绩页引导去练习记录看逐题详情。
- **AI 评分稳定性** (`23ede3c`)：DeepSeek 传输层瞬时失败有界重试，减少偶发评分失败。
- **其它**：每日 AI 额度服务端计量（`e0b7f27`，`/api/ai`）；IAP webhook 签名常量时间比较（`9b0c89a`）；progress 视图抽取共享 trend chart / bandColor / StatCard（`7dff11f` + `2ad4e57`）；first-set 问卷 V1对比/新用户变体重设计（`2e9e0d1`）。

## 2026-06-02 — v1.8.1

- **听力音频上线即可播放（v1.8.0 题库刷新后三连修复）**：新增 419 条音频后，线上音频经历三步才真正可播——
  - `1f03530` 先把 `data/listening/audio` 挪到 `public/listening-audio`（CDN 静态，不再被 `/api/audio` 的 `readFileSync` 拖进 serverless 函数 → 避开 Vercel 250MB 上限），672 条 `audio_url` 重指，`/api/audio` 改 308 跳转保留旧链。
  - `2920fe5` 进一步把全部 853 个文件搬到 Supabase Storage 公开桶 `listening_audio`，`git-rm` 本地音频 + gitignore，部署体积归零（250MB 上限再无法触发）。
  - `0f304a1` 补 CSP：`media-src` 漏加 `https://*.supabase.co`（之前只改了 connect-src）导致 `<audio>` 被浏览器拦截，补齐后听力音频恢复加载；口语走 speechSynthesis + blob 录音不受影响。
  - `eb3734a` 修每日 backfill 把新题音频写成死的本地 URL：根因 (1) `lib/tts/storage.js` 的 `getAdmin()` memo sentinel 初值 `null` 让 `_admin !== undefined` 守卫首调即短路，Supabase 上传路径在所有环境都是死代码；(2) `backfill-audio.yml` 没注入 Supabase 凭据。改 sentinel 为 `undefined` + 注入 secrets + 加 preflight/per-upload 硬失败（`TTS_ALLOW_LOCAL=1` 才允许本地）防止再悄悄回退。
- **阅读真考双栏布局** (`6f25605`)：`RDLTask`（练习 RDL + 学术文章）与 `AdaptiveExamShell` MCQ（自适应模考 RDL/AP）改为「左原文 | 右题目」双栏独立滚动，对齐真实托福界面；CTW 填空与听力保持单栏；`<=768px` 堆叠回单栏。
- **旧库退役为 V1 + 历史精确重练** (`ff762a4`)：题库 swap 到 V2（`6d737d1`）后，swap 前的练习记录打「V1题库」chip——`isV1Session`（`lib/history/bankVersion.js`）**按日期判定，非 id**，因 email `em*` id 在 V1/V2 间碰撞但内容不同。「再练一遍（同题）」改用一次性 `sessionStorage` 快照 handoff（`lib/history/retry.js` → `WritingTask` 预置）精确还原原题，不再 resolve `retryPromptId`（对 V1 会 404 + 误命中碰撞的 email id）。新 session 盖 `details.bankEpoch` 供未来精确判定；含 email id 碰撞的单测 + `WritingTask` 集成测试。
- **微信群二维码** (`568fc34` + `66637d4` + `3b50220`)：刷新过期失效的群二维码；`WechatGroupModal` 改用共享 `WechatQrImage` 组件（点击全屏放大），与首页侧栏统一——这是最后一处内联 QR `<img>`，至此放大行为全站一致；补提交此前未跟踪、导致 Vercel 构建 module-not-found 的 `WechatQrImage` 组件文件。
- **题库体验问卷 round v2** (`b2e6b1f` + `f0b4336` + `25c2fd7`)：借题库刷新对**所有**用户（含已答 round-1 的）重新发问卷，survey_type 升到 `first_set_completion_v2`（`lib/survey/firstSetSurveyType` 共享常量；`unique(user_code, survey_type)` 保留 round-1 数据为独立行）。门控只数 realExam2026 上线后（`FIRST_SET_SURVEY_SINCE = 2026-06-02T03:06Z`）完成的 session，避免返场用户一进页面即弹（实测可少误弹 36 人，符合「first-set」语义）。新增「再做两套看看」snooze（再完成 2 套自动重弹、再关则永久消失，至多一次；存为 `{snoozePending,baseline}` 标记行，无 schema 变更，且不计入 admin 跳过/完成统计）+ 首页侧栏（桌面 NavSidebar + 移动端，仅登录态）蓝绿渐变「填写题库体验问卷」入口，经 `window` 事件桥（`lib/survey/openFirstSetSurvey`）随时打开。admin `/api/admin/surveys` 加 `?round=`（current/previous/all）重新可查 round-1 的 17 份历史回答。

## 2026-06-02 — v1.8.0

- **整库重造并整体替换上线**：用 realExam2026（2026 改后真考）重新校准的 prompt 全新生成了全部 12 个题型、~938 道题，一次性替换原线上库（旧混版库已备份于 `data/newBank/.backup-2026-06-02T03-05-18-047Z/`，可回滚）。
- 生成走 plan→fan-out workflow：每题型独立 writer，planner 预分配互斥切片防同波撞题；跨波多样性靠 `print-bank-prompt` 注入的 live∪newBank 排除（`NEWBANK_ROOT`）+ `dedup-newbank` 内容去重兜底。`scripts/merge-staging.mjs` 增加 id 兜底（无 id 项不再坍缩为单条"重复"）。
- BS 修复两层：(1) `validateQuestion` 新增 `incoherent_dialogue` 门——问句答案必须回应、不得复读，豁免 `task_kind="ask"` + 元指令；(2) direct-question 校验对齐两轮对话模型（`isConversationalDialogueTurn` 放行陈述开场），BS 集合做 chunk/prefilled 重叠修复 + `validateRuntimeQuestion` + 集合门组装。
- 迁移：线上库中 2026-05-31 校准边界之后由 routine 自动产出的题，经当前全套校验器复核 + 去重后并入新库（+214 非 BS / +45 BS）；879 道旧混版 BS 正确排除。
- 音频：419 条新听力/口语题用 edge-tts 补齐，听力 364/364、跟读 308/308，100% 覆盖。
- 上线前接口验证：`jest` 全 319 个测试通过 + 逐题型渲染字段核对（阅读读 `correct_answer`、听力读 `answer`、interview 嵌套 `questions[].question`）+ id 覆盖 100% + 预检 0 非法（含 App 运行时检查）。
- 新增 `components/home/BankUpdateModal.js`：登录后首次进首页自动弹出，告知题库已全部更新（localStorage 标记，只弹一次）。

## 2026-05-22

- 修复阅读模考记录无法查看的问题：根因是 `842cd85` 合并冲突把 `f531a90` 的会话保存格式回退了。`AdaptiveExamShell` 用 `type: "adaptive-reading"`（无 `details` 字段）写入历史，而 `ReadingProgressView` 入口卡片只筛 `type: "reading"`，记录虽在但首页显示「暂无记录」。同时修了 `ReadingSectionContent` 的 `readingCount` 漏统计 legacy 类型。
- 新增模考完整诊断视图，替换原 band/M1/M2 简版摘要：
  - `AdaptiveExamShell` 现在保存每个 task 的快照（itemId、原文、题目、用户作答、正误），单次模考 ~30KB；CTW 还额外捕获用户输入的字符以支持错题对照。
  - 新组件 `components/reading/MockSessionDetail.js`（~900 行）+ `useReadingAiExplain.js` 复用 `useBsAiExplain` 模式，提供 Pro-gated AI 题目解析（localStorage 缓存，键 = `qid|selected|correct`，相同错误跨用户共享解释）。
  - `SessionRow` 0/0 兜底：mock 子类型走 `m1.correct + m2.correct` 汇总，top-level `correct/total` 缺失时也能正确显示。
- 双栏布局重构（仿写作 ProgressView）：模考记录挪到左侧 320px sticky sidebar，点击在右侧主区切换到详情面板，不再就地展开撑爆列表。stats 卡片去掉 mock tab，趋势图改为只画 practice 避免段位/百分比混轴。`<960px` 自动切单列堆叠。`entries` 用 cloud-id-or-array-index 一次性构建，让 `normalizeReadingSession` 的对象引用变化不破坏删除/选中追踪。
- 详情面板对齐写作 `FullMockReport` 设计：header 含返回按钮、`阅读详细诊断报告` 标题、日期、CEFR/换算分/路径 chip pill、右上角 34px `OVERALL BAND` 大字号（按段位上色）、小图标删除按钮；主 tab 按 task type 切换（概览·总体 / CTW / RDL / AP），动画用 `slideInRight 0.5s` + `tabFade 0.3s` 都走 `cubic-bezier(0.16,1,0.3,1)`。固定 viewport 高度 `100vh - 110px`，header + tab bar pin，内部 content 滚动。
- 阅读做题页主按钮颜色对齐 section 蓝色 accent：shared `<Btn>` 默认背景是 `C.blue`（实际是绿色 `#0d9668`，命名遗留），CTWTask 的「提交答案」「重新作答」、RDLTask 的「提交全部」「下一题（未提交态）」都内联 override 成 `#3B82F6`。ReadingProgressView 侧栏 h1→p 的 margin 简写归一，避免 `margin: 0` 覆盖 `marginTop: 4`。

## 2026-05-20

- 修复阅读 RDL（Read in Daily Life）短版 / 长版切换无效的问题：之前不管选「短版 · 2 题」还是「长版 · 3 题」，进入练习后都拿到 3 道题。
- 根因是过去一次合并把 `app/reading/page.js` 的题库 import 改回了旧的单文件 `rdl.json`（仅 8 题，全 3 题），但 `?variant=short|long` 的 URL 路由 + UI 切换 + `handleNewItem` 的引用都没跟着回退；其中 `RDL_SHORT_DATA` / `RDL_LONG_DATA` 在「新题」按钮上还会触发 ReferenceError。
- 重新引入 `rdl-short.json`（83 题 ×2Q）和 `rdl-long.json`（89 题 ×3Q）双文件，提取 `rdlPool(variant)` helper，让随机抽题、id 查找、练习模式选题器、「新题」按钮 4 处都按 variant 走对应题库；useEffect 依赖加入 `variant`，切换时立刻重新随机。

## 2026-05-19

- 修复阅读完形填空（CTW）错题本中"你的答案"显示错误，现在正确展示用户输入的字母。
- 修复阅读/听力自适应模考各模块独立计时，进入 Module 2 时倒计时正确重置。
- 修复听力模考练习记录未保存的问题，听力/阅读模考结果现在会写入练习历史。
- 修复阅读模考题目分配蓝图，与 TOEFL 2026 规格对齐。
- 新增听力题目作答倒计时（每题限时），与真实考试节奏一致。
- 练习历史新增模式标签（练习模式 / 挑战模式），记录更细分。
- 错题本扩展至阅读和听力部分，含分类标签。

## 2026-05-15

- Fixed a speaking-module microphone permission mismatch seen in real use:
  - Allowed same-origin microphone access in `Permissions-Policy` so the speaking pages can use `getUserMedia` after the browser grants permission.
  - Updated Repeat and Interview tasks so SpeechRecognition failures are shown as transcription/scoring availability issues instead of misleading users into reopening microphone permissions after recording has already started.
  - Verified the production build with `npm.cmd run build`.

## 2026-05-13

- Fixed a batch of known issues surfaced by lint + test gates:
  - E2E suite was unrunnable due to a `**/` sequence inside a block comment in `e2e/smoke.spec.js` closing the comment early. Fixed the example so Playwright can load the file again.
  - Resolved 22 `react-hooks/rules-of-hooks` violations across `useBsAiExplain.js`, `LCRTask.js`, `ScoringReport.js`, and `AdaptiveExamShell.js` — Hooks are no longer called after early returns.
  - Removed `eslint.ignoreDuringBuilds` from `next.config.js` so Hook errors and other lint failures now block production builds.
  - Rebalanced 13 failing Build Sentence sets (28, 29, 31, 35, 36, 37, 41, 43, 45, 47, 51, 53, 55) so `npm run validate:bank` passes.
  - Excluded `.claude/` and `.agents/` from `jest.config.js` ignore patterns to stop duplicate test runs from worktree copies.
  - Corrected Task 1 / Task 3 ordering in the JSON-LD `featureList` (`app/layout.js`) so structured data matches the README and homepage (Task 1 = Build a Sentence, Task 3 = Academic Discussion).

## 2026-02-19

- Added unified admin hub page:
  - New route: `/admin`
  - Central entry for admin dashboards.
- Added access-code administration system (private beta control):
  - Admin page: `/admin-codes`
  - Server APIs: `app/api/admin/codes/route.js`, `app/api/auth/verify-code/route.js`
  - Supports generate / issue / revoke flows with server-side token auth.
- Added legacy-code compatibility:
  - Existing codes in `users` can be auto-activated into `access_codes` on first login.
- Added API failure feedback dashboard:
  - New page: `/admin-api-errors`
  - New API: `app/api/admin/api-errors/route.js`
  - `/api/ai` failures are persisted for troubleshooting.
- Added SQL schema updates for ops:
  - `access_codes` table and RLS policy.
  - `api_error_feedback` table and indexes for failure diagnostics.
- Localized admin UI to Chinese and improved admin UX:
  - Clearer button feedback and error prompts.
  - Added links between admin pages and return-to-hub navigation.
- Fixed Build Sentence duplicate-content issue in one session:
  - Enforced set-level uniqueness check in `lib/questionSelector.js`.

## 2026-02-15

- Fixed Build Sentence slot-count mismatch bug by enforcing runtime invariants:
  - `slotCount = answerOrder.length`
  - `bank.length === answerOrder.length`
  - `answerOrder` must be a permutation of `bank`
  - `givenSlots[].givenIndex` range validation
- Added question normalization/validation in runtime session init to prevent broken UI states.
- Refactored Build Sentence architecture:
  - extracted `useBuildSentenceSession` (state machine)
  - kept `BuildSentenceTask` focused on rendering
  - introduced shared sentence engine `lib/questionBank/sentenceEngine.js`
- Unified render/scoring behavior by routing both through shared sentence assembly logic.
- Added regression coverage:
  - init invariant test (`__tests__/build-sentence-init.invariant.test.js`)
  - 20-question flow guard in component tests
  - input normalization coverage in save-bank tests
- Updated `README.md` with runtime invariant notes.
