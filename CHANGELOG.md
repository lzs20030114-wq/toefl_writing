# Changelog

## 2026-07-08 — v1.11.1

- **口语音频改用预生成 MP3**（`ef6a897`）：`RepeatTask` / `InterviewTask` 此前只用浏览器 `window.speechSynthesis` 朗读句子/问题，而国内安卓常无英文 TTS 引擎、微信/QQ WebView 对 speechSynthesis 支持残缺 → 静音；Repeat 尤其致命（句子故意不显示，静音=整题做不了）。`repeat.json` 672 句 100% 早有 `audio_url` MP3 却被忽略。现改为对齐听力 `AudioPlayer` 的做法：`playSentence`/`playQuestion` 优先播 `audio_url` 的 MP3（经 `sameOriginAudio` 同源代理 `/api/audio`，国内可达）+ MP3 报错/缺失回退 speechSynthesis；仅当既无 MP3 又无语音引擎时才显示句子文本兜底。`backfill-tts.mjs` 新增 `backfillInterview`（`speaking/interview/<qid>.mp3`），`backfill-audio.yml` 提交步骤补上 `interview.json`（interview 音频需手动 workflow_dispatch 生成一次）。
- **题库三层去重 + 存量清理**（PR #6：`10c8c4d` / `80f017a` / `15dd09b`）：夜间 routine 给相同 passage/transcript 每次铸新 id，而 merge 仅按 id 去重，导致 8 个阅读/听力库累计 1472 条逐字重复副本（约 30%）。生成端排除（bank+staging 并集）+ 合库层内容指纹/近重复拦截 + 一次性清除存量 1472 条（ctw 564→349、ap 323→172、rdl-short 389→221、rdl-long 212→134、lcr 620→302、lc 434→180、la 319→159、lat 261→133）。
- **CTW 单词补全防呆**（`2d119bb`）：锁定已给前缀 + 键盘导航，避免误改/误删自动挖空的答案位。
- **升级入口修复 + 支付可靠性**（`4bce969` / `5c3c6e3`）：「升级 Pro」按钮此前点击无反应（全局事件无监听者）→ 补监听恢复；XorPay webhook 金额对账 + 发权益顺序改为先授予后标记（注：线上支付走爱发电，XorPay 非当前路径）。

## 2026-07-04 — v1.11.0

- **「我的题库」全题型扩展**（`feat/user-bank-phase1` 六棒经 `6a511ef` 合入；实施全部由 Opus 4.8 subagent 完成、Fable 规划/验收；研究依据 `data/claudeGen/reports/USER-BANK-ALL-TYPES-RESEARCH-2026-07-04.md` 6-agent 调研）：12 题型全部可导入可练习。DB 前置：`scripts/sql/user-question-banks-widen-types.sql`（一次性把 `user_question_banks.type` CHECK 放宽到全 12 类，已在 Supabase 手动执行）。
  - **口语 repeat/interview**（`f794eae`）：粘贴句子/面试问题打包成「套」入库；提示音走浏览器 speechSynthesis 零 TTS 成本；interview 评分复用已上线 `interviewScorer`（与题库解耦）；`postProcessRepeat/Interview` 按词数确定性定难度（3-25/10-60 词外及非英文标 invalid）；评分 prompt（`lib/ai/prompts/speaking.js`）补不可信数据声明。
  - **连词成句 BS**（`a9532ec`）：只收「真题三件套」（A 问句+B 完整回应+词块条），不做单句 AI 造题（distractor 塌陷/多解歧义风险，研究裁决）；`validateBuildForImport` 用词袋差集**代码反推 distractor**（AI 给错以代码为准）+ `buildSentenceSchema` fatal 拦截；BS practice 页新增「我的题库」合成分类卡（`gp-personal`）。
  - **阅读 RDL+AP**（`99c5e19`）：新端点 `POST /api/user-bank/verify`——答案全有→`auditRDLItem` 独立作答复核（ok/mismatch），缺失→AI 代解填补（ai_answered），fail-open 不阻塞保存；`auditRDLItem` 加可选 `callAIOverride` 注入参数（缺省行为逐字不变，夜间 merge 管线零影响）；预览逐题 A-D 答案选择器 + ✓/⚠/AI 代解徽章（不一致不静默改、用户裁决）+ 保存闸「每小题必须有生效答案」；`extract-image` 升级多图（1-3 张、`validateImageBatch` 逐张 magic-byte+合计≤4MB，AP 跨屏截图场景）。
  - **阅读 CTW**（`3cfe599`）：「贴原文自动挖空」——AI 仅清洗/转写，挖空由 `cTestBlanker.processPassage` 机械产出（与全局库同一段代码，答案=原文天然零错，测试断言逐字一致）；真题截图还原砍掉（OCR 无 ground truth）。
  - **听力基建+LCR**（`813f181`）：修既有 bug——practice 选题器硬编码 LCR 致 la/lc/lat 死端（四子类各建 topics+独立 done-key）；新端点 `POST /api/user-bank/render-audio`——edge-tts 内存渲染（免费，spike 实证纯 Node 出合法 mp3）→ 存 `listening_audio/user/{CODE}/{item_id}-{ts}.mp3`（时间戳唯一名，适配 /api/audio immutable 缓存）→ 回写 audio_url，全程 best-effort（失败=AudioPlayer 浏览器朗读兜底）；安全补丁 `lib/userBank/listeningAudio.js`：POST strip 客户端 audio_url（音频 URL 仅服务端可写，防任意外域进 `<audio src>`）+ DELETE own-prefix 白名单顺手删桶（路径穿越防护）。
  - **听力 LA+LAT**（`de953a2`）：真题长稿放宽口径（validator schema errors 只取 warnings 绝不当 blocker，LAT 800 词/6 题能收）；缺题时抽取阶段 AI 补题（answer=null 交 verify 代解）；LAT 长稿分段配音（`lib/userBank/listeningAudioRender.js`：按句 ≤600 字符切、串行合成、mp3 帧拼接，synth 注入可单测）；render-audio maxDuration 60→180。
  - **听力 LC**（`94138ea`）：LC 特供预览——逐轮说话人徽章点击切换修切分错位（LC 特有风险：错一轮全篇音色乱）；`pickConversationVoices` 按 gender 映射且双 preset 强制不同（映射逻辑从 `generate-lc.mjs` 复制为纯函数，源脚本零改动）；`verifyLcConversation` 专用 shaping。
  - 横切：新文本抽取 prompt 全部自带 `TEXT_SAFETY_PREAMBLE` 注入防护（存量冻结 prompt 零改动）；个人题只进 practice picker，模考/planner/standard 随机池/merge 管线零改动（隔离有测试与 grep 证据）；jest 403→571 全过零回归。

## 2026-07-03 — v1.10.0

- **新功能「我的题库」发布**（`feat/user-question-bank`，`58acf25` 经 `8cecba6` 合入 + `7e67052` + `e5fc060`）：左侧栏第 5 个 nav-section（`sections.js` 注册 `my-bank`，`MyBankSectionContent` / 移动端 `MobileMyBankSection` + `components/userBank/MyBankImporter.js`）。用户可导入自己的学术讨论 / 邮件题：粘贴文本走 `app/api/user-bank/extract`（DeepSeek 结构化抽取，prompt 在 `lib/ai/prompts/questionExtraction.js`），题目截图走 `extract-image`（Qwen-VL 视觉识别，`lib/ai/qwenVision.js` + `imageExtraction.js` prompt + `lib/userBank/imageSniff.js` 图片类型嗅探），存 `user_question_banks` 表（`scripts/sql/user-question-banks.sql`），练习页题目选择器以「我的」分组出现。附带修复：面板漏传 `userCode` 导致已登录仍显示「请先登录」（`7e67052`）；题型选择器改为全题型分组网格、未上线题型标「开发中」（`e5fc060`）。
- **首页整体降噪改版**（`ae93f89` 一期 + `2c35df1` 二期）：一期——桌面端移除与侧栏重复的邀请横幅、删 feature strip 与顶栏 AI 声明、停掉三个无限循环动画（礼物摇摆 / 火苗跳动 / 今日圈脉冲）、金色横幅与侧栏促销压平为中性卡、任务卡 accent 收敛到仅时间标签（新增 `T.bgSoft` / `T.shadowHover` token）；review 发现并修复未登录桌面用户失去邀请入口的问题（侧栏未登录分支补 `SidebarActionItem` 邀请项）。二期——首页组件字号消灭半像素档与 9px 以下、800 字重全部降 700、倒计时 48→36px；删侧栏三统计行（与右栏重复）、右栏「考试日/目标分」bento 瓦片改环下单行文本、打卡页脚去今日状态文字；删除 632 行死组件 `HomeSidebar.js`（活 helper 迁 `sidebarWidgets.js` 并全部 token 化）、NavSidebar 散落 hex 收敛。
- **新功能聚光灯引导**（`components/home/FeatureSpotlight.js`）：通用一次性 coach-mark——目标元素保持明亮 + 呼吸光圈，四块 backdrop-blur 面板压暗页面其余部分，旁侧带箭头说明气泡（去看看 / 知道了 / ESC / 点暗区均可关）；`useSpotlightGate` 按 `featureId` 在 localStorage（`toefl-feature-spotlight-seen`）去重，已在目标页自动标已读，开启延迟 1.1s 等入场动画与异步数据落定，气泡位置自适应（右侧放不下自动落到目标下方）。本期挂「我的题库」：桌面 NavSidebar 项 + 移动端顶部 tab（`data-section-id` 锚点），挑战模式不弹。
- **题库夜间例行扩充**（`ca4873e` 及此前 routine checkpoints）：BS `questions.json` / Email / Discussion 合入新题，Reading（AP/CTW/RDL）、Listening（LA/LAT/LC/LCR）、Speaking（repeat）staging 补充待审题。

## 2026-06-28 — 后台 / 基建补记（未发用户公告）

> v1.9.3（6-18）→ v1.9.4（6-26）之间合入但当时未进 CHANGELOG 的非用户面改动，集中补记。均不构成用户可感知发布（opt-in / 一次性问卷 / 后台），故不发版本公告。

- **persona-only 听力配音渲染管线**（`287fa1b`，6-26）：gpt-4o-mini-tts（`openai`）provider 的确定性渲染路。新增 `lib/tts/toneDirector.js`（`derivePersona`：role+gender → SAFE 音色，同段对话两位说话人恒不同 + `renderInstructions`：persona 基线 + 冻结的 never-slow 配速）、`lib/tts/wavTools.js`（逐句 WAV 切分 + 响度归一 + 带间隔拼接，防疑问句母语升调泄漏到下一句、抹平各音色响度）、`lib/tts/renderListening.js`（`renderConversation` 编排 + 瞬时失败重试）。`openaiTts.js` 导出 `SAFE_VOICES` 并清除会 400 的 marin/cedar；`generate-lc.mjs` 的 openai 分支改走 `renderConversation`；修 `lcPromptBuilder.js` 输出示例（Sarah/David 与「标 Woman/Man」自相矛盾——具名说话人音色塌缩的根因）。**默认 edge 路不变、openai 路 opt-in（`TTS_PROVIDER=openai`），用户当前无感**；LLM 逐句韵律层经实测引擎不可 steer（情绪/重读/疑问升调几乎听不出）已砍，只保留好音色 + 固有语调。新增 19 单测，全量绿。
- **听力配音 A/B 投票弹窗**（`fdc3213`，6-22）：首页一次性弹窗，A=现役会话音频（`lc_mpvfq0s1_5`）vs B=响度归一的 gpt-4o 升级样本，收「支持升级/维持现状」票。`components/home/VoiceUpgradeModal.js` + `VoiceUpgradeVoteTrigger.js`（`app/layout.js` 全局挂载，每浏览器仅一次、gated on demo 音频存在）；intake `app/api/survey/voice-vote`，票存 `user_surveys`（`survey_type=voice_upgrade_2026_06`，零迁移，复用 `unique(user_code,survey_type)` 去重）。
- **后台配音投票统计页**（`82c1dfa`，6-22）：`GET /api/admin/voice-vote` 汇总票数。
- **后台新人问卷逐份作答明细表**（`18b5439`，6-23）：first-set 问卷支持逐份明细 + 用户身份关联。
- **docs**：content-aware tone-director 执行计划锁定（`3afd416`，6-22）。

## 2026-06-26 — v1.9.4

- **听力模考"做不了"修复**（`fix/listening-mock-audio-hang` `f475e1d`）：听力自适应模考把答题阶段（选项 + 答题倒计时）只挂在音频 `ended` 事件上，而到达 `ended` 唯一靠 autoplay 成功——浏览器拦截 autoplay 或 Supabase CDN 不可达（国内无代理）时整道题永久卡在"请先播放并听完音频"，模块倒计时仍在流失，超时按 0 分跳过。分三层修复：
  - **P0 逃生口**：`AdaptiveExamShell.js` 的 `LCRInlineTask` / `MCQInlineTask` listen 阶段新增「开始答题」按钮（`isListeningType` 限定，不影响阅读 / CTW）；`LCRTask.js` / `ListeningMCQTask.js` 把原本仅练习模式出现的「I'm ready」按钮放开到限时模式；补 LAT 的 TTS 文案兜底缺失的 `item.transcript`。
  - **P1 AudioPlayer 健壮化**（`AudioPlayer.js`）：新增 `<audio>` `error` 监听，加载失败回退浏览器 TTS（抽出 `startTTS` + `startTTSRef`）；把"已播完"与"已起播"解耦为 `completed`（卡顿不再误锁手动播放按钮，同时保住真题"只播一遍"）；autoplay 去掉 120ms `setTimeout`，改为手势内同步 `play()`。
  - **P2 同源音频代理**（`app/api/audio/[...path]/route.js` 改为 Edge 流式代理 + 新增 `lib/listening/audioSrc.js`）：把 Supabase `listening_audio` 公链重写为同源 `/api/audio/<path>`，服务端拉取并把字节透传回应用自己的域、转发 Range、`cache-control: immutable`，让音频在 supabase.co 被墙的环境也能加载；upstream 失败返 502 → 客户端 `error` → P1 TTS 兜底（两层叠加）；带 `NEXT_PUBLIC_AUDIO_PROXY_DISABLED` kill switch。仅重写该一类 URL，`<audio src>` 走 `audioSrc`、播放 / 重置逻辑仍用原始 `src`，覆盖模考 / 练习 / 历史回看全部调用点。
  - 新增 `__tests__/audio-player.regression.test.js`（3）+ `__tests__/audio-proxy.test.js`（6，node env）；全量 55 套 / 446 测试通过。浏览器实测：autoplay 被拦（`paused=true` `readyState=4`）时「开始答题」可进入答题；`<audio src>` 已走同源 `/api/audio` 且经代理加载成功（`/api/audio` 直 fetch 返 206 + Range + `audio/mpeg`）。
  - **已知未办**：模块倒计时在 listen 阶段仍会走（逃生阀已消除永久挂起，残留仅决定跳过前的几秒 time-bleed，非关键），留作后续单独任务。

## 2026-06-18 — v1.9.3

- **写作提前提交确认改为应用内弹窗**（`components/writing/WritingTask.js`，`50d91c3`）：原本用浏览器原生 `window.confirm`——样式与全站自定义弹窗不一致，且原生对话框会**阻塞主线程、冻结整页**。改为 app 内 styled 弹窗（继续作答 / 确定提交）；超时自动交卷仍走 `skipConfirm` 不弹框。删除不再使用的 `confirmEarlySubmit`，更新 4 个提前提交相关组件测试改为驱动弹窗。全量 49 套 / 380 测试通过。
- **已知未办**：写作页（`useSearchParams` + `Suspense fallback={null}`）的 hydration 开发期报错——**线上无感**（React 自动兜底，生产构建无报错浮层），真正症状仅为加载时一闪空白；彻底修复需重构这几页的 SSR/Suspense 结构，留作后续单独任务（曾尝试 `WritingTask` mount 守卫，因根因在其上层 Suspense 边界而无效，已回退）。

## 2026-06-18 — v1.9.2

- **产品 / UX 第 2 批（`fix/product-ux-batch-2` `3f5c9ad`）—— 计时与移动端**：
  - **计时器墙钟锚定**（`WritingTask.js` + `useBuildSentenceSession.js`）：限时写作/造句倒计时改为按绝对截止时间每秒重算 + `visibilitychange` 回前台立即重算（BS 路径归零时置 `autoSubmitRef` 才真正交卷），切后台/锁屏导致 `setInterval` 被节流时不再漂移。AdaptiveExamShell/Speaking 计时器作为更高风险后续单独处理。
  - **手机端模考固定倒计时条**（`MockExamShell.js` + `app/mobile.css`）：移动端答题区顶部 `position:fixed` 显示倒计时（复用已上抬的 `sectionTimer`），`.tp-exam-grid--timer` 预留 44px、嵌入态 `WritingTask` 高度收为 `calc(100dvh - 44px)` 防止「提交」被挤出；桌面端不变。
  - **移动端任务 tab 等宽不溢出**（`MobileHomePage.js`）：四个分区 tab 改 `flex:1 1 0` 等宽 + 移动端隐藏 emoji + 缩小字号/内边距，320–414px 不再横向滚动/截断。
- **产品 / UX 第 3 批（`fix/product-ux-batch-3` `c741871`）—— 等待反馈 + 断头路兜底**（源自 2026-06-18 用户流程/卡顿 review，报告 `data/claudeGen/reports/FLOW-JANK-REVIEW-2026-06-18.md`）：
  - **AI 评分等待可见进度**（`WritingResponsePanel.js`）：评分中显示转圈 + 计时 + 预期耗时，替代原来最长 150s 的一行静态字。
  - **进入任务不再白屏**（`UsageGateWrapper.js`）：usage 检查期间显示骨架转圈；pro/legacy 直接乐观渲染不阻塞。
  - **模考出分前 loading 卡**（`MockExamResult.js`）：`scoringPhase==='pending'` 时显示「正在生成成绩…」而非看着像崩了的 `--` 段位圈。
  - **听力音频缓冲态**（`AudioPlayer.js`）：新增 `buffering`（`waiting`/`stalled`→true，`playing`/`canplay`→false），缓冲时显示「缓冲中…」、不再用动画波形假装在放。
  - **升级成功不再整页 reload**（`UsageGateWrapper.js`）：`saveAuth(pro)` + `router.refresh()` 取代 `window.location.reload()`，不再重下多 MB 题库。
  - **练习记录加载到同步完成**（`ProgressView.js`）：登录用户加 `synced` 标志（首个 `HISTORY_UPDATED` 或 1.5s 兜底），不再先闪「还没有练习记录」。
  - **P0 免费次数用完给升级入口**（`api/ai/route.js` + `lib/ai/client.js` + `WritingResponsePanel.js`）：服务端给免费 429 打 `code:"DAILY_LIMIT"`，客户端读 body 经 `isDailyLimitError` 映射为「今日免费次数已用完」+ 升级 Pro 按钮，替代假「服务繁忙」+ 无效重试；错误消息保留 `API error <status>` 以维持状态分类（单测验证）。
  - **P0 付款轮询封顶兜底**（`UpgradeModal.js`）：轮询 2 分钟无到账即停并显示兜底（确认登录码已填入留言 / 重新检查 / 联系我们），不再无限转圈。
  - **P0 评分中刷新自愈**（`MockExamShell.js`）：把存档的 `scoringPhase==='pending'` 恢复为 `'idle'`，幂等评分重跑，不再把做完的模考永久卡在「请稍候」。
  - 验证：全量单测 49 套 / 380 项通过；改动页面 SSR + 实跑加载零报错。未办（deferred）：reading/listening 题库客户端代码分割（~4–5MB）、AdaptiveExamShell/Speaking 计时器、其余 7 处升级 `window.location.reload`、MockExamShell 额度不足弹窗的 SSR hydration 警告（与 batch-1 LIVE.1 同类）。

## 2026-06-18 — v1.9.1

- **产品 / UX 批修复（第 1 批）** (分支 `fix/product-ux-batch-1`；每条"设计 → 独立复核"后实施，逐条单测 / 浏览器验证)：
  - **学术讨论选题器标题残缺修复** (`app/academic-writing/page.js` + 新 `lib/academicWriting/topicTitle.js` + `__tests__/academic-topic-title.test.js`)：`extractShortTitle` 触发词正则缺词边界，`discuss` / `question` 会匹配进 `discussing` / `discussion`，约 1/3（35/111）练习选题标题以半截 "ing …" 开头。改为 `\bdiscuss\b` 等词边界，失配回落首句；新增测试断言全部 111 题无 "ing/ion" 开头。
  - **造句对题回顾正确答案显示修复** (`lib/questionBank/renderResponseSentence.js` + 测试)：回顾页"正确答案"此前由去标点 / 小写化的 `answerWords` 重建，专有名词被小写、句内逗号被删。改为直接取权威的 `q.answer`（保留大小写与逗号）；用户作答句仍走原 `finishSentence`，判分仍大小写 / 标点不敏感。
  - **iOS Safari 口语录音卡死修复** (`components/speaking/InterviewTask.js` + `VoiceRecorder.js`)：面试题 45s 倒计时此前在 TTS 后即启动，而 iOS Safari 自动 `getUserMedia` 因缺用户手势被拦时录音从未开始，计时归零后 `recorderStopRef`（从未赋值）空操作，用户卡在 0:00 无录音。现倒计时仅在录音真正开始（`onRecordingStart`）后才走；`VoiceRecorder` 暴露可选 `onStopRef` / `onAutoStartBlocked`（对其它调用方向后兼容）；自动启动被拦时计时器暂停并显示"待开始"+ 手动提示，每题进出重置状态。
  - **未登录练习页 SSR 报错修复** (`components/shared/UsageGateWrapper.js`)：`LoginRequiredModal` / `PracticeLockedGate` 的 `createPortal(…, document.body)` 在 SSR 抛 `document is not defined`（每次未登录打开做题页刷错误日志）。改用 mount-flag 守卫（`useEffect` 置位后再渲染 portal）—— 复核原建议的 `typeof document` 守卫经浏览器实测会引入 hydration 警告（弹窗首屏即渲染，服务端 null 与客户端水合不一致），故采用 mount-flag 使客户端首帧也返回 null、与服务端一致。
  - 验证：全量单测 49 套 / 380 项通过；浏览器实测 LIVE.1（无 SSR / hydration 报错）、P1.1（选题器标题正常）通过；P1.9 编译 + 渲染通过，真机 iOS Safari 行为待设备确认。
  - 搁置（需产品决策 / 大工程，下一批处理）：造句干扰项多样性重生、插入句阅读题渲染、模考评分失败显示、听力可猜、口语发音维度、显示分口径、计时器漂移、移动端倒计时 / tab 溢出等。

## 2026-06-17 — v1.9.0

- **造句题库整体升级 + 防退化门接进 live** (`f18cad0` + `fe49677`，merge `2d79d74`)：
  - 线上造句题库整库替换为 gate-clean 的 claudeGen 语料（20 套 / 194 题，`cg_bs_*`）；旧 29 套 / 290 题（`ets_*`，冻结门 7 硬闸 + 3 漂移 FAIL）退役，快照存 `data/eval-profiles/bs-selfcheck-degraded.json`。新库冻结门 PASS（长度档 / 语域 / 多样性 / prefilled / 可重建全过，结构漂移带在带内）。
  - 冻结难度门（`scripts/bs-difficulty-scorer.mjs --gate`，真题校准标准 `bs-difficulty-standard.json`）接进两条 live 合库路 `mergeClaude.mjs` + `appendBSSets.mjs`：合库前对"将合成的库"过门，默认 **warning-only**，`BS_GATE_ENFORCE=1` 改为 FAIL 即拒合（此前门只在离线 `bs-accept.mjs`，nightly 自动合库绕过真题标准）。`check-quality-gates.mjs` 把 `bs_difficulty_gate` 判定写进夜间报告（非阻断）。
  - 配套修复：`questionSelector.js` 放宽"每套必须 10 题"为 1–20 题（新库 6 套为 9 题）；`BS_DONE_KEY` → `toefl-bs-done-sets-v2`（新 set_id 1-20 与旧 1-29 撞车，会让用户跳过新题 → 重置造句已完成进度，练习历史走 per-session 快照独立保留）。`bs-difficulty-scorer.mjs` 自校验的"已知退化"参照从 live 库改为冻结退化样本（否则库一变好自校验即坏）+ history 写入自愈（mkdir + try/catch）。
  - 验证：冻结门 PASS、自校验 PASS、picker 选出全部 20 套、单测 362/362；provenance（9 批 `accepted/` + `_bs_cumulative.json`）入库。未办：`BS_GATE_ENFORCE=1` 待翻；阅读 / 听力审题器接 merge（D）待定；`answer_hashes.json` 已陈旧待重生。
- **备考日历 / 火苗连续打卡** (`f252680`)：首页右栏（桌面端）新增考试倒计时 + 目标分数环、连续打卡火苗（按连续天数升温配色）、周 / 月练习热力图；目标存 localStorage（按用户隔离）。
- **听力 / 口语练习记录回放** (`de6cddf` + `0f45a0f`)：听力练习记录支持回放原音 + 原文精听；口语练习记录支持回放题目原音。
- **修复**：`AudioPlayer` 多实例不再同时播放、互相串音（`e5327e3`）；progress `StatCard` key-in-spread 警告（`56edf7c`）。

## 2026-06-05 — v1.8.2

- **模考贴近真考（6.4 反馈批量）** (`4458d45` + `21e743a` + `2959de8` + `992016e`)：
  - tier-1：阅读/听力模考返回改回各自板块（`/?section=reading|listening`，原先一律回写作首页）；造句句首字母自动大写（`formatChunkDisplay` 加 `capitalizeFirst`，只大写答题区首 token）；模考态造句按钮 `embedded ? "提交" : "完成并查看结果"` + 顶部「第 X/Y 题」；错题本返回键移右上对齐全站。
  - **模考过程不再泄露答案**：`AdaptiveExamShell` 内联答题组件加 `revealAnswers`（默认 false）门，提交后不再染红绿/显示正确答案；内部判分与自适应分流不变，复盘仍在历史记录。同步收紧填空 `maxLength`（`missingLen+2` → `missingLen`）并移除内联填空的回车直接提交。
  - **模考续考**：新增 `lib/mockExam/adaptiveCheckpoint.js`（section-keyed、2h TTL、仅 module1/2）。`AdaptiveExamShell` 在进度里程碑落盘（timeLeft 走 ref 不每秒写；guard 跳过「整模块刚答完」瞬态保证 `currentItemIndex===results.length`，恢复不重复计分）；intro 提供「继续上次模考 / 重新开始」，退出保留、交卷/重开/新开清空。
  - **造句自由导航**：去 `disabled={!allFilled}`（可跳题），保留「上一题」；`recordAndSaveCurrent()` 让 goBack 离开即记录避免丢答案。曾加的题号索引条按真考无此功能移除（`992016e`，删 `jumpTo`/`navStrip`/`bs-nav`）。
  - **学术文章词汇题高亮**：新增纯函数 `lib/reading/vocabHighlight.js`（`getVocabTargetWord` 解析题干 `The word/phrase "X"`、`splitForHighlight` 整词大小写不敏感切分、共享 `VOCAB_HIGHLIGHT_STYLE`，8 单测）；接入 `MCQInlineTask`（模考）+ `RDLTask`（练习），仅当前题为 vocab-in-context 时高亮。
- **听力节奏 + 回放** (`0f35211` + `ea3e27a` + `697b6fa` + `1d6ea46` + `15c1c8e`)：答题计时改为音频结束后才起、按题型配速；练习/模考移除重播按钮 + 加「真实考试只播一次」提示；LCR 结果复盘加回放音频按钮；LCR 答题计时缩短到 15s。
- **历史记录复盘** (`9d441ef` + `7f2bdea` + `0d6614c`)：听力模考记录逐题复盘；修复听力/写作练习记录题目内容不显示；模考成绩页引导去练习记录看逐题详情。
- **AI 评分稳定性** (`23ede3c`)：DeepSeek 传输层瞬时失败有界重试，减少偶发评分失败。
- **其它**：每日 AI 额度服务端计量（`e0b7f27`，`/api/ai`）；IAP webhook 签名常量时间比较（`9b0c89a`）；progress 视图抽取共享 trend chart / bandColor / StatCard（`7dff11f` + `2ad4e57`）；first-set 问卷 V1对比/新用户变体重设计（`2e9e0d1`）。

## 2026-06-02 — v1.8.1

- **听力音频上线即可播放（v1.8.0 题库刷新后三连修复）**：新增 419 条音频后，线上音频经历三步才真正可播——
  - `1f03530` 先把 `data/listening/audio` 挪到 `public/listening-audio`（CDN 静态，不再被 `/api/audio` 的 `readFileSync` 拖进 serverless 函数 → 避开 Vercel 250MB 上限），672 条 `audio_url` 重指，`/api/audio` 改 308 跳转保留旧链。
  - `2920fe5` 进一步把全部 853 个文件搬到 Supabase Storage 公开桶 `listening_audio`，`git-rm` 本地音频 + gitignore，部署体积归零（250MB 上限再无法触发）。
  - `0f304a1` 补 CSP：`media-src` 漏加 `https://*.supabase.co`（之前只改了 connect-src）导致 `<audio>` 被浏览器拦截，补齐后听力音频恢复加载；口语走 speechSynthesis + blob 录音不受影响。
  - `eb3734a` 修每日 backfill 把新题音频写成死的本地 URL：根因 (1) `lib/tts/storage.js` 的 `getAdmin()` memo sentinel 初值 `null` 让 `_admin !== undefined` 守卫首调即短路，Supabase 上传路径在所有环境都是死代码；(2) `backfill-audio.yml` 没注入 Supabase 凭据。改 sentinel 为 `undefined` + 注入 secrets + 加 preflight/per-upload 硬失败（`TTS_ALLOW_LOCAL=1` 才允许本地）防止再悄悄回退。
- **阅读真考双栏布局** (`6f25605`)：`RDLTask`（练习 RDL + 学术文章）与 `AdaptiveExamShell` MCQ（自适应模考 RDL/AP）改为「左原文 | 右题目」双栏独立滚动，对齐真实托福界面；CTW 填空与听力保持单栏；`<=768px` 堆叠回单栏。
- **旧库退役为 V1 + 历史精确重练** (`ff762a4`)：题库 swap 到 V2（`6d737d1`）后，swap 前的练习记录打「V1题库」chip——`isV1Session`（`lib/history/bankVersion.js`）**按日期判定，非 id**，因 email `em*` id 在 V1/V2 间碰撞但内容不同。「再练一遍（同题）」改用一次性 `sessionStorage` 快照 handoff（`lib/history/retry.js` → `WritingTask` 预置）精确还原原题，不再 resolve `retryPromptId`（对 V1 会 404 + 误命中碰撞的 email id）。新 session 盖 `details.bankEpoch` 供未来精确判定；含 email id 碰撞的单测 + `WritingTask` 集成测试。
- **微信群二维码** (`568fc34` + `66637d4` + `3b50220`)：刷新过期失效的群二维码；`WechatGroupModal` 改用共享 `WechatQrImage` 组件（点击全屏放大），与首页侧栏统一——这是最后一处内联 QR `<img>`，至此放大行为全站一致；补提交此前未跟踪、导致 Vercel 构建 module-not-found 的 `WechatQrImage` 组件文件。
- **题库体验问卷 round v2** (`b2e6b1f` + `f0b4336` + `25c2fd7`)：借题库刷新对**所有**用户（含已答 round-1 的）重新发问卷，survey_type 升到 `first_set_completion_v2`（`lib/survey/firstSetSurveyType` 共享常量；`unique(user_code, survey_type)` 保留 round-1 数据为独立行）。门控只数 realExam2026 上线后（`FIRST_SET_SURVEY_SINCE = 2026-06-02T03:06Z`）完成的 session，避免返场用户一进页面即弹（实测可少误弹 36 人，符合「first-set」语义）。新增「再做两套看看」snooze（再完成 2 套自动重弹、再关则永久消失，至多一次；存为 `{snoozePending,baseline}` 标记行，无 schema 变更，且不计入 admin 跳过/完成统计）+ 首页侧栏（桌面 NavSidebar + 移动端，仅登录态）蓝绿渐变「填写题库体验问卷」入口，经 `window` 事件桥（`lib/survey/openFirstSetSurvey`）随时打开。admin `/api/admin/surveys` 加 `?round=`（current/previous/all）重新可查 round-1 的 17 份历史回答。

## 2026-06-02 — v1.8.0

- **整库重造并整体替换上线**：用 realExam2026（2026 改后真考）重新校准的 prompt 全新生成了全部 12 个题型、~938 道题，一次性替换原线上库（旧混版库已备份于 `data/newBank/.backup-2026-06-02T03-05-18-047Z/`，可回滚）。
- 生成走 plan→fan-out workflow：每题型独立 writer，planner 预分配互斥切片防同波撞题；跨波多样性靠 `print-bank-prompt` 注入的 live∪newBank 排除（`NEWBANK_ROOT`）+ `dedup-newbank` 内容去重兜底。`scripts/merge-staging.mjs` 增加 id 兜底（无 id 项不再坍缩为单条"重复"）。
- BS 修复两层：(1) `validateQuestion` 新增 `incoherent_dialogue` 门——问句答案必须回应、不得复读，豁免 `task_kind="ask"` + 元指令；(2) direct-question 校验对齐两轮对话模型（`isConversationalDialogueTurn` 放行陈述开场），BS 集合做 chunk/prefilled 重叠修复 + `validateRuntimeQuestion` + 集合门组装。
- 迁移：线上库中 2026-05-31 校准边界之后由 routine 自动产出的题，经当前全套校验器复核 + 去重后并入新库（+214 非 BS / +45 BS）；879 道旧混版 BS 正确排除。
- 音频：419 条新听力/口语题用 edge-tts 补齐，听力 364/364、跟读 308/308，100% 覆盖。
- 上线前接口验证：`jest` 全 319 个测试通过 + 逐题型渲染字段核对（阅读读 `correct_answer`、听力读 `answer`、interview 嵌套 `questions[].question`）+ id 覆盖 100% + 预检 0 非法（含 App 运行时检查）。
- 新增 `components/home/BankUpdateModal.js`：登录后首次进首页自动弹出，告知题库已全部更新（localStorage 标记，只弹一次）。

## 2026-05-22

- 修复阅读模考记录无法查看的问题：根因是 `842cd85` 合并冲突把 `f531a90` 的会话保存格式回退了。`AdaptiveExamShell` 用 `type: "adaptive-reading"`（无 `details` 字段）写入历史，而 `ReadingProgressView` 入口卡片只筛 `type: "reading"`，记录虽在但首页显示「暂无记录」。同时修了 `ReadingSectionContent` 的 `readingCount` 漏统计 legacy 类型。
- 新增模考完整诊断视图，替换原 band/M1/M2 简版摘要：
  - `AdaptiveExamShell` 现在保存每个 task 的快照（itemId、原文、题目、用户作答、正误），单次模考 ~30KB；CTW 还额外捕获用户输入的字符以支持错题对照。
  - 新组件 `components/reading/MockSessionDetail.js`（~900 行）+ `useReadingAiExplain.js` 复用 `useBsAiExplain` 模式，提供 Pro-gated AI 题目解析（localStorage 缓存，键 = `qid|selected|correct`，相同错误跨用户共享解释）。
  - `SessionRow` 0/0 兜底：mock 子类型走 `m1.correct + m2.correct` 汇总，top-level `correct/total` 缺失时也能正确显示。
- 双栏布局重构（仿写作 ProgressView）：模考记录挪到左侧 320px sticky sidebar，点击在右侧主区切换到详情面板，不再就地展开撑爆列表。stats 卡片去掉 mock tab，趋势图改为只画 practice 避免段位/百分比混轴。`<960px` 自动切单列堆叠。`entries` 用 cloud-id-or-array-index 一次性构建，让 `normalizeReadingSession` 的对象引用变化不破坏删除/选中追踪。
- 详情面板对齐写作 `FullMockReport` 设计：header 含返回按钮、`阅读详细诊断报告` 标题、日期、CEFR/换算分/路径 chip pill、右上角 34px `OVERALL BAND` 大字号（按段位上色）、小图标删除按钮；主 tab 按 task type 切换（概览·总体 / CTW / RDL / AP），动画用 `slideInRight 0.5s` + `tabFade 0.3s` 都走 `cubic-bezier(0.16,1,0.3,1)`。固定 viewport 高度 `100vh - 110px`，header + tab bar pin，内部 content 滚动。
- 阅读做题页主按钮颜色对齐 section 蓝色 accent：shared `<Btn>` 默认背景是 `C.blue`（实际是绿色 `#0d9668`，命名遗留），CTWTask 的「提交答案」「重新作答」、RDLTask 的「提交全部」「下一题（未提交态）」都内联 override 成 `#3B82F6`。ReadingProgressView 侧栏 h1→p 的 margin 简写归一，避免 `margin: 0` 覆盖 `marginTop: 4`。

## 2026-05-20

- 修复阅读 RDL（Read in Daily Life）短版 / 长版切换无效的问题：之前不管选「短版 · 2 题」还是「长版 · 3 题」，进入练习后都拿到 3 道题。
- 根因是过去一次合并把 `app/reading/page.js` 的题库 import 改回了旧的单文件 `rdl.json`（仅 8 题，全 3 题），但 `?variant=short|long` 的 URL 路由 + UI 切换 + `handleNewItem` 的引用都没跟着回退；其中 `RDL_SHORT_DATA` / `RDL_LONG_DATA` 在「新题」按钮上还会触发 ReferenceError。
- 重新引入 `rdl-short.json`（83 题 ×2Q）和 `rdl-long.json`（89 题 ×3Q）双文件，提取 `rdlPool(variant)` helper，让随机抽题、id 查找、练习模式选题器、「新题」按钮 4 处都按 variant 走对应题库；useEffect 依赖加入 `variant`，切换时立刻重新随机。

## 2026-05-19

- 修复阅读完形填空（CTW）错题本中"你的答案"显示错误，现在正确展示用户输入的字母。
- 修复阅读/听力自适应模考各模块独立计时，进入 Module 2 时倒计时正确重置。
- 修复听力模考练习记录未保存的问题，听力/阅读模考结果现在会写入练习历史。
- 修复阅读模考题目分配蓝图，与 TOEFL 2026 规格对齐。
- 新增听力题目作答倒计时（每题限时），与真实考试节奏一致。
- 练习历史新增模式标签（练习模式 / 挑战模式），记录更细分。
- 错题本扩展至阅读和听力部分，含分类标签。

## 2026-05-15

- Fixed a speaking-module microphone permission mismatch seen in real use:
  - Allowed same-origin microphone access in `Permissions-Policy` so the speaking pages can use `getUserMedia` after the browser grants permission.
  - Updated Repeat and Interview tasks so SpeechRecognition failures are shown as transcription/scoring availability issues instead of misleading users into reopening microphone permissions after recording has already started.
  - Verified the production build with `npm.cmd run build`.

## 2026-05-13

- Fixed a batch of known issues surfaced by lint + test gates:
  - E2E suite was unrunnable due to a `**/` sequence inside a block comment in `e2e/smoke.spec.js` closing the comment early. Fixed the example so Playwright can load the file again.
  - Resolved 22 `react-hooks/rules-of-hooks` violations across `useBsAiExplain.js`, `LCRTask.js`, `ScoringReport.js`, and `AdaptiveExamShell.js` — Hooks are no longer called after early returns.
  - Removed `eslint.ignoreDuringBuilds` from `next.config.js` so Hook errors and other lint failures now block production builds.
  - Rebalanced 13 failing Build Sentence sets (28, 29, 31, 35, 36, 37, 41, 43, 45, 47, 51, 53, 55) so `npm run validate:bank` passes.
  - Excluded `.claude/` and `.agents/` from `jest.config.js` ignore patterns to stop duplicate test runs from worktree copies.
  - Corrected Task 1 / Task 3 ordering in the JSON-LD `featureList` (`app/layout.js`) so structured data matches the README and homepage (Task 1 = Build a Sentence, Task 3 = Academic Discussion).

## 2026-02-19

- Added unified admin hub page:
  - New route: `/admin`
  - Central entry for admin dashboards.
- Added access-code administration system (private beta control):
  - Admin page: `/admin-codes`
  - Server APIs: `app/api/admin/codes/route.js`, `app/api/auth/verify-code/route.js`
  - Supports generate / issue / revoke flows with server-side token auth.
- Added legacy-code compatibility:
  - Existing codes in `users` can be auto-activated into `access_codes` on first login.
- Added API failure feedback dashboard:
  - New page: `/admin-api-errors`
  - New API: `app/api/admin/api-errors/route.js`
  - `/api/ai` failures are persisted for troubleshooting.
- Added SQL schema updates for ops:
  - `access_codes` table and RLS policy.
  - `api_error_feedback` table and indexes for failure diagnostics.
- Localized admin UI to Chinese and improved admin UX:
  - Clearer button feedback and error prompts.
  - Added links between admin pages and return-to-hub navigation.
- Fixed Build Sentence duplicate-content issue in one session:
  - Enforced set-level uniqueness check in `lib/questionSelector.js`.

## 2026-02-15

- Fixed Build Sentence slot-count mismatch bug by enforcing runtime invariants:
  - `slotCount = answerOrder.length`
  - `bank.length === answerOrder.length`
  - `answerOrder` must be a permutation of `bank`
  - `givenSlots[].givenIndex` range validation
- Added question normalization/validation in runtime session init to prevent broken UI states.
- Refactored Build Sentence architecture:
  - extracted `useBuildSentenceSession` (state machine)
  - kept `BuildSentenceTask` focused on rendering
  - introduced shared sentence engine `lib/questionBank/sentenceEngine.js`
- Unified render/scoring behavior by routing both through shared sentence assembly logic.
- Added regression coverage:
  - init invariant test (`__tests__/build-sentence-init.invariant.test.js`)
  - 20-question flow guard in component tests
  - input normalization coverage in save-bank tests
- Updated `README.md` with runtime invariant notes.
