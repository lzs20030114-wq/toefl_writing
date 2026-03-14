import { getProductById, listActiveProducts } from "./catalog";
import { IapError } from "./errors";
import { assertIapEnabled } from "./featureGate";
import { getIapProvider } from "./providers";
import { grantEntitlement, listEntitlementsByUser, markWebhookEventProcessed } from "./repository";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../supabaseAdmin";

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

/**
 * Upgrade user tier to 'pro' in the users table.
 * Supports stacking: if current tier_expires_at is in the future, extend from there.
 */
async function upgradeTierAfterPurchase(userCode, days) {
  if (!isSupabaseAdminConfigured) {
    console.warn("[iap] Supabase not configured — skipping tier upgrade for", userCode);
    return;
  }

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("tier, tier_expires_at")
    .eq("code", userCode)
    .single();

  if (!user) {
    console.error("[iap] User not found for tier upgrade:", userCode);
    return;
  }

  // Stack: if current expiry is in the future, extend from there
  const now = new Date();
  let baseDate = now;
  if (user.tier === "pro" && user.tier_expires_at) {
    const currentExpiry = new Date(user.tier_expires_at);
    if (currentExpiry > now) baseDate = currentExpiry;
  }

  const expiresAt = new Date(baseDate);
  expiresAt.setDate(expiresAt.getDate() + (days || 30));

  const { error } = await supabaseAdmin
    .from("users")
    .update({ tier: "pro", tier_expires_at: expiresAt.toISOString() })
    .eq("code", userCode);

  if (error) {
    console.error("[iap] Failed to upgrade tier:", error.message);
  } else {
    console.log(`[iap] Upgraded ${userCode} to pro until ${expiresAt.toISOString()}`);
  }
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

  // Bridge: also upgrade the user's tier in the users table
  const days = metadata?.days || (productId.includes("yearly") ? 365 : productId.includes("quarterly") ? 90 : productId.includes("weekly") ? 7 : 30);
  await upgradeTierAfterPurchase(userCode, days);

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
    const rawCode = event.payload?.userCode;
    if (!rawCode) {
      // No user code found (e.g. Afdian remark didn't contain a valid code)
      console.error(`[iap] No userCode in webhook event ${event.eventId}. Remark: "${event.payload?.remark || ""}"`);
      return { ok: true, duplicate: false, eventId: event.eventId, eventType: event.eventType, error: "no_user_code" };
    }
    const userCode = normalizeUserCode(rawCode);
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
        month: event.payload?.month,
        days: event.payload?.days,
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

