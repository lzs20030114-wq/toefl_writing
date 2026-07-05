---
name: swap-qrcode
description: Replace the WeChat group QR code image shown across the app. Use when the user says "换二维码"、"新的群二维码"、"二维码过期了 更新一下"、"新的群二维码在桌面，名字叫X 换上去"、"桌面上有个叫X的jpg 换上" or wants to update the group QR code image. The user typically drops the new image on the desktop (usually `C:\Users\35827\Desktop\` or "D盘桌面") and names the filename in the message.
user-invocable: true
argument-hint: [新图片路径,默认在桌面]
---

# 换群二维码

## 现状（已核实的真实路径）

- 图片文件：`public/wechat-group-qr.jpg`
- 唯一引用位置：`components/shared/WechatQrImage.js`，硬编码常量 `QR_IMAGE_SRC = "/wechat-group-qr.jpg"`
- 所有展示二维码的地方（`components/home/NavSidebar.js`、`components/home/MobileHomePage.js`、`components/shared/WechatGroupModal.js`）都通过这个共享组件渲染，**没有直接引用图片路径**
- 图片是本地静态文件（`public/` 目录），不是外链、不存 Supabase

**只要新图片文件名保持 `wechat-group-qr.jpg` 不变，直接覆盖 `public/wechat-group-qr.jpg` 即可，不需要改任何组件代码。**

## 步骤

### Step 1 — 确认新图来源

问用户新图片在哪里，通常是桌面：`C:\Users\35827\Desktop\`。如果用户已经在消息里给出路径，跳过这步。

### Step 2 — 覆盖到 public/ 下

把新图片复制/覆盖到 `public/wechat-group-qr.jpg`。

- 如果新图片本身也是 `.jpg` 格式，直接覆盖同名文件即可
- 如果新图片是其他格式（`.png`/`.webp` 等），有两个选择：
  1. 转成 `.jpg` 后覆盖（保持文件名不变，零代码改动）
  2. 保留原格式存成新文件名，然后同步修改 `components/shared/WechatQrImage.js` 里的 `QR_IMAGE_SRC` 常量指向新文件名 —— 这种情况明确告知用户"这次需要改一行代码"

用 PowerShell 复制文件（Windows 环境）：
```powershell
Copy-Item "C:\Users\35827\Desktop\<新图片文件名>" "D:\toefl_writing\public\wechat-group-qr.jpg" -Force
```

### Step 3 — 本地预览确认

用 `/run` 或直接起 dev server 预览，导航到首页侧边栏（`NavSidebar`）或触发 `WechatGroupModal`，确认新二维码正常渲染、清晰度可接受、点击放大功能正常（`WechatQrImage` 组件支持点击放大到全屏）。

### Step 4 — 提示推送

预览确认没问题后，提示用户：「二维码已经更新，走 `/ship` 推送上线吧。」——图片文件本身也需要走 git 提交才能部署到 Vercel。

## 特殊情况

- 如果用户说图片其实是外链（CDN/图床）或存在 Supabase Storage，**不要**按上面步骤覆盖本地文件 —— 先搜索确认实际存储位置和引用方式，再按实际情况调整步骤（例如改的是数据库里的一个 URL 字段，或者要走 Supabase Storage 上传 API）。当前代码库核实的情况是本地静态文件，这是最新鲜的核实结果，但如果代码后续变了以实际搜索结果为准。

## 触发示例

用户说：
- "换个群二维码" → 完整走 Step 1-4
- "群二维码过期了，换新的" → 完整走 Step 1-4
- "把桌面上那张二维码换上去" → Step 1 已知路径,直接 Step 2 开始
