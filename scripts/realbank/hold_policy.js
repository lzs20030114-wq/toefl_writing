/**
 * 真题落库的「源料体检扣留」判据（纯函数，无 IO —— 供 build_bank.mjs 与单测共用）。
 *
 * 背景：data/realBank/source-flags.json 里 severity=blocking 的原意是「这一科别入库」，
 * build_bank 早期就照字面把**整科**扣下。2026-09-08 人工核对第一来源 34 套后发现
 * 两条判据过严，把大量本来干净的题一起陪葬：
 *
 *  1. `ctw_answer_truncated` —— 源答案 PDF 把**填词题(CTW)**的答案词首砍掉。
 *     它 sections 标 "reading"，于是同卷的 AP / RDL 也被整科扣下。但 AP/RDL 的答案
 *     来自选择题答案键，与填词答案页无关，且每道都单独过了盲审（模型盲解 vs 答案键）。
 *     → 改成 **只拒收该卷的 CTW 题**，AP/RDL 照常走盲审。
 *
 *  2. `section_gap`（reading，缺 ≥10 题）—— 这条 blocking 的本意是防「答案页与题面错位」。
 *     但错位有更直接的证据：盲审一致率会塌。实测同批第一来源：
 *       · 正常卷（3.2B / 3.24 / 4.20 / 4.29 / 2.8）阅读盲审 94~100%
 *       · 真错位卷（rp0718 45~53% / rp0729 45% / 5.20 54%）
 *     0.53 与 0.94 之间是一整段空档。缺口本身只说明「源里少了几题」，配对上的每一题
 *     都还是逐题过了盲审的。→ 改成**条件放行**：阅读盲审一致率 ≥ 阈值就放行并记账，
 *     低于阈值仍整科扣下。
 *
 *  3. `ingest_blocker` 里的「题号重启块」那一种（2026-09-08 追加）—— 答案页解析器在
 *     答案 PDF 里撞见一段**没有科目头**的题号重启块（"1driven 2natural…" / "1d 2b 3c…"），
 *     不敢猜它属于哪一科，于是 fail-closed 整卷标 blocking（sections 是 ["*"]，四科全扣）。
 *     但被忽略的只是那一段**多余的**答案块，已经配上的题仍逐题过了盲审：
 *       · 2.8 / 3.24 / 3.29 / 4.18 四卷阅读盲审 94~100%（3.29 是 20/20）
 *     判据与 section_gap 同源 —— 「解析器少认了东西」不等于「认下来的东西错了」，
 *     后者会把盲审一致率打塌。→ 同样**条件放行**：阅读盲审一致率 ≥ 阈值就收，低于就扣。
 *     只放宽这一种形态（detail 里出现「题号重启块」）；ingest_blocker 的其它形态照旧整科扣下。
 *
 * 其余 blocking code（section_no_stems / audit_low_agreement / answer_key_misaligned …）
 * 行为一律不变；写作 / 听力 / 口语三科的判据也一律不变
 * （放宽只在 section === "reading" 时生效 —— 4.18 那条 detail 写的是「当前科目 listening」，
 *  它的听力仍旧整科扣下，只有阅读走条件放行）。
 */

/**
 * section_gap 条件放行的盲审一致率阈值。
 *
 * 为什么是 0.85：同批第一来源的实测分布是「正常卷 88~100% / 错位卷 45~54%」，
 * 中间 0.54→0.88 是一整段空档，0.85 落在空档里，两侧各留 >0.31 / >0.03 的余量。
 * 往下放宽会开始收编真正的错位卷（那是把错题上线，比少题严重得多）；
 * 往上收紧会误伤 1.28A(75%) 之流 —— 但那类卷本来就靠逐题盲审自己丢题，不必在这里兜。
 */
const SECTION_GAP_MIN_AGREEMENT = 0.85;

/** 只在阅读科放宽的三条 code。 */
const READING_RELAXED = new Set(["ctw_answer_truncated", "section_gap", "ingest_blocker"]);

/**
 * ingest_blocker 只放宽「无科目头的题号重启块被忽略」这一种形态。
 * 其它 ingest_blocker（真的读不出源、答案页整段缺失…）仍旧整科扣下。
 */
const INGEST_BLOCKER_RELAXABLE = /题号重启块/;

/* ── 后台复核放行清单（契约 §4） ─────────────────────────────────────────────
 *
 * data/realBank/review-overrides.json 由后台「复核队列」写（A 线），这里只读。
 * 语义：allow[] 里的 (set, section, code) 命中就当这条 blocking 不存在 —— 人已经核过了，
 * 比任何自动判据都权威；把条目删掉就恢复扣留。code:"*" = 该卷该科全部 blocking 放行。
 *
 * 文件不存在 / 读不出 / 格式坏掉一律**当成空清单**（fail-safe 到「照旧扣留」那一侧）：
 * 放行清单缺失应该让题少上线，绝不能让它变成默认放行。
 */
const fs = require("fs");
const path = require("path");

const OVERRIDES_FILE = path.join("data", "realBank", "review-overrides.json");

let _cache = null;
let _cacheKey = null;

function overridesPath(root) {
  return path.join(root || process.cwd(), OVERRIDES_FILE);
}

/** 读放行清单（按路径缓存一次：build_bank 一次重建会问上千遍）。 */
function loadOverrides(root) {
  const p = overridesPath(root);
  if (_cache && _cacheKey === p) return _cache;
  let parsed = { allow: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (raw && Array.isArray(raw.allow)) parsed = { allow: raw.allow };
  } catch {
    /* 没有文件 = 没有放行项，这是常态（A 线还没写过任何决定时） */
  }
  _cache = parsed;
  _cacheKey = p;
  return parsed;
}

/** 测试与长跑进程用：丢掉缓存，下次重新读盘。 */
function clearOverridesCache() {
  _cache = null;
  _cacheKey = null;
}

/** allow[] 里有没有覆盖到 (set, section, code)。set 不给（老调用方）就一律不放行。 */
function allowSays(allow, set, section, code) {
  if (!set || !Array.isArray(allow)) return false;
  return allow.some((a) => a
    && a.set === set
    && (a.section === section || a.section === "*")
    && (a.code === code || a.code === "*"));
}

/**
 * 从 .audit.json 的 audited 明细算某一科的盲审一致率。
 * 没有明细 / 该科一题没审过 → 返回 null（= 无从判断，按「不放行」处理）。
 */
function sectionAgreement(audited, section) {
  if (!Array.isArray(audited)) return null;
  const rows = audited.filter((a) => a && a.section === section);
  if (!rows.length) return null;
  return rows.filter((a) => a.agree === true).length / rows.length;
}

/**
 * 判某卷某科是否被源料体检扣下。
 *
 * @param {Array}  flags     该卷在 source-flags.json 里的 flag 数组（原始形状，含 severity/sections/code）
 * @param {string} section   "reading" | "writing" | "listening" | "speaking"
 * @param {object} ctx       { agreement: number|null } 该科盲审一致率，只有 reading 的 section_gap 用得上
 * @returns {{held:boolean, heldBy:string[], dropCtw:boolean, notes:string[]}}
 *   held    —— 整科不收
 *   heldBy  —— 造成扣留的 code（用于日志）
 *   dropCtw —— 不整科扣留，但该卷的 CTW 题要逐题丢弃
 *   notes   —— 放行/降级的记账行，调用方打到日志里
 */
function holdDecision(flags, section, ctx = {}) {
  const agreement = ctx.agreement == null ? null : Number(ctx.agreement);
  const blocking = (flags || []).filter(
    (f) => f && f.severity === "blocking" && (f.sections || []).some((x) => x === "*" || x === section));

  // 后台复核放行清单（契约 §4）。人已经核过的 (卷, 科, code) 直接跳过，不再扣留。
  // 放在最前面：override 的语义就是「人看过了，比自动判据更权威」。
  const allow = ctx.allow !== undefined ? (ctx.allow || []) : loadOverrides().allow;
  const allowed = (code) => allowSays(allow, ctx.set, section, code);

  const heldBy = [];
  const notes = [];
  let dropCtw = false;

  for (const f of blocking) {
    if (allowed(f.code)) {
      notes.push(`${f.code}：后台复核已放行（review-overrides.json）`);
      continue;
    }
    if (section !== "reading" || !READING_RELAXED.has(f.code)) {
      heldBy.push(f.code);
      continue;
    }
    if (f.code === "ctw_answer_truncated") {
      // 降级：不整科扣，只丢 CTW。
      dropCtw = true;
      notes.push("ctw_answer_truncated：降级为只拒收本卷 CTW 题（AP/RDL 走逐题盲审）");
      continue;
    }
    if (f.code === "ingest_blocker" && !INGEST_BLOCKER_RELAXABLE.test(String(f.detail || ""))) {
      // 不是「题号重启块被忽略」那一种 —— 照旧整科扣下。
      heldBy.push(f.code);
      continue;
    }
    // section_gap / ingest_blocker(题号重启块)：一致率够高就放行
    //（真错位 / 真串科会把一致率打塌，高一致率 = 配下来的每题都对得上）
    if (agreement != null && agreement >= SECTION_GAP_MIN_AGREEMENT) {
      const what = f.code === "ingest_blocker"
        ? "ingest_blocker：被忽略的只是答案页多出来的题号重启块，配上的每题都过了盲审"
        : "section_gap：缺的题源里就没有，配上的每题都过了盲审";
      notes.push(`${what}；阅读盲审一致率 ${(agreement * 100).toFixed(0)}% ≥ `
        + `${(SECTION_GAP_MIN_AGREEMENT * 100).toFixed(0)}%，条件放行`);
      continue;
    }
    heldBy.push(f.code);
  }

  return { held: heldBy.length > 0, heldBy, dropCtw: heldBy.length ? false : dropCtw, notes };
}

module.exports = {
  SECTION_GAP_MIN_AGREEMENT,
  INGEST_BLOCKER_RELAXABLE,
  OVERRIDES_FILE,
  holdDecision,
  sectionAgreement,
  loadOverrides,
  clearOverridesCache,
  allowSays,
};
