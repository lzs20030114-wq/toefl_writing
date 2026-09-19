# 写作批改报告「套话 / 不深入」问题研究（2026-09-19）

> 只读研究，未改任何生产代码。起因：有用户反馈写作（讨论 / 邮件）的批改报告不深入、像套话。
> 本报告回答三个问题：① 用户到底看到了什么；② 「套话」是在哪一环被制造出来的；③ 还缺什么证据。
> 方向性建议放在最后，**不在本轮实施**，等拍板。

---

## 0. 结论先行

**「套话」不是模型偶然发挥差，而是链路的四个环节合力把报告推向「语言表面错误 + 固定措辞」：**

| # | 环节 | 一句话 | 证据强度 |
|---|---|---|---|
| R1 | 代码硬编码注入 | `calibration.js` 给高分文/无批注文**凭空塞英文「拔高建议」**；`parse.js` 把模型写成英文的短板卡**换成一段固定中文** | 确定（本地跑生产 parse+calibrate 复现，见 §2.1） |
| R2 | 解析层丢弃 | 模型每次都写的**三维度理由**、`===ERRORS===` 逐条推理，被 `parse.js` 只取数字/整段不渲染，**用户从未见过** | 确定（grep 前端零引用 + 复现） |
| R3 | prompt 结构 | 「ANNOTATION 是唯一事实来源、ACTION 必须锚定 ANNOTATION」把短板卡锁死在**语法/拼写/搭配**层；「行动必须含可直接使用的句型/模板」**点名要模板**；PATTERNS 只能从 10 个闭集标签里选；总评限**一句话**；判分规则占 prompt 74%，反馈指令约 9%，且**零「怎么诊断论证」的方法指令** | 确定（prompt 原文 + 实测字数） |
| R4 | 流程盲区 | 2026-07 评分大修产出 4 份评测报告 + 一道 scoring-gate，**全部只量分数**；反馈文本没有任何度量、没有留样；写后练习只抽**拼写**（而评分口径明说拼写不压分） | 确定（eval-spec 6 条验收线全是分数） |

**受害最重的是 4.5–5 分的用户**：红橙标注本来就少，报告里剩下的是「一句话总评 + 注入的英文蓝标 + 每次现写的范文」——恰好是最会抱怨「不深入」的人群（推断，待真实数据验证，见 §4）。

---

## 1. 用户实际看到什么（报告信息清单）

生产入口：`components/writing/WritingTask.js` → `lib/ai/writingEval.js`（deepseek-v4-flash，temp 0.3，三路取中位，8000 token）→ `parse.js` → `calibration.js` → `WritingFeedbackPanel`（练习 / 历史 / 真题回顾）或 `ScoringReport`（模考结果 / 历史行）。

| 板块（UI 名） | 数据来源 | 用户看到的 | 结构约束 |
|---|---|---|---|
| 分数卡 | `===SCORE===` 分数 + 校准 | 一个 0–5 分、6 分制换算、band 名 | — |
| 总评 | `SCORE` 的「总评:」 | **一句话** | prompt 原话「一句话，直接点出最核心的问题」；缺失时兜底「评分报告已生成。」 |
| 目标检查（仅邮件） | `===GOALS===` | 3 条 OK/PARTIAL/MISSING + 佐证原句 + 一句依据 | 这是全报告**最有料**的板块（有引文锚定） |
| 结构与语域优化建议（短板卡） | `===ACTION===` | **最多 2 张**：短板名 / 为什么重要 / 现在可做的 | `parse.js` 硬切 `slice(0, 2)`；每条必须能在 ANNOTATION 找到对应原句 |
| 错误规律总结 | `===PATTERNS===` | 标签 + 出现次数 + 一句 summary | 标签只能选 10 个闭集之一（讨论：立场不清晰/论证不充分/未回应他人观点/逻辑连接不足/句式单一/词汇重复/时态一致性/冠词使用/介词搭配/拼写基础语法）；`ScoringReport` 只显示前 3 |
| 逐句批注 | `===ANNOTATION===` | 红（语法/拼写）橙（不地道）蓝（拔高）高亮 + 中文改法 + 一句解释 | 解释无深度要求，测试样本里就是「介词错误。」「拼写错误」 |
| 词汇等级分析 | 前端本地 CEFR 词表 | 与 AI 无关 | — |
| 范文对比 | `===COMPARISON===` | 一篇「范文」+ N 个「你的 / 范文 / 差异」 | 范文由 DeepSeek **每次现写**；UI 标成 `Official Band 5.0 Sample`，名不副实；无对比维度要求 |

**模型生成了、但用户永远看不到的内容：**

- `维度-任务完成 / 组织连贯 / 语言使用: [分] [一句话理由]` —— `parse.js` 的 `parseDimensionScore` 正则只抓数字，理由丢弃；`rubric` 对象在 `components/` 下零引用（三维度分本身也没渲染）。
- `===ERRORS===`（② 类逐条「是否妨碍理解 / 是否系统性失控」判定 + ① 类概述）—— 留在 `sections.ERRORS`，前端不读。这是模型对语言层最具体的诊断推理。
- `===SIGNALS===` 三个布尔 —— 只喂校准。
- 三路采样里另外两份报告的全部诊断 —— 按分数取中位后整份丢弃。

---

## 2. 根因逐条

### 2.1 R1 · 代码直接注入套话（确定）

**(a) `lib/ai/calibration.js` `addBlueRefinements`**：`calibrateScoreReport` 每次都跑 `ensureAnnotationsByScore`——
模型一条批注都没给 → 塞 1 条（≥4.5 分塞 2 条）；≥4.5 分且没有蓝标 → 塞 1 条。塞的是**硬编码英文**：

```
message: "Can be refined for smoother flow and more precise expression."
fix:     "Tighten this sentence by using a more specific verb and clearer logical connector."
```

落点是原文第一句能凑够 10 字符的句子（`sentenceSpans` 顺序取），与句子内容无关。用户看到的是：中文报告里一条「拔高建议」高亮，点开是两句英文通用话。
`__tests__/ai-calibration.test.js` 的 `near-top response keeps high score and includes blue annotation` 把这个行为钉成了断言，说明当初是有意为之（大概是怕高分报告「太空」），但结果正好制造了最典型的套话。

**(b) `lib/ai/parse.js` `parseActionSection`**：短板卡任一字段不含中文 → 整段替换成固定文案：

```
标题:   语言与任务表达可提升
重要性: 该问题会直接影响任务完成度和语言准确性，从而拉低最终分数。
行动:   先按逐句批注改写，再重写一版完整答案；下次作答时优先修正同类错误，至少落实 3 处。
```

原建议以「（原建议：…）」缀在后面。模型偶发写英文标题（如 `Argument depth`）时，用户拿到的就是这三句万能话。

**本地复现**（用一份合法但「模型没给批注、ACTION 写了英文」的最小输出走生产 `parseReport → calibrateScoreReport`）：

```
rubric reasons captured by parser: {"task_fulfillment":"","organization_coherence":"","language_use":""}
actions shown to user: [{ title: "语言与任务表达可提升（原建议：Argument depth）", importance: "该问题会直接影响…（原建议：It lowers the score）", action: "先按逐句批注改写…（原建议：Add an example）" }]
annotations shown to user: [{ level: "blue", text: "I believe the airplane is the most important invention. ", message: "Can be refined for smoother flow…", fix: "Tighten this sentence by…" }]
```

### 2.2 R2 · 解析层把最有信息量的内容扔了（确定）

见 §1「看不到的内容」。特别指出：prompt 要求模型「先定整体分、再给维度分并附一句话理由」，这三句理由是**针对本篇**的任务 / 组织 / 语言判断（测试样本：「维度-任务完成: 5 三个目标均完成且有细节」「维度-语言使用: 3.5 局部小错较多但均不影响理解」），比一句话总评信息密度高 3 倍，却被正则 `([0-5](?:\.\d+)?)` 截断在数字处。

### 2.3 R3 · prompt 把反馈锁在语言表层（确定）

**篇幅**（`getDiscussionSystemPrompt("zh")` 实测）：全文 10,887 字符；`严格按以下格式输出` 之前的判分规则 8,015 字符（74%）；与总评 / 短板 / 规律 / 范文相关的指令约 1,000 字符（≈9%）。邮件 prompt 8,953 / 5,974 / ≈1,100，同构。`app/api/ai/route.js` 的 `MAX_SYSTEM_CHARS = 12000`，讨论 prompt 离上限只剩约 1,100 字符——**想加反馈指令必须先腾地方**。

**四条互相咬合的规则，合起来等于「短板卡只许谈语言」：**

1. 「ANNOTATION 是唯一事实来源。PATTERNS、COMPARISON、ACTION 中提到的每个问题，都必须先在 ANNOTATION 里有对应 `<r>/<n>` 标注。」
2. 「如果你在 ACTION 里给出某个改进点，必须能在 ANNOTATION 找到至少 1 个对应原句片段；找不到就不要写这个改进点。」＋ 输出前自检第 3 条重申「找不到对应原句的改进点，必须删除」。
3. ANNOTATION 的三色定义全是语言层：red 语法 / orange 不地道 / blue 拔高。**「论证只有一句、没解释为什么」不是任何一种颜色**，没法标，于是按规则 2 不能进 ACTION。
4. 「短板行动卡必须是可立刻执行的动作，且包含可直接使用的句型 / 词汇 / 模板。」——这一句是在**点名要模板**。

结果：3.5–4.5 分用户最想知道的「为什么不是 5」——答案在论证展开、贡献度、具体性（ETS 官方分档正是按这个分）——被规则挡在 ACTION 之外；模型只能写「介词搭配」「时态一致性」之类的短板，并附一个套用句型。这就是用户口中的「套话」。

**规则 1–2 当初是为了解决另一个问题**（防止 ACTION 凭空捏造原文没有的错误），方向对，但代价是把内容层诊断一起禁掉了。

**PATTERNS 闭集 10 标签**：每份报告的「错误规律」只能是这 10 个词之一；练 5 篇看到的是同样 3–4 个标签轮换。summary 虽要求带原句短引，但 tag 本身就是套话载体。

**总评一句话**：分数卡上唯一的文字解释被 prompt 限定为「一句话」，并要求「诊断语气」——一句话只装得下标签（「论证展开有限。」「语言小错偏多，介词与时态需要打磨。」）。

**没有「怎么诊断论证」的方法**：对照 ETS 官方评语的写法——灯泡文「对比结构有效，但论证可更强（**只说了比蜡烛好，没说为何是 200 年来最重要**）」；疫苗文「前后对比 + 展开，复杂句式 + 较精确词汇」——官方评语是「指着某一步论证说它停在哪」。我们的 prompt 对任务层只有 rubric 分档描述，没有一行告诉模型：找主张 → 逐条理由 → 每条是解释 / 例证 / 细节哪一种 → 在哪一句停止展开 → 这篇要补什么。没有方法，模型就回落到通用评语。

### 2.4 R4 · 「每次都一样」的来源

- temperature 0.3 + 闭集标签 + 固定板块骨架 + 同一模型 → 同一用户连续练习时措辞高度重复。「套话」感一半来自单份报告的空泛，一半来自跨报告的雷同。
- 三路取中位只按分数选，报告文本随之——这不制造雷同，但也不缓解。

### 2.5 R5 · 范文对比

- 范文由评分同一次调用现写，排在 ANNOTATION + CORRECTED（两份完整原文）之后，处在 8K 预算尾部。`writingEval.js` 专门有 `recoverCompleteComparison` 从别的采样借范文，注释写明「范文仍偶发在报告尾部截断」——说明截断是常态级问题。
- UI 标签 `Official Band 5.0 Sample` 是假的；用户若察觉，会连带怀疑整份报告。
- `data/academicWriting/sample_answers.json` 里有 60 篇按题 id 的范文，**评分链路完全没用它**（只被 `scripts/parse-real-questions.mjs` 读）。
- 对比点没有维度要求、没有数量要求，「差异」一栏容易写成「范文更具体」。

### 2.6 R6 · 流程盲区（确定）

- `docs/eval-spec/writing-scoring.md` 6 条验收线、`scripts/scoring-gate.mjs`、07-12 的 ADVERSARIAL / MEDIAN / SHOWDOWN / RESCORE 四份报告——**度量对象全部是 `final` 分数**。报告文本从未被量过、也没有留样（真实用户报告因隐私不落库）。
- 评分侧改动有闸门守着，反馈侧改动没人管；反之，改 prompt 反馈段又必须重跑评分闸门（eval-spec 规定改 `academicWriting.js`/`parse.js`/`calibration.js` 都要跑，约 30 分钟 / ¥1）。
- `lib/postWritingPractice.js` 头注：「Post-writing spelling drill extraction」——写后练习**只**从报告里抽拼写错误做填空。而评分 prompt 反复强调拼写是 ① 类「不压分」。闭环练的是对分数最不重要的东西，论证 / 组织层面没有任何后续练习。

---

## 3. 分档推断：谁最容易觉得「套话」

| 分段 | 报告里有什么 | 感受（推断） |
|---|---|---|
| ≤3 | 红橙标注多、GOALS 常见 PARTIAL/MISSING、短板卡有语言层实锤 | 最不容易抱怨——虽浅但有料 |
| 3.5–4 | 标注中等；想知道「怎么到 5」；ACTION 只能谈语言 | 「不深入」——问的是论证，答的是介词 |
| 4.5–5 | 标注少且多为拼写/冠词；注入的英文蓝标；一句话总评 | 「套话」——报告近乎空壳，还夹英文通用句 |

这一段是从结构推出来的，要用 §4 的数据坐实。

---

## 4. 缺什么证据 / 怎么补

本会话容器**没有 Supabase 凭据**，拿不到 `sessions.details.feedback` 里的真实报告，以下是建议的度量（本机或 Supabase SQL Editor 跑，只读）：

1. **抽样**：`sessions` 表 `type in ('discussion','email')`、最近 300 条、`details->'feedback'` 非空，按 `score` 分三段各取 ~30 份。
2. **套话指标**（每份报告算一次，按分段汇总）：
   - 注入蓝标率：`annotationParsed.annotations` 里 `message` 等于 `Can be refined for smoother flow…` 的份数占比；
   - 兜底短板率：`actions[].title` 含「语言与任务表达可提升」的占比；
   - 总评去重率：`summary` 文本去重后 / 总份数（越低越套）；
   - ACTION 标题去重率、PATTERNS 标签分布（10 标签的集中度）；
   - 短板卡「行动」里出现「句型 / 模板 / 可以使用」字样的占比；
   - 范文截断率：`comparisonRecovered === true` 或 `comparison.modelEssay` 为空。
3. **用户原话**：`user_feedback` 表按「套话 / 不深入 / 没用 / 泛 / 一样 / 敷衍」关键词过滤，对上 user_code 看他们那几份报告的分段与指标。
4. **人工盲评 20 份**：每份按「总评是否指出本篇专属问题 / 短板卡是否触及论证或组织 / 范文对比差异是否具体」三项 0/1 打分，作为后续改动的基线。

---

## 5. 方向性建议（待拍板，按性价比排序，本轮不动手）

1. **零风险止血（只改代码，不改 prompt）**：
   - 删掉 `addBlueRefinements` 的英文注入（或改成不注入，高分报告宁可少而真）；
   - `parseActionSection` 的中文兜底改为原样展示 + 标记，不再替换成万能三句；
   - `parseScoreSection` 把三维度理由解析出来，前端渲染「任务 / 组织 / 语言」三张小卡（模型已经在写，白拿）；
   - `===ERRORS===` 的 ② 类逐条判定可直接渲染成「影响分数的错误」列表，与「不压分的小错」分开——这正是用户想看的「深」。
   - 注意：eval-spec 规定改 `parse.js` / `calibration.js` 要重跑 scoring-gate（quick 8 分钟即可，这些改动不碰分数路径，但要留证）。
2. **prompt 手术（要重跑全量闸门）**：
   - 给 ACTION 松绑：允许锚定到 PATTERNS / 维度理由 / 原文任意一句，不再只许锚定 ANNOTATION；明确「短板 1 优先是任务 / 论证 / 组织层，短板 2 才是语言层」；删掉「包含可直接使用的句型 / 模板」，改为「写出这篇文章专属的补法（补哪句、补什么内容）」；
   - 加一段「论证诊断方法」（找主张 → 逐条理由 → 展开形式 → 停在哪一句 → 缺什么），字数从判分规则里的重复段落省出来（① / ② 类规则在 prompt 里讲了三遍）；
   - 总评从「一句话」改为「2–3 句：档位判断 + 本篇最大短板指到句 + 上一档需要什么」；
   - PATTERNS 标签允许自由命名但必须附原句证据（或把闭集扩到内容层）。
3. **建反馈质量度量**：像 scoring-gate 一样固化一道「反馈闸门」——12 篇锚文各出一份报告，量 §4 的指标 + 人工 rubric，改 prompt 前后对比。
4. **范文**：讨论题优先用 `sample_answers.json` 已有 60 篇（先抽查质量），没有的再现写；UI 标签改成「AI 参考范文」；对比点固定三维度（立场与贡献 / 展开方式 / 语言）。
5. **写后练习**扩到内容层（例如「把这句展开成两句，补一个具体机制或例子」），不再只练拼写。

---

## 顺带发现（与本题无关，记一笔）

- `lib/reportLanguage.js` 提供「English」报告语言，但 `getDiscussionSystemPrompt("en")` / `getEmailSystemPrompt("en")` 的语言策略仍要求「主要用中文输出」——英文选项实际是空操作。
- 讨论 prompt 里 PATTERNS 闭集仍含「未回应他人观点」，而同一 prompt 上方明令「不得因没有回应他人观点而压分」——标签会诱导模型把它当短板报出来。

---

**方法学附注**：本报告依据仓库 HEAD `29103d9`（分支 `claude/compassionate-newton-iddg2e`）通读 `lib/ai/prompts/academicWriting.js`、`emailWriting.js`、`lib/ai/parse.js`、`calibration.js`、`writingEval.js`、`client.js`、`app/api/ai/route.js`、`lib/annotations/parseAnnotations.js`、`components/writing/WritingFeedbackPanel.js`、`ScoringReport.js`、`lib/postWritingPractice.js`，以及 `docs/eval-spec/writing-scoring.md` 与 07-12 四份评测报告；prompt 字数、注入与兜底行为均以 Node 脚本直调生产模块实测。未调用任何 AI 接口，未访问数据库。
