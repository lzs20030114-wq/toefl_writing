# Changelog

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
