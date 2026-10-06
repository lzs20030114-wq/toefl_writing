# ADR-MN-20261006：错题本改版 —— 功能梳理 · 使用流程 · 侧栏入口 · 抽错题组题

**Status:** Accepted（2026-10-06 用户拍板：**不要**单词本式的「集中复习 + 判定背没背下来」机制；只要「选类型 / 选数量 → 进一个做题页集中做 → 做完出统计报告」；其余按本文建议走）。随后做了一轮对抗式自审，结论与修订见 §8。

**Date:** 2026-10-06（v2，含自审修订）

**Implementation（2026-10-06）:** M1–M3 已实现（入口迁移、错题池、一题一卡列表、/mistake-drill + 统计报告），M0 静态对比图按用户「其余按建议走」直接采用推荐的 B 版。未做：M4 云同步（需建表，收藏/移出/上次重做目前只在本机）、M5 进阶项。实现差异：①错题池不在各科 saveSess 处写入，而是由侧栏/错题本挂载时与每次练习记录更新事件派生合并（漏写不了，且不动各练习页）；②听力对话题重做时不回查 speakers，走组件自带的按说话人惯例分音色兜底；③口语/写作仍不收。

**Deciders:** 项目负责人

**目标（用户原话）**：把写作造句、阅读填词、听力应答这类「容易反复做」的题全部收集起来，可以单独复习，也可以分学科把错题抽出来组题做针对性练习；入口挪进左侧竖栏；顺带做功能梳理与 UI 更新。

---

## 0. 一页结论

**现状一句话**：错题本是一个「从最近 200 条练习记录里当场筛出答错题」的只读列表（拼句 / 阅读 / 听力三个分段），没有自己的数据层，不去重，不能重练，入口散在首页中栏三张卡上、手机只在写作 tab 看得见。

**定稿方向（四件事按依赖排序）**：

1. **一个瘦「错题池」数据层** `lib/mistakes/`：一题一条、跨练习去重、记错几次、可收藏 ☆、可手动移出；**没有「已掌握 / 待复习 / 今日队列」**。每次打开都从最近练习记录重新派生并合并进本地池（本地池只多不少，跨设备不退化），模考错题一并收进来。
2. **入口照单词本的样子搬进左侧栏**：侧栏加「错题本」项（`<Link href="/?section=mistakes">` + 红系计数药丸 = 池内错题数），首页内嵌，旧地址重定向，移动端加全局入口卡，删中栏三张重复卡与死代码 `TOOLS`。
3. **「练错题」= 新路由 `/mistake-drill`，直接把题喂给现成任务组件**：选题页（科目/题型 chips → 来源 → 数量）→ 做题（不加任何外壳）→ 统计报告页。不改练习页；不写练习历史、不写 done 集；结果只回写错题池的「上次重做」字段供展示。
4. **UI 先出 2-3 张静态方案图再动手**（仓库惯例），页面比原方案简单：顶部池摘要 + 「练错题」按钮，下面筛选条 + 一题一卡列表。

**收哪些题型**：所有有客观对错的题 —— 拼句（含真题 `real_`、个人题 `usr_`）、填词 CTW、阅读选择 RDL/AP、听力应答 LCR、听力选择 LA/LC/LAT，外加目前漏掉的阅读/听力模考逐题结果。口语 / 写作无客观「错」，不收。

**组题单位（自审后定）**：

| 题型 | 池里一条 = | 练习时抽取单位 | 为什么 |
|---|---|---|---|
| 拼句 bs | 一题 | 题 | 题干自足 |
| 听力应答 lcr | 一题 | 题 | 题干自足，`LCRTask` 吃任意 `batchItems` |
| 填词 ctw | 一空 | **篇**（整篇重做，报告只统计错过的空） | `CTWTask` 没有「预填已对的空」能力，空按 position 定位不能筛 |
| 阅读选择 rdl/ap | 一问 | 篇（只问错过的题） | 离开原文没法做 |
| 听力选择 la/lc/lat | 一问 | 篇（只问错过的题） | 同上，音频整段播 |

拼句与应答可以混组（速练型）；篇章型按篇成组，一次练习里允许多篇串联。

---

## 1. Context：现状盘点

### 1.1 功能清单与缺口

| 能力 | 现状 | 缺口 |
|---|---|---|
| 收录范围 | 拼句（`type:"bs"`）、阅读 ctw/rdl/ap、听力 lcr/la/lc/lat 的练习记录；真题专区练习记录同样进（靠 `real_` 前缀） | **阅读/听力模考的逐题结果不进**（存在 `details.m1.tasks[]/m2.tasks[]/tasks[]`，三个抽取器只认 `details.results`）；口语/写作无 |
| 展示 | 按「练习场次」分组折叠，一张卡 = 题面 + 你的答案 + 正确答案 + 解析 + AI 讲解按钮 | **同一题错两次显示两张卡**（无去重）；无按题型/时间/语法点的筛选（阅读/听力只有题型 chip） |
| 统计 | 拼句有语法薄弱点频次条 + 「AI 问题分析」(Pro)；阅读/听力只有题型计数 | 无趋势 |
| 收藏 ☆ | 云端表 `mistake_favorites`，自包含快照，`(user_code, session_id, detail_index)` 唯一 | **只有拼句接了 UI**（API 白名单其实已含 reading/listening）；快照里没有 `qid`；访客和尚未同步到云的记录不能收藏 |
| 重练 | 无 | 本次核心 |
| 数据来源 | 每次渲染时扫 `loadHist().sessions` | 云端客户端只拿**最近 200 条 session（所有科目混计）**，游客本地只留 50 条 → 更早的错题悄悄消失（`lib/cloudSessionStore.js:125`、`lib/sessionStore.js:14`） |
| 入口 | 桌面：写作中栏卡（不限 Pro）、阅读/听力中栏卡（仅 Pro）；手机：只有写作 tab 一张卡 | **侧栏没有入口**；手机看不到阅读/听力错题；`components/home/sections.js:84-88` 的 `TOOLS`（含「拼句错题本」）是无人消费的死代码 |
| 埋点 | 只有 `page_views` 记 `/mistake-notebook`（不含 query，分不出 section），后台只展示 top 20 页面 | 无任何错题本专属事件 |
| 测试 | 无错题本专属测试 | 仅 4 处间接护栏（见 §1.6） |

### 1.2 各题型的记录形状与「能否重练」

来源：各页 `saveSess` 调用（`components/buildSentence/useBuildSentenceSession.js:290-306`、`app/reading/page.js:299-316`、`app/listening/page.js:356-366`）。

| 题型 | 记录里有什么 | 稳定题 key | 仅凭记录能否重渲染 | 重练喂法 |
|---|---|---|---|---|
| 拼句 bs | `details[]`：`qid, prompt, userAnswer, correctAnswer, isCorrect, grammar_points`（**无** chunks/干扰项/预填） | `qid`（老记录可能缺） | **否**，必须按 `qid` 回查题库；`ets_s21..29` 与 2026-06-17 退役的旧库同名，**回查后要用 prompt+correctAnswer 校验**，不一致视为已下线 | `<BuildSentenceTask questions=[...] embedded recordGroupDone={false} persistSession={false} onComplete>` |
| 填词 ctw | `itemId, passage, blanks[], results[{blank, userAnswer, fullWord, isCorrect}]` | `itemId#position` | **是** | `<CTWTask item isPractice onComplete onExit>`，整篇重做 |
| 阅读选择 rdl/ap | `itemId, passage, questions[], results[{selected, correct, isCorrect}]`（rdl 无 qIndex，按下标对齐） | `itemId#qN` | **部分**（缺 `format_metadata` 标题行、真题 `material_image`） | `<RDLTask item={...item, questions: 只留错题, id: 新 id}>`，AP 经 `apPassageText` 适配 |
| 听力应答 lcr | `itemIds[], items[]{id, speaker, options, answer, explanation, audio_url}, results[{itemId, selected, correct, isCorrect}]` | `itemId` | **是**（audio_url 空则 TTS 兜底） | `<LCRTask batchItems=[错题子集] isPractice>`，外包 `ExamAudioProvider` |
| 听力选择 la/lat | `itemIds, transcript, questions[], audio_url, sentence_timings, results[{qIndex,…}]` | `itemIds[0]#qN` | **是** | `<ListeningMCQTask item={...筛 questions, 新 id} onNext>` |
| 听力选择 lc | 同上 + `conversation` | 同上 | **部分**（缺 `speakers`，TTS 兜底分音色要用） | 同上，drill 路由里按 `itemIds[0]` 回查补 `speakers` |
| 模考 reading/listening (`mode:"mock"`) | `details.m1.tasks[] / m2.tasks[] / tasks[]`，每个 task 自带整题快照 + `results[]`；CTW 结果形状不同（`{userAnswer,isCorrect}`，无 blank，按下标对 `task.blanks[]`） | 同上 | **是** | 派生时按 task 展开 |
| 口语 repeat | `items[]{id, sentence, score{accuracy, missedWords,…}}` | `items[].id` | 部分 | 无客观错，不收 |
| 写作 email/discussion | `promptId, promptData, userText, feedback` | `promptId` | 是 | 无客观错，不收（拼写错误已由 `/post-writing-practice` 覆盖） |

补充事实：
- 个人题库条目靠 `usr_` 前缀辨认，真题靠 `real_`（`lib/admin/realSession.js`）；两者记录形状与常规一致。
- 真题拼句的 `grammar_points` 恒为 `[]`（`lib/realBank.js:322`），按语法点筛选对它无效。
- 云端缓存是「最新在前」，`saveSess` 乐观插入在末尾、`slice(-200)` 会先挤掉一条最新，写完后整表重拉（`lib/sessionStore.js:316`）—— 消费者必须自己按 `date` 排序。
- 本地模式 session **永远没有 `id`**；云端未重拉前 `id` 也是 `undefined`。错题池按题 key 而不是按 session 定位，不受影响。

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
- 当时写明**留给「larger redesign」**的三件事：错题与 `sessions.details` 的耦合、`detail_index` 漂移、session 删除后收藏不级联。错题池按题 key 定位，一次解决前两件；第三件按「收藏是自包含快照、不级联」维持。
- 已拍板不改：AI 讲解/分析 Pro 门；SSR 初值为空挂载后再填。

### 1.5 组题要走的路：真题专区的复用机制

`app/real-bank/page.js` = 页内状态机 + 直接 import 各科任务组件 + props 直喂，**没有路由参数、没有 store**（写作例外，用 `lib/history/retry.js` 的 sessionStorage 快照交接）。

| 科目 | 喂法（真题页行号） | 注意 |
|---|---|---|
| 拼句 | `<BuildSentenceTask questions={batch.questions} practiceMode timeLimitSeconds onExit/>`（:674-679） | 题必须是**原始题库对象**，经 `runtimeModel.prepareQuestions` 规范化；不要带 `__sourceSetId/__sourceGroupId`（会把整套标 done）；传 `questions` 后自动不走草稿续做；`embedded` 模式不出自己的结果页，模考正在这么用 |
| 阅读 | `<CTWTask/RDLTask item timeLimit isPractice onComplete/>`（:601-629），外包 `AssetPreloadGate` | 草稿 key 是 `buildDraftKey(type, item.id)`，子集 item 要换新 id 防串草稿 |
| 听力 | `<LCRTask batchItems/>`、`<ListeningMCQTask item taskType/>`（:485-505） | **必须包 `ExamAudioProvider`**（iOS/微信音频解锁）；standard 才要 `ListeningIntroScreen`，practice 不用 |
| 限时 | `lib/realBankModes.js:57 getRealBankTimeSeconds(type, mode)`，纯函数、不许 import 题库 | 练错题一律 practice（不限时） |

**硬约束**：「真题答题页 = 常规练习答题页，答题页不许再套任何额外外壳」（CLAUDE.md）—— 顶栏 sticky、阅读答题区高度写死 `calc(100vh - N)`，多一条横幅整页下移。「第 N / M 组」只能放在选题页、各组之间的衔接页或报告页。

现有抽题方式只有四种：按未做整套顺序（BS）、话题多样性随机（阅读）、纯随机（听力/口语）、手选（practice picker）。**没有任何「自定义题池」概念**，所以组题必须是新路由而不是改练习页的参数。

### 1.6 其他硬约束

- `__tests__/ai-empty-response.regression.test.js:131-170` 用 `readFileSync` 扫 **`components/MistakeNotebook.js` 与 `components/mistakes/useMcqAiExplain.js`**：每个 `await callAI(` 行必须含 `AI_HELPER_MAX_TOKENS`，源码不得出现 `error: e.message`，**且每个文件至少要有一处 `await callAI(`**（`expect(calls.length).toBeGreaterThan(0)`）。所以「AI 问题分析」的调用要留在 `MistakeNotebook.js` 里，搬走就得同步改测试的 `CALL_SITES`。
- `__tests__/real-bank-section.component.test.js:324-354`：`SectionContent` 的 props 名 `bsMistakeCount / readingMistakeCount / listeningMistakeCount` 是契约；首页白名单必须保持 `["writing", …]` 数组字面量写法；真题面板不得出现「拼句错题本」文案。
- `__tests__/nav-sidebar-support.component.test.js:14` 把 `VocabNavItem` mock 掉 —— 新的侧栏错题入口若自带数据 hook，同一个测试也要 mock。
- 首页 / 错题本组件**不许 import 题库 JSON 或 `lib/realBank.js`**（`lib/realBankModes.js:11-12`、`lib/realBankHistory.js:13-15` 的 bundle 守卫；有源码级回归门）。按 `qid` 回查题库的解析器只能放在 drill 路由里。
- JSX 文本直接写中文，禁 `\uXXXX`。SSR 初值必须为空、挂载后再填。
- 收藏 API 身份 = 请求自带的 6 位码，RLS 全放行（IDOR，BACKLOG [低]，上游是 [高] 认证模型改造）。本次不夹带身份改造；若将来建新表，按单词本 2026-09-28 `vocab-sync-hardening.sql` 的口径收紧。

---

## 2. 用户使用流程

### 2.1 现在的路径（断点加粗）

1. 做完一套练习 → 结果页 → **没有任何「N 题已进错题本」提示或链接**。
2. 首页 → 写作 tab 中栏往下翻 → 「拼句错题本」卡（阅读/听力的卡在各自 tab、仅 Pro 可见）→ 整页 `/mistake-notebook`。手机上只有写作 tab 有卡，**手机用户基本找不到阅读/听力错题**。
3. 列表按场次折叠；想看某个语法点的题只能逐套翻。**看完就结束**，不能重练。
4. 收藏 ☆ 只在拼句卡上，访客灰显。
5. 超过 200 条记录后，早期错题从列表里消失，用户不知情。

### 2.2 目标路径

**A. 练错题（主路径）**：首页侧栏「错题本 · 37」→ 概览页顶部「练错题」→ 选题页：科目/题型 chips（拼句 / 填词 / 应答 / 阅读选择 / 听力选择，可多选速练型）→ 来源 chips（全部 / 仅收藏 / 最近 7 天 / 还没重做过 / 某语法点〔拼句〕）→ 数量（5 / 10 / 20 / 全部；篇章型按篇计）→ 预览列表（可勾掉）→ 开始 → 逐组作答（现成任务组件，无外壳；多组之间点「继续 → 第 2/3 组」）→ **统计报告**：本次 N 题、正确 M、用时；分题型正确率；拼句按语法点的错误分布；「仍然错的题」列表（展开看你的答案 / 正确答案 / 解析 / AI 讲解 Pro）；「这次做对的 K 题」可一键勾选移出错题本（**用户手动**，不自动判定）；按钮「同条件再抽一组 / 返回错题本」。

**B. 翻看与整理**：列表按**题**分组（一题一张卡，角标「错 2 次 · 最近 3 天前 · 上次重做 ✓」，展开看每次作答）；筛选条：科目 / 题型 / 收藏 / 还没重做过 / 时间；卡片动作：☆ 收藏、移出错题本、AI 讲解、「只练这一题」。

**C. 练后提示（第二期）**：各科结果页加一行「本次 3 题进了错题本 · 去练」。

### 2.3 与单词本的关系

两个「本」并排坐在侧栏里，入口与内嵌方式一致，但**错题本不做调度**：没有今日队列、没有掌握判定、没有间隔重复。单词本的 `ReviewSummary` / `SegmentCheckpoint` / `reviewSave.js` 都绑着「词 + SRS」，不复用；错题本的报告页另写（结构简单：数字 + 两张列表）。

---

## 3. Decision：目标架构

### 3.1 错题池 `lib/mistakes/`

```
lib/mistakes/
├── keys.js      # 题 key 规则 + 从 session 派生条目（纯函数；含模考 tasks 展开；接管现有 3 个 extractor 的解析逻辑）
├── pool.js      # 本地池：按账号分 key 的 localStorage（仿 vocabStore 的 ::user:CODE / ::guest），读写 / 合并 / 软删除 / 配额兜底
├── derive.js    # 每次打开：loadHist() → keys.extract → pool.merge（幂等；只加不减，本地池独有的老题保留）
└── counts.js    # 侧栏 / 首页角标用的轻量计数（只读本地池，不 import 任何题库）
```

**题 key**（去重依据）：

| 题型 | key | 老记录兜底 |
|---|---|---|
| bs | `bs:${qid}` | 无 qid → `bs:h:${hash(prompt\|correctAnswer)}` |
| ctw | `ctw:${itemId}#${blank.position}` | 模考 ctw 无 blank → 按下标对 `task.blanks[]` 取 position |
| rdl / ap | `${subtype}:${itemId}#q${index}` | — |
| lcr | `lcr:${itemId}` | results 无 itemId → `items[index].id` |
| la / lc / lat | `${subtype}:${itemIds[0]}#q${qIndex}` | — |

**存储结构（规范化，防 localStorage 配额）**：篇章快照（passage / blanks / questions / transcript / conversation / audio_url / sentence_timings）按 `itemId` 只存一份在 `items`，每条错题 `cards[key]` 只存自己的小字段并引用 `itemId`：

```js
{
  items: { [itemId]: { subject, subtype, itemId, snapshot: {/* 篇级 */}, updatedAt } },
  cards: {
    [key]: {
      key, subject, subtype, itemId, index,            // index = position / qIndex / lcr 为 null
      brief: { stem, userAnswer, correctAnswer, options?, explanation?, grammar_points? },  // 卡片首屏够用的小快照
      wrongCount, firstWrongAt, lastWrongAt,
      starred: false,
      lastDrill: null | { at, correct },               // 仅展示，不做任何自动判定
      sources: [{ sessionId, date, mode, real, personal }],   // 最多 5 条
      updatedAt, deletedAt: null,                      // deletedAt = 用户「移出错题本」
    },
  },
}
```

配额兜底：写入抛 QuotaExceeded 时先丢最老 `items` 的 passage/transcript 正文（保留 `brief`，卡片仍能渲染，只是不能整篇重做并提示「原文已精简」），再丢最老的 `sources`。

**派生与合并**（`derive.js`，每次打开错题本 / 首页侧栏计数就绪时跑一次）：对 `loadHist().sessions` 跑 `keys.extract`（含模考），按 key 合并进本地池：新 key 直接加；已有 key 更新 `wrongCount`（按 `sources` 去重 session）、`lastWrongAt`；`starred / deletedAt / lastDrill` 是本地状态，不被派生覆盖。**跨设备**：新设备打开立刻看到最近 200 条 session 派生出的错题（与现状持平），本地池额外保住更早的；收藏 / 移出 / 上次重做这三样状态在云同步落地前只在本机。

**写入时机**：各科 `saveSess` 之后同步调 `pool.recordSession(session)`（`useBuildSentenceSession.js:308`、`app/reading/page.js:299`、`app/listening/page.js:356`、真题页三处、`AdaptiveExamShell.js:1609`）；即使漏调，下次派生也会补上。

**收藏**：改走本地池 `starred`（游客也能收藏）；现有云端 `mistake_favorites` 在首次派生时读一次并入 `starred`，之后不再写。

### 3.2 入口与导航

| 项 | 做法 |
|---|---|
| 侧栏 | 新 `components/mistakes/MistakeNavItem.js`，照 `VocabNavItem` 写：`<Link href="/?section=mistakes">`，左键拦截走 context `navigate()`（把 `VocabHomeNavigation` 泛化成 `HomeNavigation` 或并列一个），`aria-current`，药丸 = **池内错题数（去重、未移出）**，红/rose 系（cyan 已被单词本占用），`ready && count>0` 才显示，超过 99 显示 `99+`；挂在 `NavSidebar.js:326` 单词本之后 |
| 首页内嵌 | `HomePageClient.js:99` 白名单加 `"mistakes"`（保持数组字面量）；`:400` 三元加分支 `<MistakeNotebook embedded />`，右栏与单词本一致不渲染；`MistakeNotebook` 加 `embedded` prop 去掉 `PageShell` 与「返回」键 |
| URL | 首页 `?section=mistakes&sub=bs\|reading\|listening`（`sub` 避开首页 `section` 的取值冲突）；`app/mistake-notebook/page.js` 改为服务端 `redirect("/?section=mistakes&sub=…")`（仿 `app/vocab-notebook/page.js`），现有深链继续可用 |
| 移动端 | `components/mistakes/MobileMistakeEntry.js` 照 `MobileVocabEntry`，放在 `MobileHomePage.js:152` 单词本卡之后、tab 条之前，全局可见 |
| 清理 | 删 `SectionContent.js:154-162` / `ReadingSectionContent.js:267-290` / `ListeningSectionContent.js:229-252` 三张中栏卡与手机写作 tab 卡；删 `sections.js` `TOOLS`；`countBsMistakes` 挪到 `lib/mistakes/counts.js`（`HomePageClient` 的三个计数改读池）；修 `MobileHomePage.js:390` |
| 测试 | 新 `__tests__/mistake-home-navigation.component.test.js`（抄 vocab 那份）；`nav-sidebar-support` 里 mock 新入口；`real-bank-section` 的 props 契约按改动同步 |

### 3.3 概览页信息架构（内嵌在首页中栏）

```
┌ 错题本 ────────────────────────────────────────────────┐
│ 37 道错题 · 拼句 18 · 填词 9 · 应答 6 · 阅读选择 3 · 听力选择 1 │
│ 收藏 6 · 本周新增 5 · 最近一次练错题：昨天 10 题对 7      [ 练错题 ] │
└──────────────────────────────────────────────────────────┘
筛选： [全部科目▾] [题型▾] [☆ 收藏] [还没重做过] [最近 7 天▾]   [语法分布 / AI 分析 ▾]
┌ 错题卡（一题一张）────────────────────────────────────┐
│ 拼句 · 错 2 次 · 最近 3 天前 · 上次重做 ✓    ☆  移出  只练这题 │
│ 题面 / 你的答案 / 正确答案 / 语法点 chips / 解析 / AI 讲解 │
│ ▸ 作答记录（2 次）                                        │
└──────────────────────────────────────────────────────────┘
```

拼句的「语法薄弱点分布 + AI 问题分析」保留，收进筛选条右侧的折叠区（**调用仍留在 `components/MistakeNotebook.js`**，见 §1.6）。

### 3.4 练错题 `/mistake-drill`

- **选题页**（`/mistake-drill`）：科目/题型 chips → 来源 chips → 数量 → 预览列表 → 开始。速练型（拼句、应答）可多选混组；篇章型按篇列出（「这篇错了 3/10 空 · 整篇重做」）。也接受 `?key=` 单题直达（卡片上的「只练这题」）。
- **分组规则**：按题型分组成 `stages`：拼句所有题 → 一个 `BuildSentenceTask`（`embedded`，自己不出结果页）；应答所有题 → 一个 `LCRTask batchItems`；填词 / 阅读选择 / 听力选择每篇一个 stage。
- **作答页**：页内 `stages[]` + 当前下标。各组件用 `onComplete` 收结果；组件自带的结果页**保留**（用户做完一篇当场看对错有价值），只把结果页上的出口接到「继续 → 第 N/M 组」或「查看统计 →」：`ListeningMCQTask` 已有 `onNext`；给 `CTWTask / RDLTask / LCRTask` 各加一个可选 `onNext` + `nextLabel`（默认不传时行为完全不变）。全部 `recordGroupDone={false}`、`persistSession={false}`、`isPractice`、**不调 `addDoneIds`、不写练习历史**。
- **喂题**：拼句在本路由按 `qid` 回查（静态库 `data/buildSentence/questions.json` → 真题 `getRealBSQuestions()` → 个人题 `fetchPersonalBank("build")`），校验 `prompt + correctAnswer`，不一致的题提示「原题已下线」并从组里剔除（池里保留卡片）。阅读 / 听力直接用池里的篇级快照拼 item（换新 id `${itemId}__drill`）；AP 过 `apPassageText`；lc 缺 `speakers` 时按 `itemIds[0]` 回查补。听力 stage 外包 `ExamAudioProvider`。
- **报告页**：本次题数 / 正确 / 用时；分题型正确率；拼句按语法点的错误分布（复用 `translateGrammarPoint`）；「仍然错的题」列表（展开 = 现有错题卡 + AI 讲解）；「这次做对的 K 题」勾选 → 「移出错题本」（手动）；「同条件再抽一组」/「返回错题本」。回写池：每题 `lastDrill = { at, correct }`；另记一条本地 `drills[]`（日期、条件、N、正确数，最多 50 条）供概览页「最近一次练错题」一行。
- **中途退出**：stage 边界存 `{keys, stageIndex, results}` 到 localStorage（按账号分 key，当天有效），回来可续；不存题。

### 3.5 UI 方向（先出图再动手）

实施前出 **2-3 张概览页静态图 + 1 张选题页 + 1 张报告页**（真实 token：`components/shared/ui.js` 的 `C/FONT`，侧栏用 `components/home/theme.js` 的 `T/CH`；内联 style；不用渐变/毛玻璃）：

| 方案 | 思路 |
|---|---|
| A 清单优先 | 现有列表 + 顶部一条紧凑摘要 + 「练错题」按钮 + 筛选条（最小改动） |
| **B 摘要卡 + 清单（推荐）** | 顶部一张与单词本首页卡同构的摘要卡（计数分科 + 练错题按钮 + 最近一次），下面筛选 + 一题一卡 |
| C 科目三栏 | 拼句 / 阅读 / 听力三列各自计数与「练」按钮 |

答题页不出图（复用现成组件，不许加壳）。颜色沿用 `SECTION_META`（拼句 `#087355` / 阅读 `#3B82F6` / 听力 `#8B5CF6`），药丸 rose/red 系。

### 3.6 门禁与成本

- 错题池、列表、练错题：本地判分，**零 AI 成本**。对所有用户开放（含游客，池按 `::guest` 分 key）。
- **阅读 / 听力的练错题跟随源功能门禁（Pro）**：这两科练习页本来就是 Pro 专属，试用过期的用户仍能**看**自己的阅读/听力错题，但「整篇重做」按钮显示 Pro 锁；拼句不限。
- AI 讲解 / AI 问题分析：维持 Pro 门与 `AI_HELPER_MAX_TOKENS` 预算，缓存键沿用。

---

## 4. Options Considered

| 决策点 | 备选 | 取舍 |
|---|---|---|
| 数据层 | ① 继续渲染时从 sessions 现算（现状）；② **本地池 + 每次打开从 sessions 派生合并**（定稿）；③ 服务端分页读全量 sessions | ① 不能去重、不能收藏/移出、受 200 条上限；③ 多一层 API 仍没有本地状态；② 跨设备不比现状差，本地还多保住老题，云同步可后补 |
| 入口形态 | A 侧栏链接仍跳整页；**B 首页内嵌 section**（定稿） | B 与单词本一致；`section` 参数名冲突用 `sub` 解决 |
| 复习结果 | ① 写进练习历史打标记；**② 不写历史，只回写池 + 本地 drills 日志**（定稿） | ① 要在 `dailyTasks`、进度图、三个 extractor 到处排除，BS 的 details 是数组没处挂标记 |
| 组题注入 | ① 给各练习页加 `?ids=`；**② 新路由直喂组件**（定稿） | ① 每页都要改选题/门禁/草稿三处且练习页有整页 Pro 门；② 零改动练习页，真题专区已验证 |
| 多组串联 | ① 隐藏组件结果页、只出总报告（要给 4 个组件加 embedded）；**② 保留组件结果页，加可选 `onNext`**（定稿） | ② 改动极小（一个可选 prop）、默认行为不变，且做完一篇当场看对错本来就有价值 |
| 填词单位 | ① 只做错的空（给 `CTWTask` 加预填已对空）；**② 整篇重做、报告只算错过的空**（定稿） | ① 要改作答组件的判分与渲染；② 零改动，第二期若用户嫌长再做 ① |

---

## 5. 分期与验收

| 阶段 | 交付 | 验收 |
|---|---|---|
| **M0 对比图** | 2-3 张概览页 + 1 张选题页 + 1 张报告页静态图（侧栏 / 移动入口局部） | 用户选定一版 |
| **M1 入口迁移** | 侧栏项 + 药丸、首页内嵌 `embedded`、`?section=mistakes&sub=`、旧地址重定向、移动全局入口、删三张中栏卡与 `TOOLS`、`countBsMistakes` 搬 lib、修 `MobileHomePage.js:390` | `npm test` 全绿；新导航测试；dev server 起真组件在 1440 / 1024 / 390 宽截图；bundle 守卫测试不红 |
| **M2 错题池 + 列表改版** | `lib/mistakes/*`、各 `saveSess` 后接入、模考展开、每次打开派生合并、收藏改走池、一题一卡 + 筛选 + 移出 | 单测：key 规则 / 去重 / 合并幂等 / 模考展开 / 配额兜底；用一份含 bs+ctw+rdl+ap+lcr+la+lc+lat+mock 的样例历史跑派生对数 |
| **M3 练错题 + 报告** | `/mistake-drill` 选题页 → stages → 报告页；`CTWTask / RDLTask / LCRTask` 加可选 `onNext`；拼句回查与校验；`lastDrill` / `drills[]` 回写 | 真组件跑通每种题型一组 + 一次混组；确认不写练习历史、不写 done 集；答题页与常规练习页逐像素对照无外壳；拼句回查失败路径 |
| **M4 云同步（可选）** | `mistake_pool` 表（JSONB 镜像，RLS 收紧）+ `/api/mistakes/pool` 双向合并（`updatedAt` 新者胜，软删参与） | /sql-migrate 台账；两设备互改同一卡 |
| **M5 进阶（择项）** | 结果页「N 题进了错题本」提示；拼句「同语法点换新题」；填词只做错的空；埋点事件 | 各自独立验收 |

M1 与 M2 可并行派工（入口不依赖池，先用现有计数兜着）；M3 依赖 M2 的 key 与池结构。

---

## 6. 已定与待定

**已定（2026-10-06）**：不做掌握判定 / 今日队列；入口内嵌首页 section；药丸 = 池内错题数；复习不计入练习历史与每日任务；中栏三张旧卡删；云同步放 M4 可选；错题池与练错题对所有用户开放、阅读 / 听力的整篇重做跟随源功能 Pro 门、AI 功能维持 Pro。

**只需知会**：① 本次不碰收藏 / 会话 API 的身份校验（归 BACKLOG [高] 认证模型改造）；② `mistake_favorites` 迁移台账状态是「未知」，M2 读旧收藏时按「表可能不存在」兜底（读失败即跳过）。

---

## 7. 风险

- **拼句回查失配**：qid 曾被复用（旧 `ets_s1..29` 退役、新 `ets_s21+` 同名），不校验 prompt 会把不同题当原题；真题拼句无语法点，语法筛选对它无效。
- **localStorage 配额**：篇级快照（听力 transcript、阅读 passage）体积大，必须规范化存一份并带配额兜底；`toefl-hist` 本身已可能占到 1-2 MB。
- **跨设备状态**：云同步落地前，收藏 / 移出 / 上次重做只在本机；错题内容本身靠「每次从最近 200 条 session 派生」保证不比现状差。
- **侧栏高度**：已有 6 项 + 单词本 + 账户卡 + 3 入口，再加一项在矮视口会触发内部滚动（`maxHeight: calc(100vh - 96px)`），对比图阶段在 768 高度下看一眼。
- **测试源码扫描**：`components/MistakeNotebook.js`（须保留 `await callAI(`）、`useMcqAiExplain.js` 路径与 `SectionContent` props 名不能随手动。
- **bundle**：回查题库的代码只能在 `/mistake-drill` 路由；首页与内嵌错题本保持零题库 import。
- **第 200 条之前的历史**：派生只能拿到客户端可见的最近 200 条；更早的错题只有「在本机打开过错题本」的用户才被本地池保住。真要找回要一次性服务端脚本（`supabaseAdmin` 分页读 `sessions`），不阻塞。

---

## 8. 对抗式自审（2026-10-06，针对用户拍板后的方案）

逐条列攻击面，结论标 ✅ 站得住 / ⚠️ 已修订 / ❌ 原方案有误已改。

1. **❌ 「集中做题 → 一份报告」在多组串联时会被组件自带结果页打断。** 查证：`CTWTask`（:256-298）、`RDLTask`（:336-344）、`LCRTask`（:222-400）、`ListeningMCQTask`（:353-356）提交后各自渲染结果页，唯一出口是 `onExit`（按钮文案写死「返回 / Exit / 完成并返回」）；只有 `BuildSentenceTask` 有 `embedded` 能跳过结果页。模考 `AdaptiveExamShell` 并没有复用这几个组件，而是自己渲染题目。→ 修订：保留组件结果页，给三个组件加可选 `onNext + nextLabel`（`ListeningMCQTask` 已有 `onNext`），拼句用 `embedded`。单组练习时结果页只出一次 + 总报告，不会重复。
2. **❌ 填词「一空一条、抽 N 空」做不到。** 查证：`CTWTask` 没有任何预填 / 锁定已对空的 prop（grep `initialAnswers|locked|readOnly` 无命中，:64 的「locked chip」指题面给定的前缀），空按 `blank.position` 定位、筛空会错位。→ 修订：池里仍一空一条（统计与展示用），练习单位改为篇，报告只统计错过的空；「只做错的空」列入 M5。
3. **⚠️ 砍掉掌握层之后，错题池还有必要吗？** 现状「渲染时从 sessions 现算」能满足去重与模考展开（都是纯函数），池的增量价值只剩三件：突破 200 条上限、收藏 / 移出 / 上次重做这几样用户状态、侧栏计数不用每次全扫。结论：保留但做瘦（去掉 `correctStreak / mastered`），并且**每次打开都从 sessions 重新派生合并**，让池不成为唯一真源。
4. **❌ 纯本地池会让跨设备体验退化。** 现状靠 sessions 在云端，换设备错题照样在；若只写本地池，新设备会是空的。→ 修订见第 3 条：派生合并每次都跑，新设备立刻与现状持平；云同步只负责那三样状态。
5. **⚠️ localStorage 配额。** 一条阅读错题若各自内嵌 passage，10 个空 = 10 份 passage；听力 transcript 更大。→ 修订：按 `itemId` 规范化存一份篇级快照，卡片只存 `brief`；写入失败按「先丢正文再丢 sources」降级。
6. **⚠️ 测试护栏会被 UI 重构误伤。** `ai-empty-response.regression.test.js` 要求 `components/MistakeNotebook.js` 里**至少有一处** `await callAI(`。若把「AI 问题分析」搬到子组件，测试直接红。→ 写进 §1.6 与 §3.3：调用留在原文件，或同步改 `CALL_SITES`。
7. **⚠️ 门禁不一致。** 阅读 / 听力练习页整页 Pro，若练错题对全员开放，试用过期用户可以绕过 Pro 做阅读 / 听力题。→ 定稿：阅读 / 听力的「整篇重做」跟随源功能门禁，拼句与看题不限。
8. **✅ 不写练习历史的选择。** 若写，`dailyTasks` 按 `type` 数条数会把练错题算成练习、进度图多出低分点、三个 extractor 再把它抽成新错题；BS 的 `details` 是数组没处挂标记。只回写池 + 本地 `drills[]` 边界清晰。
9. **✅ 组题路由不改练习页。** 四个练习页都没有 `?item=`，加参数要改选题 / 门禁 / 草稿三处且练习页有整页 Pro 门；真题专区已证明「新路由 + props 直喂」可行。
10. **✅ 「数量」语义。** 拼句 / 应答按题，篇章型按篇，选题页按题型分别标注单位，预览列表所见即所得。
11. **✅ 拼句回查。** 必须在 drill 路由做（bundle 守卫），且 `prompt + correctAnswer` 校验防 qid 复用；真题 `real_` 与个人 `usr_` 走各自 getter。
12. **✅ 草稿串扰。** 子集 item 换新 id `${itemId}__drill`，退出时清草稿。
13. **✅ 收藏迁移。** 旧云端收藏读一次并入 `starred`，表可能不存在（台账状态未知）→ 读失败即跳过，不阻塞。
14. **✅ 「这次做对的题移出错题本」是手动勾选**，不是自动判定，符合拍板口径。
15. **⚠️ 口语 / 写作不收，但用户原话里有「写作造句」** —— 造句就是 BS，已覆盖；写作篇章题与口语无客观对错，明确不收并在空态文案里说明。

自审后无阻塞项；修订已全部回写到 §0 / §3 / §4 / §5。

---

## 附：关键文件索引

- 现状：`app/mistake-notebook/page.js`、`components/MistakeNotebook.js`（774 行；`extractMistakes :22`、`buildSnapshot :49`、`countBsMistakes :769`）、`components/mistakes/McqMistakesView.js`、`components/mistakes/useMcqAiExplain.js`、`lib/readingMistakes.js`、`lib/listeningMistakes.js`、`components/buildSentence/useMistakeFavorites.js`、`lib/mistakeFavorites.js`、`app/api/mistakes/favorites/route.js`、`scripts/sql/mistake-favorites.sql`
- 记录写入：`components/buildSentence/useBuildSentenceSession.js:290-308`、`app/reading/page.js:296-321`、`app/listening/page.js:323-372`、`app/real-bank/page.js:199-290`、`components/mockExam/AdaptiveExamShell.js:1609-1665`
- 任务组件出口：`components/reading/CTWTask.js:256-298`、`components/reading/RDLTask.js:336-344`、`components/listening/LCRTask.js:222-400`、`components/listening/ListeningMCQTask.js:353-356`（已有 `onNext`）、`components/buildSentence/BuildSentenceTask.js:92-107`（`embedded / persistSession / recordGroupDone / onComplete / autoStartOnMount`）
- 存储：`lib/sessionStore.js`（`MAX_HISTORY :14`、`saveSess :303`、`slice(-200) :316`、`syncCloudHistory :204`）、`lib/cloudSessionStore.js:117-135`
- 首页与侧栏：`components/home/HomePageClient.js`（白名单 :97-100、计数 :175-177、移动 :289-343、侧栏 :388、中栏/vocab :400）、`components/home/NavSidebar.js`（外壳 :225-239、Sections :273-326）、`components/home/sections.js`、`components/home/theme.js`、`components/home/MobileHomePage.js`（单词本卡 :152、tab 条 :155-184、错题卡 :304-328、bug :390）
- 要镜像的单词本件：`components/vocab/VocabNavItem.js`、`MobileVocabEntry.js`、`VocabHomeNavigation.js`、`useVocabSummary.js`、`app/vocab-notebook/page.js`、`__tests__/vocab-home-navigation.component.test.js`
- 复用先例：`app/real-bank/page.js`（状态机 :315-318、喂题 :485-679）、`lib/realBankModes.js:57`、`lib/history/retry.js`、`components/writing/PostWritingPracticePage.js`（由历史派生的练习）
- 护栏测试：`__tests__/ai-empty-response.regression.test.js:131-170`、`real-bank-section.component.test.js:324-354`、`nav-sidebar-support.component.test.js:14`、`reading-sentence-selection-history.component.test.js:100-140`、`real-bank-listening-speaking.component.test.js:372-375`
