// computeDemand — pure, I/O-free demand calculator for the on-demand generation
// signal. Given a flat list of `sessions` rows (from Supabase) and a description
// of each live bank, it decides which banks are close to being exhausted and how
// many fresh items the nightly routine should produce for each.
//
// PRIVACY INVARIANT: the output NEVER contains user_code or any user identifier.
// user_code is used only in-memory to compute per-user consumption maxima, then
// discarded. The returned object is safe to commit to a public repo.
//
// This module is CommonJS (module.exports) so it can be both:
//   - required from scripts/compute-gen-demand.mjs (via createRequire), and
//   - imported from __tests__/gen-demand.test.js (next/jest handles interop).
//
// Design: the function is bank-shape-agnostic. The caller passes a `bankConfigs`
// object keyed by the routine's bank key. Each entry supplies the live id set +
// size + kind, so id extraction, intersection, and attribution all stay here and
// remain unit-testable without touching the filesystem or the network.

// ---- Tunables (all derived from the algorithm spec) ----
const WINDOW_DAYS = 7;
const T1_PCT = 0.7; // top user has consumed ≥70% of a bank
const T1_TARGET_PCT = 0.6; // generate enough to pull that user back to 60%
const RUNWAY_DAYS = 14; // T2: fewer than 14 days of runway left
const HARD_FLOOR = { text: 40, audio: 30 }; // T3: absolute minimum stock
const NIGHTLY_CAP = { text: 20, audio: 10 }; // max n per bank per night
const AUDIO_NIGHTLY_TOTAL = 25; // sum of all audio-bank n per night
const MIN_GENERATE = 4; // never ask for fewer than this once triggered
const BS_SWAP_DATE = "2026-06-16"; // BS bank was swapped here; only count sessions after

// Human-readable label per bank key for the routine_instructions lines. Each
// label embeds the verbatim bank key (the load-bearing token the routine maps on).
const BANK_LABELS = {
  bs: "bs sentence-building",
  discussion: "discussion writing",
  email: "email writing",
  "reading-ap": "reading-ap",
  ctw: "ctw reading",
  "rdl-short": "rdl-short reading",
  "rdl-long": "rdl-long reading",
  "listening-lat": "listening-lat",
  lc: "lc listening",
  la: "la listening",
  lcr: "lcr listening",
  "speaking-repeat": "speaking-repeat",
  interview: "interview speaking",
};

// ---- Helpers ----

function toTime(value) {
  // Returns epoch ms, or NaN when unparseable. Never throws.
  if (!value) return NaN;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function pushId(out, v) {
  if (typeof v === "string" && v.length > 0) out.push(v);
  else if (typeof v === "number") out.push(String(v));
}

// Extract the raw item/set ids referenced by a single session row. Attribution to
// a specific bank happens later, by intersecting these ids with each bank's id
// set — so a retired or personal-bank id simply never matches and drops out.
// BS sessions carry NO id (handled separately) → returns []. Any malformed row
// returns [] rather than throwing.
function extractSessionIds(session) {
  try {
    const type = session && session.type;
    const details = (session && session.details) || null;
    if (!type) return [];
    // Writing 3-task mock exam is written as type "mock" — never counted (v1).
    if (type === "mock") return [];
    if (type === "bs") return []; // BS handled via session counting, no ids
    if (!details || typeof details !== "object") return [];

    const out = [];
    const isMock = details.subtype === "mock";

    if (type === "reading" || type === "listening") {
      if (isMock) {
        // Adaptive reading/listening mock: ids live in the per-task snapshots of
        // both modules. The snapshot field is `itemId` (buildTaskSnapshots), with
        // `id` kept as a defensive fallback.
        for (const mod of [details.m1, details.m2]) {
          const tasks = mod && Array.isArray(mod.tasks) ? mod.tasks : [];
          for (const t of tasks) pushId(out, (t && (t.itemId ?? t.id)) || null);
        }
      } else if (type === "reading") {
        pushId(out, details.itemId); // reading practice: single item
      } else {
        // listening practice: details.itemIds is an array
        const ids = Array.isArray(details.itemIds) ? details.itemIds : [];
        for (const id of ids) pushId(out, id);
      }
    } else if (type === "speaking") {
      if (isMock) {
        // Speaking mock does NOT use m1/m2 tasks — it stores the two set ids
        // directly (SpeakingExamShell). Fall back to m1/m2 tasks defensively in
        // case a future shape adds them.
        pushId(out, details.repeatSetId);
        pushId(out, details.interviewSetId);
        for (const mod of [details.m1, details.m2]) {
          const tasks = mod && Array.isArray(mod.tasks) ? mod.tasks : [];
          for (const t of tasks) pushId(out, (t && (t.setId ?? t.itemId ?? t.id)) || null);
        }
      } else {
        pushId(out, details.setId); // speaking practice: single set
      }
    } else if (type === "email" || type === "discussion") {
      pushId(out, details.promptId);
    }
    // Unknown types → no ids.
    return out;
  } catch {
    return [];
  }
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

// |setA ∩ setB| — iterates the smaller set for speed. Tolerates a missing set.
function intersectCount(set, ids) {
  if (!set || set.size === 0 || !ids || ids.size === 0) return 0;
  let c = 0;
  if (set.size <= ids.size) {
    for (const id of set) if (ids.has(id)) c++;
  } else {
    for (const id of ids) if (set.has(id)) c++;
  }
  return c;
}

// ---- Main ----

/**
 * @param {Array} sessions  rows: { user_code, type, date, details }
 * @param {Object} bankConfigs  keyed by bank key. Each: {
 *     size:number, ids:Set<string>|Array<string>, kind:"text"|"audio",
 *     notInRoutine?:boolean, special?:"bs" }
 * @param {Object} [options]  { now?:Date|string, windowDays?:number }
 * @returns {Object} demand object (see docs/gen-demand.md); no user_code anywhere.
 */
function computeDemand(sessions, bankConfigs, options = {}) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const nowMs = toTime(options.now) || (options.now ? Date.now() : Date.now());
  const windowDays = options.windowDays || WINDOW_DAYS;
  const windowStart = nowMs - windowDays * 24 * 60 * 60 * 1000;
  const bsSwapMs = toTime(BS_SWAP_DATE);

  // Normalize bank id sets once.
  const banks = {};
  for (const [key, cfg] of Object.entries(bankConfigs || {})) {
    banks[key] = {
      key,
      size: Number(cfg.size) || 0,
      kind: cfg.kind === "audio" ? "audio" : "text",
      notInRoutine: !!cfg.notInRoutine,
      special: cfg.special || null,
      ids: cfg.ids instanceof Set ? cfg.ids : new Set(Array.isArray(cfg.ids) ? cfg.ids : []),
    };
  }

  // ---- Pass 1: scan sessions ----
  // Banks are NOT a shared pool — each user burns their own copy of the bank.
  // So besides the all-history per-user sets (consumption) we also track
  // per-user WINDOW sets (individual burn rate), which is what T2 runs on.
  // The global window aggregates are kept only for the informational burn_7d.
  const activeUsers = new Set();
  const perUserIds = new Map(); // user_code -> Set<string> (all-history ids)
  const perUserWindowIds = new Map(); // user_code -> Set<string> (in-window ids)
  const perUserBsCount = new Map(); // user_code -> count of post-swap bs sessions
  const perUserBsWindowCount = new Map(); // user_code -> in-window (post-swap) bs sessions
  const windowIds = new Set(); // global deduped ids consumed within the window
  let bsBurn = 0; // global bs sessions within the window

  for (const row of rows) {
    let user;
    try {
      user = row && row.user_code;
      const t = toTime(row && row.date);
      const inWindow = Number.isFinite(t) && t >= windowStart && t <= nowMs;
      if (inWindow && user) activeUsers.add(user);

      if (row && row.type === "bs") {
        // BS special case: no ids. Consumption ≈ session count since the swap.
        const postSwap = Number.isFinite(t) && Number.isFinite(bsSwapMs) && t >= bsSwapMs;
        if (postSwap && user) {
          perUserBsCount.set(user, (perUserBsCount.get(user) || 0) + 1);
          if (inWindow) {
            perUserBsWindowCount.set(user, (perUserBsWindowCount.get(user) || 0) + 1);
          }
        }
        if (inWindow) bsBurn += 1;
        continue;
      }

      const ids = extractSessionIds(row);
      if (ids.length === 0) continue;
      if (user) {
        let set = perUserIds.get(user);
        if (!set) { set = new Set(); perUserIds.set(user, set); }
        for (const id of ids) set.add(id);
        if (inWindow) {
          let wset = perUserWindowIds.get(user);
          if (!wset) { wset = new Set(); perUserWindowIds.set(user, wset); }
          for (const id of ids) wset.add(id);
        }
      }
      if (inWindow) for (const id of ids) windowIds.add(id);
    } catch {
      // Malformed row — skip silently, never throw.
      continue;
    }
  }

  // ---- Pass 2: per-bank metrics + triggers + n ----
  // T2 runs on PER-USER runway: banks are not a shared pool (A doing an item
  // does not stop B from doing it), so "days until someone刷穿" must compare a
  // user's own remaining items against that same user's own burn rate — never
  // the site-wide aggregate.
  const banksOut = {};
  for (const bank of Object.values(banks)) {
    const size = bank.size;
    const floor = HARD_FLOOR[bank.kind];
    let topConsumed = 0;
    let burn7d = 0; // informational only (global window dedup) — NOT used by T2
    let minRunway = Infinity; // min over active users of runway_u (days)
    let t2Need = 0; // max over T2-triggering users of their 14-day shortfall

    for (const u of activeUsers) {
      let consumedU = 0;
      let burnU = 0;
      if (bank.special === "bs") {
        consumedU = perUserBsCount.get(u) || 0;
        burnU = perUserBsWindowCount.get(u) || 0;
      } else {
        consumedU = intersectCount(perUserIds.get(u), bank.ids);
        burnU = intersectCount(perUserWindowIds.get(u), bank.ids);
      }
      if (consumedU > topConsumed) topConsumed = consumedU;
      if (burnU > 0) {
        // BS consumption is a session-count approximation, so clamp remaining
        // at 0 (id-based banks can't exceed size — intersection bounds them).
        const remainingU = Math.max(0, size - consumedU);
        const dailyBurnU = burnU / windowDays;
        const runwayU = remainingU / dailyBurnU;
        if (runwayU < minRunway) minRunway = runwayU;
        if (runwayU < RUNWAY_DAYS) {
          const need = Math.ceil(dailyBurnU * RUNWAY_DAYS - remainingU);
          if (need > t2Need) t2Need = need;
        }
      }
    }

    if (bank.special === "bs") {
      burn7d = bsBurn;
    } else {
      for (const id of windowIds) if (bank.ids.has(id)) burn7d++;
    }

    const topPct = size > 0 ? topConsumed / size : (topConsumed > 0 ? 1 : 0);

    const triggers = [];
    if (topPct >= T1_PCT) triggers.push("T1");
    if (minRunway < RUNWAY_DAYS) triggers.push("T2");
    if (size < floor) triggers.push("T3");

    // Suggested production n = max of the applicable trigger terms, clamped.
    let nRaw = 0;
    if (triggers.includes("T1")) {
      nRaw = Math.max(nRaw, Math.ceil(topConsumed / T1_TARGET_PCT) - size);
    }
    if (triggers.includes("T2")) {
      nRaw = Math.max(nRaw, t2Need);
    }
    if (triggers.includes("T3")) {
      nRaw = Math.max(nRaw, floor + 10 - size);
    }

    const generate = triggers.length > 0;
    const cap = NIGHTLY_CAP[bank.kind];
    const n = generate ? Math.min(cap, Math.max(MIN_GENERATE, nRaw)) : 0;

    const out = {
      bank_size: size,
      top_user_consumed: topConsumed,
      top_user_pct: round3(topPct),
      burn_7d: burn7d,
      // Observability: the tightest individual runway (days) across active
      // users; null when no active user consumed this bank in the window.
      min_user_runway_days: minRunway === Infinity ? null : Math.round(minRunway * 10) / 10,
      triggers,
      generate,
      n,
      reason: buildReason(bank.key, { size, topConsumed, topPct, minRunway, floor, triggers, n, generate }),
      // Transient fields for the audio-budget severity sort; deleted below.
      // Use a large finite fallback (not Infinity) so the sort comparator
      // never produces NaN (Infinity - Infinity) when several banks have no
      // in-window consumption.
      _runway: minRunway === Infinity ? Number.MAX_SAFE_INTEGER : minRunway,
      _kind: bank.kind,
      _topPct: topPct,
    };
    if (bank.notInRoutine) out.not_in_routine = true;
    banksOut[bank.key] = out;
  }

  // ---- Audio nightly total budget (≤25) ----
  // If the sum of n across generating audio banks exceeds the budget, keep the
  // most severe (top_user_pct desc, then remaining runway asc) and trim the rest.
  const audioGenerating = Object.values(banksOut)
    .filter((b) => b._kind === "audio" && b.generate)
    .sort((a, b) => (b._topPct - a._topPct) || (a._runway - b._runway));

  let budget = AUDIO_NIGHTLY_TOTAL;
  for (const b of audioGenerating) {
    if (budget >= b.n) {
      budget -= b.n; // keep full allocation
    } else if (budget >= MIN_GENERATE) {
      b.n = budget; // partial: give whatever budget remains (still ≥ MIN_GENERATE)
      b.reason += `（受当晚音频配额 ${AUDIO_NIGHTLY_TOTAL} 限制，本晚裁剪至 ${b.n} 题）`;
      budget = 0;
    } else {
      // No room left tonight — defer this less-severe bank to the next night.
      b.generate = false;
      b.n = 0;
      b.reason += `（当晚音频配额 ${AUDIO_NIGHTLY_TOTAL} 已被更紧张的库占满，本库顺延到明晚）`;
    }
  }

  // ---- routine_instructions: generating, in-routine banks only ----
  const routineInstructions = [];
  for (const [key, b] of Object.entries(banksOut)) {
    if (b.generate && !b.not_in_routine) {
      const label = BANK_LABELS[key] || key;
      routineInstructions.push(`Generate ${b.n} ${label} items`);
    }
  }

  // Strip the private/transient helper fields before returning.
  for (const b of Object.values(banksOut)) {
    delete b._runway;
    delete b._kind;
    delete b._topPct;
  }

  return {
    generated_at: new Date(nowMs).toISOString(),
    window_days: windowDays,
    active_users: activeUsers.size,
    banks: banksOut,
    routine_instructions: routineInstructions,
  };
}

function buildReason(key, m) {
  if (!m.generate) {
    return "库存充足，当晚无需补题。";
  }
  const parts = [];
  if (m.triggers.includes("T1")) {
    parts.push(`头号活跃用户已做 ${m.topConsumed}/${m.size} 题（${Math.round(m.topPct * 100)}%），逼近刷穿`);
  }
  if (m.triggers.includes("T2")) {
    const days = Number.isFinite(m.minRunway) ? Math.round(m.minRunway) : 999;
    parts.push(`最快用户按其近7天速度仅剩约 ${days} 天刷穿（低于 ${RUNWAY_DAYS} 天）`);
  }
  if (m.triggers.includes("T3")) {
    parts.push(`库存 ${m.size} 低于红线 ${m.floor}`);
  }
  return `${parts.join("；")}，建议补 ${m.n} 题。`;
}

module.exports = { computeDemand, extractSessionIds, BANK_LABELS };
