// 第 3 步：拼版。读 capture 写出的 meta.json（元素在截图里的坐标），
// 拼成 12 张 3:4 竖图（1080×1440）的 posters.html，再由 render.mjs 截成 PNG。
//
// 版式（样张 A）：左上标题 + 一句说明；右上是电脑网页整页缩略图，橙框标出放大的位置；
// 下面是放大的真实截图，说明标签贴在对应元素旁边、用线连到元素上。
// 文案只讲「这是什么、怎么用」，不写口号。坐标一律取自截图元数据，不手估。
//
//   node scripts/feature-guides/vocab/build.mjs && node scripts/feature-guides/render.mjs vocab
import { workDir } from "../lib/browser.mjs";
import { kit, page, union, rect, writeSet } from "../lib/poster.mjs";

const wd = workDir("vocab");
const K = kit(wd.readMeta());
const TOTAL = 12;

/** 截图坐标里把框往外扩（给压暗层留的亮区用）。 */
const grow = (r, p, radius = 0) => ({ x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2, r: radius });
const shift = (r, dx, dy) => ({ ...r, x: r.x + dx, y: r.y + dy });
/** 圈的四条边中点：连线从这里出发。 */
const L = (r) => ({ x: r.x, y: r.cy });
const R = (r) => ({ x: r.x + r.w, y: r.cy });
const T = (r) => ({ x: r.cx, y: r.y });
const B = (r) => ({ x: r.cx, y: r.y + r.h });
const bottom = (r) => r.y + r.h;

/** 划词弹窗三张共用的放大区：左边从原文栏起，右边到弹窗为止。 */
const POP_CROP = { x: 150, y: 397, w: 556, h: 428 };

const pages = [];
const def = (name, fn) => pages.push({ name, fn });

def("01-划词查词", (n) => {
  const shot = "dl-unsaved";
  const m = K.need(shot);
  const bt = (t, o) => K.boxByText(shot, t, o);
  const p = page(K, { n, total: TOTAL, shot, title: "划词查词", desc: "阅读、听力交卷后，在解析页里点一下原文中的英文单词，就会弹出词典。" });
  const z = p.zoom({ crop: POP_CROP, y: 400, dim: [{ ...m.pop, r: 12 }, grow(m.word, 3, 4)] });
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

def("02-收藏单词", (n) => {
  const shot = "dl-saved";
  const m = K.need(shot);
  const bt = (t, o) => K.boxByText(shot, t, o);
  const p = page(K, { n, total: TOTAL, shot, title: "收藏单词", desc: "在词典里点一个意思，这个词就收进单词本，这句原文也一起存下来。" });
  const z = p.zoom({ crop: POP_CROP, y: 400, dim: [{ ...m.pop, r: 12 }, grow(m.word, 3, 4)] });
  const pop = z.map(m.pop);
  const RX = pop.x - 22;
  const senses = p.ring(z.map(union(bt("名词", { tag: "SPAN", exact: true }), bt("认为...属于", { tag: "BUTTON" }), bt("〔计算机〕", { tag: "SPAN" }))), { p: 8, radius: 14 });
  p.label({ t: "青色的是你选的意思", s: "复习时考这个意思；点别的可以换", side: "left", at: { x: RX, y: senses.cy }, from: L(senses) });
  const on = p.ring(z.map(bt("✓ 这句已在卡上", { tag: "BUTTON" })), { p: 6, radius: 999 });
  p.label({ t: "这句原文也存进去了", s: "复习时就用这句考你", side: "left", at: { x: RX, y: on.cy }, from: L(on) });
  const rm = p.ring(z.map(bt("移出单词本", { tag: "BUTTON" })), { p: 6, radius: 999 });
  p.label({ t: "从单词本删掉这个词", side: "below", at: { x: rm.cx, y: bottom(pop) + 18 }, from: B(rm) });
  p.footer("同一个词在别的文章里再查到，按钮会变成<b>「＋ 加这句语境」</b>，最多存 3 句原文。");
  return p;
});

def("03-AI讲解", (n) => {
  const shot = "dl-ai";
  const m = K.need(shot);
  const bt = (t, o) => K.boxByText(shot, t, o);
  const p = page(K, { n, total: TOTAL, shot, title: "AI 讲解（Pro）", desc: "词典的意思和这句对不上时，点「讲讲这句里的用法」，AI 会按这句话讲这个词。" });
  const z = p.zoom({ crop: { x: 160, y: 445, w: 556, h: 428 }, y: 400, dim: [{ ...m.pop, r: 12 }, grow(m.word, 3, 4)] });
  const RX = z.map(m.pop).x - 22;
  const add = p.ring(z.map(bt("＋ 加这句语境", { tag: "BUTTON" })), { p: 6, radius: 999 });
  p.label({ t: "这个词以前收藏过", s: "点这里把这句也存上", side: "left", at: { x: RX, y: add.cy }, from: L(add) });
  // 讲解正文没有单独的元素框：取讲解框（蓝底）里分隔线以上那一段
  const expl = p.ring(z.map(rect(432, 558, 260, 102)), { p: 4, radius: 10 });
  p.label({ t: "AI 讲解", s: "这个词在这句里的意思和用法", side: "left", at: { x: RX, y: expl.cy }, from: L(expl) });
  const use = p.ring(z.map(union(bt("这句里的意思：", { tag: "DIV" }), bt("用这个意思复习", { tag: "BUTTON" }), bt("编辑释义", { tag: "BUTTON" }))), { p: 6, radius: 10 });
  p.label({ t: "用这个意思复习", s: "复习时就考这句里的意思", side: "left", at: { x: RX, y: use.cy }, from: L(use) });
  const word = p.ring(z.map(m.word), { p: 6, radius: 9 });
  p.label({ t: "查的是这个词", side: "right", at: { x: word.x + word.w + 24, y: word.cy }, from: R(word) });
  p.footer("图中 AI 讲解是示例，实际以 AI 当次的回答为准。");
  return p;
});

def("04-打开单词本", (n) => {
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

def("05-我的词库", (n) => {
  const shot = "dv-list";
  const b = (k) => K.box(shot, k);
  const p = page(K, { n, total: TOTAL, shot, title: "我的词库", desc: "收藏过的词都在「我的词库」：能搜索、筛选，每个词都能看到复习状态、还记得多少、下次什么时候复习。" });
  // 第一行（sophistication）展开了详情；第二行（propagate）整行亮着，用来讲每一列
  const z = p.zoom({ crop: { x: 290, y: 180, w: 810, h: 540 }, y: 400, dim: [rect(290, 180, 810, 406)] });
  const ROW = 190; // 第二行比第一行低多少（截图 CSS px）
  const sr = p.ring(z.map(union(b("search"), b("sort"))), { p: 5, radius: 10 });
  p.label({ t: "搜索单词；右边可以换排序", side: "left", at: { x: sr.x - 18, y: sr.cy }, from: L(sr) });
  const fl = p.ring(z.map(union(b("segments"), b("filters"))), { p: 5, radius: 12 });
  p.label({ t: "按阅读／听力、按复习状态筛选", side: "below", at: { x: z.map(b("filters")).x + 200, y: bottom(fl) + 4 } });
  const more = p.ring(z.map(b("more")), { p: 4, radius: 10 });
  const acts = p.ring(z.map(union(b("mode"), b("remove"))), { p: 6, radius: 12 });
  const panel = z.map(b("actions"));
  p.label({ t: "点 ⋯ 展开：这个词的设置", s: "复习类型、拼写、改释义、暂停、移除", side: "right", at: { x: acts.x + acts.w + 34, y: bottom(panel) - 46 }, from: [R(acts), B(more)] });
  const lc = p.ring(z.map(b("leech")), { p: 5, radius: 8 });
  const labelY = bottom(lc) + 66;
  p.label({ t: "易忘：忘过 3 次以上的词", side: "below", at: { x: lc.cx, y: labelY }, from: B(lc) });
  const mem = p.ring(z.map(shift(b("memory"), 0, ROW)), { p: 7, radius: 8 });
  const due = p.ring(z.map({ ...shift(b("due"), 0, ROW), w: 28 }), { p: 7, radius: 8 });
  p.label({ t: "此刻记得：现在还能想起来的概率", s: "下次：下一次复习的时间", side: "below", at: { x: 850, y: labelY }, from: [B(mem), B(due)] });
  p.footer("阅读词默认要会写（复习时要拼写），听力词只考听懂；「此刻记得」是估计值。");
  return p;
});

def("06-认词复习", (n) => {
  const shot = "dv-front";
  const b = (k) => K.box(shot, k);
  const p = page(K, { n, total: TOTAL, shot, title: "阅读复习：认词", desc: "先看原句里高亮的词，在心里说出它的意思，再点「显示答案」。" });
  const z = p.zoom({ crop: { x: 330, y: 60, w: 780, h: 490 }, y: 400 });
  const hl = p.ring(z.map(b("hl")), { p: 5, radius: 8 });
  const chip = z.map(b("chip"));
  p.label({ t: "高亮的就是要认的词", side: "right", at: { x: 330, y: chip.y + chip.h / 2 }, from: T(hl) });
  const speak = p.ring(z.map(b("speak")), { p: 4, radius: 999 });
  p.label({ t: "点喇叭听发音", side: "right", at: { x: speak.x + speak.w + 24, y: speak.cy }, from: R(speak) });
  const more = p.ring(z.map(b("more")), { p: 4, radius: 10 });
  p.label({ t: "更多：改释义、暂停这个词", side: "below", at: { x: 850, y: 770 }, from: B(more) });
  const show = p.ring(z.map(b("show")), { p: 5, radius: 16 });
  p.label({ t: "想好意思后，点这里翻面看答案", side: "above", at: { x: 380, y: show.y - 18 }, from: { x: 380, y: show.y } });
  const undo = p.ring(z.map(b("undo")), { p: 4, radius: 8 });
  p.label({ t: "按错了：撤销上一张（Z 键）", side: "below", at: { x: undo.cx + 110, y: bottom(undo) + 18 }, from: B(undo) });
  p.footer("电脑上可以全用键盘：<b>空格</b>翻面；翻面后 <b>1</b>＝忘了，<b>2</b>＝记得；<b>Z</b>＝撤销上一张。");
  return p;
});

def("07-看答案", (n) => {
  const shot = "dv-back";
  const b = (k) => K.box(shot, k);
  const p = page(K, { n, total: TOTAL, shot, title: "阅读复习：看答案", desc: "对照答案，照实选「忘了」或「记得」。只有这两个选项。" });
  const z = p.zoom({ crop: { x: 330, y: 140, w: 780, h: 505 }, y: 400 });
  const d = b("def");
  const def = p.ring(z.map(rect(d.x, d.y, 128, d.h)), { p: 5, radius: 8 }); // 释义那一行只圈文字部分
  p.label({ t: "答案：它在这句里的意思", side: "right", at: { x: def.x + def.w + 26, y: def.cy }, from: R(def) });
  const dict = p.ring(z.map(rect(362, 398, 204, 110)), { p: 6, radius: 12 }); // 「词典」三行
  p.label({ t: "完整的词典释义", s: "名词、动词各是什么意思", side: "right", at: { x: dict.x + dict.w + 30, y: dict.cy }, from: R(dict) });
  const forgot = p.ring(z.map(b("forgot")), { p: 5, radius: 14 });
  const rem = p.ring(z.map(b("remember")), { p: 5, radius: 14 });
  const ly = Math.max(bottom(forgot), bottom(rem)) + 26;
  p.label({ t: "想不起来：点「忘了」", s: "键盘按 1", side: "below", at: { x: forgot.cx, y: ly }, from: B(forgot) });
  p.label({ t: "想起来了：点「记得」", s: "键盘按 2；要会写的词接着拼写", side: "below", at: { x: rem.cx, y: ly }, from: B(rem) });
  p.footer("忘了的词这一轮还会再考，当天累计答对 3 次才过；第一遍就记得的，今天就过了。");
  return p;
});

def("08-拼写", (n) => {
  const shot = "dv-spell";
  const b = (k) => K.box(shot, k);
  const p = page(K, { n, total: TOTAL, shot, title: "阅读复习：拼写", desc: "要会写的词，选「记得」之后还要拼一遍：看中文意思，把英文直接填进原句的空里。" });
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
  p.footer("一个字母一条下划线，拼对才算记得。");
  return p;
});

def("09-拼写核对", (n) => {
  const shot = "dv-spell-wrong";
  const b = (k) => K.box(shot, k);
  const p = page(K, { n, total: TOTAL, shot, title: "拼写核对", desc: "回车核对后，拼错或漏掉的字母会标成红色。拼对才算记得。" });
  const z = p.zoom({ crop: { x: 330, y: 345, w: 780, h: 535 }, y: 400, dim: [rect(330, 345, 780, 130), rect(330, 778, 780, 102)] });
  const v = b("verdict");
  const letters = p.ring(z.map(rect(v.x, v.y, 192, 61)), { p: 6, radius: 10 }); // 「你写的是…」+ 逐字母对照
  p.label({ t: "红色＝写错或漏掉的字母", s: "这次漏写了一个 t", side: "right", at: { x: letters.x + letters.w + 30, y: letters.cy }, from: R(letters) });
  const retry = p.ring(z.map(b("retry")), { p: 5, radius: 14 });
  const next = p.ring(z.map(b("next")), { p: 5, radius: 14 });
  const ly = Math.min(retry.y, next.y) - 22;
  p.label({ t: "再拼一次", s: "有首字母提示，只练习、不改结果", side: "above", at: { x: retry.cx, y: ly }, from: T(retry) });
  p.label({ t: "下一个词", s: "这次算没记住，之后会再考", side: "above", at: { x: next.cx, y: ly }, from: T(next) });
  p.footer("看完结果按<b>空格</b>或<b>回车</b>，进入下一个词。");
  return p;
});

def("10-听力复习", (n) => {
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

def("11-每10词小结", (n) => {
  const shot = "dv-checkpoint";
  const b = (k) => K.box(shot, k);
  const p = page(K, { n, total: TOTAL, shot, title: "每 10 个词小结", desc: "每复习 10 个词会停一下，给出这一段的小结并自动存档。可以先退出，当天回来从这里接着复习。" });
  const za = p.zoom({ crop: { x: 440, y: 102, w: 560, h: 260 }, y: 400, s: 1.5 }); // 正好切在弹窗边上，不带背后的遮罩
  const saved = p.ring(za.map(b("saved")), { p: 4, radius: 999 });
  p.label({ t: "进度已自动存档", side: "right", at: { x: saved.x + saved.w + 30, y: saved.cy - 6 }, from: R(saved) });
  const tags = p.ring(za.map(rect(934, 225, 46, 130)), { p: 4, radius: 10 }); // 前三行右边的「忘了 / 记得」
  p.label({ t: "每个词这次记得还是忘了", side: "below", at: { x: tags.cx - 150, y: bottom(za.screen) + 14 }, from: B(tags) });
  const zb = p.zoom({ crop: { x: 440, y: 690, w: 560, h: 108 }, y: bottom(za.screen) + 86, s: 1.5, tag: false });
  const pause = p.ring(zb.map(b("pause")), { p: 5, radius: 14 });
  const cont = p.ring(zb.map(b("cont")), { p: 5, radius: 14 });
  const ly = bottom(zb.screen) + 22;
  p.label({ t: "先休息：退出", s: "今天回来从这里接着复习", side: "below", at: { x: pause.cx, y: ly }, from: B(pause) });
  p.label({ t: "继续下一段", s: "键盘按空格", side: "below", at: { x: cont.cx, y: ly }, from: B(cont) });
  p.footer("存档只在当天有效；阅读复习和听力复习各存各的。");
  return p;
});

def("12-复习结算", (n) => {
  const shot = "dv-summary";
  const b = (k) => K.box(shot, k);
  const p = page(K, { n, total: TOTAL, shot, title: "复习结算", desc: "一轮复习结束后会出结算：这一轮的成绩、忘了的词，和接下来的安排。" });
  const z = p.zoom({ crop: { x: 340, y: 78, w: 760, h: 788 }, y: 400, s: 1.2 });
  const stats = p.ring(z.map(rect(366, 190, 706, 95)), { p: 6, radius: 14 }); // 三张成绩卡
  p.label({ t: "这一轮的成绩", s: "第一遍就想起来的比例、答题次数", side: "left", at: { x: z.map(rect(1075, 0, 0, 0)).x - 10, y: stats.y - 58 }, from: { x: 780, y: stats.y } });
  const deltas = p.ring(z.map(rect(375, 315, 700, 52)), { p: 6, radius: 12 });
  p.label({ t: "复习前 → 复习后的变化", side: "below", at: { x: 520, y: bottom(deltas) + 40 }, from: { x: 520, y: bottom(deltas) } });
  const relearn = p.ring(z.map(rect(1015, 470, 70, 190)), { p: 4, radius: 10 }); // 「已安排重学」那一列
  p.label({ t: "会自动安排重学", side: "left", at: { x: relearn.x - 20, y: z.map(rect(0, 491, 0, 0)).y }, from: { x: relearn.x, y: z.map(rect(0, 491, 0, 0)).y } });
  const nxt = p.ring(z.map(rect(342, 719, 371, 141)), { p: 4, radius: 16 });
  const tmr = p.ring(z.map(rect(727, 719, 373, 141)), { p: 4, radius: 16 });
  const ly = bottom(nxt) + 16;
  p.label({ t: "下一步：还没做的复习", side: "below", at: { x: nxt.cx, y: ly }, from: B(nxt) });
  p.label({ t: "明天大概要复习几个词", side: "below", at: { x: tmr.cx, y: ly }, from: B(tmr) });
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
