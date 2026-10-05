// 第 2 步：在真实页面上把每一张要用的画面拍下来，连同要标注的元素坐标写进 .work/vocab/meta.json。
//   node scripts/feature-guides/vocab/capture.mjs                  → 全部
//   node scripts/feature-guides/vocab/capture.mjs lookup review    → 只重拍其中几组
// 组：lookup（划词弹窗 4 态，电脑版）· m-lookup（划词弹窗，手机版）· overview（单词本首页/入口）
//     · review（认词/拼写）· rhythm（段小结/结算）· listening（听力复习）
//
// 画面全部由网站组件真实渲染；只替换了三样浏览器外的东西：登录态与后端接口（mock）、
// AI 讲解的返回文字（lk-ai 一张，成图上标了「示例」）、听力复习的系统 TTS（沙箱没有语音）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE, launch, newCtx, workDir, assertServer, fontsReady, sansDefault, clickWord, wordRect,
  boxesIn, findBoxes, snap, shootClip, SPEECH_MOCK,
} from "../lib/browser.mjs";

const wd = workDir("vocab");
const seedFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "seed-book.json");
const groups = process.argv.slice(2);
const want = (g) => !groups.length || groups.includes(g);
const needSeed = () => {
  if (!fs.existsSync(seedFile)) throw new Error("缺 vocab/seed-book.json：先跑 node scripts/feature-guides/vocab/seed.mjs");
  return JSON.parse(fs.readFileSync(seedFile, "utf8"));
};

// 划词弹窗是 portal 到 body 上的 position:fixed 浮层（WordLookupLayer）
const POP = 'body > div[style*="z-index: 4000"]';

await assertServer();
const browser = await launch();

/** 打开一篇学术阅读（甘蔗蟾蜍那篇）→ 作答 → 交卷，停在解析页。划词只在交卷后可用。 */
async function openReview(ctx) {
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 200)); });
  await page.goto(`${BASE}/reading?type=ap&mode=practice`, { waitUntil: "networkidle", timeout: 180000 });
  await page.getByText("The cane toad, introduced", { exact: false }).first().click();
  await page.waitForTimeout(1000);
  const answers = ["discourage", "To control insect pests", "They migrated to areas", "To illustrate a behavioral", "Coordinated migration"];
  for (let i = 0; i < answers.length; i++) {
    await page.getByText(answers[i], { exact: false }).first().click();
    await page.waitForTimeout(200);
    if (i < answers.length - 1) { await page.getByRole("button", { name: /下一题/ }).click(); await page.waitForTimeout(250); }
  }
  await page.getByRole("button", { name: /提交全部/ }).click();
  await page.waitForTimeout(1500);
  await fontsReady(page);
  await sansDefault(page);
  return page;
}

/** 弹窗开着时截「原文那几行 + 弹窗」的区域，并记下被点的词、弹窗和弹窗里每个元素的框。 */
async function recordPopover(page, name, word, phrase) {
  await page.waitForTimeout(500);
  const w = await wordRect(page, phrase, word);
  const boxes = await boxesIn(page, POP);
  if (!boxes) throw new Error(`${name}: 弹窗没出来`);
  const pop = boxes.find((b) => b.key === "__root");
  const passage = await page.evaluate((phrase) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if ((node.textContent || "").includes(phrase)) break;
    let el = node?.parentElement;
    while (el && el.parentElement && el.getBoundingClientRect().width < 300) el = el.parentElement;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, phrase);
  const left = Math.min(passage.x, pop.x) - 18;
  const right = Math.max(passage.x + passage.w, pop.x + pop.w) + 18;
  const top = Math.min(w.y - 112, pop.y - 22);
  const bottom = Math.max(w.y + w.h + 40, pop.y + pop.h + 22);
  const shot = await shootClip(page, wd, name, { x: left, y: top, w: right - left, h: bottom - top });
  console.log("  ✓", name);
  return { [name]: { ...shot, word: w, pop, boxes } };
}

if (want("lookup")) {
  console.log("lookup");
  // 新账号：词还没收藏 → 点义项收藏
  {
    const ctx = await newCtx(browser, { mobile: false, width: 900, height: 1400 });
    const page = await openReview(ctx);
    await clickWord(page, "Researchers attribute this expansion", "attribute");
    wd.saveMeta(await recordPopover(page, "lk-unsaved", "attribute", "Researchers attribute this expansion"));
    await page.locator(POP).getByRole("button", { name: "把...归于" }).click();
    wd.saveMeta(await recordPopover(page, "lk-saved", "attribute", "Researchers attribute this expansion"));
    await ctx.close();
  }
  // 老账号：consume 之前从冬眠那篇收藏过 → 「＋ 加这句语境」；再演示 Pro 的 AI 讲解
  {
    const ctx = await newCtx(browser, { mobile: false, width: 900, height: 1800, seed: needSeed() });
    ctx.onApi = async (route, req, url) => {
      if (url.pathname !== "/api/ai") return false;
      // 示例讲解（按 lib/dict/aiSense.js 的 CONTEXT_SENSE_SYSTEM 格式）；截图环境不连 DeepSeek
      const content = JSON.stringify({
        sense: "vt. 吃；食用",
        explanation: "这里 consume 指「吃、食用」，说的是白鹮只吃蟾蜍没毒的内脏。它的核心意思是「把东西用掉」，吃喝、能源、时间都能搭：consume food / energy / time。名词是 consumption，consumer 是「消费者」。",
      });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content }) });
      return true;
    };
    const page = await openReview(ctx);
    await clickWord(page, "consume only the non-toxic", "consume");
    wd.saveMeta(await recordPopover(page, "lk-addctx", "consume", "consume only the non-toxic"));
    await page.locator(POP).getByRole("button", { name: "讲讲这句里的用法" }).click();
    await page.waitForTimeout(1200);
    // 讲解展开后弹窗按视口限高、内部滚动；成图要看全，截图时放开限高
    await page.addStyleTag({ content: `${POP}{max-height:none!important;overflow:visible!important}` });
    wd.saveMeta(await recordPopover(page, "lk-ai", "consume", "consume only the non-toxic"));
    await ctx.close();
  }
}

if (want("m-lookup")) {
  console.log("m-lookup（手机版：交卷后在原文里轻点 attribute）");
  const ctx = await newCtx(browser, { mobile: true });
  const page = await openReview(ctx);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const phrase = "Researchers attribute this expansion";
  // 手机上原文是页面里的一个内部滚动区：把 attribute 那一行滚到滚动区顶部往下 150px，弹窗正好落在它下面
  await page.evaluate(({ phrase }) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if ((node.textContent || "").includes(phrase)) break;
    let el = node.parentElement;
    while (el && !(/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 2)) el = el.parentElement;
    const off = node.textContent.indexOf(phrase) + "Researchers ".length;
    const range = document.createRange();
    range.setStart(node, off);
    range.setEnd(node, off + "attribute".length);
    el.scrollTop += (range.getBoundingClientRect().top - el.getBoundingClientRect().top) - 150;
  }, { phrase });
  await page.waitForTimeout(400);
  const w = await wordRect(page, phrase, "attribute");
  await page.touchscreen.tap(w.x + w.w / 2, w.y + w.h / 2); // 真实的轻点（touchend → WordLookupLayer 取词）
  await page.waitForTimeout(900);
  const shot = await snap(page, wd, "ml-unsaved");
  const boxes = await boxesIn(page, POP);
  if (!boxes) throw new Error("m-lookup: 弹窗没出来");
  Object.assign(shot["ml-unsaved"], { word: w, pop: boxes.find((b) => b.key === "__root"), boxes });
  wd.saveMeta(shot);
  console.log("  ✓ ml-unsaved");
  await ctx.close();
}

if (want("overview")) {
  console.log("overview");
  const seed = needSeed();
  {
    const ctx = await newCtx(browser, { mobile: true, seed });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?section=vocab`, { waitUntil: "networkidle", timeout: 180000 });
    await page.waitForTimeout(1200);
    await sansDefault(page);
    await fontsReady(page);
    wd.saveMeta(await snap(page, wd, "m-home-top", { card: { text: "今天有", tag: "A" } }));
    const t = await findBoxes(page, { t: { text: "单词本", exact: true } });
    await page.evaluate((dy) => window.scrollBy(0, dy), t.t.y - 8);
    await page.waitForTimeout(300);
    wd.saveMeta(await snap(page, wd, "m-vocab-screen", {
      hero: { text: "今日复习", tag: "STRONG" },
      minutes: { text: "预计约", tag: "SPAN" },
      progress: { text: "今日进度", tag: "DIV" },
      readingCol: { text: "阅读复习", exact: true, tag: "STRONG" },
      cta: { text: "阅读复习", tag: "BUTTON" },
      listeningCol: { text: "听力复习", exact: true, tag: "STRONG" },
      listeningCta: { text: "听力复习", tag: "BUTTON" },
    }));
    console.log("  ✓ m-home-top, m-vocab-screen");
    await ctx.close();
  }
  {
    const ctx = await newCtx(browser, { mobile: false, width: 1440, height: 1000, seed });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?section=vocab`, { waitUntil: "networkidle", timeout: 180000 });
    await page.waitForTimeout(1200);
    await sansDefault(page);
    await fontsReady(page);
    wd.saveMeta(await snap(page, wd, "d-vocab", { nav: { text: "单词本", tag: "A" } }));
    console.log("  ✓ d-vocab");
    await ctx.close();
  }
}

/** 从单词本首页开一场阅读/听力复习，滚到卡片顶部对齐。 */
async function startReview(ctx, mode) {
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 200)); });
  await page.goto(`${BASE}/?section=vocab`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(1200);
  await sansDefault(page);
  await page.getByRole("button", { name: mode === "listening" ? /听力复习，今天/ : /阅读复习，今天/ }).click();
  await page.waitForTimeout(mode === "listening" ? 1500 : 1000);
  await fontsReady(page);
  const b = await findBoxes(page, { exit: mode === "listening" ? { aria: "退出复习" } : { text: "← 退出", tag: "BUTTON" } });
  if (b.exit) await page.evaluate((dy) => window.scrollBy(0, dy), b.exit.y - 76);
  await page.waitForTimeout(250);
  return page;
}

// 复习队列不打乱（Math.random 固定）：按到期先后排，第一张就是 attribute。真实用户每次顺序是随机的。
const FIXED_ORDER = () => { Math.random = () => 0.999999; };

if (want("review")) {
  console.log("review");
  const ctx = await newCtx(browser, { mobile: true, seed: needSeed() });
  await ctx.addInitScript(FIXED_ORDER);
  const page = await startReview(ctx, "reading");
  wd.saveMeta(await snap(page, wd, "rv-front", {
    hl: { text: "attribute", exact: true, tag: "STRONG" },
    show: { text: "显示答案", tag: "BUTTON" },
  }));
  await page.getByRole("button", { name: /显示答案/ }).click();
  await page.clock.fastForward(4000);
  wd.saveMeta(await snap(page, wd, "rv-back", {
    forgot: { text: "忘了", tag: "BUTTON" },
    remember: { text: "记得，去拼写", tag: "BUTTON" },
  }));
  await page.getByRole("button", { name: /记得，去拼写/ }).click();
  await page.waitForTimeout(300);
  await page.keyboard.type("atrib", { delay: 60 }); // 拼到一半，漏了一个 t
  await page.clock.fastForward(3000);
  wd.saveMeta(await snap(page, wd, "rv-spell"));
  await page.keyboard.type("ute", { delay: 60 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  const v = await findBoxes(page, { verdict: { text: "你写的是", tag: "DIV" } });
  await page.evaluate((dy) => window.scrollBy(0, dy), v.verdict.y - 150);
  const shot = await snap(page, wd, "rv-spell-wrong2", { retry: { text: "再拼一次（提示首字母）", tag: "BUTTON" } });
  shot["rv-spell-wrong2"].boxes.letters = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[aria-label]")].find((e) => /正确拼写/.test(e.getAttribute("aria-label")) && e.getBoundingClientRect().height > 20);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  wd.saveMeta(shot);
  console.log("  ✓ rv-front, rv-back, rv-spell, rv-spell-wrong2");
  await ctx.close();
}

if (want("rhythm")) {
  console.log("rhythm（整场阅读复习跑完，约 1 分钟）");
  // 小一号的屏（390×700）：段小结弹窗和结算页一屏装得下
  const ctx = await newCtx(browser, { mobile: true, seed: needSeed(), height: 700 });
  await ctx.addInitScript(FIXED_ORDER);
  const page = await startReview(ctx, "reading");
  let r = 0.37;
  const rnd = () => { r = (r * 9301 + 49297) % 233280 / 233280; return r; };
  // 第一张 attribute：记得 → 拼成 atribute → 没拼对
  await page.getByRole("button", { name: /显示答案/ }).click();
  await page.clock.fastForward(4000);
  await page.getByRole("button", { name: /记得，去拼写/ }).click();
  await page.keyboard.type("atribute", { delay: 40 });
  await page.keyboard.press("Enter");
  await page.clock.fastForward(5000);
  await page.getByRole("button", { name: /没拼对，下一词/ }).click();
  // 其余的词：这三个第一次忘了，其他记得；要拼写的照实拼对
  const FORGET = new Set(["sophistication", "offshore", "propagate"]);
  const currentWord = () => page.evaluate(() => {
    const s = [...document.querySelectorAll("span")].find((el) => getComputedStyle(el).letterSpacing === "-0.5px" && /^[A-Za-z][A-Za-z' -]*$/.test(el.textContent.trim()));
    return s ? s.textContent.trim() : null;
  });
  let checkpointDone = false;
  for (let i = 0; i < 90; i++) {
    if (await page.getByText("这一轮复习完成").count()) break;
    if (await page.getByRole("dialog").count()) {
      if (!checkpointDone) {
        await page.clock.fastForward(1500);
        wd.saveMeta(await snap(page, wd, "rv-checkpoint-sm", {
          saved: { text: "✓ 已存档", tag: "SPAN" },
          pause: { text: "先休息，退出", tag: "BUTTON" },
          cont: { text: "继续下一段", tag: "BUTTON" },
        }, { settle: 400 }));
        checkpointDone = true;
      }
      await page.getByRole("button", { name: /继续下一段/ }).click();
      await page.waitForTimeout(250);
      continue;
    }
    const word = await currentWord();
    await page.clock.fastForward(Math.round(5000 + rnd() * 6000));
    const seen = await page.getByText(/再次出现/).count();
    await page.keyboard.press("Space");
    await page.waitForTimeout(120);
    if (word && FORGET.has(word) && !seen) { await page.keyboard.press("1"); await page.waitForTimeout(150); continue; }
    if (await page.getByRole("button", { name: /记得，去拼写/ }).count()) {
      await page.getByRole("button", { name: /记得，去拼写/ }).click();
      await page.clock.fastForward(Math.round(3000 + rnd() * 4000));
      await page.keyboard.type(word || "", { delay: 12 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(120);
      await page.getByRole("button", { name: /下一词/ }).click();
    } else {
      await page.keyboard.press("2");
    }
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  const t = await findBoxes(page, { s: { text: "这一轮复习完成", tag: "DIV" } });
  if (!t.s) throw new Error("rhythm: 没走到结算页");
  await page.evaluate((dy) => window.scrollBy(0, dy), t.s.y - 104);
  const summary = await snap(page, wd, "rv-summary-sm");
  // 「预计记得 98 → 106 +8」里的 +8：成图说明文字引用它，换了演示数据也对得上
  summary["rv-summary-sm"].facts = await page.evaluate(() => {
    const label = [...document.querySelectorAll("div")].find((el) => el.textContent.trim() === "预计记得");
    const row = label?.nextElementSibling;
    const spans = row ? [...row.querySelectorAll("span")] : [];
    return { knowDelta: spans.length ? spans[spans.length - 1].textContent.trim() : "" };
  });
  wd.saveMeta(summary);
  console.log("  ✓ rv-checkpoint-sm, rv-summary-sm");
  await ctx.close();
}

if (want("listening")) {
  console.log("listening");
  const ctx = await newCtx(browser, { mobile: true, seed: needSeed() });
  await ctx.addInitScript(FIXED_ORDER);
  await ctx.addInitScript(SPEECH_MOCK);
  const page = await startReview(ctx, "listening");
  wd.saveMeta(await snap(page, wd, "ls-front", {
    play: { aria: "播放单词发音" },
    show: { aria: "显示答案" },
  }));
  await page.getByRole("button", { name: "显示答案" }).click();
  await page.clock.fastForward(3000);
  const back = await snap(page, wd, "ls-back", { no: { aria: "没听懂" }, yes: { aria: "听懂了" } });
  Object.assign(back["ls-back"].boxes, await page.evaluate(() => {
    const rect = (r) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
    const word = [...document.querySelectorAll("span")].find((el) => getComputedStyle(el).fontSize === "34px");
    if (!word) return {};
    const def = word.parentElement?.nextElementSibling; // 词那一行下面就是释义（DefLine）
    const range = document.createRange();
    if (def) range.selectNodeContents(def);
    return { word: rect(word.getBoundingClientRect()), def: def ? rect(range.getBoundingClientRect()) : null };
  }));
  wd.saveMeta(back);
  console.log("  ✓ ls-front, ls-back");
  await ctx.close();
}

await browser.close();
console.log("→", path.relative(process.cwd(), wd.metaFile));
