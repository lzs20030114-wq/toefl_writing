import { createHash, randomBytes } from "crypto";
import { IapError } from "../errors";
import { createLogger } from "../../logger";

const log = createLogger("xorpay-webhook");

const PRODUCT_DAYS = {
  pro_weekly: 7,
  pro_monthly: 30,
  pro_quarterly: 90,
  pro_yearly: 365,
};

function getEnv(key, required = true) {
  const v = String(process.env[key] || "").trim();
  if (required && !v) throw new IapError("IAP_CONFIG_MISSING", `Missing env ${key}`, 500);
  return v;
}

function md5(str) {
  return createHash("md5").update(str).digest("hex");
}

export const xorpayProvider = {
  name: "xorpay",

  /**
   * Create a checkout session by calling XorPay API.
   * Returns a QR code URL for in-page scanning payment.
   */
  async createCheckoutSession({ userCode, product, metadata }) {
    const aid = getEnv("XORPAY_AID");
    const appSecret = getEnv("XORPAY_APP_SECRET");
    const notifyUrl = getEnv("XORPAY_NOTIFY_URL");

    const payType = metadata?.payType || "alipay";
    const orderId = `xp_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const name = product.title;
    const price = (product.priceCents / 100).toFixed(2);
    const more = JSON.stringify({ userCode, productId: product.id });

    // Signature: MD5(name + pay_type + price + order_id + notify_url + app_secret)
    const sign = md5(name + payType + price + orderId + notifyUrl + appSecret);

    const body = new URLSearchParams({
      name,
      pay_type: payType,
      price,
      order_id: orderId,
      notify_url: notifyUrl,
      sign,
      more,
    });

    let data;
    try {
      const res = await fetch(`https://xorpay.com/api/pay/${aid}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(8000),
      });
      data = await res.json();
    } catch (e) {
      log.error("XorPay API request failed", { error: e.message });
      throw new IapError("IAP_CHECKOUT_FAILED", "Payment service temporarily unavailable", 502);
    }

    if (data.errno !== 0 && data.errno !== undefined) {
      log.error("XorPay API error", { errno: data.errno, errmsg: data.errmsg });
      throw new IapError("IAP_CHECKOUT_FAILED", data.errmsg || "Payment creation failed", 502);
    }

    return {
      provider: "xorpay",
      checkoutId: data.aoid,
      checkoutUrl: null,
      qrUrl: data.info?.qr,
      expiresIn: data.expires_in,
      productId: product.id,
      amountCents: product.priceCents,
      currency: product.currency,
      metadata: { userCode, payType },
    };
  },

  /**
   * Verify webhook signature from XorPay.
   * Body is application/x-www-form-urlencoded.
   * Expected sign: MD5(aoid + order_id + pay_price + pay_time + app_secret)
   */
  async verifyWebhook({ headers, rawBody }) {
    const appSecret = getEnv("XORPAY_APP_SECRET");

    let params;
    try {
      params = new URLSearchParams(rawBody);
    } catch {
      throw new IapError("IAP_INVALID_WEBHOOK_PAYLOAD", "Body is not valid form data", 400);
    }

    const aoid = params.get("aoid") || "";
    const orderId = params.get("order_id") || "";
    const payPrice = params.get("pay_price") || "";
    const payTime = params.get("pay_time") || "";
    const sign = params.get("sign") || "";

    if (!aoid || !orderId || !sign) {
      throw new IapError("IAP_INVALID_WEBHOOK_PAYLOAD", "Missing required fields", 400);
    }

    const expectedSign = md5(aoid + orderId + payPrice + payTime + appSecret);
    if (sign !== expectedSign) {
      log.error("Webhook signature mismatch", { orderId, aoid });
      throw new IapError("IAP_INVALID_WEBHOOK_SIGNATURE", "Invalid webhook signature", 401);
    }

    log.info("Webhook signature verified", { orderId, aoid });
  },

  /**
   * Parse XorPay webhook into normalized event format.
   * Extracts userCode and productId from the `more` field.
   */
  parseWebhookEvent(rawBody) {
    const params = new URLSearchParams(rawBody);
    const aoid = params.get("aoid") || "";
    const orderId = params.get("order_id") || "";
    const payPrice = params.get("pay_price") || "";
    const payTime = params.get("pay_time") || "";
    const moreRaw = params.get("more") || "";

    let userCode = null;
    let productId = null;

    try {
      const more = JSON.parse(moreRaw);
      userCode = more.userCode || null;
      productId = more.productId || null;
    } catch (e) {
      log.error("Failed to parse `more` field", { orderId, aoid, moreRaw, error: e.message });
      // Return success to prevent XorPay from retrying endlessly
      return {
        provider: "xorpay",
        eventId: aoid,
        eventType: "checkout.completed",
        payload: { userCode: null, productId: null, providerRef: aoid, purchasedAt: payTime },
      };
    }

    const days = PRODUCT_DAYS[productId] || 30;

    return {
      provider: "xorpay",
      eventId: aoid,
      eventType: "checkout.completed",
      payload: {
        userCode,
        productId,
        providerRef: aoid,
        purchasedAt: payTime,
        days,
      },
    };
  },

  /**
   * XorPay expects plain text "success" on successful processing.
   * Returns __raw to signal the webhook route to use plain text response.
   */
  formatWebhookResponse(result, error) {
    if (!error) {
      return { __raw: true, body: "success", status: 200 };
    }
    log.error("Error processing webhook", { error: error.message || String(error) });
    const status = error?.status || 500;
    if (status === 502 || status === 503) {
      return { __raw: true, body: "fail", status: 200 };
    }
    // Permanent errors — still return success to stop retries
    return { __raw: true, body: "success", status: 200 };
  },
};
