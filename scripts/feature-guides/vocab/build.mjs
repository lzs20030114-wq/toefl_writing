// 第 3 步：用 capture 拍下的真实截图拼出 9 张 3:4 引导图（.work/vocab/posters.html），
// 再跑 render.mjs 出 PNG。改文案/版式只需改这里，不用重拍。
import fs from "node:fs";
import { workDir } from "../lib/browser.mjs";
import { C, kit, page, cover, ring, badge, cursor, flipArrow, cap, side, union, writeSet } from "../lib/poster.mjs";

const wd = workDir("vocab");
const meta = wd.readMeta();
const { box, boxByText, fig } = kit(meta);
const TOTAL = 9;
const posters = [];
const manifest = [];
const add = (id, name, html) => { posters.push(html); manifest.push({ id, name }); };
const word = (shot) => meta[shot].word; // 弹窗截图里被点的那个词
const pop = (shot) => meta[shot].pop; //   弹窗本身

// ───────── 01 · 封面 ─────────
{
  const a = fig({ shot: "lk-unsaved", crop: { x: 128, y: 449, w: 389, h: 354 }, x: 64, y: 588, s: 1.54, frame: "browser", z: 2, shadow: "0 30px 70px rgba(0,0,0,.35)" });
  const w = a.map(word("lk-unsaved"));
  const b = fig({ shot: "rv-front", crop: { x: 0, y: 112, w: 390, h: 500 }, x: 1016 - 376, y: 548, s: 0.892, frame: "phone", radius: 30, z: 3, shadow: "0 30px 70px rgba(0,0,0,.4)" });
  const hl = b.map(box("rv-front", "hl"));
  const lt = box("rv-spell-wrong2", "letters"); // 拼写核对：漏掉的 t 标红
  const c = fig({ shot: "rv-spell-wrong2", crop: { x: 28, y: lt.y - 36, w: 222, h: 73 }, x: 1016 - 376, y: 1052, s: 1.42, frame: "card", radius: 18, z: 4, shadow: "0 24px 50px rgba(0,0,0,.35)" });
  add("p1", "01-封面", cover({
    total: TOTAL,
    kicker: "TOEFL 备考 · 使用指南",
    title: "读到生词，<mark>点一下</mark>就查<br>收进单词本，按<mark>遗忘曲线</mark>背",
    sub: "阅读、听力交卷后，原文里的生词随手查、随手收；单词本每天替你排好该复习的词。",
    steps: ["点词就查", "点义项收藏", "每天 10 分钟复习"],
    body: [
      a.html, b.html, c.html,
      // 浏览器左侧是裁出来的半截原文，渐隐一下
      `<div style="position:absolute;left:${a.rect.x}px;top:${a.rect.y + 54}px;width:70px;height:${a.rect.h - 54}px;background:linear-gradient(90deg,#fff 10%,rgba(255,255,255,0));z-index:2;border-bottom-left-radius:22px"></div>`,
      ring(w, { pad: 5, radius: 9, width: 4 }),
      cursor(w.x + w.w * 0.78, w.y + w.h * 0.8, { z: 9 }),
      ring(hl, { pad: 4, radius: 8, width: 4, z: 6 }),
    ].join("\n"),
  }));
}

// ───────── 02 · 点词查词 ─────────
{
  const shot = "lk-unsaved";
  const crop = { x: 33, y: 449, w: 484, h: 355 };
  const f = fig({ shot, crop, x: 64, y: 462, s: 952 / crop.w, frame: "browser", url: "treepractice.com/reading" });
  const w = f.map(word(shot));
  const head = f.map(union(boxByText(shot, "/ә'tribju:t/", { tag: "SPAN" }), boxByText(shot, "🔊", { tag: "BUTTON" }), boxByText(shot, "TOEFL", { tag: "SPAN" })));
  const senses = f.map(union(boxByText(shot, "名词", { tag: "SPAN", exact: true }), boxByText(shot, "认为...属于", { tag: "BUTTON" }), boxByText(shot, "〔计算机〕", { tag: "SPAN" })));
  add("p2", "02-点词查词", page({
    n: 2, total: TOTAL, step: ["STEP 1", "查词"],
    title: "交卷后，<mark>点一下生词</mark><br>释义马上弹出来",
    sub: "阅读、听力交卷后的解析页和练习记录里，原文、题干、选项都能直接点词查；词典装在本地，点了马上出。",
    body: [
      f.html,
      ring(w, { pad: 7, radius: 10 }), badge(1, w.x - 7, w.y - 7),
      cursor(w.x + w.w * 0.78, w.y + w.h * 0.8),
      ring(head, { pad: 8 }), badge(2, head.x + head.w + 8, head.y - 8),
      ring(senses, { pad: 10 }), badge(3, senses.x + senses.w + 10, senses.y - 10),
    ].join("\n"),
    legend: [
      { t: "点一下生词", s: "拖选几个词，还能查短语" },
      { t: "音标 · 发音 · 标签", s: "点 🔊 就念给你听" },
      { t: "按词性分好的义项", s: "名词、动词各是什么意思" },
    ],
    legendTop: 1256,
  }));
}

// ───────── 03 · 点义项收藏 ─────────
{
  const shot = "lk-saved";
  const s = 2.06;
  const f = fig({ shot, crop: pop(shot), x: 64, y: 476, s, frame: "card", radius: 12 * s });
  const chip = f.map(boxByText(shot, "把...归于", { tag: "BUTTON" }));
  const mode = f.map(union(boxByText(shot, "阅读词", { tag: "BUTTON" }), boxByText(shot, "听力词", { tag: "BUTTON" })));
  const done = f.map(union(boxByText(shot, "✓ 这句已在卡上", { tag: "BUTTON" }), boxByText(shot, "移出单词本", { tag: "BUTTON" })));
  const sx = 64 + f.rect.w + 44, sw = 1016 - sx;
  // 小图：以后在别的文章又遇到已收藏的词
  const addBtn = boxByText("lk-addctx", "＋ 加这句语境", { tag: "BUTTON" });
  const row = union(addBtn, boxByText("lk-addctx", "移出单词本", { tag: "BUTTON" }));
  const g = fig({ shot: "lk-addctx", crop: { x: row.x - 8, y: row.y - 4, w: row.w + 16, h: row.h + 8 }, x: 98, y: 1226, s, frame: "bare", z: 5 });
  add("p3", "03-点义项收藏", page({
    n: 3, total: TOTAL, step: ["STEP 2", "收藏"],
    title: "点中这句里的意思<br><mark>就收进单词本</mark>",
    sub: "多义词拆成一个个义项：点你在这句里读到的那个，复习时就按它考。不想挑？直接点<q>☆ 收藏到单词本</q>。",
    body: [
      f.html,
      ring(mode, { pad: 8, radius: 999 }), badge(1, mode.x + mode.w + 14, mode.y + mode.h / 2),
      ring(chip, { pad: 8, radius: 999 }), badge(2, chip.x + chip.w + 8, chip.y - 6),
      ring(done, { pad: 8, radius: 999 }), badge(3, done.x + done.w + 14, done.y + done.h / 2),
      side(1, "阅读词 / 听力词", "阅读里默认阅读词；想练听音辨义就选听力词", sx, mode.y + mode.h / 2 - 8, sw),
      side(2, "点义项＝收藏", "复习时就按这个意思考，点错了再点别的就换", sx, chip.y + chip.h / 2 - 8, sw),
      side(3, "收好了", "这句原文也一起存进卡片", sx, done.y + done.h / 2 - 8, sw),
      `<div class="inset" style="top:1150px;height:206px"></div>`,
      `<div style="position:absolute;left:98px;top:1174px;z-index:5"><span style="display:inline-block;font-size:21px;font-weight:700;color:${C.brandDark};background:#E5F5EE;border-radius:8px;padding:4px 12px">以后在别的文章又遇到这个词</span></div>`,
      g.html,
      ring(g.map(addBtn), { pad: 7, radius: 999, z: 6 }),
      `<div style="position:absolute;left:600px;top:1186px;width:390px;z-index:5"><div style="font-size:28px;font-weight:800;line-height:1.35;color:${C.ink}">点「＋ 加这句语境」</div><div style="font-size:23px;font-weight:500;line-height:1.5;color:#5A6E64;margin-top:8px">最多再加 3 句，复习时轮换着考，记住的是词，不是那一句</div></div>`,
    ].join("\n"),
  }));
}

// ───────── 04 · AI 按这句讲（Pro） ─────────
{
  const shot = "lk-ai";
  const s = 1.88;
  const f = fig({ shot, crop: pop(shot), x: 64, y: 474, s, frame: "card", radius: 12 * s });
  const chips = f.map(union(boxByText(shot, "消耗", { tag: "BUTTON" }), boxByText(shot, "消灭", { tag: "BUTTON" }), boxByText(shot, "毁灭", { tag: "BUTTON" }), boxByText(shot, "不及物动词", { tag: "SPAN" })));
  const ai = f.map({ x: 165, y: 1295, w: 268, h: 112 }); // AI 讲解那块蓝底
  const adopt = f.map(union(boxByText(shot, "用这个意思复习", { tag: "BUTTON" }), boxByText(shot, "编辑释义", { tag: "BUTTON" })));
  const sx = 64 + f.rect.w + 44, sw = 1016 - sx;
  add("p4", "04-AI讲这句", page({
    n: 4, total: TOTAL, step: ["STEP 2", "AI 讲解"],
    title: "词典对不上？<br>让 <mark>AI 按这句讲</mark>",
    sub: "Pro 用户点<q>讲讲这句里的用法</q>，AI 讲清这个词在这句里的意思；同一个词在不同句子里的意思，分开记、分开考。",
    body: [
      f.html,
      ring(chips, { pad: 8, radius: 18 }), badge(1, chips.x + chips.w + 8, chips.y - 6),
      ring(ai, { pad: 8, radius: 18 }), badge(2, ai.x + ai.w + 8, ai.y - 6),
      ring(adopt, { pad: 8, radius: 16 }), badge(3, adopt.x + adopt.w + 8, adopt.y - 6),
      side(1, "词典义项对不上", "消耗、消费、消灭……可这句说的是鹮只吃掉蟾蜍没毒的部分", sx, chips.y + 10, sw),
      side(2, "AI 按这句讲", "这里是「吃、食用」，还带上常见搭配和同根词", sx, ai.y + 30, sw),
      side(3, "用这个意思复习", "这句就按「吃；食用」考，也能先改再存", sx, adopt.y - 16, sw),
      `<div style="position:absolute;left:64px;top:${474 + f.rect.h + 14}px;font-size:19px;color:#8A9C93;z-index:3">* 图中 AI 讲解为示例，实际以 AI 当次回答为准</div>`,
      `<div style="position:absolute;left:${64 + f.rect.w - 120}px;top:448px;z-index:6;background:linear-gradient(135deg,#F59E0B,#F97316);color:#fff;font:800 22px/1 'Plus Jakarta Sans',sans-serif;padding:10px 16px;border-radius:999px;box-shadow:0 8px 18px rgba(249,115,22,.35)">PRO</div>`,
    ].join("\n"),
    tip: "点<b>编辑释义</b>，可以先改成你自己的话再保存，复习时就考你写的版本。",
  }));
}

// ───────── 05 · 单词本首页 ─────────
{
  const shot = "m-vocab-screen";
  const f = fig({ shot, crop: { x: 0, y: 0, w: 390, h: 786 }, x: 64, y: 470, s: 1.06, frame: "phone", radius: 40 });
  const hero = f.map(union(box(shot, "hero"), box(shot, "minutes"), box(shot, "progress")));
  const reading = f.map(union(box(shot, "readingCol"), box(shot, "cta"), { x: 31, y: 396, w: 328, h: 100 }));
  const listening = f.map(union(box(shot, "listeningCol"), box(shot, "listeningCta")));
  const rx = 64 + f.rect.w + 46, rw = 1016 - rx;
  // 入口：电脑首页左栏 / 手机首页卡片（都是真实截图）
  const navB = box("d-vocab", "nav");
  const nav = fig({ shot: "d-vocab", crop: { x: navB.x - 10, y: navB.y - 8, w: navB.w + 20, h: navB.h + 16 }, x: rx, y: 540, s: 1.72, frame: "card", radius: 16 });
  const cardB = box("m-home-top", "card");
  const card = fig({ shot: "m-home-top", crop: { x: cardB.x - 6, y: cardB.y - 6, w: cardB.w + 12, h: cardB.h + 12 }, x: rx, y: 668, s: rw / (cardB.w + 12), frame: "bare" });
  add("p5", "05-单词本首页", page({
    n: 5, total: TOTAL, step: ["STEP 3", "复习"],
    title: "打开单词本<br>今天背什么<mark>一目了然</mark>",
    sub: "收藏的词会按遗忘曲线自动排进每天的复习；每天跟着做完当天的量，就不会越攒越多。",
    body: [
      f.html,
      `<div style="position:absolute;left:${rx}px;top:478px;font-size:24px;font-weight:800;color:${C.brandDark};z-index:3;letter-spacing:1px">入口</div>`,
      nav.html,
      `<div style="position:absolute;left:${rx + nav.rect.w + 18}px;top:${540 + nav.rect.h / 2 - 17}px;font-size:23px;font-weight:600;color:#5A6E64;z-index:3">电脑：<br>首页左栏</div>`,
      card.html,
      `<div style="position:absolute;left:${rx}px;top:${668 + card.rect.h + 8}px;font-size:23px;font-weight:600;color:#5A6E64;z-index:3">手机：首页上的单词本卡片，数字＝今天待复习</div>`,
      ring(hero, { pad: 8, radius: 16 }), badge(1, hero.x + hero.w + 8, hero.y - 4),
      ring(reading, { pad: 8, radius: 16 }), badge(2, reading.x + reading.w + 8, reading.y - 4),
      ring(listening, { pad: 8, radius: 16 }), badge(3, listening.x + listening.w + 8, listening.y - 4),
      side(1, "今天要过多少词", "已经排好，还告诉你大约几分钟", rx, 878, rw),
      side(2, "阅读复习", "认词 + 拼写；到期词、新词都在这儿", rx, 1032, rw),
      side(3, "听力复习", "听发音回想意思，和阅读分开练", rx, 1186, rw),
    ].join("\n"),
  }));
}

/** 两部手机左右并排 + 中间箭头，内页 06/07/08 共用。 */
function pair(leftShot, leftCrop, rightShot, rightCrop, labels, { s = 1.07, fy = 486, inset = 0 } = {}) {
  const left = fig({ shot: leftShot, crop: leftCrop, x: 64 + inset, y: fy, s, frame: "phone", radius: 34 });
  const right = fig({ shot: rightShot, crop: rightCrop, x: 1016 - inset - left.rect.w, y: fy, s, frame: "phone", radius: 34 });
  const html = [
    left.html, right.html,
    cap(labels[0], left.rect.x + 22, fy - 18),
    cap(labels[1], right.rect.x + 22, fy - 18),
  ];
  if (!inset) html.push(flipArrow((left.rect.x + left.rect.w + right.rect.x) / 2, fy + 250));
  return { left, right, html: html.join("\n") };
}

// ───────── 06 · 原句认词 ─────────
{
  const { left, right, html } = pair("rv-front", { x: 0, y: 112, w: 390, h: 568 }, "rv-back", { x: 0, y: 276, w: 390, h: 568 }, ["正面", "翻面后"]);
  const hl = left.map(box("rv-front", "hl"));
  const show = left.map(box("rv-front", "show"));
  const def = right.map({ x: 39, y: 532, w: 136, h: 30 }); // 背面主释义「把…归于」
  const btns = right.map(union(box("rv-back", "forgot"), box("rv-back", "remember")));
  add("p6", "06-原句认词", page({
    n: 6, total: TOTAL, step: ["STEP 3", "认词"],
    title: "先在原句里认词<br><mark>想起来</mark>再翻面",
    sub: "正面是你收藏时读到的那句原文，生词高亮；心里先说出它的意思，再翻面对答案。",
    body: [
      html,
      ring(hl, { pad: 6, radius: 10 }), badge(1, hl.x + hl.w / 2, hl.y - 34),
      ring(show, { pad: 6, radius: 18 }), badge(2, show.x + show.w + 4, show.y - 4),
      ring(def, { pad: 8, radius: 12 }), badge(3, def.x + def.w + 8, def.y - 6),
      ring(btns, { pad: 6, radius: 18 }), badge(4, btns.x + btns.w + 4, btns.y - 4),
    ].join("\n"),
    legend: [
      { t: "原句里认词", s: "心里先说出意思" },
      { t: "想好再翻面", s: "点按钮或按空格" },
      { t: "对答案", s: "看这句里的意思" },
      { t: "忘了 / 记得", s: "只有两档，照实选" },
    ],
    legendTop: 1146,
  }));
}

// ───────── 07 · 拼写 ─────────
{
  const { left, right, html } = pair("rv-spell", { x: 0, y: 198, w: 390, h: 568 }, "rv-spell-wrong2", { x: 0, y: 124, w: 390, h: 566 }, ["拼写", "核对后"]);
  const def = left.map({ x: 37, y: 280, w: 202, h: 34 }); //   拼写提示：释义
  const input = left.map({ x: 152, y: 336, w: 150, h: 36 }); // 填进原句的空
  const letters = right.map({ x: 37, y: 174, w: 198, h: 40 });
  const retry = right.map(box("rv-spell-wrong2", "retry"));
  add("p7", "07-拼写", page({
    n: 7, total: TOTAL, step: ["STEP 3", "拼写"],
    title: "要会写的词<br><mark>记得之后再拼一遍</mark>",
    sub: "选<q>记得</q>后要把它拼出来才算数；不想练拼写的词，在卡片右上角 ⋯ 里关掉「要会写」。",
    body: [
      html,
      ring(def, { pad: 6, radius: 12 }), badge(1, def.x + def.w + 6, def.y - 4),
      ring(input, { pad: 6, radius: 12 }), badge(2, input.x + input.w + 6, input.y - 4),
      ring(letters, { pad: 6, radius: 12 }), badge(3, letters.x + letters.w + 34, letters.y + letters.h / 2),
      ring(retry, { pad: 6, radius: 18 }), badge(4, retry.x + retry.w + 4, retry.y - 4),
    ].join("\n"),
    legend: [
      { t: "看释义回想", s: "英文被挖掉了" },
      { t: "填进原句的空", s: "一个字母一条线" },
      { t: "错哪儿标哪儿", s: "漏掉的 t 标红" },
      { t: "再拼一次", s: "提示首字母" },
    ],
    legendTop: 1146,
  }));
}

// ───────── 08 · 听力词 ─────────
{
  const { left, right, html } = pair("ls-front", { x: 0, y: 112, w: 390, h: 568 }, "ls-back", { x: 0, y: 112, w: 390, h: 568 }, ["先听", "翻面后"]);
  const play = left.map(box("ls-front", "play"));
  const show = left.map(box("ls-front", "show"));
  const ans = right.map(union(box("ls-back", "word"), box("ls-back", "def")));
  const btns = right.map(union(box("ls-back", "no"), box("ls-back", "yes")));
  add("p8", "08-听力词", page({
    n: 8, total: TOTAL, step: ["STEP 3", "听力词"],
    title: "听力词这样练<br><mark>先听发音</mark>再想意思",
    sub: "收藏时选<q>听力词</q>，复习时单词自动念给你听；听完翻面对答案，练的是「听得出来」。",
    body: [
      html,
      ring(play, { pad: 6, radius: 14 }), badge(1, play.x + play.w + 6, play.y - 4),
      ring(show, { pad: 6, radius: 18 }), badge(2, show.x + show.w + 4, show.y - 4),
      ring(ans, { pad: 8, radius: 14 }), badge(3, ans.x + ans.w + 8, ans.y + ans.h + 6),
      ring(btns, { pad: 6, radius: 18 }), badge(4, btns.x + btns.w + 4, btns.y - 4),
    ].join("\n"),
    legend: [
      { t: "先听发音", s: "进来就自动播放" },
      { t: "听完再翻面", s: "点按钮或按 Enter" },
      { t: "对答案", s: "看单词和意思" },
      { t: "听懂了没", s: "只有两档，照实选" },
    ],
    legendTop: 1146,
  }));
}

// ───────── 09 · 段小结 / 撤销 / 结算 ─────────
{
  const full = { x: 0, y: 0, w: 390, h: 700 };
  const { left, right, html } = pair("rv-checkpoint-sm", full, "rv-summary-sm", full, ["每 10 个词", "一轮练完"], { s: 1.0, inset: 20 });
  const saved = left.map(box("rv-checkpoint-sm", "saved"));
  const go = left.map(union(box("rv-checkpoint-sm", "pause"), box("rv-checkpoint-sm", "cont")));
  const first = right.map({ x: 41, y: 201, w: 148, h: 116 }); // 「第一次就想起来」卡
  const delta = right.map({ x: 41, y: 438, w: 310, h: 92 }); //  预计记得 / 已记牢 / 学习中 的变化
  add("p9", "09-小结与结算", page({
    n: 9, total: TOTAL, step: ["STEP 3", "节奏"],
    title: "每 10 个词一小结<br><mark>随时停，随时接</mark>",
    sub: "每段自动存档，当天回来从断点接着背；按错了点<q>↶ 撤销上一张</q>（电脑按 Z）。一轮练完，有结算页。",
    body: [
      html,
      ring(saved, { pad: 6, radius: 999 }), badge(1, saved.x + saved.w + 44, saved.y + saved.h / 2),
      ring(go, { pad: 6, radius: 16 }), badge(2, go.x + go.w + 4, go.y - 4),
      ring(first, { pad: 6, radius: 16 }), badge(3, first.x + first.w + 6, first.y - 4),
      ring(delta, { pad: 6, radius: 16 }), badge(4, delta.x + delta.w + 6, delta.y - 4),
    ].join("\n"),
    legend: [
      { t: "自动存档", s: "退出也不丢进度" },
      { t: "歇会儿或继续", s: "空格继续下一段" },
      { t: "第一次就想起", s: "看真实掌握" },
      { t: "记住的变多了", s: meta["rv-summary-sm"].facts?.knowDelta ? `预计记得 ${meta["rv-summary-sm"].facts.knowDelta}` : "预计记得涨了多少" },
    ],
    legendTop: 1250,
  }));
}

writeSet(wd.dir, posters, manifest);
console.log(`posters: ${posters.length} → ${wd.dir}/posters.html`);
if (!fs.existsSync(wd.metaFile)) console.warn("meta.json 不存在：先跑 capture");
