// 第 1 步：在电脑版网页上拍下要讲的每个画面，连同要标注的元素坐标写进 .work/<套名>/meta.json。
//   node scripts/feature-guides/<套名>/capture.mjs              → 全部组
//   node scripts/feature-guides/<套名>/capture.mjs home         → 只重拍某几组
// 套名就是这个文件夹的名字：`cp -r scripts/feature-guides/_template scripts/feature-guides/<套名>` 后不用改。
// 需要 `npx next dev -p 3100` 在跑（或 GUIDE_BASE 指向已启动的地址）。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, launch, newCtx, workDir, assertServer, fontsReady, sansDefault, snap } from "../lib/browser.mjs";

const SET = path.basename(path.dirname(fileURLToPath(import.meta.url)));
const wd = workDir(SET);
const groups = process.argv.slice(2);
const want = (g) => !groups.length || groups.includes(g);

/** 打开一页并等它画完（网站字体换上、浮层统一无衬线）。 */
async function open(ctx, url) {
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 200)); });
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(1000);
  await sansDefault(page);
  await fontsReady(page);
  return page;
}

await assertServer();
const browser = await launch();
try {
  if (want("home")) {
    console.log("home");
    // 默认：已登录的 Pro 演示账号、电脑版 1440×900、时钟停在 lib/browser.mjs 的 NOW。
    //   要本地数据（localStorage）：newCtx(browser, { seed: { 键: 值 } })
    //   要接口数据：ctx.onApi = async (route, req, url) => { …route.fulfill(…); return true; }
    //   （没接管的 /api/* 一律回 { ok: true }；页面空白时看下面打印的 ctx.apiLog 缺了哪个接口）
    const ctx = await newCtx(browser);
    const page = await open(ctx, "/?section=reading");
    // 要标注的元素按「看得见的文字」找：取包住这段文字的最小可见元素；tag / exact 消歧，aria 按 aria-label 找。
    // 菜单、弹窗、展开态要讲就把它点开再拍一张，别在图上用文字描述「在哪里」。
    wd.saveMeta(await snap(page, wd, "home", {
      nav: { text: "Reading", tag: "BUTTON" },
    }));
    console.log("  接口：", ctx.apiLog.join(" · ") || "无");
    await ctx.close();
  }
} finally {
  await browser.close();
}
