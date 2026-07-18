import {
  isCreditsEnabledServer,
  isCreditsEnforcementEnabledServer,
} from "../featureFlags";
import { quoteCreditCost } from "./catalog";
import { CreditError, normalizeUserCode } from "./errors";
import { creditRepository } from "./repository";

function requiredText(value, field) {
  const text = String(value || "").trim();
  if (!text) throw new CreditError("CREDITS_INVALID_INPUT", `${field} is required`, 400);
  return text;
}

function requiredPoints(value) {
  const points = Number(value);
  if (!Number.isInteger(points) || points <= 0 || points > 100000) {
    throw new CreditError("CREDITS_INVALID_POINTS", "Points must be an integer between 1 and 100000", 400);
  }
  return points;
}

export function createCreditService(repository = creditRepository) {
  return {
    preview(action, usage = {}) {
      const quote = quoteCreditCost(action, usage);
      return {
        enabled: isCreditsEnabledServer(),
        enforcementEnabled: isCreditsEnforcementEnabledServer(),
        ...quote,
      };
    },

    async getBalance(userCode) {
      if (!isCreditsEnabledServer()) {
        return { enabled: false, enforcementEnabled: false, wallet: null };
      }
      const wallet = await repository.getWallet(normalizeUserCode(userCode));
      return {
        enabled: true,
        enforcementEnabled: isCreditsEnforcementEnabledServer(),
        wallet,
      };
    },

    async charge({ userCode, action, usage = {}, idempotencyKey, metadata = {} }) {
      const quote = quoteCreditCost(action, usage);
      if (!isCreditsEnabledServer() || !isCreditsEnforcementEnabledServer() || quote.points === 0) {
        return {
          enabled: isCreditsEnabledServer(),
          enforcementEnabled: isCreditsEnforcementEnabledServer(),
          charged: false,
          bypassed: true,
          ...quote,
        };
      }
      if (quote.status !== "ready") {
        throw new CreditError("CREDITS_ACTION_NOT_READY", `Credit action is not ready: ${quote.action}`, 409);
      }
      const result = await repository.consume({
        userCode: normalizeUserCode(userCode),
        points: quote.points,
        action: quote.action,
        idempotencyKey: requiredText(idempotencyKey, "idempotencyKey"),
        metadata,
      });
      return { enabled: true, enforcementEnabled: true, charged: result?.allowed === true, ...quote, result };
    },

    async refreshSubscription(input) {
      if (!isCreditsEnabledServer()) throw new CreditError("CREDITS_DISABLED", "Credits are disabled", 503);
      return repository.refreshSubscription({
        userCode: normalizeUserCode(input.userCode),
        points: requiredPoints(input.points),
        periodStart: requiredText(input.periodStart, "periodStart"),
        periodEnd: requiredText(input.periodEnd, "periodEnd"),
        idempotencyKey: requiredText(input.idempotencyKey, "idempotencyKey"),
        metadata: input.metadata || {},
      });
    },

    async grantPurchased(input) {
      if (!isCreditsEnabledServer()) throw new CreditError("CREDITS_DISABLED", "Credits are disabled", 503);
      return repository.grantPurchased({
        userCode: normalizeUserCode(input.userCode),
        points: requiredPoints(input.points),
        action: requiredText(input.action || "top_up_purchase", "action"),
        idempotencyKey: requiredText(input.idempotencyKey, "idempotencyKey"),
        metadata: input.metadata || {},
      });
    },

    async refund(input) {
      if (!isCreditsEnabledServer()) throw new CreditError("CREDITS_DISABLED", "Credits are disabled", 503);
      return repository.refund({
        userCode: normalizeUserCode(input.userCode),
        originalIdempotencyKey: requiredText(input.originalIdempotencyKey, "originalIdempotencyKey"),
        idempotencyKey: requiredText(input.idempotencyKey, "idempotencyKey"),
        metadata: input.metadata || {},
      });
    },
  };
}

export const creditService = createCreditService();
