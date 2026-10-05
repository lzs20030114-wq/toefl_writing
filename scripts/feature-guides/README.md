# 功能引导图（真实页面截图 → 标注拼版 → 竖版成图）

给网站功能做「使用说明图」的脚本。截图一律来自本地起的真实网站（和线上同一套组件），
只 mock 登录态和后端接口；标注、文字在截图之外另叠一层。

```
scripts/feature-guides/
  lib/browser.mjs   Playwright 封装：登录态/接口 mock、屏蔽首次弹窗、网站字体、按文字取元素坐标
  lib/poster.mjs    拼版：一页 = 标题说明 + 整页缩略图（橙框标放大处）+ 放大的真实截图 + 原位标签
  render.mjs        posters.html → PNG（--dpr 2 出高清，--publish 拷进 docs/feature-guides/<set>/）
  vocab/            划词词典 + 单词本 这一套
    words*.json     演示用的词和原句（全部摘自题库里的阅读文章、听力原文）
    seed.mjs        用网站自己的单词本代码模拟 18 天使用，产出 seed-book.json（已提交一份）
    seed-book.json  演示账号的单词本数据快照
    capture.mjs     在真实页面上拍每个画面，记下要标注的元素坐标（.work/vocab/meta.json）
    build.mjs       12 张图的版式与文案
  .work/            中间产物（截图、meta、posters.html、out/），不入库
```

成图在 `docs/feature-guides/vocab/`（12 张，1080×1440）。

## 跑法

```bash
npx next dev -p 3100                                   # 另开一个终端，保持运行
node scripts/feature-guides/vocab/capture.mjs          # 拍图（可只拍某几组：lookup ai home list review menu rhythm listening）
node scripts/feature-guides/vocab/build.mjs            # 拼版
node scripts/feature-guides/render.mjs vocab           # 出图 → scripts/feature-guides/.work/vocab/out/
node scripts/feature-guides/render.mjs vocab --publish # 确认无误后拷进 docs/feature-guides/vocab/
```

- 浏览器：云端沙箱用预装的 `/opt/pw-browsers/chromium`；本机用 Playwright 自带的，或设 `PW_CHROMIUM=<chrome 路径>`。
- 截图时钟固定在 `2026-10-04 21:30`（北京时间），「今天要复习几个词」这类数字才稳定；改 `GUIDE_NOW` 可换。
- 发了新公告后，`lib/browser.mjs` 里 `toefl-announcement-dismissed` 要改成最新的 id，否则截图会带公告弹窗。
- 截图一律电脑版 1440×900。单词本复习页不要用 769–1280px 宽拍：那个宽度下复习专注模式的卡片会被挤进
  220px 的侧栏位（网站本身的问题，见 `components/home/theme.js` 的 769–1280 媒体查询）。

## 版式约定（用户 2026-10-05 定稿的样张 A）

- 3:4 竖图，给手机看；**截图必须是电脑版网页**。
- 左上标题 + 一句说明；右上是整页缩略图，橙框标出下面放大的是哪一块。
- 说明标签直接贴在真实截图里对应元素旁边、用线连上；不要编号图例，不要用文字描述位置（「右上角 ⋯ 里」这种），
  要指的东西不在画面上就补拍一张真实画面（第 8 张的 ⋯ 菜单就是这么来的）。
- 文案只说「这是什么、怎么用」，不写口号。标签位置由 `poster.mjs` 在浏览器里按实际文字宽度摆，`render.mjs` 等摆完才截。
- 数据是 seed 出来的演示账号；第 3 张的 AI 讲解是示例文字（图上有注明）。
