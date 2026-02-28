import { getProductById, listActiveProducts } from "./catalog";
import { IapError } from "./errors";
import { assertIapEnabled } from "./featureGate";
import { getIapProvider } from "./providers";
import { grantEntitlement, listEntitlementsByUser, markWebhookEventProcessed } from "./repository";

function normalizeUserCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code || code.length < 4) {
    throw new IapError("IAP_INVALID_USER_CODE", "Valid userCode is required", 400);
  }
  return code;
}

function normalizeCheckoutInput(body) {
  const userCode = normalizeUserCode(body?.userCode);
  const productId = String(body?.productId || "").trim();
  if (!productId) throw new IapError("IAP_INVALID_PRODUCT", "productId is required", 400);
  const successUrl = String(body?.successUrl || "").trim();
  const cancelUrl = String(body?.cancelUrl || "").trim();

  return {
    userCode,
    productId,
    successUrl,
    cancelUrl,
    metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : {},
  };
}

async function processCompletedCheckout({ userCode, productId, provider, providerRef, metadata }) {
  const existing = await listEntitlementsByUser(userCode);
  const alreadyActive = existing.find((e) => e.productId === productId && e.status === "active");
  if (alreadyActive) return { granted: false, entitlement: alreadyActive };

  const entitlement = await grantEntitlement({
    userCode,
    productId,
    provider,
    providerRef,
    metadata,
  });
  return { granted: true, entitlement };
}

export async function listProducts() {
  assertIapEnabled();
  return listActiveProducts();
}

export async function createCheckoutSession(body) {
  assertIapEnabled();
  const input = normalizeCheckoutInput(body);
  const product = getProductById(input.productId);
  const provider = getIapProvider();
  return provider.createCheckoutSession({
    ...input,
    product,
  });
}

export async function handleWebhook({ headers, rawBody }) {
  assertIapEnabled();
  const provider = getIapProvider();
  provider.verifyWebhook({ headers, rawBody });
  const event = provider.parseWebhookEvent(rawBody);

  const accepted = await markWebhookEventProcessed(event.provider, event.eventId);
  if (!accepted) {
    return { ok: true, duplicate: true, eventId: event.eventId };
  }

  if (event.eventType === "checkout.completed") {
    const userCode = normalizeUserCode(event.payload?.userCode);
    const productId = String(event.payload?.productId || "").trim();
    if (!productId) throw new IapError("IAP_INVALID_WEBHOOK_PAYLOAD", "Missing productId", 400);
    getProductById(productId);
    const result = await processCompletedCheckout({
      userCode,
      productId,
      provider: event.provider,
      providerRef: String(event.payload?.providerRef || event.eventId),
      metadata: {
        source: "webhook",
        purchasedAt: event.payload?.purchasedAt || new Date().toISOString(),
      },
    });
    return { ok: true, duplicate: false, eventId: event.eventId, eventType: event.eventType, ...result };
  }

  return { ok: true, duplicate: false, eventId: event.eventId, eventType: event.eventType, ignored: true };
}

export async function getUserEntitlements(userCode) {
  assertIapEnabled();
  const code = normalizeUserCode(userCode);
  return listEntitlementsByUser(code);
}

