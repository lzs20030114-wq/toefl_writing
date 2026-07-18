const PLAN_ALLOWANCES = Object.freeze([
  { id: "pro_weekly", priceCents: 1990, currency: "CNY", durationDays: 7, pointsPerPeriod: 30, periodDays: 7 },
  { id: "pro_monthly", priceCents: 5990, currency: "CNY", durationDays: 30, pointsPerPeriod: 100, periodDays: 30 },
  { id: "pro_quarterly", priceCents: 14990, currency: "CNY", durationDays: 90, pointsPerPeriod: 100, periodDays: 30 },
  { id: "pro_yearly", priceCents: 49990, currency: "CNY", durationDays: 365, pointsPerPeriod: 100, periodDays: 30 },
]);

const TOP_UP_PACKS = Object.freeze([
  { id: "credits_50", points: 50, priceCents: 990, currency: "CNY", expires: false },
  { id: "credits_150", points: 150, priceCents: 2490, currency: "CNY", expires: false },
  { id: "credits_400", points: 400, priceCents: 5990, currency: "CNY", expires: false },
]);

const ACTIONS = Object.freeze({
  public_listening: { points: 0, unit: "request", status: "ready" },
  ai_grading: { points: 1, unit: "request", status: "ready" },
  speech_transcription: { points: 1, unit: "started_30_seconds", status: "ready" },
  user_bank_openai_tts: { points: 1, unit: "started_30_seconds", status: "planned" },
});

function positiveInt(value, fallback = 1) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Credit usage count must be a positive integer");
  return n;
}

export function listCreditPlans() {
  return PLAN_ALLOWANCES.map((plan) => ({ ...plan }));
}

export function getCreditPlan(planId) {
  return listCreditPlans().find((plan) => plan.id === String(planId || "")) || null;
}

export function listCreditTopUps() {
  return TOP_UP_PACKS.map((pack) => ({ ...pack }));
}

export function getCreditTopUp(packId) {
  return listCreditTopUps().find((pack) => pack.id === String(packId || "")) || null;
}

export function listCreditActions() {
  return Object.fromEntries(Object.entries(ACTIONS).map(([key, value]) => [key, { ...value }]));
}

export function quoteCreditCost(action, usage = {}) {
  const key = String(action || "").trim();
  const rule = ACTIONS[key];
  if (!rule) throw new Error(`Unknown credit action: ${key || "(empty)"}`);

  let units;
  if (rule.unit === "started_30_seconds") {
    const seconds = Number(usage.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`${key}: positive seconds are required`);
    units = Math.ceil(seconds / 30);
  } else {
    units = positiveInt(usage.count, 1);
  }

  return {
    action: key,
    status: rule.status,
    units,
    pointsPerUnit: rule.points,
    points: units * rule.points,
  };
}
