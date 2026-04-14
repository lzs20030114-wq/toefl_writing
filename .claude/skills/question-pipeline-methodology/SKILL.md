---
name: question-pipeline-methodology
description: >
  Methodology for building new exam question generation pipelines from scratch.
  Use this skill when building a question generation system for ANY exam type —
  TOEFL reading/listening/speaking, IELTS, GRE, SAT, or any standardized test.
  Triggers on: "build a pipeline", "new question type", "出题管线", "生成管线",
  "add listening/speaking questions", "create question generator", or any task
  involving systematic exam question generation with AI.
---

# 搭建新题型出题管线的完整方法论

本 skill 总结了从零搭建三套出题管线（CTW/RDL/AP）的完整经验，提炼成可复用的方法论。适用于任何标准化考试的新题型开发。

## 核心理念

搭建出题管线不是"写一个 prompt 让 AI 出题"。它是一个**数据驱动的工程流程**：

```
真题采集 → 量化分析 → Profile 建模 → Prompt 工程 → 校验体系 → AI 审核 → 压力测试 → 迭代优化
```

每一步都有明确的输入、输出和质量标准。跳过任何一步都会导致最终出题质量不达标。

---

## Phase 1: 真题研究（1-2天）

### 目标
搞清楚"真题的味道到底是什么" — 把模糊的"感觉像真题"变成可量化的指标。

### 步骤

**1.1 题型规格确认**
- 从官方来源（ETS/British Council/EDB 等）确认题目的精确格式
- 确认：文本长度、题目数量、选项格式、评分方式、时间限制
- 区分子类型（如 RDL 有 short 40-50词/2题 和 long 100-150词/3题）

**1.2 样题采集**
- 优先级：官方样题 > 权威备考网站 > 第三方练习题
- 目标量：至少 10-15 套完整样题（含文本+题目+选项+答案+解析）
- 存储格式：统一的 JSON schema，包含所有元数据

**1.3 多维度量化分析**

对采集的样题做至少 8 个维度的量化分析：

| 维度 | 分析什么 | 输出指标 |
|------|---------|---------|
| 词汇 | 学术词覆盖率、词长分布、词频 | AWL 2.7%, avg 5.7 chars |
| 句法 | 被动语态、从句、句长变化 | passive 0.23/sent, CV 0.344 |
| 篇章 | 过渡词、模糊表达、定义模式 | hedging 0.93%, transitions 8.5/篇 |
| 题干 | 措辞模式、平均长度、开头词频 | "According to" 29% |
| 选项 | 长度平衡、语法平行、正确选项偏长比 | parallel 97%, longest 34% |
| 干扰项 | 每种题型的干扰项策略分布 | wrong_detail 31%, not_mentioned 29% |
| 结构 | 修辞模式、段落角色、主题句规律 | 100% topic sentence, 91% cohesion |
| 映射 | 正确答案与原文的改写策略、词汇重叠率 | factual 58%, inference 32% |

**1.4 生成 Profile 文件**

将分析结果固化为代码常量（如 `readingEtsProfile.js`），作为后续所有环节的"真理来源"。

### 关键产出
- `data/{taskType}/samples/` — 结构化样题数据
- `data/{taskType}/profile/` — 量化分析结果（JSON）
- `lib/{taskType}Bank/profile.js` — Profile 常量模块

### 常见坑
- **样题来源偏差**：第三方练习题可能有自己的"味道"（如答案偏 B），不能直接当 ETS 标准
- **样本量不足**：8 篇样题的统计不稳定，扩到 50+ 篇后数据才稳定
- **遗漏维度**：第一轮分析容易遗漏"选项间词汇独立性"、"日期分组"等细微维度

---

## Phase 2: Prompt 工程（1-2天）

### 目标
写出能让 AI 生成"味道对"的题目的 prompt。

### Prompt 架构

一个好的出题 prompt 包含 5 层约束：

```
Layer 1: 文本约束（长度、段落数、句式要求）
Layer 2: 风味约束（从 Profile 提取的量化指标）
Layer 3: 题目约束（题型分布、答案位置预分配）
Layer 4: 干扰项约束（每种题型的干扰项制造策略）
Layer 5: 反面约束（禁止第一人称、禁止反问句等）
```

### 核心原则

**原则 1：用 Example 而不是 Rule**
- ❌ "Sentence 1 MUST use passive voice"（DeepSeek 遵循率 30%）
- ✅ 给一个完整的 example passage，标注"KEY FEATURES TO COPY: Sentence 1 uses passive"

**原则 2：答案位置预分配**
- 在 prompt 中明确指定每道题的正确答案位置（A/B/C/D）
- 用 pool shuffle 确保批次内均匀分布
- 不要让 AI 自己决定答案位置（会严重偏 B）

**原则 3：干扰项策略要具体到百分比**
- ❌ "Write plausible distractors"
- ✅ "For factual_detail: Distractor 1 uses 2-3 passage terms but CHANGES their relationship (wrong_detail). Distractor 2 introduces topically-related content NOT in the passage (not_mentioned)."

**原则 4：话题去重**
- 从已有 staging 文件中提取已生成的 subjects
- 在 prompt 中明确列出"DO NOT WRITE ABOUT: cell membrane, coral reefs..."
- 使用 round-robin 在 topic pool 中循环

### Prompt Builder 代码模式

```javascript
function buildPrompt(count, opts = {}) {
  const { excludeSubjects = [], rejectionFeedback = [] } = opts;
  
  // 1. 话题选择 + 去重
  const selected = selectTopics(count, excludeSubjects);
  
  // 2. 答案位置预分配
  const posPool = shufflePositions(count * questionsPerItem);
  
  // 3. 组装 item specs
  const itemSpecs = selected.map((s, i) => {
    const positions = posPool.splice(0, questionsPerItem);
    return `${i+1}. Topic: ${s.topic}/${s.subtopic}\n   Questions: ${positions.join(", ")}`;
  });
  
  // 4. 拼接 prompt（约束层叠加）
  return `${PASSAGE_REQUIREMENTS}\n${QUESTION_REQUIREMENTS}\n${DISTRACTOR_ENGINEERING}\n${itemSpecs}\n${EXCLUSIONS}\n${OUTPUT_FORMAT}`;
}
```

### 关键产出
- `lib/readingGen/{taskType}PromptBuilder.js`

---

## Phase 3: 校验体系（0.5天）

### 目标
建立三级校验，自动拦截不合格的生成结果。

### 三级校验架构

```
Level 1: Schema 校验（硬性错误 → 直接拒绝）
  - 必填字段是否存在
  - 数值范围是否合规（词数、题数、选项数）
  - 枚举值是否有效（题型、答案位置）

Level 2: Profile 校验（软性警告 → 通过但标记）
  - ETS 风味指标（hedging、passive、contrast）
  - FK 可读性等级
  - 选项长度分布

Level 3: 质量门控（条件性错误 → 可升级为拒绝）
  - 正确答案是否总是最长的
  - 选项间词汇重叠度
  - 干扰项是否使用绝对词（all/always/never）
  - 同一 item 内答案位置是否全相同
```

### 批次校验
- 整批答案位置分布是否接近均匀（25% each）
- 话题多样性（批次内是否有重复主题）
- 体裁覆盖度（RDL 是否 email/notice 都有）

### 代码模式

```javascript
function validateItem(item) {
  const errors = [];   // 硬性错误 → 拒绝
  const warnings = []; // 软性警告 → 通过
  
  // Level 1: Schema
  if (wc(item.passage) < MIN_WORDS) errors.push(`word_count: ${wc} < ${MIN_WORDS}`);
  
  // Level 2: Profile
  if (!hasHedging(item.passage)) warnings.push("no_hedging");
  
  // Level 3: Quality
  if (correctIsLongest(item) > 0.4) warnings.push("correct_too_long");
  
  return { pass: errors.length === 0, errors, warnings };
}
```

### 关键产出
- `lib/readingGen/{taskType}Validator.js`

---

## Phase 4: AI 审核（0.5天）

### 目标
用 AI 作为"第二审核官"，独立验证答案正确性。

### 审核模式

**Pass 1: 带原文作答（验证正确性）**
- 把原文+题目+选项发给 AI（不告诉正确答案）
- AI 独立选答案
- 如果 AI 答案 ≠ 标注答案 → CRITICAL flag

**Pass 2: 不带原文猜题（验证可猜性）**
- 只发题目+选项（不给原文）
- AI 靠常识猜
- 如果猜对 → GUESSABLE warning（干扰项太弱）

### 关键参数
- temperature: 0.1（低温确保确定性）
- 对 AP 的 5 道题全部独立审核
- 任何一题 mismatch → 整个 item 被标记

### 审核效果实测
- RDL: 每批约 5-10% 的题被审核发现答案错误
- AP: 约 3-5% 被发现
- CTW: 机械挖空无需审核（正确性由算法保证）

### 关键产出
- `lib/readingGen/answerAuditor.js`（可跨题型复用）

---

## Phase 5: 生成脚本（0.5天）

### 目标
串联以上所有模块的编排脚本。

### 标准流程

```
1. 解析 CLI 参数 (--count, --difficulty, --skip-audit, --dry-run)
2. 从 staging 目录读取已有 subjects 做去重
3. 调用 PromptBuilder 构建 prompt
4. 调用 AI API（DeepSeek/GPT/Claude）
5. JSON 解析 + 部分响应 salvage
6. 逐 item 校验（schema + profile + quality）
7. 批次校验（答案分布、话题多样性）
8. [可选] AI 审核（移除 mismatch 的 item）
9. 保存到 staging 目录
10. 输出统计摘要
```

### JSON Salvage 机制

AI 的 JSON 输出经常被截断（尤其是大批量时）。必须有 salvage 逻辑：

```javascript
function salvagePartialJson(text) {
  const body = text.slice(text.indexOf("[") + 1);
  const items = [];
  let depth = 0, objStart = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{" && depth === 0) objStart = i;
    if (body[i] === "{") depth++;
    if (body[i] === "}") depth--;
    if (body[i] === "}" && depth === 0 && objStart >= 0) {
      try { items.push(JSON.parse(body.slice(objStart, i + 1))); } catch {}
      objStart = -1;
    }
  }
  return items;
}
```

### 批量限制（经验值）
- CTW: 无限制（token 轻量）
- RDL: ≤10 题/批（超过 10 JSON 截断率高）
- AP: ≤5 题/批（5 题 × 5 问 × 4 选项 + 解析 = 大量 token）

### 关键产出
- `scripts/generate-{taskType}.mjs`

---

## Phase 6: 压力测试 + 迭代（1-2天）

### 测试计划

| 测试项 | 目标 | 方法 |
|--------|------|------|
| 通过率 | ≥60% | 生成 30 题，统计 accepted/total |
| AI 审核准确率 | ≥80% 一致 | 对 accepted 的题跑审核 |
| 答案分布 | 各 25%±10% | 统计 A/B/C/D 分布 |
| 话题覆盖 | ≥5 种不同话题 | topic breadth 分析 |
| 跨 item 相似度 | <20% Jaccard | pairwise 词汇重叠 |
| 用户体验 | 能正常做题 | 实际做一遍 |

### 常见问题 + 解法

| 问题 | 根因 | 解法 |
|------|------|------|
| 通过率太低 (20%) | 校验太严 or prompt 约束冲突 | 把 hedging/passive 从 error 降级为 warning |
| 全部 hard 难度 | 难度词表太窄 | 扩充 EASY_WORDS 列表 |
| 文章太短 | AI 把"easy"理解为"短" | 去掉 difficulty 参数，统一生成 medium |
| 答案偏 B | AI 默认偏好 | 在 prompt 中预分配答案位置 |
| 金额缺失 | prompt 说了但 AI 没听 | 在 item spec 里直接指定 "MUST INCLUDE $" |
| 话题重复 | 没有去重 | 传 excludeSubjects 到 prompt |
| JSON 截断 | 批量太大 | 限制 MAX_BATCH ≤ 10 |
| 干扰项太弱 | 未指定策略 | 按题型列出干扰项制造百分比 |

### 迭代循环

```
生成 → 统计 → 发现问题 → 改 prompt/validator → 再生成 → 再统计 → ...
```

一般需要 3-5 轮迭代才能稳定。

---

## Phase 7: 前端集成（1天）

### 标准集成点
1. **首页入口卡片** — 在 section content 中加 task card
2. **路由页面** — `/reading?type={taskType}` 渲染做题组件
3. **做题组件** — 复用已有模式（如 RDLTask 可被 AP 复用）
4. **Session 保存** — 调用 `saveSess()` 保存完整题目数据
5. **练习记录** — 在 ProgressView 中加入新类型的筛选和展开详情

### Session 数据设计
必须保存完整题目数据（不只是对错），这样练习记录才能显示原题回顾：
```javascript
saveSess({
  type: "reading",
  correct: result.correct,
  total: result.total,
  details: {
    subtype: "ap",
    passage: item.passage,        // 完整原文
    questions: item.questions,    // 完整题目+选项+解析
    results: result.results,      // 用户作答+对错
  },
});
```

---

## 清单：搭建新题型需要创建的文件

```
lib/{examType}Bank/
├── {taskType}Profile.js          # Profile 常量

lib/{examType}Gen/
├── {taskType}PromptBuilder.js    # Prompt 构建器
├── {taskType}Validator.js        # 校验器
├── answerAuditor.js              # AI 审核（可跨题型复用）
└── {taskType}Difficulty.js       # [可选] 难度估算

scripts/
├── generate-{taskType}.mjs       # 生成脚本
├── analyze-{taskType}-flavor.mjs # [可选] 味道分析脚本
└── audit-{taskType}-staging.mjs  # [可选] 独立审核脚本

data/{examType}/
├── samples/{taskType}/           # 样题数据
├── profile/                      # 分析结果
├── bank/                         # 题库（部署后）
└── staging/                      # 生成暂存区
```

---

## 经验数据：三条管线的实际表现

| 指标 | CTW | RDL | AP |
|------|-----|-----|-----|
| 开发周期 | 1 天 | 2 天 | 1.5 天 |
| 通过率 | 90% | 96-100% | 100% |
| AI 审核一致率 | 98% | 93% | 100% |
| 平均每批生成 | 10 题 | 10 题 | 3 题 |
| max_tokens | 4000 | 8000 | 8192 |
| 迭代轮数 | 5 轮 | 4 轮 | 2 轮 |
| 核心难点 | 文章太短 | 金额/时间缺失 | 干扰项质量 |
