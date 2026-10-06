// 功能引导图 · 截图层：真浏览器打开本地 dev server（就是线上同一套组件），
// 只 mock 后端接口与登录态，界面一律是网站真实渲染出来的样子。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const WORK_ROOT = path.join(ROOT, "scripts/feature-guides/.work");
export const BASE = process.env.GUIDE_BASE || "http://localhost:3100";
export const USER = { code: "TP2026", email: "demo@treepractice.com" };
/** 截图时钟：所有页面都停在这个时刻（北京时间周日晚上），日期/「今天」类文案才稳定。 */
export const NOW = new Date(process.env.GUIDE_NOW || "2026-10-04T21:30:00+08:00");

const FONT_CACHE = path.join(WORK_ROOT, "fontcache");

/** 某一套图的工作目录：shots/ 截图、meta.json 元素坐标、posters.html、out/ 成图。 */
export function workDir(set) {
  const dir = path.join(WORK_ROOT, set);
  const shots = path.join(dir, "shots");
  fs.mkdirSync(shots, { recursive: true });
  const metaFile = path.join(dir, "meta.json");
  const readMeta = () => (fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : {});
  return {
    dir, shots, metaFile, readMeta,
    saveMeta: (patch) => fs.writeFileSync(metaFile, JSON.stringify({ ...readMeta(), ...patch }, null, 1)),
  };
}

export async function launch() {
  // Playwright 默认强制 loopback 也走代理；本地 dev server 必须直连
  process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = "1";
  const preset = "/opt/pw-browsers/chromium"; // 云端沙箱预装的 Chromium
  const executablePath = process.env.PW_CHROMIUM || (fs.existsSync(preset) ? preset : undefined);
  return chromium.launch(executablePath ? { executablePath } : {});
}

export async function assertServer() {
  try {
    const res = await fetch(BASE, { redirect: "manual" });
    if (res.status < 500) return;
  } catch {}
  throw new Error(`连不上 ${BASE}：先在仓库根目录跑 \`npx next dev -p 3100\`（或设 GUIDE_BASE 指到已启动的地址）`);
}

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// 首次访问会弹的公告/问卷/引导，全部标成「已看过」，截图里只留功能本身。
// 发了新公告（data/announcements.json）要把 announcement-dismissed 改成最新的 id。
const QUIET = {
  "toefl-bank-update-2026-06-02": "1",
  "toefl-announcement-dismissed": "2026-10-04-v1.27.0",
  "voice-upgrade-vote-2026-06": "dismissed",
  "toefl-desktop-tip-dismissed": "1",
  "toefl-feature-spotlight-seen": JSON.stringify({ "my-bank-2026-07": 1 }),
  "toefl-pro-trial-notified": "1",
  "toefl-import-dismissed": "1",
  "toefl-referral-banner-dismissed-at": String(Date.now()),
};

/**
 * 网站真实字体（layout.js 引的 Google Fonts：Plus Jakarta Sans / Noto Sans SC）。
 * 浏览器自己走代理拉 Google Fonts 不稳，这里用 curl（认 HTTPS_PROXY）拉到本地缓存再喂回去；
 * 拉不到就放行让浏览器自己试，最差也只是回落到系统字体。
 */
async function serveFont(route) {
  const req = route.request();
  const url = req.url();
  fs.mkdirSync(FONT_CACHE, { recursive: true });
  const file = path.join(FONT_CACHE, crypto.createHash("sha1").update(url).digest("hex"));
  const isCss = url.includes("fonts.googleapis.com");
  try {
    if (!fs.existsSync(file)) {
      const ua = req.headers()["user-agent"] || "Mozilla/5.0 Chrome/140 Safari/537.36";
      execFileSync("curl", ["-sS", "-L", "--fail", "--max-time", "60", "-A", ua, "-o", file, url]);
    }
    return await route.fulfill({
      status: 200,
      contentType: isCss ? "text/css; charset=utf-8" : "font/woff2",
      headers: { "access-control-allow-origin": "*" },
      body: fs.readFileSync(file),
    });
  } catch {
    try { fs.rmSync(file, { force: true }); } catch {}
    return route.continue();
  }
}

/**
 * 一个浏览器上下文 = 一台设备。默认电脑版 1440×900（引导图一律用电脑页面截图），mobile: true 才是手机。
 * auth：写入登录态（Pro）；seed：首次加载前写进 localStorage 的键值（单词本数据等）。
 * ctx.onApi(route, req, url)：返回 true 表示这个接口已自行处理（例如 /api/ai）；没处理的 /api/* 一律回 { ok: true }。
 * ctx.apiLog：页面调过的接口清单——页面空白/报错时先看它，缺哪个接口就在 onApi 里补数据。
 */
export async function newCtx(browser, { mobile = false, auth = true, now = NOW, seed = null, width, height, dpr } = {}) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: width || 390, height: height || 844 } : { width: width || 1440, height: height || 900 },
    deviceScaleFactor: dpr || 3,
    isMobile: mobile,
    hasTouch: mobile,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    userAgent: mobile ? IPHONE_UA : undefined,
  });
  if (now) await ctx.clock.install({ time: now });
  await ctx.addInitScript(({ auth, user, seed, quiet }) => {
    try {
      for (const [k, v] of Object.entries(quiet)) if (localStorage.getItem(k) == null) localStorage.setItem(k, v);
      if (auth) {
        localStorage.setItem("toefl-user-code", user.code);
        localStorage.setItem("toefl-user-tier", "pro");
        localStorage.setItem("toefl-auth-method", "email");
        localStorage.setItem("toefl-user-email", user.email);
        localStorage.setItem("toefl-has-password", "true");
      }
      // 只在这个标签页第一次加载时写：之后页面自己改的数据（评分、收藏）不能被覆盖回去
      if (seed && !sessionStorage.getItem("__seeded")) {
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
        sessionStorage.setItem("__seeded", "1");
      }
    } catch {}
  }, { auth, user: USER, seed, quiet: QUIET });
  await ctx.route("https://fonts.googleapis.com/**", serveFont);
  await ctx.route("https://fonts.gstatic.com/**", serveFont);
  ctx.apiLog = [];
  await ctx.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return route.continue();
    ctx.apiLog.push(`${req.method()} ${url.pathname}${url.search}`);
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const p = url.pathname;
    if (p.startsWith("/api/auth/verify-code")) return json({ valid: true, tier: "pro", email: USER.email, auth_method: "email", has_password: true, pro_trial: false });
    if (p.startsWith("/api/survey/first-set")) return json({ ok: true, alreadyAsked: true, shouldShow: false });
    if (p.startsWith("/api/vocab/logs")) return json({ ok: true });
    // 单词本云同步：云端视为空，本地 localStorage 就是全部数据（与线上「本地优先」一致）
    if (p.startsWith("/api/vocab")) return req.method() === "GET" ? json({ ok: true, cards: [], nextCursor: null }) : json({ ok: true });
    if (p.startsWith("/api/audio/")) return route.continue();
    if (ctx.onApi && (await ctx.onApi(route, req, url))) return;
    return json({ ok: true });
  });
  return ctx;
}

/** 截图前必须：等字体真正换上。 */
export async function fontsReady(page) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(300);
}

/**
 * 网站 body 没设 font-family，划词弹窗这类挂在 body 上的浮层用浏览器默认字体：
 * Windows 中文 Chrome（html lang=zh-CN）下是微软雅黑这类无衬线体，而 Linux 沙箱默认是衬线体。
 * 截图统一按无衬线渲染，接近大多数用户实际看到的样子。
 */
export async function sansDefault(page) {
  await page.addStyleTag({ content: "body{font-family:'Noto Sans SC','Segoe UI',sans-serif}" });
}

/** 在页面文本里找到 phrase（第 nth 次出现），返回其中 word 的视口框。 */
export async function wordRect(page, phrase, word, nth = 0) {
  return page.evaluate(({ phrase, word, nth }) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n = 0;
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent || "";
      let from = 0;
      let idx;
      while ((idx = text.indexOf(phrase, from)) >= 0) {
        if (n++ === nth) {
          const off = idx + phrase.indexOf(word);
          const r = document.createRange();
          r.setStart(node, off);
          r.setEnd(node, off + word.length);
          const b = r.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height };
        }
        from = idx + 1;
      }
    }
    return null;
  }, { phrase, word, nth });
}

/** 把这个词滚到视口（或它所在的滚动容器）高度的 frac 处。 */
export async function scrollWordTo(page, phrase, word, nth = 0, frac = 0.3) {
  await page.evaluate(({ phrase, word, nth, frac }) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n = 0, node, hit = null;
    while (!hit && (node = walker.nextNode())) {
      const text = node.textContent || "";
      let from = 0, idx;
      while ((idx = text.indexOf(phrase, from)) >= 0) { if (n++ === nth) { hit = { node, off: idx + phrase.indexOf(word) }; break; } from = idx + 1; }
    }
    if (!hit) return;
    const range = document.createRange();
    range.setStart(hit.node, hit.off); range.setEnd(hit.node, hit.off + word.length);
    const r = range.getBoundingClientRect();
    let el = hit.node.parentElement;
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2) break;
      el = el.parentElement;
    }
    if (el && el !== document.body) { const cr = el.getBoundingClientRect(); el.scrollTop += (r.top - cr.top) - cr.height * frac; }
    else window.scrollBy(0, r.top - window.innerHeight * frac);
  }, { phrase, word, nth, frac });
  await page.waitForTimeout(350);
}

/** 像用户一样点一下这个词（真实鼠标事件，走 WordLookupLayer 自己的取词逻辑）。 */
export async function clickWord(page, phrase, word, nth = 0, frac = 0.3) {
  await scrollWordTo(page, phrase, word, nth, frac);
  const r = await wordRect(page, phrase, word, nth);
  if (!r) throw new Error(`word not found: ${word} in "${phrase}"`);
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  return r;
}

/** 收集 root 里所有按钮/短文本元素的框（视口 CSS px），给标注用。 */
export async function boxesIn(page, rootSelector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const out = [];
    const rb = root.getBoundingClientRect();
    out.push({ key: "__root", text: "", x: rb.x, y: rb.y, w: rb.width, h: rb.height });
    root.querySelectorAll("button, span, strong, div, em, small, label, input, textarea, h1, h2, i").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const text = (el.innerText || el.value || "").trim().replace(/\s+/g, " ");
      if (el.tagName !== "BUTTON" && el.tagName !== "INPUT" && text.length > 80) return;
      out.push({ tag: el.tagName, text: text.slice(0, 80), aria: el.getAttribute("aria-label") || "", x: r.x, y: r.y, w: r.width, h: r.height });
    });
    return out;
  }, rootSelector);
}

/**
 * 按文字找元素框：specs = { 名字: { text, tag?, exact?, aria? } }，取包含该文字的「最小」可见元素。
 * 返回 { 名字: {x,y,w,h} | null }（视口 CSS px）。
 */
export async function findBoxes(page, specs) {
  return page.evaluate((specs) => {
    const out = {};
    const all = [...document.querySelectorAll("body *")].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) !== 0;
    });
    for (const [name, spec] of Object.entries(specs)) {
      const cands = all.filter((el) => {
        if (spec.tag && el.tagName !== spec.tag) return false;
        const t = (el.innerText || el.value || "").trim().replace(/\s+/g, " ");
        const a = el.getAttribute("aria-label") || "";
        if (spec.aria) return a === spec.aria || a.includes(spec.aria);
        return spec.exact ? t === spec.text : t.includes(spec.text);
      }).map((el) => el.getBoundingClientRect());
      if (!cands.length) { out[name] = null; continue; }
      cands.sort((a, b) => a.width * a.height - b.width * b.height);
      const r = cands[0];
      out[name] = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return out;
  }, specs);
}

/** 整屏截图 + 记下要标注的元素框；返回写进 meta.json 的那一条。 */
export async function snap(page, wd, name, specs = null, { settle = 350 } = {}) {
  await page.waitForTimeout(settle);
  const vp = page.viewportSize();
  await page.screenshot({ path: path.join(wd.shots, `${name}.png`) });
  const boxes = specs ? await findBoxes(page, specs) : {};
  const missing = Object.entries(boxes).filter(([, b]) => !b).map(([k]) => k);
  if (missing.length) console.warn(`  ! ${name}: 没找到 ${missing.join(", ")}`);
  return { [name]: { file: `${name}.png`, clip: { x: 0, y: 0, w: vp.width, h: vp.height }, boxes } };
}

/** 按区域截图（CSS px 的 clip）。 */
export async function shootClip(page, wd, name, clip) {
  const c = { x: Math.max(0, Math.round(clip.x)), y: Math.max(0, Math.round(clip.y)), width: Math.round(clip.w), height: Math.round(clip.h) };
  await page.screenshot({ path: path.join(wd.shots, `${name}.png`), clip: c });
  return { file: `${name}.png`, clip: { x: c.x, y: c.y, w: c.width, h: c.height } };
}

/**
 * 沙箱里的 Chromium 没有系统 TTS 语音：把「念完了」模拟出来，听力复习才走得到翻面那一步。
 * 只替换浏览器能力，界面与流程仍是网站自己的。用法：ctx.addInitScript(SPEECH_MOCK)。
 */
export const SPEECH_MOCK = () => {
  const voices = [{ name: "Samantha", lang: "en-US", default: true, localService: true, voiceURI: "Samantha" }];
  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices: () => voices,
    speak(u) { setTimeout(() => { u.onstart && u.onstart(); setTimeout(() => { u.onend && u.onend(); }, 500); }, 40); },
    cancel() {}, pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {},
  };
  try { Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true }); } catch {}
  if (typeof window.SpeechSynthesisUtterance !== "function") window.SpeechSynthesisUtterance = function (text) { this.text = text; };
};
