---
name: swap-qrcode
description: Replace the WeChat group QR code image shown across the app. Use when the user says "换二维码"、"新的群二维码"、"二维码过期了 更新一下"、"新的群二维码在桌面，名字叫X 换上去"、"桌面上有个叫X的jpg 换上" or wants to update the group QR code image. Since the admin upload page exists, the default answer is to point the user at /admin-wechat-qr; only fall back to replacing the static file when they explicitly want the built-in default image changed.
user-invocable: true
argument-hint: [新图片路径,默认在桌面]
---

# 换群二维码

## 现状（已核实的真实路径）

二维码有两层：

1. **后台自定义图（首选，无需代码/部署）**：后台页 `/admin-wechat-qr`，把新图拖进去即上传到
   Supabase Storage（bucket `app_assets`，对象键 `wechat/group-qr`，首次上传自动建桶）。
   前台所有位置通过 `components/shared/WechatQrImage.js` → 同源代理 `/api/wechat-qr`
   （Edge，国内可达）读取；缓存 60s，线上约 2 分钟内生效。
   - 后台 API：`app/api/admin/wechat-qr/route.js`（GET 状态 / POST 上传 / DELETE 恢复默认）
   - 存储层：`lib/wechatQr/storage.js`
   - 代理：`app/api/wechat-qr/route.js`
2. **内置默认图（兜底）**：`public/wechat-group-qr.jpg`。没上传过自定义图、Storage 未配置、
   或上游失败时，代理 302 到它。只有想改「默认图」本身才需要动这个文件 + git 提交部署。

展示二维码的地方（`components/home/NavSidebar.js`、`components/home/MobileHomePage.js`、
`components/shared/WechatGroupModal.js`）都只用共享组件，**不要直接改它们**。

## 步骤

### 首选：后台拖图（用户自己 30 秒搞定）

告诉用户：打开 `/admin-wechat-qr`（后台侧栏「运营 → 微信群二维码」），把新图拖进虚线框
（也可点选文件 / Ctrl+V 粘贴截图），上传完右侧「当前线上二维码」会立刻显示新图。
不用推送、不用部署。要撤回就点「恢复默认图」。

限制：JPEG / PNG / WebP，≤ 3MB。上传失败常见原因：口令没填（先在任意后台页输入
ADMIN_DASHBOARD_TOKEN）、Vercel 没配 `SUPABASE_SERVICE_ROLE_KEY`。

### 备选：改内置默认图（仅当用户明确要求，或 Storage 不可用）

1. 确认新图来源（通常桌面 `C:\Users\35827\Desktop\`）。
2. 覆盖到 `public/wechat-group-qr.jpg`（非 jpg 先转成 jpg，保持文件名不变，零代码改动）：
   ```powershell
   Copy-Item "C:\Users\35827\Desktop\<新图片文件名>" "D:\toefl_writing\public\wechat-group-qr.jpg" -Force
   ```
3. 本地预览（首页侧栏 / WechatGroupModal，点击放大正常）。注意：如果 Storage 里已有
   自定义图，前台显示的是自定义图而不是默认图——要让默认图生效需在后台点「恢复默认图」。
4. 提示用户走 `/ship` 推送（静态文件必须 git 提交才能部署）。

## 触发示例

- "换个群二维码" / "群二维码过期了" → 首选路径：指引去 `/admin-wechat-qr` 拖图
- "把默认的那张二维码也换掉" / "后台传不上去" → 备选路径 Step 1-4
