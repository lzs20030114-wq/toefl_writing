/**
 * 真题阅读「条目 id 沿用」（纯函数，无 IO —— 供 build_bank.mjs 与单测共用）。
 *
 * ── 为什么非有不可 ────────────────────────────────────────────────────────
 * AP/RDL 的 id 是 `real_{ap|rdl}_{slug}_{module}_{组内最小题号}`（buildMcqGroup 的 `qs[0]`）。
 * 题号来自源料，而源料是会**长**的：数据侧把一篇文章里更靠前的那道题救回来之后，
 * 组内最小题号就从 27 变成 26，整条 item 跟着改名 real_ap_128a_1_27 → real_ap_128a_1_26。
 *
 * 改名的代价不是「id 不好看」，是**一串按 id 记的东西全部静默失配**：
 *   · data/realBank/review-holds.json 的 unit 下架 / patch 按 id 记 —— 实测一次补题就让
 *     19 条下架 + 2 处 patch 对不上号，15 道人工判定「不能上线」的题当场复活；
 *   · 用户侧错题本、练习记录、done-key 也按 id 关联 —— 改名 = 那条记录指向一道不存在的题。
 * 而且这不是一次性的：以后每补一批题就再炸一遍。所以要在代码里根治 —— 认「这是同一篇材料」
 * 而不是认「题号」，同一篇就沿用上一版的 id。
 *
 * ── 判据 ─────────────────────────────────────────────────────────────────
 * 同 kind（ap/rdl 各自比，不跨文件）、同 slug、同 module，且材料正文
 * **归一化后逐字相同**或**词集 Jaccard ≥ 0.8** —— 口径与 build_bank.groupByMaterial、
 * material_image_carry 完全一致（同一篇的 OCR 变体实测 ≥0.896，不同文章 ≤0.06）。
 * slug/module 从 id 里抠（新旧 id 都是同一套形状），认不出的 id 一律不参与沿用。
 *
 * 同一个旧 id 只许被沿用一次：一对多时**材料最像的那条**拿走，其余按现规则生成并报警告。
 *
 * 注意这**不是**去重 —— 它只改 id，不删条目。跨卷同篇的合并是另一步
 * （scripts/realbank/consolidate_reading.js），必须排在本步之后：合并要按 id 查
 * 复核清单的 dup_of / 待下架，id 得先稳定下来。
 */

const { materialText } = require("./material_image_carry.js");

/** 与 build_bank.MATERIAL_JACCARD_MIN 同一个数：同一篇材料的 OCR 变体阈值。 */
const MATERIAL_JACCARD_MIN = 0.8;

// 归一化 / 词集口径与 build_bank 的 matNorm / matTokens 一致（只留字母，压空白，词长 > 3）。
const matNorm = (s) => String(s || "").toLowerCase().replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s) => new Set(matNorm(s).split(" ").filter((w) => w.length > 3));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * 从 ap/rdl 的 id 里抠出 (type, slug, module, q)。
 * slug 不含下划线（setSlug 的产出：121a / rf0610 / rp0704 / 510v2），所以贪婪的 `.+` 回溯之后
 * 正好把最后两段数字让给 module / q。认不出（如历史遗留的 `real_ap_523_undefined_34`）返回 null。
 */
function idParts(id) {
  const m = /^real_(ap|rdl)_(.+)_(\d+)_(\d+)$/.exec(String(id || ""));
  return m ? { type: m[1], slug: m[2], module: m[3], q: Number(m[4]) } : null;
}

/** 同 kind 下的分桶键：slug + module。 */
function bucketKey(id) {
  const p = idParts(id);
  return p ? `${p.slug}/${p.module}` : null;
}

/**
 * 上一版 id 沿用。
 *
 * 就地改 bundle 里命中条目的 `id`，返回记账：
 *   { carried, renamed: [{from, to}], conflicts: [{id, wanted, why}] }
 * renamed 只记**真的改了名**的（沿用到的 id 与新生成的不同），conflicts 记一对多里落选的那条。
 *
 * @param {Record<string, Array<object>>} prevBundle 上一版 {ap: items[], rdl: items[]}
 * @param {Record<string, Array<object>>} bundle 新一版 {ap: items[], rdl: items[]}（会被就地修改）
 */
function carryItemIds(prevBundle, bundle) {
  const renamed = [];
  const conflicts = [];

  for (const [kind, list] of Object.entries(bundle || {})) {
    const prevItems = (prevBundle || {})[kind];
    if (!Array.isArray(prevItems) || !Array.isArray(list) || !list.length) continue;

    // 旧库按 (slug, module) 分桶
    const oldByBucket = new Map();
    for (const it of prevItems) {
      if (!it || !it.id) continue;
      const key = bucketKey(it.id);
      if (!key) continue;
      const text = materialText(it);
      if (!text.trim()) continue;
      if (!oldByBucket.has(key)) oldByBucket.set(key, []);
      oldByBucket.get(key).push({ id: String(it.id), norm: matNorm(text), tokens: tokens(text) });
    }
    if (!oldByBucket.size) continue;

    // 逐条新 item 找候选
    const pairs = [];
    const nodes = [];
    for (const it of list) {
      if (!it || !it.id) continue;
      const key = bucketKey(it.id);
      const text = materialText(it);
      const node = { item: it, own: String(it.id), assigned: null, score: 0 };
      nodes.push(node);
      if (!key || !text.trim()) continue;
      const norm = matNorm(text);
      const tk = tokens(text);
      for (const o of oldByBucket.get(key) || []) {
        // 逐字相同记 1，压过任何模糊命中；否则要过 0.8 才算同一篇。
        const score = norm && norm === o.norm ? 1 : jaccard(tk, o.tokens);
        if (score >= MATERIAL_JACCARD_MIN) pairs.push({ node, oldId: o.id, score });
      }
    }
    if (!pairs.length) continue;

    // 贪心：最像的先配对。同分按 (新 id, 旧 id) 字典序，保证重建结果确定。
    pairs.sort((a, b) => b.score - a.score
      || a.node.own.localeCompare(b.node.own)
      || a.oldId.localeCompare(b.oldId));
    const usedOld = new Set();
    const warned = new Set();
    for (const p of pairs) {
      if (p.node.assigned || usedOld.has(p.oldId)) {
        // 这条新 item 已经配到更像的旧 id，或这个旧 id 已经被更像的新 item 拿走了
        if (!p.node.assigned && p.node.own !== p.oldId && !warned.has(p.node.own)) {
          warned.add(p.node.own);
          conflicts.push({ id: p.node.own, wanted: p.oldId, why: "旧 id 已被同桶里更像的一条沿用" });
        }
        continue;
      }
      p.node.assigned = p.oldId;
      p.node.score = p.score;
      usedOld.add(p.oldId);
    }

    // 撞 id 收敛：沿用来的 id 不能与「没被改名的那些条目自带的 id」撞。
    // 撞了就撤掉分数最低的那条沿用（它退回自己生成的 id），最多转几圈直到不撞为止。
    for (let guard = 0; guard < 8; guard += 1) {
      const byFinal = new Map();
      for (const n of nodes) {
        const fin = n.assigned || n.own;
        if (!byFinal.has(fin)) byFinal.set(fin, []);
        byFinal.get(fin).push(n);
      }
      let changed = false;
      for (const [fin, group] of byFinal) {
        if (group.length < 2) continue;
        const carried = group.filter((n) => n.assigned);
        if (!carried.length) continue;           // 两条新 item 天生同 id：老毛病，不归本步管
        carried.sort((a, b) => a.score - b.score || a.own.localeCompare(b.own));
        const loser = carried[0];
        conflicts.push({ id: loser.own, wanted: loser.assigned, why: `沿用后与 ${fin} 撞 id，撤回` });
        loser.assigned = null;
        changed = true;
      }
      if (!changed) break;
    }

    for (const n of nodes) {
      if (!n.assigned || n.assigned === n.own) continue;
      renamed.push({ from: n.own, to: n.assigned });
      n.item.id = n.assigned;
    }
  }

  renamed.sort((a, b) => a.to.localeCompare(b.to));
  conflicts.sort((a, b) => a.id.localeCompare(b.id));
  return { carried: renamed.length, renamed, conflicts };
}

/**
 * 在上一版**另一类**库里找同一篇材料的旧 id（归位用：这一版从 ap 挪到 rdl 的条目，上一版在 ap.json 里叫什么）。
 * 判据同 carryItemIds：同 slug、同 module、材料逐字相同或 Jaccard ≥ 0.8；多条命中取最像的。找不到返回 null。
 */
function findPrevId(prevItems, item) {
  const key = bucketKey(item && item.id);
  const text = materialText(item);
  if (!key || !text.trim() || !Array.isArray(prevItems)) return null;
  const norm = matNorm(text);
  const tk = tokens(text);
  let best = null;
  for (const it of prevItems) {
    if (!it || !it.id || bucketKey(it.id) !== key) continue;
    const t = materialText(it);
    if (!t.trim()) continue;
    const score = matNorm(t) === norm ? 1 : jaccard(tk, tokens(t));
    if (score < MATERIAL_JACCARD_MIN) continue;
    if (!best || score > best.score || (score === best.score && String(it.id) < best.id)) best = { id: String(it.id), score };
  }
  return best ? best.id : null;
}

/**
 * 按题号认领复核清单 / patch 里按 id 记的条目（id 沿用之后、跨卷合并之前调）。
 *
 * ── 为什么 id 沿用还不够 ──────────────────────────────────────────────────
 * carryItemIds 只从「上一版在线条目」沿用 id。被复核**整条下架**的条目从来不在线，沿用不到：
 * 补回一道更靠前的题，组内最小题号从 33 变 31，real_ap_21a_1_33（清单判「材料中段整段缺失」下架）
 * 就改名成 real_ap_21a_1_31 —— 按 id 记的下架静默失效，条目复活；跨卷合并按 id 判「待下架」也跟着失灵，
 * 它甚至被选成 Opal 簇的代表，把在线的完整版并掉了。按 id 记的 patch / 单题下架同样会脱靶。
 *
 * ── 判据 ─────────────────────────────────────────────────────────────────
 * 题号是卷面上固定的：同卷、同 module、同一个题号的题只可能属于同一篇材料。所以清单里某个 id 的
 * slug、module 与条目相同，且它末段的题号 ∈ 条目**自有题**（非并入）的 q_number 集合，这个 id 记的就是这篇。
 *   · 认领优先级：整条下架 > 单题下架 > patch；同类里题号最小的优先（与「id 取组内最小题号」同口径）；
 *   · 一个条目命中多个 → 取优先的那个赋给它并警告，其余几个记 reclassified 边指到它（同一份材料换了 id，
 *     apply_review 顺着搬过去，patch / 其余下架照样生效）；
 *   · 同一个清单 id 只认领一次；已经被别的条目占着（在线且 id 相同）的不认领；
 *   · 靠上一版在线条目沿用到 id 的（skipIds）不参与 —— 沿用优先级更高；
 *   · kind 不同（清单记 real_ap_…，条目归位成了 rdl）→ 按条目的 kind 换前缀，并记 reclassified 边
 *     旧清单 id → 新 id，保证 apply_review 能把下架 / patch 搬过去。
 *
 * 就地改 bundle 里条目的 id。返回 { claimed: [{from, to, ref, source}], edges, warnings }。
 *
 * @param {Record<string, object[]>} bundle { ap: items[], rdl: items[] }
 * @param {{holds?: object[], patches?: object[]}} review review-holds.json 的内容
 * @param {{skipIds?: Iterable<string>}} opts
 */
function claimReferencedIds(bundle, review, { skipIds = [] } = {}) {
  const PRIORITY = { unit: 0, question: 1, patch: 2 };
  const skip = new Set([...skipIds].map(String));
  const refs = new Map();                                   // 清单 id → {id, parts, source}
  const addRef = (x, source) => {
    if (!x || !/^reading\/(ap|rdl)$/.test(String(x.file || "")) || !x.id) return;
    const parts = idParts(x.id);
    if (!parts) return;
    const prev = refs.get(String(x.id));
    if (!prev || PRIORITY[source] < PRIORITY[prev.source]) refs.set(String(x.id), { id: String(x.id), parts, source });
  };
  for (const h of (review && review.holds) || []) {
    if (h && (h.scope === "unit" || h.scope === "question")) addRef(h, h.scope);
  }
  for (const p of (review && review.patches) || []) addRef(p, "patch");

  const items = [];
  for (const [kind, list] of Object.entries(bundle || {})) {
    for (const it of list || []) if (it && it.id) items.push({ kind, it });
  }
  items.sort((a, b) => String(a.it.id).localeCompare(String(b.it.id)));
  const liveIds = new Set(items.map((x) => String(x.it.id)));

  const claimedRefs = new Set();
  const claimed = [];
  const edges = [];
  const warnings = [];
  for (const { kind, it } of items) {
    const own = String(it.id);
    const p = idParts(own);
    if (!p) continue;
    const qs = new Set((it.questions || []).filter((q) => !q.merged_from).map((q) => Number(q.q_number)));
    const cands = [...refs.values()].filter((r) => r.parts.slug === p.slug && r.parts.module === p.module
      && qs.has(r.parts.q) && !claimedRefs.has(r.id) && !(liveIds.has(r.id) && r.id !== own));
    if (!cands.length) continue;
    if (skip.has(own)) {
      if (cands.some((r) => r.source === "unit" && r.id !== own)) {
        warnings.push(`${own} 靠上一版在线条目沿用了 id，但清单里 ${cands.filter((r) => r.source === "unit").map((r) => r.id).join(", ")} 按题号也指向它（沿用优先，未认领；请人工核对）`);
      }
      continue;
    }
    cands.sort((a, b) => PRIORITY[a.source] - PRIORITY[b.source] || a.parts.q - b.parts.q || a.id.localeCompare(b.id));
    const chosen = cands[0];
    const target = `real_${kind}_${p.slug}_${p.module}_${chosen.parts.q}`;
    if (chosen.id === own && cands.length === 1) { claimedRefs.add(own); continue; }   // 本来就叫这个 id，无事可做
    if (target !== own && liveIds.has(target)) {
      warnings.push(`${own} 想认领 ${chosen.id}（→ ${target}）但 ${target} 已被别的条目占用，未认领`);
      continue;
    }
    if (cands.filter((r) => r.source === "unit").length > 1) {
      warnings.push(`${own} 按题号命中多条整条下架：${cands.filter((r) => r.source === "unit").map((r) => r.id).join(", ")}，取题号最小的 ${chosen.id}`);
    }
    if (target !== own) {
      liveIds.delete(own);
      liveIds.add(target);
      it.id = target;
    }
    for (const r of cands) {
      claimedRefs.add(r.id);
      if (r.id !== target) edges.push({ from: r.id, to: target, reason: "reclassified" });
    }
    claimed.push({ from: own, to: target, ref: chosen.id, source: chosen.source, also: cands.slice(1).map((r) => r.id) });
  }
  claimed.sort((a, b) => a.to.localeCompare(b.to));
  edges.sort((a, b) => a.from.localeCompare(b.from));
  return { claimed, edges, warnings };
}

module.exports = { MATERIAL_JACCARD_MIN, idParts, carryItemIds, findPrevId, claimReferencedIds };
