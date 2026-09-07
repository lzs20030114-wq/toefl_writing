# 真题专区全库复核（2026-09-07）

范围：`data/realBank/` 全部 12 个成品文件（两波录入落库后的线上题）。目标：答案键是否正确、题面显示是否正常。
两条线并行：**独立盲解**（952 道选择题，20 个 opus 子代理只拿材料 + 题干 + 选项，不给答案键，逐题作答后与答案键比对）
+ **零 token 结构体检**（选项/答案键合法性、CTW 挖空与正文对位、跨套材料 Jaccard≥0.8 查重、句号/OCR 残片/`undefined` id 等）。

## 1. 答案键：951 / 952 一致

| 题型 | 题数 | 盲解一致 |
|---|---|---|
| 阅读 RDL / AP | 139 / 332 | 139 / **331** |
| 听力 LCR / LC / LA / LAT | 124 / 72 / 56 / 229 | 全部一致 |

唯一不一致：`real_ap_511_1_26#2`（Free Will 第二段「sentence 1 与 sentence 2 的关系」）——独立作答选 C（第二句质疑了第一句的前提），答案键 D；
且题干引用的 sentence 1/2 在正文里没有任何标记。已下架，需对着原截图核答案键。

答案键本身不是问题所在。真正的问题在**题面**：截断、串入无关内容、说话人标签与题干对调、跨套重复。

## 2. 下架与修补（全部记在 `data/realBank/review-holds.json`，`scripts/realbank/apply_review.mjs` 落地）

### 2.1 内容缺陷下架（41 处）

| 类别 | 条目 | 说明 |
|---|---|---|
| 材料串入无关内容 | AP rp0725_1_101 / rp0725_2_201 / rf0902_2_211 | 题池 docx 把「FILL IN THE MISSING LETTERS」练习、别篇段落、标题行拼进了正文，段落编号全错 |
| 文章开头被截、题目问的内容不在 | AP rp0819_1001 / rp0819_2005；LAT rp0718_1_01 / rp0718_1_13 / rf0716_1_29 | 盲解代理标 low：题干问 closed-loop / kintsugi 贵金属 / 记忆巩固 / 乡村移民，材料里根本没有 |
| 整篇无分段却引用段落 | AP rp0819_2001#3 / 2003#2,#3 / 2004#3 / rp0830_2001#3（单题） | 题池 OCR 把段落拍平，「paragraph 3」无从定位；只扣这几题，同篇其它题保留 |
| 选项/题干残片 | AP 510v2_2_11#4、RDL 310_1_28#2、RDL 121a_1_33（整条）、LCR rf0622_2_03 / rf0716_2_01 | 「than music that expresses sorrow」「Wednesday morning」「Come the professor decided…」「…was fast」 |
| 题干与选项不匹配 / 无指代 | LCR rf0615_1_03（问 how 无一选项答 how）、rf0808_1_06（It was absolutely stunning. 无先行词，B/C 都通） | |
| 说话人标签与题干对调 | LC rf0708_1_15 / rf0808_1_13 / rf0808_2_06 / rf0620_2_06 / rf0622_2_06（+ rf0808_2_04 三处截断） | 题干问 the woman，逐字稿里那句是 Man 说的。音频从这个环境访问不到，分不清是 diarization 错还是题干错，一律下架；LC validator 要求恰好 2 题，单题也只能整条扣 |
| 题干与逐字稿不配 | LAT rf0629_1_29#1 | 问 Bollywood，稿里讲的是 bossa nova（该条随后又因与 rf0622_1_29 同篇整条下架） |
| 讨论题教授发言缺失 | discussion rf0708 / rf0808 / rp0705 / rp0711 / rp0718 / rp0812 / rp0819 / rp0822 / rp0725 | 教授栏只有「Your professor is teaching a class. Write a post…」套话或标题行；rp0725 字段整体错位 |
| 面试整套 | interview rf0629_1（3/4 与 rf0622 重复且无参考答案）、rp0729_1（3/3 重复） | |

### 2.2 跨套重复下架（保留一份，其余下架）

商家把同一份料换日期反复投放（rf0902 ≈ rf0716、rp0819/rp0822 ≈ 各整卷、rf0629 ≈ rf0622……），build_bank 的跨卷 hash 去重只认「同一文件」，
换了排版/OCR 变体就漏过。本次按材料 Jaccard≥0.8 成簇，每簇留一条（优先：无内容缺陷 > 题数多 > 无「Listen to a talk…」指令前缀 > 材料长 > 先入库），其余下架：

| 题型 | 下架数 | 题型 | 下架数 |
|---|---|---|---|
| CTW 段 | 15 | LA 条 | 8 |
| RDL 组 | 10 | LAT 条 | 9 |
| AP 组 | 22 | LC 条 | 3 |
| 复述句 | 83（21 套内逐句） | LCR 条 | 2 |
| 面试题 | 13（逐题） | 造句 / 邮件 / 讨论 | 4 / 1 / 1 |

### 2.3 文本修补（52 处，不下架）

- AP 3 篇结尾半句被截（310_1_31 / 510_2_11 / 510v2_1_31）→ 截掉残句；24 篇无插句题却带 `[A]~[D]` 位置标记 → 去掉；OCR 残字「development I」「adesire」。
- CTW `rp0819_4_1` 正文尾巴带着题型指令「Fill in the missing letters in the paragraph」→ 截掉；`529_1_1` 结尾残句「Public transit systems, like」→ 截掉（最后一个空在第 42 词，不受影响）；10 段丢句号 → 补。
  CTW 改正文后 `word_count` / `blanked_text` 按 blanks 重算并逐空核对（词变了直接抛错）。
- LAT 4 条逐字稿尾巴串进「Listening Module 2 Q1…Q3」/「Q1. Who's managing…」→ 截掉；`rf0708_2_12` 开头串进上一条的「visit www.LazyBones.com」→ 截掉；`rf0716_2_08`「energeshint」→ energy-efficient。
- LC `rf0610_1_17` 两道题干的「Emily」→「the woman」（逐字稿只有 Man/Woman）。RDL `rf0808_1_123`「Movie Mani」→ Movie Mania。
- BS `bs_rf0629_07` chunks 里混着 they/those 两个干扰块但 `distractors` 为空 → 补上。复述 2 句补句号。

## 3. 落库前后

| 题型 | 复核前 | 复核后 | 题型 | 复核前 | 复核后 |
|---|---|---|---|---|---|
| CTW | 79 | **64** | LCR | 124 | **118** |
| RDL | 60 组 / 139 题 | **49 / 114** | LC | 36 / 72 | **27 / 54** |
| AP | 81 组 / 332 题 | **53 / 216** | LA | 28 / 56 | **20 / 40** |
| 造句 / 邮件 / 讨论 | 91 / 15 / 17 | **87 / 14 / 7** | LAT | 58 / 229 | **46 / 182** |
| 复述 | 21 套 / 353 句 | **21 / 270** | 面试 | 19 套 / 171 题 | **17 / 151** |

AP 砍得最狠（81→53）：一半是重复（题池 rp0819/rp0822 几乎整卷是 rf 整卷的翻版），一半是题池 OCR 把段落拍平/串栏。讨论题 17→7：题池的 6 套教授发言全是套话。

## 4. 机制

- `data/realBank/review-holds.json`：按成品 id 记的「不上线清单」+ 文本 patch，每条带 reason / dup_of。
- `scripts/realbank/apply_review.mjs`：patch → holds → 重算 CTW 派生字段 + counts.json；幂等；question 级下架带 stem 前缀核对防下标漂移；复述句/面试题按 id 寻址。
  `build_bank.mjs` 落库末尾自动调用，重跑不会把下架题带回来。
- `__tests__/real-bank-review-holds.test.js`：清单里的 id 不许出现在成品里、patch 不许回退、dup_of 指向的保留条必须还在、counts.json 与成品一致。
- **放行一条** = 删掉清单里那一行 **+ 本机重跑 `build_bank.mjs`**（成品已被过滤，源料在 `.codex-tmp`，不重跑回不来）。

## 5. 音频核对（2026-09-07 补）

**前提查清了：真题听力/口语音频全部是自家 TTS 按口播文本配的**（`render_real_audio.mjs`，商家 mp3 内嵌作答静音且不可分发，一条没用）。
所以音频内容 == 配音时的文本，不用逐条去听：

- `audio_url` ↔ 条目 id 逐条核对：118 + 27 + 20 + 46 条听力、270 句复述、151 道面试，**0 处错位**（路径都是 `real/<题型>/<id>.mp3`）。
- 本次 patch 改了口播文本的条目，桶里的 mp3 还是旧文本（带「Listening Module 2 Q1…」尾巴、「visit www.LazyBones.com」开头、「energeshint」）。
  `apply_review` 现在会自动把这类条目的 `audio_url` 清掉并标 `audio_pending`（前端回退浏览器朗读，文本是对的），共 **6 条**：
  LAT `rf0615_1_29` / `rf0622_1_29` / `rf0708_2_12` / `rf0716_2_08` / `rf0808_1_29`，复述 `rp0725_1_s9`。
  本机补配：`node scripts/realbank/render_real_audio.mjs --only=lat,repeat`（dry-run 实测 1192 口播词 ≈ ¥0.91）。
- LC 6 条「说话人与题干对调」：音频是按 transcript 的 Man/Woman 标签锁声配的，所以用户**听到的**和 transcript 一致，是题干反了。
  修法二选一：① 改题干里的 the man/the woman（不用重配，¥0）；② 对调 transcript 标签并重配（≈ ¥0.3）。建议 ①。
- 本环境访问不到 Supabase 存储和 treepractice.com（代理拒 CONNECT），mp3 文件是否真的在桶里没法验；`asr_similarity` 是录入时文档 vs 商家音频的相似度，与自家 mp3 无关。

## 6. 待一起修的清单（按「能不能不看原截图」分）

**不用看原料，改题干即可放行（建议下一步做）**
- LC `rf0708_1_15` / `rf0808_1_13` / `rf0620_2_06` / `rf0622_2_06`：题干 the man ↔ the woman 对调（rf0808_2_06 / rf0808_2_04 另有截断，仍要原料）。

**要对原截图 / 原 docx**
- `real_ap_511_1_26#2` 答案键 D vs 独立作答 C。
- 文章截断：AP `rp0819_1001_100101`（kintsugi 开头）、`rp0819_2005_200501`（closed-loop 开头）；LAT `rf0716_1_29`、`rp0718_1_01` 开头；LC `rf0808_2_04` / `rf0808_2_06` 中间三处。
- 段落被拍平：AP `rp0819_2001_200101` / `2003_200302` / `2004_200401` / `rp0830_2001_200101`（补回段落分隔即可放行被扣的 5 题）。
- 材料拼接：AP `rp0725_1_101` / `rp0725_2_201`（剥掉前面的填词练习）、`rf0902_2_211`（剥掉工业革命段 + 标题行；但它与 rf0716_2_211 同篇，剥完也是重复，可直接放弃）。
- 残片：AP `510v2_2_11#4` 选项 C、RDL `310_1_28#2` 选项 D、RDL `121a_1_33` 首段、LCR `rf0716_2_01`「was fast」、LCR `rf0615_1_03` 选项组。
- 讨论题 9 套教授发言：rp 题池的答案 docx 里可能有原问题，解析器只抓到了套话行。
- LAT `rp0718_1_13`：题与稿不配，大概率是解析时把别篇的题挂到了这段稿上，要回源料对。

**不用修，删就是终态**：所有 `dup_of` 条目（约 170 条）、LCR `rf0808_1_06`（无先行词，原题就这样）。

**放行动作**：从 `review-holds.json` 删掉那一行 → 本机 `node scripts/realbank/build_bank.mjs`（末尾自动应用清单）→ 改了口播文本的再跑 `render_real_audio.mjs`。

## 7. 费用

盲解走 Claude 子代理（订阅内），DeepSeek / Qwen / TTS 0 次调用，¥0。
