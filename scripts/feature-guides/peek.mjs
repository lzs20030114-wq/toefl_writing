// 看截图的某一块：定 crop、核对元素坐标时用（比对着整张 4320px 原图猜坐标快得多）。
//   node scripts/feature-guides/peek.mjs <set> <shot>                    → 整张缩到 0.8 倍
//   node scripts/feature-guides/peek.mjs <set> <shot> x y w h [倍数]      → 截图里这一块（CSS px），默认放大 2 倍
// 出图在 .work/<set>/peek/，同时把这张截图在 meta.json 里记下的元素框打印出来。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launch, workDir } from "./lib/browser.mjs";

const [set, shot, ...rest] = process.argv.slice(2);
if (!set || !shot) throw new Error("用法：node scripts/feature-guides/peek.mjs <set> <shot> [x y w h [倍数]]");
const wd = workDir(set);
const meta = wd.readMeta()[shot];
if (!meta) throw new Error(`.work/${set}/meta.json 里没有 ${shot}：先跑 capture`);
const part = rest.length >= 4;
const [x, y, w, h] = part ? rest.slice(0, 4).map(Number) : [meta.clip.x, meta.clip.y, meta.clip.w, meta.clip.h];
const s = Number(rest[4] || (part ? 2 : 0.8));

const outDir = path.join(wd.dir, "peek");
fs.mkdirSync(outDir, { recursive: true });
const html = path.join(outDir, `_${shot}.html`);
fs.writeFileSync(html, `<body style="margin:0"><img src="${pathToFileURL(path.join(wd.shots, meta.file)).href}" style="display:block;width:${meta.clip.w * s}px;height:${meta.clip.h * s}px"></body>`);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: Math.ceil(meta.clip.w * s), height: Math.ceil(meta.clip.h * s) } });
await page.goto(pathToFileURL(html).href);
await page.waitForTimeout(200);
const out = path.join(outDir, `${shot}${part ? `-${x}-${y}` : ""}.png`);
await page.screenshot({ path: out, clip: { x: (x - meta.clip.x) * s, y: (y - meta.clip.y) * s, width: w * s, height: h * s } });
await browser.close();
console.log(out);

const fmt = (r) => `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}×${Math.round(r.h)}`;
for (const [k, v] of Object.entries(meta)) {
  if (v && typeof v === "object" && "x" in v && k !== "clip") console.log(`  ${k.padEnd(12)} ${fmt(v)}`);
}
const boxes = meta.boxes || {};
const rows = Array.isArray(boxes) ? boxes.map((b) => [b.tag || b.key || "", b]) : Object.entries(boxes);
for (const [name, r] of rows) if (r) console.log(`  ${String(name).padEnd(12)} ${fmt(r)}${r.text ? `  ${JSON.stringify(r.text.slice(0, 40))}` : ""}`);
