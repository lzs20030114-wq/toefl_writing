// 口语真题模考（/speaking-exam?source=real-bank）端到端：
//   (a) 访谈旁白「继续」记已见临时失败一次 → 不出错误卡、直接进访谈，后台自动重试；
//       交卷（finish）要等排队的已见 / 已作答同步落地之后才发；
//   (b) 已见遇到不可重试的错误（账号无权限）→ 「作答记录同步失败」那张错误卡，不给「重试同步」；
//   (c) 全部跳过 → 未作答按 0 分计入，照样出估分（1.0），不再出现「中级」。
// 真题模考接口全部打桩；麦克风一律拒绝（CI 没有麦克风，也保证每题都是「未作答」）。
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

test.setTimeout(90_000);
const reportDir = path.join(process.cwd(), "reports", "realbank-mock-verification-2026-10-04");
fs.mkdirSync(reportDir, { recursive: true });

async function offlineAuth(page) {
  await page.addInitScript(() => {
    localStorage.setItem("toefl-user-code", "ABC123");
    localStorage.setItem("toefl-user-tier", "pro");
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    }
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if ((url.hostname !== "127.0.0.1" && url.hostname !== "localhost") || url.pathname.startsWith("/api/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    return route.continue();
  });
}

function speakingPaper() {
  const repeatSet = { id: "real_repeat_set", taskType: "repeat", realMockKey: "repeat",
    sentences: Array.from({ length: 7 }, (_, i) => ({ id: `real_repeat_${i}`, sentence: `Sentence ${i}`, audio_url: "https://audio.example.test/repeat.mp3" })) };
  const interviewSet = { id: "real_interview_set", taskType: "interview", realMockKey: "interview",
    questions: Array.from({ length: 4 }, (_, i) => ({ id: `real_interview_${i}`, question: `Question ${i}`, audio_url: "https://audio.example.test/interview.mp3" })) };
  return { attemptId: "linear-speaking-attempt", userCode: "ABC123", section: "speaking", templateVersion: "2026-full-v1", repeatSet, interviewSet, items: [repeatSet, interviewSet] };
}

/**
 * Stub /api/real-mock-exam. `failOnce(body)` → that request (first match only) gets a transient 503;
 * `failAlways(body)` → every match gets a non-transient 403 PRO_REQUIRED.
 */
async function stubRealMock(page, paper, { failOnce = () => false, failAlways = () => false } = {}) {
  const calls = [];
  let failed = false;
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper }) });
    if (failAlways(body)) {
      return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false, code: "PRO_REQUIRED", error: "真题模考是 Pro 专属功能。" }) });
    }
    if (!failed && failOnce(body)) {
      failed = true;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "REAL_MOCK_ERROR", error: "真题模考服务暂不可用，请稍后重试。" }) });
    }
    return route.fulfill({ contentType: "application/json", body: '{"ok":true,"status":"ok"}' });
  });
  return calls;
}

async function skipRepeatTask(page) {
  await page.getByRole("button", { name: "开始", exact: true }).click();
  for (let i = 0; i < 7; i++) await page.getByRole("button", { name: "Skip this sentence" }).click();
}

async function skipInterviewTask(page) {
  await page.getByRole("button", { name: "开始", exact: true }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Skip this question" }).click();
}

test("a transient interview narration seen failure does not block the interview and finish waits for the retry", async ({ page }) => {
  await offlineAuth(page);
  const paper = speakingPaper();
  const isInterviewNarrationSeen = (body) => body.action === "seen" && !body.answered && body.items?.[0]?.id === paper.interviewSet.id;
  const calls = await stubRealMock(page, paper, { failOnce: isInterviewNarrationSeen });

  await page.goto("/speaking-exam?source=real-bank");
  await page.getByRole("button", { name: "开始考试" }).click();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await skipRepeatTask(page);

  await expect(page.getByText("Take an Interview", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "继续", exact: true }).click();

  // Straight into the interview: no error card, no 重试同步.
  const errorCard = page.getByTestId("speaking-exam-error");
  await expect(page.getByRole("button", { name: "开始", exact: true })).toBeVisible();
  await expect(errorCard).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重试同步" })).toHaveCount(0);
  await page.screenshot({ path: path.join(reportDir, "speaking-narration-seen-retry.png"), fullPage: true });

  await skipInterviewTask(page);
  await expect(page.getByText("口语模考结果")).toBeVisible({ timeout: 15_000 });
  await expect(errorCard).toHaveCount(0);
  // The failed narration seen was retried in the background (the 503 and one success).
  await expect.poll(() => calls.filter(isInterviewNarrationSeen).length).toBe(2);
  // finish runs only after every queued seen / answered call has landed.
  await expect.poll(() => calls.some((call) => call.action === "finish")).toBe(true);
  const finishAt = calls.findIndex((call) => call.action === "finish");
  expect(calls.slice(finishAt).some((call) => call.action === "seen")).toBe(false);
  expect(calls.slice(0, finishAt).some((call) => call.action === "seen" && call.answered === true && call.items?.[0]?.id === paper.interviewSet.id)).toBe(true);
});

test("a non-transient interview narration seen failure shows the sync error card without 重试同步", async ({ page }) => {
  await offlineAuth(page);
  const paper = speakingPaper();
  const isInterviewNarrationSeen = (body) => body.action === "seen" && !body.answered && body.items?.[0]?.id === paper.interviewSet.id;
  const calls = await stubRealMock(page, paper, { failAlways: isInterviewNarrationSeen });

  await page.goto("/speaking-exam?source=real-bank");
  await page.getByRole("button", { name: "开始考试" }).click();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await skipRepeatTask(page);
  await page.getByRole("button", { name: "继续", exact: true }).click();

  const errorCard = page.getByTestId("speaking-exam-error");
  await expect(errorCard).toContainText("真题模考是 Pro 专属功能。");
  await expect(errorCard.getByRole("button", { name: "重试同步" })).toHaveCount(0);
  await expect(errorCard.getByRole("button", { name: "返回真题专区" })).toBeVisible();
  // Not retried: an account error can never succeed.
  expect(calls.filter(isInterviewNarrationSeen)).toHaveLength(1);
  await page.screenshot({ path: path.join(reportDir, "speaking-narration-seen-fatal.png"), fullPage: true });
});

test("skipping every item still yields an estimate: unanswered count 0, band 1.0, no 中级 label", async ({ page }) => {
  await offlineAuth(page);
  const paper = speakingPaper();
  await stubRealMock(page, paper);

  await page.goto("/speaking-exam?source=real-bank");
  await expect(page.getByText("开考后展示过的题会永久计为已做；口语录音中途刷新或离开，本卷作废、需要重新组卷。")).toBeVisible();
  await page.getByRole("button", { name: "开始考试" }).click();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await skipRepeatTask(page);
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await skipInterviewTask(page);

  await expect(page.getByText("口语模考结果")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("real-speaking-score-note")).toContainText("11 题没有作答，按 0 分计入。");
  await expect(page.getByTestId("real-speaking-score-note")).not.toContainText("本次不出估分");
  await expect(page.getByText("本站模考估分 · 初级")).toBeVisible();
  await expect(page.getByText(/中级/)).toHaveCount(0);
  await expect(page.getByText("原始分 0/35")).toBeVisible();
  await expect(page.getByText("原始分 0/20")).toBeVisible();
  await expect(page.getByText("1.0 / 6.0")).toBeVisible();
  await expect(page.getByTestId("real-speaking-record-link")).toHaveAttribute("href", /^\/real-bank\/progress\?mock=/);
  await expect(page.getByRole("button", { name: "返回真题专区" })).toBeVisible();
  await expect(page.getByTestId("speaking-exam-error")).toHaveCount(0);
  await page.screenshot({ path: path.join(reportDir, "speaking-all-skipped-result.png"), fullPage: true });
});
