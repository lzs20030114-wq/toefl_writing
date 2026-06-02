// 题库代次（bank generation）与「这条历史记录用的是哪一代题库」的判定。
//
// 背景：2026-06-02 把 newBank 一次性提升为 live（全新 V2 题库），旧题（V1）退役、
// 仅留存于 data/newBank/.backup-*。用户练过的历史是完整快照、照常回看，但需要在历史
// 记录上标出「这是用旧题库（V1）练的」，并据此让「从历史重练」走快照而非去新库按 id 查
// （邮件题 V1/V2 的 id 完全撞车，按 id 查会静默匹配到内容不同的新题）。

// 当前题库代次。每次整库换新时 +1，并在下方追加对应的 EPOCH 常量。
export const BANK_EPOCH_CURRENT = 2;

// V2 题库上线时间（UTC）。取自提升提交 6d737d1 的时间（2026-06-02 11:06:01 +08:00）。
// 若实际生产部署明显晚于此，应改成真实部署时间，以免把上线后练的新题误判成 V1。
export const BANK_V2_EPOCH = Date.parse("2026-06-02T03:06:01Z");

// 判定一条历史记录是否来自旧题库（V1）。
// - 新记录带 details.bankEpoch（见 lib/sessionStore.js normalizeSession）：< 当前代次即 V1。
// - 旧记录没有戳：按练习时间是否早于 V2 上线判定。纯日期、不依赖题目 id，
//   从而规避邮件题 V1/V2 id 完全撞车的问题。
export function isV1Session(session) {
  if (!session || typeof session !== "object") return false;
  const epoch = Number(session?.details?.bankEpoch);
  if (Number.isFinite(epoch)) return epoch < BANK_EPOCH_CURRENT;
  const t = Date.parse(session?.date || "");
  if (!Number.isFinite(t)) return false;
  return t < BANK_V2_EPOCH;
}
