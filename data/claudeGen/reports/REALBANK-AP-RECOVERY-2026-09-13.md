# 真题阅读缺题找回（2026-09-13）

用户反馈：真题专区学术阅读（AP）「Noise Control in Urban Areas」一篇只有 1 道题。核实结论：真考 AP 每篇固定 5 题，成品库 99 篇只有 36 篇齐 5 题；题不是在前端丢的，而是在入库前的管线里丢的。本次把能找回的全部找回，并把三处会反复丢题的机制堵上。

## 1. 根因

| 丢在哪 | 机制 | 占第一来源 AP 应有题数（675）的比例 |
|---|---|---|
| 结构化（structure_set.mjs） | deepseek-v4-flash 转写输出坏 JSON / 修复轮不是数组 → 块标 flagged，从未进盲审 | 20.3%（137 题；70 题纯 JSON 失败，67 题选项/题干残） |
| 跨卷去重 | 同一篇在多场考试出现时「每簇保留一条」，被扔掉副本里多出来的题一并丢弃 | 40.6%（274 题被扔到别卷副本，其中约 25 题是保留方没有的） |
| 盲审不一致 | 第一票与答案页不符即丢，第二票只对显式跑过的题生效 | 3.9% |
| 复核扣下 / 选项残 / 源缺屏 / 插入题无标记 | 既有设计，本次不动 | 5.8% |

典型案例 1.28A「Noise Control」：OCR 原文里 q26（grappling 词汇题）、q28（European cities 推断题）题干与四个选项都在，答案页 26 C / 27 B / 28 A 也在，结构化那一步两题都报「模型输出无法解析为 JSON」。

## 2. 做了什么

### 数据侧（实花 ¥11.04，DeepSeek 台账可对账）
- `structure_set.mjs --only-failed --sections reading --types ap,rdl`：51 卷 165 个 flagged 块重跑，救回 81 块。
- `audit_answers.mjs --section=reading --only-missing`：只审新题、旧 verdict 一律不重掷（顺手修了顶层 auditable/agree/nulls 计数按全量重算的显示 bug）。
- `--second-vote`（deepseek-v4-pro）：对第一来源全部 reading 第一票不一致的题补第二票，放行 7 道。
- 新增 `scripts/realbank/gt_fallback_ap.mjs`：用 `data/realExam2026/reading/academicPassage.json` 的题干+选项，按 OCR 页眉定位题号、从答案页取字母盖章，注入仍 flagged 的 AP 块后走同一条盲审闸。注入 4 题，2 题过审、2 题两票都不一致按规则撤回；净入库 1 题（1.28A q28）。
- 「只增不减」逐卷核过：live 题干 0 丢失、无一卷因新题拉低一致率翻成扣下。
- 中间产物与逐卷清单：`.codex-tmp/realbank/_recovery-2026-09-13/`（summary.json / rerun-progress.jsonl / gt-injections.json）；改动前备份 `.codex-tmp/realbank/_backup-2026-09-13-ap-recovery/`。

### 代码侧
- `scripts/realbank/consolidate_reading.js`：跨卷同篇聚簇（AP：标题相同且正文 Jaccard≥0.5，或正文≥0.8；RDL：≥0.8）→ 选代表（复核清单 dup_of 指定 > 未被下架 > 带插入位标记 > 正文最完整 > 题多 > 日期早）→ 逐题并入代表，守卫：选项重合 ≥3 项即同一题（不看题干，抓机经商家改写措辞的重复题与串栏配错选项的题）、题干重复（题干相同 / 相似且选项重合 / 相似≥0.85）、题干截断、插入题无标记、词汇题的词不在代表正文、引用段号越界、选句题、复核判过歧义的题干；**AP 每篇上限 5 题**（真考口径，限时档按题型给固定时间），并入只补到 5、优先补代表缺的题型，RDL 不设限。本次账本：88 簇、并入 18 题、跳过 duplicate_options 422 / duplicate_stem 10 / over_cap 11 / truncated_stem 1。账本落 `data/realBank/reading/consolidation.json`，`assemble_sets.mjs` 读它把被合掉的 id 当别名还回原场次（别名链收敛）。
- `scripts/realbank/id_carry.js`：item id 跨重建稳定（同卷同 module、材料相同或 Jaccard≥0.8 → 沿用旧 id，一个旧 id 只沿用一次）。没有它，补回更靠前的题会让 id 改名，复核清单里 19 条下架 + 2 处 patch 静默失配、15 道下架题复活。
- `scripts/realbank/question_type.js`：AP 题型按题干句式推断（apValidator 的 9 种 + 真题特有的 sentence_selection），落库不再一律写 "detail"。
- `lib/reading/questionTypeLabels.js` + `components/reading/RDLTask.js`：题号行显示中文题型（词汇 / 细节 / 推断 / 修辞目的 / 主旨 / 否定细节 / 段落关系 / 插入句 / 指代 / 选句）。
- `build_bank.mjs --only-reading`：只写 `data/realBank/reading/`，其余文件按字节还原（照 `--only-bs`）。
- 新增测试 6 个文件（题型推断 / 跨卷合并 / id 沿用 / assemble_sets 别名 / 数据不变量）；全套 jest 2000 用例绿。

## 3. 结果

| | 之前 | 之后 |
|---|---|---|
| AP | 99 篇 / 385 题（篇均 3.89） | **101 篇 / 411 题**（篇均 4.07） |
| RDL | 110 篇 / 238 题 | **111 篇 / 253 题** |
| CTW | 116 段 / 1160 空 | 不变 |
| AP 每篇题数分布 | 1:3 / 2:6 / 3:26 / 4:28 / 5:36 | 1:1 / 2:4 / 3:25 / 4:28 / 5:43（无一篇超 5） |
| 整卷视角 AP 槽位完整度（sets.json） | 641/815 = 78.7% | 706/815 = 86.6%（无槽位超填） |
| AP 题型套「齐」（assemble_sets） | 9 场 | 17 场 |
| Noise Control | 两份副本各 1 题 / 2 题 | 一篇 3 题（词汇 / 细节 / 推断） |

AP 题型分布：细节 143 / 词汇 82 / 推断 70 / 否定细节 46 / 修辞目的 44 / 主旨 15 / 插入句 14 / 指代 7 / 段落关系 2 / 选句 2。

## 4. 残余项（已记 docs/BACKLOG.md）
- 第二来源 rf*/rp* 22 卷的 13 个 flagged ap/rdl 块：`<卷>.json` 的 alignment 为空，`--only-failed` 够不着，GT 也不覆盖第二来源，要另立方案。
- 上限 5 挡下 11 道跨卷并入的真题（over_cap，consolidation.json 有清单）；若改主意要「并集全留」，改 consolidate_reading.js 的 MAX_QUESTIONS.ap 为 null 重建即可。
- 第二来源改写题：措辞与选项都被改写的同义题（如 rp0704「Why might seismic waves slow down」vs「What may account for the unexpected slowing」）规则层面认不出，靠每篇上限 5 兜住。
- 结构化阶段按屏猜的 type（rdl/ap）不可靠，少数海报/影评类题落在 ap.json；既有噪声，本次未动。
- 5 条曾被下架的题干因「别的卷的同篇副本被救回」重新出现（不是 hold 失配），要治得在复核清单补跨套重复条目。
- 第二票按 ¥5.24/M 估价偏低（走的是 pro 模型）。

## 5. 复现 / 重跑
```
node scripts/realbank/build_bank.mjs --only-reading     # 先 --dry 看数；重建前 data/realBank 须在 HEAD
node scripts/realbank/assemble_sets.mjs                  # 重装 sets.json
node <scratchpad>/verify_ap_recovery.mjs                 # 只增不减 / 下架残留 / id 稳定 验收（会话脚本）
```

---

# 第二轮：继续补全 + 点选句子题 + 日常阅读归位（2026-09-13 晚）

用户要求「能补的继续补」，并拍板「点选句子题」与「放错列表的日常阅读挪回去」两件都做。三路并行，主线程集成。

## 1. 缺口归因（只读）
- ap.json 里 14 篇实为日常阅读槽位的长篇网页/通知（本就 2~3 题），真学术长文 44 篇缺 63 题；主因插入句题、选项被 OCR 吞、盲审不一致（实为挂错题号）、点选句子题。
- 阅读填词第一来源 100 个块死于「模型输出无法解析为 JSON」，上一轮只重跑了 ap/rdl。

## 2. 数据侧（实花约 ¥11.6：DeepSeek ¥6.63 + Qwen 看图约 ¥5）
- **CTW 重跑**：JSON 失败的真因是 deepseek-v4-flash 推理 token 吃光 max_tokens=16000 导致正文空串（台账 2675 次里 531 次顶到 16000）。CTW 预算提到 32000、解析加括号配对兜底（`scripts/realbank/model_output.js`）。96 块救回 77。
- **CTW 正文忠实度**：Qwen 看源截图核对发现救回块里 40 块丢句、8 块是模型编造（如 3.15 编出 "they were also interested in…"）。新增 `structure_set --ctw-vision-body` 用看图转写的正文重跑，终态忠实 78 块；新增 30 段全部核过原文。
- **选择题看图重抽**（`vision_restructure_mcq.mjs` / `vision_mcq.js`）：103 张定位到截图，写回 82，盲审过 80；其中 15 道原「两票不一致」是结构化把别屏的题挂错了题号，看图后翻案。
- **插入句题**：核对截图后放宽 `insert_markers.js` 的「■ 不许在文末」（其余判据不动），标记表 9 → 36 条，转正 30 道，两票不一致撤回 6。
- **两篇缺段文章修回**：1.27A「Engineering Earth's Climate」、2.1B「Artificial Photosynthesis」用截图原文补齐正文（逐字核对无编造），重审 10/10，各 5 题上线，复核清单去掉两条下架。
- 新进 CTW 的 41 段跨卷重复、1.21A M2 一篇重复 AP 已补 dup_of 下架。

## 3. 流水线侧
- **日常/学术按考卷位置归位**（`reading_position.mjs`）：题号带确定才改，版式靠结构证据并与 assemble_sets 对账；本次 26 篇换题型（学术→日常 23、日常→学术 3）。
- **id 别名账本** `data/realBank/reading/id-aliases.json`（id_aliases.js）：跨卷合并、归位、带 dup_of 的整条下架都进账本，链收敛到在线 id，跨重建累积；本次 203 条，3 条收敛不到（都是整篇单词粘连不可读、复核判真下线）。
- **apply_review**：下架/patch 顺归位别名搬到新 file+id；单题下架先按题干前缀定位；AP passage 被 patch 后重切 paragraphs。
- **按题号认领下架 id**（id_carry.js）：修复上一轮埋下的 bug——补回更靠前的题让被下架的组改名、下架静默失效。上一轮集成里 Opal（2.1A 缺段版当了代表、把线上完整的 3.29 版并掉）、Video Evidence（P2 截断）、Trendie Boutique 小票（内容缺陷）因此复活；本轮已全部重新下架，Opal 只留 real_ap_329_1_26。测试加了按题号的残留检查。
- **点选句子题**：分句器 `sentence_select.js`、题干转写 `sentence_select_stems.py`、账本 `data/realBank/reading/sentence-select.json`（审计哈希 = 题干 + 用户看到的那段文字）、盲审 `audit_sentence_select.mjs`；上线 3 道（real_ap_225_1_31 q33、real_ap_523_2_12 q11、real_ap_56v2_2_11 q12）。
- 合并判据补强：选项重合、正确答案原文相同（≥3 长词）判同题；日常阅读每篇上限 3、学术每篇上限 5。
- 题型推断：「Which sentence in paragraph N」→ 选句；段落目的 → 修辞目的；整篇目的 → 主旨。

## 4. 前端侧
- RDLTask 点选句子交互：第 N 段各句可点（悬停/选中高亮、键盘可操作、触屏可点），切题自动滚到该段，提交后正确句绿底、错选红底；原图条目强制显示文字。契约：`question_type: "sentence_selection"`、`paragraph`（展示用段号）、`paragraph_index`（定位用下标）、`options: {S1..Sn}`（该段各句精确子串）、`correct_answer: "Sk"`。
- 点选题识别口径 = 题型 sentence_selection **且** 选项是 S 键（第二来源拍成 A–D 的选句题照普通四选一渲染，题号行仍显示「选句」）——集成时发现只看题型会把 3 道 A–D 选句题整题丢掉，已统一。
- 历史逐题回顾、错题本显示「你选的句子 / 正确句子」；`lib/realBankAliases.js` 让旧 id 的已练标记、练习记录页覆盖统计、按 id 找题都经别名账本解析。

## 5. 结果（对比线上 HEAD）

| | HEAD | 现在 |
|---|---|---|
| 学术阅读 AP | 99 篇 / 385 题 | 86 篇 / 394 题，每篇 {3:4, 4:28, 5:54} |
| 日常阅读 RDL | 110 篇 / 238 题 | 125 篇 / 296 题 |
| AP+RDL 选择题 | 623 | 690 |
| 阅读填词 CTW | 116 段 / 1160 空 | 146 段 / 1459 空 |
| 整卷槽位 CTW | 51.2% | 86.5% |
| 整卷槽位 RDL | 81.3% | 95.6% |
| 整卷槽位 AP | 78.7% | 89.9% |
| 点选句子题 | 0 | 3 |

验收：主树重建产物与彩排逐字节一致（除日期）；HEAD 每个 AP/RDL 条目经别名账本都能在新库找到，题干只有 1 道换成同题另一措辞（按正确答案原文判重）；CTW 线上段全部保留；复核下架按 id、按题号残留均为 0；无 AP 超 5 题；全套 jest 193 套 2271 例全过；浏览器挂真实 RDLTask 实点选句题、交卷复盘正常。

## 6. 残余（已记 docs/BACKLOG.md）
- 选择题 7 道找不到源截图；插入题 29 道找不到那一屏、14 道标记表无对应正文；点选句子候选多数卡在宿主段落结构或保留方是拼盘副本。
- 基线 CTW 仍有 13 簇跨卷重复未下架（下架需 CTW 旧 id 兼容）；基线 116 段 CTW 正文未做看图忠实度核对。
- `/progress/reading` 通用历史页对归位的旧记录仍显示旧题型；后台 `lib/admin/realBankStats.js` 仍按旧 id/题型统计。
- 合并判据盲区：标题与首段粘连时（3.29 Opal）与同篇副本聚不成簇，若清单未下架另一份会双份在线。
- `audit_answers.mjs --only-q` 不带 `--only-missing` 会清空该卷全部阅读盲审条目（工具坑，别单独用）。
