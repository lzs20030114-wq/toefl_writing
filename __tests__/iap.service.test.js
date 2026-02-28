/**
 * @jest-environment node
 */

import { handleWebhook } from "../lib/iap/service";
import { buildMockWebhookPayload, signMockWebhookPayload } from "../lib/iap/providers/mockProvider";

describe("iap webhook service", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...OLD_ENV,
      IAP_ENABLED: "true",
      NEXT_PUBLIC_IAP_ENABLED: "true",
      IAP_PROVIDER: "mock",
      IAP_WEBHOOK_SECRET: "test_secret_123",
    };
    globalThis.__iapStore = undefined;
  });

  afterEach(() => {
    process.env = OLD_ENV;
    globalThis.__iapStore = undefined;
  });

  test("processes checkout.completed once and deduplicates repeated event", async () => {
    const rawBody = buildMockWebhookPayload({ userCode: "ABCD12", productId: "pro_monthly", providerRef: "mock_ref_1" });
    const signature = signMockWebhookPayload(rawBody);
    const headers = new Headers({ "x-iap-signature": signature });

    const first = await handleWebhook({ headers, rawBody });
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);

    const second = await handleWebhook({ headers, rawBody });
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
  });
});

