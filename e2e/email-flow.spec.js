const { test, expect } = require("@playwright/test");

test("email flow can submit and render score panel", async ({ page }) => {
  await page.route("**/api/ai", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: JSON.stringify({
          score: 4,
          band: 4.0,
          goals_met: [true, true, false],
          summary: "test summary",
          weaknesses: ["w1"],
          strengths: ["s1"],
          grammar_issues: ["g1"],
          vocabulary_note: "v1",
          next_steps: ["n1"],
          sample: "model response",
        }),
      }),
    });
  });

  await page.goto("/");
  await page.getByTestId("task-email").click();
  await page.getByTestId("writing-start").click();
  await page.getByTestId("writing-textarea").fill(
    "This is a sample response with enough words to pass the submit threshold quickly."
  );
  await page.getByTestId("writing-submit").click();

  await expect(page.getByTestId("score-panel")).toBeVisible();
  await expect(page.getByText("Band 4")).toBeVisible();
});

