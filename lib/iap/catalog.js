import { IapError } from "./errors";

const DEFAULT_PRODUCTS = [
  {
    id: "pro_monthly",
    title: "Pro Monthly",
    description: "Monthly premium access for all writing modes.",
    priceCents: 990,
    currency: "USD",
    interval: "month",
    active: true,
  },
  {
    id: "pro_yearly",
    title: "Pro Yearly",
    description: "Yearly premium access with discounted pricing.",
    priceCents: 7990,
    currency: "USD",
    interval: "year",
    active: true,
  },
];

// XorPay products (CNY) — used when IAP_PROVIDER=xorpay
// 2026-08-01 提价生效：19.90 / 59.90 / 149.90 / 499.90（口径与 lib/credits/catalog.js
// 的 PLAN_ALLOWANCES 以及全站公告 components/pricing/PricingNoticeModal.js 一致）。
const XORPAY_PRODUCTS = [
  {
    id: "pro_weekly",
    title: "Pro 体验卡",
    description: "7 天无限练习",
    priceCents: 1990,
    currency: "CNY",
    interval: "week",
    active: true,
  },
  {
    id: "pro_monthly",
    title: "Pro 月卡",
    description: "30 天无限练习",
    priceCents: 5990,
    currency: "CNY",
    interval: "month",
    active: true,
  },
  {
    id: "pro_quarterly",
    title: "Pro 季卡",
    description: "90 天无限练习",
    priceCents: 14990,
    currency: "CNY",
    interval: "month",
    active: true,
  },
  {
    id: "pro_yearly",
    title: "Pro 年卡",
    description: "365 天无限练习",
    priceCents: 49990,
    currency: "CNY",
    interval: "year",
    active: true,
  },
];

// Afdian products (CNY) — used when IAP_PROVIDER=afdian
// 2026-08-01 提价生效，与 XORPAY_PRODUCTS 同价；afdianProvider 的金额分档同步调整。
const AFDIAN_PRODUCTS = [
  {
    id: "pro_weekly",
    title: "Pro 体验卡",
    description: "7 天无限练习",
    priceCents: 1990,
    currency: "CNY",
    interval: "week",
    active: true,
  },
  {
    id: "pro_monthly",
    title: "Pro 月卡",
    description: "30 天无限练习",
    priceCents: 5990,
    currency: "CNY",
    interval: "month",
    active: true,
  },
  {
    id: "pro_quarterly",
    title: "Pro 季卡",
    description: "90 天无限练习",
    priceCents: 14990,
    currency: "CNY",
    interval: "month",
    active: true,
  },
  {
    id: "pro_yearly",
    title: "Pro 年卡",
    description: "365 天无限练习（优惠价）",
    priceCents: 49990,
    currency: "CNY",
    interval: "year",
    active: true,
  },
];

function normalizeProduct(raw) {
  const id = String(raw?.id || "").trim();
  const title = String(raw?.title || "").trim();
  const description = String(raw?.description || "").trim();
  const currency = String(raw?.currency || "USD").trim().toUpperCase();
  const interval = String(raw?.interval || "").trim().toLowerCase();
  const priceCents = Number(raw?.priceCents);
  const active = raw?.active !== false;

  if (!id) throw new Error("Product id is required");
  if (!title) throw new Error(`Product ${id}: title is required`);
  if (!Number.isInteger(priceCents) || priceCents <= 0) throw new Error(`Product ${id}: priceCents must be a positive integer`);
  if (!currency) throw new Error(`Product ${id}: currency is required`);
  if (interval && !["month", "year", "week", "one_time"].includes(interval)) {
    throw new Error(`Product ${id}: invalid interval`);
  }

  return {
    id,
    title,
    description,
    priceCents,
    currency,
    interval: interval || "one_time",
    active,
  };
}

function loadFromEnv() {
  const raw = String(process.env.IAP_PRODUCTS_JSON || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("IAP_PRODUCTS_JSON must be a JSON array");
    return parsed.map(normalizeProduct);
  } catch (e) {
    throw new IapError("IAP_INVALID_PRODUCT_CONFIG", e.message || "Invalid IAP_PRODUCTS_JSON", 500);
  }
}

export function getProductCatalog() {
  const envProducts = loadFromEnv();
  if (envProducts) return envProducts.map(normalizeProduct);

  const provider = String(process.env.IAP_PROVIDER || "").trim().toLowerCase();
  const defaults = provider === "xorpay" ? XORPAY_PRODUCTS : provider === "afdian" ? AFDIAN_PRODUCTS : DEFAULT_PRODUCTS;
  return defaults.map(normalizeProduct);
}

export function listActiveProducts() {
  return getProductCatalog().filter((p) => p.active);
}

export function getProductById(productId) {
  const id = String(productId || "").trim();
  const product = getProductCatalog().find((p) => p.id === id && p.active);
  if (!product) {
    throw new IapError("IAP_PRODUCT_NOT_FOUND", "Requested product is not available", 404);
  }
  return product;
}

