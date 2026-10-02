export const REAL_MOCK_SOURCE = "real-bank";
export const REAL_MOCK_TEMPLATE_VERSION = "2026-full-v1";

const CONFIG = {
  reading: { module1Seconds: 1260, module2Seconds: { upper: 540, lower: 540 }, routeThreshold: 0.6 },
  listening: { module1Seconds: 1080, module2Seconds: { upper: 660, lower: 420 }, routeThreshold: 0.6 },
  writing: { module1Seconds: 1380, module2Seconds: { upper: 0, lower: 0 }, routeThreshold: 0.6, taskSeconds: { bs: 360, email: 420, discussion: 600 } },
  speaking: { module1Seconds: 480, module2Seconds: { upper: 0, lower: 0 }, routeThreshold: 0.6 },
};

export function getRealMockConfig(section) {
  return CONFIG[section] ? { ...CONFIG[section], module2Seconds: { ...CONFIG[section].module2Seconds } } : null;
}

export function getRealMockCheckpointKey(section, userCode) {
  return `real-mock:${REAL_MOCK_TEMPLATE_VERSION}:${String(section || "").toLowerCase()}:${String(userCode || "guest").toUpperCase()}`;
}
