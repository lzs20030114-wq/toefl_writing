// 第 2 步：在电脑版网页上把每一张要用的画面拍下来，连同要标注的元素坐标写进 .work/vocab/meta.json。
//   node scripts/feature-guides/vocab/capture.mjs                     → 全部
//   node scripts/feature-guides/vocab/capture.mjs lookup review       → 只重拍其中几组
// 组：lookup（查词弹窗：未收藏/已收藏）· ai（AI 讲解 + 加这句语境）· home（单词本首页）· list（我的词库）
//     · review（认词正反面、拼写、拼写核对）· menu（拼写卡 ⋯ 菜单）· rhythm（每 10 词小结、结算页）
//     · listening（听力复习）
//
// 屏幕尺寸：一律 1440×900（16:10，常见笔记本分辨率）。
// 画面全部由网站组件真实渲染；只替换了三样浏览器外的东西：登录态与后端接口（mock）、
// AI 讲解的返回文字（dl-ai 一张，成图上标了「示例」）、听力复习的系统 TTS（沙箱没有语音）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE, launch, newCtx, workDir, assertServer, fontsReady, sansDefault, wordRect,
  boxesIn, findBoxes, snap, SPEECH_MOCK,
} from "../lib/browser.mjs";

const wd = workDir("vocab");
const seedFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "seed-book.json");
const groups = process.argv.slice(2);
const want = (g) => !groups.length || groups.includes(g);
const needSeed = () => {
  if (!fs.existsSync(seedFile)) throw new Error("缺 vocab/seed-book.json：先跑 node scripts/feature-guides/vocab/seed.mjs");
  return JSON.parse(fs.readFileSync(seedFile, "utf8"));
};
const READING = { width: 1440, height: 900 };
// 单词本也用 1440×900：769–1280px 宽时首页是「220px 侧栏 + 内容」网格，复习专注模式收起侧栏后
// 内容会掉进 220px 那一栏（网站的已知问题，见 components/home/theme.js 的 769–1280 媒体查询）。
const VOCAB = { width: 1440, height: 900 };

// 划词弹窗是 portal 到 body 上的 position:fixed 浮层（WordLookupLayer）
const POP = 'body > div[style*="z-index: 4000"]';

await assertServer();
const browser = await launch();
const logConsole = (page) => page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 200)); });

/** 打开一篇学术阅读（甘蔗蟾蜍那篇）→ 作答 → 交卷，停在解析页。划词只在交卷后可用。 */
async function openReview(ctx) {
  const page = await ctx.newPage();
  logConsole(page);
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
  await sansDefault(page);
  await fontsReady(page);
  return page;
}

/** 弹窗开着时：整屏截图 + 被点的词 + 弹窗与其中每个元素的框。 */
async function snapPopover(page, name, word, phrase) {
  await page.waitForTimeout(500);
  const w = await wordRect(page, phrase, word);
  const shot = await snap(page, wd, name);
  const boxes = await boxesIn(page, POP);
  if (!boxes) throw new Error(`${name}: 弹窗没出来`);
  Object.assign(shot[name], { word: w, pop: boxes.find((b) => b.key === "__root"), boxes });
  console.log("  ✓", name);
  return shot;
}

/** 把原文滚动区里的某个词滚到滚动区顶部往下 offset 的位置。 */
async function scrollPassageTo(page, phrase, word, offset) {
  await page.evaluate(({ phrase, word, offset }) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if ((node.textContent || "").includes(phrase)) break;
    let el = node.parentElement;
    while (el && !(/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 2)) el = el.parentElement;
    const off = node.textContent.indexOf(phrase) + phrase.indexOf(word);
    const range = document.createRange();
    range.setStart(node, off);
    range.setEnd(node, off + word.length);
    el.scrollTop += (range.getBoundingClientRect().top - el.getBoundingClientRect().top) - offset;
  }, { phrase, word, offset });
  await page.waitForTimeout(400);
}

if (want("lookup")) {
  console.log("lookup");
  const ctx = await newCtx(browser, { mobile: false, ...READING }); // 新账号：这个词还没收藏
  const page = await openReview(ctx);
  const phrase = "Researchers attribute this expansion";
  const w = await wordRect(page, phrase, "attribute");
  await page.mouse.click(w.x + w.w / 2, w.y + w.h / 2);
  wd.saveMeta(await snapPopover(page, "dl-unsaved", "attribute", phrase));
  await page.locator(POP).getByRole("button", { name: "把...归于" }).click();
  wd.saveMeta(await snapPopover(page, "dl-saved", "attribute", phrase));
  await ctx.close();
}

if (want("ai")) {
  console.log("ai");
  // 老账号：consume 之前从冬眠那篇收藏过 → 弹窗里是「＋ 加这句语境」；再演示 Pro 的 AI 讲解
  const ctx = await newCtx(browser, { mobile: false, ...READING, seed: needSeed() });
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
  const phrase = "consume only the non-toxic";
  await scrollPassageTo(page, phrase, "consume", 150);
  const w = await wordRect(page, phrase, "consume");
  await page.mouse.click(w.x + w.w / 2, w.y + w.h / 2);
  await page.waitForTimeout(600);
  await page.locator(POP).getByRole("button", { name: "讲讲这句里的用法" }).click();
  await page.waitForTimeout(1200);
  // 讲解展开后弹窗按视口限高、内部滚动：像用户一样滚到底，看讲解和按钮
  await page.evaluate((sel) => { const el = document.querySelector(sel); el.scrollTop = el.scrollHeight; }, POP);
  wd.saveMeta(await snapPopover(page, "dl-ai", "consume", phrase));
  await ctx.close();
}

if (want("home")) {
  console.log("home");
  const ctx = await newCtx(browser, { mobile: false, ...VOCAB, seed: needSeed() });
  const page = await ctx.newPage();
  logConsole(page);
  await page.goto(`${BASE}/?section=vocab`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(1200);
  await sansDefault(page);
  await fontsReady(page);
  wd.saveMeta(await snap(page, wd, "dv-home", {
    nav: { text: "单词本", tag: "A" },
    hero: { text: "今日复习", tag: "SECTION" },
    heroTitle: { text: "今日复习", tag: "STRONG" },
    minutes: { text: "预计约", tag: "SPAN" },
    progress: { text: "今日进度", tag: "DIV" },
    readingCol: { text: "阅读复习", exact: true, tag: "STRONG" },
    readingCta: { text: "阅读复习", tag: "BUTTON" },
    chipDue: { text: "到期", tag: "SPAN" },
    chipSpell: { text: "考拼写", tag: "SPAN" },
    listeningCol: { text: "听力复习", exact: true, tag: "STRONG" },
    listeningCta: { text: "听力复习", tag: "BUTTON" },
    overview: { text: "学习概览", tag: "SECTION" },
    forecast: { text: "未来 7 天", tag: "SECTION" },
  }));
  console.log("  ✓ dv-home");
  await ctx.close();
}

if (want("list")) {
  console.log("list");
  const ctx = await newCtx(browser, { mobile: false, ...VOCAB, seed: needSeed() });
  const page = await ctx.newPage();
  logConsole(page);
  await page.goto(`${BASE}/?section=vocab`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(1200);
  await sansDefault(page);
  await fontsReady(page);
  // 按「最容易忘」排：易忘词排在最上面；展开第一个词的 ⋯
  await page.getByRole("combobox", { name: "排序方式" }).selectOption("forgettable");
  await page.waitForTimeout(400);
  const first = page.getByRole("button", { name: /更多操作/ }).first();
  await first.click();
  await page.waitForTimeout(400);
  const h = await findBoxes(page, { t: { text: "我的词库", tag: "H2" } });
  await page.evaluate((dy) => window.scrollBy(0, dy), h.t.y - 90);
  await page.waitForTimeout(400);
  wd.saveMeta(await snap(page, wd, "dv-list", {
    title: { text: "我的词库", tag: "H2" },
    search: { aria: "搜索单词或释义" },
    sort: { aria: "排序方式" },
    segments: { aria: "词表类型" },
    filters: { aria: "状态筛选" },
    head: { text: "此刻记得", tag: "SPAN" },
    leech: { text: "易忘 · 忘过", tag: "SPAN" },
    more: { text: "⋯", exact: true, tag: "BUTTON" },
    context: { text: "语境", exact: true, tag: "EM" },
    actions: { aria: "操作", tag: "DIV" },
    mode: { text: "复习类型", tag: "LABEL" },
    productive: { text: "要会写", tag: "BUTTON" },
    editDef: { text: "编辑释义", tag: "BUTTON" },
    suspend: { text: "暂停复习", tag: "BUTTON" },
    remove: { text: "移除", exact: true, tag: "BUTTON" },
    foot: { text: "显示", tag: "DIV" },
  }));
  // 第一行（展开的那个词）的「此刻记得」和「下次」
  const row = await page.evaluate(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const bar = document.querySelector('[role="img"][aria-label^="此刻记得"]');
    const memory = bar?.parentElement;
    const due = memory?.nextElementSibling;
    return { memory: memory ? rect(memory) : null, due: due ? rect(due) : null };
  });
  const meta = wd.readMeta();
  Object.assign(meta["dv-list"].boxes, row);
  wd.saveMeta({ "dv-list": meta["dv-list"] });
  console.log("  ✓ dv-list");
  await ctx.close();
}

/** 从单词本首页开一场复习（专注模式：侧栏收起，卡片居中）。 */
async function startReview(ctx, mode) {
  const page = await ctx.newPage();
  logConsole(page);
  await page.goto(`${BASE}/?section=vocab`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(1200);
  await sansDefault(page);
  await page.getByRole("button", { name: mode === "listening" ? /听力复习，今天/ : /阅读复习，今天/ }).click();
  await page.waitForTimeout(mode === "listening" ? 1500 : 1000);
  await fontsReady(page);
  return page;
}

// 复习队列不打乱（Math.random 固定）：按到期先后排，第一张就是 attribute。真实用户每次顺序是随机的。
const FIXED_ORDER = () => { Math.random = () => 0.999999; };
const CARD = { // 复习卡上要标注的东西
  progress: { text: "已答", tag: "SPAN" },
  exit: { text: "← 退出", tag: "BUTTON" },
  chip: { text: "认词", exact: true, tag: "SPAN" },
  source: { text: "阅读 · TOEFL", tag: "SPAN" },
  more: { aria: "更多操作" },
  hl: { text: "attribute", exact: true, tag: "STRONG" },
  speak: { aria: "朗读这个词" },
  undo: { text: "撤销上一张", tag: "BUTTON" },
};

if (want("review")) {
  console.log("review");
  const ctx = await newCtx(browser, { mobile: false, ...VOCAB, seed: needSeed() });
  await ctx.addInitScript(FIXED_ORDER);
  const page = await startReview(ctx, "reading");
  wd.saveMeta(await snap(page, wd, "dv-front", { ...CARD, show: { text: "显示答案", tag: "BUTTON" }, hint: { text: "先在心里说出它的意思", tag: "SPAN" } }));
  await page.getByRole("button", { name: /显示答案/ }).click();
  await page.clock.fastForward(4000);
  wd.saveMeta(await snap(page, wd, "dv-back", {
    ...CARD,
    dict: { text: "词典", exact: true, tag: "SPAN" },
    forgot: { text: "忘了", tag: "BUTTON" },
    remember: { text: "记得，去拼写", tag: "BUTTON" },
    hint: { text: "选「记得」后还要写出拼写", tag: "SPAN" },
  }));
  // 背面的主释义（DefLine）：卡片里第一处「把...归于」
  const def = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find((d) => getComputedStyle(d).fontWeight === "600" && d.textContent.trim().startsWith("把...归于"));
    if (!el) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  { const m = wd.readMeta(); m["dv-back"].boxes.def = def; wd.saveMeta({ "dv-back": m["dv-back"] }); }
  await page.getByRole("button", { name: /记得，去拼写/ }).click();
  await page.waitForTimeout(300);
  await page.keyboard.type("atrib", { delay: 60 }); // 拼到一半，漏了一个 t
  await page.clock.fastForward(3000);
  wd.saveMeta(await snap(page, wd, "dv-spell", {
    chip: { text: "拼写", exact: true, tag: "SPAN" },
    prompt: { text: "把...归于", tag: "DIV" },
    cloze: { text: "this expansion to a combination", tag: "DIV" },
    count: { text: "已填", tag: "SPAN" },
    check: { text: "核对拼写", tag: "BUTTON" },
    giveup: { text: "想不起来，显示答案", tag: "BUTTON" },
    more: { aria: "更多操作" },
  }));
  // 原句里那一排下划线（拼写框）
  const slots = await page.evaluate(() => {
    const input = document.activeElement;
    const host = input?.parentElement;
    if (!host) return null;
    const r = host.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  { const m = wd.readMeta(); m["dv-spell"].boxes.slots = slots; wd.saveMeta({ "dv-spell": m["dv-spell"] }); }
  await page.keyboard.type("ute", { delay: 60 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  const shot = await snap(page, wd, "dv-spell-wrong", {
    verdict: { text: "你写的是", tag: "DIV" },
    retry: { text: "再拼一次（提示首字母）", tag: "BUTTON" },
    next: { text: "没拼对，下一词", tag: "BUTTON" },
    rule: { text: "拼对才算记得", tag: "SPAN" },
  });
  shot["dv-spell-wrong"].boxes.letters = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[aria-label]")].find((e) => /正确拼写/.test(e.getAttribute("aria-label")) && e.getBoundingClientRect().height > 20);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  wd.saveMeta(shot);
  console.log("  ✓ dv-front, dv-back, dv-spell, dv-spell-wrong");
  await ctx.close();
}

if (want("menu")) {
  console.log("menu");
  // 拼写卡右上角 ⋯ 展开的菜单（要会写 / 编辑释义 / 暂停复习这个词）：和 dv-spell 同一张卡、同样拼到一半
  const ctx = await newCtx(browser, { mobile: false, ...VOCAB, seed: needSeed() });
  await ctx.addInitScript(FIXED_ORDER);
  const page = await startReview(ctx, "reading");
  await page.getByRole("button", { name: /显示答案/ }).click();
  await page.clock.fastForward(4000);
  await page.getByRole("button", { name: /记得，去拼写/ }).click();
  await page.waitForTimeout(300);
  await page.keyboard.type("atrib", { delay: 60 });
  await page.clock.fastForward(3000);
  await page.getByRole("button", { name: "更多操作" }).click();
  wd.saveMeta(await snap(page, wd, "dv-menu", {
    more: { aria: "更多操作" },
    menu: { aria: "attribute 的操作" },
    productive: { aria: "attribute需要会写" },
    editDef: { text: "编辑释义", exact: true, tag: "BUTTON" },
    suspend: { text: "暂停复习这个词", exact: true, tag: "BUTTON" },
    note: { text: "改动下次出现时生效", tag: "DIV" },
  }));
  console.log("  ✓ dv-menu");
  await ctx.close();
}

if (want("rhythm")) {
  console.log("rhythm（整场阅读复习跑完，约 1 分钟）");
  const ctx = await newCtx(browser, { mobile: false, ...VOCAB, seed: needSeed() });
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
        wd.saveMeta(await snap(page, wd, "dv-checkpoint", {
          dialog: { aria: "复习完成", tag: "DIV" },
          seg: { text: "第 1 段", tag: "SPAN" },
          saved: { text: "✓ 已存档", tag: "SPAN" },
          head: { text: "这 10 个词过完了", tag: "DIV" },
          stats: { text: "本段用时", tag: "DIV" },
          pause: { text: "先休息，退出", tag: "BUTTON" },
          cont: { text: "继续下一段", tag: "BUTTON" },
          note: { text: "忘了的词已排到后面", tag: "DIV" },
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
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  if (!(await page.getByText("这一轮复习完成").count())) throw new Error("rhythm: 没走到结算页");
  wd.saveMeta(await snap(page, wd, "dv-summary", {
    title: { text: "这一轮复习完成", tag: "DIV" },
    first: { text: "第一次就想起来", tag: "DIV" },
    good: { text: "记得", exact: true, tag: "DIV" },
    again: { text: "忘了", exact: true, tag: "DIV" },
    know: { text: "预计记得", exact: true, tag: "DIV" },
    lost: { text: "这一轮忘了的词", tag: "H2" },
    export: { text: "导出这些词 PDF", tag: "BUTTON" },
    next: { text: "NEXT", tag: "DIV" },
    tomorrow: { text: "TOMORROW", tag: "DIV" },
    back: { text: "返回单词本", tag: "BUTTON" },
  }));
  console.log("  ✓ dv-checkpoint, dv-summary");
  await ctx.close();
}

if (want("listening")) {
  console.log("listening");
  const ctx = await newCtx(browser, { mobile: false, ...VOCAB, seed: needSeed() });
  await ctx.addInitScript(FIXED_ORDER);
  await ctx.addInitScript(SPEECH_MOCK);
  const page = await startReview(ctx, "listening");
  await page.getByRole("button", { name: "显示答案" }).click();
  await page.clock.fastForward(3000);
  const shot = await snap(page, wd, "dv-listen", {
    chip: { text: "听词", exact: true, tag: "SPAN" },
    tip: { text: "听发音，回想词义", tag: "SPAN" },
    play: { aria: "播放单词发音" },
    no: { aria: "没听懂" },
    yes: { aria: "听懂了" },
    skip: { text: "跳过这张卡", tag: "BUTTON" },
    undo: { text: "撤销上一张", tag: "BUTTON" },
  });
  Object.assign(shot["dv-listen"].boxes, await page.evaluate(() => {
    const rect = (r) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
    const word = [...document.querySelectorAll("span")].find((el) => getComputedStyle(el).fontSize === "34px");
    if (!word) return {};
    const def = word.parentElement?.nextElementSibling; // 词那一行下面就是释义（DefLine）
    const range = document.createRange();
    if (def) range.selectNodeContents(def);
    return { word: rect(word.getBoundingClientRect()), def: def ? rect(range.getBoundingClientRect()) : null };
  }));
  wd.saveMeta(shot);
  console.log("  ✓ dv-listen");
  await ctx.close();
}

await browser.close();
console.log("→", path.relative(process.cwd(), wd.metaFile));
