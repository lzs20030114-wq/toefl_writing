# 功能引导图（真实页面截图 → 标注拼版 → 竖版成图）

给网站功能做「使用说明图」的脚本。截图一律来自本地起的真实网站（和线上同一套组件），
只 mock 登录态和后端接口；标注、文字在截图之外另叠一层。

```
scripts/feature-guides/
  lib/browser.mjs   Playwright 封装：登录态/接口 mock、屏蔽首次弹窗、网站字体、按文字取元素坐标
  lib/poster.mjs    拼版工具：裁图、手机/浏览器外框、圈注、说明、页面外壳
  render.mjs        posters.html → PNG（--dpr 2 出高清，--publish 拷进 docs/feature-guides/<set>/）
  vocab/            划词词典 + 单词本 这一套
    words*.json     演示用的词和原句（全部摘自题库里的阅读文章、听力原文）
    seed.mjs        用网站自己的单词本代码模拟 18 天使用，产出 seed-book.json（已提交一份）
    seed-book.json  演示账号的单词本数据快照
    capture.mjs     在真实页面上拍每个画面，记下要标注的元素坐标（.work/vocab/meta.json）
    build.mjs       拼成成图的 HTML
  .work/            中间产物（截图、meta、posters.html、out/），不入库
```

## 跑法

```bash
npx next dev -p 3100                                   # 另开一个终端，保持运行
node scripts/feature-guides/vocab/capture.mjs          # 拍图（可只拍某几组：lookup m-lookup overview review rhythm listening）
node scripts/feature-guides/vocab/build.mjs            # 拼版
node scripts/feature-guides/render.mjs vocab           # 出图 → scripts/feature-guides/.work/vocab/out/
```

- 浏览器：云端沙箱用预装的 `/opt/pw-browsers/chromium`；本机用 Playwright 自带的，或设 `PW_CHROMIUM=<chrome 路径>`。
- 截图时钟固定在 `2026-10-04 21:30`（北京时间），「今天要复习几个词」这类数字才稳定；改 `GUIDE_NOW` 可换。
- 发了新公告后，`lib/browser.mjs` 里 `toefl-announcement-dismissed` 要改成最新的 id，否则截图会带公告弹窗。

## 现状

第一版（9 张 3:4，电脑/手机截图混用 + 编号图例）已被否：要改成**全部手机版页面截图、一图一屏放大、
说明文字直接贴在元素的真实位置、文案用直白的说明**。`vocab/build.mjs` 还是第一版的版式，待新版式确认后重写。
