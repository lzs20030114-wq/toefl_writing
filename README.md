# TOEFL iBT 2026 Writing Practice Tool

一个基于 Next.js 14 的托福写作练习项目，覆盖 TOEFL Writing 三类任务：

- Task 1: Build a Sentence
- Task 2: Write an Email
- Task 3: Academic Discussion

项目支持 AI 评分、逐句批注、短板行动建议、范文对比，并记录练习历史。

## 功能概览

### 1) 练习任务

- `Build a Sentence`
  - 拖拽/点击式排句
  - 倒计时
  - 自动判分（支持可接受替代答案）
  - 语法点薄弱项统计

- `Write an Email` / `Academic Discussion`
  - 计时写作
  - AI 评分与诊断
  - 失败重试
  - AI 生成新题（可选）

### 2) 报告（Task 2/3）

评分报告已升级为 5 板块结构：

- 默认展开
  - 分数 + 总评（Email 含 Goal Checklist）
  - 短板行动卡（1-2 个，可立刻执行）
- 折叠展开
  - 逐句批注（红/橙/蓝三级）
  - 模式总结（标准化标签）
  - 范文对比（范文 + 差异点）

### 3) 历史记录

- 使用 `localStorage` 持久化最近练习记录
- 支持查看、删除单条、清空全部

## 技术栈

- Next.js 14 (App Router)
- React 18
- DeepSeek Chat API（经服务端代理）
- Jest + Testing Library（单测）
- Playwright（E2E）

## 核心实现逻辑

### 1) 路由与页面

- `app/page.js`: 任务入口
- `app/build-sentence/page.js`: Task 1
- `app/email-writing/page.js`: Task 2
- `app/academic-writing/page.js`: Task 3
- `app/progress/page.js`: 历史页面

### 2) AI 调用链

- 前端通过 `lib/ai/client.js` 调用 `/api/ai`
  - 默认 30 秒超时
  - 分类错误提示（超时/鉴权/限流/网络等）
- 服务端代理在 `app/api/ai/route.js`
  - 使用 `DEEPSEEK_API_KEY`
  - 隐藏真实 API Key

### 3) 报告解析链路（Task 2/3）

- Prompt 要求模型按 `===SECTION===` 输出（SCORE/GOALS/ANNOTATION/PATTERNS/COMPARISON/ACTION）
- `lib/ai/parse.js` 逐段解析并容错：
  - 单板块解析失败不影响其他板块
  - 兼容旧版 JSON 报告格式

### 4) Build Sentence 题库质量门禁

- Schema 校验：`lib/questionBank/buildSentenceSchema.js`
- 质量校验：`lib/questionBank/qualityGateBuildSentence.js`
- 抽题策略：`lib/questionSelector.js`
  - 默认 `easy/medium/hard = 3/3/4`
  - 会话内去重（题目 ID + 渲染句子）

## 项目结构

```text
app/
  api/ai/route.js
  page.js
  build-sentence/page.js
  email-writing/page.js
  academic-writing/page.js
  progress/page.js

components/
  buildSentence/BuildSentenceTask.js
  writing/WritingTask.js
  writing/ScoringReport.js
  ProgressView.js

lib/
  ai/client.js
  ai/parse.js
  ai/prompts/
  questionBank/
  questionSelector.js
  sessionStore.js
  utils.js

data/
  buildSentence/
  emailWriting/prompts.json
  academicWriting/prompts.json
```

## 本地运行

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量

创建 `.env.local`：

```bash
DEEPSEEK_API_KEY=your_deepseek_key
```

### 3) 启动开发服务器

```bash
npm run dev
```

访问：`http://localhost:3000`

## 测试

- 单测：`npm run test:unit`
- E2E：`npm run test:e2e`

## 题库脚本

- 校验题库：`npm run validate:bank`
- 生成并保存 Build Sentence 题库：`node scripts/save-build-sentence-bank.js --input <json-file>`

## 备注

- 本项目为练习工具，不隶属于 ETS。
- AI 评分用于学习参考，不等同于真实考试评分。
