// 第 1 步（可选）：用网站自己的单词本代码（saveWord / gradeCard / buildQueue / FSRS-6）
// 模拟一个用了 18 天的演示账号，产出 vocab/seed-book.json（单词本的 localStorage 快照）。
// 仓库里已经提交了一份快照（目前的截图都是用它拍的），平时直接 capture 即可；
// 只有想换一批词/换一种学习进度时才重跑这一步——重跑后图里的数字会变。
//
// 词和原句来自 words.json / words-extra.json —— 全部摘自题库里的阅读文章与听力原文，
// 释义由站内划词词典（public/dict）现查，义项按 pick 选，和用户在弹窗里点义项收藏是同一条路。
// 评分轨迹是固定随机种子模拟的（大多记得、少数忘了、几个易忘词）；FSRS 的间隔扰动用的
// Math.random 也换成了同一个种子，所以同一份代码和词表重跑结果一致。
//
// 需要 `npx next dev -p 3100` 在跑：脚本会临时放一个探针页 app/zz-seed/page.js
// 把 lib/vocab 的真实函数挂到 window 上，跑完即删。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, newCtx, BASE, ROOT, NOW, assertServer } from "../lib/browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const words = [
  ...JSON.parse(fs.readFileSync(path.join(here, "words.json"), "utf8")),
  ...JSON.parse(fs.readFileSync(path.join(here, "words-extra.json"), "utf8")),
];
const probeDir = path.join(ROOT, "app/zz-seed");
const PROBE = `"use client";
// 临时探针页（scripts/feature-guides/vocab/seed.mjs 生成，跑完自动删除，不入库）
import { useEffect, useState } from "react";
import * as store from "../../lib/vocab/vocabStore";
import * as book from "../../lib/vocab/book";
import * as srs from "../../lib/vocab/srs";
import { lookupWord } from "../../lib/dict/lookup";
import { splitSenses } from "../../lib/dict/core";

export default function Seed() {
  const [ok, setOk] = useState(false);
  useEffect(() => { window.__v = { store, book, srs, lookupWord, splitSenses }; setOk(true); }, []);
  return <div id="seed-ready">{ok ? "ready" : "loading"}</div>;
}
`;

await assertServer();
fs.mkdirSync(probeDir, { recursive: true });
fs.writeFileSync(path.join(probeDir, "page.js"), PROBE);
const browser = await launch();
try {
  const ctx = await newCtx(browser, { mobile: false });
  // srs.schedule 的间隔扰动默认用 Math.random：换成种子随机，模拟结果才可复现
  await ctx.addInitScript(() => {
    let s = 7;
    Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.text().startsWith("[sim]")) console.log(m.text().slice(0, 300)); });
  await page.goto(`${BASE}/zz-seed`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForSelector("#seed-ready:has-text('ready')", { timeout: 120000 });
  const result = await page.evaluate(async ({ words, todayIso }) => {
    const { store, book, srs, lookupWord, splitSenses } = window.__v;
    let seed = 20261004; // 固定随机源，结果可复现
    const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const today = new Date(todayIso);
    const at = (daysAgo, hh, mm) => { const d = new Date(today); d.setDate(d.getDate() - daysAgo); d.setHours(hh, mm, 0, 0); return d; };
    const LEECH = new Set(["exacerbate", "propagate", "sophistication"]); // 演示「易忘」
    const SKIP_DAYS = new Set([11, 6]); // 有两天没复习，真实一点

    async function entryFor(w) {
      const e = await lookupWord(w.form);
      if (!e) return null;
      let def = e.t;
      let defFull = "";
      if (w.pick) {
        for (const g of splitSenses(e.t)) {
          const s = g.senses.find((x) => x.includes(w.pick));
          if (s) { def = `${g.pos} ${s}`.trim(); defFull = e.t; break; }
        }
      }
      return { word: e.word, display: e.word, phonetic: e.p || "", def, defFull, tag: e.g || "", sentence: w.sentence, source: w.source, reviewMode: w.mode };
    }

    // attribute 是引导图里的主角：前两次记得，第 5 天忘了一次（当天重学过关），第 3 天又记得
    const FORCE = { attribute: { 9: [3], 8: [3], 5: [1, 3, 3, 3], 3: [3] } };
    let curDay = null;
    function decide(card, t, n) {
      const f = FORCE[card.word]?.[curDay];
      if (f) return f[Math.min(n, f.length - 1)];
      let p;
      if (n > 0) p = 0.86;
      else if (card.state === srs.STATE.NEW) p = 0.7;
      else p = Math.min(0.97, (srs.currentRetrievability(card, t) ?? 0.8) + 0.04);
      if (LEECH.has(card.word)) p = Math.min(p, 0.4);
      return rnd() < p ? srs.RATING.GOOD : srs.RATING.AGAIN;
    }

    function session(start, { limit = Infinity, mode = null, skip = new Set() } = {}) {
      let t = new Date(start);
      const queue = book.buildQueue(store.loadBook(), t, book.DEFAULT_LIMITS, rnd, mode).filter((c) => !skip.has(c.word));
      const seen = {};
      let graded = 0;
      while (queue.length && graded < limit) {
        const card = queue.shift();
        const rating = decide(card, t, seen[card.word] || 0);
        const updated = store.gradeCard(card.word, rating, t, undefined, Math.round(4000 + rnd() * 9000), card.reviewMode);
        graded += 1;
        seen[card.word] = (seen[card.word] || 0) + 1;
        t = new Date(t.getTime() + Math.round(9000 + rnd() * 14000));
        if (updated && (updated.state === srs.STATE.LEARNING || updated.state === srs.STATE.RELEARNING) && seen[card.word] < 6) {
          queue.splice(Math.min(queue.length, 10), 0, updated);
        }
      }
      return { graded };
    }

    const log = [];
    for (let d = 18; d >= 1; d -= 1) {
      const todays = words.filter((w) => w.daysAgo === d);
      let i = 0;
      for (const w of todays) {
        const entry = await entryFor(w);
        if (!entry) { console.log("[sim] no entry", w.form); continue; }
        store.saveWord(entry, at(d, 20, 5 + i * 2));
        i += 1;
      }
      curDay = d;
      if (SKIP_DAYS.has(d)) { log.push(`d-${d}: saved ${todays.length}, skipped review`); continue; }
      const r = session(at(d, 21, Math.floor(rnd() * 20)));
      log.push(`d-${d}: saved ${todays.length}, graded ${r.graded}`);
    }
    // 今天晚上先过了几张阅读词（attribute 留给截图），然后又做了一篇阅读、收了几个新词
    curDay = 0;
    const part = session(at(0, 20, 41), { limit: 8, mode: "reading", skip: new Set(["attribute"]) });
    log.push(`today partial graded ${part.graded}`);
    let k = 0;
    for (const w of words.filter((x) => x.daysAgo === 0)) {
      const entry = await entryFor(w);
      if (entry) { store.saveWord(entry, at(0, 21, 12 + k)); k += 1; }
    }
    log.push(`today saved ${k}`);
    {
      // 截图时复习队列按到期先后排，attribute 要是今天最早到期的那张
      const all = store.loadBook();
      const now = new Date();
      const dueToday = all.filter((c) => c.word !== "attribute" && c.state !== srs.STATE.NEW && srs.isDue(c, now));
      const earliest = Math.min(...dueToday.map((c) => new Date(c.due).getTime()), now.getTime());
      const a = all.find((c) => c.word === "attribute");
      if (a && !(srs.isDue(a, now) && new Date(a.due).getTime() < earliest)) {
        log.push(`patch attribute due ${a.due} -> ${new Date(earliest - 3600000).toISOString()}`);
        a.due = new Date(earliest - 3600000).toISOString();
      }
      // 只有一句语境的词每第 3 次复习轮到裸词卡（book.pickContext）；演示要的是主卡型「原句里认词」
      if (a && a.reps % 3 === 2) { log.push(`patch attribute reps ${a.reps} -> ${a.reps + 1}`); a.reps += 1; }
      store.writeBook(all);
    }
    const cards = store.loadBook();
    const keys = Object.keys(localStorage).filter((key) => key.startsWith("toefl-vocab"));
    return {
      log,
      dump: Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
      stats: book.bookStats(cards, new Date(), book.DEFAULT_LIMITS),
      n: cards.length,
    };
  }, { words, todayIso: NOW.toISOString() });
  console.log(result.log.join("\n"));
  console.log(`cards ${result.n}`, "stats", JSON.stringify(result.stats));
  fs.writeFileSync(path.join(here, "seed-book.json"), JSON.stringify(result.dump));
  console.log("→", path.relative(ROOT, path.join(here, "seed-book.json")));
} finally {
  await browser.close();
  fs.rmSync(probeDir, { recursive: true, force: true });
}
