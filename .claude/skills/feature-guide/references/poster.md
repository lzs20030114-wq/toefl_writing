# 拼版参考：接口、版面尺寸、摆位套路、踩过的坑

写 `<套名>/build.mjs` 前读这一份。样板代码：`scripts/feature-guides/vocab/build.mjs`（5 页，覆盖下面所有套路）。

## 目录

1. 拍图侧接口（lib/browser.mjs）
2. 拼版侧接口（lib/poster.mjs）
3. 版面尺寸（算位置用）
4. 摆位套路
5. 踩过的坑

## 1. 拍图侧接口（`scripts/feature-guides/lib/browser.mjs`）

| 名字 | 作用 |
|---|---|
| `BASE` / `NOW` / `USER` | dev server 地址（`GUIDE_BASE` 可改）/ 截图时钟 2026-10-04 21:30 北京时间（`GUIDE_NOW` 可改）/ 演示账号 TP2026 |
| `launch()` | 起 Chromium（自动处理沙箱预装路径和 loopback 代理） |
| `newCtx(browser, { auth, seed, now, width, height, dpr, mobile })` | 一台设备：默认已登录 Pro、电脑版 1440×900、dpr 3、首次弹窗全标成已看过；`seed` 写 localStorage |
| `ctx.onApi = async (route, req, url) => bool` | 接管某个 `/api/*`，返回 true 表示已处理；没接管的回 `{ ok: true }` |
| `ctx.apiLog` | 这个设备调过的接口清单 |
| `snap(page, wd, name, specs)` | 整屏截图 + 按 specs 量元素框，返回要 `wd.saveMeta()` 的一条 |
| `findBoxes(page, specs)` | 只量框不截图（量完 patch 进 meta 用） |
| `boxesIn(page, selector)` | 把一个浮层里所有按钮/短文本的框全收下（弹窗类用，拼版时 `K.boxByText` 取） |
| `wordRect / scrollWordTo / clickWord` | 正文里某个词的框 / 把它滚到可见处 / 真鼠标点它 |
| `fontsReady(page)` / `sansDefault(page)` | 截图前等字体；挂在 body 上的浮层统一无衬线 |
| `SPEECH_MOCK` | `ctx.addInitScript(SPEECH_MOCK)`：沙箱没系统 TTS，模拟「念完了」 |

specs 写法：`{ 名字: { text: "看得见的文字", tag: "BUTTON", exact: false } }` 或 `{ 名字: { aria: "aria-label" } }`，
取包住这段文字的**最小**可见元素。量不到会打印 `! 画面: 没找到 名字`。

段落里的一截文字、输入框这类没有独立元素的东西，用 `page.evaluate` 自己量（Range/`getBoundingClientRect`），
再写进 meta：`const m = wd.readMeta(); m[画面].boxes.名字 = 框; wd.saveMeta({ [画面]: m[画面] });`
（`vocab/capture.mjs` 的 def、slots 就是这么补的）。

## 2. 拼版侧接口（`scripts/feature-guides/lib/poster.mjs`）

```js
const K = kit(wd.readMeta());
K.box(画面, 名字)                        // snap 时 specs 量的框
K.boxByText(画面, 文字, { tag, exact })  // boxesIn 收的框里按文字取最小的
K.need(画面)                             // 整条 meta（.clip、.boxes 以及自己补的字段）

const p = page(K, { n, total, shot, title, desc });   // shot = 这一页的主截图（右上缩略图用它）
const z = p.zoom({ crop, y, s, x, dim, tag, shot });
//   crop：截图里的 CSS px；s 缺省 = 1040 / crop.w（占满宽）；x 缺省居中
//   dim：[框…] 这些保持亮、其余压暗；框可带 r（圆角，截图 px）
//   tag：左上角「放大」角标，同一画面的第二条放大图传 false
//   shot：这块用另一张截图（例：展开了菜单的同一页）
z.map(框) → 画布坐标框；z.pt(x, y) → 画布坐标点；z.screen → 放大图在画布上的位置
const r = p.ring(z.map(框), { p: 6, radius: 12 });   // 橙圈；返回外扩后的 { x, y, w, h, cx, cy }
p.label({ t: "主句", s: "副句", side, at, from, via, align });
//   side：标签在 at 的哪一侧——left（at 是标签右边中点，文字自动右对齐）、right（左边中点）、
//         above（下边中点）、below（上边中点）
//   from：连线起点（一个点或数组），通常是 L(r) / R(r) / T(r) / B(r)；不传就不画线
//   via：连线拐点，用来绕开文字
p.footer("一行脚注，可用 <b>加粗</b>");
p.mark(crop) / p.raw(html)               // 多标一个缩略图橙框 / 塞任意 HTML（少用）
```

小工具：`union(框…)`、`rect(x, y, w, h)`、`grow(框, 外扩, 圆角)`（dim 亮区）、`L/R/T/B(圈)`、`bottom(框)`。
整套：`writePages(wd.dir, [[文件名, (n, total) => page], …])`。

标签位置是浏览器里按实际文字宽度算的（`LAYOUT_JS`），超出画布会自动收回；`render.mjs` 等它摆完才截图。

## 3. 版面尺寸（画布 1080×1440）

| 区域 | 位置 |
|---|---|
| 标题 | 左 56、上 110，62px 粗体不换行 → 最多约 9 个字 |
| 说明 | 左 56、上 196、宽 560，29px，一行约 19 字，最好 ≤3 行（4 行到 y≈376 还放得下） |
| 缩略图 | 左 650、上 104、宽 374（高 234），下面 y≈350 一行说明 |
| 放大区 | 从 y=400 开始；默认宽 1040（x 20–1060） |
| 内容底线 | 放大区 + 下方标签 + 脚注，整体在 y≈1400 内结束 |
| 脚注 | 自动放在最低内容下方 34px，宽 968、25px → 一行约 38 个汉字 |

- 放大倍数 `s = 1040 / crop.w`：s ≥ 1.3 截图里的字才看得清（crop.w ≤ 800）。
- 放大区高度 = crop.h × s。下面还要放标签就留 100–200px：例 crop.h 585、s 1.333 → 780 高（400–1180），按钮标签到 1285，脚注 1320。
- 标签：主句 27px 粗体，宽 ≈ 27 × 字数 + 32；副句 22px（宽 ≈ 22 × 字数 + 32）；高度一行 ≈ 55、两行 ≈ 87。
  同侧上下叠放，两行标签的中心至少隔 90。
- 标签离画布边至少 22px（超了会被收回来，可能压到别的东西）。

## 4. 摆位套路（大多在 `vocab/build.mjs` 里有原样）

- **弹窗/浮层在一侧，另一侧是压暗的正文**：标签全放压暗那侧，`side: "left"`、`at.x = 弹窗左边 - 22`，
  上下错开避免互叠（01 查词和收藏）。
- **卡片 + 底部按钮**：卡片里空白处放说明（如提示行右边的空档），按钮的标签放按钮下方
  `side: "below"`、`at.y = 按钮底 + 26`（03 阅读复习、05 听力复习）。
- **入口 + 主区**：入口用小放大图（`s: 2, x: 20`，宽约 440）标签放它右边；主区放大图放下面 y≈640（02 打开单词本）。
- **展开态**：同一页点开菜单后另拍一张，第二块放大图 `shot: "<那张>"`、`tag: false`、靠右放，
  只亮菜单和触发按钮，标签放左边连过去（04 拼写的 ⋯ 菜单）。
- **很长的页面/弹窗**：拆成两条放大图（上半 + 按钮），中间留 ~86px 放标签
  （早先 12 张版的「每 10 个词小结」这么做过，见提交 5982e43 里的 `vocab/build.mjs`）。
- **一个标签讲两个元素**：`from: [R(a), T(b)]`，一句话说清两者的关系。

## 5. 踩过的坑

1. `K.boxByText` 取「包含这段文字的最小元素」：一行提示里含同样的字就会被它抢走
   （「这句里的意思」被「点义项可以换成这句里的意思」抢了）→ 用更独特的片段（带冒号「这句里的意思：」）或 `exact`。
2. 元素框常比字宽得多（整行的 div）→ 圈 `rect(x, y, 字的实际宽, h)`，宽度用 peek 量。
3. 连线横穿文字像删除线（线穿过「及物动词」）→ 改圈整块、挪标签，或用 `via` 绕开。
4. 放大区上下边切到半行字很难看 → peek 2 倍找行距，把边挪进去。
5. 脚注折行只剩一两个字 → 缩到 38 字以内。
6. 页面内容少，底部留白大：可以接受，别拿口号或重复说明去填；真空得厉害就想想是不是该补一块真实画面。
7. 改了 `lib/poster.mjs` 之后，把已有的几套重新 build + render，`sha1sum` 对一下 `docs/feature-guides/<套>/`：
   没想改的那几套应当逐字节相同。
8. dev server 跨会话会没：capture 报「连不上 http://localhost:3100」就重起。
9. 截图里冒出公告/问卷弹窗：更新 `lib/browser.mjs` 的 `QUIET`（公告 id 跟 `data/announcements.json` 走）。
10. 有随机性的东西（复习队列顺序、FSRS 间隔扰动）：capture 里固定 `Math.random`，seed 脚本用固定种子 PRNG。
