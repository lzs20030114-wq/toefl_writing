# 挂起事项统一清单 (BACKLOG)

> 汇总全仓库范围内散落在各会话记忆 / 报告 / 分支里的待办、待决策、待验证事项。
> 风险等级：[高] 安全/资损/数据丢失风险 [中] 影响体验或成本 [低] 打磨/卫生类

## 需用户决策

- [高] 真题自动录入上线前置（2026-09-09 实施完成未推送，契约 docs/realbank-ingest-contract.md）：①跑迁移 `scripts/sql/real-bank-ingest-jobs.sql` 并登记；②GitHub secrets 五个（DEEPSEEK_API_KEY / DASHSCOPE_API_KEY / OPENAI_API_KEY / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY），其中 OPENAI_API_KEY 的 GitHub secret 从未验证过；③Vercel 核对 GH_PAT(actions:write+contents:write)/GH_OWNER/GH_REPO；④中间产物桶 `real_bank_artifacts` 已由本机 `artifacts_sync.mjs --push` 灌满（清单 structured 数必须 ≥ 81，否则云端全量重建会清库——worker 另有 >20% 缩水拒推闸）；⑤云端首航用后台「手动 rebuild」（不碰源文件）验证 pip/ffmpeg/push 权限，再拖第一套真卷；⑥Supabase Storage 逼近 1GB 免费档，源文件桶 done 后自动删，仍建议先清 382MB 孤儿音频。
- [中] `/api/ai` 线上成本护栏两处（出处：2026-09-05 DeepSeek 9/1 账单 ¥11.97 溯源，见 docs/deepseek-usage-ledger.md）：
  ① 生产库缺 `increment_daily_usage` RPC——Supabase edge 日志 8/31 实证 `POST /rest/v1/rpc/increment_daily_usage → 404`，`scripts/sql/daily-usage-quota.sql` 台账状态「历史迁移,状态未知」即从未跑过；计量退化到 `fallbackIncrementUsage` 读-改-写，并发可击穿免费 3 次/天。走 /sql-migrate 补跑并登记。
  ② `callAIMulti` 默认 `samples=3` + `maxTokens` 上限 8192，一次计量 = 3 次 DeepSeek 调用；Pro 日限 100 → 单人单日最多 300 次大 token 调用，无成本封顶。决策：按调用次数（而非提交次数）计量，或 Pro 日限按 samples 折算。
- [高→已恢复,余手动一步] 盲审 routine：R2(19:30)/R3(20:00) trigger 已重建且每晚运行(2026-08-01 均有 fired 记录)，原「停摆」条目过时。**剩余动作：R3 prompt 需手动替换为 v2**（docs/routine-prompts/audit-r3-v2.md，agent 无权改 http_api 创建的 trigger）——v2 告知 R3「听力被 merge-staging fail-closed HOLD 是设计行为，21:00 的 merge-listening-audited.yml 负责第二票+合库」，不换 R3 也能安全跑但可能对 held 多折腾。旧积压 staging 可在 L1 修复后用 workflow 手动 dispatch run_id=all 全量扫尾（id/内容双去重防重复入库）。
- [中] 备考计划云同步生效前置：`scripts/sql/study-plan-fields.sql` 迁移未跑未登记（代码 fail-open 已上线，跑完自动生效无需重部署；生效前不进用户公告）。出处：commit 513ed7d。
- [高] 认证模型改造：6位码 bearer 可爆破（`app/api/auth/verify-code` 限流是内存滑动窗口，Vercel 多实例不全局生效）+ legacy 码自助升级仍在（同文件自动 upsert `legacy=pro`）。出处：PROJECT-REVIEW-2026-06-17，2026-07-05 复核仍在，未修复。
- [中] v1.11.0 线上冒烟未做（12 题型导入→练习全链路，重点 edge-tts 首次 Vercel 真实环境跑通）+ `DASHSCOPE_API_KEY` 是否已在 Vercel Production 环境勾选未确认。
- [中] 语音全库切换 gpt-4o-mini-tts 的 go/no-go：成本报价已出（全库一次性 ¥117，增量满勤 ¥50/月，2026-07-05 实测），只差 `/admin-voice-vote` 票数；lat/la/lcr persona 推广、音色定稿后重新生成听力库均挂在此决策之后。
- [中] 插入题专属 UI 立项与否：2026-07-05 复测确认数据面已清零（154/154 恰 4 个 ■ 标记+双重校验兜底），但渲染复用通用选择题壳（■ 是普通字符，肉眼数方块选 ABCD），无"点方块插入"原生交互。接受现状 or 立项做专属组件。
- [中] 2026-07-05 合并的支付修复 + CTW 防呆是否发版（用户可见变更：升级按钮修通 + CTW 灰底 chip；走 /release-notes）。
- [低] 模考 6.4 残项：#13 邮件排版（等参考图）/ #2#3 全屏与顶栏（等定范围）/ #18 三科合考（用户已 defer）。

- [中] 真题专区复核余项（2026-09-07 全库复核，报告 data/claudeGen/reports/REALBANK-RECHECK-2026-09-07.md，清单 data/realBank/review-holds.json）：①音频：切句 bug（a.m. 被劈开）已修，真题 23 条 + 生成库 79 条音频已作废待补配（本机 render_real_audio / Actions backfill-audio）；②`real_ap_511_1_26#2` 答案键 D vs 独立作答 C，对原截图核；③LC 说话人对调 4 条已改题干放行（rf0620_2_06 拆轮后待本机补配 1 条音频），rf0808_2_04 / rf0808_2_06 另有截断仍扣；④放行任何一条 = 删清单行 + 本机重跑 build_bank（成品已过滤，源料在 .codex-tmp）；⑤题池阅读 parse 阶段要保住段落分隔（本次 5 题因「paragraph N」无从定位被扣）。
- [中] 真题录入二期两项口径待拍板：①~~BS 造句真题——写作 PDF 上的乱序词块边界已被 OCR 糊掉，只能做成「真题句子 + 本站切块」~~ **不成立，已关（2026-09-14 核实）**：那只对 realExam2026 的 `scrambled_ocr` 文本成立；`extract_bs_pages.py` 直接看截图读块边界（块间大间隔可辨）+ 机械校验（答案句须由模板给定词 + 词块按序恰好拼出），09-08 起 38 套 328/367 过校验；09-14 让它认合订卷（按 OCR 缓存找造句页）又补 14 套 113 题过校验、去重后 +75（专区造句 281→336 题 / 36→44 套），无需任何来源分档拍板；②听力/口语音频路线——用户已拍板上传原始机经音频到 Supabase（版权风险自担、1.1GB 需先清理 382.8MB 可回收音频或迁 R2），但听力题面链路未达标（见「进行中」），是否先只上口语 repeat。

- [高] 真题丢题全科口径（2026-09-14，报告 data/claudeGen/reports/REALBANK-LOSS-SYSTEMIC-2026-09-14.md）：
  新账本 `node scripts/realbank/loss_ledger.mjs` 给出真实完整度 **4327/8280 = 52.3%**
  （旧口径 84.8% 是因为 47 套卷的听力、46 套口语、30 套写作在 sets.json 里整科缺席、压根没进分母）。
  代码侧已修（预算按题型放开 + 预算形自动重试 + 单块超时不再整卷作废 + 合流快照同步），
  **数据侧一步没跑**（云端没有 .codex-tmp 与 API key）。建议顺序（报告 §6）：
  ①【不用拍板，先做】**944 题**（管线丢题 585 + 整科跑了归零 359）本机扫 flagged 块回收：
  `node scripts/realbank/loss_ledger.mjs --plan` 出按阶段排好的可粘贴作业单（写作 61 套 /
  阅读 23 套 / 听力口语 23 套）。**第 0 步零成本**：作业单每条都带 `--dry`，`--dry` 在任何模型
  调用前返回，只报还有几个失败块可重扫；报「没有需要处理的块」= 这卷这科在中间产物里根本没有
  题块，缺口在 ingest/对齐层而不是重扫能解决的 —— 这本身是有用的诊断，要记下来。
  ~~先跑写作的邮件/学术讨论靠重扫~~ **更正（2026-09-14 本机实测，已在分支补录完）**：54 套 `--dry` 全是
  「没有需要处理的块」—— structure_set 根本没有邮件/讨论路由（靠答案页题号对题，这两题没有标准答案）。
  改走补录账本：同批卷的这两题早在 realExam2026 校准时抽过，逐条对原卷截图核对/转写后记进
  `data/realBank/writing-recall.json`（scripts/realbank/writing_recall.js 头注）→ `build_bank --only-writing-recall`。
  结果：邮件库 14→44、讨论库 7→37（真题专区 27→57 / 132→162），整卷槽位 email 9→67、disc 7→58，
  全库 4327→4436（基线已重冻）；同一道题只收一条、其余卷记别名（writing/id-aliases.json）。
  抽查+全量核对发现旧抽取有截断/串人/改写（约 1/4 条有实质差异），上线的 60 条已全部按原卷改正。
  写作整科被源料体检扣下的 6 套（2.23/2.8/3.10/3.24/3.29/4.18，扣留码只涉及答案页 / 造句题面）用户拍板**只放行邮件与讨论**（造句照扣），
  新增 3.24 / 3.29 两道讨论，其余是重复题记别名；3.10 的「写作.pdf」实为听力文件，原卷无写作题。
  **剩余未收**：3.11（原卷无署名）/ 3.18、2.23（原卷看不到课程名，旧数据的课程名是按话题推的）/ 5.23（截图切掉提问句）四道讨论。
  **造句 bs 的 341 题不能靠重扫**：题面来自 extract_bs_pages.py 看图产出的 `<卷>.bs.json`
  （写作 PDF 无文字层）。~~还卡着「词块边界被 OCR 糊掉」未决项~~ 已核实不成立并补完合订卷（见上方二期口径①）。
  **阅读救回的题必须补盲审**（`audit_answers.mjs "<卷>" --section=reading --only-missing`），
  否则被 build_bank 的阅读闸当场丢掉；写作不用。
  **听力/口语那 250 题不在作业单里**（报告 §7）：合流跑过后这两科归合流所有，两边块 key 格式零重合，
  重扫会变成整科全量付费重跑且产物出现两份；正文来自商家逐字稿 + ASR 对齐、音频是商家原声（388/440），
  扣题原因全判在合流层。要补走 lc_gender_worksheet 标性别 → 重跑 merge_first_source_asr。
  ② 听力/口语「整科没跑过」2096 题（听力 1755 / 口语 341）：**建议先只铺 1 套确认有音频的卷试水**，
  实测单套花多少、盲审过多少，再决定剩下约 20 套铺不铺——听力的钱全在 TTS，且 `--all` 有烧钱坑。
  ③ `run_pipeline.mjs` 的 `SECTIONS` 放开到四科：**建议现在不动**，等 ② 的实测单价再说
  （`--only-failed` 直接调 structure_set 已够用，放开只省几行命令却把听力并进常规产线）。

- [中] **造句真题：跨卷重出的题已放出来（2026-09-14/15），剩下 157 槽是真缺内容、都要本机跑**：
  ETS 真实地循环出题（实测 4.1 有 9 道与 3.21 重复、5.6 有 7 道与 4.15 重复，132 条全是跨卷重复、
  没有一条是同卷内重复），而 build_bank 的答案句去重**只丢不记** —— 那些槽被账本算成缺题、
  前端那几卷少题、整卷都是重复题的卷（4.1 / 5.6 / rf0902 / 3.20）连卡片都不出现。
  已按邮件 / 讨论同一套机制记别名：`scripts/realbank/bs_aliases.js` → `writing/id-aliases.json`
  （造句那批多带 from_source / from_date —— 那几卷库里一条自己的题都没有，没有这两个字段
  assemble_sets 的「slug → 卷名」表查不到、别名会被整条丢掉）。三个来源共 186 条：
  ① 管线去重丢的 132；② 整卷写作源文件相同的 18（3.20 ← 3.15、rf0902 ← rf0716）；
  ③ **真题 ground truth 对照 36**（`data/realExam2026/writing/buildSentence.json` 记了哪一场考过哪句，
  源料体检把写作整科扣下的 2.8 / 2.23 / 3.24 / 3.29 / 4.18 全靠这条路才有题 —— 用户拍的
  「造句照扣」扣的是**那几卷自己的题面**，这里一道题面都不用它们的，服务的是干净卷那一份）。
  落别名按「不冲突才落」：这一卷已有同题 / 库里没这个答案句 / GT 的题号被现有 id 占了，三种都跳过。
  本次数据由 `bs_aliases_backfill.mjs` 回填（云端没有 .codex-tmp 跑不了全量重建），
  下次 `build_bank` 全量重建会原样重写这份文件。
  结果：bs 槽位 351→533（50.9%→77.3%），真题专区造句 336→545 题 / 44→61 套，基线已重冻。
  **剩余 157 槽（都要本机的 .codex-tmp 与源料）**：
  ① **造句一律走看图，不是重扫**（2026-09-15 本机实证）：把账本列的 10 套「管线丢题」按
  `structure_set --only-failed` 全重扫一遍，bs 入库量 533→533、一题没多。原因是结构性的 ——
  写作 PDF 没有文字层，structured 的 build 段只有 `{n, sentence}` 答案句，重扫拿到的还是答案句，
  build_bank 照样按 thin 丢掉。账本 `--plan` 的作业单早写着「真题造句（bs）的 68 题：走看图，不是重扫」，
  归因表把它们记成 pipeline_loss 只是因为那几块确实 flagged，对造句没有分辨力。
  ② 所以 68 + 42 + 47 三桶对造句是同一件事：`extract_bs_pages.py` 识图补题面。
  ③ **但识图也已经没页可识了**（2026-09-15 本机实测）：`--dry-run` 报「52 套共渲染 333 页，
  待识图 0 张」—— 能识的页全在缓存里。剩下的缺口卡在另外两处：
  · **只有 52/69 套有写作页可渲染**，另外 17 套根本没料（3.10 的「写作.pdf」实为听力文件）；
  · **识图拿到了题面、却过不了机械校验的 65 题**：no_solution 34 / no_answer_sentence 15 /
    duplicate_chunks 10 / too_many_spare_chunks 3 / missing_template 1 / duplicate_q 2。
    （`_fuzzy_word_ok` 13 不是拒收，是模糊匹配救回的，已计入通过 —— 打印现在把两者分开了。）
  已修两处，**零成本、--no-ocr 重跑即可生效**：
  · GT 答案句原先按「日期 + 卷别后缀」反推 id，而 A 卷的 id 根本不带 `-A` 后缀 ——
    1.21A / 1.27A / 1.28A / 2.1A / 3.2A 五套一条都取不到，1.21C 少一条，合计 49 条被吞（454→504）。
    改成按 source（卷名）精确匹配，并把第二份 GT（buildSentence.json，另有 2.8 五条 / 4.20 三条）一起读。
  · 答案页那条拼不出解（no_solution）时，用 GT 的转写再试一次 —— 答案页是 OCR 的（全小写无标点、
    实测带 broshure 这类错字），GT 是人工转写的校准锚。机械校验不变，GT 句拼不出照样拒收
    （实测 GT 拿错题的句子来也会被拒），所以不会放进任何拼不出的题。
  实测（本机 --no-ocr 重跑，零调用）：通过 441 → 448，no_answer_sentence 15 → 1，
  _gt_answer_ok 救回 1 条；但 no_solution 34 → 41 —— 新接上的 7 条答案句拼不回那一屏的题面，
  正是「两个来源同一个题号说的不是同一道题」（3.6 那种）。
  · 于是又加了第三级回退：**同卷全部 GT 挨个试，只认唯一解**（多条能拼出就作废 ambiguous_gt_scan）。
    机械闸够严，「同卷里恰好只有一条能拼出」本身就是强证据；题号仍以截图那一屏为准。
  · **54 条硬拒收已逐条归因**（明细 data/claudeGen/reports/BS-REJECTS-2026-09-15.json，
    `extract_bs_pages.py --no-ocr --report-out <路径>` 可随时重出）：
    ① **26 条 识图漏了一个小词块**：答案句里有题面给不出的词，其中 18 条只差 1 个词
    （3.6 那 4 条差 2~7 词，是它那几页合订卷页匹配错了，另案）。漏词位置在句首/句中/句尾
    分布是平的（25/22/12），**没有句尾偏向 → 改 prompt 治不了**。call_qwen 是 temperature 0，
    **同模型重识必然拿到同样结果**（这 ¥0.46 会白花），只剩换模型一条路，收益不保。
    ★ 不许「知道缺哪个词就把词块补上」—— 真题那一屏里这个词是独立一块还是跟别的块粘着，
      我们无从知道，补出来就是编题面。识图只负责认字。
    ② **15 条 卡在「词块必须互不相同」**：10 条 duplicate_chunks + 5 条「同一个词答案要用两次」
    （2.1C q2 两个 I / 2.23 q2 两个 the / 3.23 q1 与 4.24 q1 两个 is / 3.29 q3 两个 my /
    3.8 q2 两个 I）—— 后者即使识全了也会撞同一条闸。**这是最大的可治桶，但要动数据模型**（见下）。
    ③ 判据侧已修两处（全角标点 / 词内空格错位），实测救回 2 条、判坏 0 条。
  · **duplicate_chunks 那一桶要动数据模型，先别碰**：判分侧没问题（evaluateBuildSentenceOrder 比的是渲染出的词序），
    卡在数据模型 —— 词块现在就是字符串，`runtimeModel:273` 要求 bank 无重复、`answerOrder ⊂ bank`
    靠字符串相等配对。要支持两个相同词块得把词块改成 {id, 文本}，波及 runtimeModel + sentenceEngine
    + 拖拽组件 + 全部题库，是单独一件要拍板的事。
  ③ 源料缺陷 47：3.10（原卷「写作.pdf」实为听力文件，无写作题）+ 2.23 / 3.29 / 2.8 等卷里
  GT 也没记到的那些题。**GT 明确记了、但库里连答案句都没有的还有 45 道** —— 这 45 道是
  「确知存在、题面没抽出来」，是 ①② 最该优先扫的目标。
  这三步按顺序过五道手续（重扫 → 识图 → `build_bank --only-bs` → `assemble_sets` →
  `loss_ledger --freeze`），已经包成一条命令：`node scripts/realbank/bs_recover.mjs`
  （默认只预检 + 打印计划；`--run` 真跑，识图默认只报价、加 `--ocr` 才花钱；
  跑完对账，入库量掉了就拒绝重冻基线）。
  **两件待人工对原卷的**：
  · **3.6 的卷归属对不上**：GT 说 3.6 有 8 题（q1~q8），库里 3.6 却是另外 3 道（bs_36_03/04/07），
  两边同一个题号说的不是同一道题；GT 那 8 道里 3 道在库里挂 1.21C 名下、2 道挂 5.3、1 道挂 5.10、1 道挂 4.27。
  一卷最多 10 题，两边不可能都对 —— 大概率是 09-14「让识图认合订卷（按 OCR 缓存找造句页）」那次把页
  匹配到了邻卷。要对原截图核；在核清楚之前，GT 那 4 道撞号的按上面的口径跳过了（没抢号）。
  · **8 题看得见摸不着**：2.23（3 题）/ 3.29（1 题）/ 2.1新托福真题C卷（4 题）不足
  `REAL_BS_MIN_BATCH=5`，整卷不进专区。3.29 只有 1 题、2.23 只有 3 题，正是这道闸当初要拦的
  「1~3 题碎卡」，所以闸维持 5 不动；等 ①②③ 把这几卷补过线即可。

- [✅部分完成 2026-09-14] 阅读「选项残 = 整题作废」的死循环（2026-09-14，报告 REALBANK-INGEST-AUDIT-2026-09-14.md §7）：
  三层口径不一致——`PROMPTS.mcq` 明说「也可能是 3 个」、`verifyMcq` 放行 3~5 个（status=ok）、
  `build_bank.optionsMap` 却要求恰好 4 个否则整题作废。后果：被 OCR 吃掉一个选项的题
  ①先花结构化的钱 ②再花盲审的钱 ③落库时静默丢弃 ④因为状态是 ok，`--only-failed` **永远不会重扫它**
  → **永久困死，重扫也救不回**，这解释了为什么反复补题某些篇子始终补不满。
  **已修**：`verifyMcq` 改成「恰好 4 个否则 flagged」（三份逐字副本同步 + 第三份纳入防漂移测试），
  prompt 删掉「也可能是 3 个」并加重反编造措辞，+9 条测试。依据：线上 690 阅读 + 773 听力题全是 4 选项。
  ~~①落库丢弃计数落账~~ **已做（2026-09-14）**：`data/realBank/drop-ledger.json`（scripts/realbank/drop_ledger.js，26 处闸逐题记账，
  与终端计数逐项对得上），loss_ledger 新增归因桶「落库丢弃」—— 原「管线丢题」764 题里 455 题其实是落库时被闸扔的，
  全口径：落库丢弃 611 / 管线丢题 309。**待做**：②`real_ap_21b_2_12` 插入题选项是正文碎片而非 [A]~[D]（26 道里 1 道）。
  **AP 那 36 题已拆清（2026-09-14，drop-ledger + 复核清单 + 结构化产物逐题对）**：
  插入句题 12（结构化没给文字选项被判「选项数 0」—— 走 insert-markers / insert_promote，**别重扫**：插入题本就没有 4 个文字选项，
  `--only-failed` 会每块白花一次钱，真凑出 4 个反而是编造）/ 拼盘题池 rp* 8（无卷面题号，本就不按 5 题一篇）/
  盲审不一致 6 / 复核下架 6（5 逐题 + 1 整组）/ 结构化误路由 2（1.28B、2.1C 的 M1 Q35 被当成填词块、输出不是 JSON）/
  点选句子题 1（3.18 M2 Q14，账本里有未挂上）/ 对齐层无题块 1（1.28A M1 Q29）。
- [中] **真题阅读缺题 483 → 313 → 241 → 211；学术阅读（AP）实际缺题 38 → 26 → 22（2026-09-15，报告 REALBANK-LOSS-SYSTEMIC-2026-09-14.md §12 / §12.3 / §12.4 / §12.5）**：
  本轮找回 AP 12 题（401→413）：Stoicism 与 4.6 M2 两篇按原卷截图逐字重录正文后解除下架（4.6 查出模型补写句子）、rf0826 模块 2 合并表头解析修复、
  5.10_v2 插入句题经人工核定放行（新机制 data/realBank/audit-overrides.json，每条写核对依据）；
  答案页印错 4 题（3.30 M1Q32 / 3.8 M2Q15 / 4.20 M2Q13 / 5.11 M2Q15）用户拍板按四方互证的核定答案收（verdict key_corrected，两票盲审须与核定字母一致）。
  **AP 剩 22**：插入句题源料缺屏 5 + 标记校验不过 3（1.28A M1Q30 首个 ■ 在全文最前 / 3.23 M2Q15、5.6_v2 M2Q15 覆盖率 0.88）/
  选项源料缺失 2（1.28B M1Q31、1.28A M1Q32：题干末词被排进选项位）/ 截图浮窗遮挡选项 2（4.6 M2Q12、Q14）/ 复核下架 6 / 源里没有 3 / 点选句子 1。
  另：RDL 盲审不一致 3、CTW 1.28A M2 第 6 空答案页重复、对齐层无块（3.2B·3.24·4.20 CTW、4.29 选择题答案页缺）未动。

## 进行中
- [中] DeepSeek 余额告警（出处：2026-09-09 排查 502 时在 /admin-api-errors 看到 9/5 22:21–22:24 三条 **402 Insufficient Balance**，即账户欠费过一次，用户侧同样只看到「评分服务暂时不可用」）：建议 nightly-quality-monitor 或后台首页加余额/402 计数告警，欠费与网关故障要能分开。
- [低] `/api/ai` 直连路径 2026-09-09 已改流式拼接 + 快速 5xx 单次重试 + `fail()` 不再丢上游原文（修前后台「详情」列一直为空）。**待验证**：下一次晚高峰观察 api_error_feedback 里 stage=deepseek 的 error_detail 是否带 `upstream 5xx:` 前缀；若仍成批出现且原文是 503 overloaded，下一步把 samples=3 在重试时降为 1 路。

- [✅完成] L1 存量库答案全量二审（2026-08-02）：覆盖 ~1593 题（LCR 413 + 阅读听力 7 库），5 轮 DeepSeek 盲审 + 多轮 agent 分诊 + 人工复核。**改键 26**（LCR 16 角色反转 + AP 9 insert_text 时序 + RDL 1）+ 数据毛病 2 + CTW 指示代词歧义 117 题系统性重挖 + 挖空器闭集跳过根治。lat/lc/la/rdl-short 零实锤。完整报告 data/claudeGen/reports/L1-answer-audit-20260802.md。**遗留（低优先，非阻塞）**：①CTW 10 项低危残留（2 validator + 8 长尾歧义，各 1/10 空双解，合库层 CTW auditor 对未来题兜底）；②AP 11 + CTW 18 题因 DeepSeek 反复超时未被二审覆盖（顽固 error 项，可在后续 full-audit-l1 dispatch 顺带续扫，L1-state 断点续跑只重试 error）。**衍生新条目见下「AP insert_text 生成侧缺陷」**。
- [中] AP insert_text 生成侧缺陷：L1 二审在 AP 库查出 9 处 insert_text 答案错序（例子/回指置于概括句之前），且多题 explanation 自曝「Wait…」「retained per the plan」——说明生成期对插入题的自检形同虚设。已逐一改键，但**生成侧未修**：需在 AP 生成 prompt/校验里加插入题时序自检（回指词需前置先行词、例子在概括之后），否则新出的 AP 插入题仍会复发。出处：L1-answer-audit-20260802.md。

- [中] 真题录入管线（二期，`scripts/realbank/`，2026-09-06 阅读一期首批落库）：四阶段 对齐(零token)→DeepSeek结构化→盲审→落库，答案来自机经卷自带答案 PDF（LLM 只转写不解题）。**已完成**：解析器修复后全库确定性配对 5577/5387 答案条目（+1011）；阅读 4 套试点盲审 92%（58/63）；`data/realBank/reading/` 首批 AP/RDL/CTW 已接进 `/real-bank?type=ctw|rdl|ap`；管线有余额预检 + 系统性失败不写文件 + 一代备份 + `--resume` + 跨卷 hash 去重。**待办**（按序）：①铺量 54 套 `run_pipeline.mjs --all --resume`，实测每套约 ¥1.26（结构化+盲审，reading+writing），全库约 ¥60–70，跑完再 `build_bank.mjs` 落库 + 发版公告；②盲审 <90% 的卷进人工复核队列（复核清单在 `.codex-tmp/realbank/<卷>.audit.json`）；③CTW 还原产率低（4 套 13 段仅 4 段过结构化，DeepSeek 对分栏 OCR 的填词还原失败率高）需改 prompt/分块；④听力**不能上线**：一屏两题 OCR 串栏导致选项错位（A/B 对照证实是数据坏不是审法），根治要改 OCR 切块；⑤口语 repeat 已零 token + 音频已切片（3.10 验证），可作二期首个音频题型；⑥`.codex-tmp/realbank/` 全部中间产物不在 git 里，无备份。出处：memory realbank-ingest-pipeline.md。

## 可派工

- [中] **听力逐句点播（点原文一句 → 只放音频那一句）**，契约 docs/listening-sentence-timings.md。
  2026-09-18 代码侧已做完：①产线随 `audio_url` 写 `sentence_timings`；②存量对齐工具
  `scripts/align-sentence-timings.mjs`（fetch → asr_words.py 词级转写 → 对齐写回）；③前端逐句可点
  （历史页 LADetail/LCDetail + 练习结果页，真浏览器验过）。**数据侧已完成（2026-09-18 本机跑完）**：存量 1473 条音频
  （生成库 753 / 真题 TTS 54 / 真题原声 666）用 `node scripts/align-sentence-timings.mjs` 补齐，
  写入 1460 / 拒绝 13 / 缺转写 0（GPU medium.en 转写 109 分钟）；生成库四个库 100%，真题 lcr 100% / lc 96.6% / la 90.9% / lat 96.8%。
  遗留：①拒绝的 13 条全是真题原声（lc 4 / la 6 / lat 3），whisper 带 VAD 只转出开头旁白「Listen to a…」、正文被吞，
  对齐器 fail-closed 不写——可试对这 13 条关 VAD 重转（jobs.json 里加 `no_vad`）再 `--phase=apply`；
  ②`real_lcr_128a_1_04/11/12` 三条原声在 original-audio.json 里没有同 id 条目，时间戳只写在题库上，build_bank 全量重建会丢。
  体积：`text` 是原文再抄一遍，全量 raw +820KB / gzip 仅 +84KB（同文件里的原文让 gzip 基本抵消），
  已按「直接进题库 JSON」实施；若日后嫌大再搬 sidecar，契约不变。
  ④个人题库也已做完（edge WordBoundary + 按 mp3 帧时长平移各段，写回 data.sentence_timings，无需迁移）。

- [中] 真题阅读缺题找回残余（2026-09-13，报告 data/claudeGen/reports/REALBANK-AP-RECOVERY-2026-09-13.md）：①第二来源 rf*/rp* 22 卷的 13 个 flagged ap/rdl 块，`<卷>.json` alignment 为空、`structure_set --only-failed` 够不着且 GT 不覆盖，要走 parse_reformatted 侧另立方案；②AP 每篇上限 5 挡下 11 道跨卷并入的真题（consolidation.json 的 over_cap 清单），要「并集全留」改 consolidate_reading.js 的 MAX_QUESTIONS.ap；③（09-13 第二轮已按考卷位置归位 26 篇，此项关闭）；④5 条曾下架的题干因别卷同篇副本被救回而重现（非 hold 失配），复核清单补跨套重复条目；⑤`audit_answers --second-vote` 走 pro 模型但台账按 ¥5.24/M 估价，偏低。**第二轮残余（同一报告第二部分）**：⑥选择题 7 道找不到源截图、插入题 29 道找不到那一屏且 14 道标记表无对应正文、点选句子候选多数卡在宿主段落结构（无分段/多切一刀）或保留方是拼盘副本；⑦基线 CTW 13 簇跨卷重复未下架（需先给 CTW 做旧 id 别名兼容）、基线 116 段 CTW 正文未做看图忠实度核对（第二轮发现模型会编补丢失的句子）；⑧`/progress/reading` 通用历史页对归位的旧记录仍显示旧题型，后台 `lib/admin/realBankStats.js` 仍按旧 id/题型统计；⑨合并判据盲区：标题与首段粘连（3.29 Opal）时聚不成簇，若清单没下架另一份会双份在线；⑩工具坑：`audit_answers.mjs --only-q` 不带 `--only-missing` 会清空该卷全部阅读盲审条目。

- [中] **听力对话（LC）人工标性别放行**：第一来源合流里 34 段 A/B 对话因基频判不出「先开口的是男是女」被整段扣下（对话回收率 45%，是听力整卷/题型套的第一瓶颈，见 docs/realbank-set-blueprint.md §三）。工具已就绪：`merge_first_source_asr.py --all`（产物给被扣对话留 turns_raw）→ `lc_gender_worksheet.py --list --csv lc-gender.csv` 出待听清单（音频角色、起止秒、前两句）→ 听音填 male/female → `--apply` 回填 `data/realBank/listening/lc-speaker-overrides.json` → 重跑 merge / build_bank / assemble_sets。需在本机（源音频与 .codex-tmp 都在本机），约半小时；预计对话 47 → ~81 段，听力可拼套数 9 → ~16。
- [✅完成 2026-09-09] **真题按题型组套（同源不借）**：assemble_sets 默认 `--borrow` 关，`type_sets` 按场按题型出套并如实标 got/need；跨套重复下架的 212 条按 `dup_of` 原位还回（别名）。结果与补题清单见 docs/realbank-set-blueprint.md §三/§四。**补题清单 09-10/11 已执行完**（分支 claude/question-bank-reassemble-g5bvce，报告 data/claudeGen/reports/REALBANK-RECOVERY-2026-09-10.md）：CTW 87→116、AP +12 插入题、LC 47→63；题型套齐 ctw 11→16 / ap 2→9 / lc 1→3。**待做**：前端题型套入口；待拍板项见报告 §7（■ 不首尾判据挡 9 道、跨套去重吞 4 道已找回插入题、两票不一致人工放行、1.21C/1.27A 10 段对话需人工切轮次）；**09-11 听力改「原声优先」已落地**：435 条里 385 条挂上商家真人原声（+TTS 旁白，规范见报告 §9），50 条源料问题保持 TTS（原因清单在 data/realBank/listening/original-audio.json 的 skipped，可拿去找商家补录）；商家若能按 6 月起格式（逐题音频 + A/B 标签）重出 1–5 月，第一来源听力可从 83%→~96%。
- [中] **真题整卷消费**：`scripts/realbank/assemble_sets.mjs` 已把拆散的真题装回整卷（`data/realBank/sets.json`：原卷完整度 + 拼卷 + 整卷清单，2026-09-09 阅读 29 / 听力 9 / 口语 19 / 写作 7 套拼齐，整卷 2 native + 5 mixed；拼盘面试已人工切成 23 套入库）。前端真题专区仍按题型进，需要一个「整卷 / 单科整套」入口按 `exams[]` / `composites[]` 的 id 回查题面；蓝图与用法见 docs/realbank-set-blueprint.md。补料优先级：①听力对话 lc（9 套上限）；②学术讨论 disc（7）> 邮件 email（14）；③5 条不是 7 整数倍的拼盘复述大集（rp0705 16 / rp0718 31 / rp0719 22 / rp0819 8 / rp0830 8 句）人工切分。
- [✅完成 2026-09-09] **模考 planner 结构对齐 2026 真卷**：阅读 M1 35（CTW 20 + RDL 10 + AP 5）/ M2 15（CTW 10 + AP 5，无 RDL），听力 M1 32（12 LCR + 3 LC + 3 LA + 2 LAT）/ M2 15（3 LCR + 2 LC + 2 LAT，两路构成相同）；构成/题数/计时唯一真源 `lib/mockExam/modulePlans.js`，IntroCard 与首页模考卡题量改为派生。2026-09-09 用户拍板「全部对齐真考」：①阅读段按真考 30 min 座位时长（ETS 公布 18–27 min 对应 35–48 题；机经全卷 50 题取 30 min，与听力 29 min 同口径），按题数比例切 21 + 9 min；②评分改为每题等权（ETS 未公布模块权重与原始分换算，等权即各模块按题数占比），lower 封顶 4.0 不变，结果页权重改为派生显示。

- [高] 点数周期刷新机制（**开 CREDITS_ENFORCEMENT_ENABLED 前必须**）：①季/年卡每 30 天补发 100 点（webhook 只发首期）；②活跃周期内续费被跳过的点数补发（webhook 日志可 grep `active period, skip` 出欠账名单，iap_entitlements 是 ground truth）；③CREDITS_ENABLED 翻开前的购买补发。出处：2026-08-01 提价接线（commit 6804b146）。
- [中] 加量包（50/150/400 点）定价按 deepseek-v4-flash 真实单次成本校准 + 购买链路接线——enforcement 开启后才需要上架。出处：PRICING-USAGE-PLAN-2026-07-13。
- [中] Interview 口语接入生产线：live 库仅 11 题（全题型最少），但 interview 不在 routine 12-bank 名单里（2026-05-31 校准时 deferred，无校准 prompt）——需先走校准流程（realExam2026 锚 + eval-spec）再入名单；按需出题 demand 文件会把它标为 `not_in_routine` 跳过。**前置依赖：上方「盲审 routine 停摆」拍板**（口语库合库通道本身停着）。出处：按需出题机制自审 2026-07-15。
- [中] referral 奖励无上限 + 一次性邮箱可无限薅 3 天 Pro（email-login 自动发放）——需先定防滥用策略，再实施节流/校验。
- [低中] gate harness 推广：`scripts/cli/enforce-gates.mjs` 仍是 REPORT-only，未接入生产 merge 流程；更多题型待接入注册表；语义判分门尚未设计。
- [低] IDOR 端点复查后的修复（feedback / mistakes / entitlements / speech-consent 等端点，具体清单见 PROJECT-REVIEW-2026-06-17）。
- [中] 听力模考自动播放偶发卡「缓冲中…」（用户 2026-09-12 桌面 Chrome 本地 dev 截图：第 4 题 play 按钮未变暂停、进度条不走、须手点播放/开始答题；用户自己浏览器复跑又正常，已搁置）。已查到两条线索：① `components/mockExam/AdaptiveExamShell.js:930` 首次渲染就读 localStorage 断点（`useState(() => loadAdaptiveCheckpoint)`），服务端无断点→hydration 不一致→React 丢树重渲，页面留下两个 body 级 audio 元素（生产静默重渲同样发生），应改为 mount 后再读；② 听音阶段常驻「开始答题」按钮+「没声音请点播放」提示，真考没有，用户会当成必须点。复现要点：`ended` 后控制器 preload 下一题，第 N 题 play 后只有 loading 无 playing 事件（watchdog 4s/15s 才报 error→TTS 兜底）。修法建议：断点读入移到 effect；听音阶段只留被拦截时的恢复层；给 play→playing 超时加一次同元素重试再报错。
- [低] 模考壳 AdaptiveExamShell 交卷/超时路径没有显式 `examController.stop()`，停音目前**间接依赖** AudioPlayer 卸载（2026-09-11 修「退出后共享音频继续播」时发现，AudioPlayer 已修，壳未动）；在 handleFinish / 超时 finalize 里补一行 stop() 是零风险保险丝，防将来播放器跨结束态保持挂载时漏音。
- [中] 860 条孤儿听力音频清理（Supabase storage）：清库删除的重复条目各有独立 audio_url，id 清单在 `data/claudeGen/reports/dedup-removed-ids-2026-07-07.json`。
- [中] admin「部署到正式题库」按钮接入 validator+gate（当前零校验旁路，同题不同判）。出处：QUESTION-PIPELINE-REVIEW-2026-07-07 §2.3。
- [中] 出题管线审查 P1/P2 余项（BS 干扰词 0%/82%/10% 定案、答案位/最长项批级校验、~~听力 auditor 接线~~ ✅2026-08-02 已完成、LCR 范式配比、监控加固等）：完整清单见 QUESTION-PIPELINE-REVIEW-2026-07-07 §7。
- [低] `__tests__/realbank-artifacts-sync.test.js` 2 例在 HEAD 上就是红的（upload 失败没收敛成 `SyncFailure`，
  抛的是普通 `Error`）：2026-09-14 排查丢题时发现，stash 掉全部改动后照样红，与那轮改动无关，未修。

- [低] 仓库卫生：
  - 5 个已合并 worktree + 孤儿目录 `cranky-lehmann` 清理
  - 已合并分支清理
  - `.github/workflows/fix-legacy-prompts.yml` 删除（一次性脚本，确认已执行过且无后续用途后可删）
  - 约 25 个一次性脚本归档至 `scripts/legacy/`
  - （以上均为破坏性操作，需用户批准后再执行；本次任务未做任何删除）
  - `generate-bs.yml` / `generate-disc.yml` / `generate-email.yml` **不可删** — 见下方"调查 A"结论，仍被 `app/api/admin/generate-*/route.js` 通过 `lib/generateConfig.js` 主动 dispatch。

## 写作评分大修 code-review 遗留（2026-07-12）

> 本次已修（六连修，见 MEDIAN-SCORING-VERDICT-2026-07-12 与修复 commit）：短邮件封顶被
> holistic_lift 旁路 / 批注空 remap 回退返回 AI 复述 / 引号字形漂移丢批注 / adjusted 标记
> 不一致 / 多采样部分失败无日志 / 重复扫描。以下为 review 确认属实但有意推迟的清理项
> （发版前不动刚验证过的结构；均无正确性影响）。

- [低中] 模型名 `"deepseek-v4-flash"` 三处独立硬编码（`app/api/ai/route.js` / `scripts/scoring-gate.mjs` / `scripts/calibration-test.js`，另 generate-* 脚本群也有）——闸门号称跑生产本体但模型名是抄的，下次换模型只改 route 会让闸门静默测错模型。抽共享常量（CJS 可被 ESM 具名导入）。
- [低中] 评分预算耦合仅靠注释：writingEval 请求 6000 ≤ route MAX_TOKENS 6144 无共享常量/断言，单边改动只会在运行时炸 400。与上一条同批抽进共享配置。
- [低] `scripts/scoring-gate.mjs` 的 `loadEnvLocal()` 换用 `scripts/ops/_shared.mjs` 已有 `loadEnv()`（还白得 .env 回退）；median 助手与 calibration-test.js 重复（2 处）。
- [低] `app/api/ai/route.js` POST 四分支（proxy/直连 × 单/多采样）可收敛为共享 fan-out helper——注意直连单采样路径有「与旧版逐字等价」的兼容承诺（有测试锚定），重构需保字节级行为。
- [低] scoring-gate.mjs 锚/探针两个近重复循环可抽共享 runFlows；calibration-test.js 三个类别循环可并一。
- [低] `lib/ai/writingEval.js` 等生产模块用无扩展名相对 import，裸 Node 不可解析，scoring-gate 靠 resolve hook 垫片（已在 eval-spec 实现注记记载）——长期解是给 lib/ai 内部 import 补 .js 扩展名。

## 低优先级排队

- [低] 打卡三件套：树苗成长形态 / 移动端卡片 / goal 云同步（2026-06-12 flame v1 上线后无进展）。
- [低] BS 疑难搁置项（2026-06-17"太难修了先搁置"，具体内容需会话考古确认后再细化条目）。

## 自适应模考超时修复 review 遗留（2026-07-12）

> 本次已修：误挂超时徽章 / 听力展开态位置下标 / 深链改带 session 身份 + 保存失败提示 / 弱项诊断排除全未答任务。以下为 review 确认但本次未修的余项。

- [中] 听力回看渲染器（`LCRDetail`/`LADetail`/`LCDetail`）缺「未作答」标注，与阅读 `MockSessionDetail`（有 `selected == null → 未作答`）不一致；根因是听力未复用 `MockSessionDetail`。出处：`components/listening/ListeningProgressView.js`。
- [中] checkpoint 中途退出仍丢当前题作答——collector 机制已在（`partialCollectorRef`），接进 `saveAdaptiveCheckpoint` 即可复用超时那套部分作答收集。出处：`components/mockExam/AdaptiveExamShell.js`（checkpoint effect）。
- [低中] `IntroCard` 题量为手写魔法串（如「20 题 (CTW 10空 + RDL 5题 + AP 5题)」），应由 planner 导出构成常量派生，避免与真实出题结构漂移。出处：`components/mockExam/AdaptiveExamShell.js` ~1211 + `lib/mockExam/readingPlanner.js` / `listeningPlanner.js`。
- [低] 阅读 `IntroCard` 5 盒奇数网格致「总计」盒孤儿半宽（视觉不齐）。出处：`components/mockExam/AdaptiveExamShell.js` ~1248，可给「总计」盒加 `gridColumn: "span 2"`。
- [低中] 三个 collector 与各 `handleSubmit` 判分逻辑重复（MCQ 的 `correctAnswer = q.correct_answer || q.answer` 已 3 份），可提取纯判分函数进 `lib/mockExam/timeoutFinalize.js` 单一真源。出处：`components/mockExam/AdaptiveExamShell.js`。
- [低] 深链消费 effect 与「⏱ 超时」徽章样式在阅读/听力两视图重复复制，可提取 `useMockDeepLink` hook + 共享徽章组件。出处：`components/reading/ReadingProgressView.js` + `components/listening/ListeningProgressView.js` + `components/reading/MockSessionDetail.js` / `MockTaskCard`。
- [低] `ResultsCard` 的琥珀超时提示（含既有「计时规则」框）可改用 `components/shared/ui.js` 的 `InfoStrip(tone="warn")` 统一样式。出处：`components/mockExam/AdaptiveExamShell.js` `ResultsCard`。
- [低中] `timeoutFinalize` 防御加固：`isValidPartial` 对 `item.id == null` 应 fail-closed（当前 `partial.itemId === item.id`，两侧同为 undefined 会误判通过）+ 交叉校验 `partial.correct === results.filter(isCorrect).length`。出处：`lib/mockExam/timeoutFinalize.js`。
- [低] 超时结算 effect 依赖数组仅 `[timeLeft, phase]`，读取 `m1Items/m2Items/m1Results/...` 靠每秒 tick 触发的闭包新鲜度隐式成立，脆弱；补全依赖或加注释锁定不变量。出处：`components/mockExam/AdaptiveExamShell.js`（auto-finish on timeout effect）。
- [低] collector 返回对象外层 `itemId` 为死字段（`finalizeTimedOutResults` 只读 `collect()` 返回的 `itemId`，外层 `collectorRef.current.itemId` 无人消费），三处可删。出处：`components/mockExam/AdaptiveExamShell.js`（CTW/MCQ/LCR 三个 collector）。
- [低] `handleM1Complete`/`handleM2Complete` 无内部幂等守卫，仅靠 `autoFinishedRef` + 调用点保证单次；未来若新增第三条结束路径易重复 `saveSess`（重复历史）。出处：`components/mockExam/AdaptiveExamShell.js`。

---

## 调查结论

### 调查 A：`generate-bs.yml` / `generate-disc.yml` / `generate-email.yml` 是否仍被引用

**结论：全部仍在用，不可删除。**

- `lib/generateConfig.js` 的 `TASK_CONFIG` 显式声明三者为 `bs` / `disc` / `email` 三个题型的 `workflowFile`：
  - `bs` → `generate-bs.yml`
  - `disc` → `generate-disc.yml`
  - `email` → `generate-email.yml`
- `app/api/admin/generate-bs/route.js` 中 `WORKFLOW_FILE = "generate-bs.yml"`，并在 `dispatches` 请求中拼接 `https://api.github.com/repos/.../actions/workflows/${WORKFLOW_FILE}/dispatches` 实际触发 GitHub Actions。
- 与其平行存在的 `nightly-generate-bs.yml` / `nightly-generate-disc.yml` / `nightly-generate-email.yml` 是**定时任务**（cron 触发的夜间批量生成），和上述三个**按需/管理后台触发**的 workflow 是两套不同用途，不是新旧替代关系，两者都要保留。

### 调查 B：`data/buildSentence/answer_hashes.json` 生成入口

**结论：有两个不同粒度的生成入口，均在 `scripts/` 内，非孤立文件。**

1. **增量维护（生产管线内置，随生成自动跑）**：`scripts/generateBSQuestions.mjs`
   - 读取：`loadAnswerHashes()` 从 `ANSWER_HASHES_PATH` 加载已有 hash 集合，用于跨批次去重。
   - 写回：`saveAnswerHashes()` 在生成流程中更新该文件。
   - 这是 `generate-bs.yml` workflow 实际执行的脚本（`run: node scripts/generateBSQuestions.mjs`），按理每次生成都会顺带更新，但从 mtime（2026-05-14）看，近期的生成可能未触发这条路径，或该次运行未落盘更新——需要进一步确认最近几次生成是否真的调用了 `saveAnswerHashes`。
   - **不要在本任务中执行**——涉及真实 DeepSeek 调用与题库写入，有副作用与成本。
2. **全量重建（一次性/离线维护脚本）**：`scripts/batch-produce.mjs`
   - 末尾有显式重建全量 hash 的代码块："Regenerate answer_hashes.json to cover ALL bank answers"：遍历 `finalSets` 里所有 `questions[].answer`，对每个答案做 `sha256(trim().toLowerCase())`，整体覆盖写入 `data/buildSentence/answer_hashes.json`。
   - **建议重生命令**（供后续派工时参考，本次未执行）：
     ```bash
     node scripts/batch-produce.mjs
     ```
     该脚本运行后会自动把 `answer_hashes.json` 与当时的 `finalSets`（含全量题库）对齐重建。执行前应确认脚本的其它副作用（是否会同时追加新生成的题目到 `questions.json`），必要时先读脚本头部的用法/环境变量说明，或加对应的"仅重建 hash 不生成新题"参数（如脚本支持）。
   - `scripts/batch-fresh-produce.mjs` 只是读取路径常量（`HASHES_PATH`），未在已读片段中看到显式写入调用，需要进一步确认其是否也会触发全量重写（如需要精确重生流程再深入读取该脚本全文）。

---

## 使用说明

发版/推送前须过一遍本清单；完成的条目移到文件底部 Done 区并标日期。

## Done

- 2026-07-07 出题去重全链路（分支 claude/question-pipeline-review-6p2bpt，待合 main）：合库层内容去重挂全题型 + 生成端排除改 bank∪staging（修 LAT 排除空转、RDL 补 exclude）+ 清除 8 库存量重复 1472 条（3083→1611，复测归零）+ `answer_hashes.json` 重建（590→612；原「重生」待办一并完成，旧台账与现库零重叠早已失效）。
- 2026-07-05 XorPay 金额对账（按分对账无容差，不符 403 拒发权益）+ webhook 顺序改"先授予后标 processed"（原顺序会致付钱不发货）——已合 main，jest 581 全过。
- 2026-07-05 五处升级按钮 `open-upgrade-modal` 死 no-op 修复（HomePageClient 全局监听 + speaking-exam 自持 modal）——已合 main。
- 2026-07-05 CTW 填词防呆修复（灰底锁定 chip + 键盘导航）cherry-pick 2b3f96c 合入 main（分支上过时的 v1.9.4 发版提交已丢弃）。
- 2026-07-05 产品 P0 复测：BS 干扰项已修（did 99.6%→14.6%，88 种）；模考评分失败清零 band 已修（"--"+错误文案+重试按钮）；插入题数据面已清零（UI 欠账转为上方决策项）。
