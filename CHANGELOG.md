# Changelog

## 2026-02-15

- Fixed Build Sentence slot-count mismatch bug by enforcing runtime invariants:
  - `slotCount = answerOrder.length`
  - `bank.length === answerOrder.length`
  - `answerOrder` must be a permutation of `bank`
  - `givenIndex` range validation for legacy items
- Added question normalization/validation in runtime session init to prevent broken UI states.
- Refactored Build Sentence architecture:
  - extracted `useBuildSentenceSession` (state machine)
  - kept `BuildSentenceTask` focused on rendering
  - introduced shared sentence engine `lib/questionBank/sentenceEngine.js`
- Unified render/scoring behavior by routing both through shared sentence assembly logic.
- Added regression coverage:
  - init invariant test (`__tests__/build-sentence-init.invariant.test.js`)
  - 20-question flow guard in component tests
  - legacy-input normalization/warning coverage in save-bank tests
- Updated `README.md` with runtime invariant and legacy compatibility notes.

