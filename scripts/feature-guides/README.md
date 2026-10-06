# 功能介绍图（真实页面截图 → 原位标注 → 3:4 竖图）

给网站功能做「使用说明图」的管线：真浏览器打开本地 dev server（和线上同一套组件）拍电脑版页面，
只 mock 登录态和后端接口；元素坐标从页面里量，说明标签在截图之外另叠一层。

**出新的一套走 skill：`/feature-guide`**（`.claude/skills/feature-guide/`）——定稿的版式与文案规则、固定流程、
自查清单都在那里，拼版接口和排版数字在它的 `references/poster.md`。这份 README 只说明目录。

```
scripts/feature-guides/
  lib/browser.mjs   拍图：Playwright 封装（登录态/接口 mock、首次弹窗静音、网站字体、按文字量元素框）
  lib/poster.mjs    拼版：一页 = 标题说明 + 整页缩略图（橙框标放大处）+ 放大的真实截图 + 原位标签
  render.mjs        posters.html → PNG + 总览 sheet.png（--dpr 2 出高清，--publish 拷进 docs/feature-guides/<套名>/）
  peek.mjs          看截图的局部放大，并打印 meta 里记下的元素框（定 crop、核坐标用）
  _template/        新的一套从这里复制：capture.mjs（拍图）+ build.mjs（拼版），套名取文件夹名
  vocab/            划词词典 + 单词本（5 张，成图在 docs/feature-guides/vocab/）
    words*.json     演示用的词和原句（全部摘自题库里的阅读文章、听力原文）
    seed.mjs        用网站自己的单词本代码模拟 18 天使用，产出 seed-book.json（已提交一份）
    capture.mjs     拍图（组：lookup home review menu listening；ai list rhythm 是早先 12 张版用的，留着备用）
    build.mjs       5 张的版式与文案
  .work/            中间产物（截图、meta、posters.html、out/、sheet.png、peek/），不入库
```

## 跑法（以 vocab 为例）

```bash
npx next dev -p 3100                                   # 另开一个终端，保持运行
node scripts/feature-guides/vocab/capture.mjs          # 拍图（可只拍某几组）
node scripts/feature-guides/vocab/build.mjs            # 拼版
node scripts/feature-guides/render.mjs vocab           # 出图 → .work/vocab/out/ + .work/vocab/sheet.png
node scripts/feature-guides/render.mjs vocab --publish # 确认无误后拷进 docs/feature-guides/vocab/
```

新的一套：`cp -r scripts/feature-guides/_template scripts/feature-guides/<套名>`，然后照 skill 的流程走。
