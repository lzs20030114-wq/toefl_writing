/**
 * Circuit breaker system for the BS generation pipeline.
 * Blocks answer types with low acceptance rates over a rolling window,
 * preventing the generator from wasting rounds on persistently failing types.
 */

const { readFileSync, writeFileSync } = require("fs");

// Defaults — can be overridden via init()
let CIRCUIT_BREAKER_WINDOW = 3;
let CIRCUIT_BREAKER_MIN_GENERATED = 4;
let CIRCUIT_BREAKER_MIN_ACCEPT_RATE = 0.2;
let CIRCUIT_BREAKER_COOLDOWN_ROUNDS = 3;
let CIRCUIT_BREAKER_EXEMPT_TYPES = new Set(["interrogative"]);
let CIRCUIT_BREAKER_LOG_PATH = "";
let TYPE_LIST = [];

/**
 * Initialize module-level config. Call once at startup.
 */
function init(config) {
  if (config.window != null) CIRCUIT_BREAKER_WINDOW = config.window;
  if (config.minGenerated != null) CIRCUIT_BREAKER_MIN_GENERATED = config.minGenerated;
  if (config.minAcceptRate != null) CIRCUIT_BREAKER_MIN_ACCEPT_RATE = config.minAcceptRate;
  if (config.cooldownRounds != null) CIRCUIT_BREAKER_COOLDOWN_ROUNDS = config.cooldownRounds;
  if (config.exemptTypes) CIRCUIT_BREAKER_EXEMPT_TYPES = config.exemptTypes;
  if (config.logPath) CIRCUIT_BREAKER_LOG_PATH = config.logPath;
  if (config.typeList) TYPE_LIST = config.typeList;
}

function createCircuitBreakerState() {
  return {
    history: [],
    active: {},
    events: [],
  };
}

function aggregateTypeStats(entries, type) {
  return (entries || []).reduce((acc, entry) => {
    const stats = entry?.typeStats?.[type] || { generated: 0, accepted: 0, rejected: 0, reasons: {} };
    acc.generated += stats.generated || 0;
    acc.accepted += stats.accepted || 0;
    acc.rejected += stats.rejected || 0;
    Object.entries(stats.reasons || {}).forEach(([reason, count]) => {
      acc.reasons[reason] = (acc.reasons[reason] || 0) + count;
    });
    return acc;
  }, { generated: 0, accepted: 0, rejected: 0, reasons: {} });
}

function getActiveCircuitBreakerTypes(state, round) {
  return new Set(
    Object.entries(state?.active || {})
      .filter(([, info]) => info && info.untilRound >= round)
      .map(([type]) => type),
  );
}

function applyCircuitBreakersToSpec(spec, blockedTypes, poolState, globalTypeTargets, chooseGapWeightedType) {
  const blocked = blockedTypes || new Set();
  if (!Array.isArray(spec) || blocked.size === 0) return spec;

  const fallbackTypesForDifficulty = (diff) => {
    const base = diff === "easy"
      ? ["3rd-reporting", "1st-embedded", "negation"]
      : diff === "hard"
      ? ["3rd-reporting", "1st-embedded", "relative", "negation", "direct"]
      : ["3rd-reporting", "1st-embedded", "negation", "relative", "direct", "interrogative"];
    return base.filter((type) => !blocked.has(type));
  };

  const rewritten = spec.map((cell) => ({ ...cell }));
  for (const cell of rewritten) {
    if (!blocked.has(cell.type)) continue;
    const fallback = chooseGapWeightedType(
      poolState,
      globalTypeTargets,
      fallbackTypesForDifficulty(cell.difficulty),
      "3rd-reporting",
    );
    cell.type = fallback;
  }
  return rewritten.reduce((acc, cell) => {
    const existing = acc.find((x) => x.type === cell.type && x.difficulty === cell.difficulty);
    if (existing) existing.count += cell.count;
    else acc.push(cell);
    return acc;
  }, []);
}

function updateCircuitBreakers(state, round, mode, spec, result) {
  if (!state || mode !== "normal" || !result?.typeStats) return;
  const totalGenerated = Object.values(result.typeStats || {}).reduce((sum, stats) => sum + (stats?.generated || 0), 0);
  if (round <= 3 || totalGenerated <= 0) return;
  state.history.push({
    round,
    mode,
    spec: Array.isArray(spec) ? spec.map((x) => ({ ...x })) : [],
    typeStats: result.typeStats,
  });
  state.history = state.history.slice(-Math.max(CIRCUIT_BREAKER_WINDOW, 6));

  const recent = state.history.slice(-CIRCUIT_BREAKER_WINDOW);
  for (const type of TYPE_LIST) {
    const aggregate = aggregateTypeStats(recent, type);
    const acceptRate = aggregate.generated > 0 ? aggregate.accepted / aggregate.generated : 1;
    const currentlyActive = state.active[type] && state.active[type].untilRound >= round;
    if (
      aggregate.generated >= CIRCUIT_BREAKER_MIN_GENERATED &&
      acceptRate <= CIRCUIT_BREAKER_MIN_ACCEPT_RATE &&
      !currentlyActive &&
      !CIRCUIT_BREAKER_EXEMPT_TYPES.has(type)
    ) {
      const reasons = Object.entries(aggregate.reasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      const event = {
        triggeredAt: new Date().toISOString(),
        round,
        mode,
        type,
        generated: aggregate.generated,
        accepted: aggregate.accepted,
        rejected: aggregate.rejected,
        acceptRate: Number(acceptRate.toFixed(3)),
        reasons,
        recentRounds: recent.map((entry) => ({
          round: entry.round,
          spec: entry.spec,
          stats: entry.typeStats[type] || null,
        })),
        blockedUntilRound: round + CIRCUIT_BREAKER_COOLDOWN_ROUNDS,
      };
      state.active[type] = {
        sinceRound: round,
        untilRound: round + CIRCUIT_BREAKER_COOLDOWN_ROUNDS,
        lastEvent: event,
      };
      state.events.push(event);
      console.warn(
        `[circuit-breaker] round ${round} type=${type} acceptRate=${event.acceptRate} blockedUntil=${event.blockedUntilRound}`,
      );
    }
  }

  for (const [type, info] of Object.entries(state.active)) {
    if (info && info.untilRound < round) delete state.active[type];
  }
}

function flushCircuitBreakerLog(state) {
  if (!state || !CIRCUIT_BREAKER_LOG_PATH) return;
  let priorEvents = [];
  try {
    const existing = JSON.parse(readFileSync(CIRCUIT_BREAKER_LOG_PATH, "utf8"));
    priorEvents = Array.isArray(existing.all_events) ? existing.all_events : (Array.isArray(existing.events) ? existing.events : []);
  } catch (_) { /* first run or corrupt file */ }
  const seen = new Set(priorEvents.map(e => `${e.triggeredAt}|${e.type}`));
  const newEvents = (state.events || []).filter(e => !seen.has(`${e.triggeredAt}|${e.type}`));
  const allEvents = [...priorEvents, ...newEvents];
  const payload = {
    generated_at: new Date().toISOString(),
    active: state.active,
    events: state.events,
    history: state.history,
    all_events: allEvents,
  };
  writeFileSync(CIRCUIT_BREAKER_LOG_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

module.exports = {
  init,
  createCircuitBreakerState,
  getActiveCircuitBreakerTypes,
  applyCircuitBreakersToSpec,
  updateCircuitBreakers,
  flushCircuitBreakerLog,
};
