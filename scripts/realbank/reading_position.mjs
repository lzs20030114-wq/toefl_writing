/**
 * 真题阅读「日常阅读 / 学术阅读」按考卷位置归位（纯函数，无 IO —— 供 build_bank.mjs 与单测共用）。
 *
 * ── 为什么 ────────────────────────────────────────────────────────────────
 * build_bank 以前的判据是「组里有 type=ap 的记录，或者材料词数 ≥160」。长篇网页/通知/帖子
 * 超过 160 词很常见，于是 14 篇日常阅读（real_ap_21a_1_29「Post by Laura Kim, Fitness Coach」、
 * real_ap_310_1_25「How Well Did You Sleep?」、real_ap_311_1_28「Subject: Software update」…）
 * 进了 ap.json，在学术阅读列表里显示成 2~3 题的「Academic Passage」。
 *
 * 题型真正的依据是**考卷位置**：2026 改后阅读卷的题号带是固定的（lib/realExam/blueprint.mjs）。
 *   M1 A 型：日常阅读 21-30 · 学术 31-35
 *   M1 B 型：日常阅读 21-25 · 学术 26-30 · 学术 31-35
 *   M2     ：学术 11-15（没有日常阅读）
 *
 * ── 判据（只在题号带归属**确定**时才改，判不准一律不动）───────────────────
 *  1. 两种版式下落在同一类槽位 → 确定：M1 21-25 = 日常，M1 31-35 = 学术，M2 11-15 = 学术。
 *  2. 只有一种版式放得下 → 确定：跨 25/26 的组（如 25-27）只可能是 A 型的日常阅读。
 *  3. 落在 M1 26-30（A 型日常 / B 型学术）→ 看版式，版式要有**结构证据**才算数：
 *       B 证据：同卷 M1 有一组 ⊆26-30 且 ≥4 题、体裁不是日常体裁（真正的 5 题学术簇，允许丢 1 题）；
 *       A 证据：同卷 M1 有一组跨 25/26（只有 A 型放得下）。
 *     两种证据都没有时，只有「体裁是日常体裁 + ≤3 题」才归日常（positionType 的体裁规则）。
 *     最后还要与 assemble_sets 对账：按**归位之后**的题型跑一遍它的 positionType +
 *     detectReadingM1Form，得出的版式必须与本条的归位方向一致，打架就撤回 —— 不许出现
 *     build 归成 rdl、装整卷时却按 B 型把它当学术槽的情况。
 *  4. 其余（跨 30/31、拼盘卷 rp*、题号认不出）→ 不动。
 */
import {
  DAILY_GENRES, detectReadingM1Form, isPoolSlug, normalizeQ, positionType, slotsFor,
} from "../../lib/realExam/blueprint.mjs";

const isDaily = (genre) => DAILY_GENRES.has(String(genre || "").trim().toLowerCase());

/** 这组题号全部落进某版式的哪一类槽位；跨槽位 / 没有槽位 → null。 */
function slotTypeFor(module, form, qs) {
  const slots = slotsFor("reading", module, form);
  const hit = slots.find((s) => qs.every((q) => q >= s.band[0] && q <= s.band[1]));
  return hit && (hit.type === "ap" || hit.type === "rdl") ? hit.type : null;
}

/**
 * @param {Array<{key:any, module:number, qs:number[], genre?:string, kind:"ap"|"rdl"}>} groups
 *        同一套卷的全部 AP/RDL 组（qs 是组内题号，原始编号，rf 卷的 121 这种也行）
 * @param {{slug?: string}} opts
 * @returns {Array<{key, kind, from, changed, why}>} 与 groups 同序
 */
export function decideReadingKinds(groups, { slug } = {}) {
  const pool = slug != null && isPoolSlug(slug);
  const norm = groups.map((g) => {
    const qs = (g.qs || []).map((q) => normalizeQ(Number(q), { module: g.module }));
    const ok = !pool && (g.module === 1 || g.module === 2) && qs.length > 0 && qs.every((q) => Number.isInteger(q));
    const sorted = ok ? [...qs].sort((a, b) => a - b) : [];
    return { g, ok, qs: sorted, start: sorted[0], end: sorted[sorted.length - 1], nq: sorted.length };
  });

  const m1 = norm.filter((n) => n.ok && n.g.module === 1);
  const evidenceB = m1.some((n) => n.start >= 26 && n.end <= 30 && n.nq >= 4 && !isDaily(n.g.genre));
  const evidenceA = m1.some((n) => n.start <= 25 && n.end >= 26 && n.end <= 30);

  const decide = (n) => {
    const from = n.g.kind;
    const keep = (why) => ({ kind: from, why, formDependent: false });
    const set = (kind, why, formDependent = false) => ({ kind, why, formDependent });
    if (!n.ok) return keep(pool ? "pool_set" : "unanchored");
    if (n.g.module === 2) return slotTypeFor(2, "A", n.qs) === "ap" ? set("ap", "m2_band_11_15") : keep("m2_out_of_band");
    const tA = slotTypeFor(1, "A", n.qs);
    const tB = slotTypeFor(1, "B", n.qs);
    if (tA && tB && tA === tB) return set(tA, tA === "rdl" ? "m1_band_21_25" : "m1_band_31_35");
    if (tA && !tB) return set(tA, "fits_form_A_only");
    if (!tA && tB) return set(tB, "fits_form_B_only");
    if (tA === "rdl" && tB === "ap") {
      if (evidenceA && !evidenceB) return set("rdl", "m1_26_30_form_A", true);
      if (evidenceB && !evidenceA) return set("ap", "m1_26_30_form_B", true);
      if (!evidenceA && !evidenceB && isDaily(n.g.genre) && n.nq <= 3) return set("rdl", "m1_26_30_daily_genre", true);
      return keep("form_undetermined");
    }
    return keep("spans_slots");
  };
  const decisions = norm.map(decide);

  // 与 assemble_sets 对账（按归位之后的题型）。撤回会改变版式判定，所以转到稳定为止。
  for (let round = 0; round < 4; round += 1) {
    const form = detectReadingM1Form(norm
      .map((n, i) => ({ n, d: decisions[i] }))
      .filter(({ n }) => n.ok && n.g.module === 1)
      .map(({ n, d }) => ({ module: 1, q: n.start, type: positionType(d.kind, { module: 1, q: n.start, nq: n.nq, genre: n.g.genre }) })));
    let reverted = false;
    norm.forEach((n, i) => {
      const d = decisions[i];
      if (!d.formDependent) return;
      const want = d.kind === "rdl" ? "A" : "B";
      if (form !== want) {
        decisions[i] = { kind: n.g.kind, why: "form_conflict_with_assemble", formDependent: false };
        reverted = true;
      }
    });
    if (!reverted) break;
  }

  return norm.map((n, i) => ({
    key: n.g.key, kind: decisions[i].kind, from: n.g.kind,
    changed: decisions[i].kind !== n.g.kind, why: decisions[i].why,
  }));
}

export const _test = { slotTypeFor, isDaily };
