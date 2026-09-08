# 真题阅读新增题复核（2026-09-08）

范围：第一来源 50 套回源重跑后新增到 `data/realBank/reading/{ap,rdl,ctw}.json` 的阅读题（工作区未提交）。
两条线：**5 个 Opus 盲解员独立作答**（699 题，只给材料 + 题干 + 选项，不给答案键）+ **零 token 结构体检 & 跨套查重**。
落地方式沿用 09-07：结论按成品 id 记进 `data/realBank/review-holds.json`，由 `scripts/realbank/apply_review.mjs` 应用（幂等，`build_bank.mjs` 末尾自动调）。

## 1. 答案键：698 / 698 一致，只有 1 题存疑

盲解 699 份作答与答案键逐题比对，**唯一不一致**是 `real_rdl_32b_1_21#22`：题干问 can be inferred，
但盲解员指出选项 C（她目前没有宠物）在表格里已明写为 Pets: None，与需要推断的 A 同时成立 —— 题本身不成立，已下架该题。
其余 698 题答案键与独立作答完全一致。**问题仍然全在题面，不在答案键。**

## 2. 缺陷汇总与分类

| 来源 | 原始条目 | 说明 |
|---|---|---|
| 盲解员 defects | 137 | 64 类描述，去重后落到约 110 个不同条目 |
| 结构体检 defects | 26 | 检测器几轮收敛后的终版（早期 1526 条几乎全是词汇题单词选项误报，未采信） |
| 跨套重复簇 | 83 簇 / 207 条 | 本次自己重跑（ap + rdl **合并**聚类，捕到 5 个「同材料被标成两个题型」的跨题型簇） |

分类结果：**hold 168 条**（跨套重复 141 + 内容缺陷整条 17 + 单题 10）、**patch 20 处**、**ignore 若干类**（见 §6）。

## 3. hold：跨套重复（141 条，每簇留一条）

保留优先级：已在 git HEAD（09-07 已复核上线） > 无内容缺陷 > 题数多 > 材料长 > 先入库。
同一份材料被同时录成 ap 与 rdl 的，跨文件只留一条（holds 里带 `dup_of_file` 指明保留条在哪个文件，
`__tests__/real-bank-review-holds.test.js` 的「dup_of 必须还在库里」断言已改为按该字段找保留条）。

- keep `real_ap_121a_1_26` ← real_ap_34_1_31, real_ap_411_1_26, real_ap_427_1_31, real_ap_48_1_26
- keep `real_ap_320_1_31` ← real_ap_36_1_31, real_ap_121b_1_31
- keep `real_ap_34_2_11` ← real_ap_411_2_11, real_ap_36_2_11, real_ap_121b_2_11
- keep `real_ap_56v2_1_26` ← real_ap_329_1_31, real_ap_424_1_31, real_ap_121c_1_31
- keep `real_ap_318_1_31` ← real_ap_323_1_31, real_ap_127a_1_31
- keep `real_ap_rp0704_2004_200411` ← real_ap_127a_2_12
- keep `real_ap_510_1_31` ← real_ap_223_1_26, real_ap_127b_1_31
- keep `real_ap_424_2_11` ← real_ap_127b_2_11
- keep `real_ap_rp0705_2001_200121` ← real_ap_128a_2_11
- keep `real_ap_411_1_23` ← real_ap_128b_1_26, **real_rdl_48_1_23**（跨题型）
- keep `real_ap_411_1_31` ← real_ap_48_1_31, real_ap_223_2_11, real_ap_128b_2_12
- keep `real_ap_324_1_31` ← real_ap_316_1_26, real_ap_210_1_33, real_ap_32b_1_32
- keep `real_ap_311_1_31` ← real_ap_320_2_11, real_ap_41_1_32, real_ap_28_2_11, real_ap_210_2_12
- keep `real_ap_45_1_31` ← real_ap_21b_1_31, real_ap_316_1_31
- keep `real_ap_510v2_1_31` ← real_ap_21c_1_27, real_ap_34_1_26
- keep `real_ap_rp0819_2002_200201` ← real_ap_325_2_11, real_ap_21c_2_11
- keep `real_ap_rf0713_1_131` ← real_ap_228_1_31, real_ap_315_1_31, real_ap_317_1_31, real_ap_428_1_26
- keep `real_ap_323_2_12` ← real_ap_228_2_14
- keep `real_ap_22_1_26` ← real_ap_28_1_31
- keep `real_ap_rp0819_2001_200101` ← real_ap_22_1_34
- keep `real_ap_rf0620_1_131` ← real_ap_22_2_11
- keep `real_ap_310_1_25` ← real_ap_327_1_25, **real_rdl_210_1_28**, **real_rdl_323_1_25**（跨题型）
- keep `real_ap_311_1_25` ← real_ap_41_1_25
- keep `real_ap_311_1_28` ← real_ap_41_1_28
- keep `real_ap_rp0704_2005_200511` ← real_ap_311_2_11, real_ap_41_2_11
- keep `real_ap_418_2_11` ← real_ap_314_1_31
- keep `real_rdl_rf0610_1_125` ← real_rdl_121c_1_25, real_rdl_32a_1_25, real_rdl_424_1_25, **real_ap_315_1_25**, real_rdl_317_1_25, real_rdl_320_1_29, real_rdl_121b_1_29, real_rdl_420_1_29, real_rdl_36_1_29（9 条，本批最大簇）
- keep `real_ap_315_2_11` ← real_ap_45_2_11
- keep `real_ap_413_2_11` ← real_ap_317_2_11
- keep `real_ap_324_1_26` ← real_ap_413_1_26
- keep `real_ap_325_1_23` ← real_ap_38_1_23
- keep `real_ap_325_1_26` ← real_ap_32a_2_12, real_ap_48_2_11
- keep `real_ap_56_1_32` ← real_ap_413_1_33, real_ap_327_1_31
- keep `real_ap_415_2_11` ← real_ap_327_2_11, real_ap_56_2_11
- keep `real_ap_329_1_26` ← real_ap_427_1_26, real_ap_56_1_26
- keep `real_ap_rp0822_2003_200301` ← real_ap_329_2_11
- keep `real_ap_rp0704_2001_200131` ← real_ap_32b_2_11, real_ap_420_1_31
- keep `real_ap_rp0822_2001_200101` ← real_ap_330_1_26
- keep `real_ap_330_1_31` ← real_ap_418_1_31
- keep `real_ap_510_1_26` ← real_ap_38_1_26
- keep `real_ap_38_1_31` ← real_ap_45_1_26
- keep `real_ap_424_1_28` ← real_ap_56_1_23, **real_rdl_121c_1_28**（跨题型）
- keep `real_ap_rf0716_2_211` ← real_ap_427_2_11, real_ap_428_2_11
- keep `real_ap_rp0704_2002_200231` ← real_ap_428_1_32
- keep `real_ap_523_1_25` ← **real_rdl_327_1_28, real_rdl_34_1_23, real_rdl_225_1_25, real_rdl_228_1_25**（跨题型，停水通知一份料四抄）
- keep `real_ap_rp0822_2004_200401` ← real_ap_53_2_11
- keep `real_rdl_121a_1_21` ← real_rdl_413_1_21
- keep `real_rdl_320_1_21` ← real_rdl_121b_1_21, real_rdl_36_1_21
- keep `real_rdl_121b_1_23` ← real_rdl_121c_1_21, real_rdl_320_1_23, real_rdl_32a_1_23, real_rdl_32b_1_23, real_rdl_36_1_23, real_rdl_424_1_21
- keep `real_rdl_121b_1_25` ← real_rdl_320_1_25, real_rdl_36_1_25
- keep `real_rdl_424_1_23` ← real_rdl_121c_1_23
- keep `real_rdl_223_1_23` ← real_rdl_127a_1_23
- keep `real_rdl_314_1_28` ← real_rdl_128b_1_30 —— 两条抄本金额都对不上，**保留条本身也被内容缺陷下架**，故 128b_1_30 改记为内容下架（不留 dup_of）
- keep `real_rdl_420_1_23` ← real_rdl_210_1_24, real_rdl_315_1_24, real_rdl_323_1_24
- keep `real_rdl_310_1_21` ← real_rdl_327_1_23, real_rdl_21a_1_24, real_rdl_21a_1_23
- keep `real_rdl_rf0622_1_123` ← real_rdl_223_1_22
- keep `real_rdl_228_1_21` ← real_rdl_323_1_21
- keep `real_rdl_34_1_21` ← real_rdl_228_1_23
- keep `real_rdl_228_1_28` ← real_rdl_32a_1_28, real_rdl_427_1_23
- keep `real_rdl_22_1_23` ← real_rdl_32b_1_25
- keep `real_rdl_28_1_21` ← real_rdl_314_1_21
- keep `real_rdl_314_1_25` ← real_rdl_28_1_23
- keep `real_rdl_311_1_21` ← real_rdl_41_1_21
- keep `real_rdl_311_1_23` ← real_rdl_41_1_23
- keep `real_rdl_315_1_21` ← real_rdl_317_1_21, real_rdl_56_1_21
- keep `real_rdl_315_1_28` ← real_rdl_317_1_28
- keep `real_rdl_415_1_25` ← real_rdl_318_1_28, real_rdl_53_1_25
- keep `real_rdl_325_1_21` ← real_rdl_330_1_21
- keep `real_rdl_327_1_21` ← real_rdl_418_1_23
- keep `real_rdl_rf0610_1_123` ← real_rdl_38_1_21
- keep `real_rdl_411_1_21` ← real_rdl_48_1_21
- keep `real_rdl_511_1_23` ← real_rdl_413_1_23
- keep `real_rdl_415_1_23` ← real_rdl_53_1_23
- keep `real_rdl_rf0622_1_121` ← real_rdl_418_1_21
- keep `real_ctw_223_1_1` ← real_ctw_28_1_11
- keep `real_ctw_310_1_1` ← real_ctw_420_1_11
- keep `real_ctw_311_2_1` ← real_ctw_41_2_1
- keep `real_ctw_316_1_11` ← real_ctw_45_1_1
- keep `real_ctw_rp0705_1_1` ← real_ctw_316_2_1
- keep `real_ctw_317_1_11` ← real_ctw_327_1_1
- keep `real_ctw_518_1_1` ← real_ctw_320_1_1
- keep `real_ctw_rp0830_2_1` ← real_ctw_323_1_1
- keep `real_ctw_rp0822_6_1` ← real_ctw_411_2_1

## 4. hold：内容缺陷整条下架（17 条）

- `real_ap_21b_2_11` — 材料大面积缺词断句（段首无主语、多处断句），题干答案在文中无直接依据
- `real_ap_21a_1_33` — 材料中段成矿描述整段缺失，Q34 依据的总起句也被截
- `real_ap_21a_2_11` — 首段被截断串行，剧作名与论述主干丢失
- `real_ap_21b_1_27` — 中段整段说明丢失，只剩空格（The process involves␣␣hydrogen can then be…）
- `real_ap_22_2_12` — 「When waves collide, they create storms when ocean waves are more powerful.」语义崩坏，且只剩 1 题
- `real_ap_46_2_13` — P2 结尾 conveying events. 系 conveying context 被截，Q13 题干引用的 context 在材料中不存在
- `real_ap_127a_1_27` — 多段开头缺前文（第 2 段以 and carbon dioxide removal 起、第 3 段以 concern, as… 起）+ 句子断裂 + 残留 [B][C] 标记
- `real_ap_128a_1_31` — 两处成分缺失（a handy are also incorporated into… / people who fear public their speech），第 2 段语义断裂
- `real_rdl_21a_1_21` — 题干称 social media post 但材料是校园布告；材料首行 North Bay 为孤立残行
- `real_rdl_32a_2_13` — 全篇单词无空格粘连不可读，标题截断为 Cyberneti，题干与选项同样粘连
- `real_rdl_428_1_33` — 全篇大面积丢空格（Geophysicistshavelongbeen…）几乎不可读
- `real_rdl_46_1_25` — 两处漏字（feedback on very helpful / discuss difference in how I am approaching），句子不成立
- `real_rdl_210_1_31` — 开头缺主语被截 + 末段两句粘连丢字
- `real_rdl_128a_1_21` — private breakfast and complimentary breakfast 疑为 private beach 误抄；题干 Ms./Mr. Anderson 与材料不一致
- `real_rdl_314_1_28` — 小票金额自相矛盾：合计 158 vs Subtotal 320 / VAT 64.25 / Total 379.25
- `real_rdl_128b_1_30` — 同源小票，35+85+20+18=158 但 Subtotal 写 320（同簇两抄本都有缺陷，一起下架）
- `real_rdl_225_1_30` — 与 314_1_28 同源小票（金额被改），同样不自洽

另有 15 条内容缺陷条目（`real_ap_32b_1_32`、`real_ap_34_1_26`、`real_ap_210_2_12`、`real_ap_121b_1_31`、`real_ap_316_1_31`、
`real_ap_228_2_14`、`real_ap_327_1_31`、`real_ap_327_1_25`、`real_ap_22_2_11`、`real_rdl_21a_1_23`、`real_rdl_210_1_28`、
`real_rdl_323_1_25`、`real_rdl_420_1_29`、`real_rdl_228_1_23`、`real_rdl_28_1_23`）已先被跨套重复规则下架（同簇保留了更完整的一份），不再重复记账。

## 5. hold：单题下架（10 题，组内其它题保留）

- `real_ap_323_1_28` q#2（Who is most likely to obtain a locker?）— A 与 D 两个选项都成立
- `real_ap_311_1_31` q#0（According to the passage, simple…）— A（简化复杂问题）与 D（较快建立解题步骤）两选项都成立
- `real_ap_320_1_31` q#3（Why does the author cite studies…）— B（体现适应性的例子）与 D（支持对各行业有用）两选项都成立
- `real_ap_316_2_11` q#2（How does paragraph 3 relate to…）— 段落编号歧义，按 paragraphs 下标四个选项均不成立
- `real_ap_225_2_11` q#0（In the first paragraph, what is…）— 题干引用 sentence 2，但材料里没有任何句子编号标记（同 09-07 `real_ap_511_1_26#2` 口径）
- `real_rdl_32b_1_21` q#1（What can be inferred about Sarah…）— 盲解唯一不一致项，C（Pets: None）在表格里已明写，与需推断的 A 同时成立
- `real_rdl_324_1_21` q#1（What is the goal of the new sche…）— A（鼓励更多人使用）与 B（更好服务社区成员）两选项都成立
- `real_rdl_324_1_23` q#0（The post recommends that student…）— 选项 A 加了原文没有的 to Student Housing stores 限定
- `real_rdl_418_1_25` q#1（The word "complimentary" in the…）— 题干称 in the first paragraph，但材料为无分段单块文本
- `real_rdl_127a_1_21` q#0（What is the main purpose of the…）— 材料带 Subject 行为邮件，题干却称 the notice，体裁标注与题干不一致

被 dup 下架的条目上如果是「两选项都成立」这类**材料固有**的逻辑缺陷，会转嫁到该簇保留的那一条
（`real_ap_28_2_11#11 → real_ap_311_1_31#31`、`real_ap_36_1_31#34 → real_ap_320_1_31#34`）；
「选项被截断」「题干残缺」这类**抄本特有**的缺陷不转嫁（已逐条核对保留条的选项/题干确实完整）；
保留条若已在 09-07 盲解通过（`real_rdl_rf0610_1_125`）也不转嫁。
`real_ap_128b_2_12#13`、`real_ap_48_2_11#14`、`real_rdl_36_1_25#27` 的保留条根本没有对应那道题，自然无需转嫁。

## 6. patch（20 处，不下架）

- `real_ap_53_1_32` / `real_ap_323_2_12` / `real_ap_56_1_32` passage [trim_tail] — 结尾半句被截，截掉残句
- `real_ap_323_1_28` passage [replace] ×3 — OCR 大小写 p.M. → p.m.
- `real_rdl_210_1_21` / `real_rdl_22_1_22` text [replace] — 同上
- `real_rdl_411_1_21` text [replace] ×3 — 同上
- `real_rdl_28_1_21` text [replace] ×2 — 营业时间连字符丢失（9:00 A.M.␣␣8:00 p.M. → 9:00 A.M. - 8:00 p.m.）+ 另一处 p.M.
- `real_rdl_127b_1_28` text [replace] — 句首缺 If you
- `real_rdl_420_1_23` text [trim_tail] + [replace] — 条码残行 `(12) 80-399 131506` 串入；奈拉符号被 OCR 成 `#`（#1,000 → ₦1,000）
- `real_rdl_223_1_23` text [replace] — 句末缺句号（located at 123 Elm Street）
- `real_ap_316_2_11` passage [replace] — leading isolated → leading to isolated
- `real_ap_315_2_11` questions.2.options.C / `real_ap_325_1_23` questions.1.options.C [append] — 选项缺句末句号

另有 18 处已写好的 patch 因目标条目整条下架而作废，未写入清单（例：`real_ap_317_2_11` 的截尾、`real_rdl_121c_1_23` 的题干指令行、
`real_ap_41_2_11` 的 unpredictableways、`real_ap_127b_1_31` 的 litle、`real_ap_21b_1_31` 的 milion、`real_rdl_327_1_28` 的时间连接符）。

## 7. ignore：记录不动

- **题号断档 / 缺号**（盲解报了 20+ 处，如 `real_ap_223_2_11` 缺 Q12、`real_ap_28_1_31` 缺 Q32/33、`real_rdl_46_1_28` 缺 Q29）：源里就少题，不影响现存题作答。
- **rdl paragraphs 为空**（该批次绝大多数 rdl 组，例 `real_rdl_121c_1_28`）：前端按 passage 整块渲染。
- **未分段但题干不引用段落**（`real_ap_424_2_11` / `317_1_31` / `327_2_11` / `21b_1_23` / `32a_2_12` / `315_1_31`）：只有明确引用「第一段」的 `real_rdl_418_1_25#26` 按单题下架。
- **material_too_short 12 条**（AP 119-148 词、RDL 26-28 词）：真题本来就有这个长度，检测器阈值偏严。
- **结构体检早期版本的 option_fragment_short / option_lowercase_start 等 1500+ 条**：词汇题单个单词选项被误判（"educational" / "practical"），盲解员逐题读过都没报，全部不采信；检测器后续几轮已自行收敛到 26 条。
- **`real_ap_320_1_31#35` 选项措辞失配**：靠排除法仍唯一，真题常态。
- **blocking source_flags**（ctw_answer_truncated 75 / section_gap 26 / ingest_blocker 26）：录入期已知，本次未动。

## 8. 复核前后题量

| 题型 | 09-07 已上线（HEAD） | 本次新增后 | 复核后 | 复核后题量 |
|---|---|---|---|---|
| AP | 53 | 182 | **99** | 373 题 |
| RDL | 49 | 176 | **110** | 238 题 |
| CTW | 64 | 96 | **87** | 870 个空 |

净增：AP +46、RDL +61、CTW +23。砍掉的 158 条里 141 条是跨套重复 —— 商家换日期反复投放同一份料，
本次把 ap/rdl 合并聚类后连「同一份料被录成两个题型」也一并收了（5 簇）。

## 9. 校验

- `apply_review` 幂等复跑：0 改动（patch 0 / 下架 0），清单里 272 条已不在库属正常。
- 听力 4 + 口语 2 + 写作 3 共 9 个成品文件落地前后**逐字一致**（字节级比对，非仅换行差异）。
- AP 选项形状核实：全库（新旧题一致）都是 `{A,B,C,D}` 对象而非数组，`correct_answer` 为键名 —— 不是新题引入的形状问题，`build_bank` 无需改。
- `npx jest --silent` → **PASS (1441) FAIL (0)**。唯一改动的测试是把 dup_of 断言改成按 `dup_of_file` 找保留条（跨题型重复的新情况），断言强度未放松。

## 10. 遗留 / 需拍板

- 4.29、5.20 两套仍未入库（沿 09-06 台账）。
- 本次 hold 的条目基本都「删掉即终态」（141 条重复无需回源）。值得回原截图救的只有 6 处：
  `real_ap_21a_1_33`（中段成矿段缺失）、`real_ap_127a_1_27`（多段缺前文）、`real_ap_327_1_25` + `real_rdl_210_1_28` / `real_rdl_323_1_25`（睡眠阶段图数据全丢）、
  `real_rdl_314_1_28` / `real_rdl_128b_1_30` / `real_rdl_225_1_30`（小票金额对不上）。
- 放行动作同 09-07：删掉 `review-holds.json` 里那一行 → 本机重跑 `node scripts/realbank/build_bank.mjs`。
- 未 commit / 未 push（按约定）。

## 11. 费用

盲解与结构体检全部走 Claude 子代理（订阅内），DeepSeek / Qwen / TTS 0 次调用，**¥0**。
