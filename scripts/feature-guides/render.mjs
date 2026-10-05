// 把 .work/<set>/posters.html 里的每一张截成 PNG。
//   node scripts/feature-guides/render.mjs vocab              → .work/vocab/out/01-划词查词.png …
//   node scripts/feature-guides/render.mjs vocab --dpr 2      → 2160×2880 高清版（文件名带 @2x）
//   node scripts/feature-guides/render.mjs vocab --publish    → 同时拷进 docs/feature-guides/vocab/
//   node scripts/feature-guides/render.mjs vocab p3 p4        → 只出这几张
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launch, newCtx, workDir, ROOT } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const dprIdx = args.indexOf("--dpr");
const dpr = dprIdx >= 0 ? Number(args[dprIdx + 1]) : 1;
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--dpr");
const set = positional[0];
const only = positional.slice(1);
if (!set) throw new Error("用法：node scripts/feature-guides/render.mjs <set> [--dpr 2] [--publish] [p1 p2 …]");

const wd = workDir(set);
const manifest = JSON.parse(fs.readFileSync(path.join(wd.dir, "manifest.json"), "utf8"));
const outDir = path.join(wd.dir, "out");
const pubDir = path.join(ROOT, "docs/feature-guides", set);
fs.mkdirSync(outDir, { recursive: true });
if (flag("publish")) fs.mkdirSync(pubDir, { recursive: true });

const browser = await launch();
const ctx = await newCtx(browser, { mobile: false, auth: false, now: null, width: 1200, height: 1600, dpr });
const page = await ctx.newPage();
await page.goto(pathToFileURL(path.join(wd.dir, "posters.html")).href, { waitUntil: "networkidle" });
// 标签位置是页面脚本按实际文字宽度摆的（poster.mjs 的 LAYOUT_JS），摆完才截
await page.waitForFunction(() => document.body.dataset.laidOut === "1", null, { timeout: 60000 });
await page.waitForTimeout(300);
for (const { id, name } of manifest) {
  if (only.length && !only.includes(id)) continue;
  const file = `${name}${dpr > 1 ? `@${dpr}x` : ""}.png`;
  await page.locator(`#${id}`).screenshot({ path: path.join(outDir, file) });
  if (flag("publish")) fs.copyFileSync(path.join(outDir, file), path.join(pubDir, file));
  console.log("rendered", id, "→", file);
}
await browser.close();
