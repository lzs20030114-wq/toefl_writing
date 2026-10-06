# ADR-MN-20261006：错题本改版 —— 功能梳理 · 使用流程 · 侧栏入口 · 抽错题组题

**Status:** Proposed / 待拍板（只读调研，未改任何业务代码）

**Date:** 2026-10-06

**Deciders:** 项目负责人

**目标（用户原话）**：把写作造句、阅读填词、听力应答这类「容易反复做」的题全部收集起来，可以单独复习，也可以分学科把错题抽出来组题做针对性练习；入口挪进左侧竖栏；顺带做功能梳理与 UI 更新。

---

## 0. 一页结论

**现状一句话**：错题本是一个「从最近 200 条练习记录里当场筛出答错题」的只读列表（拼句 / 阅读 / 听力三个分段），没有自己的数据层，没有「已掌握」概念，不能重练，入口散在首页中栏三张卡上、手机只在写作 tab 看得见。

**建议方向（四件事按依赖排序）**：

1. **先建「错题账本」再谈复习。** 新增 `lib/mistakes/` 数据层：一题一条、跨练习去重、带 `wrongCount / correctStreak / mastered / starred`，本地优先（按账号分 key）+ 可云同步（仿单词本 `vocab_cards` 的 JSONB 镜像）。首次打开用现有练习记录回填（含目前被漏掉的模考错题）。没有账本，「复习过就消失」「错过几次」「侧栏红点数什么」全都没法做。
2. **入口照单词本的样子搬进左侧栏。** 侧栏加「错题本」项（`<Link href="/?section=mistakes">` + 红系待复习计数药丸），首页内嵌（`activeSection === "mistakes"`），旧地址 `/mistake-notebook?section=X` 服务端重定向；移动端加全局入口卡；删掉中栏三张重复卡和 `sections.js` 里的死代码 `TOOLS`。
3. **组题复习走真题专区那条路：新路由 + 直接喂题给现成任务组件。** 不改任何练习页；BS 传 `questions`、CTW/RDL 传 `item`、LCR 传 `batchItems`、LA/LC/LAT 传 `item`。答题页不套任何额外外壳（CLAUDE.md 硬约束）。复习结果只写账本，不写练习历史（否则会被每日任务、进度图、错题本自己重复计数）。
4. **UI 按本仓库惯例先出 3 个静态方案对比图再动手**（CLAUDE.md 口语路由：「ui 丑 → 先出 3-5 个静态方案对比图选定再实施」），推荐以单词本首页卡为参照系做「今日复习 + 科目分栏」。

**第一期收哪些题型**：所有有客观对错的题 —— 拼句（含真题 `real_`、个人题 `usr_`）、填词 CTW、阅读选择 RDL/AP、听力应答 LCR、听力选择 LA/LC/LAT，外加目前完全漏掉的阅读/听力模考逐题结果。口语 / 写作没有客观「错」，第一期不收（口语 Repeat 的「低分句」放到进阶项）。

**产品层面区分两类错题**（决定组题方式）：
- **速练型**（用户点名的那三种）：拼句一题一条、填词一空一条、听力应答一题一条，题干自足，可任意抽 N 题拼成一组 → 这是「抽错题组题」的主战场。
- **篇章型**：阅读选择 / 听力选择的「错」是文章或音频里的某几问，脱离原文没法做 → 以「整篇重做（只问错过的题）」呈现，不参与跨篇混组。

需要拍板的 7 个问题见 §6，每条都附了建议默认值；全部按建议值走也能直接开工。

---

## 1. Context：现状盘点

### 1.1 功能清单与缺口

| 能力 | 现状 | 缺口 |
|---|---|---|
| 收录范围 | 拼句（`type:"bs"`）、阅读 ctw/rdl/ap、听力 lcr/la/lc/lat 的练习记录；真题专区练习记录同样进（靠 `real_` 前缀） | **阅读/听力模考的逐题结果不进**（存在 `details.m1.tasks[]/m2.tasks[]/tasks[]`，三个抽取器只认 `details.results`）；口语/写作无 |
| 展示 | 按「练习场次」分组折叠，一张卡 = 题面 + 你的答案 + 正确答案 + 解析 + AI 讲解按钮 | **同一题错两次显示两张卡**（无去重）；无「已掌握/待复习」状态；无按题型/时间/语法点的筛选（阅读/听力只有题型 chip） |
| 统计 | 拼句有语法薄弱点频次条 + 「AI 问题分析」(Pro)；阅读/听力只有题型计数 | 无趋势、无「本周新增 / 已消化」 |
| 收藏 ☆ | 云端表 `mistake_favorites`，自包含快照，`(user_code, session_id, detail_index)` 唯一 | **只有拼句接了 UI**（API 白名单其实已含 reading/listening）；快照里没有 `qid`，收藏的拼句也回不到原题；访客和尚未同步到云的记录不能收藏 |
| 重练 | 无 | 这是本次改版核心 |
| 数据来源 | 每次渲染时扫 `loadHist().sessions` | 云端客户端只拿**最近 200 条 session（所有科目混计）**，游客本地只留 50 条 → 更早的错题悄悄消失（`lib/cloudSessionStore.js:125`、`lib/sessionStore.js:14`） |
| 入口 | 桌面：写作中栏卡（不限 Pro）、阅读/听力中栏卡（仅 Pro）；手机：只有写作 tab 一张卡 | **侧栏没有入口**；手机看不到阅读/听力错题；`components/home/sections.js:84-88` 的 `TOOLS`（含「拼句错题本」）是无人消费的死代码 |
| 埋点 | 只有 `page_views` 记 `/mistake-notebook`（不含 query，分不出 section），后台只展示 top 20 页面 | 无任何错题本专属事件（收藏/讲解/分析/切换） |
| 测试 | 无错题本专属测试 | 仅 4 处间接护栏（见 §1.6） |

### 1.2 各题型的记录形状与「能否重练」

来源：各页 `saveSess` 调用（`components/buildSentence/useBuildSentenceSession.js:290-306`、`app/reading/page.js:299-316`、`app/listening/page.js:356-366`）。

| 题型 | 记录里有什么 | 稳定题 key | 仅凭记录能否重渲染 | 重练喂法 |
|---|---|---|---|---|
| 拼句 bs | `details[]`：`qid, prompt, userAnswer, correctAnswer, isCorrect, grammar_points`（**无** chunks/干扰项/预填） | `qid`（老记录可能缺） | **否**，必须按 `qid` 回查题库；`ets_s21..29` 与 2026-06-17 退役的旧库同名，**回查后要用 prompt+correctAnswer 校验**，不一致视为已下线 | `<BuildSentenceTask questions=[...] recordGroupDone={false} persistSession={false}>` |
| 填词 ctw | `itemId, passage, blanks[], results[{blank, userAnswer, fullWord, isCorrect}]` | `itemId#position` | **是** | `<CTWTask item>`；按 `blank.position` 定位，不建议只喂错的空 → 整篇重做，结算只统计错过的空 |
| 阅读选择 rdl/ap | `itemId, passage, questions[], results[{selected, correct, isCorrect}]`（rdl 无 qIndex，按下标对齐） | `itemId#qN` | **部分**（缺 `format_metadata` 标题行、真题 `material_image`） | `<RDLTask item={...item, questions: 只留错题, id: 新 id}>`，AP 经 `apPassageText` 适配 |
| 听力应答 lcr | `itemIds[], items[]{id, speaker, options, answer, explanation, audio_url}, results[{itemId, selected, correct, isCorrect}]` | `itemId` | **是**（audio_url 空则 TTS 兜底） | `<LCRTask batchItems=[错题子集]>`，外包 `ExamAudioProvider` |
| 听力选择 la/lat | `itemIds, transcript, questions[], audio_url, sentence_timings, results[{qIndex,…}]` | `itemIds[0]#qN` | **是** | `<ListeningMCQTask item={...筛 questions, 新 id}>` |
| 听力选择 lc | 同上 + `conversation` | 同上 | **部分**（缺 `speakers`，TTS 兜底分音色要用） | 同上，runner 里按 `itemIds[0]` 回查补 `speakers` |
| 模考 reading/listening (`mode:"mock"`) | `details.m1.tasks[] / m2.tasks[] / tasks[]`，每个 task 自带整题快照 + `results[]`；CTW 结果形状不同（`{userAnswer,isCorrect}`，无 blank） | 同上 | **是** | 回填时按 task 展开即可 |
| 口语 repeat | `items[]{id, sentence, score{accuracy, missedWords,…}}` | `items[].id` | 部分（无音频 URL，TTS 可念） | 无客观错；可用 accuracy 阈值定义「低分句」（进阶项） |
| 写作 email/discussion | `promptId, promptData, userText, feedback` | `promptId` | 是（`lib/history/retry.js` 已有同题重练） | 无客观错；拼写错误已由 `/post-writing-practice` 覆盖 |

补充事实：
- 个人题库条目靠 `usr_` 前缀辨认，真题靠 `real_`（`lib/admin/realSession.js`）；两者记录形状与常规一致。
- 真题拼句的 `grammar_points` 恒为 `[]`（`lib/realBank.js:322`），按语法点分类会全落「其他」。
- 云端 `score` 列只留 `buildScoreObj` 挑的几个顶层字段，`details` 原样保留（`lib/cloudSessionStore.js:9-40`）。
- 云端缓存是「最新在前」，`saveSess` 乐观插入在末尾、`slice(-200)` 会先挤掉一条最新，写完后整表重拉（`lib/sessionStore.js:316`）—— 所有消费者必须自己按 `date` 排序。
- 本地模式 session **永远没有 `id`**；云端未重拉前 `id` 也是 `undefined`（收藏功能的「正在同步，请稍后」提示就是这个）。

### 1.3 入口与首页结构（要搬去的地方）

桌面首页三列：左 `NavSidebar`（220px，sticky，`components/home/NavSidebar.js`）/ 中 `SectionContent` / 右 `StudyPlanColumn`。侧栏头注释写明：**内容必须一屏放下，不放折叠区，会长高的内容走弹窗**。

| 现有入口 | 位置 | 门禁 | 计数 |
|---|---|---|---|
| 「拼句错题本」中栏卡 | `components/home/SectionContent.js:154-162` | 无 | `countBsMistakes`（从 `components/MistakeNotebook.js:769` 导出 —— 把整个错题本组件拉进首页 bundle） |
| 「阅读错题本」中栏卡 | `ReadingSectionContent.js:267-290`，`?section=reading` | 仅 Pro | `countReadingMistakes`（lib，轻量） |
| 「听力错题本」中栏卡 | `ListeningSectionContent.js:229-252`，`?section=listening` | 仅 Pro | `countListeningMistakes` |
| 手机写作 tab 链接卡 | `MobileHomePage.js:304-328` | 无 | 仅拼句；全站唯一的红色计数药丸 `#dc2626/#fef2f2` |
| 侧栏 | **无** | — | — |

**单词本的入口模式（要镜像的对象）**：`VocabNavItem`（侧栏 `<Link href="/?section=vocab">`，左键拦截走 context `navigate()` 原地切换，带 cyan 计数药丸，`aria-current`）+ `MobileVocabEntry`（手机 tab 条之上的全局卡）+ `HomePageClient.js:400` 的 `<VocabNotebook embedded onReviewingChange>` 内嵌 + `app/vocab-notebook/page.js` 旧地址重定向 + `__tests__/vocab-home-navigation.component.test.js`。首页白名单在 `HomePageClient.js:99` 的数组字面量里（有测试用正则读源码）。

顺手要修的两处：`MobileHomePage.js:390` 调用了本文件未定义的 `setActiveSection`（应为 `onSectionChange`，点「我的题库」聚光灯 CTA 会抛 ReferenceError）；`sections.js` 的 `TOOLS` 死代码。

### 1.4 历史决策与明确推迟项（来自远端提交历史）

- 2026-04-02 v1.6 诞生（仅拼句）→ 05-07 加收藏 → 05-13 一天四提交「re-enable」（曾临时下线：死事件订阅靠轮询、SSR 水合警告、登录后收藏为空、429 回滚）→ 05-13 扩阅读/听力 → 09-12/13 AI 讲解 403 与空正文修复 → 10-04 真题练习记录页自带「错题速览」。
- 当时写明**留给「larger redesign」**的三件事：错题与 `sessions.details` 的耦合、`detail_index` 漂移、session 删除后收藏不级联。本次改版就是那个 redesign，账本层正好一次解决前两件；第三件按「收藏是自包含快照、不级联」维持。
- 已拍板不改：收藏用快照；同题重复按时间线保留（本次改为账本去重，但保留 `sources[]` 时间线）；AI 讲解/分析 Pro 门。

### 1.5 组题要走的路：真题专区的复用机制

`app/real-bank/page.js` = 页内状态机 + 直接 import 各科任务组件 + props 直喂，**没有路由参数、没有 store**（写作例外，用 `lib/history/retry.js` 的 sessionStorage 快照交接）。

| 科目 | 喂法（真题页行号） | 注意 |
|---|---|---|
| 拼句 | `<BuildSentenceTask questions={batch.questions} practiceMode timeLimitSeconds onExit/>`（:674-679） | 题必须是**原始题库对象**，经 `runtimeModel.prepareQuestions` 规范化；不要带 `__sourceSetId/__sourceGroupId`（会把整套标 done）；传 `questions` 后自动不走草稿续做 |
| 阅读 | `<CTWTask/RDLTask item timeLimit isPractice onComplete/>`（:601-629），外包 `AssetPreloadGate` | 草稿 key 是 `buildDraftKey(type, item.id)`，子集 item 要换新 id 防串草稿 |
| 听力 | `<LCRTask batchItems/>`、`<ListeningMCQTask item taskType/>`（:485-505） | **必须包 `ExamAudioProvider`**（iOS/微信音频解锁）；standard 才要 `ListeningIntroScreen`，practice 不用 |
| 限时 | `lib/realBankModes.js:57 getRealBankTimeSeconds(type, mode)`，纯函数、不许 import 题库 | 复习默认 practice（不限时） |

**硬约束**：「真题答题页 = 常规练习答题页，答题页不许再套任何额外外壳」（CLAUDE.md）—— 顶栏 sticky、阅读答题区高度写死 `calc(100vh - N)`，多一条横幅整页下移。错题复习的「第 N / M 题」「本组进度」只能放在选题页或结算页。

现有抽题方式只有四种：按未做整套顺序（BS）、话题多样性随机（阅读）、纯随机（听力/口语）、手选（practice picker）。**没有任何「自定义题池」概念**，所以组题必须是新路由而不是改练习页的参数。

### 1.6 其他硬约束

- `__tests__/ai-empty-response.regression.test.js:131-170` 用 `readFileSync` 扫 **`components/MistakeNotebook.js` 与 `components/mistakes/useMcqAiExplain.js`** 这两个路径：每个 `await callAI(` 行必须含 `AI_HELPER_MAX_TOKENS`，源码不得出现 `error: e.message`。**这两个文件不能改名/搬家**，新 AI 调用沿用 `mapAiHelperError`。
- `__tests__/real-bank-section.component.test.js:324-354`：`SectionContent` 的 props 名 `bsMistakeCount / readingMistakeCount / listeningMistakeCount` 是契约；首页白名单必须保持 `["writing", …]` 数组字面量写法；真题面板不得出现「拼句错题本」文案。
- `__tests__/nav-sidebar-support.component.test.js:14` 把 `VocabNavItem` mock 掉 —— 新的侧栏错题入口若自带数据 hook，同一个测试也要 mock。
- 首页 / 错题本组件**不许 import 题库 JSON 或 `lib/realBank.js`**（`lib/realBankModes.js:11-12`、`lib/realBankHistory.js:13-15` 的 bundle 守卫；有源码级回归门）。按 `qid` 回查题库的解析器只能放在复习 runner 自己的路由里。
- JSX 文本直接写中文，禁 `\uXXXX`（`encoding-hygiene.regression.test.js`）。SSR 初值必须为空、挂载后再填（05-13 水合事故）。
- 收藏 API 身份 = 请求自带的 6 位码，RLS 全放行（IDOR，BACKLOG [低]，上游是 [高] 认证模型改造）。**本次不夹带身份改造**，但新建的表按单词本 2026-09-28 `vocab-sync-hardening.sql` 的口径收紧（只留 service_role，经 API 读写）。

---

## 2. 用户使用流程研究

### 2.1 现在的路径（断点加粗）

1. 做完一套练习 → 结果页 → **没有任何「N 题已进错题本」提示或链接** → 用户要自己记得去首页找卡。
2. 首页 → 写作 tab 中栏往下翻 → 「拼句错题本」卡（阅读/听力的卡在各自 tab、仅 Pro 可见）→ 跳转整页 `/mistake-notebook` → 顶部三个分段切科目。手机上只有写作 tab 有卡，**手机用户基本找不到阅读/听力错题**。
3. 列表按场次折叠，第一套默认展开；想看某个语法点的题只能逐套翻。**看完就结束**，没有任何下一步动作（不能重练、不能标记已掌握）。
4. 收藏 ☆ 只在拼句卡上，访客灰显；收藏夹是另一个 tab，仍只能看。
5. 超过 200 条记录后，早期错题从「全部错题」里消失，用户不知情。

### 2.2 目标路径

**A. 练后即时闭环**：结果页加一行「本次 3 题进了错题本 · 去看看」（阅读/听力结果页与 BS 结果页都有现成的结果面板）。

**B. 日常复习**（主路径）：首页侧栏「错题本 · 12」（红系药丸 = 待复习数，不是累计错题数）→ 点进 → 顶部「今日复习」卡：待复习 N 题、预计 X 分钟、按科目分栏（拼句 / 阅读 / 听力各几题）→ 「开始复习」= 系统按优先级（最近错 > 错过多次 > 收藏）抽一组速练型 ≤10 题 → 逐题作答（现成任务组件，无额外壳）→ 结算页：本组对/错、再错的题、「再来一组 / 返回错题本」→ 账本更新：答对 → `correctStreak+1`，连续 2 次对 → 已掌握（移出待复习，仍可在「已掌握」筛选里看到）；答错 → `wrongCount+1`、streak 清零。

**C. 考前针对性组题**：错题本 → 「组题练习」→ 选科目/题型（拼句 / 填词 / 应答 / 阅读选择 / 听力选择）→ 选来源（全部待复习 / 只收藏 / 某语法点 / 最近 7 天 / 包含已掌握）→ 选题量（5 / 10 / 全部）→ 预览列表 → 开始。篇章型按「篇」列出（「这篇错了 2/5 问 · 整篇重做」）。

**D. 翻看与整理**：列表按**题**而不是按场次分组（一题一张卡，角标「错 2 次 · 最近 3 天前」，展开看每次的作答），筛选条：科目 / 题型 / 状态（待复习 · 已掌握 · 收藏 · 易错）/ 时间；卡片动作：☆ 收藏、✓ 标记已掌握、AI 讲解、「只练这一题」。

**E. 进阶（第二期）**：拼句「同语法点换新题」—— 重做原句测的是对那句话的记忆，真正的迁移是同语法点的新题；题库每题带 `grammar_points`，练习页已有按语法分类切批的现成函数（`app/build-sentence/page.js:38 buildGrammarTopics` / `:111 getBatchesForCategory`），组题时可「3 道原错题 + 7 道同语法点新题」。

### 2.3 与单词本的关系

两个「本」将并排坐在侧栏里，交互语言应一致：都是「首页卡给今日量 → 开始 → 逐项 → 结算 → 回本」。但错题本**不要**套 FSRS：题池有限、题目做过两遍就记住了，用「连续 2 次答对即掌握 + 易错题 = 错 ≥2 次」这种可解释规则即可。单词本的 `ReviewSummary` / `SegmentCheckpoint` 文案写死了「词」，复用要先参数化或另写同结构组件（见注入报告 §7）；`reviewSave.js` 绑 SRS，不复用，错题复习的存档只需 `{keys, 已答下标, 结果}`。

---

## 3. Decision：目标架构

### 3.1 错题账本 `lib/mistakes/`

```
lib/mistakes/
├── keys.js        # 题 key 规则 + 从 session 抽取条目（纯函数，含模考展开；接管现有 3 个 extractor）
├── ledger.js      # 本地账本：按账号分 key 的 localStorage（仿 vocabStore），card 读写/去重/合并/软删除
├── mastery.js     # 掌握规则（纯函数）：recordResult(card, isCorrect) → 新 card
├── backfill.js    # 首次打开从 loadHist() 回填（含 m1/m2.tasks 模考），幂等
└── counts.js      # 侧栏/首页角标用的轻量计数（不 import 任何题库）
```

**题 key**（跨练习去重的依据）：

| 题型 | key | 老记录兜底 |
|---|---|---|
| bs | `bs:${qid}` | 无 qid → `bs:h:${hash(prompt\|correctAnswer)}` |
| ctw | `ctw:${itemId}#${blank.position}` | 模考 ctw 无 blank → 按下标 |
| rdl / ap | `${subtype}:${itemId}#q${index}` | — |
| lcr | `lcr:${itemId}` | results 无 itemId → `items[index].id` |
| la / lc / lat | `${subtype}:${itemIds[0]}#q${qIndex}` | — |

**card 形状**（设计成可云同步：`updatedAt` 新者胜、`deletedAt` 软删）：

```js
{
  key, subject: "bs"|"reading"|"listening", subtype, itemId, index,
  snapshot: { /* 渲染一张错题卡所需的全部字段，沿用现有 3 个 extractor 的输出 */ },
  wrongCount, correctStreak, mastered: false, masteredAt: null,
  starred: false, lastResult: "wrong"|"right", firstWrongAt, lastWrongAt, lastReviewedAt,
  sources: [{ sessionId, date, mode, real, personal }],   // 最多留 5 条时间线
  updatedAt, deletedAt: null,
}
```

**写入时机**：各科 `saveSess` 之后同步调一次 `ledger.recordSession(session)`（三处：`useBuildSentenceSession.js:308`、`app/reading/page.js:299`、`app/listening/page.js:356`，真题页三处同款），模考在 `AdaptiveExamShell.js:1609` 之后。保留现有 extractor 作为回填的解析器，不再在渲染时扫 sessions。

**掌握规则**（`mastery.js`，先简单可解释）：答错 → `wrongCount+1, correctStreak=0, mastered=false`；复习答对 → `correctStreak+1`，`≥2` 且两次不在同一天 → `mastered=true`；再答错回待复习。「易错题」= `wrongCount ≥ 2`。用户可手动「标记已掌握 / 恢复」。

**云同步（第二期）**：表 `mistake_cards(user_code, key, card JSONB, updated_at, deleted_at)` 镜像 `vocab_cards`，API `/api/mistakes/cards` 双向合并（按 key 取 `updatedAt` 新者，软删参与比较）；`mistake_favorites` 读一次并入 `starred` 后冻结不再写。RLS 按 `vocab-sync-hardening.sql` 收紧。走 /sql-migrate。

### 3.2 入口与导航

| 项 | 做法 |
|---|---|
| 侧栏 | 新 `components/mistakes/MistakeNavItem.js`，照 `VocabNavItem` 写：`<Link href="/?section=mistakes">`，左键拦截走同一个 `VocabHomeNavigation` 式 context（或把它泛化成 `HomeNavigation`），`aria-current`，药丸 = **待复习数**（红/rose 系；cyan 已被单词本占用），`ready && count>0` 才显示；挂在 `NavSidebar.js:326` 单词本之后 |
| 首页内嵌 | `HomePageClient.js:99` 白名单加 `"mistakes"`（保持数组字面量）；`:400` 三元加分支 `<MistakeNotebook embedded />`，右栏与单词本一致不渲染；`MistakeNotebook` 加 `embedded` prop 去掉 `PageShell` 与「返回」键 |
| URL | 首页 `?section=mistakes&sub=bs\|reading\|listening`（`sub` 避开与首页 `section` 的取值冲突）；`app/mistake-notebook/page.js` 改为服务端 `redirect("/?section=mistakes&sub=…")`（仿 `app/vocab-notebook/page.js`），现有深链 `?section=reading` 继续可用 |
| 移动端 | `components/mistakes/MobileMistakeEntry.js` 照 `MobileVocabEntry`，放在 `MobileHomePage.js:152` 单词本卡之后、tab 条之前，全局可见；`HomePageClient.js:310-325` 把三科计数（或账本计数）一起传下去 |
| 清理 | 删 `SectionContent.js:154-162` / `ReadingSectionContent.js:267-290` / `ListeningSectionContent.js:229-252` 三张中栏卡与手机写作 tab 卡（同一页重复入口是噪音，仓库已有先例注释）；删 `sections.js` `TOOLS`；`countBsMistakes` 挪到 `lib/mistakes/counts.js`；修 `MobileHomePage.js:390` |
| 测试 | 新 `__tests__/mistake-home-navigation.component.test.js`（抄 vocab 那份）；`nav-sidebar-support` 里 mock 新入口 |

### 3.3 页面信息架构（概览页，内嵌在首页中栏）

```
┌ 今日复习 ──────────────────────────────────────────────┐
│ 待复习 12 题 · 预计 6 分钟          [ 开始复习 ]          │
│ 拼句 5 · 填词 4 · 应答 2 · 阅读选择 1 篇 · 听力选择 0     │
│ 已掌握 38 · 收藏 6 · 易错 3                 [ 组题练习 ] │
└──────────────────────────────────────────────────────────┘
筛选： [全部科目▾] [题型▾] [待复习 | 已掌握 | 收藏 | 易错] [最近 7 天▾]   搜索
┌ 错题卡（一题一张）────────────────────────────────────┐
│ 拼句 · 错 2 次 · 最近 3 天前          ☆  ✓已掌握  只练这题 │
│ 题面 / 你的答案 / 正确答案 / 语法点 chips / 解析 / AI 讲解 │
│ ▸ 作答记录（2 次）                                        │
└──────────────────────────────────────────────────────────┘
```

拼句的「语法薄弱点分布 + AI 问题分析」保留，收进「分析」折叠区或筛选条右侧的按钮，不再占首屏。

### 3.4 组题复习 runner（新路由 `/mistake-review`）

- **选题页**：科目 / 题型 chips → 来源 → 题量 → 预览（可勾掉单题）→ 开始。混合组题只允许速练型三种互混；篇章型按篇单独成组。
- **作答页**：页内 `stages = [{ kind, payload }]` + 当前下标，每个任务组件 `onExit/onComplete` 前进一步；各科喂法见 §1.5；全部 `recordGroupDone={false}`、`persistSession={false}`、**不调 `addDoneIds`**、不写练习历史。拼句的 `questions` 在本路由里按 `qid` 回查：静态库 `data/buildSentence/questions.json` → 真题 `getRealBSQuestions()` → 个人题 `fetchPersonalBank("build")`，回查后校验 `prompt + correctAnswer`，不一致的题提示「原题已下线」并从组里剔除（账本保留卡片供查看）。听力外包 `ExamAudioProvider`；lc 缺 `speakers` 时按 `itemIds[0]` 回查补齐。
- **结算页**：本组用时、首次正确率、每题对/错、「再错的题」列表、变化（待复习 −N / 已掌握 +M）、「再来一组 / 返回错题本」。结算时才批量调 `mastery.recordResult`。
- **存档**：每组开始时存 `{keys, stageIndex, results}` 到 localStorage（按账号分 key，当天有效），中途退出可续；不存题。
- **门禁**：runner 整页要求登录（账本按账号分 key，游客只能看不能练 → 或允许游客本地练，见 §6-Q4）。

### 3.5 UI 方向（先出图再动手）

按仓库惯例，实施前先出 **3 个静态方案对比图**（概览页 × 3，附侧栏/移动入口局部），用真实 token（`components/shared/ui.js` 的 `C/FONT`，侧栏用 `components/home/theme.js` 的 `T/CH`），内联 style，不用渐变/毛玻璃（早期偏好记录）：

| 方案 | 思路 | 优 | 劣 |
|---|---|---|---|
| A 清单优先 | 现有列表 + 顶部一条紧凑统计 + 筛选条（最小改动） | 实施快、信息密度高 | 「下一步做什么」不突出，复习入口弱 |
| **B 今日复习卡 + 科目分栏（推荐）** | 顶部与单词本首页卡同构，下面才是筛选 + 一题一卡列表 | 与隔壁单词本语言一致、主路径（开始复习）一眼可见 | 首屏被卡占掉约 1/4，错题少的用户略空 |
| C 科目三栏仪表盘 | 拼句 / 阅读 / 听力三列各自计数 + 各自「开始」 | 分科复习直观 | 窄屏折成竖排后很长；与「混合速练」目标相悖 |

答题页不出图（复用现成组件，且不许加壳）；结算页出 1 张。颜色：错题本语义色沿用现有 `SECTION_META`（拼句 `#087355` / 阅读 `#3B82F6` / 听力 `#8B5CF6`），待复习药丸用 rose/red 系。

### 3.6 门禁与成本

- 账本、列表、组题复习：本地判分，**零 AI 成本**。建议对所有登录用户开放（含免费）—— 它是留存钩子，不是成本中心；阅读/听力错题只会出现在 Pro（或试用期）用户账上，自然不需要再加门。
- AI 讲解 / AI 问题分析：维持 Pro 门与 `AI_HELPER_MAX_TOKENS` 预算，缓存键沿用。
- 云同步：Supabase 行数量级 = 错题数（个位数 KB/条），忽略不计。

---

## 4. Options Considered

| 决策点 | 备选 | 取舍 |
|---|---|---|
| 数据层 | ① 继续渲染时扫 sessions（现状）+ 本地「已掌握」集合；② **本地账本 + 可云同步**（推荐）；③ 服务端分页读全量 sessions 现算 | ① 做不了去重/状态/角标且受 200 条上限；③ 多一层 API 却仍没有状态；② 与单词本同构、离线可用、一次解决 05-13 推迟的两件事 |
| 入口形态 | A 侧栏链接仍跳整页 `/mistake-notebook`；**B 首页内嵌 section**（推荐） | A 改动最小，但与隔壁单词本不一致且回首页会丢 section；B 要处理 `section` 参数名冲突（用 `sub`） |
| 复习结果 | ① 写进练习历史并打 `details.review=true`；**② 不写历史，只写账本 + 复习日志**（推荐） | ① 要在 `dailyTasks`、进度图、三个 extractor 里到处排除，BS 的 details 是数组没处挂标记；② 边界清晰，第二期若想算进「每日任务」再单独接 |
| 组题注入 | ① 给各练习页加 `?ids=` 参数；**② 新路由直喂组件**（推荐） | ① 每页都要改选题/门禁/草稿三处，且练习页有整页 Pro 门；② 零改动练习页，真题专区已验证可行 |
| 篇章型 | ① 只喂错题子集的 questions；② 整篇原样重做 | 阅读/听力选择用 ①（换新 id 防草稿串）；CTW 用 ②（空按 position 定位，筛空会错位） |

---

## 5. 分期与验收

| 阶段 | 交付 | 验收 |
|---|---|---|
| **M0 拍板 + 对比图** | §6 七问拍板；3 张概览页静态图 + 1 张结算页 + 侧栏/移动入口局部 | 用户选定一版 |
| **M1 入口迁移** | 侧栏项 + 药丸、首页内嵌 `embedded`、`?section=mistakes&sub=`、旧地址重定向、移动全局入口、删三张中栏卡与 `TOOLS`、`countBsMistakes` 搬 lib、修 `MobileHomePage.js:390` | `npm test` 全绿；新导航测试；dev server 起真组件在 1440/1024/390 三宽截图；bundle 守卫测试不红 |
| **M2 账本 + 列表改版** | `lib/mistakes/*`、三处 saveSess 接入 + 模考接入、首次回填、一题一卡 + 筛选 + 状态动作、收藏改走账本 `starred`（云端收藏表只读并入） | 单测：key 规则 / 去重 / 掌握规则 / 回填幂等 / 模考展开；用一份含 bs+ctw+rdl+ap+lcr+la+lc+lat+mock 的样例历史跑回填对数 |
| **M3 组题复习** | `/mistake-review`：选题页 → 速练型三种（bs/ctw/lcr）→ 结算 → 账本回写；随后补篇章型（rdl/ap/la/lc/lat） | 真组件跑通每种题型一组；确认不写练习历史、不写 done 集、答题页无额外壳（对照常规练习页像素）；拼句回查校验失败路径 |
| **M4 云同步** | `scripts/sql/mistake-cards.sql`（RLS 收紧）+ `/api/mistakes/cards` + 双向合并 + 收藏一次性并入 | /sql-migrate 台账登记；两设备互改同一卡 → `updatedAt` 新者胜；软删同步 |
| **M5 进阶（择项）** | 拼句同语法点换新题；口语 Repeat 低分句；复习日志与趋势；「复习错题 N 题」接入每日任务；结果页「N 题进了错题本」提示；埋点事件 | 各自独立验收 |

M1 与 M2 可并行派工（入口不依赖账本，先用现有计数兜着）；M3 依赖 M2 的 key 与 card；M4 依赖 M2 的 card 形状。

---

## 6. 需要拍板的问题（都附建议）

1. **入口形态**：首页内嵌 section（建议，与单词本一致） vs 侧栏链接跳整页。
2. **药丸数什么**：待复习数（建议） vs 累计错题数 vs 本周新增。
3. **掌握规则**：连续 2 次答对、跨天（建议） vs 答对 1 次即掌握 vs 不自动掌握、只手动。
4. **游客 / 免费用户**：错题本与复习对所有人开放、仅 AI 功能 Pro（建议）；游客只能看不能练（账本需账号）还是允许游客本地练。
5. **复习是否计入练习历史与每日任务**：不计入（建议，第二期再单独接「复习错题」任务） vs 计入。
6. **中栏三张旧卡**：删（建议） vs 留作深链。
7. **云同步放第几期**：M4（建议，先把本地闭环做顺） vs 与账本一起做。

另两件只需知会：① 本次不碰收藏/会话 API 的身份校验（归 BACKLOG [高] 认证模型改造），但新表 RLS 按单词本口径收紧；② `mistake_favorites` 迁移台账状态是「未知」，M4 前要先确认线上表存在。

---

## 7. 风险

- **拼句回查失配**：qid 曾被复用（旧 `ets_s1..29` 退役、新 `ets_s21+` 同名），不校验 prompt 会把不同题当原题；真题拼句无语法点，语法筛选对它无效。
- **账本与记录双写不一致**：`saveSess` 成功但账本写失败（或反过来）→ 回填逻辑必须幂等，可随时「重新整理」。
- **侧栏高度**：已有 6 项 + 单词本 + 账户卡 + 3 入口，再加一项在矮视口会触发内部滚动（`maxHeight: calc(100vh - 96px)`），对比图阶段要在 768 高度下看一眼。
- **测试源码扫描**：`components/MistakeNotebook.js`、`useMcqAiExplain.js` 路径与 `SectionContent` props 名不能动。
- **bundle**：回查题库的代码只能在 `/mistake-review` 路由；首页与内嵌错题本保持零题库 import。
- **第 200 条之前的历史**：回填只能拿到客户端可见的最近 200 条；更早的错题若想找回，需要一次性服务端脚本（`supabaseAdmin` 分页读 `sessions`）—— 建议作为 M4 的可选项，不阻塞。

---

## 附：关键文件索引

- 现状：`app/mistake-notebook/page.js`、`components/MistakeNotebook.js`（774 行；`extractMistakes :22`、`buildSnapshot :49`、`countBsMistakes :769`）、`components/mistakes/McqMistakesView.js`、`components/mistakes/useMcqAiExplain.js`、`lib/readingMistakes.js`、`lib/listeningMistakes.js`、`components/buildSentence/useMistakeFavorites.js`、`lib/mistakeFavorites.js`、`app/api/mistakes/favorites/route.js`、`scripts/sql/mistake-favorites.sql`
- 记录写入：`components/buildSentence/useBuildSentenceSession.js:290-308`、`app/reading/page.js:296-321`、`app/listening/page.js:323-372`、`app/real-bank/page.js:199-290`、`components/mockExam/AdaptiveExamShell.js:1609-1665`
- 存储：`lib/sessionStore.js`（`MAX_HISTORY :14`、`saveSess :303`、`slice(-200) :316`、`syncCloudHistory :204`）、`lib/cloudSessionStore.js:117-135`
- 首页与侧栏：`components/home/HomePageClient.js`（白名单 :97-100、计数 :175-177、移动 :289-343、侧栏 :388、中栏/vocab :400）、`components/home/NavSidebar.js`（外壳 :225-239、Sections :273-326）、`components/home/sections.js`、`components/home/theme.js`、`components/home/MobileHomePage.js`（单词本卡 :152、tab 条 :155-184、错题卡 :304-328、bug :390）
- 要镜像的单词本件：`components/vocab/VocabNavItem.js`、`MobileVocabEntry.js`、`VocabHomeNavigation.js`、`useVocabSummary.js`、`app/vocab-notebook/page.js`、`__tests__/vocab-home-navigation.component.test.js`；复习流程 `components/vocab/VocabNotebook.js:242-319`（`studyGroup` 自定义队列先例 :251-261）、`ReviewSummary.js`、`SegmentCheckpoint.js`
- 复用先例：`app/real-bank/page.js`（状态机 :315-318、喂题 :485-679）、`lib/realBankModes.js:57`、`lib/history/retry.js`、`components/writing/PostWritingPracticePage.js`（由历史派生的练习）
- 护栏测试：`__tests__/ai-empty-response.regression.test.js:131-170`、`real-bank-section.component.test.js:324-354`、`nav-sidebar-support.component.test.js:14`、`reading-sentence-selection-history.component.test.js:100-140`、`real-bank-listening-speaking.component.test.js:372-375`
