// 后台「真题板块」统计的共用判定：一条 sessions 行是不是真题专区（/real-bank）的练习。
//
// 真题记录在 details 里的标记（见 app/real-bank/page.js 各 saveReal*Session 与 WritingTask）：
//   reading    → details.itemId 以 real_ 开头
//   listening  → details.real === true（itemIds[0] 也是 real_ 前缀）
//   speaking   → details.real === true（setId 也是 real_ 前缀）
//   discussion / email → details.promptId 以 real_ 开头（WritingTask 原样落 promptId）
//   bs         → details 是数组，每项带 qid（useBuildSentenceSession 写入），real_ 前缀即真题
// 这里只做纯函数，不碰 supabase；查询用 REAL_SESSION_SELECT 把需要的 JSON 字段投影出来，
// 避免把整段 passage / transcript 拉回来。

export const REAL_BANK_ID_PREFIX = "real_";

/** 追加到 sessions select 的投影片段（PostgREST alias:json->>path 语法）。 */
export const REAL_SESSION_SELECT = [
  "subtype:details->>subtype",
  "real:details->>real",
  "itemId:details->>itemId",
  "promptId:details->>promptId",
  "setId:details->>setId",
  "itemIds:details->itemIds",
  "bsQid:details->0->>qid",
].join(",");

function isRealId(id) {
  return typeof id === "string" && id.startsWith(REAL_BANK_ID_PREFIX);
}

/** 真题条目 id（用于「最常练的真题」排行）；不是真题返回 ""。 */
export function realItemIdOf(row) {
  if (!row) return "";
  const type = String(row.type || "");
  if (type === "reading") return isRealId(row.itemId) ? row.itemId : "";
  if (type === "listening") {
    const first = Array.isArray(row.itemIds) ? row.itemIds[0] : null;
    if (isRealId(first)) return first;
    return "";
  }
  if (type === "speaking") return isRealId(row.setId) ? row.setId : "";
  if (type === "discussion" || type === "email") return isRealId(row.promptId) ? row.promptId : "";
  if (type === "bs") return isRealId(row.bsQid) ? row.bsQid : "";
  return "";
}

/** 投影行（REAL_SESSION_SELECT 的别名字段）是否为真题练习。 */
export function isRealSessionRow(row) {
  if (!row) return false;
  const type = String(row.type || "");
  // details->>real 投影出来是字符串 "true"；直接读 details 时是布尔。
  const flag = row.real === true || row.real === "true";
  if ((type === "listening" || type === "speaking") && flag) return true;
  return realItemIdOf(row) !== "";
}

/** 从完整 details 对象（activity 路由拉的是整段 details）构造投影行，复用同一判定。 */
export function projectRealFields(row) {
  const d = row?.details;
  const obj = d && typeof d === "object" && !Array.isArray(d) ? d : {};
  const first = Array.isArray(d) ? d[0] : null;
  return {
    type: row?.type,
    real: obj.real,
    itemId: obj.itemId,
    promptId: obj.promptId,
    setId: obj.setId,
    itemIds: obj.itemIds,
    bsQid: first && typeof first === "object" ? first.qid : undefined,
  };
}

export function isRealSession(row) {
  return isRealSessionRow(projectRealFields(row));
}
