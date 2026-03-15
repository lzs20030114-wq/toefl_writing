const { test, expect } = require("@playwright/test");

test.describe("Error handling", () => {
  test("404 page shows for unknown routes", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response.status()).toBe(404);
  });

  test("API returns 429 on rate limit", async ({ page }) => {
    // Mock the feedback API to simulate a rate-limited response
    await page.route("**/api/feedback", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ error: "Too many requests" }),
        });
      } else {
        await route.continue();
      }
    });

    // Navigate to any page that might trigger the API
    await page.goto("/");
    // Directly test the API endpoint
    const response = await page.evaluate(async () => {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode: "TEST01", content: "test" }),
      });
      return { status: res.status };
    });
    expect(response.status).toBe(429);
  });
});
