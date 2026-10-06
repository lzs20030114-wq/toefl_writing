// 第 2 步：拼版。每页一个 def(成图文件名, (n, total) => page)，坐标一律从 meta.json 取，不手估。
//   node scripts/feature-guides/<套名>/build.mjs && node scripts/feature-guides/render.mjs <套名>
// 版式、文案规则见 .claude/skills/feature-guide/SKILL.md；接口和排版数字见同目录 references/poster.md。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workDir } from "../lib/browser.mjs";
import { kit, page, union, rect, grow, L, R, T, B, bottom, writePages } from "../lib/poster.mjs";

const SET = path.basename(path.dirname(fileURLToPath(import.meta.url)));
const wd = workDir(SET);
const K = kit(wd.readMeta());
const pages = [];
const def = (name, fn) => pages.push([name, fn]);

def("01-示例", (n, total) => {
  const shot = "home";
  const b = (k) => K.box(shot, k);
  const p = page(K, { n, total, shot, title: "示例标题", desc: "一两句话说清：在哪里、点什么、会发生什么。" });
  // 放大一块：crop 是截图里的 CSS px（1440×900 坐标），默认放大到宽 1040；dim 里的框保持亮、其余压暗
  const z = p.zoom({ crop: { x: 20, y: 70, w: 560, h: 420 }, y: 400, dim: [grow(b("nav"), 4, 10)] });
  const nav = p.ring(z.map(b("nav")), { p: 5, radius: 10 });
  p.label({ t: "标签主句：这是什么", s: "副句：怎么用", side: "right", at: { x: R(nav).x + 30, y: nav.cy }, from: R(nav) });
  p.footer("脚注一行：补充说明。");
  return p;
});

writePages(wd.dir, pages);
console.log(`posters.html：${pages.length} 张 →`, wd.dir);
