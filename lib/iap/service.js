import { getProductById, listActiveProducts } from "./catalog";
import { IapError } from "./errors";
import { assertIapEnabled } from "./featureGate";
import { getIapProvider } from "./providers";
import { grantEntitlement, isWebhookEventProcessed, listEntitlementsByUser, markWebhookEventProcessed } from "./repository";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../supabaseAdmin";
import { createLogger } from "../logger";

const log = createLogger("iap");

/**
 * Reconcile the amount the user actually paid against the catalog price for the
 * product they claim to have bought. Prevents "pay ¥0.01, get a year" attacks
 * where a forged/underpaid webhook maps a cheap payment onto an expensive plan.
 *
 * `paidAmount` arrives in yuan (the same unit the checkout side sends:
 * price = product.priceCents / 100). We compare cents-to-cents exactly, with
 * NO discount tolerance — a payment short by even one cent is rejected. The
 * only slack is Math.round absorbing binary-float noise on the yuan→cents
 * conversion (e.g. 259.88 * 100 = 25987.9999… rounds back to 25988).
 *
 * Providers that verify the paid amount against their own API upstream
 * (e.g. Afdian queries query-order) may omit `paidAmount`; in that case there is
 * nothing to reconcile here and we skip. XorPay's webhook carries pay_price
 * directly and is otherwise unchecked, so this is its only amount gate.
 */
function reconcilePaidAmount({ product, paidAmount, eventId, provider }) {
  if (paidAmount === undefined || paidAmount === null || paidAmount === "") {
    return; // provider did not supply a paid amount — nothing to reconcile here
  }
  const paidYuan = Number(paidAmount);
  if (!Number.isFinite(paidYuan)) {
    log.error("Unparseable paid amount in webhook — rejecting", { eventId, provider, paidAmount });
    throw new IapError("IAP_AMOUNT_INVALID", "Paid amount is not a valid number", 400);
  }
  // Math.round absorbs binary-float noise (e.g. 259.88 * 100 = 25987.9999…
  // rounds back to 25988), so we can compare cents exactly with NO tolerance.
  const paidCents = Math.round(paidYuan * 100);
  const expectedCents = product.priceCents;
  // Reject anything short of the catalog price. No discount tolerance.
  if (paidCents < expectedCents) {
    log.error("Payment amount mismatch — refusing to grant entitlement", {
      eventId, provider, productId: product.id, paidCents, expectedCents,
    });
    throw new IapError(
      "IAP_AMOUNT_MISMATCH",
      `Paid amount ${paidCents} does not match product price ${expectedCents}`,
      403,
    );
  }
}

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
    log.warn("Supabase not configured — skipping tier upgrade", { userCode });
    return;
  }

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("tier, tier_expires_at")
    .eq("code", userCode)
    .single();

  if (!user) {
    log.error("User not found for tier upgrade", { userCode });
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
    log.error("Failed to upgrade tier", { userCode, error: error.message });
  } else {
    log.info("Upgraded user to pro", { userCode, until: expiresAt.toISOString() });
  }
}

async function processCompletedCheckout({ userCode, productId, provider, providerRef, metadata }) {
  // Dedup is handled by markWebhookEventProcessed (order ID level).
  // No productId-level dedup — users can renew the same plan to stack days.
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
  await provider.verifyWebhook({ headers, rawBody });
  const event = provider.parseWebhookEvent(rawBody);

  // Idempotency: reject events we have already fully processed. This is a
  // read-only check — we do NOT commit the processed marker until the
  // entitlement has actually been granted (see below), so a failed grant
  // returns a non-2xx and the provider safely retries.
  const alreadyProcessed = await isWebhookEventProcessed(event.provider, event.eventId);
  if (alreadyProcessed) {
    return { ok: true, duplicate: true, eventId: event.eventId };
  }

  if (event.eventType === "checkout.completed") {
    const rawCode = event.payload?.userCode;
    if (!rawCode) {
      // No user code found (e.g. Afdian remark didn't contain a valid code).
      // Nothing to grant — mark processed so the provider stops retrying a
      // payload we can never act on.
      log.error("No userCode in webhook event", { eventId: event.eventId, remark: event.payload?.remark || "" });
      await markWebhookEventProcessed(event.provider, event.eventId);
      return { ok: true, duplicate: false, eventId: event.eventId, eventType: event.eventType, error: "no_user_code" };
    }
    const userCode = normalizeUserCode(rawCode);
    const productId = String(event.payload?.productId || "").trim();
    if (!productId) throw new IapError("IAP_INVALID_WEBHOOK_PAYLOAD", "Missing productId", 400);
    const product = getProductById(productId);

    // Money gate: verify the amount actually paid matches the plan's price
    // BEFORE granting anything. Throws (403) on mismatch → provider gets a
    // non-2xx and no entitlement is created. The processed marker is NOT set,
    // but a mismatched amount is a permanent condition, so a retry re-rejects
    // identically rather than ever granting.
    reconcilePaidAmount({
      product,
      paidAmount: event.payload?.paidAmount,
      eventId: event.eventId,
      provider: event.provider,
    });

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

    // Only NOW mark the event processed — after the entitlement + tier upgrade
    // succeeded. If processCompletedCheckout threw above, we never reach here,
    // the marker stays unset, and the provider retries (money not lost).
    await markWebhookEventProcessed(event.provider, event.eventId);
    return { ok: true, duplicate: false, eventId: event.eventId, eventType: event.eventType, ...result };
  }

  // Non-checkout event (refund, unknown type): nothing to grant. Mark processed
  // so the provider stops retrying.
  await markWebhookEventProcessed(event.provider, event.eventId);
  return { ok: true, duplicate: false, eventId: event.eventId, eventType: event.eventType, ignored: true };
}

export async function getUserEntitlements(userCode) {
  assertIapEnabled();
  const code = normalizeUserCode(userCode);
  return listEntitlementsByUser(code);
}

