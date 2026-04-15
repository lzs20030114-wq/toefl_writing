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

## Phase 1: 真题研究（2-3天）

### 目标
搞清楚"真题的味道到底是什么" — 把模糊的"感觉像真题"变成可量化的指标。这是整个管线最重要的阶段，深度决定了后续出题质量的上限。

### 步骤

**1.1 题型规格确认**
- 从官方来源（ETS/British Council/EDB 等）确认题目的精确格式
- 确认：文本长度、题目数量、选项格式、评分方式、时间限制
- 区分子类型（如 RDL 有 short 40-50词/2题 和 long 100-150词/3题）
- 搜索关键词模式：`"题型名" sample questions ETS official`、`"题型名" 样题 真题 解析`

**1.2 样题采集（广度搜集）**
- 优先级：官方样题 > 权威备考网站 > 第三方练习题
- **目标量：至少 15-20 套完整样题**（含文本+题目+选项+答案+解析）
- 搜索来源清单（按优先级）：
  1. ETS 官网 sample test
  2. 权威备考站（TestSucceed, TOEFLResources, Magoosh, TestGlider）
  3. 中文备考站（TestDaily 厚朴优学, 小站托福, 知乎专栏）
  4. 学术论文（如 CNKI/HansPub 上的题型分析论文）
- 存储格式：统一的 JSON schema，包含所有元数据
- 存储路径：`data/{section}/samples/{taskType}-reference.json`
- **每道样题必须记录**：source、完整题面、全部选项、正确答案、官方解析、干扰项分析

**1.3 初轮量化分析（基础统计）**

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

**1.4 深度分析（ETS 味道拆解）**

初轮统计只能告诉你"是什么"，深度分析要回答"为什么这样设计"。以下是必须做的深度维度：

**1.4.1 干扰项工程（Distractor Engineering）**

逐题拆解每个干扰项的设计机制。不是笼统标注"这是个错答案"，而是精确分类其错误类型和制造手法：

| 干扰项类型 | 机制 | 制造公式 |
|-----------|------|---------|
| 语义联想陷阱 | 取 speaker/passage 关键词，围绕其关联概念造句 | `关键词 → 联想概念 → 合理句子` |
| 离题但合法 | 语法完美、独立成立、但和语境无关 | `在另一个对话/语境中完全合理的句子` |
| 答非所问 | 回答了另一类问题（问 where 答 when） | `识别问题类型 → 换一种类型回答` |
| 多义词陷阱 | 同一个词的不同含义 | `识别关键词的其他含义 → 围绕该含义造句` |
| 时态/语境错位 | 正确内容但时间框架或社交场合不对 | `正确概念 + 错误时态/场合` |

必须量化的指标：
- 每种干扰项类型的占比分布
- 每道题使用了几种不同类型的干扰项（目标：≥2种/题）
- 干扰项与原文/speaker 的词汇重叠率（lexical overlap）
- 干扰项的"看似合理度"光谱（明显错 / 看似可能 / 差点就对）

**实操方法**：写分析脚本（如 `scripts/analyze-{taskType}-samples.mjs`），提取共享词汇、分类干扰项类型、统计分布。

**1.4.2 正确答案范式（Answer Paradigms）**

不要只看"正确答案是什么"，要分析"正确答案WHY是对的"——它用了什么策略来正确回应。

以 LCR（听力选回应）为例，我们发现了 5 种正确答案范式：

| 范式 | 占比 | 难度 | 机制 |
|------|------|------|------|
| context_shift | 31% | Hard | 不回答字面问题，解决背后真正需求 |
| idiomatic | 25% | Med-Hard | 使用习语/固定搭配（I'm all ears） |
| counter_question | 19% | Medium | 用反问推进对话（How about tomorrow?） |
| marker_led_indirect | 19% | Medium | 话语标记 + 间接回应（Actually..., Well...） |
| direct_topical | 6% | Easy | 直接回答字面问题 |

**关键发现：如果 AI 主要生成 direct_topical（直接回答），味道就完全不对。真题中 94% 的正确答案是某种形式的间接回应。**

对每种题型都要：
1. 列出所有观察到的正确答案范式
2. 统计各范式的频率分布
3. 建立 speaker 意图 → 答案策略 的映射关系
4. 标注每种范式的难度等级

**1.4.3 选项间关系分析（Option Interplay）**

4 个选项不是独立的——它们作为一个整体构成考查点。分析：

- **选项间语法一致性**：是否刻意使用不同句式结构（防止靠形式排除）
- **选项间长度差异**：正确答案在长度排名中的位置分布（如 shortest 37.5%, middle 50%, longest 12.5%）
- **选项间语义覆盖**：4 个选项是否覆盖了不同的"错误方向"
- **选项内 speech act 多样性**：每道题的 4 个选项是否执行不同的言语行为（建议 vs 提问 vs 道歉 vs 陈述）

**1.4.4 会话自然度模型（Conversation Naturalness）**

对于涉及对话的题型（听力、口语），分析什么让一个回应"自然"：

| 因素 | 描述 | 量化指标 |
|------|------|---------|
| 会话动力 | 正确答案是否推进对话 | 31% 能引出对方下一句话 |
| 语域匹配 | speaker 和 answer 的正式度是否一致 | 69% 中性, 0% 正式 |
| 情感确认 | 对方表达困扰时是否先确认情绪 | 表达困扰 → 正确答案含 softener |
| 信息经济 | 回答是否刚好够用，不多不少 | 平均 5.7 词, max 10 |
| 话语标记 | 是否用 Actually/Well/Maybe 等信号词 | 37.5% 含话语标记 |

**1.4.5 难度杠杆识别（Difficulty Levers）**

找出控制题目难度的独立维度。每个维度都可以独立调节。

例如 LCR 的 4 个难度杠杆：

| 杠杆 | Easy | Medium | Hard |
|------|------|--------|------|
| 正确答案直接度 | 直接给事实 | 间接但相关 | 完全不回答字面问题 |
| Word trap 强度 | 明显不对 | 看似合理 | 多义词陷阱 |
| Speaker 句子类型 | 明确特殊疑问句 | 是非/否定问 | 陈述句（需推断意图） |
| 习语要求 | 无 | 常见话语标记 | 需识别习语 |

**1.5 ETS 味道公式（Flavor Scoring）**

将所有分析浓缩为一个可量化的"味道分数"：

```
flavor_score = Σ(marker_weight × marker_present) - Σ(anti_pattern_penalty)
```

每种题型定义 5-8 个加权 flavor marker 和对应的 anti-pattern。例如：

| Marker | 权重 | 目标值 | 检测方法 |
|--------|------|--------|---------|
| 间接正确答案 | 25% | 40-50% of items | 分析正确答案是否直接回答字面问题 |
| Word trap 干扰项 | 20% | 80%+ of items | 检测干扰项与原文的词汇重叠 |
| 干扰项类型多样 | 15% | ≥2 种/题 | 统计每题的干扰项类型数 |
| 自然口语语域 | 15% | 60%+ 含缩写 | 检测 contractions |
| 建设性正确基调 | 10% | 100% | 正确答案是否帮助/推进 |

**目标分数：≥0.70**。低于此值说明生成质量与真题有显著差距。

**1.6 差距分析（Gap Analysis）**

在首轮 AI 生成后，对比生成结果与真题 profile 的差距：

| 差距 | 严重度 | 修复方向 |
|------|--------|---------|
| AI 正确答案都是直接回答 | 高 | 在 prompt 中强制 40-50% 间接回答 |
| 答案位置聚集 B/C | 高 | prompt 中预分配答案位置 |
| Word trap 质量不够 | 中 | 在 prompt 中给出 word trap 制造公式+实例 |
| 正确答案太长 | 中 | 设上限（如 ≤10 词） |
| 缺话语标记 | 低 | 要求 30%+ 含 Actually/Well/Maybe |

### 关键产出
- `data/{section}/samples/{taskType}-reference.json` — 结构化样题（含逐题干扰项分析）
- `data/{section}/profile/{taskType}-ets-profile.json` — 基础量化 profile
- `data/{section}/profile/{taskType}-deep-analysis.json` — 深度分析（干扰项工程+答案范式+选项关系+会话自然度）
- `data/{section}/profile/{taskType}-flavor-model.json` — ETS 味道公式（加权指标+反模式+难度杠杆+设计清单）
- `scripts/analyze-{taskType}-samples.mjs` — 可重复运行的分析脚本
- `lib/{section}Bank/profile.js` — Profile 常量模块

### 常见坑
- **样题来源偏差**：第三方练习题可能有自己的"味道"（如答案偏 B），不能直接当 ETS 标准。标注 source 并加权处理。
- **样本量不足**：8 篇样题的统计不稳定，扩到 50+ 篇后数据才稳定。但即使 16 篇也足以发现核心模式。
- **遗漏维度**：第一轮分析容易遗漏"选项间词汇独立性"、"日期分组"等细微维度
- **只看表面统计**：不要止步于"平均词数 8.1"——要追问"为什么是 8.1？什么因素导致了这个分布？"
- **忽略干扰项设计**：干扰项工程是真题味道最大的差异来源。AI 生成的干扰项往往要么太假（一眼看出错）要么太随机（和题目无关）。必须逐题分析并建模。

### 实际案例：LCR 题型的研究过程

```
Step 1: WebSearch 搜集 → 16 道样题（ETS官方+TestSucceed+TOEFLResources+知乎+TestDaily）
Step 2: 存入 data/listening/samples/lcr-reference.json（含完整干扰项分析）
Step 3: 写分析脚本 scripts/analyze-lcr-samples.mjs 提取量化指标
Step 4: 基础 profile → lcr-ets-profile.json（9 维度量化）
Step 5: 深度分析 → lcr-deep-analysis-v2.json（干扰项工程+答案范式+选项关系+会话逻辑）
Step 6: 味道模型 → lcr-flavor-model.json（5个答案范式+4种干扰项+4个难度杠杆+15项检查清单）
Step 7: 差距分析 → 对比 AI 生成 vs 真题，识别 6 个具体差距并提出修复方案
```

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
