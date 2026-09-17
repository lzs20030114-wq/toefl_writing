/**
 * 听力题号重建（纯函数，无 IO，可单测）—— 真题专区补题「第 3 层」。
 *
 * ── 病 ────────────────────────────────────────────────────────────────────
 * 听力盲审「两票同字母却与答案页不同」的题里，78% 不是答案页错、也不是转写丢内容，
 * 而是**结构化产物里的 `q_number` 错位**：
 *   · 同一屏被 OCR 出两遍 → 题干逐字重复 + 后面整体后移；
 *   · 掉题 → 局部换位；
 *   · 空题 / 选项残缺（只 OCR 出 2~3 个选项）也会把后面的号顶歪。
 * 于是**对的答案字母被盖到了错位的题干上**，两个独立模型一起「和答案页作对」。
 *
 * ── 判据：屏幕顺序 ────────────────────────────────────────────────────────
 * `<卷>.json` 的 `blocks[]` 是 OCR 原文按**题号页眉**（"Listening Question 21 of 32"，
 * ingest_common.find_anchors）切出来的，`start` 就是**卷面印着的真实题号**，可信。
 * 但题面 PDF 常把两三屏截图拼在一页上，OCR 会先把这一页的**几个页眉一起读出来**、
 * 正文才跟在后面。结果是：前几个题号的 block 正文为空，最后一个 block 的正文里
 * 挤着这一整页的**几屏**内容，顺序与题号顺序一致。所以：
 *
 *   一段「连续 k-1 个空 block + 1 个有正文 block」= 一页 k 屏；
 *   正文按屏切开（每屏以 "00:00:14 Hide Time" 计时器开头），第 i 屏就是这段的第 i 个题号。
 *   屏数 ≠ 题号数 → 这段整段 fail-closed（不重排，不猜）。
 *
 * 每道 structured 题（题干 + 4 个选项）去这些屏里找自己**唯一**落在哪一屏，
 * 那一屏的题号就是它的真题号；再按真题号从 `alignment.listening.modules[].matched`
 * **重新取答案字母**盖章。
 *
 * ── 硬护栏（任一不过就不动那道题，宁可不收）────────────────────────────
 *   G1 `options.length === 4`         残缺选项的字母位不可信，整题不动
 *   G2 相似度 ≥ MIN_SCORE 且领先第二名 ≥ MIN_MARGIN，且**互为最佳**（唯一匹配）
 *   G3 新题号必须落在**本题组自己的题号带**内（= 仍挂同一段材料、组 id 不变）
 *   G4 同一个真题号被两道题认领 → 两道都不动
 *   G5 `stem_mismatch` / `stem_duplicate` 命中的题不动（merge_recording_asr 已剔）
 *   G6 新题号在答案页里没有答案 → 不动
 *
 * ── 盲审票只做交叉验证，不做判据 ──────────────────────────────────────
 * 既有明细里「两票同字母 P」的题，重排后的新字母**应当**等于 P。不等于不许反过来
 * 按 P 改号 —— 那是拿一个 25% 随机命中的信号去覆盖屏幕原文。只记一条 crossCheck
 * 供人看，该题按常规盲审闸扣下。
 *
 * ── 为什么 LCR 一律不重排 ────────────────────────────────────────────────
 * lcr 每道题自成一组，组 id（`real_lcr_316_1_05`）就是题号本身；重排 lcr 等于改在线
 * 题目 id，还会连带动它与音频岛的配对。G3 因此天然把 lcr 全挡在外面（组带 = 单个题号），
 * 这是有意的 fail-closed，不是漏洞。
 */

/** 每屏开头的计时器："00:00:14 Hide Time" / "00:00:14 HideTime" / "…Hide Tim"。 */
const TIMER_RE = /\d{1,2}:\d{2}:\d{2}\s*Hide\s*Tim(?:e)?/gi;

/** 归一：只留小写字母数字。OCR 常把空格吃掉（"Choosethebest response"），空白不能参与比对。 */
function normText(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** n-gram 命中率：needle 的每个 N 连字是否出现在 hay 里。对 OCR 错字（achieve→adayeve）不敏感。 */
const GRAM = 5;
function gramScore(needle, hay) {
  if (!needle) return 0;
  if (needle.length <= GRAM) return hay.includes(needle) ? 1 : 0;
  let hit = 0;
  let total = 0;
  for (let i = 0; i + GRAM <= needle.length; i += 1) {
    total += 1;
    if (hay.includes(needle.slice(i, i + GRAM))) hit += 1;
  }
  return total ? hit / total : 0;
}

/** 一屏正文里题干与选项的权重。选项更重：同一段讲座的多道题题干可以完全一样（"What is the main topic of the talk?"）。 */
const STEM_WEIGHT = 0.4;
const OPTION_WEIGHT = 0.6;

/** 题 → 某一屏的相似度（0~1）。 */
function itemScreenScore(item, screenNorm) {
  const stem = normText(item && item.stem);
  const opts = (Array.isArray(item && item.options) ? item.options : []).map(normText).filter(Boolean);
  const stemPart = gramScore(stem, screenNorm);
  const optPart = opts.length ? opts.reduce((a, o) => a + gramScore(o, screenNorm), 0) / opts.length : 0;
  if (!opts.length) return STEM_WEIGHT * stemPart;
  return STEM_WEIGHT * stemPart + OPTION_WEIGHT * optPart;
}

/**
 * 把一个 block 的正文切成「屏」。
 *
 * 计时器开头的每一段各算一屏；计时器**之前**的那截（head）通常是上一屏的残尾或
 * "Listening / Listen to a conversation." 这种横幅碎片，只有长到像一整道题
 * （归一后 ≥ HEAD_MIN_CHARS）才算一屏 —— 实测有屏的计时器整个没 OCR 出来
 * （3.16 M2 Q2），一律不算就会把整段判成屏数不够而白白 fail-closed。
 */
const HEAD_MIN_CHARS = 80;
function splitScreens(body) {
  const text = String(body == null ? "" : body);
  const marks = [];
  TIMER_RE.lastIndex = 0;
  let m = TIMER_RE.exec(text);
  while (m) {
    marks.push(m.index);
    m = TIMER_RE.exec(text);
  }
  const out = [];
  if (!marks.length) {
    if (normText(text).length >= HEAD_MIN_CHARS) out.push(text);
    return out;
  }
  const head = text.slice(0, marks[0]);
  if (normText(head).length >= HEAD_MIN_CHARS) out.push(head);
  for (let i = 0; i < marks.length; i += 1) {
    out.push(text.slice(marks[i], i + 1 < marks.length ? marks[i + 1] : text.length));
  }
  return out;
}

/**
 * 听力 blocks（同一份 `<卷>.json` 里 section=listening 的那些，按文档顺序）→ 按 module 分组。
 * module 的界线 = `total` 变化（M1 of-32、M2 of-15）。真题听力只有这两个 module。
 */
function blocksByModule(blocks) {
  const out = new Map();
  let prevTotal = null;
  let mod = 0;
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || b.section !== "listening") continue;
    if (b.total !== prevTotal) { mod += 1; prevTotal = b.total; }
    if (!out.has(mod)) out.set(mod, []);
    out.get(mod).push(b);
  }
  return out;
}

/**
 * 一个 module 的 blocks → 屏幕表 { screens: Map<题号, 归一正文>, runs: [...] }。
 * 屏数与题号数对不上的段落整段丢弃（fail-closed），并在 runs 里留痕。
 */
function buildScreenMap(moduleBlocks) {
  const screens = new Map();
  const runs = [];
  let pending = [];
  for (const b of moduleBlocks || []) {
    const parts = splitScreens(b.body);
    if (!parts.length) { pending.push(b.start); continue; }
    const nums = pending.concat([b.start]);
    pending = [];
    if (parts.length !== nums.length) {
      runs.push({ nums, screens: parts.length, ok: false, why: `屏数 ${parts.length} ≠ 题号数 ${nums.length}` });
      continue;
    }
    nums.forEach((n, i) => { screens.set(n, normText(parts[i])); });
    runs.push({ nums, screens: parts.length, ok: true });
  }
  if (pending.length) runs.push({ nums: pending, screens: 0, ok: false, why: "整段没有可用正文" });
  return { screens, runs };
}

/**
 * **同一题组内**题干逐字相同的重复题去重（同一屏被 OCR 出两遍的产物）。
 *
 * 范围只到组内：两段讲座都问 "What is the main topic of the talk?" 是正常的，跨组不算重复
 * （与 merge_recording_asr.py 的 stem_duplicate 同一口径）。判据只看题干不看选项 ——
 * 重复的两份里常有一份选项被 OCR 砍掉（只剩 2~3 个），带上选项当键就认不出是同一屏。
 * 保留哪一份要有依据：优先 4 个选项齐全的那份；仍并列时保留题号小的（屏幕原序在前）。
 * 返回 { kept: Item[], dropped: [{item, keptQ}] }。
 */
function dedupeItems(items) {
  const groups = new Map();
  for (const it of items) {
    const stem = normText(it.item.stem);
    if (!stem) continue; // 空题不参与去重
    const key = `${it.group && it.group.key}|${stem}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const dropped = [];
  const drop = new Set();
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    const sorted = bucket.slice().sort((a, b) => {
      const oa = (a.item.options || []).length === 4 ? 0 : 1;
      const ob = (b.item.options || []).length === 4 ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return (a.item.q_number || 0) - (b.item.q_number || 0);
    });
    for (const x of sorted.slice(1)) {
      drop.add(x);
      dropped.push({ ...x, keptQ: sorted[0].item.q_number, reason: "stem_duplicate" });
    }
  }
  return { kept: items.filter((x) => !drop.has(x)), dropped };
}

const MIN_SCORE = 0.80;
const MIN_MARGIN = 0.15;
const LETTERS = "abcdefgh";

/**
 * 题组的 problems 里被 merge **判掉**的题号集合。
 *
 * 只取真正被判掉的那一个，不能把整条 problem 里出现的题号全抓走：
 *   `stem_duplicate:Q13/Q14 同组题干逐字相同（剔 Q14）` —— 判掉的是括号里的 Q14，Q13 是**留下**的那份；
 *   `stem_mismatch:Q6 题干关键词「…」不在本组材料里、在 M2 Q8 那组里` —— 判掉的是 Q6，Q8 是另一组的起始题号。
 * 全抓会把留下的好题也挡在重排之外（实测 3.16 / 4.6 共 6 题被误挡）。
 */
function flaggedQs(problems) {
  const out = new Set();
  for (const p of Array.isArray(problems) ? problems : []) {
    const s = String(p);
    if (/^stem_duplicate/.test(s)) {
      const m = s.match(/剔\s*Q(\d+)/);
      if (m) out.add(Number(m[1]));
      continue;
    }
    if (/^stem_mismatch/.test(s)) {
      const m = s.match(/^stem_mismatch:\s*Q(\d+)/);
      if (m) out.add(Number(m[1]));
    }
  }
  return out;
}

/**
 * 规划一个 module 的重排。
 *
 * @param {Array} groups  该 module 的 structured 听力记录（{key,type,q_start,q_end,items,problems}）
 * @param {Map}   screens buildScreenMap 的 screens
 * @param {Object} answers 真题号 → 答案字母（alignment.listening.modules[].matched）
 * @returns {{moves, keeps, blocked, removed}}
 */
function planModule({ module, groups, screens, answers }) {
  const all = [];
  for (const g of groups) {
    const flagged = flaggedQs(g.problems);
    for (const it of g.items || []) all.push({ group: g, item: it, flagged: flagged.has(it.q_number) });
  }
  const { kept, dropped } = dedupeItems(all);
  const blocked = dropped.map((d) => ({
    module, groupKey: d.group.key, q: d.item.q_number, reason: "stem_duplicate",
    detail: `与 Q${d.keptQ} 题干+选项逐字相同`,
  }));

  // 可参与定位的题：4 个选项齐全 + 没被 stem_mismatch 命中
  const candidates = [];
  for (const x of kept) {
    if (x.flagged) {
      blocked.push({ module, groupKey: x.group.key, q: x.item.q_number, reason: "stem_flagged", detail: "merge 判过 stem_mismatch/stem_duplicate" });
      continue;
    }
    if (!Array.isArray(x.item.options) || x.item.options.length !== 4) {
      blocked.push({ module, groupKey: x.group.key, q: x.item.q_number, reason: "options_not_4", detail: `选项 ${(x.item.options || []).length} 个` });
      continue;
    }
    candidates.push(x);
  }

  const screenList = [...screens.entries()];
  // 打分矩阵
  const scored = candidates.map((x) => {
    const row = screenList
      .map(([n, txt]) => ({ n, s: itemScreenScore(x.item, txt) }))
      .sort((a, b) => b.s - a.s);
    return { x, best: row[0] || { n: null, s: 0 }, second: row[1] || { n: null, s: 0 } };
  });

  // 互为最佳：一屏的最佳题必须就是这道题
  const bestItemOfScreen = new Map();
  for (const r of scored) {
    if (r.best.n == null) continue;
    const cur = bestItemOfScreen.get(r.best.n);
    if (!cur || r.best.s > cur.best.s) bestItemOfScreen.set(r.best.n, r);
  }

  const resolved = [];
  for (const r of scored) {
    const { x, best, second } = r;
    const at = { module, groupKey: x.group.key, q: x.item.q_number };
    if (best.n == null || best.s < MIN_SCORE) {
      blocked.push({ ...at, reason: "no_match", detail: `最佳相似度 ${best.s.toFixed(3)} < ${MIN_SCORE}` });
      continue;
    }
    if (best.s - second.s < MIN_MARGIN) {
      blocked.push({ ...at, reason: "ambiguous", detail: `Q${best.n} ${best.s.toFixed(3)} vs Q${second.n} ${second.s.toFixed(3)}` });
      continue;
    }
    if (bestItemOfScreen.get(best.n) !== r) {
      blocked.push({ ...at, reason: "screen_contested", detail: `屏 Q${best.n} 被 Q${bestItemOfScreen.get(best.n).x.item.q_number} 认领得更好` });
      continue;
    }
    const lo = Number(x.group.q_start);
    const hi = Number(x.group.q_end);
    if (!(best.n >= lo && best.n <= hi)) {
      blocked.push({ ...at, reason: "out_of_group_band", detail: `真题号 Q${best.n} 不在本组 ${lo}-${hi}（会挂错材料 / 改组 id）` });
      continue;
    }
    const letter = answers && answers[best.n];
    if (!letter || LETTERS.indexOf(String(letter).toLowerCase()) < 0) {
      blocked.push({ ...at, reason: "no_answer", detail: `答案页没有 Q${best.n} 的答案` });
      continue;
    }
    resolved.push({ ...r, toQ: best.n, letter: String(letter).toLowerCase() });
  }

  // G4：同一个真题号被两道题认领 → 两道都不动
  const byTarget = new Map();
  for (const r of resolved) {
    if (!byTarget.has(r.toQ)) byTarget.set(r.toQ, []);
    byTarget.get(r.toQ).push(r);
  }
  const final = [];
  for (const [toQ, rows] of byTarget) {
    if (rows.length > 1) {
      for (const r of rows) {
        blocked.push({
          module, groupKey: r.x.group.key, q: r.x.item.q_number, reason: "target_contested",
          detail: `真题号 Q${toQ} 被 ${rows.map((z) => `Q${z.x.item.q_number}`).join("/")} 同时认领`,
        });
      }
      continue;
    }
    final.push(rows[0]);
  }

  const moves = [];
  const keeps = [];
  for (const r of final) {
    const fromLetter = LETTERS[r.x.item.answer_index] || String(r.x.item.answer_key || "").toLowerCase();
    const rec = {
      module,
      groupKey: r.x.group.key,
      type: r.x.group.type,
      fromQ: r.x.item.q_number,
      toQ: r.toQ,
      fromLetter,
      toLetter: r.letter,
      score: r.best.s,
      margin: r.best.s - r.second.s,
      stem: String(r.x.item.stem || "").replace(/\s+/g, " ").slice(0, 90),
      item: r.x.item,
      group: r.x.group,
    };
    if (rec.fromQ === rec.toQ && rec.fromLetter === rec.toLetter) keeps.push(rec);
    else moves.push(rec);
  }

  // 被重排「腾挪」占掉号的空题/残题：留在原地会与新号撞车。只清理**定位不了**的那些
  // （选项不全 = build_bank 本来就要丢的 lDroppedBadOptions）；若撞车的是一道 4 选项好题，
  // 反过来把那次重排也撤掉（fail-closed）。
  const takenNew = new Map(moves.map((m) => [m.toQ, m]));
  const movedFrom = new Set(moves.map((m) => m.fromQ));
  const removed = [];
  const cancel = new Set();
  for (const x of kept) {
    const q = x.item.q_number;
    if (!takenNew.has(q)) continue;
    if (movedFrom.has(q) && takenNew.get(q).fromQ !== q) continue; // 它自己也搬走了
    if (moves.some((m) => m.item === x.item)) continue;
    if (Array.isArray(x.item.options) && x.item.options.length === 4) {
      cancel.add(takenNew.get(q));
      blocked.push({
        module, groupKey: takenNew.get(q).groupKey, q: takenNew.get(q).fromQ, reason: "target_occupied",
        detail: `真题号 Q${q} 上还坐着一道选项齐全的题（Q${q}），不动`,
      });
      continue;
    }
    removed.push({ module, groupKey: x.group.key, q, reason: "phantom_collision", detail: `空题/残题占着 Q${q}，已被重排后的题占用`, item: x.item, group: x.group });
  }

  return {
    moves: moves.filter((m) => !cancel.has(m)),
    keeps,
    blocked,
    removed: removed.filter((r) => moves.some((m) => !cancel.has(m) && m.toQ === r.q)),
  };
}

/**
 * 全卷规划。
 *
 * @param {Object} scan        `<卷>.json`（要 blocks + alignment.listening）
 * @param {Object} structured  `<卷>.structured.json`
 * @param {Object} [auditIndex] 既有盲审明细的索引 `{'module#q': {model, second}}`，只用于交叉验证
 */
function planSet({ scan, structured, auditIndex }) {
  const byMod = blocksByModule((scan && scan.blocks) || []);
  const answers = {};
  for (const m of ((scan && scan.alignment && scan.alignment.listening && scan.alignment.listening.modules) || [])) {
    answers[m.module] = {};
    for (const x of m.matched || []) answers[m.module][x.n] = x.answer;
  }
  const out = { moves: [], keeps: [], blocked: [], removed: [], runs: [], crossCheck: [] };
  const mods = new Set([...byMod.keys()]);
  for (const r of (structured && structured.results) || []) {
    if (r.section === "listening") mods.add(Number(r.module));
  }
  for (const module of [...mods].sort((a, b) => a - b)) {
    const groups = ((structured && structured.results) || [])
      .filter((r) => r.section === "listening" && Number(r.module) === module && r.status === "ok");
    const { screens, runs } = buildScreenMap(byMod.get(module) || []);
    out.runs.push(...runs.map((x) => ({ module, ...x })));
    if (!screens.size) {
      for (const g of groups) {
        for (const it of g.items || []) {
          out.blocked.push({ module, groupKey: g.key, q: it.q_number, reason: "no_screens", detail: "该 module 没有可用的屏幕表" });
        }
      }
      continue;
    }
    const p = planModule({ module, groups, screens, answers: answers[module] || {} });
    out.moves.push(...p.moves);
    out.keeps.push(...p.keeps);
    out.blocked.push(...p.blocked);
    out.removed.push(...p.removed);
  }
  // 交叉验证：既有盲审票（第一票 / 第二票同字母）与重排后的新字母比。只报告，不改判。
  for (const m of out.moves) {
    const e = auditIndex && auditIndex[`${m.module}#${m.fromQ}`];
    if (!e || !e.model) continue;
    const votes = [e.model, e.second].filter(Boolean).map((v) => String(v).toLowerCase());
    const unanimous = votes.length >= 2 && votes[0] === votes[1];
    m.votes = votes;
    m.voteAgrees = votes[0] === m.toLetter;
    out.crossCheck.push({
      module: m.module, fromQ: m.fromQ, toQ: m.toQ, toLetter: m.toLetter,
      votes, unanimous, ok: votes[0] === m.toLetter,
    });
  }
  return out;
}

/**
 * 计划签名 —— 同一份产物被重复重排时，用来判断「这次的计划与上次逐字相同」。
 *
 * 为什么需要：`--write` 会**作废**被动过的题的盲审明细（旧号、新号两边都删），好让紧随其后的
 * `audit_answers --only-missing` 重审。但重跑合流会把 structured 打回旧题号，于是同一份计划要再落一次 ——
 * 这时盲审明细已经是按**新题号**记的、而且是重排之后审出来的，再删一遍就是把刚审完的结果扔掉。
 * 签名相同 ⇒ 明细与本次计划同源，保留（见 listening_renumber_run.mjs 的 stampPath）。
 *
 * 只取会写进 structured 的那部分（题号迁移 + 新答案字母 + 清掉的空题）。相似度分数不进签名：
 * 它是浮点、随 OCR 文本一一对应，纳进来只会让签名无谓地抖动。
 */
function planSignature(plan) {
  const moves = ((plan && plan.moves) || []).map((m) => `${m.module}#${m.fromQ}>${m.toQ}:${m.toLetter}`).sort();
  const removed = ((plan && plan.removed) || []).map((r) => `${r.module}#${r.q}-`).sort();
  return [...moves, ...removed].join("|");
}

/** 把规划应用到 structured 数据（就地改传入对象）。返回改了几处。 */
function applyPlan(structured, plan) {
  let renumbered = 0;
  let removed = 0;
  for (const m of plan.moves) {
    const it = m.item;
    if (it.q_renumbered_from == null && it.q_number !== m.toQ) it.q_renumbered_from = it.q_number;
    if (it.answer_restamped_from == null && m.fromLetter !== m.toLetter) it.answer_restamped_from = m.fromLetter;
    it.q_number = m.toQ;
    it.answer_key = m.toLetter;
    it.answer_index = LETTERS.indexOf(m.toLetter);
    renumbered += 1;
    const tag = `listening_renumber:Q${m.fromQ}→Q${m.toQ}`
      + (m.fromLetter !== m.toLetter ? `，答案 ${m.fromLetter.toUpperCase()}→${m.toLetter.toUpperCase()}` : "，答案不变")
      + `（屏幕相似度 ${m.score.toFixed(3)}）`;
    m.group.problems = Array.isArray(m.group.problems) ? m.group.problems : [];
    if (!m.group.problems.includes(tag)) m.group.problems.push(tag);
  }
  for (const r of plan.removed) {
    const g = r.group;
    const i = (g.items || []).indexOf(r.item);
    if (i >= 0) {
      g.items.splice(i, 1);
      removed += 1;
      g.problems = Array.isArray(g.problems) ? g.problems : [];
      g.problems.push(`listening_renumber_dropped:Q${r.q} 空题/残题与重排后的题号撞车`);
    }
  }
  // 组内按题号排好，免得后续按顺序读的地方看到乱序
  for (const g of (structured.results || [])) {
    if (g.section !== "listening" || !Array.isArray(g.items)) continue;
    g.items.sort((a, b) => (a.q_number || 0) - (b.q_number || 0));
  }
  return { renumbered, removed };
}

module.exports = {
  TIMER_RE, normText, gramScore, splitScreens, blocksByModule, buildScreenMap,
  dedupeItems, itemScreenScore, planModule, planSet, applyPlan, planSignature,
  MIN_SCORE, MIN_MARGIN, HEAD_MIN_CHARS, GRAM,
};
