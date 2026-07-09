# Evaluation Spec — Reading · Read in Daily Life (`rdl`)

**沉淀说明（2026-07-09）**：审查报告批评「RDL 研究做了、没沉淀成标准」——本文件就是那次沉淀：
三个分析文件（`data/reading/profile/rdlDeepFlavor.json` / `rdlGapAnalysis.json` /
`rdlPitfallAnalysis.json`，2026-04-09 实测）的结论按维度整理成可执行标准。**目标值全部是
实测数，非拍脑袋**；本文件不引入任何新研究。

**参照语料（锚）**：`data/reading/samples/readInDailyLife/` — 57 组 / 166 题：
- **金层**：ETS Official Full-Length Practice Test 1 (2026) 等官方材料 6 组 / 16 题（tier=official）；
- **银层**：goarno.io 44 组 / 132 题 + 第三方备考 7 组 / 18 题（模仿 ETS 的备考商题）。
分析文件的统计以银层为主体（52 组/152 题口径）。**注意**：`data/realExam2026/` 下无 RDL
回忆卷（P2-16 锚点扩充仍挂起），所以本标准的置信级是「官方样本定性 + 备考商语料定量」——
比零锚强得多，但弱于其他题型的考场回忆锚。**全维度默认 monitor-only，不设冻结 hard-gate**
（gate-registry 要求 detector_precision≥0.95 且锚可信，两者均未达）。

**Current bank:** rdl-short 225 / rdl-long 136（07-09）。Builder：`scripts/generate-rdl.mjs` +
`lib/readingGen/`（含 excludeSubjects，2026-07-08 接入）。Validator：`rdlValidator.validateRDLItem`。
批级量尺：scoreBatch `reading-rdl-short` 38-62 词 / `reading-rdl-long` 80-150 词（2026-05-31 校准）。

> 任务形态：读一段日常生活文本（邮件/通知/社媒帖/说明），答 2-4 道选择题。文本压倒性地
> **指令型**（actionability: instructional 50 vs informational 1）——它在告诉你「做什么、
> 何时、何地、什么条件」，不是散文。

---

## Dimensions（目标值 = 参照语料实测）

### D1 — 字数带（分 variant） · **detector 已有（scoreBatch）**
- short 38-62 词 / long 80-150 词；官方 6 组实测 43-153、中位 140，与带一致。

### D2 — 每篇题数 · **detector 易加（validator 批级）**
- 目标 **3 题/篇**（官方 4/5 组为 3 题；语料整体 152/52 ≈ 2.9）。接受 2-4。

### D3 — 题型配比与序列 · **L2 抽样核对**
- 按正确项分析的题型占比：detail ≈55%、inference ≈28%、main_idea ≈12%、vocab-in-context ≈5%。
- 位置模式：Q1 以 detail/main_idea 开局（31/16），Q3 推理占比升高（inference 21）；
  高频序列 `main_idea→detail→detail`(12)、`detail→inference→inference`(9)。
- 病态信号：全 detail 无推理、或 vocab 题超过 ~10%。

### D4 — 正确项改写深度（防「原文照抄」） · **L2 抽样核对**
- 正确项与原文词重叠：detail 0.60 / main_idea 0.41 / inference 0.36 / vocab 0。
- 改写方式分布：**synthesis 66 > synonym 42 > direct_quote 25 > meta 18** ——
  主流是「跨句综合改写」，不是摘抄。生成题若正确项平均重叠 >0.75 = 照抄病。

### D5 — 干扰项构造 · **L2 抽样核对（部分可写检测器）**
- 干扰项与原文重叠 detail 0.50（和正确项 0.60 接近——**干扰项也必须「像是原文说的」**）；
- 陷阱类型（456 干扰项中标出）：entitySwap 37、exaggeration 23、dateSwap 12、partialTruth 6；
- **反直觉的关键指纹**：optionSpecificity 中「干扰项比正确项更具体」40 例 vs 反向 23 例——
  真题正确项常带 hedge、干扰项过度具体化。生成题若正确项总是最长/最具体 = 露馅。

### D6 — 选项间词汇独立 · **detector 易加**
- 选项两两词重叠 avg 0.035、词多样性 0.949——选项之间几乎不共词。生成题选项互相改一两个词 = 病。

### D7 — 答案定位分布 · **L2 抽样核对**
- 答案落点 first/middle/last third ≈ 28/46/37，whole_text 18，not_in_text 23（NOT 题与推理）；
- 答案证据跨度：single 55 / **multi-sentence 64** / whole_text 32 ——跨句综合是主流；
- 题序与原文顺序：ordered 25 vs unordered 18 ——**真题不保证按文序出题**，生成端不必强排序。

### D8 — 题干形态 · **detector 易加**
- referencesGenre（"According to the email…"）51/152 ≈ 34%；hasName 25；hasConditional 27；
- **NOT 题 17/152 ≈ 11%**——生成端 NOT 题为 0 或 >25% 都算漂移。

### D9 — 文本质感 · **L2 抽样核对**
- 信息密度：14.4 个事实/篇、8.8/100 词；人名 6.2、数字 6.5 个/篇——真题文本**塞满具体信息**；
- 高频词指纹：please/campus/must/pm/semester…（指令型 + 校园生活语域，campus 词密度 0.069）。

### D10 — 可猜性上限 · **detector 已有（answerAuditor 可测）**
- 参照语料自身可猜率 18.4%（不看原文能答对）——生成题以 **≤18%** 为上限目标，超出 = 选项泄底。

### D11 — 时间/条件质感 · **detector 易加**
- if 25、must 30、deadline 10、temporal 题 34/152——条件与时限是 RDL 文本的核心张力，不可丢。

## Gate 现状与升级路径

- 现行硬门：validateRDLItem（结构）+ scoreBatch 字数带 + merge 层 answerAuditor（答案对错，fail-closed）。
- 本 spec 各维度先服务 **L2 拟真度抽样评审**（结构化 verdict 的评分依据）；
- 升级到冻结 hard-gate 的前置：①P2-16 采集考场回忆 RDL 补金锚；②D5/D6/D8/D11 写成
  确定性检测器并在参照语料上验 precision≥0.95。

## 下一步（挂 BACKLOG / P2-16）

1. 采集 RDL 考场回忆卷 → 与本语料对比，确认备考商银锚没把标准带偏；
2. 把 D2/D6/D8/D11 四个「易加」检测器写进 validator 批级检查（对齐 §7 P1-7 答案位/最长项批级校验一并做）；
3. 官方 6 组单独存档进 `data/realExam2026/reading/`（tier=official），结束「RDL 在 realExam2026 零锚」的账面状态。
