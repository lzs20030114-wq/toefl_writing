/**
 * 真题自动录入 —— 复核决定的读写（经 GitHub Contents API 直接改 main）。
 *
 * 为什么不写数据库：这两份清单是**出题管线的输入**，Worker 在 Actions 上跑时读的是
 * 仓库里的文件（hold_policy / apply_review）。放数据库就得让 Worker 再去查库，
 * 且 git 历史里看不见「谁在什么时候放行了哪一科」。所以决定 = 一次 commit。
 */
const { getRepoFile, putRepoFile } = require("../githubApi");

const OVERRIDES_PATH = "data/realBank/review-overrides.json";
const HOLDS_PATH = "data/realBank/review-holds.json";

// apply_review.mjs 的 FILES 白名单，必须一致，否则它会抛「未知 file」。
const HOLD_FILES = [
  "reading/ctw", "reading/rdl", "reading/ap",
  "listening/lcr", "listening/lc", "listening/la", "listening/lat",
  "speaking/repeat", "speaking/interview",
  "writing/bs", "writing/email", "writing/discussion",
];
const HOLD_SCOPES = ["unit", "question", "sentence", "iq"];
const SECTIONS = ["reading", "listening", "speaking", "writing"];

const OVERRIDES_SEED = {
  _purpose:
    '后台复核放行清单。allow[] 里的 (set,section,code) 让 hold_policy 对该科该 blocking code 视为放行；删条目 = 恢复扣下。code:"*" 表示该科全部 blocking code 放行。',
  _writer: "app/api/admin/real-bank-ingest/review/decision（后台「放行整科」按钮，经 GitHub Contents API 提交 main）",
  allow: [],
};

async function readOverrides() {
  const f = await getRepoFile(OVERRIDES_PATH);
  if (!f) return { content: { ...OVERRIDES_SEED }, sha: null };
  const content = f.content || {};
  if (!Array.isArray(content.allow)) content.allow = [];
  return { content, sha: f.sha };
}

async function readRepoHolds() {
  const f = await getRepoFile(HOLDS_PATH);
  if (!f) return { content: { holds: [] }, sha: null };
  const content = f.content || {};
  if (!Array.isArray(content.holds)) content.holds = [];
  return { content, sha: f.sha };
}

/** allow[] 命中判定：code:"*" 覆盖该科全部 blocking code。 */
function isAllowed(allow, set, section, code) {
  return (allow || []).some(
    (a) => a && a.set === set && a.section === section && (a.code === "*" || a.code === code)
  );
}

function clip(v, n) {
  return String(v == null ? "" : v).trim().slice(0, n);
}

/** 校验 + 归一「放行整科」入参。 */
function normalizeAllowSection(body) {
  const set = clip(body.set_key || body.set, 120);
  const section = clip(body.section, 20);
  const code = clip(body.code, 60) || "*";
  const reason = clip(body.reason, 300);
  if (!set) return { ok: false, error: "缺少 set_key" };
  if (!SECTIONS.includes(section)) return { ok: false, error: `未知的科目：${section || "(空)"}` };
  if (!reason) return { ok: false, error: "请填放行理由（会写进 git 历史）" };
  return { ok: true, value: { set, section, code, reason, by: "admin", at: new Date().toISOString() } };
}

/** 校验 + 归一「下架单题」入参（形状必须和 review-holds.json 现有条目一致）。 */
function normalizeHoldUnit(body) {
  const file = clip(body.file, 60);
  const id = clip(body.id, 120);
  const scope = clip(body.scope, 20) || "unit";
  const reason = clip(body.reason, 500);
  if (!HOLD_FILES.includes(file)) return { ok: false, error: `未知的题库文件：${file || "(空)"}` };
  if (!id) return { ok: false, error: "缺少题目 id" };
  if (!HOLD_SCOPES.includes(scope)) return { ok: false, error: `未知的 scope：${scope}` };
  if (!reason) return { ok: false, error: "请填下架理由（会写进 git 历史）" };

  const entry = { file, id, scope, reason };
  if (scope === "question") {
    const q = Number(body.q);
    if (!Number.isInteger(q) || q < 0) return { ok: false, error: "question 级下架必须给题目下标 q（从 0 起）" };
    const stem = clip(body.stem, 200);
    if (!stem) return { ok: false, error: "question 级下架必须给 stem 前缀（防下标漂移误扣别的题）" };
    entry.q = q;
    entry.stem = stem;
  } else if (scope === "sentence") {
    const sid = clip(body.sid, 120);
    if (!sid) return { ok: false, error: "sentence 级下架必须给句子 id（sid）" };
    entry.sid = sid;
  } else if (scope === "iq") {
    const qid = clip(body.qid, 120);
    if (!qid) return { ok: false, error: "iq 级下架必须给面试题 id（qid）" };
    entry.qid = qid;
  }
  return { ok: true, value: entry };
}

/** 幂等：同一条 allow 重复提交不追加第二份（只更新理由/时间）。 */
function upsertAllow(list, entry) {
  const i = list.findIndex((a) => a && a.set === entry.set && a.section === entry.section && a.code === entry.code);
  if (i >= 0) {
    list[i] = { ...list[i], ...entry };
    return { added: false };
  }
  list.push(entry);
  return { added: true };
}

/** 幂等：同 (file,id,scope,+定位字段) 已在清单里就不重复追加。 */
function upsertHold(list, entry) {
  const same = (h) =>
    h && h.file === entry.file && h.id === entry.id && h.scope === entry.scope &&
    (entry.scope !== "question" || h.q === entry.q) &&
    (entry.scope !== "sentence" || h.sid === entry.sid) &&
    (entry.scope !== "iq" || h.qid === entry.qid);
  const i = list.findIndex(same);
  if (i >= 0) {
    list[i] = { ...list[i], ...entry };
    return { added: false };
  }
  list.push(entry);
  return { added: true };
}

async function commitAllowSection(entry) {
  const { content, sha } = await readOverrides();
  const r = upsertAllow(content.allow, entry);
  await putRepoFile(
    OVERRIDES_PATH,
    content,
    sha,
    `chore(realbank): review decision 放行 ${entry.set} / ${entry.section} / ${entry.code}`
  );
  return { ...r, file: OVERRIDES_PATH };
}

async function commitHoldUnit(entry) {
  const { content, sha } = await readRepoHolds();
  const r = upsertHold(content.holds, entry);
  await putRepoFile(
    HOLDS_PATH,
    content,
    sha,
    `chore(realbank): review decision 下架 ${entry.file} ${entry.id}${entry.scope === "unit" ? "" : ` (${entry.scope})`}`
  );
  return { ...r, file: HOLDS_PATH };
}

module.exports = {
  OVERRIDES_PATH,
  HOLDS_PATH,
  HOLD_FILES,
  HOLD_SCOPES,
  SECTIONS,
  readOverrides,
  readRepoHolds,
  isAllowed,
  normalizeAllowSection,
  normalizeHoldUnit,
  upsertAllow,
  upsertHold,
  commitAllowSection,
  commitHoldUnit,
};
