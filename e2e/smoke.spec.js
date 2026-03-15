/**
 * Playwright E2E 冒烟测试 — 验证核心页面能正常加载。
 *
 * ── 运行方法 ──────────────────────────────────────────────
 *
 *   # 首次需要安装浏览器引擎（只需一次）
 *   npx playwright install chromium
 *
 *   # 跑全部 E2E 测试
 *   npx playwright test
 *
 *   # 只跑这个文件
 *   npx playwright test e2e/smoke.spec.js
 *
 *   # 看浏览器实际操作（调试用）
 *   npx playwright test --headed
 *
 *   # 看测试报告
 *   npx playwright show-report
 *
 * ── 配置在哪 ──────────────────────────────────────────────
 *
 *   playwright.config.js（项目根目录）
 *   - 自动启动 npm run dev（不需要手动起服务）
 *   - 用 Chromium 跑，baseURL = http://127.0.0.1:3000
 *
 * ── 怎么写新测试 ─────────────────────────────────────────
 *
 *   在 e2e/ 目录新建 xxx.spec.js，格式：
 *
 *   const { test, expect } = require("@playwright/test");
 *   test("描述", async ({ page }) => {
 *     await page.goto("/某页面");
 *     await expect(page.locator("选择器")).toBeVisible();
 *   });
 *
 *   常用 API：
 *     page.goto("/path")                      跳转页面
 *     page.getByTestId("xxx")                 通过 data-testid 选元素
 *     page.getByRole("button", {name: /文字/}) 通过角色+文字选元素
 *     page.locator("css选择器")                CSS 选择器
 *     expect(locator).toBeVisible()           断言可见
 *     expect(page).toHaveURL(/pattern/)       断言 URL
 *     page.route("**/api/xx", handler)        拦截 API 请求（mock）
 *
 * ── 什么时候跑 ───────────────────────────────────────────
 *
 *   - 改了首页布局、路由跳转、API 限流逻辑之后
 *   - 推送上线前跑一次兜底
 *   - 不需要每次小改都跑
 */
const { test, expect } = require("@playwright/test");

test.describe("Smoke tests", () => {
  test("homepage loads and shows title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/TreePractice/);
    await expect(page.locator("body")).toBeVisible();
  });

  test("homepage shows three task cards", async ({ page }) => {
    await page.goto("/");
    // Three writing tasks should be visible
    await expect(page.getByTestId("task-discussion")).toBeVisible();
    await expect(page.getByTestId("task-email")).toBeVisible();
    await expect(page.getByTestId("task-sentence")).toBeVisible();
  });

  test("mode switcher toggles between modes", async ({ page }) => {
    await page.goto("/");
    // Standard mode is default
    const switcher = page.locator("[data-testid='mode-switcher']");
    if (await switcher.isVisible()) {
      // Click practice button if visible
      const practiceBtn = page.getByRole("button", { name: /练习/i });
      if (await practiceBtn.isVisible()) {
        await practiceBtn.click();
        // URL should update to include mode=practice
        await expect(page).toHaveURL(/mode=practice/);
      }
    }
  });

  test("terms page loads", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.locator("h1")).toContainText("使用条款");
  });
});
