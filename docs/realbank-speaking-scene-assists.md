# 口语练习辅助配图

独立数据文件为 `data/realBank/speaking/scene-assists.json`，不写入原题库或原图修复账本。
结构为 `{ "version": 1, "entries": [] }`。每条 entry 必须包含：

- `item_id`、`sentence_id`、`sentence_text`：与原题逐字相同；重复绑定、原句变化、题号不在该组时整条不采用。
- `url`、`w`、`h`：原始底图地址及正整数宽高。本地地址从 `/` 开始，远程必须 HTTPS。
- `kind`：`highlight`（界面标“辅助高亮”）或 `redraw`（标“辅助重绘图”）。
- `overlay`：归一化 0–1 坐标数组；highlight 至少一个形状，redraw 可以为空。
- `references`：非空数组，每项 `{ "url": "来源或本地证据路径", "note": "可选依据" }`。

支持的形状：`{type:"rect",x,y,width,height}`、`{type:"ellipse",cx,cy,rx,ry}`、
`{type:"polygon",points:[[x,y],...]}`。形状必须处于图像范围内。坐标针对完整原图，
SVG 覆盖层随原图等比布局；不修改原位图、不注入任意 SVG/HTML 或自定义样式。

`mapRealRepeatSet` 只在精确绑定且结构有效时输出 `assist_frames`。
练习显示优先级：原逐句高亮 → 辅助帧 → 原无高亮逐句图 → 原底图。
旧帧没有 `frame_kind` 时保留既有优先级；不能把未知旧帧自动判成无高亮图。
引入屏优先原底图，没有底图时可显示第一句可用图。

`realMock` 或 `etsNumbering` 任一开启就排除辅助帧，包含作答、引入屏和预热。
模考组卷池在生成 checkpoint 前剔除 `assist_frames`；SceneImage 的 ETS 外观也拒绝辅助帧。
口语练习历史保存句子和评分结果，不保存 setInfo 或辅助图数据。

## 2026-10-18 覆盖与证据边界

辅助目录共 69 条绑定：40 条辅助高亮、29 条辅助重绘。重绘来自观鸟、在线图书馆、档案室三个场景。
其中观鸟 `real_repeat_518_1_s7` 与 `real_repeat_rp0830_1_s28` 只显示完整辅助重绘图，overlay 为空：
图中树冠没有可辨认的活鸟，不能以树冠高亮冒充原句所说的附近鸟类。

原图覆盖保持 315/464 句；练习叠加辅助图后可显示图像为 344/464 句，仍缺 120 句。
辅助绑定总数不等于新增覆盖句数，部分绑定用于已有底图的逐句辅助高亮。
两个高亮候选仍为 HOLD，未计入 40 条辅助高亮；既有底图保持显示，仍计入原图覆盖：
`real_repeat_rf0826_1_s5` 的邮件对象不可辨，`real_repeat_rp0719_1_s3` 的矮墙不可辨。

档案室缺失区域中的阅读桌与打开的书，是根据原句提到的安静阅读区作出的解释性补绘；
原截图被裁切，不能证明桌子的完整外观或位置，更不能称为原图像素恢复。
原生成提示词完整保存在 `data/realBank/speaking/scene-assist-provenance.json`，不因后续取消高亮而改写。

## 真实浏览器验收

主线程挂载真实 RepeatTask、SceneImage 与 mapRealRepeatSet 完成验收：390px 容器无横向溢出；
观鸟 s1 → s4 在相同底图 URL 上正确切换 SVG 形状；s7 形状数为 0，仍显示“辅助重绘图”标签。
realMock 与 etsNumbering 模式都不显示辅助帧，观鸟辅助图片预热列表为空。
rp0719 s15 练习显示辅助高亮，模考显示原底图；121a s2 继续优先使用原高亮。
在线图书馆和档案室图片均成功加载。

截图：`.codex-tmp/realbank/scene-assist/browser-task-preview.png`。
类型检查通过；定向 lint 仅余 RepeatTask 既存的 hook warning。
临时验收页 `app/zz-scene-assist/page.js` 已在浏览器验收结束后删除。
