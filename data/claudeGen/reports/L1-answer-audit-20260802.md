# L1 存量库答案全量二审报告（2026-08-02）

## 范围与方法

延续 LCR 全量审计（lcr-answer-audit-20260802.md）后，对其余存量客观题库跑 L1 全量盲审：
`full-audit-l1` workflow（run 30757805669）用 DeepSeek 独立作答（只给题面、不给答案键），
与标准答案比对，fail-closed 出嫌疑清单（`FULL-AUDIT-2026-07-09/L1-suspects.json`），
再由 opus/sonnet agent 分诊 + 主线程人工复核实锤。

覆盖 7 库（LCR 已于同日单独审完）：ap / rdl-short / rdl-long / ctw / lat / lc / la。

## L1 盲审结果

| 库 | 已审 | ok | suspect | 人工复核后实锤 |
|---|---|---|---|---|
| ap | 101 | 78 | 10 | **8 改键 + 1 词汇去歧义**（6 首批 + 2 error 项重审；均 insert_text 时序错序） |
| rdl-short | 208 | 207 | 0 | 0（干净） |
| rdl-long | 132 | 128 | 1 | **1 改键** |
| ctw | 407 | 279 | 83 | **系统性：指示代词歧义，117 题重挖**（详见下） |
| lat | 149 | 135 | 11 | 0 改键（11 全为盲审误报）+ **1 数据毛病** |
| lc | 83 | 83 | 0 | 0（干净） |
| la | 100 | 99 | 0 | 0（干净） |

（error 列为 DeepSeek 暂态超时，已再次 dispatch workflow 续跑重试；非新增嫌疑。）

## 阅读 MCQ 改键（7 道，均人工复核原文实锤）— commit e5c4bca

### AP 插入题 / 推断题（6 道）

| id | q | 旧键→新键 | 依据 |
|---|---|---|---|
| ap_r1_routine-20260531-134653_2 | 4 | B→A | 插入句是反馈链首环，应紧接「chain of feedback processes」即 Slot 1；原解析自曝把该句误定位在 slot 2 之前（差一位） |
| ap_mpx0lfar_2 | 2 | D→B | D「Daly River 主要捕食者」无据（Daly River 只关联淡水鳄）；B 由「五年锐减九成」+「需数十年选择压力」可推 |
| ap_mpzvh9ag_2 | 4 | A→C | 插入句含「these changes」需前置复数先行词，只有「Heart rate rises...」提供；句尾 source 与 Slot C 后文衔接 |
| ap_mpzvh9ag_3 | 2 | C→B | 原文「never fully completes the underlying chemistry」直接否定 C；**原解析写着「that is incorrect... retained per the plan」——明知答案错仍入库** |
| ap_mq45s7kl_0 | 4 | C→D | Toraja 例应在「transitional state」概括句之后（Slot 4），放 Slot 3 则例先于纲 |
| ap_mqh11rfu_2 | 4 | C→D | 水分子几何例应在「shared pairs produce...shapes」概括之后（Location 4） |

### AP 插入题（error 项重审后第二批，2 道，opus 复核 + 主线程原文确认）

| id | q | 旧键→新键 | 依据 |
|---|---|---|---|
| ap_rt_20260608_2 | 4 | C→A | 「十岁未被分流」例证「推迟到十五岁分流」（Slot 1）；原键 Slot 3 是芬兰瑞典缩小差距的对比结论，与例句无关；解析留有「Wait—the assigned answer is slot 3...」犹疑 |
| ap_mqh11rfu_1 | 4 | C→D | 「水进钢材几乎不透射」例证「阻抗差异大则反射为主」（Location 4）；原键 Location 3「阻抗相近大部分透射」与例句自相矛盾 |

### RDL（1 道）

| id | q | 旧键→新键 | 依据 |
|---|---|---|---|
| rdl_long_rt_001 | 2 | C→D | 「仅在两人都不行时才通知 Ms. Tanaka」→ 尚未告知经理（D）；C「视 Jordan 为可靠同事」全文无据 |

## 数据毛病清理（2 处）— commit e5c4bca

- `ap_gen_26467805738_003` q4：`immune` 词汇题选项 A「resistant」与键 B「exempt」同为 immune 近义、构成双解 → A 换为无歧义干扰项「accustomed」（键不变）。
- `lat_mpw0p1fq_3` q2：删除生成期残留的第五选项 `"E":"placeholder"`（前端会误渲染成 5 选项）。

## CTW 系统性歧义 → 挖空器根治（117 题重挖）

三批 agent 分诊 83 个 CTW 嫌疑，结论高度一致：**几乎全部歧义是同一模式——被挖空的
指示代词 this/that（挖成 fragment "th" + 4 字母）或 these/those（"th" + 5 字母），
彼此同前缀、同长度，且都能回指前句实体，语境无法消歧**。这是 C-test 挖空算法的
系统性缺陷，非零散误报。DeepSeek 之所以只标出约 41 项，是因其余同类题它碰巧填回了原词——
潜在歧义同样存在。

**根治（commit 见下）**：
1. `lib/readingGen/cTestBlanker.js` 新增 `BLANK_SKIP_WORDS = {this,that,these,those}`，
   像 1 字母词一样跳过、不参与交替、永不挖空。所有**未来** CTW 题从源头规避。
2. 存量：对所有 119 个当前挖了指示代词的 CTW 题用新挖空器整篇重挖（passage/id 不变，
   仅换挖空位置 + 重估难度）。**117 题重挖成功**（0 掉空、0 残留指示代词、validator 全过）。
3. 冻结测试 `__tests__/ctw-blanker-demonstrative-skip.test.js`：合成段落 + live 全库断言
   除已知残留外无指示代词被挖空。

## 已知残留（5 项，低危，记录在案）

判据：歧义仅 1/10 空、两答案都算对（考生至多丢 1 分），且已由合库层 AI 审计对未来题兜底，
故不为这 5 例过度改造确定性挖空器：

- **2 题重挖会触发 validator**（保留原指示代词挖空）：
  `ctw_gen_1780213257230_008`（重挖后平均空词长 8.4>8.0）、
  `ctw_1784923353142_894331`（重挖后 8/10 生僻词超门）。
- **2 题 two/the 歧义**（`t` + 3 字母，非指示代词闭集）：
  `ctw_r1_routine-20260531-134653_6`、`ctw_1780341431835_197313`。
- **1 题 farmers/farming 歧义**（内容词，`far` + 7 字母）：`ctw_gen_29125146352_004`。

这三类 t__/内容词歧义在 407 题里仅 3 例、且多数 3 字母 t 词靠语境唯一化（盲审未标为歧义），
属真实边缘 case 而非系统缺陷，不纳入挖空器跳过集。

## 非答案问题（转 BACKLOG，不在本次答案修复范围）

- `ap_gen_1780213721866_001` q4 选项 D 括注「(after 'structure.')」与实际槽位（cementation 之后）不符——干扰项标签错位，键 C 正确，不影响判分。
- 8 道 AP 的 `paragraphs[]` 字段被剥去 ■ 插入符：经查前端 `app/reading/page.js:329` 用 `passage`（含 ■）渲染、不读 `paragraphs`，故 ■ 正常显示——**非 bug，虚惊**。
