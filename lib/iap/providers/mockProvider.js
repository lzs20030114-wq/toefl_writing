import { createHash, randomUUID } from "crypto";
import { IapError } from "../errors";

function sign(payload, secret) {
  return createHash("sha256")
    .update(String(secret || ""))
    .update(":")
    .update(payload)
    .digest("hex");
}

function assertMockSecret() {
  const secret = String(process.env.IAP_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    throw new IapError("IAP_WEBHOOK_SECRET_MISSING", "Missing IAP_WEBHOOK_SECRET", 500);
  }
  return secret;
}

export const mockProvider = {
  name: "mock",

  async createCheckoutSession({ userCode, product, successUrl, cancelUrl, metadata }) {
    const checkoutId = randomUUID();
    return {
      provider: "mock",
      checkoutId,
      checkoutUrl: `${String(successUrl || "").trim() || "/iap"}?mock_checkout=1&checkout_id=${encodeURIComponent(checkoutId)}`,
      cancelUrl: String(cancelUrl || "").trim() || "/iap",
      productId: product.id,
      amountCents: product.priceCents,
      currency: product.currency,
      metadata: {
        userCode,
        ...metadata,
      },
    };
  },

  verifyWebhook({ headers, rawBody }) {
    const secret = assertMockSecret();
    const signature = String(headers.get("x-iap-signature") || "").trim();
    if (!signature) throw new IapError("IAP_INVALID_WEBHOOK_SIGNATURE", "Missing webhook signature", 401);

    const expected = sign(rawBody, secret);
    if (signature !== expected) {
      throw new IapError("IAP_INVALID_WEBHOOK_SIGNATURE", "Invalid webhook signature", 401);
    }
  },

  parseWebhookEvent(rawBody) {
    let data = null;
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new IapError("IAP_INVALID_WEBHOOK_PAYLOAD", "Webhook payload is not valid JSON", 400);
    }

    const eventId = String(data?.id || "").trim() || randomUUID();
    const eventType = String(data?.type || "").trim();
    const payload = data?.data || {};
    if (!eventType) throw new IapError("IAP_INVALID_WEBHOOK_PAYLOAD", "Webhook event type is required", 400);

    return { provider: "mock", eventId, eventType, payload };
  },
};

export function buildMockWebhookPayload({
  userCode,
  productId,
  providerRef = randomUUID(),
  eventType = "checkout.completed",
}) {
  return JSON.stringify({
    id: randomUUID(),
    type: eventType,
    data: {
      userCode: String(userCode || "").trim().toUpperCase(),
      productId: String(productId || "").trim(),
      providerRef,
      purchasedAt: new Date().toISOString(),
    },
  });
}

export function signMockWebhookPayload(payload) {
  const secret = assertMockSecret();
  return sign(payload, secret);
}

