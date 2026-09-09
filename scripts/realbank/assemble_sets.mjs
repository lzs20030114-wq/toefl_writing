#!/usr/bin/env node
/**
 * 真题「装回整卷」—— 把 data/realBank/ 里按题型拆散的题，按卷面题号装回 2026 改后整卷。
 *
 * 背景：机经源是一套一套的整卷（阅读 35+15 / 听力 32+15 / 口语 11 / 写作 12），
 * 录入管线按题型分文件落库（ctw.json / lcr.json / …），前端也按题型练。
 * 但每道题的 id 里都还带着「卷 + module + 题号」（real_lcr_121b_1_01），
 * 所以拆散是可逆的 —— 这个脚本就是那个逆过程。
 *
 * 两层产出（全部写进 data/realBank/sets.json，零 LLM、确定性、可重复）：
 *   1. 原卷（sets）：每套源卷按 lib/realExam/blueprint.mjs 的槽位表逐槽回填，
 *      算出每科的完整度和缺哪一段（是「缺 M2 的学术段落」而不是「缺 3 题」）。
 *   2. 拼卷（composites / exams）：以完整度 ≥ --skeleton-min 的原卷为骨架，
 *      空槽从「拼盘卷 rp*」「完整度太低被拆散的卷」「骨架卷里塞不进槽位的富余题」
 *      里借同类型同规格的题补齐；每道借来的题都带 from/via 出处，纯度(purity)=
 *      骨架自有题占比。四科都拼齐的再合成整卷（native = 四科同一源卷）。
 *
 * 只借不造：借不到就留缺口如实报告，不会把 3 题的学术段落假装成 5 题。
 *
 * 用法：
 *   node scripts/realbank/assemble_sets.mjs                   # 写 sets.json + 报告
 *   node scripts/realbank/assemble_sets.mjs --dry-run         # 只打印摘要
 *   --bank <dir> --out <file> --report <file> --skeleton-min 0.5 --full-min 0.9
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  BLUEPRINT_VERSION, SECTION_OF, SECTIONS, EXAM_2026,
  parseRealBankId, isPoolSlug, normalizeQ, positionType,
  detectReadingM1Form, detectListeningM2Form, slotsFor, slotAccepts, findSlot, questionCount,
} from "../../lib/realExam/blueprint.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..", "..");

export const BANK_FILES = Object.freeze({
  ctw: "reading/ctw.json", rdl: "reading/rdl.json", ap: "reading/ap.json",
  lcr: "listening/lcr.json", lc: "listening/lc.json", la: "listening/la.json", lat: "listening/lat.json",
  repeat: "speaking/repeat.json", interview: "speaking/interview.json",
  bs: "writing/bs.json", email: "writing/email.json", disc: "writing/discussion.json",
});

const DEFAULTS = Object.freeze({ skeletonMin: 0.3, fullMin: 0.9 });

/* ── 读库 ─────────────────────────────────────────────────────────────── */

export function loadBanks(bankDir) {
  const banks = {};
  for (const [type, rel] of Object.entries(BANK_FILES)) {
    const p = path.join(bankDir, rel);
    banks[type] = fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")).items || []) : [];
  }
  return banks;
}

/** 同题簇（source-flags.json 的 duplicate_cluster）：借题时优先在簇内借 —— 那本来就是同一批考题。 */
export function loadClusters(bankDir) {
  const p = path.join(bankDir, "source-flags.json");
  if (!fs.existsSync(p)) return new Map();
  const flags = JSON.parse(fs.readFileSync(p, "utf8")).sets || {};
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  const union = (a, b) => { add(a); add(b); parent.set(find(a), find(b)); };
  for (const [set, list] of Object.entries(flags)) {
    for (const f of list || []) {
      if (f.code !== "duplicate_cluster") continue;
      const m = /与(.+?)属同题簇/.exec(String(f.detail || ""));
      if (!m) continue;
      for (const other of m[1].split(/[、,，]/).map((s) => s.trim()).filter(Boolean)) union(set, other);
    }
  }
  const out = new Map();
  for (const k of parent.keys()) out.set(k, find(k));
  return out;
}

/* ── 逐题建索引 ────────────────────────────────────────────────────────── */

/**
 * 每道 item → 一条 record：
 *   { id, type, ptype, section, set, slug, date, pool, module, q, nq, anchorable, why }
 * ptype 是按位置修正后的题型（见 blueprint.positionType）。
 */
export function indexItems(banks) {
  const records = [];
  for (const [type, items] of Object.entries(banks)) {
    for (const item of items) {
      const parsed = parseRealBankId(item.id);
      const nq = questionCount(type, item);
      const base = {
        id: String(item.id), type, ptype: type, section: SECTION_OF[type],
        set: String(item.source || "").trim() || "?", slug: parsed?.slug || "?",
        date: String(item.date || "").trim(), nq, pool: false, module: null, q: null,
        anchorable: false, why: "",
      };
      if (!parsed) { records.push({ ...base, why: "id 形状认不出" }); continue; }
      base.slug = parsed.slug;
      if (isPoolSlug(parsed.slug)) { records.push({ ...base, pool: true, why: "拼盘卷，无卷面题号" }); continue; }
      const mod = parsed.module;
      let q;
      if (type === "bs") q = parsed.q;
      else if (type === "email") q = 11;
      else if (type === "disc") q = 12;
      else if (type === "repeat") q = 1;
      else if (type === "interview") q = 8;
      else q = normalizeQ(parsed.q, { module: mod });
      if (mod !== 1 && mod !== 2) { records.push({ ...base, module: mod, q, why: `module ${mod} 不在卷面上` }); continue; }
      if (q == null) { records.push({ ...base, module: mod, why: "题号无卷面意义" }); continue; }
      const ptype = positionType(type, { module: mod, q, nq });
      records.push({ ...base, ptype, module: mod, q, anchorable: true });
    }
  }
  return records;
}

/* ── 原卷回填 ──────────────────────────────────────────────────────────── */

/** near = 只差 1 题，且槽位本身 ≥4 题（学术段落 4/5、讲座 3/4、造句 9/10 算近似满；2 题的对话缺 1 题不算）。 */
export function slotStatus(got, need) {
  if (got >= need) return "full";
  if (need >= 4 && got === need - 1) return "near";
  if (got > 0) return "partial";
  return "empty";
}

function newSlotFill(def) {
  return { key: def.key, type: def.type, band: def.band, need: def.q, units: def.units, items: [], got: 0, status: "empty" };
}

function refreshSlot(s) {
  s.got = s.items.reduce((a, x) => a + x.nq, 0);
  s.status = slotStatus(s.got, s.need);
  return s;
}

function moduleFrame(section, module, form) {
  const slots = slotsFor(section, module, form).map(newSlotFill);
  return { module, form, slots, need: slots.reduce((a, s) => a + s.need, 0), got: 0 };
}

function refreshModule(m) {
  for (const s of m.slots) refreshSlot(s);
  m.got = m.slots.reduce((a, s) => a + Math.min(s.got, s.need), 0);
  return m;
}

function sectionFrame(section, records) {
  const modules = Object.keys(EXAM_2026[section].modules).map(Number);
  const forms = {};
  for (const mod of modules) {
    let form = "A";
    if (section === "reading" && mod === 1) form = detectReadingM1Form(records.map((r) => ({ ...r, type: r.ptype })));
    if (section === "listening" && mod === 2) form = detectListeningM2Form(records.map((r) => ({ ...r, type: r.ptype })));
    forms[mod] = moduleFrame(section, mod, form);
  }
  return { section, modules: forms, need: 0, got: 0, completeness: 0, unplaced: [] };
}

function refreshSection(sec) {
  const mods = Object.values(sec.modules).map(refreshModule);
  sec.need = mods.reduce((a, m) => a + m.need, 0);
  sec.got = mods.reduce((a, m) => a + m.got, 0);
  sec.completeness = sec.need ? +(sec.got / sec.need).toFixed(3) : 0;
  return sec;
}

const asFill = (r, extra = {}) => ({ id: r.id, nq: r.nq, q: r.q, from: r.set, via: "native", ...extra });

/**
 * 把可锚定的题按 (卷, 科, module, 题号) 塞进槽位。
 * 返回 Map<setName, { set, slug, date, sections: { reading: SectionFrame, … } }>。
 * 塞不进任何槽的（题号带外 / 槽已被同类占满 —— 例如 M1 冒出第 4 段对话）记进 section.unplaced。
 */
export function anchorSets(records) {
  const bySet = new Map();
  for (const r of records) {
    if (!r.anchorable) continue;
    if (!bySet.has(r.set)) bySet.set(r.set, { set: r.set, slug: r.slug, date: r.date, sections: {}, _recs: {} });
    const s = bySet.get(r.set);
    if (!s.date && r.date) s.date = r.date;
    (s._recs[r.section] ??= []).push(r);
  }
  for (const s of bySet.values()) {
    for (const [section, recs] of Object.entries(s._recs)) {
      const frame = sectionFrame(section, recs);
      recs.sort((a, b) => a.module - b.module || a.q - b.q || a.id.localeCompare(b.id));
      for (const r of recs) {
        const mod = frame.modules[r.module];
        const def = mod && findSlot(mod.slots, r.ptype, r.q);
        if (!def) { frame.unplaced.push({ ...r, why: "题号带外或题型不合" }); continue; }
        const slot = mod.slots.find((x) => x.key === def.key);
        const unitCap = Array.isArray(slot.units) ? slot.units[1] : slot.units;
        if (slot.items.length >= unitCap) { frame.unplaced.push({ ...r, why: `槽位 ${slot.key} 已满` }); continue; }
        slot.items.push(asFill(r));
      }
      s.sections[section] = refreshSection(frame);
    }
    delete s._recs;
  }
  return bySet;
}

/* ── 拼卷 ─────────────────────────────────────────────────────────────── */

const dayNum = (d) => { const t = Date.parse(d || ""); return Number.isFinite(t) ? Math.round(t / 86400000) : null; };

function donorFrom(r, via) {
  return { id: r.id, type: r.ptype, nq: r.nq, q: r.q, set: r.set, date: r.date, via, split: null, used: false };
}

/** 拼盘里 28 句的复述 / 19 问的面试 → 按考试规格切成 7 句 / 4 问一份。 */
function splitPooled(donor, item, unit) {
  const list = donor.type === "repeat" ? (item.sentences || []) : (item.questions || []);
  if (list.length <= unit) return [donor];
  const out = [];
  for (let i = 0, k = 1; i < list.length; i += unit, k += 1) {
    const chunk = list.slice(i, i + unit);
    out.push({ ...donor, id: `${donor.id}#c${k}`, nq: chunk.length, split: { from: donor.id, ids: chunk.map((x) => x.id), range: [i + 1, i + chunk.length] } });
  }
  return out;
}

function donorRank(d, base, clusters) {
  const sameCluster = clusters.get(d.set) && clusters.get(d.set) === clusters.get(base.set) ? 0 : 1;
  const a = dayNum(d.date), b = dayNum(base.date);
  const dist = a != null && b != null ? Math.abs(a - b) : 9999;
  return [sameCluster, dist];
}

function pickDonor(donors, base, clusters, accept, prefer) {
  let best = null, bestKey = null;
  for (const d of donors) {
    if (d.used || !accept(d)) continue;
    const key = [...prefer(d), ...donorRank(d, base, clusters), d.id];
    if (!best || cmpKeys(key, bestKey) < 0) { best = d; bestKey = key; }
  }
  return best;
}

function cmpKeys(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

function cloneFrame(sec) {
  return JSON.parse(JSON.stringify(sec));
}

/**
 * 逐科拼卷。返回 { composites: [...], donors: [...], skeletons: n, dissolved: [...] }。
 */
export function assembleSection(section, anchored, records, banks, clusters, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const itemById = new Map();
  for (const [type, items] of Object.entries(banks)) for (const it of items) itemById.set(String(it.id), { type, item: it });
  const recById = new Map(records.map((r) => [r.id, r]));

  // 按完整度排队：强的先当骨架；弱的（< skeletonMin）一开始就拆成素材；
  // 中间的先排队，轮到自己之前如果被更强的卷借走了题，就整卷拆散（lazy dissolve）。
  const ranked = [...anchored.values()].filter((s) => s.sections[section])
    .sort((a, b) => b.sections[section].completeness - a.sections[section].completeness || String(a.date).localeCompare(String(b.date)) || a.set.localeCompare(b.set));
  const donors = [];
  const dissolved = new Set();

  const pushDonor = (r, via) => {
    const d = donorFrom(r, via);
    const unit = d.type === "repeat" ? 7 : d.type === "interview" ? 4 : 0;
    if (unit) donors.push(...splitPooled(d, itemById.get(d.id)?.item, unit));
    else donors.push(d);
  };
  const dissolve = (s) => {
    if (dissolved.has(s.set)) return;
    dissolved.add(s.set);
    const sec = s.sections[section];
    for (const m of Object.values(sec.modules)) for (const sl of m.slots) for (const f of sl.items) {
      const r = recById.get(f.id);
      if (r) pushDonor(r, "dissolved");
    }
  };
  for (const r of records) {
    if (r.section !== section) continue;
    if (r.pool) pushDonor(r, "pool");
    else if (!r.anchorable) pushDonor(r, "unanchored");
  }
  for (const s of ranked) for (const u of s.sections[section].unplaced) pushDonor(u, "leftover");
  for (const s of ranked) if (s.sections[section].completeness < o.skeletonMin) dissolve(s);

  /** 现有素材里没有合用的 → 从队尾（最弱）起找一套还没处理、且槽里有合用题的卷拆掉。 */
  const ensureDonor = (fromIdx, accept) => {
    if (donors.some((d) => !d.used && accept(d))) return true;
    for (let j = ranked.length - 1; j > fromIdx; j -= 1) {
      const cand = ranked[j];
      if (dissolved.has(cand.set)) continue;
      const has = Object.values(cand.sections[section].modules).some((m) => m.slots.some((sl) => sl.items.some((f) => {
        const r = recById.get(f.id);
        return r && accept(donorFrom(r, "dissolved"));
      })));
      if (has) { dissolve(cand); return true; }
    }
    return false;
  };
  const take = (i, base, accept, prefer) => {
    if (!ensureDonor(i, accept)) return null;
    const d = pickDonor(donors, base, clusters, accept, prefer);
    if (d) d.used = true;
    return d;
  };

  const composites = [];
  for (let i = 0; i < ranked.length; i += 1) {
    const s = ranked[i];
    if (dissolved.has(s.set)) continue;
    const sec = cloneFrame(s.sections[section]);
    const before = sec.completeness;
    const borrowed = [];
    for (const m of Object.values(sec.modules)) {
      for (const sl of m.slots) {
        const accept = (d) => slotAccepts({ type: sl.type }, d.type);
        if (sl.type === "lcr" || sl.type === "bs") {
          // 带槽：按份数补满（bs 优先补同题号位 —— 卷面 1→10 大致由易到难）
          const have = new Set(sl.items.map((x) => x.q));
          const cap = Array.isArray(sl.units) ? sl.units[1] : sl.units;
          const wanted = [];
          for (let q = sl.band[0]; q <= sl.band[1]; q += 1) if (!have.has(q)) wanted.push(q);
          for (const q of wanted) {
            if (sl.items.length >= cap) break;
            const d = take(i, s, accept, (x) => [sl.type === "bs" && x.q === q ? 0 : 1]);
            if (!d) break;
            const fill = { id: d.id, nq: d.nq, q, from: d.set, via: d.via };
            sl.items.push(fill); borrowed.push({ slot: sl.key, ...fill });
          }
        } else if (sl.type === "rdl") {
          // 日常阅读带：用 2~3 题的短文凑满题数，不许超
          const cap = Array.isArray(sl.units) ? sl.units[1] : sl.units;
          let remaining = sl.need - sl.items.reduce((a, x) => a + x.nq, 0);
          while (remaining > 0 && sl.items.length < cap) {
            const rem = remaining;
            const d = take(i, s, (x) => accept(x) && x.nq <= rem && x.nq > 0, (x) => [-(x.nq)]);
            if (!d) break;
            remaining -= d.nq;
            const fill = { id: d.id, nq: d.nq, q: null, from: d.set, via: d.via };
            sl.items.push(fill); borrowed.push({ slot: sl.key, ...fill });
          }
        } else {
          // 单元槽（一篇 / 一段 / 一套）：空的就借；残缺严重（partial）的换成更完整的，被换下的回捐
          refreshSlot(sl);
          if (sl.status === "full" || sl.status === "near") continue;
          const current = sl.items[0] || null;
          const curNq = current ? current.nq : 0;
          const d = take(i, s, (x) => accept(x) && x.nq > curNq, (x) => [-Math.min(x.nq, sl.need)]);
          if (!d) continue;
          if (current) {
            const r = recById.get(current.id);
            if (r) donors.push(donorFrom(r, "displaced"));
            sl.items = [];
          }
          const fill = { id: d.id, nq: d.nq, q: sl.band[0], from: d.set, via: d.via, ...(d.split ? { split: d.split } : {}) };
          sl.items.push(fill); borrowed.push({ slot: sl.key, ...fill });
        }
      }
    }
    refreshSection(sec);
    const slotsAll = Object.values(sec.modules).flatMap((m) => m.slots);
    const nativeQ = slotsAll.reduce((b, sl) => b + sl.items.filter((x) => x.via === "native").reduce((c, x) => c + x.nq, 0), 0);
    const totalQ = slotsAll.reduce((b, sl) => b + sl.items.reduce((c, x) => c + x.nq, 0), 0);
    // 「拼齐」= 总完整度过门槛 **且** 每个槽至少近似满（缺一整段学术段落 / 缺讨论题的卷不算齐）
    const complete = sec.completeness >= o.fullMin && slotsAll.every((sl) => sl.status === "full" || sl.status === "near");
    composites.push({
      id: `${section}:${s.slug}`, section, base_set: s.set, date: s.date,
      forms: Object.fromEntries(Object.values(sec.modules).map((m) => [m.module, m.form])),
      completeness_before: before, completeness: sec.completeness, complete,
      purity: totalQ ? +(nativeQ / totalQ).toFixed(3) : 0,
      borrowed, modules: sec.modules,
      missing: Object.values(sec.modules).flatMap((m) => m.slots.filter((sl) => sl.status !== "full").map((sl) => `M${m.module}/${sl.key}:${sl.got}/${sl.need}`)),
    });
  }
  return { composites, donors, skeletons: composites.length, dissolved: [...dissolved] };
}

/** 四科合成整卷：同一源卷四科都拼齐 → native；否则把各科剩余的完整卷按日期顺序配对 → mixed。 */
export function bundleExams(compositesBySection, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const ready = {};
  for (const sec of SECTIONS) ready[sec] = (compositesBySection[sec] || []).filter((c) => c.complete);
  const exams = [];
  const usedIds = new Set();
  const bases = new Set(SECTIONS.flatMap((sec) => ready[sec].map((c) => c.base_set)));
  for (const base of [...bases].sort()) {
    const pick = {};
    for (const sec of SECTIONS) pick[sec] = ready[sec].find((c) => c.base_set === base && !usedIds.has(c.id)) || null;
    if (SECTIONS.every((sec) => pick[sec])) {
      for (const sec of SECTIONS) usedIds.add(pick[sec].id);
      exams.push({ id: `exam:${pick.reading.id.split(":")[1]}`, kind: "native", base_set: base, date: pick.reading.date, sections: Object.fromEntries(SECTIONS.map((sec) => [sec, pick[sec].id])) });
    }
  }
  const rest = {};
  for (const sec of SECTIONS) rest[sec] = ready[sec].filter((c) => !usedIds.has(c.id)).sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
  const n = Math.min(...SECTIONS.map((sec) => rest[sec].length));
  for (let i = 0; i < n; i += 1) {
    const parts = Object.fromEntries(SECTIONS.map((sec) => [sec, rest[sec][i]]));
    exams.push({ id: `exam:mixed-${String(i + 1).padStart(2, "0")}`, kind: "mixed", base_set: null, date: parts.reading.date, sections: Object.fromEntries(SECTIONS.map((sec) => [sec, parts[sec].id])) });
  }
  const leftover = Object.fromEntries(SECTIONS.map((sec) => [sec, rest[sec].slice(n).map((c) => c.id)]));
  return { exams, leftover, fullMin: o.fullMin };
}

/* ── 汇总 ─────────────────────────────────────────────────────────────── */

export function buildManifest(bankDir, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const banks = loadBanks(bankDir);
  const clusters = loadClusters(bankDir);
  const records = indexItems(banks);
  const anchored = anchorSets(records);

  const compositesBySection = {}, donorsBySection = {}, dissolvedBySection = {};
  for (const sec of SECTIONS) {
    const r = assembleSection(sec, anchored, records, banks, clusters, o);
    compositesBySection[sec] = r.composites;
    donorsBySection[sec] = r.donors;
    dissolvedBySection[sec] = r.dissolved;
  }
  const bundle = bundleExams(compositesBySection, o);

  const inventory = {};
  for (const [type, items] of Object.entries(banks)) {
    inventory[type] = { items: items.length, questions: items.reduce((a, it) => a + questionCount(type, it), 0) };
  }
  const formsObserved = { reading_m1: { A: 0, B: 0 }, listening_m2: { A: 0, B: 0 } };
  for (const s of anchored.values()) {
    if (s.sections.reading?.modules[1]?.got) formsObserved.reading_m1[s.sections.reading.modules[1].form] += 1;
    if (s.sections.listening?.modules[2]?.got) formsObserved.listening_m2[s.sections.listening.modules[2].form] += 1;
  }
  const residue = {};
  for (const sec of SECTIONS) for (const d of donorsBySection[sec]) if (!d.used && !d.split) residue[d.type] = (residue[d.type] || 0) + 1;
  // 切分出来的拼盘子集只按母题计一次
  for (const sec of SECTIONS) {
    const seen = new Set();
    for (const d of donorsBySection[sec]) if (!d.used && d.split && !seen.has(d.split.from)) { seen.add(d.split.from); residue[`${d.type}(pool-chunk)`] = (residue[`${d.type}(pool-chunk)`] || 0) + 1; }
  }

  const sets = [...anchored.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.set.localeCompare(b.set)).map((s) => ({
    set: s.set, slug: s.slug, date: s.date,
    sections: Object.fromEntries(Object.entries(s.sections).map(([sec, f]) => [sec, {
      completeness: f.completeness, got: f.got, need: f.need,
      modules: Object.fromEntries(Object.values(f.modules).map((m) => [m.module, { form: m.form, got: m.got, need: m.need, slots: m.slots.map((sl) => ({ key: sl.key, type: sl.type, band: sl.band, need: sl.need, got: sl.got, status: sl.status, items: sl.items.map((x) => ({ id: x.id, nq: x.nq, q: x.q })) })) }])),
      unplaced: f.unplaced.map((u) => ({ id: u.id, type: u.ptype, module: u.module, q: u.q, nq: u.nq, why: u.why })),
    }])),
  }));

  const unanchored = records.filter((r) => !r.anchorable && !r.pool).map((r) => ({ id: r.id, set: r.set, why: r.why }));
  const poolCounts = {};
  for (const r of records) if (r.pool) poolCounts[r.type] = (poolCounts[r.type] || 0) + 1;

  const summary = {
    sets_total: anchored.size,
    per_section: Object.fromEntries(SECTIONS.map((sec) => {
      const all = [...anchored.values()].map((s) => s.sections[sec]).filter(Boolean);
      const c = compositesBySection[sec];
      return [sec, {
        sets_with_any: all.length,
        native_complete: all.filter((f) => f.completeness >= o.fullMin).length,
        native_half: all.filter((f) => f.completeness >= o.skeletonMin && f.completeness < o.fullMin).length,
        native_scraps: all.filter((f) => f.completeness < o.skeletonMin).length,
        skeletons: c.length,
        composites_complete: c.filter((x) => x.complete).length,
        composites_pure: c.filter((x) => x.complete && x.purity === 1).length,
        dissolved: dissolvedBySection[sec].length,
      }];
    })),
    exams_native: bundle.exams.filter((e) => e.kind === "native").length,
    exams_mixed: bundle.exams.filter((e) => e.kind === "mixed").length,
  };

  return {
    blueprint_version: BLUEPRINT_VERSION,
    generated: new Date().toISOString().slice(0, 10),
    generated_by: "scripts/realbank/assemble_sets.mjs",
    params: { skeleton_min: o.skeletonMin, full_min: o.fullMin, near: "差 1 题且槽位 ≥4 题" },
    inventory, pool_items: poolCounts, forms_observed: formsObserved, summary,
    sets, composites: compositesBySection, exams: bundle.exams, exam_leftover: bundle.leftover,
    residue, unanchored,
  };
}

/* ── 报告 ─────────────────────────────────────────────────────────────── */

const pct = (x) => `${Math.round((x || 0) * 100)}%`;

export function renderReport(man) {
  const L = [];
  L.push(`# 真题装回整卷报告（${man.generated}）`, "");
  L.push(`> 生成：\`node scripts/realbank/assemble_sets.mjs\` · 蓝图 ${man.blueprint_version}（lib/realExam/blueprint.mjs）· 零 LLM · 产物 data/realBank/sets.json`, "");
  L.push(`> 参数：骨架门槛 ${pct(man.params.skeleton_min)}（低于此的卷拆成补位素材）· 完整门槛 ${pct(man.params.full_min)} · 近似满(near) = 只差 1 题且槽位 ≥4 题`, "");

  L.push("## 一、2026 改后整卷结构（每套的题数与配比）", "");
  L.push("| 科目 | 总题数 | Module 1 | Module 2 |", "|---|---|---|---|");
  L.push("| 阅读 | 50 | 35：填词 1-20（2 篇×10 空）· 日常阅读 21-30（4 篇 2+2+3+3）· 学术 31-35（1 篇×5）【A 型】<br>或 填词 1-20 · 日常阅读 21-25（2 篇）· 学术 26-30 + 31-35（2 篇×5）【B 型】 | 15：填词 1-10（1 篇）· 学术 11-15（1 篇×5）。**没有日常阅读** |");
  L.push("| 听力 | 47 | 32：短应答 1-12 · 对话 13-18（3 段×2）· 通知 19-24（3 段×2）· 讲座 25-32（2 段×4） | 15：短应答 1-3 · 对话 4-7（2 段×2）· 讲座 8-15（2 段×4）【A 型】<br>或 短应答 1-7 · 讲座 8-11 · 2 题短材料 12-13 / 14-15【B 型】 |");
  L.push("| 口语 | 11 | 听后复述 1-7（7 句）· 模拟面试 8-11（4 问） | — |");
  L.push("| 写作 | 12 | 造句 1-10（10 句）· 邮件 11 · 学术讨论 12 | — |", "");
  L.push(`本库观察到的版式：阅读 M1 A 型 ${man.forms_observed.reading_m1.A} 套 / B 型 ${man.forms_observed.reading_m1.B} 套；听力 M2 A 型 ${man.forms_observed.listening_m2.A} 套 / B 型 ${man.forms_observed.listening_m2.B} 套。`, "");

  L.push("## 二、库存 vs 每套需求（理论上限）", "");
  L.push("| 题型 | 库存 item | 库存题数 | 每套需求 | 理论上限（套） |", "|---|---|---|---|---|");
  const need = { ctw: [3, 30], rdl: [4, 10], ap: [2, 10], lcr: [15, 15], lc: [5, 10], la: [3, 6], lat: [4, 16], repeat: [1, 7], interview: [1, 4], bs: [10, 10], email: [1, 1], disc: [1, 1] };
  for (const [t, inv] of Object.entries(man.inventory)) {
    const [ni, nqq] = need[t];
    const cap = t === "repeat" || t === "interview" ? Math.floor(inv.questions / nqq) : Math.min(Math.floor(inv.items / ni), Math.floor(inv.questions / nqq));
    L.push(`| ${t} | ${inv.items} | ${inv.questions} | ${ni} item / ${nqq} 题 | ${cap} |`);
  }
  L.push("", "（阅读按 A 型口径；repeat/interview 的拼盘大集按句/问数折算）", "");

  L.push("## 三、原卷完整度（不借题时每套自己有多少）", "");
  L.push(`| 科目 | 有题的卷 | 原生完整(≥${pct(man.params.full_min)}) | 半套(${pct(man.params.skeleton_min)}~) | 碎片(<${pct(man.params.skeleton_min)}) |`, "|---|---|---|---|---|");
  for (const [sec, s] of Object.entries(man.summary.per_section)) L.push(`| ${sec} | ${s.sets_with_any} | ${s.native_complete} | ${s.native_half} | ${s.native_scraps} |`);
  L.push("");

  L.push("## 四、拼卷结果", "");
  L.push("| 科目 | 骨架卷 | 拼齐(≥门槛) | 其中纯原卷 | 被拆散当素材的卷 |", "|---|---|---|---|---|");
  for (const [sec, s] of Object.entries(man.summary.per_section)) L.push(`| ${sec} | ${s.skeletons} | ${s.composites_complete} | ${s.composites_pure} | ${s.dissolved} |`);
  L.push("", `整卷：四科同源拼齐 **${man.summary.exams_native}** 套（native），跨源配对 **${man.summary.exams_mixed}** 套（mixed）。`, "");

  for (const sec of SECTIONS) {
    L.push(`### ${sec}`, "", "| 骨架卷 | 日期 | 版式 | 拼前 | 拼后 | 借题 | 纯度 | 仍缺 |", "|---|---|---|---|---|---|---|---|");
    for (const c of man.composites[sec]) {
      const forms = Object.entries(c.forms).map(([m, f]) => `M${m}${f}`).join(" ");
      L.push(`| ${c.base_set} | ${c.date} | ${forms} | ${pct(c.completeness_before)} | ${c.complete ? "**" : ""}${pct(c.completeness)}${c.complete ? "**" : ""} | ${c.borrowed.length} | ${pct(c.purity)} | ${c.missing.join("、") || "—"} |`);
    }
    L.push("");
  }

  L.push("## 五、整卷清单", "", "| 整卷 | 类型 | 日期 | 阅读 | 听力 | 口语 | 写作 |", "|---|---|---|---|---|---|---|");
  for (const e of man.exams) L.push(`| ${e.id} | ${e.kind} | ${e.date} | ${e.sections.reading} | ${e.sections.listening} | ${e.sections.speaking} | ${e.sections.writing} |`);
  L.push("", `配不成整卷的完整单科：${Object.entries(man.exam_leftover).map(([s, l]) => `${s} ${l.length}`).join(" · ")}`, "");

  L.push("## 六、残余与未锚定", "");
  L.push(`借完之后还剩的素材：${Object.entries(man.residue).map(([t, n]) => `${t} ${n}`).join(" · ") || "无"}`, "");
  L.push(`拼盘卷（rp*，无卷面题号，只作素材）：${Object.entries(man.pool_items).map(([t, n]) => `${t} ${n}`).join(" · ") || "无"}`, "");
  if (man.unanchored.length) {
    L.push(`认不出卷面位置的题 ${man.unanchored.length} 条：`, "");
    for (const u of man.unanchored.slice(0, 40)) L.push(`- ${u.id}（${u.set}）：${u.why}`);
    if (man.unanchored.length > 40) L.push(`- …其余 ${man.unanchored.length - 40} 条见 sets.json`);
    L.push("");
  }
  return L.join("\n");
}

/* ── CLI ───────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const a = { bank: path.join(ROOT, "data", "realBank"), out: null, report: null, dryRun: false, skeletonMin: DEFAULTS.skeletonMin, fullMin: DEFAULTS.fullMin };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--bank") { a.bank = path.resolve(v); i += 1; }
    else if (k === "--out") { a.out = path.resolve(v); i += 1; }
    else if (k === "--report") { a.report = path.resolve(v); i += 1; }
    else if (k === "--skeleton-min") { a.skeletonMin = Number(v); i += 1; }
    else if (k === "--full-min") { a.fullMin = Number(v); i += 1; }
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--help" || k === "-h") { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]); process.exit(0); }
  }
  a.out ??= path.join(a.bank, "sets.json");
  a.report ??= path.join(ROOT, "data", "claudeGen", "reports", `REALBANK-SETS-${new Date().toISOString().slice(0, 10)}.md`);
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const man = buildManifest(a.bank, { skeletonMin: a.skeletonMin, fullMin: a.fullMin });
  const s = man.summary;
  console.log(`卷 ${s.sets_total} 套 · 蓝图 ${man.blueprint_version}`);
  for (const [sec, x] of Object.entries(s.per_section)) {
    console.log(`  ${sec.padEnd(9)} 有题 ${String(x.sets_with_any).padStart(2)} · 原生完整 ${String(x.native_complete).padStart(2)} · 骨架 ${String(x.skeletons).padStart(2)} → 拼齐 ${String(x.composites_complete).padStart(2)}（纯原卷 ${x.composites_pure}）· 拆散 ${x.dissolved}`);
  }
  console.log(`  整卷 native ${s.exams_native} · mixed ${s.exams_mixed}`);
  if (a.dryRun) return;
  fs.mkdirSync(path.dirname(a.out), { recursive: true });
  fs.writeFileSync(a.out, JSON.stringify(man, null, 2) + "\n", "utf8");
  fs.mkdirSync(path.dirname(a.report), { recursive: true });
  fs.writeFileSync(a.report, renderReport(man), "utf8");
  console.log(`→ ${path.relative(process.cwd(), a.out)}\n→ ${path.relative(process.cwd(), a.report)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
