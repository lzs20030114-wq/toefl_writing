const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

test.setTimeout(60_000);
const reportDir = path.join(process.cwd(), "reports", "realbank-mock-verification-2026-10-02");
fs.mkdirSync(reportDir, { recursive: true });

async function offlineAuth(page, tier = "pro") {
  await page.addInitScript((savedTier) => {
    localStorage.setItem("toefl-user-code", "ABC123");
    localStorage.setItem("toefl-user-tier", savedTier);
  }, tier);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if ((url.hostname !== "127.0.0.1" && url.hostname !== "localhost") || url.pathname.startsWith("/api/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    return route.continue();
  });
}

function writingPaper() {
  const bsQuestions = Array.from({ length: 10 }, (_, i) => ({
    id: `real_mock_bs_${i + 1}`, taskType: "bs", realMockKey: `bs-${i + 1}`, realMockRole: "scored",
    prompt: `I can read book ${i + 1}.`, answer: `I can read book ${i + 1}.`, chunks: ["I", "can", "read", "book", String(i + 1)],
    prefilled: [], prefilled_positions: {}, distractor: null,
  }));
  const emailPrompt = { id: "real_mock_email_1", taskType: "email", realMockKey: "email-1", realMockRole: "scored", to: "Jessica", subject: "Class notes", direction: "Write an email to Jessica.", scenario: "You missed class.", goals: ["Explain why you missed class.", "Ask for notes.", "Offer help in return."] };
  const discussionPrompt = { id: "real_mock_discussion_1", taskType: "discussion", realMockKey: "discussion-1", realMockRole: "scored", course: "communications", professor: { name: "Dr. Gupta", text: "Should students work together?" }, students: [{ name: "Amy", text: "Yes." }, { name: "Ben", text: "No." }] };
  return { attemptId: "linear-writing-attempt", userCode: "ABC123", section: "writing", source: "real-bank", templateVersion: "2026-full-v1", timing: { taskSeconds: { bs: 360, email: 420, discussion: 600 } }, bsQuestions, emailPrompt, discussionPrompt, items: [...bsQuestions, emailPrompt, discussionPrompt] };
}

test("desktop and mobile real-bank sections link all four mocks under the Pro gate", async ({ page }) => {
  await offlineAuth(page, "free");
  await page.goto("/?section=real-bank");
  for (const href of ["/mock-exam", "/reading-exam", "/listening-exam", "/speaking-exam"]) {
    await expect(page.locator(`a[href="${href}?source=real-bank"]`)).toHaveCount(1);
  }
  await expect(page.getByText("Pro 专属功能").first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  for (const href of ["/mock-exam", "/reading-exam", "/listening-exam", "/speaking-exam"]) {
    await expect(page.locator(`a[href="${href}?source=real-bank"]`)).toHaveCount(1);
  }
  await page.screenshot({ path: path.join(reportDir, "mobile-real-mock-entry.png"), fullPage: true });
});

test("writing uses the reserved 10-question paper and blocks the first BS prompt until seen succeeds", async ({ page }) => {
  await offlineAuth(page);
  const paper = writingPaper();
  const calls = [];
  let releaseFirstSeen;
  await page.route("**/api/real-mock-exam", async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper }) });
    if (body.action === "seen" && !releaseFirstSeen) {
      await new Promise((resolve) => { releaseFirstSeen = resolve; });
    }
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/mock-exam?source=real-bank&mode=practice");
  await page.getByRole("button", { name: "开始模考" }).click();
  await page.getByTestId("mock-transition-skip").click();
  await page.getByTestId("build-start").click();
  await expect(page.getByText("正在确认题目状态…")).toBeVisible();
  await expect(page.getByText("I can read book 1.")).toHaveCount(0);
  releaseFirstSeen();
  await expect(page.getByText("I can read book 1.")).toBeVisible();
  expect(calls.some((call) => call.action === "seen" && call.items?.[0]?.id === "real_mock_bs_1")).toBe(true);
  expect(calls.some((call) => call.action === "seen" && call.items?.some((item) => item.id === "real_mock_bs_2"))).toBe(false);
  await page.screenshot({ path: path.join(reportDir, "writing-bs-first-question.png"), fullPage: true });
});

test("writing completes the actual 10+1+1 tasks with blank timed essays and one mock record", async ({ page }) => {
  await offlineAuth(page);
  const paper = writingPaper();
  paper.timing.taskSeconds = { bs: 90, email: 3, discussion: 3 };
  const calls = [];
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper }) });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.route("**/api/ai", () => { throw new Error("Blank essays must not call paid AI"); });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/mock-exam?source=real-bank");
  await page.getByRole("button", { name: "开始模考" }).click();
  await page.getByTestId("mock-transition-skip").click();
  await page.getByTestId("build-start").click();
  for (let i = 0; i < 10; i++) {
    await expect(page.getByText(`I can read book ${i + 1}.`)).toBeVisible();
    await page.getByTestId("build-submit").click();
  }
  await page.getByTestId("mock-transition-skip").click();
  await expect(page.getByText("Write an email to Jessica.")).toBeVisible();
  await page.getByTestId("mock-transition-skip").click({ timeout: 15_000 });
  await expect(page.getByText("Should students work together?")).toBeVisible();
  await expect(page.getByText("写作真题模考结果 · 本站估分")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/原始分：/)).toBeVisible();
  const answered = calls.filter((call) => call.action === "seen" && call.answered === true);
  expect(answered.flatMap((call) => call.items.map((item) => item.id))).toEqual(expect.arrayContaining([
    ...paper.bsQuestions.map((question) => question.id), paper.emailPrompt.id, paper.discussionPrompt.id,
  ]));
  expect(calls.some((call) => call.action === "finish")).toBe(true);
  await page.screenshot({ path: path.join(reportDir, "writing-full-result-blank-essays.png"), fullPage: true });
});

test("writing reload keeps the current task's remaining time", async ({ page }) => {
  await offlineAuth(page);
  const paper = writingPaper();
  paper.timing.taskSeconds = { bs: 90, email: 30, discussion: 600 };
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper }) });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/mock-exam?source=real-bank");
  await page.getByRole("button", { name: "开始模考" }).click();
  await page.getByTestId("mock-transition-skip").click();
  await page.getByTestId("build-start").click();
  for (let i = 0; i < 10; i++) {
    await expect(page.getByText(`I can read book ${i + 1}.`)).toBeVisible();
    await page.getByTestId("build-submit").click();
  }
  await page.getByTestId("mock-transition-skip").click();
  await expect(page.getByText("Write an email to Jessica.")).toBeVisible();
  await expect(page.getByTestId("mock-section-timer")).toContainText(/^00:/);
  await page.waitForTimeout(6200);
  const beforeReload = await page.getByTestId("mock-section-timer").textContent();
  await page.reload();
  await page.getByTestId("mock-transition-skip").click();
  await expect(page.getByText("Write an email to Jessica.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("mock-section-timer")).toContainText(/^00:/);
  const afterReload = await page.getByTestId("mock-section-timer").textContent();
  const clockSeconds = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  expect(clockSeconds(beforeReload)).toBeLessThan(30);
  expect(clockSeconds(afterReload)).toBeLessThan(30);
  expect(clockSeconds(afterReload)).toBeLessThanOrEqual(clockSeconds(beforeReload) + 2);
  await page.screenshot({ path: path.join(reportDir, "writing-timer-reload.png"), fullPage: true });
});

test("speaking refresh during recording offers a new unseen paper instead of replaying the old set", async ({ page }) => {
  await offlineAuth(page);
  const set = (type, count) => ({ id: `real_${type}_set`, taskType: type, realMockKey: type,
    ...(type === "repeat" ? { sentences: Array.from({ length: count }, (_, i) => ({ id: `real_repeat_${i}`, sentence: `Sentence ${i}`, audio_url: "https://audio.example.test/repeat.mp3" })) }
      : { questions: Array.from({ length: count }, (_, i) => ({ id: `real_interview_${i}`, question: `Question ${i}`, audio_url: "https://audio.example.test/interview.mp3" })) }) });
  const repeatSet = set("repeat", 7);
  const interviewSet = set("interview", 4);
  const paper = { attemptId: "linear-speaking-attempt", userCode: "ABC123", section: "speaking", templateVersion: "2026-full-v1", repeatSet, interviewSet, items: [repeatSet, interviewSet] };
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper }) });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/speaking-exam?source=real-bank");
  await page.getByRole("button", { name: "开始考试" }).click();
  await page.getByRole("button", { name: "继续" }).click();
  await page.reload();
  await expect(page.getByText("这项口语任务无法从录音中途恢复")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新组卷" })).toBeVisible();
  await page.screenshot({ path: path.join(reportDir, "speaking-interrupted-recovery.png"), fullPage: true });
});

test("real-bank history opens complete review for all four mock subjects", async ({ page }) => {
  await offlineAuth(page);
  const base = { real: true, source: "real-bank", realMock: true, subtype: "mock", templateVersion: "2026-full-v1" };
  const rows = [
    { id: 101, type: "mock", date: "2026-10-02T04:00:00.000Z", score: { score: 14, scale: 20, band: 4.5 }, details: { ...base, section: "writing", attemptId: "hist-writing", aggregate: { raw: 14, maxRaw: 20, band: 4.5 }, seenItemIds: ["real_mock_bs_1", "real_mock_email_1", "real_mock_discussion_1"], itemIds: ["real_mock_bs_1", "real_mock_email_1", "real_mock_discussion_1"], items: [
      { id: "real_mock_bs_1", taskType: "bs" }, { id: "real_mock_email_1", taskType: "email", direction: "Write an email to Jessica." }, { id: "real_mock_discussion_1", taskType: "discussion", professor: { text: "Should students work together?" } }],
      tasks: [
        { taskType: "bs", itemIds: ["real_mock_bs_1"], score: 7, maxScore: 10, meta: { details: [{ qid: "real_mock_bs_1", prompt: "I can read.", userAnswer: "I can read.", correctAnswer: "I can read.", isCorrect: true }] } },
        { taskType: "email", itemIds: ["real_mock_email_1"], score: 4, maxScore: 5, meta: { response: { userText: "Dear Jessica, please send notes." } } },
        { taskType: "discussion", itemIds: ["real_mock_discussion_1"], score: 3, maxScore: 5, meta: { response: { userText: "I agree with Amy." } } },
      ] } },
    { id: 102, type: "reading", date: "2026-10-02T03:00:00.000Z", score: { correct: 15, total: 35, band: 3 }, details: { ...base, section: "reading", attemptId: "hist-reading", scoredCorrect: 15, scoredTotal: 35, seenItemIds: ["real_mock_ctw_1"], itemIds: ["real_mock_ctw_1", "real_mock_ap_unseen"], items: [{ id: "real_mock_ctw_1", taskType: "ctw", passage: "Reading practice passage", blanks: [{ position: 0, original_word: "Reading", displayed_fragment: "Re" }] }, { id: "real_mock_ap_unseen", taskType: "ap" }], tasks: [{ taskType: "ctw", itemId: "real_mock_ctw_1", passage: "Reading practice passage", blanks: [{ position: 0, original_word: "Reading", displayed_fragment: "Re" }], results: [{ userAnswer: "Reading", isCorrect: true }], correct: 1, total: 1 }] } },
    { id: 103, type: "listening", date: "2026-10-02T02:00:00.000Z", score: { correct: 12, total: 35, band: 2.5 }, details: { ...base, section: "listening", attemptId: "hist-listening", scoredCorrect: 12, scoredTotal: 35, seenItemIds: ["real_mock_lcr_1"], itemIds: ["real_mock_lcr_1"], items: [{ id: "real_mock_lcr_1", taskType: "lcr", speaker: "Can you come tomorrow?", options: { A: "Yes", B: "No", C: "Maybe", D: "Later" }, answer: "A" }], tasks: [{ taskType: "lcr", itemId: "real_mock_lcr_1", speaker: "Can you come tomorrow?", options: { A: "Yes", B: "No", C: "Maybe", D: "Later" }, answer: "A", results: [{ selected: "A", correct: "A", isCorrect: true }], correct: 1, total: 1 }] } },
    { id: 104, type: "speaking", date: "2026-10-02T01:00:00.000Z", score: { band: 4 }, details: { ...base, section: "speaking", attemptId: "hist-speaking", rawTotal: 40, seenItemIds: ["real_mock_repeat_set", "real_mock_interview_set"], itemIds: ["real_mock_repeat_set", "real_mock_interview_set"], items: [{ id: "real_mock_repeat_set", taskType: "repeat" }, { id: "real_mock_interview_set", taskType: "interview" }], tasks: [{ taskType: "repeat", itemIds: ["real_mock_repeat_set"], items: [{ id: "real_repeat_1", sentence: "Please sit down.", transcript: "Please sit down.", score: { officialLevel: 4, accuracy: 90 } }] }, { taskType: "interview", itemIds: ["real_mock_interview_set"], items: [{ id: "real_interview_1", question: "What do you study?", transcript: "Design", aiScore: { score: 3 } }] }] } },
  ];
  await page.addInitScript((sessions) => localStorage.setItem("toefl-hist", JSON.stringify({ sessions })), rows.map((row) => ({ ...row.score, id: row.id, type: row.type, date: row.date, details: row.details })));
  await page.route("**/rest/v1/sessions**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(rows) }));
  await page.goto("/real-bank/progress");
  await expect(page.getByText("共 4 次")).toBeVisible();
  for (const label of ["写作真题模考", "阅读真题模考", "听力真题模考", "口语真题模考"]) {
    await page.getByText(label).last().click();
    await expect(page.getByTestId("real-mock-review")).toBeVisible();
    await page.getByRole("button", { name: "返回列表" }).click();
  }
  await page.screenshot({ path: path.join(reportDir, "real-mock-history-four-subjects.png"), fullPage: true });
});
