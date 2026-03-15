const { test, expect } = require("@playwright/test");

test.describe("Navigation", () => {
  test("clicking task card navigates to writing page", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("task-email").click();
    // Should navigate to email writing page
    await expect(page).toHaveURL(/email-writing/);
  });

  test("discussion task card navigates correctly", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("task-discussion").click();
    await expect(page).toHaveURL(/academic-writing/);
  });

  test("sentence task card navigates correctly", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("task-sentence").click();
    await expect(page).toHaveURL(/build-sentence/);
  });

  test("terms page back link returns to homepage", async ({ page }) => {
    await page.goto("/terms");
    await page.locator("a[href='/']").click();
    await expect(page).toHaveURL("/");
  });
});
