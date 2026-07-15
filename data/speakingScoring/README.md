# data/speakingScoring — 新版 TOEFL 口语评分官方锚点

本目录把「新版 TOEFL（2026 改革版）口语评分」的官方评分材料结构化落库，作为口语评分系统
（题型：`repeat` = Listen and Repeat 跟读 / `interview` = Take an Interview 采访问答）的
**校准绝对锚点（golden anchors）**。组织方式参照写作侧的 `data/writingScoring/etsGoldenSamples.json`。

评分刻度分两层，务必区分：
- **单任务 holistic 0-5**：每道题（L&R 7 题、Interview 4 题）由评分引擎按 0-5 打分 →
  见 `officialRubrics.json`（逐档 rubric）与 `officialSamples.json`（满分样例）。
- **section 1-6 band**：两个任务的原始分（合计 0-55）经统计换算得到整个口语 section 的 1-6 band →
  见 `bandDescriptors.json`（1-6 分档描述 + CEFR）与 `scoringModel.json`（换算方法）。

## 文件清单

| 文件 | 是什么 | 主要用途 |
|---|---|---|
| `officialRubrics.json` | 两任务 **0-5 逐档官方 rubric**（L&R 6 档、Interview 6 档 + 四维度定义 Relevance/Elaboration/Delivery/Language use） | 评分器判分档位标准；喂给评分 prompt 作为判分依据 |
| `officialSamples.json` | **4 份官方满分（fully successful, score 5）采访样例**（题目 transcript + 作答 transcript + 官方逐条解释 + track 号 + 场景）；附 **7 句 L&R 示例句**（Track 37-43）及其句式设计解释（音节数/句法分层） | 判分校准金标；L&R 出题的长度/复杂度分层锚点 |
| `bandDescriptors.json` | 口语 **section 1-6 band** 官方分档描述（每档 `summary` + `typically can...` 列表）+ CEFR 对照 + 总分/换算规则 | band 级定性对照；CEFR 映射 |
| `scoringModel.json` | 原始分结构（7+4=11 题, 0-55）、响应时限、**维度→可测特征映射（Table 5/6）**、人机相关 r（Table 7）、原始分→band 换算方法（weighted equipercentile linking） | 评分器架构设计参考；理解官方引擎评分口径 |
| `README.md` | 本文件 | 索引 + 出处 + 版权注意 |

## 来源出处

三个官方来源，均已核对一致。**产品对外引用一律指向 ETS 公开 PDF，不引用 OG。**

### 来源 A — The Official Guide to the TOEFL iBT Test: Pocket Edition（OG）
经 `pdftotext -layout` 提取全文（scratchpad `og.txt`，13130 行）。关键行号：
- L&R Scoring Guide（0-5 逐档）：`og.txt` 行 8249-8301（CHAPTER 5, ≈ p.232）
- L&R 示例句 Transcripts and Explanations（Track 37-43）：行 8307-8350
- Take an Interview 任务介绍 + 四维度定义 + 问题分类 + 示例场景（Track 44-48）：行 8374-8500
- Interview Scoring Guide（0-5 逐档）：行 8508-8560（≈ p.240）
- 4 份满分样例作答 + 官方解释（Track 45-48 问 / 49-52 答）：行 8566-8683（示例任务 p.238-239）
- 分数体系（1-6 band、0.5 步进、总分=四科平均四舍五入、Dual Score Reporting）：行 1006-1058
- 响应时限（L&R 8/10/12 秒、Interview 45 秒）：行 8811-8813
- Speaking Section Performance Descriptors（1-6 band + CEFR）：行 12892-13102（APPENDIX）

> **排版坑（已处理）**：pdftotext 会把评分表的「Score 数字列」（5/4/3/2/1 竖排）与描述文本错位，
> 且全文混有 DRM/水印噪声行（`SdkBytes`、`BAOXIN ZHANG`、`3063020100`、`c8dbba5455` 等）及页眉
> `CHAPTER 5: SPEAKING SECTION`。本目录已**按官方档位语义对齐**归档（非按文本表面顺序），并剔除全部噪声行、合并断行。

### 来源 B — ETS 公开 PDF（存档于 `.research/raw/`）
| 存档文件名 | 来源 URL | 说明 |
|---|---|---|
| `ets-speaking-rubrics-2026.pdf` | https://www.ets.org/content/dam/ets-org/pdfs/toefl/speaking-rubrics.pdf | 官方 Speaking Scoring Guide 干净版原件（© 2025 ETS）；`officialRubrics.json` 的 descriptor 文本以此为准 |
| `ets-toefl-technical-manual-rr-25-12.pdf` | https://files.eric.ed.gov/fulltext/EJ1487502.pdf | TOEFL iBT Technical Manual, ETS RR-25-12 / TOEFL RR-106（© 2025 ETS）；Table 2/5/6/7/8/9 来源 |
| `ets-toefl-2026-blueprint.pdf` | https://www.eu.ets.org/pdfs/toefl/toefl-ibt-test-specifications-2026.pdf | TOEFL iBT 2026 Test Specifications / blueprint（备查，未直接入库） |

三个 PDF 均已验证合法（文件头 `%PDF`、大小 > 100KB，分别 ≈ 278KB / 1.0MB / 505KB）。
Technical Manual 提取文本见 `.research/raw/tech-manual.txt`。

### 关键事实交叉核对
- L&R = **7 题**、Interview = **4 题**、合计 **11 题**，每题 0-5，Speaking 原始分 **0-55**（Technical Manual 正文 + Table 8）。
- Table 7：Speaking Human–Machine r = **0.89**，Human–Human r = **0.96**。
- CEFR：6→C2 / 5-5.5→C1 / 4-4.5→B2 / 3-3.5→B1 / 2-2.5→A2 / 1-1.5→A1（OG 行 1011-1018 与 Technical Manual Table 9 一致；两者原始排版均有错位，已按官方语义对齐）。

## 用途

评分器**校准锚点**。典型用法：
1. 把 `officialRubrics.json` 的逐档 descriptor 注入评分 prompt，作为 0-5 判分依据。
2. 用 `officialSamples.json` 的满分样例做判分器回归测试（作答应判 5，`tolerance` 0.5），并作为 L&R 出题长度/复杂度分层参照。
3. `scoringModel.json` 的维度→特征映射指导评分器该测哪些声学/语言特征（fluency/intelligibility/repeat accuracy/language use/organization）。
4. `bandDescriptors.json` 提供 section 级 band 与 CEFR 的定性对照。

## 版权注意（重要）

- 本目录内的英文 descriptor / rubric / 样例作答 / band 描述均为 **ETS 版权文本**。
- **仅限服务端评分 prompt 与内部校准使用；禁止在任何用户可见界面原文展示。**
- 对外（用户界面、宣传、文档）如需引用口语评分标准，**一律以 ETS 公开 PDF（来源 B）为准并注明出处**，
  不引用 OG 原文（OG 为付费出版物）。
- `.research/raw/` 下的 PDF 为公开可下载原件，仅作内部存档/追溯，不随产品分发。
