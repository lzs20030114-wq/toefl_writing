/**
 * @jest-environment node
 */

import {
  getCreditPlan,
  getCreditTopUp,
  listCreditActions,
  quoteCreditCost,
} from "../lib/credits/catalog";

describe("credit catalog", () => {
  test("keeps the staged plan prices separate from the live IAP catalog", () => {
    expect(getCreditPlan("pro_weekly")).toMatchObject({ priceCents: 1990, pointsPerPeriod: 30 });
    expect(getCreditPlan("pro_monthly")).toMatchObject({ priceCents: 5990, pointsPerPeriod: 100 });
    expect(getCreditPlan("pro_quarterly")).toMatchObject({ priceCents: 14990, pointsPerPeriod: 100 });
    expect(getCreditPlan("pro_yearly")).toMatchObject({ priceCents: 49990, pointsPerPeriod: 100 });
  });

  test("defines non-expiring top-up packs", () => {
    expect(getCreditTopUp("credits_50")).toMatchObject({ points: 50, priceCents: 990, expires: false });
    expect(getCreditTopUp("credits_150")).toMatchObject({ points: 150, priceCents: 2490, expires: false });
    expect(getCreditTopUp("credits_400")).toMatchObject({ points: 400, priceCents: 5990, expires: false });
  });

  test("quotes public listening at zero points", () => {
    expect(quoteCreditCost("public_listening")).toMatchObject({ points: 0, units: 1 });
  });

  test("rejects explicitly invalid request counts instead of charging one", () => {
    expect(() => quoteCreditCost("ai_grading", { count: 0 })).toThrow(/positive integer/i);
    expect(() => quoteCreditCost("ai_grading", { count: -1 })).toThrow(/positive integer/i);
    expect(() => quoteCreditCost("ai_grading", { count: 1.5 })).toThrow(/positive integer/i);
    expect(quoteCreditCost("ai_grading")).toMatchObject({ points: 1, units: 1 });
  });

  test("rounds speech up by each started 30 seconds", () => {
    expect(quoteCreditCost("speech_transcription", { seconds: 1 }).points).toBe(1);
    expect(quoteCreditCost("speech_transcription", { seconds: 30 }).points).toBe(1);
    expect(quoteCreditCost("speech_transcription", { seconds: 31 }).points).toBe(2);
  });

  test("marks paid personal-bank TTS as planned, not active", () => {
    expect(listCreditActions().user_bank_openai_tts.status).toBe("planned");
  });
});
