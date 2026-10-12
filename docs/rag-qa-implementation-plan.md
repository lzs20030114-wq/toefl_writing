# 练习答疑窗口 · 实施计划（第一期：阅读选择题）

> 2026-10-12 · v2：经过一轮对抗式自审修订，改了什么、为什么改，见 §10。
> 给新开的实施窗口照着做。设计依据见 `docs/rag-design.md`（先读 §1–§9.5）。
> 分支 `claude/rag-design-positioning-akgm9l` 上有设计稿和纯函数草稿。在这个分支上继续，或者从它切一个新分支。

## 0. 范围

**做**：阅读选择题（RDL；AP，含选句题、插入句题）逐题回顾里的「继续追问」窗口。
- 第一轮仍是现有的「AI 讲解」，窗口接在它下面。
- 追问时 AI 只依据本题材料，回答里带出处，由前端核对。
- 用户问错因或说自己的思路时，证据包里附上他自己的同类历史错题。

**不做**：
- 单词释义：复盘页点词已经有划词词典，Pro 还有 AI 语境释义（`WordLookupLayer`），答疑窗口不重复做。自由提问里问到某个词时，只顺带附上 ECDICT 词条。
- 后续期再做：CTW、听力、拼句、写作、口语；错题本复盘；真题跨题检索；方法 / 陷阱说明库。

**不许动**：
- `/api/ai` 接口（多轮靠把历史拼进 message）
- 第一轮讲解的 prompt 与缓存桶 `reading-ai-explain-cache-v2`（改了会让老用户重复计费）
- 题库

## 1. 现有草稿：纯函数层

`lib/qa/questionQa.js` + `__tests__/question-qa.test.js`（17 个测试，已通过）。这是用户说「先写计划」之前起的草稿，只在本分支上，没开 PR。实施窗口可以在它上面改，也可以整层重写；无论哪样，§1.1 的问题都要解决，测试要保持绿。

| 导出 | 作用 |
|---|---|
| `QA_SYSTEM` | 追问的 system prompt：引用规则、不许改判答案、超纲说「材料里没有」、长难句拆法、陷阱类型名、纯文本（按 §1.1-c 改） |
| `QA_PRESETS` | 预设问题（按 §1.1-d 整组换掉） |
| `QA_MAX_TURNS` = 6 / `QA_MAX_MESSAGE_CHARS` = 24000 | 每题追问上限 / message 长度上限。历史从最早的开始丢，证据包不丢。24000 字全是中文时请求体约 72KB，低于 `/api/ai` 的 120000 字节上限 |
| `numberSentences(passage)` | 原文按段、按句编号 S1..Sn（切句用 `lib/tts/wavTools.splitSentences`） |
| `buildEvidence(detail, related)` | 拼证据包，返回 `{ text, sentences, materials }`。传了 `paragraphs` 会先用 `restoreParagraphBreaks` 补段。选句题的选项键（也叫 S1..Sn）一律换成句子原文并对回原文句号 |
| `pickRelatedMistakes(cards, {...})` | 从错题池取同小类（rdl / ap）、同题型的最近 3 道错题，本题自己的累计错次单独给（按 §1.1-a 改） |
| `askedEnglishTerm(question, sentences)` | 自由提问里只提到一个原文里出现过的英文词或短语时，返回它，拿去查词典 |
| `buildQaMessage({...})` | 拼本轮 message：材料 + 词典 + 第一轮讲解 + 之前的追问 + 选区 + 本轮问题 |
| `parseAnswer(text, sentences, materials)` | 把回答切成 text / quote / cite 段并校验（规则见 §4.3） |
| `citationStats(segments)` | 统计出处数、核不上的出处、核不上的引文，给测试和评估用 |
| `locateSentence` / `conversationKey` | 选中文字落在哪句 / 本题的会话存档键（按 §1.1-b 改） |

### 1.1 实施窗口的第一件事：修草稿

每一项都补测试。

**a. 「本题」的认定会认错**
- 现状：`pickRelatedMistakes` 只按题干认「本题」。但真题 RDL 有 12 个题干被 32 道题共用，例如 "What is the main topic of the article?" 就出现了 6 次。
- 后果：别的文章里同题干的题会被当成本题。它既从同类错题里漏掉，它的错次又被算到本题头上。
- 改法：
  - 认定条件改成「题干相同 **且** 正确答案原文相同」
  - 新增导出 `answerSignature(detail)`，口径和错题卡 `brief.correctAnswer` 完全一致（`lib/readingMistakes.js`）：选择题是 `${键}. ${选项原文}`，选句题是句子原文
- 测试：同题干、不同答案的两道题互不认作本题。

**b. 会话存档会串题**
- 现状：`conversationKey` 没带原文。另外，真题库的题目没有 `qid` 字段（AP 435 题、RDL 309 题全没有），生成库也只有约四成题有；而模考详情 `MockSessionDetail.js:350` 传的是 `qid: q.qid`，多数情况下是空的。
- 后果：存档键退化成「题干 + 作答 + 答案」。上面那 6 道同题干题只要作答相同，就会显示别篇文章的对话。
- 改法：
  - 存档键加原文签名：`shortHash(passage.slice(0, 400))`（`lib/mistakes/extract.js` 已导出 `shortHash`）
  - `MockSessionDetail` 的 qid 改成 `q.qid || \`${task.itemId}-q${i}\``，写法和另外三个入口一致。这一改顺带修了现有 AI 讲解缓存在模考详情里的同一个隐患。代价是模考详情里已缓存的讲解会失效一次。
- 测试：同题干、同作答的两篇文章，存档键不同。

**c. 超纲规则会误伤语法分析**
- 现状：草稿要求「材料以外的知识都标『非本题材料』」，而语法讲解本身就是通用知识。
- 后果：长难句、语法类的追问会被过度标注，甚至被拒答。
- 改法：在 `QA_SYSTEM` 写明两条：
  - 对原文句子做语法、词汇、句意分析属于本题范围，不用标注；只有原文里没有的**事实信息**（别的题、考试政策、作者背景）才算超纲。
  - 学生说明自己的思路时：先指出这条思路哪一步和原文对不上（标 `[S#]`），再给出正确的推理路径。

**d. 预设问题和第一轮讲解重复**
- 现状：第一轮讲解的 prompt 本来就要求讲「答案句在哪 + 选错的陷阱类型」（`useReadingAiExplain.js` 的 `SYSTEM`）。草稿里「为什么不选我选的」「答案依据在哪」两个预设等于花一次额度再问一遍。「这个词什么意思」又和划词词典重复。
- 改法：整组换成往深处走的三个：

| id | 按钮 | 行为 |
|---|---|---|
| `parse-key` | 拆解答案句 | 有选中句就拆选中的那句；没有就让 AI 先写出答案依据句是哪一句（`[S#]`），再讲主干和修饰关系。手机上不用先选句也能用 |
| `my-thinking` | 我是这么想的… | 不直接发送，而是在输入框预填「我当时选 X，是因为」，让用户补完思路再发。AI 指出哪一步和原文对不上。这就是你说的「纠正错误思路」，先落在单题上做。只在作答过的题上出现 |
| `simpler` | 讲简单点 | 用更简单的话把上一轮再讲一遍，可以配中文例子 |

**e. 生成库插入句题要给位置标号**
- 现状：生成库 AP 插入句题的 4 个位置在原文里都写成 `[■]`，选项写的是 "Slot 1 [■]"…"Slot 4 [■]"，模型只能自己数第几个。
- 改法：证据包里把第 n 个 `[■]` 写成 `[■n]`。真题用的是 `[A]`–`[D]`，不受影响（已核对）。

**f. 新增几个小工具**
- `numberSentences` 每句多带一个段内序号 `k`，界面上的出处标签要用（§4.3）。
- `wantsMistakeContext(question, presetId)`：只有 `presetId === "my-thinking"`，或者问题里匹配 `/错|不选|陷阱|思路|为什么.{0,6}选/` 时才返回 true。拆句、讲简单点这类问题不附历史错题，免得模型硬去联系。
- `plainText(answer)`：去掉 `**` 和行首 `#`。模型偶尔不听「纯文本」的要求，这一步兜底。

## 2. 第 2 步：先跑离线评估，再做界面

引用格式能不能被 deepseek 稳定遵守，是整个方案的前提。界面做完才发现不行就得返工，所以把评估提到界面之前。

- **前置**：这一步要花 DeepSeek 的钱，跑之前先在线程里问用户。按台账默认单价 ¥5.24/M tokens 估算，约 ¥2–4。
- **脚本**：`scripts/qa/eval-reading-qa.mjs`。
  - 调用走 `lib/ai/deepseekHttp.callDeepSeekViaCurl`，自动记台账。
  - 默认 `--dry-run`，只打印「将调用 N 次 / 预计 ¥X」；超过 `--max-calls`（默认 200）要加 `--yes`。
  - 要能在 Windows 上跑：不用 /tmp，路径用正斜杠。
- **抽样**：固定随机种子，抽 24 道真题：AP 16 道（含 2 道选句题、2 道插入句题），RDL 8 道。每道模拟一次错答（选一个干扰项），第一轮讲解用固定的占位文本。
- **问法**：每道问 4 个问题，共 96 次调用：
  1. 「拆解答案句」
  2. 「我是这么想的」，用模板生成一句错误思路
  3. 对一句原文问语法或句意，例如「这句的主干是什么」
  4. 一个故意超纲的问题，例如「这篇文章的作者是谁」
- **token 预算**：从 `AI_HELPER_MAX_TOKENS * 2` 起步。推理 token 也计入预算，上下文比第一轮讲解长；按 `lib/ai/client.js` 的注释，预算调大几乎不多花钱，空响应才是白花。
- **指标与建议及格线**：

| 指标 | 怎么算 | 及格线 |
|---|---|---|
| 出处有效率 | 有效出处 / 总出处 | ≥ 95% |
| 引文核实率 | 能在本题材料里找到的引文占比 | ≥ 95% |
| 超纲拒答率 | 问法 4 的回答含「材料里没有」 | ≥ 90% |
| 语法误拒率 | 问法 3 的回答含「材料里没有」 | ≤ 5% |
| 空回复率 | 回答为空或被截断 | ≤ 2%；超了就再加预算 |
| 疑似翻案 | 回答里出现「答案应为」「答案有误」这类说法 | 全部列出人工看，复核后应为 0 |

- **结果**：写到 `.ops/qa-eval/<日期>.json`，再出一页摘要。不达标就改 `QA_SYSTEM` 再跑，过线后才进第 3 步。

## 3. 第 3 步：hook `components/reading/useQuestionQa.js`

```js
const qa = useQuestionQa(detail, firstExplain);
// qa.turns  [{ q, a, presetId, selection, at }]
// qa.related（本会话的同类错题快照，存一份，不是每轮存）
// qa.loading / qa.error / qa.remaining / qa.ask(question, { presetId, selection })
```

**`ask` 的流程**
1. 以下情况直接返回：本题已满 6 轮、已到每日上限（见下）、上一问还没回来（同一面板同时只发一问）。
2. 判断要不要附同类错题：只有 `wantsMistakeContext` 返回 true 时才附。第一次需要时算一次，存进会话的 `related` 字段。这一步只读，**不调 `savePool`**：
   ```js
   pickRelatedMistakes(
     activeCards(mergeEntries(loadPool(), extractMistakeEntries(loadHist()?.sessions || [])).pool),
     { questionType, subtype, stem, correctAnswer: answerSignature(detail) },
   )
   ```
3. 词典：有选区就不查。没有选区时，`askedEnglishTerm(question, sentences)` 命中才 `await lookupWord(term)`；查不到按 `null` 处理，不挡提问。
4. `callAI(QA_SYSTEM, buildQaMessage(...), AI_HELPER_MAX_TOKENS * 2, 60000, 0.3)`。倍数以第 2 步的评估结果为准。
5. 成功：先过一遍 `plainText`，追加一轮并存档。
6. 失败：`error = mapAiHelperError(e)`。用户输入的问题留在输入框里不丢，不计轮数。
   - 服务端回 `PRO_DAILY_CAP` 时文案是「服务繁忙，请稍后再试」。这是有意为之：Pro 对外是「无限次」，这个文案**不要改**。

**存档**（每一处 localStorage 读写都包 try/catch）
- 键 `reading-qa-v1:<账号码或 guest>`，值 `{ [conversationKey]: { turns, related, updatedAt } }`。
- 两道上限：最多 100 个会话；序列化后不超过 100,000 字符（约 200KB）。超了就按 `updatedAt` 从最旧的开始淘汰。
  - 原因：单词本、错题池、游客的练习记录都把 localStorage 当真源。挤爆配额会让它们写不进去（`lib/vocab/vocabStore.js` 专门处理过配额失败）。
- 必须按账号分键：存档里有用户自己打的字。

**每日追问上限**
- **每天 30 轮（2026-10-12 用户拍板保留）**。Pro 的 `/api/ai` 每天总共 100 次（`app/api/ai/route.js` 的 `dailyLimit`），和写作批改共用，这个上限是为了保住写作批改。
- 计数存 localStorage，按账号和本地日期分键，只在成功时 +1。
- 到上限时提示「今天的追问已经很多了，明天再继续吧；写作批改不受影响」。文案里不出现「上限」二字。
- 这只是替用户保护自己的额度，不是安全措施。

**回归锁**：把新 hook 的路径加进 `__tests__/ai-empty-response.regression.test.js` 的 `CALL_SITES`（第 134 行起）。它会检查两件事：
- `await callAI(` 那一行里含 `AI_HELPER_MAX_TOKENS`。写成 `AI_HELPER_MAX_TOKENS * 2` 也能过，但必须和 `await callAI(` 写在同一行。
- 源码里不出现 `error: e.message`。

## 4. 第 4 步：组件 `components/reading/QuestionQaPanel.js`

### 4.1 挂载

- 挂在 `ReadingAiExplainBlock`（`components/reading/useReadingAiExplain.js`）里，在**讲解文本出现之后**渲染。两种外观都挂：
  - `variant="review"`：放在 `AiExplainView` 卡片下面，用同一套 INDIGO 色
  - 默认外观：放在蓝色讲解框下面，用同一套天蓝色（`#f0f9ff` / `#bae6fd` / `#0c4a6e`）
- 4 个入口共用这个 block，而且都传了 `includeCorrect`，所以答对的题也能追问：
  - 真题练习记录 `components/realBank/review/McqReview.js`
  - 练习历史 `components/reading/ReadingProgressView.js`
  - 阅读模考详情 `components/reading/MockSessionDetail.js`
  - 交卷后复盘 `components/reading/RDLTask.js`
- 不渲染面板的情况：
  - 非 Pro：block 已经返回 null
  - 本题没有原文（老记录）：`buildEvidence` 的 `sentences` 为空时不显示「继续追问」
- 4 个调用点的 `detail` 都补两个字段；`MockSessionDetail` 另外按 §1.1-b 补 qid：
  - `subtype`：练习记录、真题记录、模考里都存了 `details.subtype`，取 `details.subtype || "rdl"`，与 `lib/readingMistakes.js` 同源
  - `paragraphs`：有就传
- 4 个调用点都已经用 `data-no-dict` 包着这个 block，在 AI 回答里点词不会弹词典。

### 4.2 布局与交互

- **默认收起**：讲解卡片下面只有一个小按钮「继续追问」。本题有存档时显示「继续追问（已问 N 轮）」，点开就是之前的对话。
- **展开后从上到下**：
  1. **对话列表**
     - 用户的问题用右对齐的浅灰气泡
     - 回答左对齐、`pre-wrap`，**只按纯文本渲染**，不许 `dangerouslySetInnerHTML`
     - 出处渲染成小标（§4.3）
  2. **选区条**：只在有选区时出现（§4.4），显示「已选中："…"」、「拆解这句」和关闭按钮 ×。
  3. **预设 chips**：§1.1-d 那三个。
  4. **输入框 + 发送**
     - 1–3 行，placeholder 写「问这道题的任何问题，比如某句为什么这么说」
     - Enter 发送，Shift+Enter 换行
     - **输入法组字时（`e.nativeEvent.isComposing`）按 Enter 不发送**，中文用户一定会踩到
     - 手机上字号 ≥ 16px，避免 iOS 聚焦时放大页面
     - 等待回复时禁用发送
  5. **状态行**
     - 平时显示「还可以追问 N 次」
     - 加载中显示「AI 正在对照原文作答…」
     - 出错显示错误文案 +「重试」（重试不新增一轮）
     - 满 6 轮显示「这题聊得够多了，可以去错题本练一练」
  6. **页脚小字**：「回答只依据本题原文和你的作答；标『非本题材料』的是通用常识」，后面跟一个链接「这题有问题？上报」（§4.5）。
- **样式**
  - 内联 style
  - flex 里能伸缩的那一侧带 `minWidth: 0`（Conventions）
  - JSX 文本里不许写 `\uXXXX`（`encoding-hygiene` 测试会拦）
- **RDLTask 交卷后的高度**：答题区高度写死为 `calc(100vh - 290px)`，面板必须待在原本可滚动的题目栏里，不能撑高外层容器。

### 4.3 出处与引文的渲染（用 `parseAnswer` 的结果）

页面上的原文没有句子编号，用户看不懂「S3」。所以小标一律写成「第 2 段第 3 句」（全文只有一段时写「第 3 句」）。

| 段 | 渲染 |
|---|---|
| `cite` sentence，有效 | 小标「第 2 段第 3 句」；点击在这条回答下面展开或收起那句原文 |
| `cite` sentence，无效（句号不存在，或紧跟的引文不在这句里） | 灰色小标加「?」，title「这条出处核对不上，请以原文为准」 |
| `cite` answer / dict / mistake | 小标「答案」「词典」「错题1」；点「错题1」展开那道题的题干和当时的作答（取会话里的 `related`） |
| `quote`，无效 | 琥珀色虚下划线，title「这段引文在本题原文里找不到」 |

- 只要有无效项，回答下面就加一行灰字：「有 N 处出处或引文核对不上，已标灰，请以原文为准」。
- 点出处只在窗口里展开原句，第一期**不**滚动或高亮左边的原文。4 个入口的原文 DOM 各不相同，这件事留到后续期。

### 4.4 选区提问

- **监听**：面板展开时监听 `document` 的 `selectionchange`，加 100ms 防抖。满足以下全部条件才把选区记进面板状态：
  - 不在面板自身或输入框里
  - 至少 2 个英文词（单个词交给划词词典），总长不超过 600 字
  - 能在原文里找到：`locateSentence` 能对上，或者整段原文包含这段文字（允许跨句）
- **多个面板同时展开时**，只让最近一次点过或展开的那个接收选区，用一个模块级变量记住当前面板 id。
- **先存后用**：选区记进 state，所以点 chip 时浏览器清掉选区也不影响。
- **与划词词典共存**：`WordLookupLayer` 只对 60 字符、6 个词以内的选区弹词典，更长的直接放过，而且不清选区（已核对 `handlePick`），两者不冲突。短语选区会同时出现词典弹窗和选区条，属于预期行为。验证时再确认一次。
- **浮动入口**：手机是上下布局，用户在上面选了句子，面板可能在很下面，看不见。
  - 出现条件：有选区，且当前面板的输入区不在视口里（用 `IntersectionObserver` 判断）
  - 位置：屏幕底部居中，`position: fixed`，避开 `env(safe-area-inset-bottom)`
  - 内容：一个「问 AI：拆解这句」的小按钮，点了把选区交给当前面板、展开面板并 `scrollIntoView`
  - 这也接近用户最初说的「悬浮窗」
- **没有展开的面板时**不出这个按钮，因为不知道该问哪一道题。

### 4.5 上报「答案可能有误」

- **入口**：AI 回答里出现「可能有出入」时，这条回答下面出现「上报这题」按钮；页脚另有常驻的「这题有问题？上报」链接。
- **提交**：点了先弹一个小输入框，可以补充一句，再 `POST /api/feedback`，请求体 `{ userCode, content, page: location.pathname }`。
- **content 格式**：`[答疑上报] qid=… | 题干：前 200 字 | 标准答案：X | 作答：Y | AI 原话：前 300 字 | 补充：…`，总长 ≤ 2000（接口上限）。
- **限制**：接口有限流，提交失败要给出提示。
- **去向**：后台 `/admin-feedback` 能看到，不用建表。

## 5. 第 5 步：测试（全部 mock `callAI`，不花钱）

新建 `__tests__/question-qa.component.test.js`，写法参照 `__tests__/reading-mcq-ai-explain.component.test.js`（同样 mock AuthContext、sessionStore、ai/client）。要锁住：

- **显示门槛**：讲解出来后才有「继续追问」；非 Pro 看不到；没有原文时看不到。
- **请求内容**：点「拆解答案句」时，`callAI` 的 system 是 `QA_SYSTEM`，message 含 `[S1]`、`学生作答`、`【本题已给出的讲解】`。
- **「我是这么想的…」**：只预填输入框，不发请求；发出后 message 含 `[错题1]`（错题池里有同题型错题时）。
- **不附错题**：「拆解答案句」的 message **不含**同类错题。
- **出处渲染**：回答含 `[S2]` 时渲染成「第 x 段第 y 句」小标，点开显示原句；含 `[S9]` 时渲染灰标，并出现「核对不上」那行。
- **轮数与出错**：第 6 轮之后输入框禁用；`callAI` 抛错时显示错误、问题留在输入框、轮数不变。
- **存档**：卸载后重新渲染能读回；换一个账号码读不到；同题干、同作答的两篇文章互不串；超过 100,000 字符时淘汰最旧的。
- **输入法**：组字时按 Enter 不发送。
- **上报**：`fetch('/api/feedback')` 收到的 content ≤ 2000 字，且带 qid。
- **词典**：mock 掉 `lookupWord`，自由提问「anchor 在这里什么意思」时 message 含 `【词典】`。

推送前跑全量 `npm test`。

## 6. 第 6 步：真浏览器验证（CLAUDE.md 硬规则：挂真组件）

- 起 dev server，建临时页 `app/zz-probe/page.js`，import 真的 `McqReview` 或 `RDLDetail`，喂一条真题 AP 记录（选一篇带选句题的）。
- 用 Playwright 的 `page.route('**/api/ai', …)` 返回写死的回答，**不调真模型**，写法参照 `e2e/vocab-meaning-explorer.spec.js`。
- 要看的：
  - 桌面 1280 和手机 390 两种宽度下：展开、追问、点出处
  - 选句后的选区条和底部浮动按钮；划词词典照常弹出
  - 交卷后复盘页展开面板后，答题区不溢出视口
- 截图留给用户看，用完删掉 `zz-probe`。

## 7. 发版

- 只对 Pro 开放，不加 flag，要回退就回退提交。
- 不需要迁移，也不需要新 env；上报走现有 `/api/feedback`。
- 推送走 /ship，公告走 /release-notes。

**可选**：线上质量监控。在 `ask` 成功后把 `citationStats` 上报，可以持续看出处有效率，但要新建一张表（参照 `audio_events`，走 /sql-migrate）。第一期可以先不做。

## 8. 完成标准

- [ ] §1.1 的 6 项都改完并有测试
- [ ] 离线评估问过用户、跑过并过线；如果用户不同意跑，明确标为「未跑」
- [ ] 4 个入口都能在讲解下面展开追问；非 Pro、没有原文时看不到
- [ ] 出处显示为「第 x 段第 y 句」，能点开原句；核不上的标灰并有提示
- [ ] 选句提问在桌面和手机上都能用（手机有底部浮动按钮）；问到单词时 message 里带词典词条
- [ ] 只在问错因或思路时附同类历史错题；只读错题池，不写
- [ ] 每题 6 轮、每天 30 轮的上限生效；出错不丢输入；存档有体积上限
- [ ] 「上报这题」能提交到 `/admin-feedback`
- [ ] 第一轮讲解的 prompt 和缓存没变（`reading-mcq-ai-explain` 等现有测试不改也绿）
- [ ] `npm test` 全绿，真浏览器两种宽度截图通过，临时页已删

## 9. 留给后续期

- **听力四型**：用 transcript 跑 `numberSentences`，出处小标改成 ▶ 逐句点播。听力稿按说话人分行，编号能不能和 `sentence_timings` 逐句对上**还没核对**，接之前先核对。
- **CTW、拼句**：证据换成整篇填空和词块，再分别写 system prompt。
- **点出处时高亮左栏原文**：先把 4 个入口的原文渲染统一成带句级锚点的结构再做。
- **第一轮讲解也带出处**：要等评估证明引用稳定，再给讲解缓存换新桶。
- **方法 / 陷阱说明库**（设计稿 §9.5-3）：写好后按题型放进证据包，并在 `QA_SYSTEM` 里加 `[方法]` 出处。

## 10. 自审修订记录（2026-10-12，v1 → v2）

**必须改（不改会出错）**
1. 「本题」只按题干认，同题干的题会认错：真题 RDL 有 32 道题共用 12 个题干。→ §1.1-a
2. 会话存档会串到别篇文章：存档键不带原文；模考详情直接传 `q.qid`，真题没有这个字段，生成库也只有约四成题有。→ §1.1-b
3. 存档没有体积上限，可能挤爆 localStorage，连累单词本、错题池这些以它为真源的功能。→ §3「存档」
4. 预设问题重复第一轮讲解（讲解本来就讲定位和陷阱），白花额度。→ §1.1-d
5. 「这个词什么意思」和划词词典的 AI 语境释义重复。→ §0、§1.1-d
6. 超纲规则会误伤语法分析。→ §1.1-c

**建议改（体验或风险）**
7. 评估放在最后太晚。引用格式站不住，界面就得返工。→ 提到第 2 步，并加空回复率和语法误拒率两个指标。
8. 手机上选了句子后，面板可能在很下面看不见。→ §4.4 底部浮动按钮
9. 小标写「S3」用户看不懂。→ §4.3 改成「第 x 段第 y 句」
10. 「答案可能有出入」之后没有出口。→ §4.5 复用 `/api/feedback`
11. 每轮都附同类错题，会诱导模型硬去联系。→ 只在问错因或思路时附
12. 生成库插入句题的 4 个 `[■]` 没有标号。→ §1.1-e
13. 「接听力能直接对上逐句点播」说满了。→ §9 改成「先核对」
14. 每日 30 轮上限和 Pro「无限次」的宣传口径有冲突。→ 用户拍板保留 30 轮、提示文案措辞温和；并写明 `PRO_DAILY_CAP` 的现有文案不能改

**查过、没问题的攻击面**
- 4 个入口都传了 `includeCorrect`，答对的题也有讲解，也能追问。
- 4 个入口都用 `data-no-dict` 包着 block；`WordLookupLayer` 对超过 60 字符或 6 个词的选区直接放过、不清选区，选句提问不会和它冲突。
- `/api/ai` 请求体上限 120000 字节，24000 字的 message 全是中文也只有约 72KB。
- 练习记录、真题记录、模考里都存了 `details.subtype`，错题池按 rdl / ap 分桶可靠。
- 真题插入句原文里带 `[A]`–`[D]` 标记，和选项对得上。
- 真题 RDL 有 93/125 篇的材料以图片呈现，但每篇都有转写文字，证据包有原文可用。
- 追问走 `/api/ai`，计入每日用量；非 Pro 看不到。
