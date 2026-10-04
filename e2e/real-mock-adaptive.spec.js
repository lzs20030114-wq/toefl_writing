const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

test.setTimeout(90_000);
const reportDir = path.join(process.cwd(), "reports", "realbank-mock-verification-2026-10-02");
fs.mkdirSync(reportDir, { recursive: true });

function ctw(id, role) {
  const words = Array.from({ length: 10 }, (_, i) => `word${i}`);
  return {
    id, taskType: "ctw", realMockKey: id, realMockRole: role,
    passage: words.join(" "),
    blanks: words.map((word, position) => ({ position, original_word: word, displayed_fragment: word.slice(0, 2) })),
  };
}
function mcq(id, type, count, role) {
  return {
    id, taskType: type, realMockKey: id, realMockRole: role,
    text: `Passage ${id}`, passage: `Passage ${id}`,
    questions: Array.from({ length: count }, (_, i) => ({ stem: `Question ${i + 1} ${id}`, options: { A: "One", B: "Two", C: "Three", D: "Four" }, correct_answer: "A" })),
  };
}
function lcr(id, role) {
  return { id, taskType: "lcr", realMockKey: id, realMockRole: role, speaker: "Hello", options: { A: "Yes", B: "No", C: "Maybe", D: "Later" }, answer: "A" };
}
function paper(section, firstSeconds = 6) {
  const common = { attemptId: `browser-${section}`, userCode: "ABC123", section, templateVersion: "2026-full-v1", routeThreshold: 0.6 };
  if (section === "reading") return {
    ...common,
    timing: { module1Seconds: firstSeconds, module2Seconds: { upper: 6, lower: 6 } },
    m1Items: [ctw("r-sc-ctw", "scored"), mcq("r-sc-rdl2", "rdl", 2, "scored"), mcq("r-sc-rdl3", "rdl", 3, "scored"), mcq("r-sc-ap", "ap", 5, "scored"), ctw("r-extra-ctw", "practice-extra"), mcq("r-extra-rdl2", "rdl", 2, "practice-extra"), mcq("r-extra-rdl3", "rdl", 3, "practice-extra")],
    m2ByPath: {
      upper: [ctw("r-up-ctw", "scored"), mcq("r-up-ap", "ap", 5, "scored")],
      lower: [ctw("r-lo-ctw", "scored"), mcq("r-lo-rdl2", "rdl", 2, "scored"), mcq("r-lo-rdl3", "rdl", 3, "scored")],
    },
  };
  const lcrs = (prefix, n, role) => Array.from({ length: n }, (_, i) => lcr(`${prefix}-${i}`, role));
  return {
    ...common,
    timing: { module1Seconds: firstSeconds, module2Seconds: { upper: 6, lower: 6 } },
    m1Items: [...lcrs("l-sc", 8, "scored"), mcq("l-sc-lc1", "lc", 2, "scored"), mcq("l-sc-lc2", "lc", 2, "scored"), mcq("l-sc-la1", "la", 2, "scored"), mcq("l-sc-la2", "la", 2, "scored"), mcq("l-sc-lat", "lat", 4, "scored"), ...lcrs("l-extra", 4, "practice-extra"), mcq("l-extra-lc", "lc", 2, "practice-extra"), mcq("l-extra-la", "la", 2, "practice-extra"), mcq("l-extra-lat", "lat", 4, "practice-extra")],
    m2ByPath: {
      upper: [...lcrs("l-up", 3, "scored"), mcq("l-up-lc1", "lc", 2, "scored"), mcq("l-up-lc2", "lc", 2, "scored"), mcq("l-up-lat1", "lat", 4, "scored"), mcq("l-up-lat2", "lat", 4, "scored")],
      lower: [...lcrs("l-lo", 7, "scored"), mcq("l-lo-lc1", "lc", 2, "scored"), mcq("l-lo-lc2", "lc", 2, "scored"), mcq("l-lo-la1", "la", 2, "scored"), mcq("l-lo-la2", "la", 2, "scored")],
    },
  };
}

async function auth(page, code = "ABC123") {
  await page.addInitScript((userCode) => {
    if (!localStorage.getItem("toefl-user-code")) localStorage.setItem("toefl-user-code", userCode);
    localStorage.setItem("toefl-user-tier", "pro");
  }, code);
  // These browser checks exercise the actual page and task components while
  // keeping every non-fixture API, Supabase write, audio and AI call offline.
  // Each test registers its real-mock fixture route after this broad guard.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if ((url.hostname !== "127.0.0.1" && url.hostname !== "localhost") || url.pathname.startsWith("/api/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    return route.continue();
  });
}

test("cloud prepare failure keeps the real reading exam on its intro", async ({ page }) => {
  await auth(page);
  await page.route("**/api/real-mock-exam", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "CLOUD_UNAVAILABLE", error: "云端暂时不可用" }) }));
  await page.goto("/reading-exam?source=real-bank");
  await expect(page.getByRole("heading", { name: "真题阅读自适应模考" })).toBeVisible();
  await page.getByRole("button", { name: "开始考试" }).click();
  await expect(page.getByText(/云端暂时不可用/)).toBeVisible();
  await expect(page.getByText("Module 1 · Routing")).toHaveCount(0);
  await page.screenshot({ path: path.join(reportDir, "reading-cloud-failure.png"), fullPage: true });
});

test("real reading task stays hidden until seen succeeds, then a timeout routes with unreached items unseen", async ({ page }) => {
  await auth(page);
  const exam = paper("reading", 4);
  const calls = [];
  let releaseSeen;
  await page.route("**/api/real-mock-exam", async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper: exam }) });
    if (body.action === "seen" && !releaseSeen) {
      await new Promise((resolve) => { releaseSeen = resolve; });
    }
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/reading-exam?source=real-bank");
  await page.getByRole("button", { name: "开始考试" }).click();
  await expect(page.getByText("正在确认这道题的已见记录…")).toBeVisible();
  await expect(page.getByText("Complete the Words")).toHaveCount(0);
  releaseSeen();
  await expect(page.getByText("Complete the Words")).toBeVisible();
  await page.screenshot({ path: path.join(reportDir, "reading-first-seen.png"), fullPage: true });
  await expect(page.getByText("正在进入下一模块…")).toBeVisible({ timeout: 15_000 });
  // Real mode names the routes 进阶 / 普通 everywhere (was "Module 2 · Lower" before the copy fix).
  await expect(page.getByText("Module 2 · 普通").first()).toBeVisible({ timeout: 15_000 });
  expect(calls.filter((c) => c.action === "seen").every((c) => c.items.every((it) => it.id === "r-sc-ctw" || it.id.startsWith("r-lo")))).toBe(true);
  expect(calls.filter((c) => c.action === "route")[0].path).toBe("lower");
  await expect(page.getByText("真题阅读模考结果")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: path.join(reportDir, "reading-lower-result.png"), fullPage: true });
  await expect(page.getByText("计分题原始分 0/35")).toBeVisible();
  expect(calls.filter((c) => c.action === "seen" && c.answered).map((c) => c.items[0].id)).toEqual(["r-sc-ctw", "r-lo-ctw"]);
});

test("seen failure blocks the actual reading task until retry succeeds", async ({ page }) => {
  await auth(page);
  const exam = paper("reading", 20);
  let seenCalls = 0;
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper: exam }) });
    if (body.action === "seen" && ++seenCalls === 1) return route.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false,"error":"记录暂时失败"}' });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/reading-exam?source=real-bank");
  await page.getByRole("button", { name: "开始考试" }).click();
  await expect(page.getByText("记录暂时失败")).toBeVisible();
  await expect(page.getByText("Complete the Words")).toHaveCount(0);
  await page.getByRole("button", { name: "重试加载" }).click();
  await expect(page.getByText("Complete the Words")).toBeVisible();
  expect(seenCalls).toBe(2);
  await page.screenshot({ path: path.join(reportDir, "reading-seen-retry.png"), fullPage: true });
});

test("listening resumes the actual shell on upper route and a wrong account cannot see that checkpoint", async ({ page }) => {
  const exam = paper("listening", 1);
  const checkpoint = {
    phase: "module1", m1Items: exam.m1Items, m2Items: null,
    m1Results: exam.m1Items.slice(0, -1).map((it) => ({ item: it, correct: it.realMockRole === "scored" ? (it.taskType === "lcr" ? 1 : it.questions.length) : 0, total: it.taskType === "lcr" ? 1 : it.questions.length })),
    m2Results: [], currentItemIndex: exam.m1Items.length - 1, routePath: null,
    timeLeft: 0, usedIds: exam.m1Items.map((it) => it.id), seenItemIds: exam.m1Items.slice(0, -1).map((it) => it.id),
    paper: exam, source: "real-bank", userCode: "ABC123", templateVersion: exam.templateVersion, savedAt: Date.now(),
  };
  const key = "toefl-adaptive-checkpoint:real-bank:ABC123:2026-full-v1:listening";
  await auth(page, "OTHER1");
  await page.addInitScript(([storageKey, value]) => localStorage.setItem(storageKey, JSON.stringify(value)), [key, checkpoint]);
  await page.route("**/api/real-mock-exam", (route) => route.fulfill({ contentType: "application/json", body: '{"ok":true}' }));
  await page.goto("/listening-exam?source=real-bank");
  await expect(page.getByRole("button", { name: "继续上次模考" })).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("toefl-user-code", "ABC123"));
  await page.reload();
  await expect(page.getByRole("button", { name: "继续上次模考" })).toBeVisible();
  await page.getByRole("button", { name: "继续上次模考" }).click();
  await expect(page.getByText("正在进入下一模块…")).toBeVisible({ timeout: 10_000 });
  // Real mode names the routes 进阶 / 普通 everywhere (was "Module 2 · Upper" before the copy fix).
  await expect(page.getByText("Module 2 · 进阶").first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: path.join(reportDir, "listening-upper-module.png"), fullPage: true });
  await expect(page.getByText("真题听力模考结果")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: path.join(reportDir, "listening-upper-result.png"), fullPage: true });
});

test("listening starts a fresh full paper and times out through lower to results", async ({ page }) => {
  await auth(page);
  const exam = paper("listening", 3);
  const calls = [];
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper: exam }) });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/listening-exam?source=real-bank");
  await page.getByRole("button", { name: "开始考试" }).click();
  await expect(page.getByText("Choose a Response")).toBeVisible();
  // Real mode names the routes 进阶 / 普通 everywhere (was "Module 2 · Lower" before the copy fix).
  await expect(page.getByText("Module 2 · 普通").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("真题听力模考结果")).toBeVisible({ timeout: 15_000 });
  expect(calls.find((c) => c.action === "route")?.path).toBe("lower");
  expect(calls.filter((c) => c.action === "seen" && !c.answered).map((c) => c.items[0].id)).toEqual(["l-sc-0", "l-lo-0"]);
  await page.screenshot({ path: path.join(reportDir, "listening-lower-result.png"), fullPage: true });
});

test("reading CTW input survives refresh and explicit resume of the same real paper", async ({ page }) => {
  await auth(page);
  const exam = paper("reading", 120);
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper: exam }) });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/reading-exam?source=real-bank");
  await page.getByRole("button", { name: "开始考试" }).click();
  const firstBlank = page.locator('input[maxlength]').first();
  await firstBlank.fill("rd0");
  const key = "toefl-adaptive-checkpoint:real-bank:ABC123:2026-full-v1:reading";
  await expect.poll(() => page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey) || "{}").currentPartial?.data?.answers?.[0], key)).toBe("rd0");
  await page.reload();
  await page.getByRole("button", { name: "继续上次模考" }).click();
  await expect(page.locator('input[maxlength]').first()).toHaveValue("rd0");
  await page.screenshot({ path: path.join(reportDir, "reading-ctw-resumed-input.png"), fullPage: true });
});

test("reading passage selection and question position survive refresh", async ({ page }) => {
  await auth(page);
  const exam = paper("reading", 120);
  const key = "toefl-adaptive-checkpoint:real-bank:ABC123:2026-full-v1:reading";
  const checkpoint = {
    phase: "module1", m1Items: exam.m1Items, m2Items: null,
    m1Results: [{ item: exam.m1Items[0], correct: 0, total: 10 }], m2Results: [],
    currentItemIndex: 1, routePath: null, timeLeft: 120,
    usedIds: exam.m1Items.map((it) => it.id), seenItemIds: [exam.m1Items[0].id],
    paper: exam, source: "real-bank", userCode: "ABC123", templateVersion: exam.templateVersion, savedAt: Date.now(),
  };
  await page.addInitScript(([storageKey, value]) => {
    if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify(value));
  }, [key, checkpoint]);
  await page.route("**/api/real-mock-exam", (route) => route.fulfill({ contentType: "application/json", body: '{"ok":true}' }));
  await page.goto("/reading-exam?source=real-bank");
  await page.getByRole("button", { name: "继续上次模考" }).click();
  await expect(page.getByText("Question 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "B Two" }).click();
  await page.getByRole("button", { name: "下一题" }).click();
  await expect.poll(() => page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey) || "{}").currentPartial?.data?.currentQ, key)).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "继续上次模考" }).click();
  await expect(page.getByText("Question 2 of 2")).toBeVisible();
  await page.getByRole("button", { name: "上一题" }).click();
  await expect(page.getByRole("button", { name: "B Two" })).toHaveCSS("border-color", "rgb(59, 130, 246)");
  await page.screenshot({ path: path.join(reportDir, "reading-rdl-resumed-selection.png"), fullPage: true });
});

test("listening LCR choice survives refresh while its material starts again", async ({ page }) => {
  await auth(page);
  const exam = paper("listening", 120);
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper: exam }) });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/listening-exam?source=real-bank");
  await page.getByRole("button", { name: "开始考试" }).click();
  await page.getByRole("button", { name: "开始答题" }).click();
  await page.getByRole("button", { name: "B No" }).click();
  const key = "toefl-adaptive-checkpoint:real-bank:ABC123:2026-full-v1:listening";
  await expect.poll(() => page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey) || "{}").currentPartial?.data?.selected, key)).toBe("B");
  await page.reload();
  await page.getByRole("button", { name: "继续上次模考" }).click();
  await expect(page.getByRole("button", { name: "开始答题" })).toBeVisible();
  await page.getByRole("button", { name: "开始答题" }).click();
  await expect(page.getByRole("button", { name: "B No" })).toHaveCSS("border-color", "rgb(139, 92, 246)");
  await page.screenshot({ path: path.join(reportDir, "listening-lcr-resumed-choice.png"), fullPage: true });
});

const READING_CHECKPOINT_KEY = "toefl-adaptive-checkpoint:real-bank:ABC123:2026-full-v1:reading";
const savedRealReadingMocks = (page) => page.evaluate(() => (JSON.parse(localStorage.getItem("toefl-hist") || "{}").sessions || [])
  .filter((s) => s.details?.realMock === true && s.details?.section === "reading"));

test("a failed finish still shows the results and keeps the saved record", async ({ page }) => {
  await auth(page);
  const exam = paper("reading", 3);
  const calls = [];
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper: exam }) });
    if (body.action === "finish") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "REAL_MOCK_ERROR", error: "真题模考服务暂不可用，请稍后重试。" }) });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/reading-exam?source=real-bank");
  await page.getByRole("button", { name: "开始考试" }).click();
  await expect(page.getByText("真题阅读模考结果")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/结束真题模考失败/)).toHaveCount(0);
  const records = await savedRealReadingMocks(page);
  expect(records).toHaveLength(1);
  expect(records[0].details.attemptId).toBe(exam.attemptId);
  // The finish is retried in the background and remembered for the next prepare.
  await expect.poll(() => calls.filter((c) => c.action === "finish").length).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("toefl-real-mock-pending-finish") || "[]").map((x) => x.attemptId))).toContain(exam.attemptId);
  await page.screenshot({ path: path.join(reportDir, "reading-finish-failure-result.png"), fullPage: true });
});

test("another unfinished paper is released only by the confirmed release button, never by a retry", async ({ page }) => {
  await auth(page);
  const exam = paper("reading", 120);
  const prepares = [];
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "prepare") {
      prepares.push(body);
      if (!body.restartAttemptId) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, code: "ACTIVE_ATTEMPT", activeAttemptId: "other-device-attempt", error: "已有正在进行的真题模考，请续考或选择重新开始。" }) });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper: exam }) });
    }
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/reading-exam?source=real-bank");
  await page.getByRole("button", { name: "开始考试" }).click();
  await expect(page.getByText(/没做完的同科真题模考/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重试", exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(reportDir, "reading-active-attempt.png"), fullPage: true });
  const release = page.getByRole("button", { name: "放弃那份试卷并重新组卷" });
  // Dismissing the confirm keeps the other paper alive: nothing is sent.
  page.once("dialog", (dialog) => dialog.dismiss());
  await release.click();
  await expect(page.getByText(/没做完的同科真题模考/)).toBeVisible();
  // Accepting it releases exactly that paper.
  let confirmText = "";
  page.once("dialog", (dialog) => { confirmText = dialog.message(); return dialog.accept(); });
  await release.click();
  await expect(page.getByText("Complete the Words")).toBeVisible();
  expect(confirmText).toContain("确定放弃那份没做完的试卷吗");
  expect(prepares.map((p) => p.restartAttemptId || null)).toEqual([null, "other-device-attempt"]);
});

test("a paper finished elsewhere offers a fresh paper instead of an endless reload", async ({ page }) => {
  await auth(page);
  const exam = paper("reading", 120);
  const fresh = { ...paper("reading", 120), attemptId: "browser-reading-fresh" };
  const prepares = [];
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "prepare") {
      prepares.push(body);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper: prepares.length === 1 ? exam : fresh }) });
    }
    if (body.action === "seen" && body.attemptId === exam.attemptId) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, code: "ATTEMPT_FINISHED", error: "这份试卷已结束。" }) });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/reading-exam?source=real-bank");
  await page.getByRole("button", { name: "开始考试" }).click();
  await expect(page.getByText(/这份试卷已结束/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重试加载" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "返回真题专区" })).toBeVisible();
  // The dead paper's checkpoint is dropped, so the intro can't offer to continue it.
  expect(await page.evaluate((key) => localStorage.getItem(key), READING_CHECKPOINT_KEY)).toBeNull();
  await page.screenshot({ path: path.join(reportDir, "reading-dead-attempt.png"), fullPage: true });
  await page.getByRole("button", { name: "重新组卷" }).click();
  await expect(page.getByText("Complete the Words")).toBeVisible();
  expect(prepares.map((p) => p.restartAttemptId || null)).toEqual([null, null]);
});

test("a timed-out real reading record stores no content for items never shown", async ({ page }) => {
  await auth(page);
  const exam = paper("reading", 3);
  await page.route("**/api/real-mock-exam", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "prepare") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, paper: exam }) });
    return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/reading-exam?source=real-bank");
  await page.getByRole("button", { name: "开始考试" }).click();
  await expect(page.getByText("真题阅读模考结果")).toBeVisible({ timeout: 30_000 });
  const [record] = await savedRealReadingMocks(page);
  const d = record.details;
  expect(d.seenItemIds).toEqual(["r-sc-ctw", "r-lo-ctw"]);
  expect(d.paperSnapshot).toBeUndefined();
  expect(d.m1.tasks).toBeUndefined();
  expect(d.m2.tasks).toBeUndefined();
  const unseen = d.tasks.filter((t) => !d.seenItemIds.includes(t.itemId));
  expect(unseen.map((t) => t.itemId)).toEqual(["r-sc-rdl2", "r-sc-rdl3", "r-sc-ap", "r-extra-ctw", "r-extra-rdl2", "r-extra-rdl3", "r-lo-rdl2", "r-lo-rdl3"]);
  for (const task of unseen) {
    expect(task).toMatchObject({ unreached: true, results: [] });
    for (const field of ["passage", "text", "questions", "blanks", "options", "answer"]) expect(task[field]).toBeUndefined();
  }
  const json = JSON.stringify(record);
  for (const id of ["r-sc-rdl2", "r-sc-rdl3", "r-sc-ap", "r-extra-rdl2", "r-extra-rdl3", "r-lo-rdl2", "r-lo-rdl3"]) {
    expect(json).not.toContain(`Passage ${id}`);
    expect(json).not.toContain(`Question 1 ${id}`);
  }
  expect(json).not.toContain("r-up-"); // the route not taken is never stored
});
