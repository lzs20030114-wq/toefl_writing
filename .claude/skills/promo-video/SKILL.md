---
name: promo-video
description: 制作产品功能演示宣传片（HTML 动画 → 无头浏览器录制 → MP4 成片，含配乐/镜头/光标/转场）。Use when 用户要做演示视频、宣传片、功能 demo 视频、产品介绍动画，或说"做个视频/宣传片/演示"。横竖屏双版本产出。
disable-model-invocation: false
user-invocable: true
argument-hint: [要演示的功能/页面] [横版|竖版|双版本] [时长]
---

# 产品演示宣传片制作管线

把产品功能做成精美的演示宣传片。整套管线在本仓库已跑通 9 个版本迭代，
canonical 模板见 `public/demo/writing-promo.html`（横版）与
`writing-promo-vertical.html`（竖版），直接参照其结构改内容是最快路径。

## 总体管线

```
1. 自包含 HTML 动画页（时间轴导演引擎，可在浏览器直接预览/循环播放）
2. puppeteer + CDP Page.startScreencast 抓帧（带时间戳）
3. ffmpeg concat demuxer 按真实帧间隔合成 → 30fps H.264
4. node 程序化合成配乐 WAV（120 BPM，结构对齐时间轴）
5. ffmpeg mux 音视频 → 最终 MP4（横版 1920×1080 + 竖版 1080×1920）
```

环境准备（远程容器每次重建后都要重装）：
```bash
sudo apt-get update && sudo apt-get install -y ffmpeg   # 系统 ffmpeg
mkdir -p /tmp/promo-rec && cd /tmp/promo-rec && npm init -y && npm install puppeteer
# puppeteer 会自带下载 Chrome（playwright 的 CDN 在本环境被网络策略拦截，不要用）
# puppeteer 内置 page.screencast() 会 EPIPE 崩溃，必须用本 skill 的 CDP 抓帧脚本
```

## HTML 动画页架构（核心分层）

```
#stage（逻辑舞台，固定设计坐标，transform scale 适配窗口）
└─ #camera（虚拟镜头层：所有场景+光标+字幕都在内，推拉缩放同步生效）
   ├─ .scene × N（绝对定位叠放，.on 显示）
   ├─ .ft × N（苹果风自由文字字幕，逐分镜手工定位）
   └─ #cur（模拟鼠标光标 SVG）
#wipe（品牌擦除转场条，镜头层外、最上层）
#progress / #replay（播放控制）
```

### 时间轴导演引擎
所有动效按绝对毫秒编排：`at(t, fn)` + `go(id)`（加 .go 类触发 CSS 过渡）。
`restart()` 清空所有 timer/类名/内联状态后重播——录制脚本靠它从 0 帧开始。
新增任何带状态的元素（计数器、进度条、展开节）都必须同步加进 restart()。

### 节拍对齐（配乐卡点的前提）
120 BPM：beat=0.5s，小节=2s。**所有场景切换落在小节线（偶数秒）**。
配乐结构与叙事对齐：开场 pad → 第一场景 drop1（鼓进）→ 中段加 hats/clap →
高潮揭晓前 4s 抽鼓 breakdown + riser 蓄力 → 揭晓瞬间 drop2 →
结尾终止和弦 + 2s 淡出。每次转场配 crash。改时间轴必须同步改 music.js。

## 关键经验（每条都是踩坑换来的）

### 1. 转场：绝对不要用全屏 blur
软渲染（无 GPU 容器）下 `filter:blur` 让帧率从 ~45fps 掉到 ~20fps，
掉帧正好集中在转场上，观感就是"卡"。正确做法——**品牌渐变斜向擦除条**：
- 纯 transform 动画（zero 滤镜开销）
- 宽 260%、实色带占 70%（全屏遮挡窗口 ~136ms，足够换场景）
- 场景交换必须在**完全遮挡的瞬间瞬时完成**（off 无过渡、on 快速浮现）；
  若用慢淡入淡出，擦除条扫过后会露出半空白舞台
- 遮挡时点要按渐变几何+缓动曲线推算（模板已调好：wipe 在小节线前
  620ms 启动，off 在 T-80，on 在 T，缓动 cubic-bezier(.55,0,.25,1)）

### 2. 虚拟镜头：必须加边界 clamp
推近边缘元素（行首批注词、左上角分数）时取景框会跑出舞台露出空白。
camTo() 内对目标点做 `cx ∈ [W/2s, W-W/2s]` 钳制（见模板）。
镜头节奏：每场景 1 次 ken-burns 缓推或 1 次目标特写；点击按钮瞬间
快速 punch-in（~1.2x / 400ms）最提神。

### 3. 字幕（解说文字）
- **放在 #camera 内**（随画面缩放，是构图的一部分），不要放舞台层
- **逐分镜手工定位到内容留白区**：气泡读完后的面板空白、编辑器输入区
  下方、卡片上方居中、收起分节标题行的中部空白带（左标题右徽章之间）
- **避开屏幕底部**——流媒体播放器的标题/进度条会遮挡；也避开边角
- 镜头特写前先 unGo 退场，让位给细节
- 苹果风样式：无框大字 + 行掩码入场（translateY 110%→0）+ 品牌渐变
  关键词；白色光晕 text-shadow 保证压在内容上可读；
  **渐变字 span 必须单独去掉 text-shadow**（透明字形叠阴影会发虚）

### 4. 字号 / 分辨率：用"光学放大"而不是逐个调字号
缩小逻辑舞台 = 所有内容等比放大、布局零破坏：
- 横版：逻辑 1280×720 → 录制 1920×1080（1.5×，真 1080p）
- 竖版：逻辑 **540×960**（手机 CSS 视口尺寸！）→ 录制 1080×1920（2×），
  布局按手机宽度自然重排，手机观看是原生 App 阅读尺寸
- 应用窗口边距收窄（横版 48px、竖版 14px），内容占满画面主体

### 5. 可展开分节（仿 DisclosureSection 的报告页）
- 展开动画用 grid-template-rows 0fr→1fr（内层 overflow:hidden）
- **动画结束后必须加 .settled 类解除 overflow 并提升 z-index**，
  否则悬浮弹窗（批注 tooltip）会被卡片边界裁剪
- 页面滚动用 repInner translateY + offsetTop 测量，光标点击分节头 →
  展开 → 滚动跟随，复刻真实使用感

### 6. 演示内容策划
- 题目用**产品实际在用的题库**（data/ 下 JSON），不要自己编
- 样例答案故意用**低分稿 + 密集植入错误**（拼写/语法/碎片句/低阶词），
  这样批改的每个模块（批注/词汇/范文/模式）都有干货可展示
- 全片内容围绕同一道题保持叙事连贯（作答→批注→范文→重写对比）
- 收尾闭环：点击"重写本题"→ 两稿进步对比场景，呼应开头的提交动作

### 7. 双版本产出
竖版不要单独维护——用 python 脚本从横版**生成**（参照 git 历史里的
生成脚本模式）：替换舞台尺寸/SW・SH 常量/镜头硬编码坐标/光标尺寸，
追加一段竖屏布局覆盖 CSS（列向堆叠 + 逐分镜字幕坐标）。

### 8. QC 流程（每次改完必做）
```bash
ffmpeg -ss <秒> -i out.mp4 -frames:v 1 -y check.png   # 抽关键帧
```
用 Read 工具直接看图。重点检查：转场全遮挡瞬间、镜头特写取景、
弹窗是否裁剪、字幕与内容是否重叠、竖版字号。发现问题改完重录。

## 录制与合成命令

```bash
cd /tmp/promo-rec
# 录制（脚本见本 skill 的 scripts/record.js；DURATION_MS 按时间轴+2s 调）
PAGE_URL=file:///<repo>/public/demo/writing-promo.html VW=1920 VH=1080 \
  OUT=list_h.txt FRAMES_DIR=/tmp/promo-rec/frames_h node record.js
# 合成视频（VFR→30fps）
ffmpeg -f concat -safe 0 -i list_h.txt \
  -vf "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p" \
  -c:v libx264 -crf 19 -preset medium -y video.mp4
# 配乐（scripts/music.js，按时间轴改结构后运行）
node music.js
# Mux
ffmpeg -i video.mp4 -i music.wav -c:v copy -c:a aac -b:a 192k \
  -shortest -movflags +faststart -y final.mp4
# 音量体检：mean ≈ -15dB、max < 0dB 不削波
ffmpeg -i final.mp4 -af volumedetect -f null - 2>&1 | grep volume
```

## 交付清单

- [ ] 横版 MP4（1920×1080/30fps）+ 竖版 MP4（1080×1920/30fps）
- [ ] HTML 源文件提交到 `public/demo/`（浏览器打开即自动循环播放，可在线访问）
- [ ] SendUserFile 发送成片；commit + push
- [ ] 用户反馈迭代时：改 HTML → 重录 → 抽帧 QC → mux → 交付，单轮 ~5 分钟
