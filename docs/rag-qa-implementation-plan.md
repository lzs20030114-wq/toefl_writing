# 练习答疑窗口 · 实施计划（第一期：阅读选择题）

> 2026-10-12。给新开的实施窗口照着做。设计依据见 `docs/rag-design.md`（先读 §1–§9.5）。
> 分支 `claude/rag-design-positioning-akgm9l` 已带设计稿和第 1 步的纯函数草稿，在它上面继续，或从它切新分支。

## 0. 范围

**做**：阅读选择题（RDL；AP，含选句题、插入句题）逐题回顾里的「继续追问」窗口。
- 第一轮仍然是现有的「AI 讲解」，窗口接在它下面。
- 追问时 AI 只依据本题材料，回答带 `[S3]` 这类出处，由前端核对。
- 证据包里带上用户自己的同类历史错题，问到单词时查本地 ECDICT。

**不做（后续期）**：CTW、听力、拼句、写作、口语；错题本复盘；真题跨题检索；方法 / 陷阱说明库。

**不许动**：
- `/api/ai` 接口（多轮靠把历史拼进 message）
- 第一轮讲解的 prompt 与缓存桶 `reading-ai-explain-cache-v2`（改了会让老用户重复计费）
- 题库

## 1. 已完成：纯函数层（第 1 步）

`lib/qa/questionQa.js` + `__tests__/question-qa.test.js`（17 个测试，已通过）：

| 导出 | 作用 |
|---|---|
| `QA_SYSTEM` | 追问用的 system prompt：引用规则、不许改判答案、超纲说「材料里没有」、长难句拆法、陷阱类型名、纯文本 |
| `QA_PRESETS` | 预设问题：为什么不选我选的（仅答错）、答案依据在哪、拆解这句长难句（需选句）、这个词什么意思（需选词） |
| `QA_MAX_TURNS` = 6 / `QA_MAX_MESSAGE_CHARS` = 24000 | 每题追问上限 / message 长度上限（历史从最早的开始丢，证据包不丢） |
| `numberSentences(passage)` | 原文按段按句编号 S1..Sn。切句用 `lib/tts/wavTools.splitSentences`，和听力 `sentence_timings` 是同一把刀，后续接听力时 `[S7]` 能直接对上逐句点播 |
| `buildEvidence(detail, related)` | 证据包，返回 `{ text, sentences, materials }`。传了 `paragraphs` 会先用 `restoreParagraphBreaks` 补段。选句题的选项键（也叫 S1..Sn）一律换成句子原文并对回原文句号，不会和原文编号混 |
| `pickRelatedMistakes(cards, { questionType, subtype, stem })` | 从错题池取同小类（rdl / ap）、同题型的最近 3 道错题，本题自己的累计错次单独给 |
| `askedEnglishTerm(question, sentences)` | 自由提问里只提到一个原文里出现过的英文词或短语 → 返回它，拿去查词典 |
| `buildQaMessage({...})` | 拼本轮 message：材料 + 词典 + 第一轮讲解 + 之前的追问 + 选区 + 本轮问题 |
| `parseAnswer(text, sentences, materials)` | 把回答切成 text / quote / cite 段并校验（规则见 §3.3） |
| `citationStats(segments)` | 出处数 / 核不上的出处 / 核不上的引文，给测试和评估用 |
| `locateSentence` / `conversationKey` | 选中文字落在哪句 / 本题会话存档键（与讲解缓存同口径） |

这一层是用户说「先写计划」之前起的草稿，只在本分支上，没开 PR。实施窗口可以直接用、改，也可以连同测试整层删掉重写；保留的话，测试要一直保持绿。

## 2. 第 2 步：hook `components/reading/useQuestionQa.js`

```js
const qa = useQuestionQa(detail, firstExplain);
// qa.turns  [{ q, a, presetId, selection, related, at }]
// qa.loading / qa.error / qa.remaining（本题还能问几次） / qa.ask(question, { presetId, selection })
```

**`ask` 的流程**
1. 本题已达 6 轮，或今天已达每日追问上限（见下）时直接返回。
2. 历史错题：每个面板只算一次（用 ref 记住）。只读，**不调 `savePool`**，错题本自己打开时才会同步：
   `pickRelatedMistakes(activeCards(mergeEntries(loadPool(), extractMistakeEntries(loadHist()?.sessions || [])).pool), { questionType, subtype, stem })`
3. 词典：查哪个词按这个顺序取：
   - 选区是单词 → 查选中的词
   - 否则 → 查 `askedEnglishTerm(question, sentences)` 返回的词
   - 都没有 → 不查

   有词就 `await lookupWord(term)`（`lib/dict/lookup`），失败按 `null` 处理，不挡提问。
4. `callAI(QA_SYSTEM, buildQaMessage(...), AI_HELPER_MAX_TOKENS, 60000, 0.3)`。
5. 成功：追加一轮并存档。轮里带上本次的 `related` 快照，`[错题1]` 的悬停提示重新打开后也能显示。
6. 失败：`error = mapAiHelperError(e)`，用户输入的问题留在输入框里不丢，不计轮数。

**存档**（每一处读写都包 try/catch）
- localStorage 键 `reading-qa-v1:<账号码或 guest>`，内容 `{ [conversationKey(detail)]: { turns, updatedAt } }`。
- 最多保留 100 个会话，按 `updatedAt` 淘汰最旧的。
- 必须按账号分键：里面有用户自己打的字。
- 存档键和讲解缓存同口径，所以同一道题、同样的错答在别的练习记录里打开，看到的是同一段对话。这是想要的效果。

**每日追问上限 30 轮（默认值，计划里定的）**
- Pro 的 `/api/ai` 每天总共 100 次（`app/api/ai/route.js` 里的 `dailyLimit`），和写作批改共用。追问要是不封顶，可能把用户当天的写作批改额度吃光。
- 计数存 localStorage，按账号和本地日期分键。只是替用户保护自己的额度，不是安全措施。
- 到上限时提示「今天的追问次数用完了，明天再来；写作批改不受影响」。
- 服务端返回 `PRO_DAILY_CAP` 时照常走 `mapAiHelperError` 的文案。

**回归锁**：把新 hook 的路径加进 `__tests__/ai-empty-response.regression.test.js` 的调用点清单 `CALL_SITES`（第 134 行起），它会断言调用用的是 `AI_HELPER_MAX_TOKENS`。

## 3. 第 3 步：组件 `components/reading/QuestionQaPanel.js`

### 3.1 挂载

- 挂在 `ReadingAiExplainBlock`（`components/reading/useReadingAiExplain.js`）里，**讲解文本出现之后**才渲染。两种外观都挂：
  - `variant="review"`：放在 `AiExplainView` 卡片下面，用同一套 INDIGO 色
  - 默认外观：放在蓝色讲解框下面，用同一套天蓝色（`#f0f9ff` / `#bae6fd` / `#0c4a6e`）
- 这个 block 已经被 4 个入口共用，挂一处就全覆盖：
  - 真题练习记录 `components/realBank/review/McqReview.js`
  - 练习历史 `components/reading/ReadingProgressView.js`
  - 阅读模考详情 `components/reading/MockSessionDetail.js`
  - 交卷后复盘 `components/reading/RDLTask.js`
- 非 Pro 时整个 block 已经返回 null，面板不用另做门槛。
- 4 个调用点的 `detail` 补两个字段：
  - `subtype`：取 `session.details.subtype || "rdl"`，与 `lib/readingMistakes.js` 同源
  - `paragraphs`：有就传
- 面板在 `data-no-dict` 包裹里面（调用点已经包了），AI 回答里点词不会弹词典。

### 3.2 布局与交互

- **默认收起**：讲解卡片下面只有一个小按钮「继续追问」。本题有存档时显示「继续追问（已问 N 轮）」，点开就是之前的对话。
- **展开后从上到下**：
  1. 对话列表：用户的问题用右对齐浅灰气泡；回答左对齐、`pre-wrap`，出处渲染成小标（§3.3）
  2. 选区条：只在有选区时出现（§3.4），显示「已选中："…"」+「拆解这句」或「这个词什么意思」+ ×
  3. 预设问题 chips：「为什么不选我选的」只在答错且作答了时出现；「答案依据在哪」
  4. 输入框 + 发送。输入框高 1–3 行，placeholder 写「问这道题的任何问题，比如某句为什么这么说」。
     - Enter 发送，Shift+Enter 换行
     - **输入法组字时（`e.nativeEvent.isComposing`）Enter 不发送**，中文用户必踩
     - 手机上字号 ≥ 16px，避免 iOS 聚焦时放大
  5. 状态行：「还可以追问 N 次」。
     - 加载中显示「AI 正在对照原文作答…」
     - 出错显示错误文案 +「重试」（重试不新增一轮）
     - 到 6 轮显示「这题聊得够多了，可以去错题本练一练」
  6. 页脚小字：「回答只依据本题原文和你的作答；标『非本题材料』的是通用常识」
- **样式**：内联 style；flex 里能伸缩的那一侧带 `minWidth: 0`（Conventions）；JSX 文本里不许写 `\uXXXX`（`encoding-hygiene` 测试会拦）。
- **RDLTask 交卷后答题区高度写死**（`calc(100vh - 290px)`）：面板必须待在原本可滚动的题目栏里，不能撑高外层容器。

### 3.3 出处与引文的渲染（用 `parseAnswer` 的结果）

| 段 | 渲染 |
|---|---|
| `cite` sentence，有效 | 小标「S3」，title 是该句原文；点击在本条回答下面展开或收起该句「S3 · 第 2 段：…」 |
| `cite` sentence，无效（句号不存在，或紧跟的引文不在这句里） | 灰色小标「S9?」，title「这条出处核对不上，请以原文为准」 |
| `cite` answer / dict / mistake | 小标「答案」「词典」「错题1」；「错题1」的 title 是那道题的题干（取本轮的 `related` 快照） |
| `quote`，无效 | 琥珀色虚下划线，title「这段引文在本题原文里找不到」 |

- 有任何无效项时，回答下面加一行灰字：「有 N 处出处或引文核对不上，已标灰，请以原文为准」。
- 点出处只在答疑窗口里展开原句，第一期**不去**滚动或高亮左边的原文。4 个入口的原文 DOM 各不相同，留到第二期再做。

### 3.4 选区提问

- 面板展开时监听 `document` 的 `selectionchange`，加 100ms 防抖。选中内容满足下面全部条件才记进面板状态：
  - 不在面板自己或输入框里
  - 长度在 1–600 字之间
  - 单词能在原文里找到，或句子能被 `locateSentence` 对上
- 单个英文词算「词」，其余算「句」。记下文字和 `sentenceId`。
- 页面上可能同时展开好几个面板，只让**最近一次点过或展开的那个**接收选区：模块级变量记住当前面板 id。
- 选区先存进 state，所以点 chip 时浏览器把选区清掉也不影响。
- 划词词典 `WordLookupLayer` 照常弹窗，两者共存。验证时确认弹窗不会吞掉选区。

## 4. 第 4 步：测试（全部 mock `callAI`，不花钱）

新建 `__tests__/question-qa.component.test.js`，写法参照 `__tests__/reading-mcq-ai-explain.component.test.js`（同样 mock AuthContext、sessionStore、ai/client）。要锁住的行为：

- 讲解出来后才有「继续追问」；非 Pro 看不到。
- 点「答案依据在哪」：`callAI` 的 system 是 `QA_SYSTEM`，message 含 `[S1]`、`学生作答`、`【本题已给出的讲解】`。
- 回答含 `[S2]` 渲染成可点小标，点开显示原句；含 `[S9]` 渲染成灰标并出现「核对不上」那行。
- 第 6 轮之后输入框禁用；`callAI` 抛错时显示错误、问题留在输入框、轮数不变。
- 卸载后重新渲染能读回存档；换一个账号码读不到。
- 输入法组字时按 Enter 不发送。
- 错题池里有同题型错题时，message 含 `[错题1]`；mock 掉 `lookupWord` 后，问「anchor 什么意思」时 message 含 `【词典】`。

推送前跑全量 `npm test`。

## 5. 第 5 步：真浏览器验证（CLAUDE.md 硬规则：挂真组件）

- 起 dev server，建临时页 `app/zz-probe/page.js`，import 真的 `McqReview` 或 `RDLDetail`，喂一条真题 AP 记录作数据（选一篇带选句题的）。
- 用 Playwright `page.route('**/api/ai', …)` 返回写死的回答，**不调真模型**。写法参照 `e2e/vocab-meaning-explorer.spec.js`。
- 要看的：
  - 桌面 1280 和手机 390 两种宽度下展开、追问、点出处
  - 选句和选词后的 chip 流程
  - 交卷后复盘页面板展开后，答题区不溢出视口
- 截图留给用户看，用完删掉 `zz-probe`。

## 6. 第 6 步：离线评估（要花 DeepSeek 的钱，跑之前先问用户）

`scripts/qa/eval-reading-qa.mjs`：

- **抽样**：固定随机种子，抽 24 道真题：AP 16 道（含 2 道选句题、2 道插入句题），RDL 8 道。每道模拟一次错答（选一个干扰项）。
- **问法**：每道问 4 个问题，分别是「为什么不选我选的」「答案依据在哪」、一次选句拆解、一个故意超纲的问题（比如「这篇文章的作者是谁」）。共 96 次调用。
- **调用**：走 `lib/ai/deepseekHttp.callDeepSeekViaCurl`，自动记台账。默认 `--dry-run`，只打印「将调用 N 次 / 预计 ¥X」；超过 `--max-calls`（默认 200）要加 `--yes`。
- **指标**：
  - 出处有效率（有效出处 / 总出处）
  - 引文核实率
  - 超纲拒答率：回答含「材料里没有」
  - 疑似翻案：回答出现「答案应为 / 答案有误」这类说法，列出来人工看
- **建议及格线**：出处有效率 ≥ 95%，超纲拒答率 ≥ 90%，人工复核后翻案数为 0。不达标就改 `QA_SYSTEM` 再跑。
- **结果**写到 `.ops/qa-eval/<日期>.json` 和一页摘要。

## 7. 发版

- 只对 Pro 开放，不加 flag。要回退就回退提交。
- 不需要迁移，也不需要新 env。
- 推送走 /ship，公告走 /release-notes。

**可选**：线上质量监控。在 `ask` 成功后把 `citationStats` 上报，可以持续看出处有效率，但要新建一张表（参照 `audio_events`，走 /sql-migrate）。第一期可以先不做。

## 8. 完成标准

- [ ] 4 个入口都能在讲解下面展开追问，非 Pro 看不到
- [ ] 回答里的出处能点开原句，核不上的标灰并有提示
- [ ] 选句 / 选词提问可用；问到单词时 message 里带词典词条
- [ ] 证据包里带同类历史错题（只读错题池，不写）
- [ ] 每题 6 轮、每天 30 轮上限生效；出错不丢输入
- [ ] 第一轮讲解的 prompt 和缓存没变（`reading-mcq-ai-explain` 等现有测试不改也绿）
- [ ] `npm test` 全绿，真浏览器两种宽度截图通过，临时页已删
- [ ] 离线评估：问过用户后再跑，或者明确标为「未跑」

## 9. 留给后续期

- **听力四型**：用 transcript 跑 `numberSentences`（切句和 `sentence_timings` 同一把刀），出处小标改成 ▶ 逐句点播。
- **CTW、拼句**：证据换成整篇填空和词块，再分别写 system prompt。
- **点出处时高亮左栏原文**：先把 4 个入口的原文渲染统一出句级锚点再做。
- **方法 / 陷阱说明库**（设计稿 §9.5-3）：写好后按题型放进证据包，并在 `QA_SYSTEM` 里加 `[方法]` 出处。
