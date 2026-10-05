// 第 3 步：拼版。读 capture 写出的 meta.json（元素在截图里的坐标），
// 拼成 5 张 3:4 竖图（1080×1440）的 posters.html，再由 render.mjs 截成 PNG。
//
// 版式（样张 A）：左上标题 + 一句说明；右上是电脑网页整页缩略图，橙框标出放大的位置；
// 下面是放大的真实截图，说明标签贴在对应元素旁边、用线连到元素上。
// 文案只讲「这是什么、怎么用」，不写口号。坐标一律取自截图元数据，不手估。
// 只讲主流程（查词收藏 → 打开单词本 → 阅读复习 → 拼写 → 听力复习）；
// 小结、结算、拼写核对这类页面自己看得懂，不单独出图（2026-10-05 用户定的：别拆这么细）。
//
//   node scripts/feature-guides/vocab/build.mjs && node scripts/feature-guides/render.mjs vocab
import { workDir } from "../lib/browser.mjs";
import { kit, page, union, rect, writeSet } from "../lib/poster.mjs";

const wd = workDir("vocab");
const K = kit(wd.readMeta());
const TOTAL = 5;

/** 截图坐标里把框往外扩（给压暗层留的亮区用）。 */
const grow = (r, p, radius = 0) => ({ x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2, r: radius });
/** 圈的四条边中点：连线从这里出发。 */
const L = (r) => ({ x: r.x, y: r.cy });
const R = (r) => ({ x: r.x + r.w, y: r.cy });
const T = (r) => ({ x: r.cx, y: r.y });
const B = (r) => ({ x: r.cx, y: r.y + r.h });
const bottom = (r) => r.y + r.h;

const pages = [];
const def = (name, fn) => pages.push({ name, fn });

def("01-查词和收藏", (n) => {
  const shot = "dl-unsaved";
  const m = K.need(shot);
  const bt = (t, o) => K.boxByText(shot, t, o);
  const p = page(K, { n, total: TOTAL, shot, title: "查词和收藏", desc: "阅读、听力交卷后，在解析页里点一下原文中的英文单词，就会弹出词典；点一个意思，就收进单词本。" });
  // 左边从原文栏起，右边到弹窗为止
  const z = p.zoom({ crop: { x: 150, y: 397, w: 556, h: 428 }, y: 400, dim: [{ ...m.pop, r: 12 }, grow(m.word, 3, 4)] });
  const RX = z.map(m.pop).x - 22; // 左侧标签的右边缘：弹窗左边那片压暗的原文
  const word = p.ring(z.map(m.word), { p: 6, radius: 9 });
  p.label({ t: "点一下英文单词", side: "above", at: { x: word.cx, y: word.y - 10 } });
  const head = p.ring(z.map(union(bt("attribute", { tag: "SPAN", exact: true }), bt("🔊", { tag: "BUTTON" }), bt("TOEFL", { tag: "SPAN" }))), { p: 6, radius: 10 });
  p.label({ t: "单词、音标、发音", s: "TOEFL：托福常考词", side: "left", at: { x: RX, y: head.cy - 34 }, from: L(head) });
  const mode = p.ring(z.map(union(bt("阅读词", { tag: "BUTTON" }), bt("听力词", { tag: "BUTTON" }))), { p: 6, radius: 999 });
  p.label({ t: "复习方式", s: "阅读词看着认；听力词听着认", side: "left", at: { x: RX, y: mode.cy + 30 }, from: L(mode) });
  const senses = p.ring(z.map(union(bt("名词", { tag: "SPAN", exact: true }), bt("认为...属于", { tag: "BUTTON" }), bt("〔计算机〕", { tag: "SPAN" }))), { p: 8, radius: 14 });
  p.label({ t: "这个词的几个意思", s: "点一个，就按这个意思收藏", side: "left", at: { x: RX, y: senses.cy + 34 }, from: L(senses) });
  const save = p.ring(z.map(bt("☆ 收藏到单词本", { tag: "BUTTON" })), { p: 6, radius: 999 });
  p.label({ t: "不挑意思，直接收藏", side: "left", at: { x: RX, y: save.cy - 8 }, from: L(save) });
  const ai = p.ring(z.map(bt("讲讲这句里的用法", { tag: "BUTTON" })), { p: 6, radius: 10 });
  p.label({ t: "Pro：AI 讲它在这句里的意思", side: "left", at: { x: RX, y: ai.cy + 14 }, from: L(ai) });
  p.footer("能查词的地方：<b>阅读、听力交卷后的解析页</b>，以及<b>练习记录</b>里的原文、题目和选项。");
  return p;
});

def("02-打开单词本", (n) => {
  const shot = "dv-home";
  const b = (k) => K.box(shot, k);
  const p = page(K, { n, total: TOTAL, shot, title: "打开单词本", desc: "首页左栏点「单词本」。最上面是今天要复习的词，分「阅读复习」和「听力复习」两组，点按钮开始。" });
  const zn = p.zoom({ crop: { x: 40, y: 330, w: 222, h: 100 }, y: 400, x: 20, s: 2, dim: [grow(b("nav"), 3, 10)] });
  const nav = p.ring(zn.map(b("nav")), { p: 4, radius: 12 });
  p.label({ t: "首页左栏的「单词本」", s: "数字＝今天还要复习几个词", side: "right", at: { x: zn.screen.x + zn.screen.w + 36, y: nav.cy }, from: R(nav) });
  const z = p.zoom({ crop: { x: 270, y: 150, w: 850, h: 390 }, y: 640, dim: [{ ...b("hero"), r: 16 }] });
  const heroBottom = bottom(z.map(b("hero")));
  const title = p.ring(z.map(union(b("heroTitle"), b("minutes"))), { p: 6, radius: 10 });
  p.label({ t: "今天要复习的词数", s: "后面是预计用时", side: "right", at: { x: title.x + title.w + 26, y: title.cy }, from: R(title) });
  const rd = p.ring(z.map(union(b("readingCol"), b("readingCta"))), { p: 8, radius: 14 });
  p.label({ t: "阅读复习：看原句认词", s: "要会写的词，认出来后再拼写", side: "below", at: { x: rd.cx, y: heroBottom + 18 }, from: B(rd) });
  const ls = p.ring(z.map(union(b("listeningCol"), b("listeningCta"))), { p: 8, radius: 14 });
  p.label({ t: "听力复习：听发音认词", s: "收藏时选了「听力词」的词", side: "below", at: { x: ls.cx, y: heroBottom + 18 }, from: B(ls) });
  p.footer("「到期」＝该复习了，「新词」＝今天第一次学，「考拼写」＝其中要拼写的词。");
  return p;
});

def("03-阅读复习", (n) => {
  const shot = "dv-back"; // 翻面后的卡：原句、答案、忘了/记得都在一屏
  const b = (k) => K.box(shot, k);
  const p = page(K, { n, total: TOTAL, shot, title: "阅读复习", desc: "先看原句里高亮的词，在心里说出它的意思，再按空格翻面对答案，照实选「忘了」或「记得」。" });
  const z = p.zoom({ crop: { x: 330, y: 60, w: 780, h: 585 }, y: 400 });
  const hl = p.ring(z.map(b("hl")), { p: 5, radius: 8 });
  const chip = z.map(b("chip"));
  p.label({ t: "要认的词，在原句里高亮", side: "right", at: { x: 330, y: chip.y + chip.h / 2 }, from: T(hl) });
  const d = b("def");
  const def = p.ring(z.map(rect(d.x, d.y, 128, d.h)), { p: 5, radius: 8 }); // 释义那一行只圈文字部分
  p.label({ t: "翻面后的答案：它在这句里的意思", side: "right", at: { x: def.x + def.w + 26, y: def.cy }, from: R(def) });
  const forgot = p.ring(z.map(b("forgot")), { p: 5, radius: 14 });
  const rem = p.ring(z.map(b("remember")), { p: 5, radius: 14 });
  const ly = Math.max(bottom(forgot), bottom(rem)) + 26;
  p.label({ t: "想不起来：点「忘了」", s: "键盘按 1", side: "below", at: { x: forgot.cx, y: ly }, from: B(forgot) });
  p.label({ t: "想起来了：点「记得」", s: "键盘按 2；要会写的词接着拼写", side: "below", at: { x: rem.cx, y: ly }, from: B(rem) });
  p.footer("电脑上：<b>空格</b>翻面，<b>1</b>＝忘了，<b>2</b>＝记得，<b>Z</b>＝撤销上一张。中途退出不丢进度。");
  return p;
});

def("04-拼写", (n) => {
  const shot = "dv-spell";
  const b = (k) => K.box(shot, k);
  const p = page(K, { n, total: TOTAL, shot, title: "拼写", desc: "要会写的词，选「记得」之后还要拼一遍：看中文意思，把英文直接填进原句的空里。" });
  const z = p.zoom({ crop: { x: 330, y: 140, w: 780, h: 370 }, y: 400 });
  const pr = b("prompt");
  const prompt = p.ring(z.map(rect(pr.x, pr.y, 134, pr.h)), { p: 5, radius: 8 });
  const slots = p.ring(z.map(b("slots")), { p: 4, radius: 8 });
  p.label({ t: "看中文意思，把英文填进空里", side: "right", at: { x: prompt.x + prompt.w + 50, y: prompt.cy }, from: [R(prompt), T(slots)] });
  const check = p.ring(z.map(b("check")), { p: 5, radius: 12 });
  p.label({ t: "拼完按回车，或点这里核对", side: "left", at: { x: check.x - 22, y: check.cy }, from: L(check) });
  const giveup = p.ring(z.map(b("giveup")), { p: 5, radius: 14 });
  p.label({ t: "拼不出来：点这里看答案（算没记住）", side: "below", at: { x: giveup.cx, y: bottom(giveup) + 22 }, from: B(giveup) });
  // 同一张卡点开右上角 ⋯ 的样子（dv-menu）
  const mb = (k) => K.box("dv-menu", k);
  const zm = p.zoom({
    shot: "dv-menu", crop: { x: 820, y: 145, w: 290, h: 215 }, y: 1000, s: 1.42, x: 1060 - Math.round(290 * 1.42), tag: false,
    dim: [{ ...mb("menu"), r: 10 }, grow(mb("more"), 3, 8)],
  });
  const RX = zm.screen.x - 20;
  const more = p.ring(zm.map(mb("more")), { p: 4, radius: 10 });
  p.label({ t: "点 ⋯ 打开菜单", side: "above", at: { x: more.cx - 70, y: more.y - 14 }, from: T(more) });
  const prod = p.ring(zm.map(mb("productive")), { p: 3, radius: 10 });
  p.label({ t: "不想练拼写：关掉「要会写」", s: "改动下次出现时生效", side: "left", at: { x: RX, y: prod.cy + 14 }, from: L(prod) });
  const rest = p.ring(zm.map(union(mb("editDef"), mb("suspend"))), { p: 3, radius: 10 });
  p.label({ t: "也能改释义、暂停复习这个词", side: "left", at: { x: RX, y: rest.cy + 30 }, from: L(rest) });
  p.footer("回车核对，拼错的字母会标红；拼对才算记得。");
  return p;
});

def("05-听力复习", (n) => {
  const shot = "dv-listen";
  const b = (k) => K.box(shot, k);
  const p = page(K, { n, total: TOTAL, shot, title: "听力复习", desc: "收藏时选了「听力词」的词，复习时只听不看：先听发音想意思，听完再翻面看答案。" });
  const z = p.zoom({ crop: { x: 330, y: 60, w: 780, h: 455 }, y: 400 });
  const play = p.ring(z.map(b("play")), { p: 5, radius: 12 });
  p.label({ t: "听发音：可以多听几遍", side: "right", at: { x: play.x + play.w + 28, y: play.cy }, from: R(play) });
  const ans = p.ring(z.map(union(b("word"), rect(532, 292, 88, 18), rect(365, 333, 96, 27))), { p: 6, radius: 12 });
  p.label({ t: "翻面后才显示单词和意思", side: "right", at: { x: ans.x + ans.w + 30, y: ans.cy }, from: R(ans) });
  const no = p.ring(z.map(b("no")), { p: 5, radius: 14 });
  const yes = p.ring(z.map(b("yes")), { p: 5, radius: 14 });
  const ly = Math.max(bottom(no), bottom(yes)) + 26;
  p.label({ t: "没听出来，或不懂意思", s: "键盘按 1", side: "below", at: { x: no.cx, y: ly }, from: B(no) });
  p.label({ t: "听出来了，也懂意思", s: "键盘按 2 或回车", side: "below", at: { x: yes.cx, y: ly }, from: B(yes) });
  p.footer("电脑上：<b>空格</b>重播，<b>回车</b>翻面；翻面后 <b>1</b>＝没听懂，<b>2</b> 或<b>回车</b>＝听懂了。");
  return p;
});

const posters = [];
const manifest = [];
pages.forEach(({ name, fn }, i) => {
  const p = fn(i + 1);
  posters.push(p.html());
  manifest.push({ id: `p${i + 1}`, name });
});
writeSet(wd.dir, posters, manifest);
console.log(`posters.html：${posters.length} 张 →`, wd.dir);
