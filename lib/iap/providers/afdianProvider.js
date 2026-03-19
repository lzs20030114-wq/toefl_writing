import { createHash } from "crypto";
import { IapError } from "../errors";
import { createLogger } from "../../logger";

const log = createLogger("afdian-webhook");

/**
 * Afdian (爱发电) payment provider.
 *
 * Webhook flow:
 *   Afdian POSTs { ec, em, data: { type:"order", order:{...} } }
 *   We must return { ec: 200, em: "" }
 *
 * Signature (for API calls we initiate):
 *   sign = md5(token + "params" + paramsJSON + "ts" + ts + "user_id" + userId)
 */

function getEnv(key, required = true) {
  const v = String(process.env[key] || "").trim();
  if (required && !v) throw new IapError("IAP_CONFIG_MISSING", `Missing env ${key}`, 500);
  return v;
}

/**
 * Compute Afdian-style MD5 sign.
 * Format: md5(token + "params" + paramsStr + "ts" + ts + "user_id" + userId)
 */
function computeSign(token, paramsStr, ts, userId) {
  const raw = `${token}params${paramsStr}ts${ts}user_id${userId}`;
  return createHash("md5").update(raw).digest("hex");
}

/**
 * Extract a 6-char alphanumeric user code from an order remark.
 * Returns null if no match.
 */
function extractUserCode(remark) {
  if (!remark) return null;
  const match = String(remark).match(/\b([A-Z0-9]{6})\b/i);
  return match ? match[1].toUpperCase() : null;
}

export const afdianProvider = {
  name: "afdian",

  /**
   * No real checkout session — just return the Afdian sponsor page URL.
   */
  async createCheckoutSession({ userCode, product }) {
    const sponsorUrl = getEnv("AFDIAN_SPONSOR_URL", false) || "https://ifdian.net/a/treepractice";
    return {
      provider: "afdian",
      checkoutId: null,
      checkoutUrl: sponsorUrl,
      productId: product.id,
      amountCents: product.priceCents,
      currency: product.currency,
      metadata: { userCode },
    };
  },

  /**
   * Verify the webhook request came from Afdian.
   *
   * Fail-closed: if we cannot verify the order against Afdian's API,
   * reject the webhook. Afdian will retry on non-200 HTTP responses,
   * so temporary failures are self-healing.
   */
  async verifyWebhook({ headers, rawBody }) {
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new IapError("IAP_INVALID_WEBHOOK_PAYLOAD", "Body is not valid JSON", 400);
    }
    if (!data?.data?.order) {
      throw new IapError("IAP_INVALID_WEBHOOK_PAYLOAD", "Missing order data", 400);
    }

    const order = data.data.order;
    const orderId = String(order.out_trade_no || "").trim();
    if (!orderId) return; // will be caught later in parseWebhookEvent

    const token = getEnv("AFDIAN_API_TOKEN", false);
    const userId = getEnv("AFDIAN_USER_ID", false);
    if (!token || !userId) {
      throw new IapError("IAP_CONFIG_MISSING", "Webhook verification credentials not configured", 500);
    }

    try {
      const ts = Math.floor(Date.now() / 1000);
      const params = { out_trade_no: orderId };
      const paramsStr = JSON.stringify(params);
      const sign = computeSign(token, paramsStr, ts, userId);

      const res = await fetch("https://afdian.com/api/open/query-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, params: paramsStr, ts, sign }),
        signal: AbortSignal.timeout(8000),
      });
      const result = await res.json();

      if (result.ec === 200) {
        const orders = result.data?.list || [];
        if (orders.length === 0) {
          log.error("Order NOT FOUND on Afdian — likely forged", { orderId });
          throw new IapError("IAP_ORDER_NOT_FOUND", "Order not found on Afdian", 403);
        }
        const realOrder = orders[0];
        const webhookAmount = parseFloat(order.total_amount) || 0;
        const realAmount = parseFloat(realOrder.total_amount) || 0;
        if (Math.abs(webhookAmount - realAmount) > 0.01) {
          log.error("Amount mismatch", { orderId, webhookAmount, realAmount });
          throw new IapError("IAP_AMOUNT_MISMATCH", "Order amount mismatch", 403);
        }
        log.info("Order verified on Afdian", { orderId, amount: realAmount });
      } else {
        // API returned an error (e.g. bad token, rate limit) — fail-closed, let Afdian retry
        log.error("Afdian API error, rejecting (fail-closed)", { ec: result.ec });
        throw new IapError("IAP_VERIFICATION_FAILED", `Afdian API error ec=${result.ec}`, 502);
      }
    } catch (e) {
      if (e instanceof IapError) throw e;
      // Network error, timeout — fail-closed, Afdian will retry
      log.error("Order verification failed, rejecting (fail-closed)", { error: e.message });
      throw new IapError("IAP_VERIFICATION_FAILED", "Order verification temporarily unavailable", 503);
    }
  },

  /**
   * Parse Afdian webhook payload into normalized event format.
   *
   * Afdian body: { ec, em, data: { type:"order", order: { out_trade_no, remark, month, total_amount, status, ... } } }
   */
  parseWebhookEvent(rawBody) {
    const body = JSON.parse(rawBody);
    const order = body?.data?.order;
    if (!order) {
      throw new IapError("IAP_INVALID_WEBHOOK_PAYLOAD", "Missing order in webhook data", 400);
    }

    const eventId = String(order.out_trade_no || "").trim();
    if (!eventId) {
      throw new IapError("IAP_INVALID_WEBHOOK_PAYLOAD", "Missing out_trade_no", 400);
    }

    // Only process paid orders (status === 2)
    if (order.status !== 2) {
      return { provider: "afdian", eventId, eventType: "order.other", payload: {} };
    }

    // Extract user code from remark
    const userCode = extractUserCode(order.remark);

    // Determine product + days by month count and amount
    const month = Number(order.month) || 0;
    const amount = parseFloat(order.total_amount) || 0;

    let productId;
    let days;
    if (month >= 12) {
      productId = "pro_yearly"; days = 365;
    } else if (month >= 3) {
      productId = "pro_quarterly"; days = 90;
    } else if (month >= 1) {
      productId = "pro_monthly"; days = 30;
    } else if (amount <= 15) {
      // Weekly trial (¥9.99) — month=0 for one-time products
      productId = "pro_weekly"; days = 7;
    } else {
      productId = "pro_monthly"; days = 30;
    }

    return {
      provider: "afdian",
      eventId,
      eventType: "checkout.completed",
      payload: {
        userCode,
        productId,
        providerRef: eventId,
        purchasedAt: new Date().toISOString(),
        month,
        days,
        totalAmount: order.total_amount,
        planId: order.plan_id || null,
        remark: order.remark || "",
      },
    };
  },

  /**
   * Format the response for Afdian.
   * Return ec:200 on success or permanent rejection (forged/mismatch).
   * Return ec:500 on temporary failures so Afdian retries.
   */
  formatWebhookResponse(result, error) {
    if (!error) return { ec: 200, em: "" };
    log.error("Error processing webhook", { error: error.message || String(error) });
    const status = error?.status || 500;
    if (status === 502 || status === 503) {
      return { ec: 500, em: "temporary verification failure" };
    }
    return { ec: 200, em: "" };
  },
};

/**
 * Call Afdian API (for query-order, query-sponsor, ping).
 * Not used in the webhook flow but useful for verification.
 */
export async function callAfdianApi(endpoint, params = {}) {
  const token = getEnv("AFDIAN_API_TOKEN");
  const userId = getEnv("AFDIAN_USER_ID");
  const ts = Math.floor(Date.now() / 1000);
  const paramsStr = JSON.stringify(params);
  const sign = computeSign(token, paramsStr, ts, userId);

  const res = await fetch(`https://afdian.com/api/open/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, params: paramsStr, ts, sign }),
  });
  return res.json();
}
