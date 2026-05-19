# Changelog

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
