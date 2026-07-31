import { getProductById, listActiveProducts } from "./catalog";
import { IapError } from "./errors";
import { assertIapEnabled } from "./featureGate";
import { getIapProvider } from "./providers";
import { grantEntitlement, isWebhookEventProcessed, listEntitlementsByUser, markWebhookEventProcessed } from "./repository";
import { isSupabaseAdminConfigured, supabaseAdmin } from "../supabaseAdmin";
import { createLogger } from "../logger";
import { getCreditPlan } from "../credits/catalog";
import { creditService } from "../credits/service";

const log = createLogger("iap");

const DAY_MS = 24 * 60 * 60 * 1000;

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

/**
 * Grant the subscription AI credits that come bundled with a paid plan
 * (2026-08-01 pricing: 体验卡 30 点 / 月卡·季卡·年卡 每 30 天 100 点).
 *
 * STRICTLY FAIL-OPEN. Points are a bonus on top of the entitlement the user
 * actually paid for; a credits outage must never cost the user their Pro days
 * nor make the webhook return non-2xx (which would make the provider retry a
 * purchase we already granted). Every failure path is logged and swallowed.
 *
 * Deferred cases (logged, not granted):
 *   - CREDITS_ENABLED is off → the purchase is on record in iap_entitlements,
 *     so points can be backfilled once the flag is flipped.
 *   - The user still has an ACTIVE subscription period (early renewal / a second
 *     purchase inside the same period). credit_refresh_subscription REPLACES and
 *     zeroes the previous period's unused points (booking an `expire` row), so
 *     refreshing now would eat points the user already paid for. The correct
 *     home for this is a future period-refresh mechanism that rolls the wallet
 *     forward when the current period actually ends.
 */
export async function grantSubscriptionCredits({ userCode, productId, provider, eventId }) {
  try {
    const plan = getCreditPlan(productId);
    if (!plan || !plan.pointsPerPeriod || !plan.periodDays) {
      log.info("No credit plan for product — skipping credit grant", { userCode, productId });
      return { granted: false, reason: "no_plan" };
    }

    const balance = await creditService.getBalance(userCode);
    if (!balance?.enabled) {
      log.info("Credits disabled — skipping credit grant (backfillable from iap_entitlements)", {
        userCode, productId, provider, eventId,
      });
      return { granted: false, reason: "credits_disabled" };
    }

    // Wallet snapshot keys come from public.credit_wallet_snapshot (camelCase JSONB).
    const periodEnd = balance.wallet?.subscriptionPeriodEnd;
    if (periodEnd && new Date(periodEnd).getTime() > Date.now()) {
      log.info("active period, skip — deferred to future period-refresh mechanism", {
        userCode, productId, provider, eventId, currentPeriodEnd: periodEnd,
      });
      return { granted: false, reason: "active_period" };
    }

    const now = new Date();
    // periodStart 回拨 60s：credit_refresh_subscription 用数据库时钟硬校验
    // period_start <= NOW()，Vercel 与 Supabase 间的时钟偏移会让字面 now 偶发
    // 触发 'subscription period has not started' 而静默漏发；回拨一分钟无副作用。
    const periodStart = new Date(now.getTime() - 60 * 1000);
    const result = await creditService.refreshSubscription({
      userCode,
      points: plan.pointsPerPeriod,
      periodStart: periodStart.toISOString(),
      periodEnd: new Date(now.getTime() + plan.periodDays * DAY_MS).toISOString(),
      idempotencyKey: `iap-sub:${provider}:${eventId}`,
      metadata: { productId, provider, source: "iap_webhook" },
    });
    const duplicate = result?.duplicate === true;
    log.info("Granted subscription credits", {
      userCode, productId, provider, eventId, points: plan.pointsPerPeriod, duplicate,
    });
    // Deliberately do NOT echo the RPC payload (it carries the wallet snapshot)
    // — this return value ends up in the webhook response body for providers
    // without a formatWebhookResponse override.
    return { granted: true, points: plan.pointsPerPeriod, duplicate };
  } catch (e) {
    // Never rethrow: entitlement + tier upgrade already succeeded and the
    // webhook must still answer 2xx.
    log.error("Credit grant failed (fail-open, entitlement unaffected)", {
      userCode, productId, provider, eventId, error: e?.message || String(e),
    });
    return { granted: false, reason: "error" };
  }
}

async function processCompletedCheckout({ userCode, productId, provider, providerRef, eventId, metadata }) {
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

  // Bundled AI credits. Fail-open by construction — see grantSubscriptionCredits.
  const credits = await grantSubscriptionCredits({
    userCode,
    productId,
    provider,
    eventId: eventId || providerRef,
  });

  return { granted: true, entitlement, credits };
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
      eventId: event.eventId,
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

