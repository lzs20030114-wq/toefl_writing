# 真题整卷蓝图与「装回整卷」（realBank sets）

> 解决的问题：机经源是一套一套的整卷，但录入管线按题型分文件落库、前端也按题型练，
> 于是「后台的题都不是成套的」。本文回答两件事：① 2026 改后每套卷各题型到底是多少题、
> 什么配比；② 怎么把拆散的题装回整卷（`scripts/realbank/assemble_sets.mjs` → `data/realBank/sets.json`）。

## 一、每套卷的结构（题数 / 配比）

来源不是官方说明书，而是 79 套机经卷的**题号页眉**（"Reading Question 21 of 35"）——
录入时每道题的 id 都保留了「卷 / module / 题号」（`real_lcr_121b_1_01` = 1.21B 卷 · Module 1 · 第 1 题），
所以整卷结构可以从题库自身反推，且每条都能在 `data/realBank/sets.json` 里逐题核对。
页眉的 of-T 全库只出现过 35/15（阅读）、32/15（听力）、11（口语）、12/10/2（写作）六种
（`scripts/realbank/ingest_common.py` 的 `VALID_TOTALS`）。

| 科目 | 总题数 | Module 1 | Module 2 |
|---|---|---|---|
| **阅读** | 50 | **35** 题<br>A 型：填词 Q1-20（2 篇×10 空）· 日常阅读 Q21-30（4 篇短文，2+2+3+3）· 学术段落 Q31-35（1 篇×5）<br>B 型：填词 Q1-20 · 日常阅读 Q21-25（2 篇，2+3）· 学术段落 Q26-30 **和** Q31-35（2 篇×5） | **15** 题<br>填词 Q1-10（1 篇）· 学术段落 Q11-15（1 篇×5）<br>**M2 没有日常阅读** |
| **听力** | 47 | **32** 题<br>短应答 Q1-12（12 题）· 对话 Q13-18（3 段×2）· 通知 Q19-24（3 段×2）· 讲座 Q25-32（2 段×4） | **15** 题<br>A 型：短应答 Q1-3 · 对话 Q4-7（2 段×2）· 讲座 Q8-15（2 段×4）<br>B 型：短应答 Q1-7 · 讲座 Q8-11 · 2 题短材料 Q12-13 / Q14-15（通知或对话） |
| **口语** | 11 | 听后复述 Q1-7（7 句）· 模拟面试 Q8-11（4 问） | — |
| **写作** | 12 | 造句 Q1-10（10 句）· 邮件 Q11 · 学术讨论 Q12 | — |

按题型折算，**一套完整卷需要**：

| 题型 | 每套 item 数 | 每套题数 | 备注 |
|---|---|---|---|
| ctw 填词 | 3 篇 | 30 空 | M1 两篇 + M2 一篇，每篇恒 10 空 |
| rdl 日常阅读 | 2~5 篇 | 10（A 型）或 5（B 型） | 每篇 1~3 题，A 型典型 2+2+3+3 |
| ap 学术段落 | 2 篇（A）/ 3 篇（B） | 10 或 15 | 每篇恒 5 题，只从 Q26 / Q31 / M2 Q11 起步 |
| lcr 短应答 | 15（A）/ 19（B） | 15 / 19 | M1 12 + M2 3（B 型 M2 7） |
| lc 对话 | 5 段（A）/ 3~5 段（B） | 10 | M1 3 段 + M2 2 段，每段 2 题 |
| la 通知 | 3 段（A）/ 3~5 段（B） | 6 | M1 3 段，每段 2 题；A 型 M2 没有通知 |
| lat 讲座 | 4 段（A）/ 3 段（B） | 16 / 12 | M1 2 段 + M2 2 段（B 型 1 段），每段 4 题 |
| repeat 复述 | 1 套 | 7 句 | |
| interview 面试 | 1 套 | 4 问 | |
| bs 造句 | 10 | 10 | 卷面 1→10 大致由易到难 |
| email / disc | 各 1 | 各 1 | |

本库观察到的版式分布（2026-09-09）：阅读 M1 A 型 47 套 / B 型 16 套；听力 M2 A 型 20 套 / B 型 1 套
（B 型只在 1.21C 见到，疑为自适应的另一档；判定只看有没有 26 起步的学术簇 / 4-7 的短应答，
缺了那段的卷会默认成 A 型，所以 B 型是下限）。

两条与现有代码不一致、需要知道的事：

1. **模考 planner 的结构与真卷相反。** `lib/mockExam/readingPlanner.js` 让 M1 出 20 题
   （CTW 10 + RDL 5 + AP 5）、M2 出 30 题，真卷是 M1 35 / M2 15 且 M2 没有 RDL；
   `listeningPlanner.js` 的 M1 只有 10 LCR + 1 LA + 1 LC（12 项），真卷是 12 LCR + 3 LC + 3 LA + 2 LAT（32 题）。
   已记入 docs/BACKLOG.md。
2. **入库时的 ap/rdl 路由靠字数（≥160 词 → ap）**，会把长篇日常阅读错标成 ap（如 `real_ap_325_1_23`，起步 Q23、3 题）。
   蓝图按位置修正：M1 只有 Q26-28 / Q31-33 起步的才是学术簇，其余落在 Q21-30 且 ≤3 题的按日常阅读处理
   （`positionType`）。库文件本身没改，只在装卷时修正。

## 二、装回整卷：`scripts/realbank/assemble_sets.mjs`

```bash
node scripts/realbank/assemble_sets.mjs              # 写 data/realBank/sets.json + 当日报告
node scripts/realbank/assemble_sets.mjs --dry-run    # 只打印摘要
# 可调：--skeleton-min 0.3（低于此完整度的卷直接拆成素材）--full-min 0.9（拼齐门槛）
```

零 LLM、确定性、可重复；每次 `build_bank.mjs` 落库后重跑一遍即可。

**默认「同源不借」**（2026-09-09 用户拍板）：拼卷 = 原卷自己有什么就是什么，一道外来题不借；`--borrow` 才启用下面描述的借题拼卷。
默认模式下两件事撑起产量：

- **跨套重复别名还回原场次**：复核清单（review-holds.json）里 scope=unit 且带 `dup_of` 的下架条目（212 条，阅读 188 / 听力 22 / 写作 2）
  是「同一篇材料在两场考试都出现、库里只留一份」。被下架的 id 仍编码着它在自己那场的 module/题号，
  装卷时原位还回、内容指向保留的那份（`items[].alias_of` = 被下架的原 id，`id` = 库里那份）。这不是借题：那场考试确实考了这篇。
- **题型套 `type_sets`**：一套 = 该场考试该题型的全部题（按卷面顺序），如实标 `got/need`，`status` 沿用槽位语义
  （full = 每槽满；near = 每槽满或只差 1 题；partial = 有槽缺得更多）。单元素题型（email/disc/repeat/interview）一题一套，不另出。

**两层产出：**

1. **原卷（`sets[]`）**：每套源卷按蓝图槽位逐槽回填，给出每科每 module 每槽的
   `status`（full / near=只差 1 题且槽位 ≥4 题 / partial / empty）与完整度。缺的是「M2 学术段落」而不是「3 题」。
2. **拼卷（`composites[section][]` + `exams[]`）**：
   - 按完整度排队，强的卷当**骨架**；< `skeleton-min` 的卷一开始就拆成素材；
     中间的排队，若轮到之前被更强的卷借走了题就整卷拆散（lazy dissolve）。
   - 空槽从素材池借**同类型同规格**的题：拼盘卷 `rp*`（国内线下拼盘，没有卷面题号，只能当素材）、
     被拆散的弱卷、骨架卷里塞不进槽位的富余题。借题优先同题簇（source-flags 的 duplicate_cluster——
     那本来就是同一批考题）、再按考试日期就近。
   - 拼盘里 28 句的复述 / 19 问的面试按考试规格切成 7 句 / 4 问一份（`split` 字段记母题与句 id）。
   - 带槽（lcr 12 份、bs 10 位、rdl 10 题）按份数/题数补满；bs 优先补同题号位（保住难度梯度）；rdl 不许超题数。
   - 单元槽（一篇/一段/一套）空了才借；残缺严重（partial）的换成更完整的，换下的回捐；near 的不动。
   - **「拼齐」= 总完整度 ≥ `full-min` 且每个槽至少 near**（缺一整段对话、缺讨论题的都不算齐）。
   - 每道借来的题带 `from`（来源卷）/ `via`（pool / dissolved / leftover / displaced）；`purity` = 骨架自有题占比。
   - 四科同源都拼齐 → `exam:<slug>`（native）；否则各科剩余完整卷按日期顺序配对 → `exam:mixed-NN`。

**只借不造**：借不到就留缺口如实写进 `missing`，不会把 4 题的学术段落假装成 5 题（那种记 near）。

### `sets.json` 形状

```
{ blueprint_version, generated, params,
  inventory: { ctw: {items, questions}, … },          // 各题型库存
  pool_items, forms_observed, summary,                // 摘要
  sets: [ { set, slug, date, sections: { reading: { completeness, got, need,
              modules: { 1: { form, got, need, slots: [ { key, type, band, need, got, status, items: [{id,nq,q}] } ] } },
              unplaced: [] } } } ],
  type_sets: { lcr: [ { id: "lcr:121b", type, set, date, need, got, status, items: [{id, alias_of?, nq, module, q, slot}] } ], lc, la, lat, ctw, rdl, ap, bs },
  composites: { reading: [ { id: "reading:rf0620", base_set, date, forms, completeness_before, completeness,
              complete, purity, borrowed: [{slot,id,nq,q,from,via,split?}], modules, missing } ], … },
  exams: [ { id, kind: "native"|"mixed", base_set, date, sections: { reading: "reading:rf0620", … } } ],
  exam_leftover, residue, unanchored }
```

`composites[*].modules[*].slots[*].items[*].id` 是 `data/realBank/*.json` 里的原 id（拼盘切分的是 `母id#cN`，
`split.ids` 列出句/问 id），消费方按 id 回查题面即可，`sets.json` 本身不复制题面。

## 三、2026-09-09 首跑结果

完整报告：`data/claudeGen/reports/REALBANK-SETS-2026-09-09.md`。

| 科目 | 有题的卷 | 原生就完整 | 拼齐 | 其中纯原卷 | 瓶颈 |
|---|---|---|---|---|---|
| 阅读 | 65 | 2 | **29** | 2 | 填词 87 篇 ÷ 3 = 29 套上限，已打满；多数学术段落被盲审剔了 1 题（4/5，算 near） |
| 听力 | 21 | 0 | **9** | 0 | 对话 lc 只有 47 段 ÷ 5 = 9 套上限（短应答/讲座还剩 49/23 条没用上） |
| 口语 | 19 | 5 | **19** | 5 | 面试原卷只有 7 套 + 2 套恰 4 问的拼盘；另 8 条拼盘面试大集已按话题**人工切成 23 套**（`interview-splits.json`，24 问尾巴不入库），interview 库 17 → 32 套 |
| 写作 | 39 | 1 | **7** | 1 | 学术讨论只有 7 题（邮件 14）；造句能凑 27 套 |
| 整卷 | — | — | **2 native + 5 mixed** | — | 受写作（讨论题）卡死 |

要提高整卷数，补料顺序是：**听力对话（lc）> 学术讨论（disc）> 邮件（email）**（面试拆分已做）。
其余题型库存都够 16 套以上。

**同源不借 + 别名还回后的题型套**（2026-09-09 第二次跑，`--borrow` 关）：

| 题型 | 一套规格 | 有题的场次 | 齐 | 只差一点 | 残缺 | 别名还回前「齐」 |
|---|---|---|---|---|---|---|
| 短应答 lcr | 15 道 | 21 | 3 | 4 | 14 | 3 |
| 对话 lc | 5 段 | 17 | 1 | 0 | 16 | 1 |
| 通知 la | 3 段 | 21 | 16 | 0 | 5 | 9 |
| 讲座 lat | 4 段 | 21 | 15 | 1 | 5 | 7 |
| 填词 ctw | 3 篇 | 42 | 11 | 0 | 31 | 5 |
| 日常阅读 rdl | 10 题 | 67 | 27 | 17 | 23 | 11 |
| 学术段落 ap | 2~3 篇 | 66 | 2 | 33 | 31 | 0 |
| 造句 bs | 10 句 | 39 | 6 | 7 | 26 | 5 |

「只差一点」的学术段落 33 场几乎全是每篇 4/5 题（结构化漏抽 1 题），补抽漏题后会整体变「齐」。

**审查时改过的两条判据**（2026-09-09 自审）：
- 拼盘面试机械按 4 问切会把两场面试缝在一起（rp0704 第 5 问开头就是 "I'd like to discuss your views on renewable energy"，
  且 19 / 15 / 11 问的都有，边界对不齐 4 的倍数）→ 脚本不自动切；改为**人工逐题读出切分表**
  `data/realBank/speaking/interview-splits.json`（8 条大集 → 23 套，`lib/realExam/interviewSplits.mjs` 按表拆，
  `build_bank.mjs` 在 applyReview 之后自动应用，单独跑 `node scripts/realbank/apply_interview_splits.mjs`）。
  复述只切 7 的整数倍（28 / 21 / 14），16 / 31 句的整条作废等人工切。
- 8 道被入库路由错标成 ap 的日常阅读（topic 落成 email / notice / schedule / poster / website）按体裁改回 rdl，
  阅读因此从 27 套涨到 29 套（上限）。

## 四、补题清单（用户 2026-09-09 拍板「先找题，能补就补」）

源料本身九成以上完整（体检配对：阅读 2514/2650、听力 2305/2491），缺口主要是管线丢的。按收益排：

| # | 缺口 | 量 | 怎么补 | 在哪跑 | 状态 |
|---|---|---|---|---|---|
| 1 | 跨套重复被下架 | 阅读 188 篇 + 听力 22 段 | 装卷时按 `dup_of` 原位还回（别名） | 仓库，零成本 | ✅ 已做 |
| 2 | 学术段落每篇漏抽 1 题 | 122 题（33 场因此「只差一点」） | 结构化阶段对 flagged 单元按答案键题号补抽（`structure_set.mjs` 的 repairUnit 已有此机制，需对 4/5 的组再跑一轮修复；仍失败的用原图重抽） | 本机（.codex-tmp + DeepSeek 少量费用） | 待做 |
| 3 | 对话判不出性别被扣 | 34 段 | `lc_gender_worksheet.py` 听音标注 → 覆盖表 → 重跑合流 | 本机，约半小时 | 工具已就绪 |
| 4 | 4/5 月 16 套没跑 | 整卷 | `run_pipeline.mjs --all --resume` | 本机，约 ¥26 | 待充值 |
| 5 | 填词答案词首被截 | 13 套 × 30 空 | 用题干词首 + 答案残片机械还原；需先看几条原始残片定规则 | 本机（要源 PDF） | 待设计 |
| 6 | 听力无音频 | 18 套 | 源缺，只能补料 | — | 源缺 |

跑完 2~5 任一项后：`build_bank.mjs` → `apply_interview_splits.mjs`（build_bank 已自动调）→ `assemble_sets.mjs`，题型套数字自动更新。

- 前端「题型套」入口：按 `type_sets[type]` 列卡片（第 N 场 · 日期 · got/need），点进去按 items 顺序连做；`alias_of` 只影响归属显示，题面按 `id` 回查。
- B 型（阅读 M1 双学术簇 / 听力 M2 七短应答）是否对应自适应的高/低档，需要更多样本或官方说明确认。
