/**
 * @jest-environment node
 */

describe("GET /api/credits/config", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.CREDITS_ENABLED;
    delete process.env.CREDITS_ENFORCEMENT_ENABLED;
    delete process.env.NEXT_PUBLIC_CREDITS_ENABLED;
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  test("is undiscoverable by default and does not expose staged prices", async () => {
    const { GET } = await import("../app/api/credits/config/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.enabled).toBe(false);
    expect(body.enforcementEnabled).toBe(false);
    expect(body.clientVisible).toBe(false);
    expect(body.plans).toBeUndefined();
  });

  test("exposes the catalog only after both infrastructure and client flags are enabled", async () => {
    process.env.CREDITS_ENABLED = "true";
    process.env.NEXT_PUBLIC_CREDITS_ENABLED = "true";
    const { GET } = await import("../app/api/credits/config/route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.enforcementEnabled).toBe(false);
    expect(body.plans.find((plan) => plan.id === "pro_monthly")).toMatchObject({ priceCents: 5990, pointsPerPeriod: 100 });
  });
});
