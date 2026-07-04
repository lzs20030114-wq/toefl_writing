# 个人题库全题型扩展 — 逐题型可行性研究与实施路线

> 2026-07-04 · 多 agent 调研(5 个题型/管线研究员 + 1 个盲区审查员,206 次代码取证)
> 状态:**纯研究,未动代码**。结论用于排期与产品拍板。
> 前作:USER-UPLOAD-QUESTIONBANK-RESEARCH-2026-06-23.md(P0 方案研究);个人题库 P0+图片识别已上线 main(2026-07-03)。

---

## 0. 结论先行(TL;DR)

1. **10 个待接题型全部能做**,没有一个是"做不了",只有"哪种上传形式该砍"。
2. **成本惊喜:几乎全程免费。** 听力音频走 edge-tts(免费,与主库默认一致)+ 失败自动降级浏览器 TTS;口语提示音本来就走浏览器 speechSynthesis(零成本);阅读/BS 无音频。唯一按量花钱的是 AI 抽取/复核(每题 ¥0.01-0.08)和口语练习时的 STT(与练全局题同价,已有配额闸)。
3. **接入比写作样板还简单**:除写作外所有练习页都是"同页解析、组件吃 prop",不需要 stashPromptSnapshot 快照交接,只要把个人题并进页面解析池。
4. **模考天然隔离**(三个 planner 全部构建期静态 import,mockExam 目录 grep personalBank 零命中);**错题本/历史记录全快照式**,个人题删了也不挂。
5. **要砍的形式**(每个都有明确理由):BS"单句 AI 自动造题"(distractor 塌陷+多解歧义,全局库用整个 gate 工程才压住)、CTW"真题截图还原"(OCR 出来无 ground truth,答案键和缺口长度都不可信)、听力"上传音频文件"(滥用面+版权+双倍工程,文字稿覆盖 90% 机经)、阅读"只给文章 AI 出题"(价值最低、机器味风险最高,AP insert_text 曾出过 140 条不可作答事故)。
6. **总排期约 3.5-4.5 周全部上线**,推荐顺序:口语+BS(第 1 周)→ 阅读(第 2 周)→ 听力(第 3-4 周)。
7. **上听力前有一个必做 spike**:edge-tts(@andresaya/edge-tts,出站 WebSocket)从未在 Vercel 函数里跑过,"导入时同步预渲染"方案建立在这个未验证前提上。

---

## 1. 逐题型裁决表

| 题型 | 上传形式(收什么) | AI 要干的活 | 答题形式 | 每题成本 | 工作量 | 砍掉什么 |
|------|----------------|------------|---------|---------|--------|---------|
| **连词成句 BS** | 真题三件套:A 的问句+B 的完整回应句+词块条(粘贴/截图) | 抽取(文本 prompt **已接线**,只差存库白名单!);distractor 用词袋差集**代码判定**;机械校验(词袋等式/前置词对齐),无 LLM audit | 现 BuildSentenceTask,practice 加「我的」分类卡,3-5 题短 batch 现有代码即支持 | ~¥0.01 | **M** 3-4 天 | 单句 AI 自动造题 |
| **阅读 AP+RDL** | 文章+题目,**答案可缺**(AI 代解+第二考官复核,不一致预览亮黄让用户裁决) | 抽取 prompt×2 新建;auditRDLItem **现成**(AP 穿马甲复用);AP 需多图上传支持 | 现 RDLTask(AP 就是字段适配的 RDLTask),practice picker 并入 | ¥0.02-0.08 | **M** 3-5 天(两题型一批) | 只给文章 AI 出题 |
| **阅读 CTW** | **贴原文自动挖空**(45-120 词英文段落) | 几乎零 AI:cTestBlanker 纯机械挖空(答案=原文,天然正确);可选 DeepSeek 清洗+audit 徽章 | 现 CTWTask,practice picker 并入 | ≈¥0 | **S** 1-2 天 | 真题截图还原 |
| **听力 LCR** | 一句口播提示+4 选项+答案(机经格式) | 抽取 prompt 新建;lcrAuditor 现成;**edge-tts 渲染口播句(免费)**存 user/{CODE}/ 路径 | 现 LCRTask,practice picker **现成**(四听力唯一) | ≈¥0(edge) | **S-M** 2-3 天(含听力共享基建) | 截图缺口播句时拒收 |
| **听力 LA** | 公告全文±题目(缺题 AI 补+audit) | 抽取+laAuditor 现成+edge-tts 整段(~45s 音频) | 现 ListeningMCQTask,**需先建 practice picker**(见§3 bug) | ≈¥0 | **S** 1-2 天增量 | — |
| **听力 LAT** | 讲座稿+题目(真题 500-800 词,校验要放宽) | 抽取+latAuditor+edge-tts 单说话人整段(长文分段拼接) | 同上 | ≈¥0(gpt 则 ¥0.2-0.54) | **S-M** 1.5-2 天 | — |
| **听力 LC** | 带说话人标记的对话稿("W:/M:")+题目 | 抽取(含 gender 标注)+**逐轮说话人预览确认 UI**+lcAuditor+generateConversation 双音色 | 同上 | ≈¥0 | **M** 2-3 天 | — |
| **口语 复述** | 贴 3-7 句英文(资料/讲义截图也行) | 拆句清洗;难度按词数**确定性计算**不用 AI;**零 TTS(浏览器 speechSynthesis)**;评分 LCS 纯前端 | 现 RepeatTask,套题打包,≥3 句成套 | ≈¥0.003 | **S** | "真题截图"话术(真题无屏显句子) |
| **口语 面试** | 贴 1-4 个英文面试问题 | 拆问+difficulty 标签;**评分管线已就绪**(interviewScorer 已 live,与题库解耦);评分 prompt 需加防注入前缀 | 现 InterviewTask,45s 录音+AI 四维评分 | 练习时 ¥0.13/session(STT+评分,同全局题价,配额已管) | **S-M** 2-4 天(两口语合并,重合过半) | — |

---

## 2. 关键架构决策(带证据)

### 2a. 听力音频:导入时同步 edge-tts 预渲染(首选)
- `/api/audio` 是**纯存量代理**不是 TTS(app/api/audio/[...path]/route.js:41 拼 Supabase 桶路径转发)——"零预渲染即时流"路线不存在现成通道。
- **AudioPlayer 的 TTS 兜底是最大 de-risker**(AudioPlayer.js:16-27,109-116):无 audio_url 或加载失败自动降级浏览器念 text。**音频生成失败永远不阻塞练习**,可以放心 best-effort。
- 首选方案:导入时同步 edge-tts(免费,mp3 直出免转码,主库默认 provider 也是 edge)→ 存 `listening_audio/user/{CODE}/{item_id}.mp3` → 自动获得 /api/audio 国内可达性(audioSrc.js:15 正则匹配桶内任意子路径)。
- 渲染时长:LA/LAT/LCR 单次调用安全;LC 逐轮 15-30 次串行调用贴 60s 上限,函数设 maxDuration=180。**不要在 Vercel 跑 openai persona 渲染**(串行链太长)。
- 备选砍掉:即时流 TTS 端点(每播重合成+开放免费代理风险);gpt-4o-mini-tts(音质投票未定 go,个人题没理由先用付费引擎)。

### 2b. 接入模式:同页解析池,不用快照
写作页(WritingTask 内部按 id 查静态库)才需要 stashPromptSnapshot;reading/listening/speaking/BS 都是页面解析后按 prop 传组件(reading/page.js:203-217、listening/page.js:168-169、speaking/page.js:127-130),**只需 `|| personalById.get(id)` 一行兜底**。

### 2c. 模考隔离与下游兼容(证据链)
- 三个 planner 全静态 import(readingPlanner.js:23-26、listeningPlanner.js:10-13、speakingPlanner.js:13-14);mockExam 目录 grep fetchPersonalBank/usr_ 零命中;写作模考不传 initialPromptId,快照读取条件短路(WritingTask.js:116-118)。
- 错题本三条管线全部 session 快照驱动零回查(readingMistakes.js:37-82、listeningMistakes.js:30-66、MistakeNotebook.js:22-57);口语历史 finishSession 把每句原文+transcript 全写 details(RepeatTask.js:320-327、InterviewTask.js:306-314)——**集成管线研究员称口语无快照是错的,盲区审查已裁决**。
- **守界规则**:个人题只进 practice picker,严禁进 standard 随机池(draft 恢复同步 find 会 race 丢草稿)、严禁往 planner 引 personalBank——固化为 review 规则。

### 2d. 存储层(所有题型共同前置)
1. **DB CHECK 约束**手动迁移:`ALTER TABLE user_question_banks DROP CONSTRAINT ... ADD CHECK (type IN (...))` 加全部新 type(建议按 subtype 粒度:build/ctw/rdl/ap/lcr/la/lc/lat/repeat/interview)。
2. `app/api/user-bank/route.js:9` VALID_TYPES 同步加(一处管 POST+GET)。
3. `lib/userBank/personalBank.js:39` 每题型补**真形状守门**(不能只判一个字段——任务组件按 gate 过的 live 形状写成,形状漂移直接崩组件)。
4. 16KB/条上限**全部够用**:实测最大 AP 6.6KB、LAT 5.9KB(真题级 LAT ~10-12KB 仍在限内);**音频永远不进 data 字段**,只存 URL。

---

## 3. 必修 bug 与安全补丁(接入前/接入时)

| # | 问题 | 证据 | 处置 |
|---|------|------|------|
| 1 | **听力 practice 选题器硬编码 LCR**,la/lc/lat 的 practice 链接是死端(选到 LCR 列表,解析必落"暂无题目") | listening/page.js:139-158 vs ListeningSectionContent.js:66 | 接听力个人题的前置——picker 本身就是挂载点;顺手给四子类分 done-key(现共用 LISTENING_LCR) |
| 2 | **文本抽取 prompt 零注入防护**(SAFETY_PREAMBLE 只在图片路径) | questionExtraction.js:22-99 无 untrusted 声明;文件头声明存量三 prompt 逐字冻结 | 存量不动(gate 校准冻结);**新题型 6+ 个文本 prompt 从第一天带 SAFETY_PREAMBLE** |
| 3 | **validateItem 不查 data 内字段** → 可直接 POST data.audio_url 指向任意外域,AudioPlayer 会塞进 `<audio src>`(泄 IP/伪造内容) | route.js:53-68 只查对象+16KB;audioSrc.js:21 非 Supabase host 原样返回 | 听力存库校验对 audio_url 做白名单(仅自家桶/相对路径),或服务端渲染后自己写 URL、拒收客户端提供的 |
| 4 | **DELETE 只删 DB 行,零 storage 清理** | route.js:151-181 | 听力接入时:DELETE 顺手删对象 + 夜间 routine sweep 对账 |
| 5 | **/api/audio immutable 缓存**(max-age=31536000) | route.js:63 | 个人题重渲染音频必须换文件名(带版本/随机后缀)回写 audio_url |
| 6 | **GET /api/user-bank 无 Pro 校验** + **BS 页无 Pro gate** → BS 上线后过期 Pro 可在免费页练个人题 | route.js:70-91;build-sentence 页 grep 无 tier | 做 BS 时拍板:接受(影响小)或给「我的」分类加 tier 判定 |
| 7 | **edge-tts 在 Vercel serverless 未验证**(只在本地/GH Actions 跑过) | package.json:31 仅 scripts/ 调用 | **上听力前先 spike**:部署一个测试函数合成 30s 音频验证 WS 出站+时长 |
| 8 | 双模第二考官**没有现成文本通道**(qwenVision.js:47 硬要求图片) | callQwenVision 纯视觉 | 新写 DashScope 文本 client(OpenAI 兼容,小活)或退化为 DeepSeek 注入 auditor(听力方案即此,现成) |
| 9 | Vercel 直连 OpenAI 属推断非证实(无 vercel.json,region 在 dashboard) | transcribe 已生产直连成功=最强旁证 | 写进听力/口语上线验证清单,不当结论 |

---

## 4. 推荐排期

**Phase 1(第 1 周):口语两题型 + BS** —— 最便宜、链路最短
- 口语 repeat+interview 一个 PR(S-M 2-4 天):零 TTS、评分管线已就绪、STT 配额已管;共享一次管道改造。
- BS(M 3-4 天):文本抽取**今天就是通的**(EXTRACTION_TYPES 已含 build,extract 路由已有分支),只差存库白名单+图片 prompt+练习页「我的」分类;判分纯客户端机械逻辑。
- 共同前置:DB CHECK 迁移一次做完(把后面全部 type 一并加上)。

**Phase 2(第 2 周):阅读 AP+RDL 一批 + CTW 顺手**
- AP+RDL(M 3-5 天):MCQ 漏斗(抽取+代解+复核+预览徽章)一次性基建,两题型平摊;AP 多图上传约占 1 天。
- CTW(S 1-2 天):纯机械挖空,基建就绪后的顺手活。

**Phase 3(第 3-4 周):听力 LCR → LA → LAT → LC**
- 先做 spike#7(edge-tts serverless)+ 修 bug#1(picker 死端)+ 安全补丁#3/#4。
- LCR 先行(picker 现成、结构最简、共享基建一次做完)→ LA → LAT → LC(说话人预览 UX 最重)。

---

## 5. 待拍板的产品决策

1. **听力音频引擎**:edge-tts 免费(推荐,与主库默认一致)vs gpt-4o-mini-tts(音质好,LAT 真题级 ¥0.54/题)?——语音投票结果出来前建议 edge。
2. **音频渲染防滥用帽**:建议每日 10-20 条(edge 免费也要防刷,Microsoft 端点会 429)。
3. **BS 页 Pro gate**(问题#6):接受泄漏还是补判定?
4. **阅读 AI 代解答案的呈现**:推荐 fail-open+标注("AI 生成答案"角标;audit 不一致亮黄让用户裁决,不静默改)。
5. **上传音频文件**:确认 v1 砍掉。
6. **排期顺序**:按上述三阶段,还是听力优先(用户价值可能更高但工程最重)?

---
---

# 附录:六份原始研究报告

(以下为各研究员原文,含全部代码证据)


## 附录 A:连词成句 BS

# 题型: 连词成句 Build a Sentence (BS)

## 1. 数据契约

**存储字段（live 库真实样例，`data/buildSentence/questions.json`）**——顶层 `question_sets[{set_id, questions[]}]`，单题：

```json
{
  "id": "cg_bs_s1_q1",
  "prompt": "Is the reading room open again?",
  "prompt_task_kind": "yesno",
  "prompt_task_text": "Is the reading room open again?",
  "answer": "You can study there until midnight now.",
  "chunks": ["can study", "there until", "midnight", "now", "did"],
  "prefilled": ["You"],
  "prefilled_positions": { "You": 0 },
  "distractor": "did",
  "has_question_mark": false,
  "grammar_points": ["present simple"],
  "difficulty": "easy"
}
```

- **无任何音频字段**（questions.json 全文 grep 无 audio/tts；`BuildSentenceTask.js` 无播放器）——纯文本拖拽题，TTS 完全不涉及。
- **difficulty 实际是可选的**：live 库 494 题中 300 题没有该字段；`lib/questionBank/buildSentenceSchema.js` 的 `validateQuestion`（71-269 行）从不校验 difficulty（只在 327 行导出 `DIFFICULTIES` 集合备用）。个人题可不带。
- **运行时派生字段不需要存**：`lib/questionBank/runtimeModel.js:201-227` `normalizeRuntimeQuestion` 从上述原始字段推导 `answerOrder`/`bank`(=answerOrder+distractor)/`givenSlots`/`responseSuffix`。存库契约就是原始字段。
- **schema 硬约束**（buildSentenceSchema.js）：词袋等式 chunks(去distractor)+prefilled == answer 的词（170-181 行）；distractor 单词且不在 answer 中（183-194 行）；prefilled_positions 与 answer 对齐（196-222 行）；对话连贯闸（113-144 行）。format 级（非致命）：有效 chunks 4-8 块（234-237）、answer 7-15 词（239-241）、chunk ≤3 词全小写（251-253）、悬浮副词孤块 fatal（243-258）。
- **体积**：实测 live 494 题平均 423 字节、最大 627 字节 vs `ITEM_MAX_BYTES=16KB`（`app/api/user-bank/route.js:11`），余量 25 倍以上，零风险。

## 2. 练习组件与选题路径

- **渲染组件**：`components/buildSentence/BuildSentenceTask.js`（UI）+ `useBuildSentenceSession.js`（会话）。hook 第 52 行 `questions || selectBSQuestions()`——**外部传入 questions 数组即完全绕开全局库**，第 53 行 `runtimeModel.prepareQuestions` 运行时校验（production 非 strict，坏题丢弃）。
- **不走 TopicPicker 的 prompt 列表**：BS practice 模式的"picker"是 `app/build-sentence/page.js` 内置的语法分类卡（`buildGrammarTopics` 32-60 行，基于静态 import 的 BS_DATA 第 13 行）→ `PracticeSetList` 按 `BATCH_SIZE=10` 切 batch（77、96-103 行），**slice 切法天然允许尾 batch <10 题**。live 库本身就有 6 个 9 题 set。
- **③的答案（最小 set 约束）**：exactly-10 约束只存在于全局 standalone 路径的 set 级风格闸（`validateQuestionSet` 的 qmark/distractor/embedded 配比，buildSentenceSchema.js:301-319），practice 传入路径**没有最小题数限制**（hook 仅在 0 题时报错，useBuildSentenceSession.js:54）。**个人题 3-5 道直接作为一个短 batch 开局，现有代码即支持，无需改动**。
- **需改文件**：
  1. `app/api/user-bank/route.js:9` `VALID_TYPES` 加 `"build"`（存库门）；
  2. `lib/ai/prompts/imageExtraction.js` 加 build 图片 prompt（见§4）；
  3. `lib/userBank/personalBank.js:39` fetch 过滤加 build 分支（如 `!!d.answer && Array.isArray(d.chunks)`）；`mapPersonalToPicker` 可不用（BS 不走 TopicPicker）；
  4. `app/build-sentence/page.js`：Stage 1 分类卡里加"我的题库"卡 + `questionsForCategory` 分支返回个人题——注意现有函数是同步静态 import，个人题要仿 `app/academic-writing/page.js:45` 的 useEffect 异步 fetch 改造。**不需要 stashPromptSnapshot**：BS practice 是同页 state 传递（page.js:213-225），无跨页交接问题；
  5. `components/userBank/MyBankImporter.js`：TYPE_GROUPS 第 28 行翻 `live:true` + 补 stored/practice/placeholder；`isValid`（75-77 行）、预览渲染（503-520 行）、已存列表 label（550-552 行）三处都是 email-vs-academic 二元分支，要各加 build 第三分支。
- **记录/错题/模考影响**：历史 `saveSess` 存的是逐题快照（prompt/userAnswer/correctAnswer/grammar_points，useBuildSentenceSession.js:249-263），不依赖 bank 回查，个人题天然兼容；done-set 只写整数 `__sourceSetId`（229-235 行 `Number.isInteger` 过滤），个人题没有该字段→不污染全局进度；「从历史重练」`lib/history/retry.js:11-15` 的 `retryPath` 对 bs 返回 ""（本就不支持 BS 重练），零影响；**模考不受影响**——`components/mockExam/MockExamMainPanel.js:71-77` 渲染 BuildSentenceTask 时不传 questions，走全局 `selectBSQuestions`，个人题进不去。

## 3. 上传形式建议（回答①）

**结论：只支持 (a) 真题三件套，砍掉 (b) 单句自动造题。**

- **(a) 真题截图/文本（A 的问句 + B 的带空格回应 + " / " 分隔的词块条）**：最科学。chunks 切分和 distractor 是出题人给定的，AI 只做转写，`SYSTEM_PROMPTS.build`（`lib/ai/prompts/questionExtraction.js:52-99`）就是按这个 TPO 3-part 格式校准的，且已逐字冻结（该文件头注释 9-10 行：gate/回归按此措辞校准，勿改写）。
- **(b) 只给一句英文答案 → AI 切块+造 distractor**：强烈建议砍。理由：①distractor 质量是全局管线花了整个 difficulty-fix + gate 工程才稳住的（全局库曾退化成 99.6% 塌向单一助动词）——prompt 里的 DIVERSITY RULE（questionExtraction.js:96）是 **batch 级**约束，个人题单题导入没有 batch 可约束，塌陷概率更高；②AI 自切 chunks 极易造出多解排序题，`evaluateBuildSentenceOrder` 判错会被用户当 bug；③重造一条造题管线 = 重踩全部坑，与"导入自己的题"的产品定位不符。
- **AI 可代劳补齐的字段**：`prefilled_positions`、`has_question_mark`——已由服务端 `postProcessBuild` 机械补算（questionExtraction.js:105-141），AI 不数下标；`grammar_points` 打标（prompt 已要求）；**distractor 判别其实可以不信 AI**：tiles 词袋 − answer 词袋的差集就是 distractor，纯代码可反推（词袋等式校验 buildSentenceSchema.js:170-181 同一逻辑），建议代码判定优先、AI 输出仅作兜底。
- distractor 缺失合法：schema 只在存在时校验（183 行 `if (distractor)`），live 库 13/494 为 null——用户题没干扰项也能存。

## 4. AI工作清单

- **抽取 prompt：不用新建（文本路）**。`SYSTEM_PROMPTS.build` + `postProcessBuild` 已接线到 `/api/user-bank/extract`：`EXTRACTION_TYPES=["academic","email","build"]`（questionExtraction.js:145），route 已有 build 分支（`app/api/user-bank/extract/route.js:131-133`）。**文本粘贴路径今天就是通的，只是存库 VALID_TYPES 拦着**。
- **需新建（图片路）**：`IMAGE_EXTRACTION_PROMPTS.build`——`lib/ai/prompts/imageExtraction.js` 目前只有 academic/email（18-58 行），`SUPPORTED_IMAGE_TYPES=Object.keys(...)` 导致 build 图片在 `extract-image/route.js:58` 被拒；但该 route 的 build postProcess 分支已预留（100-102 行，注释明说"为将来兼容"）。照 `SAFETY_PREAMBLE` 注入防护范式写一个与 SYSTEM_PROMPTS.build 同形输出的图片 prompt 即可。
- **第二考官 audit：不需要 LLM**。BS 正确性可全机械校验：存库前跑 `validateQuestion` fatal 级（`lib/questionBank/buildSentenceSchema.js`）+ `runtimeModel.prepareQuestions` strict（runtimeModel.js:293，其 288 行的 answer 重建等式是"这题在组件里能不能玩"的最终裁判）+ `hasAmbiguousArrangements`（runtimeModel.js:170-199）作歧义警告。跳过 set 级 `validateQuestionSet`（配比闸对 3-5 道个人题无意义）。预览页展示重建句让用户自证——用户是自己题目的 ground truth。
- **TTS：¥0，不适用**（无音频字段，见§1）。
- **Gate：建议跳过，论证如下**——`lib/gate/`（gateHarness + gate-registry）和 `scripts/bs-difficulty-scorer.mjs` 是**生成管线的防退化闸**，derive-from-real-only、作用点在 merge/出题（gate-registry.js 头注释），不在运行时；个人题影响面=单用户自己；用户上传的多半就是真题（即 gate 的 real corpus 那一侧，拿生成退化标准去拦真题是本末倒置）；且 scorer 的 set 级 ETS 风格配比对 3-5 题无意义。运行时已有 prepareQuestions 兜底丢弃坏题（useBuildSentenceSession.js:53）。保留 validateQuestion(fatal)+prepareQuestions(strict) 作存库门即可。

## 5. 成本与风险

- **边际成本/题**：一次 DeepSeek 抽取（temperature 0.1、max_tokens 4096，extract/route.js:51-60）≈千级 token，按项目成本口径可忽略（~¥0.001-0.01）；截图路一次 Qwen-VL；无 TTS。限流已就位（extract 20/min、extract-image 10/min）。存储 ~0.5KB/题。
- **质量风险**：①最大风险=如果放开 (b) 模式，distractor 塌陷+多解歧义必然重演（见§3）→砍掉即消除；②真题截图 OCR 把 " / " 分隔的 tiles 切错→词袋 fatal 校验必拦（buildSentenceSchema.js:179），失败提示改用文本粘贴（当前 importer 预览只勾选不可编辑）；③用户自带的非标题（answer <7 或 >15 词、chunk >3 词）会触发 format 级警告——建议 format 只警示不拦截，fatal 才拒存，否则真题边缘样本被误杀（schema 注释 88-93 行就记录过 prefilled 长度规则误杀真题的教训）；④音质风险不存在。
- **体积风险**：无（0.5KB vs 16KB）。
- **进度风险（小）**：practice 进度按 `categoryId::batchIdx` 存 localStorage（page.js:83-93），个人题删题后 batch 重排——已有 `questionIds` 一致性校验兜底（page.js:221），进度失效但不错乱。

## 6. 可行性结论

**能做，且是所有未上线题型里链路最短的**：文本抽取 prompt、postProcessBuild、extract 两条 route 的 build 分支全部已提前铺好；无音频、无 AI 评分、判分纯客户端机械逻辑；practice 短 batch 天然支持 3-5 题开局。

**最科学做法**：只收"真题三件套"（A 句 + B 完整句 + 词块条），文本粘贴 + 截图两路；distractor 用词袋差集代码判定优先；存库门 = validateQuestion(fatal) + prepareQuestions(strict) + 歧义启发式警告；练习入口 = BS practice 分类卡新增"我的题库"（同页 state 传递，不动 stashPromptSnapshot）；跳过生成 gate。**砍掉"单句 AI 自动造题"模式**——它把全局管线用整个 gate 工程才压住的 distractor/歧义风险原样引入，且单题导入没有 batch 级多样性约束可依托。

**工作量：M（约 3-4 天）**。服务端 ~0.5 天（VALID_TYPES + image prompt + 存库校验接线）；前端 ~1.5-2 天（MyBankImporter 三处 build 分支 + 翻 live；build-sentence 页个人分类 + 异步 fetch 改造）；回归测试 ~1 天（schema 边界、歧义题、移动端拖拽、mock 隔离验证）。

---

## 附录 B:阅读 CTW / RDL / AP

# 题型: CTW（单词补全 Complete the Words）

## 1. 数据契约
Live 库 `data/reading/bank/ctw.json`（558 条，顶层 `{version, generated_at, items}`）。单条精确字段（实测首条）：

```json
{
  "id": "ctw_1780330553041_543425",
  "passage": "Clownfish and sea anemones form ...",   // 完整原文（含答案）
  "word_count": 72,
  "topic": "biology", "subtopic": "symbiosis",
  "blanks": [ { "position": 14,               // passage 按空白分词后的全局词序号
                "original_word": "small",      // 答案（判分依据）
                "displayed_fragment": "sm",    // 给出的前半截
                "word_index_in_sentence": 1, "sentence_index": 1 }, ... ],  // 恰好 10 个
  "blank_count": 10,
  "first_sentence": "...",                     // 首句完整保留（C-test 规则）
  "difficulty": "medium",
  "blanked_text": "... The sm___ fish hi___ ..."  // 展示用（组件其实自己重算）
}
```
- 无音频字段，纯文本。
- 有 `difficulty`（easy/medium/hard），但个人题可默认 "medium"——练习页不按难度选题，难度只在模考路由用，而个人题不进模考（见下）。
- 体积：max 2733B / avg 2368B（实测全库），远低于 16KB 上限（`app/api/user-bank/route.js:11` ITEM_MAX_BYTES=16384）。
- 关键耦合：`CTWTask.renderPassage` 把 `item.passage` 按 `\s+` 分词、用 `blank.position` 做全局词索引定位（`components/reading/CTWTask.js:98-113`），判分是 `fragment+用户输入 === original_word` 严格串比（`CTWTask.js:78-81`），缺口长度=`original_word.length - fragment.length`（`CTWTask.js:111`）。**所以 passage/blanks/position 三者必须由同一段机械代码产出，不能让 AI 手填 position。**

## 2. 练习组件与选题路径
- 渲染组件 `components/reading/CTWTask.js`（灰底 chip 展示 `displayed_fragment` 前缀 + inline input，自动跳焦已按防呆修复保留 Tab/Enter 跳转 `CTWTask.js:63-72`）。
- 选题：`app/reading/page.js`，practice 模式走 `TopicPicker`（`page.js:181-199`，item 由 `buildCTWTopics()` 从静态 bank 构建 `page.js:84-91`）；非 practice 是话题多样性随机（`page.js:42-46`）。
- **与写作页不同：reading 页在同一组件里自己按 id 从静态数组 resolve item（`page.js:203-217`），CTWTask 接的是完整 item 对象** ——所以个人题接入甚至不需要 `stashPromptSnapshot`（`lib/history/retry.js:39`），只要在 page.js 里加一个 `personalById.get(pickedItemId)` 的兜底查找即可（比 `app/academic-writing/page.js:71-75` 的快照交接更简单）。
- 需改文件：
  - `lib/userBank/personalBank.js:21-43`（fetchPersonalBank 的 type 白名单+per-type 有效性过滤 line 39）、`mapPersonalToPicker`（line 46，CTW 用 first_sentence 当 title 对齐 `page.js:88`）；
  - `app/reading/page.js`：picker items 前拼个人题 + resolve 兜底 + `saveReadingSession` 无需改（details 里存的是 passage/blanks 快照，`page.js:258-267`）；
  - `app/api/user-bank/route.js:9` VALID_TYPES 加 `"ctw"`；
  - `components/userBank/MyBankImporter.js:34` 翻 `live:true` + 补 stored/practice/placeholder + CTW 预览渲染 + 客户端 isValid。
- 下游零影响：模考 `lib/mockExam/readingPlanner.js:23-26` 只 import 静态 bank；错题本 `lib/readingMistakes.js` 从 session details 快照提取（文件头注释），与题库无关；历史"再练一遍"只支持 email/discussion（`lib/history/retry.js:10-14`），reading 本来就没有；done 标记用 `usr_` 前缀 id 不会污染全局 done-set（`lib/userBank/personalBank.js:9-11`）。

## 3. 上传形式建议（两种来源分开评估）
**(b) 用户只给一段完整文章 —— 强烈建议先做，且几乎零 AI 风险。**
挖空是纯机械规则：`lib/readingGen/cTestBlanker.js:applyBlanking`（首句不动、第2句第2词起隔词挖、偶数长度砍一半/奇数留 floor(len/2)、跳过单字母词、恰好10空，文件头注释 1-14 行 "This is pure mechanical code — no AI involvement"）。用户贴 45-120 词的英文段落（`ctwValidator.js:77-81` 下限 45 词/上限 120 警告），服务端跑 `processPassage`（`cTestBlanker.js:169-199`）直接产出完整 item——**答案天然正确（就是原文），无歧义引入方**。歧义只来自规则本身砍出的短 fragment（如 `t__`），用 `validateCTWItem` 的 single-char fragment 警告（`ctwValidator.js:183-189`）+ 可选跑一次 `auditCTWItem` 兜底。topic/subtopic 可让 DeepSeek 顺手分类（或直接留 "other"）。

**(a) 真题截图（空已挖好+给前半截）—— 建议降级或砍掉。**
真题回忆料的实际形状见 `data/realExam2026/reading/completeTheWords.json` 首条：只有 `paragraph`，OCR 出来是 `"Th can cha landscapes thr processes li erosion a deposition"` —— **没有答案、没有缺口长度信息**（连下划线都丢了）。要入库必须让 AI 反向还原每个全词（"Th"→They? The? This?），还原错一个词 = 答案键错 + 缺口长度错（渲染的 input 长度都不对，`CTWTask.js:111`）。这正是全局库踩过的"歧义空"坑的放大版：`answerAuditor.js:auditCTWItem`（line 205-265）里 AI 答案与 fragment 前缀相容即记 critical，而这里连 ground truth 都没有，audit 变成"两个 AI 互相点头"。若一定要做：Qwen-VL 还原 + DeepSeek 独立还原，逐空双模一致才收，任何不一致的空在预览里强制用户手输全词——工作量 M 级、体验割裂。**结论：CTW 只上 (b)，(a) 砍掉，引导用户"贴原文自动挖空"。**

## 4. AI 工作清单
- 新抽取 prompt：**几乎不需要**。(b) 路线粘贴=拿原文直接跑 cTestBlanker（可加一个极轻的 DeepSeek 调用做"清洗+topic 分类"，复用 `lib/ai/prompts/questionExtraction.js` 的 SYSTEM_PROMPTS 注册表模式，line 22/145 加 'ctw'）；截图=Qwen-VL 纯转写文章（`lib/ai/prompts/imageExtraction.js` 加一个带 SAFETY_PREAMBLE line 16 的转写 prompt），转写后仍走机械挖空。
- 答案生成：无（原文即答案）。
- 第二考官 audit：可选，同步跑 `auditCTWItem`（1 次 DeepSeek 调用，~5-10s，temperature 0.1 `answerAuditor.js:42`），critical(歧义空)>0 时预览里标黄让用户换文章；也可以只跑免费的 `validateCTWItem` 警告。
- TTS：无，¥0。
- 复用校验器：`lib/readingGen/cTestBlanker.js`（挖空）、`lib/readingGen/ctwValidator.js`（词数/句数/FK/空质量/第一人称硬错误）、`lib/readingGen/answerAuditor.js:auditCTWItem`（可选）。

## 5. 成本与风险
- 边际成本：机械挖空 ¥0；可选 DeepSeek 清洗+audit 各 1 call（~1-2k tokens）≈ ¥0.01/题以内；截图路线 Qwen-VL 1 call ≈ ¥0.01-0.02/图。无 TTS。
- 质量风险：低（(b) 路线答案=原文）。剩余风险=机械规则在用户文章上产出歧义空——已有 validator 警告 + auditor 检测，现行 merge 门对 criticalFlags>0 是拒收的（`scripts/merge-staging.mjs:116-118`，注：记忆里的 audit-bank.mjs 已不存在，现行入口是 merge-staging 的 auditReadingItems line 91-123）。个人题不必这么严：预览警示即可。
- 体积风险：无（~2.4KB/题 vs 16KB）。

## 6. 可行性结论
**能做，且是三题型里工程最省的。** 最科学做法：只做"贴原文自动挖空"（来源 b），服务端 cTestBlanker+ctwValidator 同步跑（毫秒级，不占 maxDuration），auditCTWItem 做成预览页的可选异步复核徽章。砍掉真题截图还原（来源 a）：无 ground truth、答案键不可信、缺口长度都无法确定，防呆修复刚清完的歧义坑不要再挖开。工作量 **S（1-2 天，若排在 RDL/AP 之后共享基建则更少）**。

---

# 题型: RDL（日常阅读 Read in Daily Life）

## 1. 数据契约
Live 库分两池（`app/reading/page.js:14-20` 注释）：`rdl-short.json`（385 条，每条 2 题，顶层带 `variant:"short"`）、`rdl-long.json`（210 条，每条 3 题）。旧 `rdl.json`（8 条）已弃用。单条字段（rdl-short 首条实测）：

```json
{
  "id": "rdl-short_mpveuehk_0",
  "genre": "flyer",                    // 枚举见 rdlValidator.js:15-19（email/notice/menu/...14种）
  "variant": "short",
  "text": "USED TEXTBOOK SALE! ...",   // 30-70词(short) / 50-300词(long)，rdlValidator.js:52-64
  "format_metadata": { "title": "...", "issuer": "..." },  // 可空对象；title 用作 picker 标题 page.js:97 与任务页 heading RDLTask.js:133
  "questions": [ { "question_type": "detail",        // 枚举 rdlValidator.js:21-23
                   "stem": "...",
                   "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
                   "correct_answer": "A",
                   "explanation": "..." } ],          // 提交后展示 RDLTask.js:311-320
  "difficulty": "easy"
}
```
- 无音频。体积 max 1532B(short)/4162B(long)，16KB 无压力。
- `difficulty` 存在但个人题可默认；练习选题不用它。

## 2. 练习组件与选题路径
- 组件 `components/reading/RDLTask.js`：左文右题、一次一题、全答完 Submit（文件头注释 8-14 行）。消费字段=`text`、`format_metadata.title/subject`、`questions[].stem/options/correct_answer/explanation`，vocab 题会在原文里高亮目标词（`RDLTask.js:46`，`lib/reading/vocabHighlight.js`）。
- 选题：practice 走 TopicPicker（`page.js:184` `buildRDLTopics(variant)`），URL 带 `?variant=short|long` 分池（`page.js:24-26`）。个人题归池建议按 `questions.length===2 → short else long` 分类，或两个 picker 都并入、resolve 用 personalById 优先。
- 需改文件与 CTW 同一批（personalBank.js / reading/page.js / user-bank route VALID_TYPES / MyBankImporter），外加 MCQ 预览渲染。
- 下游：错题本按 session details 里的 questions 快照工作（`lib/readingMistakes.js` 头注释）、模考不受影响（同 CTW）。record 保存 `page.js:249-273` 原样可用。

## 3. 上传形式建议
- 最少输入：**一段日常文本 + （可选）题目和答案**。三档：
  1. 全套（文+题+答案键）→ 抽取还原 + audit 复核用户答案；
  2. 文+题无答案（最常见，回忆料多这样）→ AI 代解答案（见 §4）；
  3. 只有文章 → AI 出题（=把全局生成管线 `lib/readingGen/rdlPromptBuilder.js` 搬进用户流），价值最低、机器味风险最高，建议第一期不做。
- 真题截图：RDL short 一屏能装下，走 extract-image 单图即可；`format_metadata.title` 缺失时 AI 从文首推断或留空（picker 会 fallback 到 firstLine，`page.js:97`）。
- 用户自造素材（英文邮件/通知等）：同档 2/3 处理。

## 4. AI 工作清单
- 新建抽取 prompt ×2：`questionExtraction.js` SYSTEM_PROMPTS 加 `rdl`（文本粘贴），`imageExtraction.js` IMAGE_EXTRACTION_PROMPTS 加 `rdl`（沿用 SAFETY_PREAMBLE line 16 注入防护），目标形状=上面 bank item（correct_answer 允许 null）。
- **答案代解 + 第二考官（核心问题①的答复）**：现成的 `answerAuditor.js:auditRDLItem`（line 64-150）就是完整方案——DeepSeek 不看标记答案独立作答（buildAnswerPrompt line 152-177，temp 0.1）+ 无原文可猜性测试（line 179-199）+ ANSWER_MISMATCH/GUESSABLE/AMBIGUOUS 三类 flag。用户无答案时：第一遍解答=答案键，第二遍换模型（DashScope qwen 系，仓库已有 `lib/ai/qwenVision.js` 的 DashScope 通道）做真正独立复核；同模型跑两遍 temp 0.1 相关性太高，不算第二考官。RDL 难度低（campus 通知/传单类 detail/vocab 题），双模一致率预计很高，一致→直接入库，不一致→预览标"⚠需人工确认"让用户自己选。
- **怎么跑（同步/异步）**：同步、但放在预览阶段而非 extract 里。extract 先快速返回题目（现 `app/api/user-bank/extract/route.js` maxDuration=180 line 16），前端预览时逐题并行调一个新的轻端点（如 `/api/user-bank/verify`，每次 1 item、1-2 个 AI call、~10-20s），预览卡上出 ✓/⚠ 徽章。这样单函数不超时、失败可单题重试、用户能边看边等。没有异步 worker 基建（GH Actions 是 admin 管线），不要为此新建。
- TTS：无，¥0。
- 复用校验器：`lib/readingGen/rdlValidator.js`（词数/题数/选项完整性/correct_answer∈ABCD 等 line 35-120，schema 级错误可直接拦）、`answerAuditor.js:auditRDLItem`。

## 5. 成本与风险
- 边际成本：抽取 1 call + 解答 1 call + 复核 1 call（DeepSeek/Qwen 各 ~1-3k tokens）≈ **¥0.02-0.05/题**；图片再加 Qwen-VL ~¥0.02。无 TTS、无存储大件。
- 质量风险：**AI 代解答案错 → 用户被判错分**，这是唯一实质风险。RDL 层面（简单事实/词汇题）双模一致过滤后残余错误率估计 <2-3%；配"AI 生成答案"角标 + explanation 展示（RDLTask 已渲染 line 311-320）+ 预览可改答案，可接受。GUESSABLE 警告对个人题可忽略（不是出题质量管控场景）。
- 体积风险：无。

## 6. 可行性结论
**能做。** 流程=抽取（correct_answer 可空）→ rdlValidator schema 拦截 → 预览逐题 verify（无答案则代解+跨模型复核，有答案则 audit 复核）→ 入库。与 AP 共用 90% 代码（同组件、同 auditor、同预览 UI），**强烈建议 RDL+AP 一批做，合计 M（3-5 天）**；单做 RDL 也是 M 下限（3 天）。不建议第一期做"只给文章 AI 出题"档。

---

# 题型: AP（学术短文 Academic Passage）

## 1. 数据契约
Live 库 `data/reading/bank/ap.json`（318 条）。单条字段（首条实测）：

```json
{
  "id": "ap_mpveuehi_0",
  "topic": "physics", "subtopic": "fluid dynamics",
  "passage": "Fluid dynamics, ...",       // 110-230词硬门，apValidator.js:72-74（真题 150-210）
  "paragraphs": ["...", "...", "..."],     // passage 按段重复一遍（2-5段，apValidator.js:76-78）
  "difficulty": "medium",
  "questions": [ { "question_type": "vocabulary_in_context",  // 9种枚举 apValidator.js:12-18（含 insert_text/reference）
                   "stem": "The word \"varies\" in paragraph 1 ...",
                   "options": {"A":"...","B":"...","C":"...","D":"..."},
                   "correct_answer": "A",
                   "explanation": "..." } ]  // 必须恰好5题，apValidator.js:85-87
}
```
- 无音频。体积 max 6651B / avg 5434B（passage+paragraphs 内容重复近乎翻倍），仍远低于 16KB；个人题的 `paragraphs` 可服务端由 `passage.split(/\n\n+/)` 派生，用户/AI 不用给。

## 2. 练习组件与选题路径
- **没有独立 AP 组件**：AP 复用 RDLTask，page.js 做字段适配 `{...item, text: item.passage, genre: item.topic}`（`app/reading/page.js:277-290`）。所以个人 AP 题只要满足 bank 形状，渲染路径与 RDL 完全一致。
- 选题：practice TopicPicker（`buildAPTopics` `page.js:102-109`，title=passage 首行）。done-key 注意：`DONE_STORAGE_KEYS.READING_AP` 在 `lib/questionSelector.js` 里不存在，page.js 用字面量 `"toefl-reading-ap-done"` 兜底（`page.js:182,271`）——接入时顺手补注册表即可。
- 需改文件：与 RDL 完全同一批。stem 里的"paragraph 1"引用要求 passage 保留段落结构，抽取 prompt 需强调保留 `\n\n`。
- 下游（模考/错题本/历史）：同 RDL，零影响。

## 3. 上传形式建议
- 最少输入：**passage 全文 + 5 道题**（答案可缺，AI 代解）。真题回忆料（AP 是回忆卷里最完整的题型）通常自带答案键 → 走"audit 复核"档。
- 真题截图：**AP 一屏装不下是主要摩擦点**——passage 150-210 词 + 5 题四选项常跨 2-3 张截图，而 `extract-image` 现在单图单调用（`app/api/user-bank/extract-image/route.js:56` 单 `image` 字段，`route.js:82` 传单个 dataUrl 给 callQwenVision，参数名 imageUrls 暗示底层可扩数组）。方案：支持一次多图（客户端已有下采样 `MyBankImporter.js:80-107`，3 张 ×1600px jpeg 仍在 4MB body 内），或引导"文章一张、题目一张"分两次抽取再合并——推荐前者，改动集中在 route + MyBankImporter 上传控件。
- 用户自造素材（只有一段学术文）：需要 AI 出 5 题=搬 `lib/readingGen/apPromptBuilder.js` 进用户流，出题+审计链路长、insert_text 类题全局库都出过 140 条不可作答的事故（product review 记忆），**第一期砍掉，只收"文+题"**。

## 4. AI 工作清单
- 新建抽取 prompt ×2（文本/图片），目标形状同 bank item；`insert_text` 题若原图带方块符号▪，要求转写保留，否则该题标记不可用。
- 答案代解+第二考官：同 RDL，复用 `auditRDLItem`（merge 管线就是这么干的：AP 映射 `passage→text` 复用 RDL auditor，`scripts/merge-staging.mjs:103`）。差异：AP 的 inference/negative_factual/rhetorical_purpose 题 AI 解题错误率高于 RDL，**用户无答案时双模不一致的比例会明显更高**，预览"待确认"档要做好；用户有答案时 audit 只做警示不阻断（用户的答案键可能就是对的而 AI 错）。
- 跑法：同 RDL——extract 同步返回，预览阶段逐题 verify 端点并行复核（每 item 5 题一次 call，~15-25s，60-180s maxDuration 内安全）。
- TTS：无，¥0。
- 复用校验器：`lib/readingGen/apValidator.js`（词数 110-230 硬门 line 72-74、恰 5 题 line 85-87、选项/答案枚举 line 107-119）。注意：**apValidator 的词数硬门对个人题要放宽为警告**——用户搬来的旧 TPO 长文（300+词）会被 110-230 拦死，但那是"防生成退化"口径，不是"用户想练什么"口径。
- 复用 answer audit（问题①总结）：可靠度=DeepSeek 独立作答与标记答案一致性；全局管线用它 fail-closed（`merge-staging.mjs:116-118` criticalFlags>0 拒收）。个人题建议 fail-open+标注：一致→静默通过；不一致→黄标"AI 复核不一致，点击查看两方理由"，让用户裁决。

## 5. 成本与风险
- 边际成本：抽取 1-2 call（多图）+ 解答/复核 2 call ≈ **¥0.03-0.08/题**（5 题一 item，token 量约 RDL 的 2-3 倍）；无 TTS。
- 质量风险：AP 是三者中答案代解最不可靠的（推断类题），残余答案错误率估计 3-8%（无用户答案键时）；靠双模一致 + 预览人工裁决压到可接受。第二风险=多图截图拼接漏段导致"paragraph 2"引用错位——抽取后跑一个"stem 引用的段号 ≤ paragraphs.length"检查（apValidator 已查 stem 结构，段号一致性需补 10 行）。
- 体积风险：无（6.6KB max，即使 300 词长文+5 题也 <10KB）。

## 6. 可行性结论
**能做，和 RDL 必须一批做（同组件 RDLTask、同 auditor、同预览、同端点，边际成本≈0）。** 形式上：收"文+题（答案可缺）"，砍"只给文章 AI 出题"；截图路径补多图支持。工作量并入 RDL 批次共 **M（3-5 天）**，其中多图上传约占 1 天。

---

## 三题型优先级（问题③）

**建议顺序：AP+RDL 同批先做（AP 打头验证）→ CTW(b) 随后 → CTW(a) 砍掉。**

依据：
1. **价值**：AP 是用户搬运真题回忆料最集中、备考权重最高的阅读题型；RDL 与它共用 100% 的组件（`page.js:277-290` AP 就是穿马甲的 RDLTask）和 audit 基建（`merge-staging.mjs:103`），做一送一。CTW 用户自有素材场景弱（真题形状无答案不可还原，自造挖空更像"泛读工具"而非攒真题）。
2. **难度**：MCQ 漏斗（抽取 prompt + 代解/复核 + 预览徽章）是一次性基建，AP/RDL 平摊后各自增量很小；CTW(b) 技术上最简单（纯机械 `cTestBlanker.js`）但独立价值有限，适合作为基建就绪后的 S 级顺手活。
3. **风险**：CTW(a) 真题还原是唯一"结构上做不可靠"的形式（无 ground truth + 答案键决定判分和输入框长度），明确砍掉并在 UI 文案上引导用户走贴原文路线。

总工作量：AP+RDL（M, 3-5 天，含多图上传与 verify 端点）+ CTW(b)（S, 1-2 天）≈ 一周出头全部上线；全程无 TTS 成本，AI 边际成本每题 ¥0.02-0.08。

---

## 附录 C:听力 LCR / LA / LC / LAT

# 共通基础设施结论（四题型共享，先回答指定的关键问题）

**/api/audio 的真实能力**：`app/api/audio/[...path]/route.js` 是**纯存量代理**，不是 TTS。Edge runtime（:18），把路径拼到 `${SUPABASE_URL}/storage/v1/object/public/listening_audio/${filePath}`（:41）流式转发，路径必须匹配音频扩展名正则（:21,:34），转发 Range、打 immutable 缓存（:63）。**它不能按文本即时合成**，"零预渲染零存储"的即时流路线需要新建端点。同时 `lib/listening/audioSrc.js:15-24` 的 `sameOriginAudio` **只重写 listening_audio 桶的 URL**——个人题音频若想获得国内可达性，必须存进同一个桶（可用 `user/{CODE}/{item_id}.mp3` 子路径，代理路由接受任意深度路径段）。

**AudioPlayer 的容错是最大的 de-risker**：`components/listening/AudioPlayer.js:16-27` 声明 `src` 可选，无 src 时用 Web Speech API 念 `text`（:155-219）；`<audio>` error 时也自动降级 TTS（:109-116）。即：**个人题就算完全不配音频（audio_url=null），现有组件也能跑**——浏览器本地 TTS 兜底，只是音质差、单音色。这意味着音频生成失败永远不阻塞练习，可以放心做成 best-effort。

**Vercel 函数内能否跑现有渲染管线**：
- `lib/tts/wavTools.js` 纯 JS 解析/拼接 WAV（:12-53），**无 ffmpeg 依赖**；`renderListening.js` 只依赖 openaiTts + toneDirector + wavTools，理论上可在 Node serverless 跑。
- OpenAI 路径：`lib/tts/openaiTts.js:174` 代理是可选 env（`OPENAI_PROXY_URL`），Vercel 美国机房直连 api.openai.com 无需代理（127.0.0.1:10808 只是本地开发用）。**单次调用（LA/LAT/LCR 整段一call，见 scripts/generate-la.mjs:169-179、generate-lat.mjs:153-163、generate-lcr.mjs:162-172）在 60s 内没问题**；但 LC 的 persona 渲染（`renderListening.js:43-66`）按句拆分做 15-30 次**串行** TTS 调用，60s 危险、180s 勉强，尾部风险高。
- Edge-tts 路径：`@andresaya/edge-tts` 在 package.json:31，走出站 WebSocket，Node serverless 可用，免费、直接出 mp3（24kHz/96kbps），`generateConversation`（edgeTts.js:199-210）支持逐段换音色。

**个人题音频三方案排序（结论）**：
1. **首选：导入时同步预渲染 edge-tts，存 listening_audio 桶 `user/{CODE}/` 路径**。免费（符合"降本杠杆=退回免费edgeTts"口径）、mp3 直出免转码、每题一次函数调用 ≤60s、CDN 可缓存、复用 /api/audio 代理与 AudioPlayer 全部现有逻辑。主库现默认 provider 也是 edge（generate-lc.mjs 注释"Edge path unchanged (tone-blind, fast, default)"），音质投票尚未定 go，个人题没理由先用付费引擎。
2. 备选：新建 `/api/tts` 即时流端点（零存储）。技术可行但每次播放都消耗合成（重播、错题本回放都要重跑），且等于对外开放免费 TTS 代理，需 Pro 门禁+限流；首播延迟 5-20s。不如预渲染。
3. 不做音频只出文字稿：作为渲染失败时的自动兜底已经免费拥有（AudioPlayer Web Speech 降级），不必作为主路线。

**上传形式分层（问题①）**：
- (a) 机经/回忆纯文字 → 主路线，粘贴 transcript+题目，走 DeepSeek 抽取（复制 `app/api/user-bank/extract/route.js` 模式），配 edge-tts。
- (b) 用户自有音频文件 → **v1 砍掉**。理由：whisper-1 需服务端过代理（约 ¥0.04/分钟成本尚可），但 ①上传音频=对外提供任意文件托管，滥用面大（现有 extract-image 只收图片且 magic-byte 校验+4MB 上限，音频文件更大更难验）；②转写后仍要人/AI 重新切说话人、对齐题目，工程量倍增；③真题录音属 ETS 版权素材，平台主动接收并存储侵权音频风险高于用户自留文本。文字稿已覆盖 90% 机经场景。
- (c) 截图 → 题目+文字稿走 Qwen-VL（复制 `extract-image` 路由 + `lib/ai/prompts/imageExtraction.js` 的 SAFETY_PREAMBLE 注入防护范式,:16）。注意听力截图常只有题目没有文字稿（考试界面不显示 transcript）——此时只能生成"无音频纯做题"条目或让 AI 拒收，需在 UI 明示。

**多说话人音色（问题②）**：LC 用 edge-tts `generateConversation` 按 speaker→preset 映射（generate-lc.mjs:197-203 现成逻辑：`pickVoicePresets` 保证两人不同声），male/female 由抽取时 AI 标注 `speakers[].gender`。若走 openai persona 路径则 `toneDirector.derivePersona`（lib/tts/toneDirector.js:69-88）已保证双声不撞。**单音色不可接受**（对话听不出换人），但 edge 多音色即够，不需要 persona 层。

**TTS 成本（问题③，口径=词数÷140×¥0.107，仅 gpt-4o-mini-tts 路径产生）**：见各题型章节。**建议不记入每日额度**（与现有导入策略一致：`lib/userBankAuth.js:7-8` 导入只查额度不消耗），但给音频渲染单独加"每日 N 条"防滥用帽（edge 免费也要防刷，Microsoft 端点会 429/403）；若未来切 gpt 引擎再改为每条消耗 1 次 daily_usage。

**存储与孤儿清理（问题④）**：存公有桶 `listening_audio/user/{user_code}/{item_id}.mp3`（uploadAudio 已支持任意路径，lib/tts/storage.js:47-76）。公有桶意味着 URL 可猜（user_code 6 位出现在路径里）——听力题音频非敏感内容，可接受；介意则在文件名加随机后缀存回 data.audio_url。清理：① DELETE /api/user-bank 时按 item_id 顺手删 storage 对象（路径可从 item_id 推导，同步删除即可）；② 每晚 routine 附带 sweep：list `user/` 前缀对账 user_question_banks.item_id，删无主文件。

**练习页接入比写作更简单**：写作需要 `stashPromptSnapshot`（lib/history/retry.js:39-52）跨组件交接，因为 WritingTask 内部按 id 查静态库；而听力的 item 解析就在 `app/listening/page.js:168-169`（`singleItem = bankData.items.find(...)`）——**picker 和任务组件同页**，只需 `|| personalById.get(pickedItemId)` 一行兜底，无需 sessionStorage 交接。历史/错题本天然兼容：`saveListeningSession` 存的是完整快照（page.js:224-231，transcript+questions+audio_url 全进 details），`lib/listeningMistakes.js:1-12` 也只读 session 快照，不查库；听力本无"同题重练"（retry.js:10-14 只支持 email/discussion），无需改。模考不受影响：`lib/mockExam/listeningPlanner.js:10-13` 静态 import 四个 bank，个人题永远进不去。

**必须顺手修的既有 bug**：`app/listening/page.js:139-158` 练习模式选题器**硬编码 LCR**（`buildLCRTopics()` 不分 type，标题也写死 "Listen & Choose a Response"），而首页对四个题型都发 `mode=practice` 链接（components/home/ListeningSectionContent.js:66）——la/lc/lat 练习模式现在选到的是 LCR 题目列表，选中后 :168 在错误的 bank 里查 id 必然落到"暂无题目"死端。接个人题库前必须先给 la/lc/lat 建各自的 picker（这本来就是个人题并入的挂载点）。另：:246 所有听力子类型共用 `DONE_STORAGE_KEYS.LISTENING_LCR` 一个 done-key。

**服务端字段扩展**：`app/api/user-bank/route.js:9` `VALID_TYPES = new Set(["discussion","email"])` 加四个值；`lib/userBank/personalBank.js:39` 的类型校验谓词（现在硬编码 email/discussion 两分支）和 `mapPersonalToPicker`（:46-64）需按题型扩展；`components/userBank/MyBankImporter.js:42-46` 翻 `live:true` 并补 stored/practice/placeholder 与 `isValid` 分支（:67-77）。抽取 prompt 全是**新建**：`lib/ai/prompts/questionExtraction.js:22`（SYSTEM_PROMPTS 只有 academic/email/build）和 `imageExtraction.js:18`（只有 academic/email）。

---

# 题型: LCR（选择回应 Choose a Response）

## 1. 数据契约
`data/listening/bank/lcr.json`（612 条，`{version, items}`）。真实样例字段：`context`("campus_academic")、`situation`、`difficulty`("easy"|"medium"|"hard"，分布 141/337/134)、`answer_paradigm`、`speaker`（**一句话即口播全文**，"Where should I submit the revised essay by Friday?"）、`options:{A,B,C,D}`（文本显示、不配音）、`answer:"C"`、`explanation`（中文解析）、`distractor_types`、`id`、`audio_url`（指向 Supabase 公有桶 listening_audio/choose-response/{id}.mp3）。无 questions 数组——一条即一题。体积：均值 1051 字节 / 最大 1446 字节，**16KB 上限（route.js:11）余量 10 倍以上**。音频只渲染 `item.speaker`（scripts/generate-lcr.mjs:163），实测口播词数均值 8、最大 16。

## 2. 练习组件与选题路径
`components/listening/LCRTask.js` 渲染；AudioPlayer 吃 `src=item.audio_url||null, text=item.speaker`（:365-372），无音频自动浏览器 TTS。练习模式**已有 TopicPicker**（page.js:139-158，buildLCRTopics :58-65），是四题型中唯一现成的挂载点：照抄 academic-writing 的并入方式（app/academic-writing/page.js:42-56 fetchPersonalBank+mapPersonalToPicker 前插+「我的」tag），选中解析处 :168 加 personalById 兜底。改动文件：app/listening/page.js、lib/userBank/personalBank.js、app/api/user-bank/route.js、MyBankImporter.js。历史/错题本零改动（快照式）；模考不受影响（listeningPlanner 静态库）。

## 3. 上传形式建议
用户最少提供：**一句话提示 + 4 选项 + 答案**（机经常见格式）。答案缺失可由 AI 生成+audit 补齐；`context/situation/difficulty/answer_paradigm/distractor_types/explanation` 全部 AI 代劳（explanation 有现成中文风格范例可 few-shot）。真题截图：LCR 考试界面只显示选项不显示 speaker 句——截图源大概率**缺口播句**，应让 Qwen-VL 抽出选项后提示用户手补 speaker 句或拒收；机经文字（含 speaker 句）才是主流来源。

## 4. AI 工作清单
- 新建 `SYSTEM_PROMPTS.lcr` + `IMAGE_EXTRACTION_PROMPTS.lcr`（带 SAFETY_PREAMBLE）。
- 答案缺失时：出题 AI 补 answer+explanation，再跑**现成二审**：`lib/listeningGen/lcrAuditor.js`（`auditLCRItem(item, callAI)`，callAI 注入 DeepSeek 即可在 Vercel 路由内跑）。
- 校验：`lib/listeningGen/lcrValidator.js` 的 `validateLCR`（schema 层直接复用；profile 层放宽为 warning）。
- TTS：edge-tts 一次调用（preset 按 lcr_campus_*，edgeTts.js:33-56），≈3-5 秒音频/约 50KB。gpt 口径成本 8÷140×0.107≈**¥0.006/题**（edge 则 ¥0）。

## 5. 成本与风险
边际成本≈0（DeepSeek 抽取走已有口径，edge-tts 免费，存储 ~50KB/题）。质量风险最低：单句、答案由 auditor 独立验证。体积风险无。主要风险是截图源缺口播句的 UX 死角。

## 6. 可行性结论
**能做，且是四题型里最该先做的**。路线：粘贴/截图→抽取→（缺答案则补+audit）→存库→导入时 edge-tts 渲染 speaker 句上传 `user/{CODE}/`。LCR 练习 picker 现成，改动面最小。工作量 **S-M（2-3 天）**，其中一半是共享基建（VALID_TYPES、personalBank 谓词、渲染端点、桶路径），做完后三个 MCQ 题型都受益。

---

# 题型: LA（听公告 Announcement）

## 1. 数据契约
`data/listening/bank/la.json`（314 条）。字段：`context`、`situation`、`speaker_role`("department_staff")、`difficulty`(120/137/57)、`announcement`（**口播全文**，均值 103 词/最大 122）、`questions[]`（**恒 2 题**：`{type:"main_idea"|"inference"|..., stem, options:{A..D}, answer, explanation, distractor_types}`）、`id`、`audio_url`(announcement/{id}.mp3)。体积均值 2460 / 最大 3100 字节，16KB 无压力。TTS 兜底文本取 `item.announcement`（ListeningMCQTask.js:28）。

## 2. 练习组件与选题路径
`components/listening/ListeningMCQTask.js`（LA/LC/LAT 通用，:13-21 明确数据契约：audio_url 可选 + transcript/announcement/lecture 兜底 + questions[]）。**练习模式选题器不存在**（page.js:139 的 picker 是 LCR 硬编码，见共通节 bug）——需新建 LA topics builder（tag=context、title=situation 首行）+ 个人题并入。standard 模式随机单条（page.js:108-115）；个人题只进 practice picker、不进随机池（与写作一致的产品决策）。历史/错题本/模考同 LCR 结论：零改动。

## 3. 上传形式建议
用户最少提供：**公告全文 + 至少 1 道题**；更进一步：只有公告全文也可收——题目由 AI 出（有完整出题管线 prompt 可借用 `lib/listeningGen/laPromptBuilder.js` 的题干/干扰项规范）。AI 代劳：speaker_role/context/difficulty/explanation/distractor_types、缺失的第二题。截图源：机经帖常见"公告文字稿+2 题"完整块，Qwen-VL 可整块抽；真题界面截图只有题没稿→拒收或标"无音频纯做题"。

## 4. AI 工作清单
- 新建 la 抽取 prompt（文本+图片各一）。
- 用户只给稿不给题时：借 laPromptBuilder 的题型规范出 2 题 → **`lib/listeningGen/laAuditor.js`（auditLAItem）二审**（无答案独立作答+歧义标记，正是"answer audit"范式）。
- 校验：`laValidator.js` validateLA，schema 层复用、词数 profile 放宽（用户真题公告可能 200+ 词）。
- TTS：edge-tts 单次调用整段（generate-la.mjs 模式），preset 按 speaker_role 映射 announcement_formal/classroom/ra。成本（gpt 口径）103÷140×0.107≈**¥0.079/题**（edge ¥0）；音频约 45s / ~550KB mp3。

## 5. 成本与风险
边际成本：edge 路线≈¥0.01 以内（纯 DeepSeek 抽取+审核 token）；gpt 路线 ¥0.08。质量风险中：AI 代出题的答案唯一性靠 auditor 拦（现有管线同款，主库实践过）；用户给的题+答案错了没有 ground truth——建议对用户自带答案也跑 audit，不一致时预览界面亮黄提示而非静默改。体积风险无。

## 6. 可行性结论
**能做**。最科学路线：粘贴公告稿（±题目）→抽取→缺题补题+audit→edge-tts 整段渲染。依赖 LCR 阶段建好的共享基建后，LA 增量= picker builder + 抽取 prompt + validator 接线，**S（1-2 天增量）**。

---

# 题型: LC（听对话 Conversation）

## 1. 数据契约
`data/listening/bank/lc.json`（429 条）。字段：`context`、`situation`、`difficulty`(150/193/86)、**`speakers`（恒 2 人：`{name:"Woman"|"Man", role, gender}`）**、`conversation[]`（`{speaker, text}` 逐轮，6-15 轮）、`questions[]`（恒 2 题，结构同 LA）、`id`、`audio_url`(conversation/{id}.mp3 或 .wav)。口播词数均值 105 / 最大 170。体积均值 2607 / 最大 3255 字节。TTS 兜底把轮次拼成 "Woman: .... Man: ...."（ListeningMCQTask.js:30-32）。

## 2. 练习组件与选题路径
同 LA：ListeningMCQTask 渲染，practice picker 需新建，个人题并入方式同上。注意 `validateLC` 的 schema 硬闸（lcValidator.js:88-102）：**6-15 轮、60-280 词**是按本库"短对话"变体校准的——真实 TPO 对话 400-700 词会被硬拒，个人题校验必须把词数/轮数上限放宽或降级为 warning，否则用户导真题必失败。答题计时 `listeningSecondsForType`（lib/listeningTiming.js）也是按短对话标定的，超长对话只是听得久，不破坏逻辑。

## 3. 上传形式建议
用户最少提供：**带说话人标记的对话稿（"W:/M:" 或 "Woman:/Man:" 机经惯用）+ 题目**。AI 代劳：speakers 数组（含 gender 推断——这是音色分配的关键输入）、role、context/difficulty、explanation、缺题补题。对话稿没有说话人标记时 AI 按轮次交替切分并标注，预览时让用户确认。截图：完整机经块可抽；只有题没稿→拒收。

## 4. AI 工作清单
- 新建 lc 抽取 prompt（要求输出 speakers[]+conversation[] 原生结构，gender 必填）。
- 二审：`lcAuditor.js auditLCItem`（现成，callAI 注入）。
- 校验：`lcValidator.js` validateSchema 复用但放宽词数/轮数（见上）；validateProfile/scoreFlavor 全部降级 warning。
- TTS：**edge-tts `generateConversation`**（edgeTts.js:199-210）按 speakers.gender 映射 student_female/professor_male 等 preset，两人保证异声（generate-lc.mjs pickVoicePresets 已有防撞逻辑）。**不要在 Vercel 里跑 openai persona 渲染**（renderConversation 15-30 次串行调用，180s 尾部风险 + WAV 体积 ~3MB）。成本：gpt 口径 105÷140×0.107≈**¥0.080/题**（真题长对话 400-700 词则 ¥0.31-0.53）；edge ¥0。音频 edge mp3 约 45-60s / ~600KB（真题长对话 3-4 分钟 / ~2.5MB）。

## 5. 成本与风险
边际成本 edge 路线≈抽取 token 而已。质量风险：①说话人切分错位是 LC 特有风险（切错一轮全篇音色错乱）——预览 UI 应逐轮显示说话人供用户改；②edge-tts 多段拼接无响度归一（generateConversation 是裸 Buffer.concat，edgeTts.js:199-210），两音色音量可能不齐——主库 edge 路径同样如此，可接受；③长对话渲染时间：每轮一次 WS 调用，20 轮≈40-60s，贴近 60s 上限，函数应设 maxDuration=180（extract 路由已有先例 :16）。体积：JSON 若导真题长对话 ~8-10KB，仍在 16KB 内。

## 6. 可行性结论
**能做**，是四题型中数据结构最复杂的一个（双说话人+逐轮），但恰好复用度也最高（generateConversation、pickVoicePresets、lcAuditor 全现成）。路线：粘贴对话稿→抽取（含 gender）→逐轮预览确认→audit→edge-tts 多音色渲染。增量 **M（2-3 天，含说话人预览 UI）**。

---

# 题型: LAT（学术讲座 Academic Talk）

## 1. 数据契约
`data/listening/bank/lat.json`（257 条）。字段：`subject`("art_history")、`topic`、`difficulty`(56/143/58)、`transcript`（**单说话人口播全文**，均值 251 词/最大 290）、`questions[]`（**恒 4 题**）、`id`、`audio_url`(lecture/{id}.mp3)。体积均值 5040 / 最大 5961 字节——四题型最大但仍不到 16KB 上限（route.js:11）的 40%。TTS 兜底取 `item.transcript`（ListeningMCQTask.js:28）。

## 2. 练习组件与选题路径
同 LA/LC：ListeningMCQTask 渲染（3-5 questions 也吃得下，组件按 questions.length 循环），practice picker 需新建（tag=subject、title=topic）。其余（历史快照、错题本、模考隔离）同前。

## 3. 上传形式建议
用户最少提供：**讲座文字稿 + 题目**（TPO 听力机经的主要形态）。注意：**真实 TPO 讲座 500-800 词、6 题**，是本库 250 词/4 题变体的 2-3 倍——契约上放得下（~10-12KB JSON），但校验（`latValidator.js` 的词数 profile）必须放宽，且 TTS 成本/时长按真实长度翻倍计。AI 代劳：subject/topic/difficulty/explanation/distractor_types、缺题补题。只有题没稿的截图拒收。

## 4. AI 工作清单
- 新建 lat 抽取 prompt ×2。
- 二审：`latAuditor.js auditLATItem`（现成）。
- 校验：`latValidator.js` validateSchema 复用+放宽（4 题恒等约束要改成 2-6 题区间以容纳真题 6 题）。
- TTS：单说话人整段一次 edge-tts 调用（generate-lat.mjs:156-163 模式，preset lecture_male/female），**Vercel 内最安全的一类**（单次调用无串行链）。成本：库内规格 251÷140×0.107≈**¥0.192/题**（gpt）；用户导真题 700 词≈**¥0.54/题**；edge ¥0。音频：库内规格约 108s / ~1.3MB mp3；真题长度 5 分钟 / ~3.6MB。

## 5. 成本与风险
边际成本：edge 路线≈0；若将来全库切 gpt，LAT 是个人题里唯一"每题几毛钱"级别的，届时应记额度。质量风险：长转写的 OCR/粘贴噪声（换行、连字符）会进 TTS——抽取 prompt 要求净化；AI 补题在 700 词长稿上答案歧义率高于短稿，audit 拦截率会上升（预期可接受，主库 LAT 管线同款流程）。体积风险：真题级 LAT 是唯一逼近 JSON/音频体积上限的，但都在限内。edge-tts 单次合成 700+ 词的稳定性需实测（Microsoft 端点对超长文本偶发截断——可按段落切分多次调用再 concat mp3 帧，edge mp3 可直接字节级拼接）。

## 6. 可行性结论
**能做**。路线同 LA（单说话人整段渲染），额外注意"真题长度≠库内长度"的校验放宽与长文本 TTS 分段。增量 **S-M（1.5-2 天）**。

---

# 总体裁决

- **全部四题型可接入**，统一路线：粘贴/截图 → DeepSeek/Qwen-VL 抽取（新建 6 个 prompt，复用 SAFETY_PREAMBLE 范式）→ 现成 auditor 二审答案 → 现成 validator（schema 层复用、profile 层放宽）→ 存 user_question_banks（16KB 契约全部富余）→ **导入时同步 edge-tts 预渲染存 listening_audio/user/{CODE}/**（免费、≤60-180s/题、失败自动降级浏览器 TTS 不阻塞练习）→ practice picker 并入（比写作还简单，同页解析无需 snapshot 交接）。
- **v1 砍掉**：用户上传音频文件（滥用面+版权+双倍工程量，文字稿覆盖绝大多数机经场景）；即时流式 TTS 端点（每播重合成+开放代理风险，预渲染全面占优）。
- **顺序建议**：LCR 先行（picker 现成、结构最简、把共享基建一次做完）→ LA → LAT → LC（说话人切分 UX 最重）。总工作量 **M-L：首题型 2-3 天（含基建+修 la/lc/lat practice picker 死端 bug），其后每题型 1-3 天增量，合计约 1.5-2 周**。
- 前置必修：`app/listening/page.js:139-158` 练习选题器 LCR 硬编码 bug（la/lc/lat practice 现在是死端），这是接入的挂载点本身。

---

## 附录 D:口语 复述 / 面试

# 题型: 听后复述 Repeat (Listen & Repeat)

## 1. 数据契约

Bank 是**套题(set)**结构，不是单句。真实样例（`data/speaking/bank/repeat.json`，共 96 套 × 7 句）：

```json
{ "id": "rpt_1780329446_001", "scenario": "IT Help Desk", "speaker_role": "IT support technician",
  "sentences": [ { "id": "rpt_..._s1", "sentence": "Printers are located near the entrance.",
    "difficulty": "easy", "word_count": 6, "structure": "bare declarative",
    "phonetic_focus": "clear word-final consonants (...)", "timing_seconds": 8,
    "audio_url": "https://.../listening_audio/speaking/repeat/rpt_..._s1.mp3" } ] }
```

- **关键实证：`audio_url` 是死字段**。全仓 grep `audio_url` 只有 listening 组件在用；`RepeatTask.js` 播放 100% 走客户端 `window.speechSynthesis`（`components/speaking/RepeatTask.js:97-124`，`new SpeechSynthesisUtterance(sentence.sentence)`），预渲染 mp3（由 `scripts/generate-speaking.mjs:204-231` 用免费 edge-tts 生成）从未被口语组件消费。**结论：个人 repeat 题零 TTS 成本，纯文本即可运行**。TTS 不可用时组件还有直接显示原句的兜底（RepeatTask.js:590-608）。
- 组件实际只吃 `{ id, sentence, difficulty }`（RepeatTask.js:23-27），其余字段（word_count/structure/phonetic_focus/timing_seconds）是生成管线元数据，运行时不用；difficulty 缺失时 badge 回退 easy（RepeatTask.js:399-412）。
- difficulty 三档 easy/medium/hard，词数标准在 `lib/speakingGen/speakingValidator.js:41-45`（easy 4-7 / medium 8-12 / hard 13-20，绝对界 3-25 词，validator:69-72）——**可由词数确定性推导，无需 AI 判**。
- 体积：实测每套 2646-3618 字节（含 audio_url），16KB 上限余量 4 倍以上；个人题不存 audio_url 更小。

## 2. 练习组件与选题路径

- 渲染：`components/speaking/RepeatTask.js`；practice 模式选题在 `app/speaking/page.js:100-123`——用共享 `TopicPicker`，条目由 `buildRepeatTopics()`（page.js:39-46）从静态 import 的 bank 构建；standard 模式随机整套（page.js:30-37, 74-78）。选中后 `activeSet` 直接按 id 在静态 bank 里查（page.js:126-132）——**不经 stashPromptSnapshot**，所以个人题并入比写作还简单：page.js 自己持有 fetch 回来的个人 set 状态，解析时先查个人数组再查静态库即可，不需要快照交接（`lib/history/retry.js:39-52` 机制备而不用）。
- 需改文件：① `app/api/user-bank/route.js:9` `VALID_TYPES` 加 `"repeat"`；② `lib/userBank/personalBank.js:39`（现在的过滤器写死 email/discussion 形状）和 `mapPersonalToPicker`（:46-64）加 repeat 分支；③ `app/speaking/page.js` 加 fetchPersonalBank + 并入 picker items + activeSet 解析；④ `components/userBank/MyBankImporter.js:51` 翻 `live:true` 补 `stored:"repeat"/practice:"/speaking?type=repeat&mode=practice"/placeholder`；⑤ 抽取 prompt（见 §4）。
- 记录/错题本安全：`saveSpeakingSession`（page.js:138-153）把整个结果（含每句原文、transcript、分数）写进 `details`（RepeatTask.js finishSession:320-339），`SpeakingProgressView.js` 纯从 details 渲染、零 bank 回查——天然快照式，个人题历史不会"查无此题"。done-key 是套级 id（page.js:15-18, 151-152），`usr_` 保留前缀防撞（personalBank.js:9-14）。
- 模考不受影响：`SpeakingExamShell.js` 自带 items 供给，个人题只进 practice 路径。

## 3. 上传形式建议

- **最少输入：粘贴 3-7 句英文句子**（一行一句或一段混排均可）。真实考试中 repeat 句子是纯音频、屏幕不显示，所以"真题截图"这个来源对 repeat 基本不存在；实际来源是备考资料/机经的文字句子表，截图入口留给"教材/讲义照片"（同一 Qwen-VL 调用，边际工作只是一个 prompt）。
- AI 代劳字段：拆句清洗、`difficulty`（可直接按词数用 `REPEAT_WORD_RANGES` 确定性算，不必信 AI）、`timing_seconds`（`REPEAT_TIMING` validator:47-51 按档查表）。`scenario/speaker_role/phonetic_focus` 对运行时无用，可置空或让 AI 顺手补（仅展示价值）。
- 存储形状建议：把一批用户句子包成一个 usr_ set `{ id, scenario:"我的导入", sentences:[...] }`，item_id 由服务端生成 `usr_{code}_{ts}_{i}`（`app/api/user-bank/route.js:124`）。RepeatTask 对 `items.length` 无硬性 7 句要求（RepeatTask.js:68 `total = items.length`），建议放宽为 ≥3 句即可成套。

## 4. AI 工作清单

- 新建文本抽取 prompt：`lib/ai/prompts/questionExtraction.js` 的 `SYSTEM_PROMPTS`（:22）加 `repeat` 键并进 `EXTRACTION_TYPES`（:145）；图片抽取在 `lib/ai/prompts/imageExtraction.js` 的 `IMAGE_EXTRACTION_PROMPTS`（:18）加同款，复用 `SAFETY_PREAMBLE`（:16）注入防护。抽取任务极简（拆句+清洗），DeepSeek 一次调用 ~1-2K token。
- **无答案生成、无第二考官 audit**——repeat 的"答案"就是原句本身；评分是运行时 `lib/speakingEval/repeatScorer.js`（LCS 词匹配，纯前端函数，:74-125），与题目来源无关。
- **TTS：¥0**（speechSynthesis，见 §1）。即使将来想给个人题配预渲染音频，edge-tts 也免费。
- 复用校验器：`lib/speakingGen/speakingValidator.js` 的 `validateRepeatSentenceSchema`（:57-83，词数 3-25 + 脏词表 :20-27）可整体复用；`validateRepeatSet`（:225-298）需放宽 7 句硬闸（:243-249）为 ≥3；ETS 风味警告（2/3/2 分布、问号检测 :114-116）对用户自造素材应降级为忽略。

## 5. 成本与风险

- 导入边际成本：1 次 DeepSeek 抽取 ≈ ¥0.003；图片走 Qwen-VL 同量级。无音频资产、无存储成本。
- 练习期成本：STT 走 `/api/speech/transcribe`（whisper-1），7 句 × ≤10s ≈ 1 分钟 ≈ $0.006 ≈ ¥0.04/次——与练全局题完全同价。**不绕配额**：`question_id` 是"telemetry only"（`app/api/speech/transcribe/route.js:23`），闸门只看 user_code 的 Pro tier + PIPL 同意 + 每日 60 分钟额度（route.js:47, 125-152, 159-181），与题目来源无关。口语整页本身 Pro-gate（`app/speaking/page.js:83-98`），与个人题库 Pro 专属定位一致。
- 质量风险：① speechSynthesis 音质因设备而异——但全局题也走同一路径（audio_url 未接线），个人题无质量差；② 用户粘长段落→抽取必须硬切 ≤25 词否则拒；③ 中文/非句子内容→复用 `isProperEnglish`（validator:31-35，现只在 repeat profile 用）提为个人题硬闸。
- 体积风险：无（每套 ~3KB）。

## 6. 可行性结论

**能做，且是全部待接题型里最便宜的之一**（零 TTS、评分零 AI、STT 已有配额闸）。最科学做法：粘贴/截图 → DeepSeek/Qwen-VL 拆句 → 服务端按词数确定性定 difficulty + schema 校验（复用 validator Level 1）→ 包成 usr_ set 存库 → page.js 双源解析。**工作量 S（1-2 天）**，其中大半是 personalBank/importer/page.js 的管道复用改造。不建议砍任何形式；仅建议对 repeat 把"真题截图"话术改成"资料截图"（真题无屏显句子，避免误导用户预期）。

---

# 题型: 模拟面试 Interview (Take an Interview)

## 1. 数据契约

套题结构（`data/speaking/bank/interview.json`，11 套 × 4 问）：

```json
{ "id": "intv_1738377600_001", "topic": "Artificial Intelligence in Daily Life", "category": "technology",
  "intro": "You have agreed to participate in a survey about ...",
  "questions": [ { "id": "intv_..._q1", "position": "Q1",
    "question": "Thank you for participating in our survey. What types of AI tools ...",
    "difficulty": "personal", "word_count": 28,
    "expected_response_topics": ["personal experience", "current habits"] } ],
  "flavor_score": 0.89 }
```

- 组件只吃 `{ id, question, category, difficulty }`（`components/speaking/InterviewTask.js:24`）；注意 bank 里 `category` 在套级而问题级没有，组件的 categoryBadge 对 undefined 优雅回退（InterviewTask.js:387-401），difficulty 实际取值 personal/comparative/opinion/predictive（与 validator 的 `VALID_INTERVIEW_DIFFICULTIES` :313 还不一致，说明该字段本来就松）。
- **问题播报同样走 speechSynthesis**（InterviewTask.js:110-157），零 TTS；答题固定 45s 倒计时自动录音（`ANSWER_DURATION` :12）。
- 体积：实测每套 1412-1555 字节——16KB 上限的 1/10。

## 2. 练习组件与选题路径

与 repeat 完全同构：`app/speaking/page.js:48-55` `buildInterviewTopics()` → TopicPicker → `activeSet` 按 id 解析（:126-132）→ `<InterviewTask items={activeSet.questions}>`（:157-167）。需改文件与 repeat §2 完全重合（VALID_TYPES 加 `"interview"`、personalBank 分支、page.js 并入、MyBankImporter.js:52 翻 live、抽取 prompt），**两题型共享一次管道改造**。历史同样快照式（finishSession 把 question 原文+transcript+aiScore 全写进 details，InterviewTask.js:303-327），SpeakingProgressView 零回查；模考（SpeakingExamShell）不受影响。

## 3. 上传形式建议

- **最少输入：粘贴 1-4 个英文面试问题**（备考书/机经常见文字形态，截图=书页照片，Qwen-VL 可处理）。`intro/topic` AI 可代劳生成或置空（组件不消费 intro；topic 只用于 picker 标签和历史展示，page.js:145）。
- AI 代劳：拆问、按序补 `position` Q1-Q4、贴 difficulty 标签（展示性质，错了无害）。**不需要 AI 生成参考答案**——该题型无标准答案，评分基于考生 transcript。
- 真题截图 vs 自造素材：处理无差别（抽取形状相同）；自造素材只需 schema 级校验（≥15 字符、10-60 词、非 yes/no 风险仅 warning），ETS 风味检查（Q1 "Thank you for participating" 开场、Q3 "Some experts..." 句式，validator:361-373）全部保持 warning-only，不拦用户。

## 4. AI 工作清单

- 抽取 prompt ×2（文本 + 图片），同 repeat §4 路径。
- **评分管线现在就能用，零新增工作**——此前记忆中的 "interview deferred" 指 realExam2026 出题 prompt 校准延后，评分器本身已上线且与题库解耦：`lib/speakingEval/interviewScorer.js:88-120` `scoreInterview({question, transcript})` 只吃问题文本+转写，经 `callAI`（DeepSeek）用 `lib/ai/prompts/speaking.js:7-78` 的四维中文评分 prompt（fluency/intelligibility/language/organization，输出 JSON 有 clamp + 解析容错 :41-78）。个人问题直接可评。
- **一个必做的安全补丁**：个人题的 question 文本会被拼进评分 user prompt（speaking.js:72 `Interview Question: ${question}`）——用户可控内容进 LLM。虽属"自伤型"注入（只影响上传者自己的分数），仍建议在 `getSpeakingSystemPrompt` 加一行 SAFETY_PREAMBLE 式声明（把 question/transcript 都标为 data），一次改动两处受益（transcript 本来也是不可信内容）。
- 复用校验器：`validateInterviewSet`（validator:486-560）放宽 4 问硬闸（:504-510，<3 报错）为 ≥1；`validateInterviewQuestionSchema`（:317-338）可整体复用。

## 5. 成本与风险

- 导入边际成本：≈ ¥0.003/次抽取；无音频。
- 练习期成本：STT 4×45s = 3 分钟 ≈ $0.018 ≈ ¥0.13/session + 4 次 DeepSeek 评分（max_tokens 1500，interviewScorer.js:101）≈ 几厘——与全局题同价，全部在既有 Pro/配额闸内（同 repeat §5，无绕过路径）。
- 质量风险：① 用户传 yes/no 问题→回答内容薄、评分低，validator warning 可在预览界面提示但不拦；② 用户传中文问题→speechSynthesis 用 en-US 读会怪、评分 prompt 也乱，建议加英文占比硬闸（复用 `isProperEnglish` 思路）；③ 45s 固定时长对超长问题无影响（时长绑答题不绑题面）。
- 体积风险：无（每套 ~1.5KB）。

## 6. 可行性结论

**能做，评分管线已就绪，与 repeat 打包做性价比最高。**最科学做法：两题型一次 PR——共享 VALID_TYPES/personalBank/MyBankImporter/page.js 改造 + 各一对抽取 prompt + validator 放宽 + 评分 prompt 加防注入前缀。**合并工作量 S-M（2-4 天）**：repeat 单独 S、interview 单独 S，重合部分占一半以上。不建议砍：两者都零 TTS、STT/评分成本已被配额和 Pro 闸覆盖、数据体积无忧；唯一要砍的预期是"repeat 真题截图"（真实考试该题型无屏显文本，入口文案应引导为资料/讲义截图）。

**关键文件索引**：`components/speaking/RepeatTask.js`（:97-124 speechSynthesis 证据）· `components/speaking/InterviewTask.js`（:12, :110-157, :303-327）· `app/speaking/page.js`（:30-55, :100-132 选题/解析）· `app/api/speech/transcribe/route.js`（:23, :47, :125-181 配额不绕）· `lib/speakingEval/interviewScorer.js` + `lib/ai/prompts/speaking.js`（评分已活）· `lib/speakingEval/repeatScorer.js`（LCS 零成本评分）· `lib/speakingGen/speakingValidator.js`（:41-51, :57-83, :225-298, :317-338, :486-560 可复用校验）· `app/api/user-bank/route.js`（:9, :11, :124）· `lib/userBank/personalBank.js`（:21-64）· `components/userBank/MyBankImporter.js`（:51-52）· `lib/history/retry.js`（:39-52，本场景可不用）· `data/speaking/bank/repeat.json` / `interview.json`。

---

## 附录 E:跨题型集成管线

# 集成管线研究

## 1. 已跑通样板的可复制模式（academic-writing 的 wiring）

样板 = `app/academic-writing/page.js`（email 镜像在 `app/email-writing/page.js:46-79`，逐行同构）。可复制步骤：

1. **运行时拉取个人题**：`useEffect` 里 `fetchPersonalBank("discussion")`（page.js:42-47）。全局题库是构建期静态 import 无法每用户化，所以个人题只能运行时 fetch（`lib/userBank/personalBank.js:2-5`）；任何失败/未登录返回 `[]`，绝不破坏全局 picker（personalBank.js:40-42）。
2. **建 raw 索引**：`personalById = Map(id → raw)`（page.js:48-52），id = 服务端 mint 的 `item_id`（`usr_{code}_{ts}_{i}`，personalBank.js:34）。
3. **映射并前置进 picker**：`items = [...mapPersonalToPicker(type, personalRaw), ...静态题]`（page.js:53-56）；`mapPersonalToPicker` 产出 TopicPicker 归一化形状 `{id, tag:"我的", title, subtitle, personal:true}`（personalBank.js:46-64）。
4. **选中时快照交接**：`onSelect` 里若 id 命中 personalById → `stashPromptSnapshot("discussion", raw)` 再 `setPickedPromptId(id)`（page.js:70-76）。这一步存在的唯一原因：WritingTask **内部**按 id 从静态库解析题目（`components/writing/WritingTask.js:112,119-128`），`usr_` id 在静态库查不到会报「已下线」，快照 prepend 进 data 数组抢先命中（WritingTask.js:126）。
5. **任务组件消费**：WritingTask 用 `peekRetrySnapshot(forcedPromptId)`（只在 `initialPromptId` 非空时才读，WritingTask.js:116-118），id 匹配才返回（retry.js:79），用后 `clearRetrySnapshot()`（WritingTask.js:129）。
6. **done-set 零改动**：`usr_` 是保留前缀，全局生成器不产出，共享 done-Set 不会撞 id（personalBank.js:9-14；SQL 注释 user-question-banks.sql:18-21）。
7. **每题型形状守门**：`fetchPersonalBank` 末尾按题型过滤（email 必须有 `scenario`、discussion 必须有 `professor.text`，personalBank.js:39）——这是用户 JSON 进任务组件前的最后防线，每个新题型都必须补对应校验。
8. **导入 UI 翻牌**：`components/userBank/MyBankImporter.js` TYPE_GROUPS 翻 `live:true` + 补 `stored/practice/placeholder`（MyBankImporter.js:8,14-52）。

## 2. 快照/重练机制的类型通用性结论

**机制本体类型无关，消费端写作专用；且新题型大多不需要它。**证据：

- `stashPromptSnapshot` 只是把 `{id, type, promptData}` JSON 写进 sessionStorage 单键（retry.js:8,39-52），对 promptData 形状零假设——**类型通用**。
- 但全仓只有 WritingTask 调 `peekRetrySnapshot`（grep 全仓：`components/writing/WritingTask.js:117` 唯一消费点）；`retryPath` 只映射 email/discussion，其余返回 `""` 使历史页不显示重练按钮（retry.js:10-14，文件头注释 line 6「仅 email/discussion 支持同题重练」）。
- **reading/listening/speaking 的重练/回看机制 = session 内自带快照**：页面把整题内容存进 `session.details`（reading passage/blanks/questions：`app/reading/page.js:249-267`；listening transcript/questions/audio_url：`app/listening/page.js:206-245`），回看/错题直接读 details，不按 id 回查题库。
- **关键架构差异**：reading/listening/speaking 的任务组件都是**页面解析 item 后按 prop 传入**（`<CTWTask item={item}>` reading/page.js:305-313、`<ListeningMCQTask item={activeItem}>` listening/page.js:291-302、`<RepeatTask items={sentences}>` speaking/page.js:173-180），不像 WritingTask 内部按 id 查静态库。**因此这些页接个人题根本不需要 sessionStorage 快照**——只要把个人 raw 并进页面的解析池（`pool.find(...)`）即可，比写作样板还少一步。

## 3. 各练习页选题路径与接入点

### 3a. reading（app/reading/page.js）
- **practice 路径**：TopicPicker，items 来自静态 `buildCTWTopics/buildRDLTopics/buildAPTopics`（84-109），done key 在 line 182（注意 `DONE_STORAGE_KEYS.READING_AP` 不存在，实际总是落到字面量 `"toefl-reading-ap-done"`——questionSelector.js:24-34 无 READING_AP；新代码要复用同一字面量）。选中后按 id 在静态池 `find`（208-214）。
- **standard 路径**：话题多样性随机 + draft 恢复（143-158），全静态。
- **接入点**：① fetch 个人题（type 需 subtype 粒度：ctw/rdl/ap）并前置进 picker items；② 把个人 raw 并进 208-214 的解析池（或 personalById 短路）；③ `saveReadingSession` 与 done 标记零改动（usr_ id 直接进 details.itemId 和 done-set，249-273）；④ **RDL variant 问题**：解析按 variant 分池（rdlPool 24-26、line 213），个人 rdl 题没有 variant 概念，需决定归池或对个人题跳过 variant 判定；⑤ 建议个人题只进 practice，不进 standard 随机池——否则 draft 恢复的 `pool.find(scopeId)`（151-157）解析不到异步才到的 usr_ id，会静默丢草稿。

### 3b. listening（app/listening/page.js）
- **practice 路径只有 LCR**：`isPractice && !pickedItemId` 分支无条件 `buildLCRTopics()` + `LISTENING_LCR` done key（139-158）；la/lc/lat **没有 practice picker**（bankMap 解析在 161-169，但 picker 从不展示它们）。→ 给 la/lc/lat 接个人题，前置工作是先给它们建 practice 选题路径。
- **standard 路径**：LCR 随机抽 10（103），la/lc/lat 随机单题（108-115），带 draft 恢复（92-115）。
- **音频**：LCRTask/ListeningMCQTask 都是 `item.audio_url || null`，null 时 AudioPlayer 走浏览器 speechSynthesis 兜底（LCRTask.js:366；ListeningMCQTask.js:16,178；AudioPlayer.js:156-216）。**个人听力题没有预渲染音频也能跑通**（零服务器成本），音质/国内 voice 可用性是另一层产品决策（服务端 TTS = 成本 + Vercel 时限下的异步任务，属各题型专题）。
- **接入点**：① LCR：并入 picker items + singleItem 解析池（169）；② 个人题 audio_url 缺失 → TTS 兜底自动生效；③ `saveListeningSession` 快照 transcript/questions/audio 进 details（206-245），历史回看零改动（ListeningProgressView.js:294-296 同样 `audio_url || TTS` 兜底）。

### 3c. speaking（app/speaking/page.js）
- **practice 路径**：repeat/interview 都有 TopicPicker（101-123），done key 是页面私有常量（15-18，不在 questionSelector）。
- **题目单位是「套」**：bank item = set（set.sentences / set.questions，39-55），任务组件吃数组 prop（InterviewTask items=questions 161-167、RepeatTask items=sentences 173-180）。
- **接入点**：① 个人题导入单位应设计为 set（或导入时单题打包成单元素 set）；② 并入 picker items + 解析池（127-130）；③ `saveSpeakingSession` 只存 setId/topic/result（138-153），无题目内容快照——若将来要回看个人口语题内容，details 里需要补快照（这是 speaking 独有的缺口）。

### 3d. build-sentence（app/build-sentence/page.js）
- **practice 路径完全不同**：两级选择——语法类别 picker（合成 id `gp-*`，buildGrammarTopics 32-60）→ 套列表（每 10 题一批，getBatchesForCategory 96-103）→ `<BuildSentenceTask questions={batch}>`（260-264）。**没有单题 picker，没有 id 级选择**。
- **接入点**：最自然的是注入一个「我的」合成类别（buildGrammarTopics 里 append）+ questionsForCategory 对 `gp-我的` 返回个人题；或按 `grammar_points` 归入现有类别（抽取器已保留该字段，questionExtraction.js:139）。
- **批次进度风险已有护栏**：进度按 `${categoryId}::${batchIdx}` 存（76-93），个人题增删会移位批次，但恢复前有 `questionIds` 逐一比对，不匹配即作废进度（218-224），fail-safe。
- **现状**：抽取端已支持 build（EXTRACTION_TYPES 含 'build'，questionExtraction.js:145；/api/user-bank/extract 用 isExtractableType 放行，extract/route.js:110），**但存储端拒收**（VALID_TYPES 与 DB CHECK 均无 build）——BS 是「抽取就绪、存储卡死」状态，接入成本最低。

## 4. 存储层要动什么

1. **DB CHECK 约束（硬前置，手动 SQL 迁移）**：`type IN ('discussion','email')`（scripts/sql/user-question-banks.sql:10，注释 line 9 已预告要放宽）。需 `ALTER TABLE ... DROP CONSTRAINT + ADD CHECK(...)`，在 Supabase SQL Editor 手动跑（本项目先例：留存分析也是手动跑 SQL）。
2. **API 白名单**：`VALID_TYPES = Set(["discussion","email"])`（app/api/user-bank/route.js:9），同时管 POST 校验（58）和 GET typeFilter（80），加一处即两端生效。
3. **type 粒度建议**：按 subtype 存（ctw/rdl/ap/lcr/la/lc/lat/repeat/interview/build），与 MyBankImporter TYPE_GROUPS 的 key 已一致（MyBankImporter.js:28-52）；沿用「抽取器 key ≠ 存储 key，边界处映射」的既有规则（questionExtraction.js:143-144 + sql line 8 注释：academic→discussion）。
4. **fetchPersonalBank**：type 形参与 line 39 的每题型形状守门要逐题型扩（personalBank.js:21-43）。
5. **16KB/条评估——足够**。实测 live 库单条 JSON 尺寸（我跑的统计，`JSON.stringify().length`）：ap max 6.6KB / lat max 5.0KB / rdl-long max 4.2KB / repeat set max 3.6KB / lc max 2.8KB / ctw max 2.7KB / lcr max 1.0KB / bs 单题 max 0.6KB。最长题型（AP 学术短文含 10 题+解析）也只用掉上限 41%；用户导入比 live 长一倍仍有余量。校验在 route.js:60-66 逐条执行。**唯一装不下的是音频**：base64 一分钟 ≈ 1MB，音频永远不能进 data 字段，只能外置（bucket + URL），或走 TTS 兜底（见 3b）。
6. **不用动的**：item_id 格式与 USER_BANK_ID_RE（personalBank.js:11）、LIST_MAX=500、RLS/索引、幂等去重（route.js:131-141）均类型无关。

## 5. 模考隔离结论

**当前个人题不可能漏进模考/自适应模考，且新增题型只要不改 planner 就天然守住。**证据链：

1. 三个 planner 全部构建期静态 import live 库：readingPlanner.js:23-26（ctw/rdl-short/rdl-long/ap）、listeningPlanner.js:10-13（lcr/la/lc/lat）、speakingPlanner.js:13-14（repeat/interview）。
2. 自适应模考入口只渲染 AdaptiveExamShell（app/reading-exam/page.js:5、app/listening-exam/page.js:5,14），shell 只 import 上述 planner（AdaptiveExamShell.js:7-8）。
3. `components/mockExam/` 全目录 grep `fetchPersonalBank|user-bank|usr_|personalBank` **零命中**。
4. 写作模考任务不传 `initialPromptId`（MockExamMainPanel.js:92-124,126-150），故 WritingTask 的 `forcedPromptId=""`，`peekRetrySnapshot` 条件短路根本不执行（WritingTask.js:116-118）——即使 sessionStorage 里残留个人题快照也进不了模考；随机池只来自静态 AD/EM（WritingTask.js:112）。
5. 模考把 usr_ id 写进共享 done-set 的反向路径也无害：usr_ id 永不匹配静态库 id（保留前缀契约）。

**守界规则**：新题型接入只改练习页与 picker，严禁往 planner/AdaptiveExamShell 引 personalBank——建议在 PR checklist 或 gate 里固化。

## 6. 错题本/历史记录兼容性

**个人题答错会正常进错题本，且不会因 usr_ id 挂掉**——因为三条错题管线全部是 session 内快照驱动、零题库回查：

- reading：`extractReadingMistakes` 只读 `details.results/blanks/questions/passage`（lib/readingMistakes.js:37-82,89-123），`itemId` 仅作元数据透传（line 114）。
- listening：`extractListeningMistakes` 只读 `details.items/questions/transcript/conversation`（lib/listeningMistakes.js:30-66,81-91）。
- BS：MistakeNotebook 从 `s.details` 提取，收藏另存自包含快照「源 session 删了卡片也能渲染」（components/MistakeNotebook.js:22-57）。
- 历史回看：听力回放走 `details.audio_url || TTS 兜底`（ListeningProgressView.js:294-296），个人题无音频自动降级，不挂。
- 历史同题重练：只有 email/discussion 有（retry.js:10-14），且**对个人题已经天然可用**——WritingTask 把完整 promptData 存进 details（WritingTask.js:243,309,346,407），`startRetryFromHistory` 原样 stash（retry.js:55-61,97-102），usr_ id 经快照 prepend 解析（WritingTask.js:126）。新题型无重练可破坏；将来要加需扩 retryPath。
- **前提条件**：错题渲染质量取决于练习页 saveSession 时快照是否完整——reading/listening 已完整；speaking 只存 setId 不存内容（见 3c 缺口）。

## 7. 公共风险清单

1. **DB 迁移是所有题型的共同硬前置**且必须手动跑（§4.1）；VALID_TYPES/CHECK/形状守门三处白名单要同步改，漏一处就是「导入成功但练不了」或「API 400」。
2. **形状守门是防崩溃最后防线**：任务组件按 gate 校验过的 live 题形状写成（如 RDLTask 期望 `questions[].options` 为对象、CTWTask 期望 `blanks[].displayed_fragment/original_word`，见 readingMistakes.js:4-13 的形状文档），个人题 AI 抽取产物形状漂移会直接崩组件。每题型接入必须给 personalBank.js:39 补真校验（理想复用 `lib/questionBank/` schema），不能只判一个字段存在。
3. **质量门不覆盖个人题**：merge 时的答案审计/防退化门只跑全局库；个人 MCQ 的 answer key 错了就产生错误判分和错误错题——属「用户自有内容」可接受，但 UI 侧建议保留「我的」标识让用户有心理预期。
4. **个人题应保持 practice-only**：standard 随机路径含 draft 恢复（reading/page.js:151-157、listening/page.js:92-115），恢复逻辑在静态池同步 `find`，个人题异步到达必然 race → 丢草稿。样板（写作）也只接了 practice picker 路径，保持这个边界最省事。
5. **listening la/lc/lat 无 practice picker**（listening/page.js:139-158 只建 LCR），接个人题前要先补基建；BS 无单题选择只有语法类别批次（§3d），需要「我的」类别方案。
6. **音频/长媒体永远不进 data JSONB**（§4.5）；听口个人题短期靠 speechSynthesis 兜底（AudioPlayer.js:156-216），服务端 TTS 涉及成本与 serverless 时限，须按题型单独立项。
7. **模考边界靠约定不靠机制**：目前隔离是「没人 import」而非「不能 import」（§5），建议固化为 review 规则。
8. **speaking session 无内容快照**（speaking/page.js:138-153）：个人口语题删除后历史记录无法还原题面，接入时应顺手把题面快照进 details。
9. **单键快照的时序脆弱性**：RETRY_SNAPSHOT_KEY 是 sessionStorage 单键（retry.js:8），靠 id 匹配防陈旧（retry.js:79）；新题型如果也走快照（其实不必，见 §2），多入口并发 stash 会互相覆盖——优先选「页面解析池并入」模式，不扩快照消费面。

---

## 附录 F:盲区审查(critic)

# 盲区审查

## 矛盾/无证据论断清单

**互相矛盾（已裁决，详见第三节）**
1. **口语快照**：集成管线 §3c/§7.8 称「saveSpeakingSession 只存 setId/topic/result，无题目内容快照，个人题删除后历史无法还原题面」；口语研究称「finishSession 把每句原文/transcript/分数全写进 details，天然快照式」。二者直接冲突 → **口语研究对，集成管线错**（反证见下）。
2. **AP 题数**：阅读研究称「必须恰好 5 题（apValidator:85-87）」；集成管线 §4.5 称「AP 学术短文含 10 题+解析」→ **阅读研究对**。

**关键论断缺代码/实测证据**
3. 听力研究：「edge-tts（@andresaya/edge-tts）走出站 WebSocket，Node serverless 可用」——package.json:31 只证明依赖存在，全仓该库仅被 `scripts/generate-*.mjs`（本地/GH Actions 环境）调用过，**从未在 Vercel 函数内跑过**；「LC 20 轮≈40-60s」也是无实测的估算。整个「导入时同步 edge-tts 预渲染」首选方案建立在这个未验证前提上，必须先 spike。
4. 听力研究：「Vercel 美国机房直连 api.openai.com 无需代理」——仓库**没有 vercel.json**（我实测），函数 region 在 dashboard 配置、代码无法证明；而 `lib/ai/qwenVision.js:4-5` 头注释明确警告「OpenAI/Claude/Gemini 封锁中国大陆+香港（**含 Vercel hkg1**）」。旁证是 `/api/speech/transcribe` 已上线且直连 `api.openai.com`（route.js:212，代理仅 env 可选 :58-61），说明当前 region 大概率可达——但这是推断，不是报告给出的证据。
5. 阅读研究：「第二遍换模型（DashScope qwen 系）做真正独立复核，仓库已有通道 lib/ai/qwenVision.js」——**该通道是纯视觉客户端**，`callQwenVision` 在 qwenVision.js:47-48 硬性要求至少一张图（`at least one image is required`）。文本题的跨模型第二考官需要新写一个 DashScope 文本 client，不是「已有」。
6. 五份报告**共同盲区**（无人研究）：文本粘贴路径的注入防护、GET 端点的门禁不对称、data 字段对 audio_url 的引用完整性、/api/audio 的 immutable 缓存对「重新生成音频」的影响。见下节。

## 核实后的盲区解答

**1. 免费用户门禁：「开发中」翻牌后免费用户能不能用？**
读了 `lib/userBankAuth.js`、`app/api/user-bank/route.js`、`app/api/user-bank/extract/route.js`、四个练习页的 gate。结论：**导入侧安全，练习侧不对称**。POST /api/user-bank（route.js:103-104）和 extract（extract/route.js:106-107）都过 `gateUserBankRequest`，服务端判 Pro（userBankAuth.js:58-59，PRO_REQUIRED 403），翻 live 不会给免费用户开导入口。但 **GET /api/user-bank 完全没有 Pro 校验**（route.js:70-91，只有 rate limit + 6 位 code），Pro 过期用户的个人题仍会被 fetchPersonalBank 拉回并出现在 picker。这在 reading/listening/speaking 无所谓——三页整页 Pro-gate（reading/page.js:163、listening/page.js:121、speaking/page.js:83）；**但 build-sentence 页没有任何 Pro gate**（我 grep 全页无 isPro/tier），BS 个人题上线后，过期 Pro 用户可在免费页无限练个人题。做 BS 前要么接受、要么给「我的」分类加 tier 判定。另外 GET 无 origin 校验且 code 即凭证——与项目已知 P0（6 位码 bearer）同源，非新洞，但个人题库把「用户自己写的内容」也纳入了可被爆破 code 读取的面。

**2. 新题型抽取 prompt 的注入防护：文本路径现状是零。**
读了 `lib/ai/prompts/questionExtraction.js` 全文和 `imageExtraction.js`。`SAFETY_PREAMBLE`（imageExtraction.js:16）**只存在于图片 prompt**；文本路径的 SYSTEM_PROMPTS（academic/email/build，questionExtraction.js:22-99）没有任何 untrusted-data 声明——用户粘贴的文本直接作为 user message 进 DeepSeek（extract/route.js:57-58,115）。且该文件头 9-10 行声明「prompt 逐字冻结，gate/回归按此措辞校准，勿改写」——给存量三型补前缀有回归风险，需与 gate 维护者对齐；但**新题型的 6+ 个文本 prompt 都是新写的，不受冻结约束，必须从第一天就带 SAFETY_PREAMBLE 范式**。五份报告只有口语研究提到评分 prompt 注入，没人指出文本抽取路径本身无防护。

**3. Vercel maxDuration 与 TTS 预渲染的硬限制。**
grep 全仓 maxDuration：只有 4 个 route 声明（extract 180 / extract-image 60 / ai 180 / transcribe 60），无 vercel.json、无全局配置。听力方案的「导入时同步渲染」需要新路由自行声明 maxDuration，而账号计划（Hobby 60s cap vs Pro 300s）代码里查不到——`/api/ai` 已声明 180 且在生产运行，旁证计划支持 ≥180s，LC 长对话逐轮串行渲染贴着上限但可行。真正的未知数是第 3 条清单里的 edge-tts serverless 可用性，不是时限本身。

**4. 个人听力音频国内可达性：链路成立，但有一个无人提的缓存坑。**
读了 `components/listening/AudioPlayer.js`（:54 `const audioSrc = sameOriginAudio(src)`，所有 src 一律过重写）、`lib/listening/audioSrc.js`（:15 正则 `/listening_audio\/(.+)$/` 匹配桶内**任意子路径**，含 `user/{CODE}/...`）、`app/api/audio/[...path]/route.js`（:32-33 segments.join，任意深度；:21,34 扩展名白名单）。听力研究「存进 listening_audio 桶即自动获得国内可达」**结论正确**。补一个坑：代理对所有响应打 `cache-control: public, max-age=31536000, immutable`（route.js:63，按「item id 命名即不可变」设计）——个人题若做「重新生成音频」而复用同一 item_id 文件名，CDN 各 PoP 会永久供旧版；重渲染必须换文件名（如带版本/随机后缀）并回写 data.audio_url。

**5. audio_url 引用完整性 + 删题清理：现状双缺，且有一个安全面没人提。**
读了 route.js 的 validateItem（:53-68）和 DELETE（:151-181）。① `validateItem` 只查「是对象 + ≤16KB」，**不检查 data 内任何字段**——用户可以绕过 importer 直接 POST 一条 `data.audio_url` 指向任意外部 URL 的听力题；`sameOriginAudio` 对非 Supabase host 原样返回（audioSrc.js:21 不匹配即 return url），AudioPlayer 会把它塞进 `<audio src>`，浏览器直接向攻击者可控域名发请求（泄 IP/Referer、伪造音频内容）。接听力题型时存库校验必须对 audio_url 做白名单（仅允许自家桶 URL 或 `/api/audio/` 相对路径，或干脆服务端渲染后自己写入、拒收客户端提供的 audio_url）。② DELETE 只删 DB 行，**零 storage 清理逻辑**——听力研究提的「DELETE 顺手删对象 + 夜间 sweep」是待建功能而非现状，属接入听力的必做项，否则公有桶孤儿音频只增不减。

**6. 「第二考官」跨模型复核的通道现状（RDL/AP 方案的支柱）。**
读了 `lib/ai/qwenVision.js` 全文 + `ls lib/readingGen lib/listeningGen`。auditor 家族确实全部存在（answerAuditor.js、lcr/la/lc/latAuditor.js），merge 门 criticalFlags>0 拒收也属实（merge-staging.mjs:116-118，我实查；阅读研究关于 audit-bank.mjs 已不存在的纠偏也对）。但「换 DashScope 模型做独立第二遍」目前**没有可用的文本通道**（见清单第 5 条）——RDL/AP 的「双模一致才收」方案要么新写 DashScope 文本 client（小活，OpenAI 兼容接口），要么退化为同 DeepSeek 注入 auditor 的 callAI（听力研究采用的就是这个，相关性高但现成）。两份报告的工作量估算都没计入这一项。

## 确认有误的结论

1. **集成管线 §3c/§7.8「speaking session 无题目内容快照，个人题删除后历史无法还原题面」——错误。** 反证：`saveSpeakingSession` 把 `...result` 整体展开进 details（app/speaking/page.js:142-147）；而 RepeatTask.finishSession 的 result.items 逐句含 `sentence` 原文+transcript+score（components/speaking/RepeatTask.js:320-327），InterviewTask 同样逐题含 `question` 原文+transcript+aiScore（components/speaking/InterviewTask.js:306-314）。口语研究的「天然快照式」是对的；集成管线据此提出的「接入时应顺手补快照」风险项（§7.8）不成立，可从待办里划掉。
2. **集成管线 §4.5「AP 学术短文含 10 题+解析」——错误。** 反证：我实测 `data/reading/bank/ap.json` 全部 318 条 questions 长度分布 = {5: 318}，且 `lib/readingGen/apValidator.js:85-86` 硬闸 `questions.length !== 5` 即 error。仅影响其体积论证的措辞，16KB 结论本身不受影响（实测 max 6641B 与两份报告一致）。
3. **听力研究「Vercel 直连 OpenAI 无需代理」按事实陈述——定性为未证实而非错误**：无 vercel.json 可查 region，qwenVision.js:4-5 明示 hkg1 会被封；若该项目为面向中国用户而把函数部署在 hkg1，此论断即翻车。上线 openai 路径（含未来 whisper/gpt-tts 相关扩展）前需确认 dashboard region（transcribe 路由已在生产直连成功是最强旁证，大概率无事，但应写进验证清单而不是当结论）。

其余抽查论断（BS extract 的 build 分支 extract/route.js:131-133、EXTRACTION_TYPES 含 build questionExtraction.js:145、DB CHECK 仅 discussion/email user-question-banks.sql:10、listening 页 LCR 硬编码 picker page.js:139-158、RepeatTask 播放走 speechSynthesis RepeatTask.js:97-124、uploadAudio 任意路径 storage.js:47-76、导入门禁不消耗额度 userBankAuth.js:62-63）均核实无误。