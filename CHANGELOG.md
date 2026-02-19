# Changelog

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
