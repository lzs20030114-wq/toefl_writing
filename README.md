# TOEFL iBT 2026 Writing Practice Tool

AI驱动的托福写作练习工具，使用DeepSeek API进行评分。

## 部署步骤（10分钟搞定）

### 第一步：上传到GitHub
1. 去 [github.com](https://github.com) 登录（没有就注册一个）
2. 点右上角 **+** → **New repository**
3. 名字填 `toefl-writing`，点 **Create repository**
4. 把这个文件夹里的所有文件上传上去（拖进去或用git命令）

### 第二步：部署到Vercel
1. 去 [vercel.com](https://vercel.com) 用GitHub账号登录
2. 点 **Add New** → **Project**
3. 选你刚创建的 `toefl-writing` 仓库，点 **Import**
4. **重要！** 在 **Environment Variables** 区域添加：
   - Key: `DEEPSEEK_API_KEY`
   - Value: `sk-91296059865048a2a48794128c90ab30`
5. 点 **Deploy**
6. 等1-2分钟，完成后会给你一个网址 `https://toefl-writing-xxx.vercel.app`

### 完成！
打开那个网址就可以开始练习了。API key安全地存在Vercel服务器上，不会暴露给浏览器。

## 项目结构
```
app/
  api/ai/route.js   ← 服务端API代理（保护DeepSeek密钥）
  layout.js          ← HTML布局
  page.js            ← 主页面
components/
  ToeflApp.js        ← 全部练习逻辑和UI
```

## 技术栈
- Next.js 14 (App Router)
- DeepSeek Chat API
- Vercel (免费hosting)
- localStorage (成绩记录)
