/**
 * @jest-environment node
 */

import { getProductCatalog } from "../lib/iap/catalog";

describe("iap catalog", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.IAP_PRODUCTS_JSON;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  test("uses default products when env is not provided", () => {
    const list = getProductCatalog();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty("id");
  });

  test("loads products from IAP_PRODUCTS_JSON", () => {
    process.env.IAP_PRODUCTS_JSON = JSON.stringify([
      {
        id: "vip_monthly",
        title: "VIP Monthly",
        description: "VIP",
        priceCents: 1990,
        currency: "usd",
        interval: "month",
        active: true,
      },
    ]);
    const list = getProductCatalog();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("vip_monthly");
    expect(list[0].currency).toBe("USD");
  });
});

