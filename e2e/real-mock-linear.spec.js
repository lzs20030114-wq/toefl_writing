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
  // The email task already started before the reload: no 25 s transition card (it showed
  // the full 7-min limit while the deadline kept running) — straight back to the task.
  await expect(page.getByText("Write an email to Jessica.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("mock-transition-skip")).toHaveCount(0);
  await expect(page.getByTestId("mock-section-timer")).toContainText(/^00:/);
  const afterReload = await page.getByTestId("mock-section-timer").textContent();
  const clockSeconds = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  expect(clockSeconds(beforeReload)).toBeLessThan(30);
  expect(clockSeconds(afterReload)).toBeLessThan(30);
  expect(clockSeconds(afterReload)).toBeLessThanOrEqual(clockSeconds(beforeReload) + 2);
  await page.screenshot({ path: path.join(reportDir, "writing-timer-reload.png"), fullPage: true });
});

// Runs the reserved paper to the result page with blank essays (no AI calls).
async function finishBlankWritingPaper(page) {
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
  await expect(page.getByText("写作真题模考结果 · 本站估分")).toBeVisible({ timeout: 15_000 });
}

test("writing 开始新模考 on the result page explains why no new paper can be prepared", async ({ page }) => {
  await offlineAuth(page);
  const paper = writingPaper();
  paper.timing.taskSeconds = { bs: 90, email: 3, discussion: 3 };
  let prepares = 0;
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "prepare" && ++prepares > 1) {
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({
        ok: false, code: "REAL_MOCK_EXHAUSTED", error: "未做真题数量不足，无法组成完整试卷。", deficits: [{ path: "both", taskType: "bs", need: 10, available: 4 }],
      }) });
    }
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper }) });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.route("**/api/ai", () => { throw new Error("Blank essays must not call paid AI"); });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/mock-exam?source=real-bank");
  await finishBlankWritingPaper(page);
  await page.getByRole("button", { name: "开始新模考" }).click();
  await expect(page.getByText(/你没做过的真题已经凑不齐一套完整试卷/)).toBeVisible();
  await expect(page.getByText(/造句还差 6 题/)).toBeVisible();
  await expect(page.getByText("写作真题模考结果 · 本站估分")).toBeVisible();
  await expect(page.getByRole("button", { name: "释放上次未完成试卷，重新组卷" })).toHaveCount(0);
  await page.screenshot({ path: path.join(reportDir, "writing-start-new-exhausted.png"), fullPage: true });
  // A scored paper is not kept in the checkpoint: reopening shows the start card, not the old result.
  await page.reload();
  await expect(page.getByRole("button", { name: "开始模考" })).toBeVisible();
  await expect(page.getByText("写作真题模考结果 · 本站估分")).toHaveCount(0);
});

test("writing BS seen failure offers 重试 in place instead of aborting the paper", async ({ page }) => {
  await offlineAuth(page);
  const paper = writingPaper();
  let seenCalls = 0;
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper }) });
    if (body.action === "seen" && ++seenCalls === 1) {
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "REAL_MOCK_ERROR", error: "真题模考服务暂不可用，请稍后重试。" }) });
    }
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/mock-exam?source=real-bank");
  await page.getByRole("button", { name: "开始模考" }).click();
  await page.getByTestId("mock-transition-skip").click();
  await page.getByTestId("build-start").click();
  await expect(page.getByText("真题模考服务暂不可用，请稍后重试。")).toBeVisible();
  await expect(page.getByText("I can read book 1.")).toHaveCount(0);
  // The BS clock stays paused while the question is not confirmed.
  const pausedAt = await page.getByTestId("mock-section-timer").textContent();
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("mock-section-timer")).toHaveText(pausedAt);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("I can read book 1.")).toBeVisible();
  await expect(page.getByText("模考已中止")).toHaveCount(0);
  expect(seenCalls).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: path.join(reportDir, "writing-bs-seen-retry.png"), fullPage: true });
});

test("writing hides 开始新模考 while AI scoring is pending", async ({ page }) => {
  await offlineAuth(page);
  const paper = writingPaper();
  paper.timing.taskSeconds = { bs: 90, email: 120, discussion: 120 };
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper }) });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  let releaseAi;
  const aiReleased = new Promise((resolve) => { releaseAi = resolve; });
  await page.route("**/api/ai", async (route) => {
    await aiReleased;
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "upstream unavailable" }) });
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
  await page.getByTestId("writing-textarea").fill("Dear Jessica, I missed class because I was sick. Could you share your notes? I can help you with math.");
  await page.getByTestId("writing-submit").click();
  await page.getByRole("button", { name: "确定提交" }).click();
  await page.getByTestId("mock-transition-skip").click();
  await expect(page.getByText("Should students work together?")).toBeVisible();
  await page.getByTestId("writing-textarea").fill("I agree with Amy because working together helps students learn from each other.");
  await page.getByTestId("writing-submit").click();
  await page.getByRole("button", { name: "确定提交" }).click();
  await expect(page.getByText("正在生成成绩…")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "开始新模考" })).toHaveCount(0);
  await page.screenshot({ path: path.join(reportDir, "writing-scoring-pending.png"), fullPage: true });
  releaseAi();
  await expect(page.getByRole("button", { name: "重试 AI 评分" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "开始新模考" })).toBeVisible();
});

test("writing 中止 asks first, finishes the paper and does not reopen the aborted page", async ({ page }) => {
  await offlineAuth(page);
  const paper = writingPaper();
  const calls = [];
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper }) });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  const dialogs = [];
  page.on("dialog", (dialog) => { dialogs.push(dialog.message()); dialog.accept(); });
  await page.goto("/mock-exam?source=real-bank");
  await page.getByRole("button", { name: "开始模考" }).click();
  await page.getByTestId("mock-transition-skip").click();
  await page.getByTestId("build-start").click();
  await expect(page.getByText("I can read book 1.")).toBeVisible();
  await page.getByRole("button", { name: "中止" }).click();
  await expect(page.getByText("模考已中止")).toBeVisible();
  expect(dialogs).toContain("中止后本卷作废：已经展示过的题仍计为已做，不会给出成绩。确定中止吗？");
  await expect.poll(() => calls.some((call) => call.action === "finish" && call.attemptId === paper.attemptId)).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "开始模考" })).toBeVisible();
  await expect(page.getByText("模考已中止")).toHaveCount(0);
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
    // 记录页重做（a3c9de5）后：点一行只就地展开速览，要再点「查看模考报告 →」才进逐题回顾。
    await page.getByText(label).last().click();
    await page.getByRole("button", { name: /查看模考报告/ }).click();
    await expect(page.getByTestId("real-mock-review")).toBeVisible();
    await page.getByRole("button", { name: "返回列表" }).click();
  }
  await page.screenshot({ path: path.join(reportDir, "real-mock-history-four-subjects.png"), fullPage: true });
});
