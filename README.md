# TOEFL iBT 2026 Writing Practice Tool

AI驱动的托福写作练习工具，使用DeepSeek API进行评分。

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
