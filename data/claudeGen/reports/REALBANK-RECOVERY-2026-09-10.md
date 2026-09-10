# 真题补题清单执行报告（2026-09-10 → 09-11）

分支：`claude/question-bank-reassemble-g5bvce`（未合 main）。依据 docs/realbank-set-blueprint.md §四「补题清单」。
花费：DeepSeek ¥1.47（余额 25.03 → 23.56）+ Qwen 看图 ¥0.46（46 张），合计约 ¥1.9。

## 1. 总表：每个阶段捞回多少

| 阶段 | 蓝图预期 | 实际 | 说明 |
|---|---|---|---|
| 1 学术段落 ■ 找回（status=ok 的插入题） | 40~70 题 | **0** | 真实盘子只有 3 道，且全在 rf/rp 源（无截图可重扫）。蓝图的 89 缺口大头是「0 选项被判 flagged」（27 道）和 OCR 阶段就没抽出的（~79 道），不是丢 ■ |
| 2 rf 重排版插入题重解析 | 12+2 题 | **+10 入库**（解析出 14，两票盲审过 12，2 道被跨套去重吞） | rf0629 Q30 / rf0713 Q12 不是插入题，是**选句题**（Identify the sentence…），全库仅 4 道，未接 |
| 3 对话人工标性别 | 34 段 | **听力可落库 318 → 339（+21 组）**，入库 **lc 47 → 63（+16 段）**，全部 audio_pending 待配音 | 36 段里 21 段只差性别；10 段（1.21C/1.27A）稿子没有说话人标签（`no_turns`），性别标了也挂不上；2 段源料坏；1 段三人对话；1 段 rp 缺题；1 段听力整卷源错配 |
| 4 4/5 月「16 套」 | ¥26 | **¥0，无事可做** | 18 套里 17 套早已结构化+盲审完；只剩 4.29，其选择题答案在答案 PDF 里本来就没有 |
| ① 第一来源 27 道 flagged 插入题转正 | — | **+2 入库**（3.24、3.2A） | 20 张找到插入题那一屏 → 9 条进标记表 → 9 道转正 → 7 道盲审过 → 4 道被跨套去重吞、1 道两票都不一致 |
| ③ 填词答案词首「截断」 | 上限 39 篇 | **CTW 87 → 116 篇（+29 篇 / +290 空）** | 答案页给的是「要填的后半截」，不是乱砍：200/200 残片满足 前缀+后半截=整词 且 前缀=floor(n/2) |
| ② 第二票（deepseek-v4-pro） | — | 第一票不一致的题里**放行 6 道**（全是 rf 插入题） | 只对显式跑过的题生效；两票都不一致仍丢 |

题型套「齐」（assemble_sets --dry-run）：

| 题型 | 基线 | 现在 |
|---|---|---|
| ctw | 11 | **16** |
| ap | 2 | **9**（只差一点 33 → 26） |
| lc | 1 | **3** |
| lcr / la / lat / rdl / bs | 3 / 16 / 15 / 27 / 6 | 不变 |

## 2. 与 HEAD 逐条对比（重建后）

- reading/ctw 87 → 116（新增 29 篇，无消失、无改动）
- reading/ap 99 → 99；12 篇 questions 多 1 道插入题、passage 带上 [A]~[D]；2 篇（3.24、3.2A）正文换成带标记版
- listening/lat：`real_lat_rf0826_2_12` 转写两词与 HEAD 不同（temperatures→temps、takes→take，合流版校对差异），audio_url 因此清空转 audio_pending，配音时顺手修
- listening/lc 47 → 63（新增 16 段，均 audio_pending；21 段放行里 5 段被跨卷逐条重复 / 盲审闸拦下）
- 其余听力 / 口语 / 写作与 HEAD 逐条一致

## 3. 中途出过、已修掉的问题

1. **阶段 2 重跑 parse_reformatted 会整份覆盖 rf 的 structured.json**（听力/口语回到 deferred），冲掉 merge_vendor_asr 的合流结果。预跑时 lcr 248→138，没有落库。修法：从 .structured.prev.json 拼回听力 + `merge_vendor_asr --speaking-only` 零成本重建口语 + 把新阅读拼回。重建后听力/口语/写作与 HEAD 逐条一致（1 条 lat 例外见上）。
2. 第一次预跑写坏了题库文件；build_bank 的音频/原图沿用是跟**磁盘上一版**比，不先还原 HEAD 就再构建会丢全部 rf 音频。已先 `git checkout HEAD -- data/realBank/...` 再构建。
3. 复核清单的 `strip_insert_markers` 补丁（前提「无插句题」）在插入题被找回后仍会剥掉 [A]~[D]，10 道插入题差点上线成死题。apply_review 现在前提不成立就跳过（条目不删），并加了成品回归测试。
4. build_bank 按口播内容跨卷去重与复核清单 `dup_of` 指定的保留方冲突，rf0808/rf0826 la Q19/Q23 两份都被删。改为撞重复时先问清单。
5. restore_insert_markers 选页逻辑取的是簇内**第一屏**（材料最像、页码最小），插入题在簇内最后一题，那一屏上根本没方块：26 张只转出 2 张 4 个 ■，其中 3.25 那张还把词汇题的高亮词当成 ■。改成「正文覆盖 ≥0.6 且题干覆盖 ≥0.6」挑插入题自己那一屏后 20/27 找到。
6. audit_answers 缺增量能力：`--section` 会整科重审（模型抖动翻案 1 道），新加 `--only-missing` / `--only-q` / `--second-vote`。
7. 第一来源 14 套的阅读以 `<卷>.structured.rw.json` 为准（合流每次从它重建），就地修阅读必须同步 rw（structured_io.js）。

## 4. 源料缺陷（记录，未绕过闸门）

| 卷 | 缺陷 | 影响 |
|---|---|---|
| 1.28新托福真题A卷 | **听力 mp3 是 1.21A 的**（ASR 与 1.21A 逐字稿相似度 0.90/0.86，与自己的 0.14） | 听力整卷源错配，对齐 0/27；人工性别标注无意义 |
| 2.1新托福真题C卷 M2 Q4-5 | 对话音频缺失（旁白连说两遍 "Listen to a conversation." 后直接进 Q6），PDF 有稿 | 该组无法落库 |
| 1.21C、1.27A 全部对话 | 逐字稿是无说话人标签的整段（1.21B 有 A:/B:） | 10 段人工性别标了也挂不上（no_turns），需人工切轮次或换源 |
| 4.29新托福真题 | 答案 PDF 只有填词/听力/写作/口语，没有阅读选择题答案 | 阅读选择题无法落库 |
| rf0629 Q30 / rf0713 Q12 / rf0615 / rf0808 | 选句题（Identify the sentence in paragraph N…），系统无此题型 | 4 道未接 |
| 5.23 插入题 | Qwen 转写与库内材料覆盖率 0.463 | 标记表未收 |

## 5. 来源家族质量对比（回答「换新源会不会更好」）

structured 产物按来源家族 × 科目的 ok 率：

| 来源 | 卷数 | 阅读 | 听力 | 口语 | 听力主要扣下原因 |
|---|---|---|---|---|---|
| 第一来源 1–3 月（整块音频 + 逐字稿 PDF） | 36 | 77% | 83% | 48% | diarization_failed 35、stimulus_mismatch 15、transcript_mismatch 13 |
| 第一来源 4–5 月（整块音频，**无逐字稿**） | 23 | 83% | — （听力从未处理） | — | — |
| 第二来源 rf 6–9 月（重排版 docx + **逐题音频** + A/B 标签） | 11 | **98%** | **96%** | 91% | stimulus_mismatch 6 |
| 第二来源 rp（国内线下拼盘） | 11 | 77% | 64% | 100% | docx 里缺题 13 |

- 差距是**格式**造成的：rf 有逐题音频（不用 ASR 对齐）和 A:/B: 标签（不用基频判性别），这两条恰好是第一来源听力扣下的前两大原因（35+15+13 = 63 / 64）。
- 4/5 月「新格式」文件夹里的听力 docx 是 **61 张截图、零文字**，音频仍是整块 m4a（无 item_level）——比第一来源的 PDF 更差，不是升级。逐题音频 + 标签的格式**只从 6 月开始有**。
- 结论：重新下载 1–5 月**不会更好**，除非商家把 1–5 月按 6 月起的格式（逐题音频 + 带标签 docx）重新排版。若能拿到，第一来源听力可从 83% → ~96%，且本次 10 段 no_turns、36 段性别问题全部自动消失。

## 6. 语速实测（真题 vs 我们的 TTS）

【待填：子代理实测结果】

## 7. 仍缺的与待拍板

1. `validateMarked` 的「■ 不在首尾」挡掉 9 道合法插入题（最后一个插入位本来就常在段末，rf 同一篇的 [D] 也在段末）。放开最多再捞 9 道，仍需盲审。
2. 2.2 插入题查表覆盖率 0.942 < 0.95，差这一道。
3. 跨套去重吞掉 4 道已找回的插入题（3.27、5.29、3.21、4.1）：保留方是另一场考试的副本，里面没这道题。要救得做「把重复副本多出来的题并进保留方」。
4. 两票都不一致的 5 道（rf0629 Q135/Q215、5.10v2 Q35、5.11 Q15、rf0610 Q130）按规则丢弃；rf0629 两道人工读过是答案页对。是否加人工签字放行机制。
5. 1.21C / 1.27A 的 10 段对话：需要人工切轮次（比标性别工作量大得多）或换源。
6. 4.29 阅读选择题答案、4 道选句题：源缺 / 无题型，不动。

## 8. 本轮新增/改动的脚本与判据

- `scripts/realbank/ctw_verify.js`（+测试）：CTW 逐空校验，支持「答案页给后半截」写法
- `scripts/realbank/structured_io.js`（+测试）：写 structured.json 同步 rw 阅读基线
- `scripts/realbank/insert_promote.mjs`、`insert_markers.js` 的 `promoteInsertItem/labelSquares`、`findMarkedPassage` 对逐字相同的重复条目放行
- `scripts/realbank/hold_policy.js`：`auditPassed`（第二票）；`ctw_answer_truncated` 不再整卷拒收 CTW
- `scripts/realbank/audit_answers.mjs`：`--only-missing` / `--only-q` / `--second-vote[=model]`
- `scripts/realbank/structure_set.mjs`：`--types` / `--merge` / `--only-failed` / `--reverify-ctw`，CTW 提示补「后半截」说明
- `scripts/realbank/build_bank.mjs`：代表材料优先带插入位标记的那份；插入题按代表材料判死活；跨卷去重尊重 dup_of；第二票计数
- `scripts/realbank/apply_review.mjs`：`strip_insert_markers` 已有插入题时跳过
- `scripts/realbank/restore_insert_markers.py`：`--include-flagged`；选页改按正文+题干挑插入题那一屏
- `data/realBank/reading/insert-markers.json` 9 条；`data/realBank/listening/lc-speaker-overrides.json` 34 条
- `__tests__/real-bank-reading-data.test.js`：截断卷 CTW 由「必须拒收」改为「放行但挖空结构自洽」；新增「带插入题的 AP 正文必须有插入位标记」
- `lib/mail/templates/realBankLaunch.js` / `data/announcements.json`（本分支未发布的 v1.18.2 草稿）：题量 1217 → 1262（阅读 +29、听力 +16）
