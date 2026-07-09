# R0 — 评价标准数字复算 (anchor re-measure)

> 生成: `node scripts/audit/measure-anchors.mjs` · 日期 2026-07-09 · 确定性/无 LLM/无网络。
> 对每个题型, 从锚语料**重新计算** spec 里声称的定量指标, 对照 validator / scoreBatch / gate 里同维度常量。
> 判定 = spec 声称值 vs 锚实测(现在)。MATCH=容差内; DRIFT(Δ)=偏差; UNVERIFIABLE=锚非结构化/回忆压缩/spec 未给数字。

## 总览

| 题型 | MATCH | DRIFT | UNVERIFIABLE |
|---|---|---|---|
| bs | 15 | 2 | 1 |
| ad | 10 | 0 | 1 |
| email | 14 | 0 | 1 |
| ap | 6 | 0 | 2 |
| ctw | 5 | 0 | 1 |
| rdl | 8 | 0 | 1 |
| listening | 7 | 0 | 2 |
| speaking_repeat | 13 | 0 | 0 |
| speaking_interview | 2 | 0 | 1 |
| **合计** | **80** | **2** | **10** |


## Build a Sentence (`bs`)

**锚**: `data/realExam2026/writing/buildSentence-targets.json` (n=504 targets, tier=recalled). 词数 = 空白切分后仅计含字母数字的 token(丢弃独立 ? . 标点 tile)。passive/contraction/relative 用重实现的近似检测器(spec 的检测器为手校验), 数字接近即判 MATCH; person-prefilled 取自 `data/buildSentence/tpo_source.md`(60 TPO 项, 前导 prefilled 为主语代词=person)。

| 指标 | spec 声称 | 锚实测(现在) | validator | scoreBatch | gate | 判定 |
|---|---|---|---|---|---|---|
| D1 答案词数 mean | 9.16 (bs.md L35) | 9.15 | bsQuality lenOK 7-15w | ans 7-15w | N/A | MATCH |
| D1 答案词数 median/min/max | 9 / 4 / 15 | 9 / 4 / 15 | — | — | N/A | MATCH |
| avgAnswerWords vs code-const | code=9.4 | 9.15 | — | — | N/A | MATCH |
| D2 easy(≤7w) 占比 | 24.6% (bs.md L43) | 24.6% | ETS_DIFFICULTY_RATIO.easy=0.22 | — | N/A | MATCH |
| D2 medium(8-11w) 占比 | 59.5% | 59.5% | ratio.medium=0.6 | — | N/A | MATCH |
| D2 hard(≥12w) 占比 | 15.9% | 15.9% | ratio.hard=0.18 | — | N/A | MATCH |
| D4 结尾 ? 占比 | 14.5% (bs.md L63) | 14.5% | qmarkMin/Max 0/2 per set | — | N/A | MATCH |
| qmarkRatio vs code-const | code=0.14 | 14.5% | — | — | N/A | MATCH |
| D5 'Do you know if…' signature | 17.3% (bs.md L70) | 16.7% | — | — | N/A | MATCH |
| D6 negation 占比 (strict–含 casual 'no') | 24.0% (bs.md L78) | 21.2%–28.4% | negationMin/Max 1/3 per set | — | N/A | MATCH |
| negationRatio 代码常量 vs 锚实测 | code=0.2 (0.2) | 真实 21.2%–28.4% | — | — | N/A | DRIFT(Δ8.4pp) |
| D8 passive 占比 (近似检测器) | 8.3% (bs.md L93) | 12.7% | passiveRatio=0.11 | — | N/A | MATCH |
| D9 contraction 占比 | 23.0% (bs.md L100) | 23.0% | — | — | N/A | MATCH |
| D11 first-person 开头 占比 | 40.3% (bs.md L115) | 37.7% | — | — | N/A | MATCH |
| D12 distractor 密度 | 0/14 renders (bs.md L122) | 结构化 target 无 tile 字段 | distractorMin/Max 6/10; distractorRatio=0.88 | distractorOK 计数 | N/A | UNVERIFIABLE |
| D15 person-prefilled 比率 (TPO 实测, 前导主语代词) | subject-pronoun 目标 0.3 (etsProfile) | 25.0% (15/60) | scoreBatch person 带 0.10-0.40; PERSON_PREFILLED_GATE 0.45 | personFrac 带 | N/A | MATCH |
| prefilled presence (TPO 实测) | presenceRatio 0.87 (etsProfile) | 85.0% (51/60) | givenWordRatio=0.87 | — | N/A | MATCH |
| prefilled multi-segment (TPO 实测) | multiSegmentRatio 0.3 (etsProfile); renders ~21% (bs.md L136) | 11.8% (6/51) | — | — | N/A | DRIFT(Δ18.2pp) |

## Academic Discussion (`ad`)

**锚**: `data/realExam2026/writing/academicDiscussion.json` (n=50, tier=recalled)。⚠ 该结构化文件只抽取了 `professor_question`(最后一问), 未存完整教授贴 → D2/D3/D4/D5/D7/D8/D9(教授 opener/framing/gloss/长度/句数) 全部 UNVERIFIABLE(spec 自己也标注这些取自 scripts/research 手抄的 n=36 全贴)。学生侧字段完整可复算。

| 指标 | spec 声称 | 锚实测(现在) | validator | scoreBatch | gate | 判定 |
|---|---|---|---|---|---|---|
| D10 每题学生数=2 | 47/50 (ad.md L111) | 47/50 (94.0%) | — | — | N/A | MATCH |
| D11 学生贴词数 mean/median | 42.7 / 40 (ad.md L115) | 42.6 / 40 | — | discQuality s1/s2 250-700 chars | N/A | MATCH |
| D12 学生贴句数 mean/median | 3 / 3 (ad.md L122) | 3 / 3 | — | — | N/A | MATCH |
| D13 学生开头 'I believe/think' | 56% (ad.md L128) | 56.3% | — | — | N/A | MATCH |
| D13 学生开头 'In my opinion' | 21% | 20.8% | — | — | N/A | MATCH |
| D15 S2 点名 S1 | 0% (ad.md L142) | 0.0% (0/46) | — | — | N/A | MATCH |
| D19 学生名∈{Claire,Paul,Andrew,Kelly} | 100% (ad.md L169) | 100.0% (94/94) | — | discDiversity 名字越多越好 | N/A | MATCH |
| D1 教授名 'Dr. <Surname>' | 49/50 (ad.md L45) | 49/50 (98.0%) | — | — | N/A | MATCH |
| D6 教授问句 Why? 尾标 (在 50 题 professor_question 上) | 53% (ad.md L86, 源自 n=36 全贴) | 50.0% | — | — | N/A | MATCH |
| D21 distinct question strings | 35/50 distinct (66% cores; ad.md L182) | 35/50 (70.0%) | — | — | N/A | MATCH |
| D2/D3/D4 教授 opener/two-sided/contraction | 61%/81%/72% (ad.md L53/61/72) | 结构化 JSON 只存 professor_question, 无完整教授贴 | — | — | N/A | UNVERIFIABLE |

## Email (`email`)

**锚**: `data/realExam2026/writing/email.json` (n=51, bullets/recipient/subject OCR-verbatim)。D5(macro function)/D7(role)/D14(topic 域) 是语义分类维度, 无结构化标签可确定性复算 → UNVERIFIABLE。

| 指标 | spec 声称 | 锚实测(现在) | validator | scoreBatch | gate | 判定 |
|---|---|---|---|---|---|---|
| D1 bullet 数=3 | 51/51 (email.md L32) | 51/51 (100.0%) | — | — | N/A | MATCH |
| D2 bullet lead-verb Explain | 29.4% (email.md L36) | 29.4% | — | — | N/A | MATCH |
| D2 bullet lead-verb Describe | 26.8% | 26.8% | — | — | N/A | MATCH |
| D2 Explain+Describe 合计 | 56% | 56.2% | — | — | N/A | MATCH |
| D4 三 bullet 动词全不同 | 90.2% (email.md L50) | 90.2% | prompt: each DIFFERENT verb | — | N/A | MATCH |
| D6 recipient Title+Surname | 82.4% (email.md L68) | 82.4% | — | — | N/A | MATCH |
| D6 recipient first-name-only | 17.6% | 17.6% | — | — | N/A | MATCH |
| D8 scenario opener 'You are' | 49% (email.md L83) | 49.0% | — | — | N/A | MATCH |
| D8 scenario opener 'You recently' | 33.3% | 33.3% | — | — | N/A | MATCH |
| D9 scenario 词数 mean/median | 39.5 / 39 (email.md L91) | 39.5 / 39 | — | — | N/A | MATCH |
| D10 scenario 句数 mean | 3.4 (email.md L96) | 3.4 | — | — | N/A | MATCH |
| D11 bullet 词数 mean/median | 9.2 / 9 (email.md L102) | 9.2 / 9 | — | — | N/A | MATCH |
| D12 subject 词数 mean/median | 4.1 / 4 (email.md L105) | 4.1 / 4 | — | — | N/A | MATCH |
| D13 scenario 含引号命名 | 29.4% (email.md L112) | 29.4% | — | — | N/A | MATCH |
| D5/D7/D14 macro function/role/topic 域 | 31.4%/74.5%/64.7% (email.md L57/76/117) | 需语义分类器(scenario 无结构化域标签) | — | — | N/A | UNVERIFIABLE |

## Academic Passage (`ap`)

**锚**: `data/realExam2026/reading/academicPassage.json` (raw n=64; dedup-by-passage n=42)。⚠ spec 的 182.5 是在「dedup + 剔除 3 条 RIDL 泄漏 = clean n=39」上测的; 本脚本只能按 passage 文本去重(无法确定性剔 RIDL), 故 raw/dedup 两口径都给。题数/题型分布因 JSON 欠抽取且无 question_type 标签 → UNVERIFIABLE。

| 指标 | spec 声称 | 锚实测(现在) | validator | scoreBatch | gate | 判定 |
|---|---|---|---|---|---|---|
| D2 passage 词数 mean (raw n=64) | 182.5 (clean n=39; ap.md L47) | 181 | passage 110-230 (real 150-210) | reading-ap 160-210 | N/A | MATCH |
| D2 passage 词数 mean (dedup n=42) | 182.5 / median 189 / max 209 | 177.9 / 187.5 / 209 | AP_PROFILE 150-210 tgt190 | 160-210 | N/A | MATCH |
| D4 平均句长 (词/句, n=64) | 16.6 (ap.md L60) | 15.6 | — | — | N/A | MATCH |
| D8 每题 4 选项 | 205/207 (ap.md L98) | 205/207 (99.0%) | — | — | N/A | MATCH |
| D18 avg word length | 5.63 (ap.md L152) | 5.58 | ETS_FLAVOR.avgWordLength=5.63 | — | N/A | MATCH |
| D18 long-word(≥7ch) ratio | 0.371 (ap.md L152) | 0.37 | ETS_FLAVOR.longWordRatio=0.371 | — | N/A | MATCH |
| D1 每篇题数 (JSON raw) | 5 (真值; JSON 欠抽取 ~3.2; ap.md L40) | raw mean 3.23 | question_count 必须=5 | — | N/A | UNVERIFIABLE |
| D5/D6 题型分布 & insert_text | 见 ap.md L66/79 | JSON 问题欠抽取且无 question_type 字段 → 手抄自 OCR | AP_PROFILE.questionTypeTargets | — | N/A | UNVERIFIABLE |

## Complete the Words (`ctw`)

**锚**: `data/realExam2026/reading/completeTheWords.json` (n=75, 字段=paragraph OCR)。passage 级维度用**与冻结 gate 相同的检测器** `lib/gate/measurers/ctw.js` 计算, 直接对齐 gate-registry 冻结带。⚠ OCR 会把词黏连(glue) → 词数系统性偏低(spec 承认 69.3 OCR vs ~71.8 真值)。blank 级维度锚里没有 → UNVERIFIABLE。

| 指标 | spec 声称 | 锚实测(现在) | validator | scoreBatch | gate | 判定 |
|---|---|---|---|---|---|---|
| D2 passage 词数 mean (gate detector, OCR) | 69.3 OCR / ~71.8 glue-repaired (ctw.md L36) | 69.3 | <45 err / >120 warn; tgt 70 | reading-ctw 60-95 | hard tol±9 | MATCH |
| D7 首句词数 mean | 16.7 (ctw.md L74) | 16.7 | — | — | hard tol±3 | MATCH |
| D7 首句 avg word length | 5.89 (ctw.md L74) | 6 | prompt 4.5-5.5 (偏低) | — | hard tol±0.45 | MATCH |
| D7 首句 long-word(≥7ch) share | 38.9% (ctw.md L74) | 38.1% | — | — | hard tol±0.1 | MATCH |
| sentence_count mean | 4-5 mode (ctw.md L36) | 4.2 | 3-5 | — | monitor | MATCH |
| D1/D3/D4 blank 数/POS/词长 | 10 blanks; 33.9% fn; 5.77ch (ctw.md L28/44/52) | 结构化锚只有 paragraph OCR, 无 blanks[]; 答案键在 .codex-tmp(非 data/) | blankCount 10; blankAvgLength tgt 5.5 | — | N/A | UNVERIFIABLE |

## Read in Daily Life (`rdl`)

**锚**: `data/reading/samples/readInDailyLife/` 银层 goarno(44)+third_party(7)=51 组 / 150 题(spec 定量口径); 官方金层 6 组另算字数带。题型分布用样本自带 `question_type` 字段。可猜率/改写深度/干扰项构造需 solver 或语义标注 → UNVERIFIABLE。

| 指标 | spec 声称 | 锚实测(现在) | validator | scoreBatch | gate | 判定 |
|---|---|---|---|---|---|---|
| D2 每篇题数 mean (银层 n=51) | ≈2.9 (152/52; rdl.md L32) | 2.94 | short=2 / 通用 2-4 | — | N/A | MATCH |
| D3 题型 detail 占比 | ≈55% (rdl.md L36) | 55.3% | RDL_PROFILE.detail=0.55 | — | N/A | MATCH |
| D3 题型 inference 占比 | ≈28% | 27.3% | inference=0.28 | — | N/A | MATCH |
| D3 题型 main_idea 占比 | ≈12% | 12.0% | main_idea=0.12 | — | N/A | MATCH |
| D3 题型 vocab 占比 | ≈5% | 5.3% | vocab=0.05 | — | N/A | MATCH |
| D8 NOT/EXCEPT 题占比 | ≈11% (17/152; rdl.md L61) | 7.3% | — | — | N/A | MATCH |
| D8 referencesGenre 占比 | ≈34% (51/152; rdl.md L61) | 32.0% | — | — | N/A | MATCH |
| D1 官方 6 组字数 range/median | 43-153, median 140 (rdl.md L29) | 43-153, median 140 | short 38-62 / long 80-150 | rdl-short 38-62 / rdl-long 80-150 | N/A | MATCH |
| D10 可猜率 / D4 改写深度 / D5 干扰项构造 | 18.4% / overlap 0.60… (rdl.md L69/44/48) | 需 solver 或语义/词重叠标注 → 非确定性结构复算 | answerAuditor 可测(merge 层) | — | N/A | UNVERIFIABLE |

## Listening (LC / LA / LAT / short-response)

**锚**: `data/realExam2026/listening/{conversations,announcements,lectures,shortResponse}.json`。长度维度按 spec 的 clean filter 剔 ASR 拼接离群(conv/ann >150w, lec >330w)。⚠ conversation 的 turn 数不可复算(155 条里 150 条是单 blob ASR, JSON 无真实分轮); 答案位/题型分布锚在 .codex-tmp → UNVERIFIABLE。

| 指标 | spec 声称 | 锚实测(现在) | validator | scoreBatch | gate | 判定 |
|---|---|---|---|---|---|---|
| A1 conversation 词数 median/mean (clean ≤150w, n=150) | median 89 / mean 90 (listening.md L40) | 89 / 85.8 | conv 80-250w (err<60/>280) | listening-lc 68-105 | N/A | MATCH |
| A2 turn 数 | median 6 (listening.md L52) | JSON 中 150/155 是单 blob ASR(turn=1); 仅 5 条多轮 | turns 6-15 | — | N/A | UNVERIFIABLE |
| B1 announcement 词数 median/mean (clean ≤150w, n=68) | median 83 / mean 82 (listening.md L105) | 83 / 81.5 | anno 40-150w (err<30/>170) | listening-la 55-120 | N/A | MATCH |
| B2 'Attention' opener 占比 (前45字符) | 21% (listening.md L118) | 20.5% (16/78) | OPENING_PATTERNS Attention rate:64 (spec 称 FALSE) | — | N/A | MATCH |
| C1 lecture 词数 median/mean (clean ≤330w, n=107) | median 250 / mean 246 (listening.md L149) | 250 / 245.8 | transcript 120-300w (err<100/>320) | listening-lat 200-330 | N/A | MATCH |
| D1 short-response prompt 词数 median/mean (n=178) | median 8 / mean 7.9 (listening.md L204) | 8 / 7.9 | lcr speaker 4-20w | listening-lcr 3-14 | N/A | MATCH |
| D2 short-response wh-question 占比 | 49% (listening.md L217) | 49.4% | lcr statements 30% / questions 70% | — | N/A | MATCH |
| D2 short-response question 合计 | 74% (wh49+yn24) | 73.6% | — | — | N/A | MATCH |
| E1 答案位分布 / C5 lecture 题数 | A24/B28/C28/D20; 4 题 (listening.md L245/197) | 答案键在 .codex-tmp(非 data/); lecture questions JSON 多为空 → 手抄自 OCR | — | — | N/A | UNVERIFIABLE |

## Speaking · Listen-and-Repeat (`speaking_repeat`)

**锚**: `data/realExam2026/speaking/repeat.json` (键=**sets**, 51 套 / 351 句; 每句带 words+difficulty)。词数优先用 sentences[].words 字段。

| 指标 | spec 声称 | 锚实测(现在) | validator | scoreBatch | gate | 判定 |
|---|---|---|---|---|---|---|
| D1 每套句数=7 | 47/51 (92%; repeat.md L26) | 47/51 (92.2%) | validateRepeatSet: !==7 | — | N/A | MATCH |
| D2 句词数 mean/median/min/max | 9.56 / 9 / 4 / 17 (repeat.md L32) | 9.56 / 9 / 4 / 17 | REPEAT_WORD_RANGES easy4-7/med8-12/hard13-20 | repeatQuality word band | N/A | MATCH |
| D3 tier easy 占比 (file 标签) | ≈26% (repeat.md L44) | 29.9% | — | — | N/A | MATCH |
| D3 tier medium 占比 | ≈52% | 53.8% | prog: mediumCount≥45% | — | N/A | MATCH |
| D3 tier hard 占比 | ≈16% | 16.2% | — | — | N/A | MATCH |
| D3 精确 2/3/2 signature 占比 | 6.4% (3/47; repeat.md L44) | 5.9% (3/51) | validateRepeatSet warns unless 2/3/2 (100% gen) | — | N/A | MATCH |
| D4 末句最长(或并列最长) | 91.8% (45/49; repeat.md L52) | 88.2% (45/51) | — | — | N/A | MATCH |
| D5 S1 'Welcome/Let's' 开头 | 16% (8/51; repeat.md L58) | 15.7% (8/51) | — | — | N/A | MATCH |
| D7 含问号句占比 | 0% (0/351; repeat.md L66) | 0.0% (0/351) | easy structures 列 yes/no question | — | N/A | MATCH |
| D9 direct address (you/your) 占比 | 37.3% (repeat.md L80) | 37.3% | natural_spoken_register 峰值 addrRate=0.37 | — | N/A | MATCH |
| D11 if 条件句占比 | 10% (35/351; repeat.md L94) | 10.0% | hard.structures leads conditional | — | N/A | MATCH |
| D12 punitive-warning 占比 | 0% (0/351; repeat.md L99) | 0.0% (0/351) | hard.structures 列 result/consequence | — | N/A | MATCH |
| D13 末句 wayfinding(map/schedule) 占比 | 33% (17/51; repeat.md L107) | 33.3% (17/51) | — | — | N/A | MATCH |

## Speaking · Interview (`speaking_interview`)

**锚**: `data/realExam2026/speaking/interview.json` (n=14 套, questions[] 为字符串)。问题字数 spec 自己判**不可信**(回忆者写的是压缩转述, 非考场完整口语) → UNVERIFIABLE; 只有「每套问数」「全疑问」可结构复算。

| 指标 | spec 声称 | 锚实测(现在) | validator | scoreBatch | gate | 判定 |
|---|---|---|---|---|---|---|
| 每套问题数 median/mean/range | 3-9, median 6-7 (interview.md L24) | median 6.5 / mean 6.5 / 3-9 | validateInterviewSet: 必须=4 (App 设计) | interviewQuality 期望 4 | N/A | MATCH |
| D3 全部疑问句(结尾?) | solid (全疑问; interview.md L46) | 100.0% (91/91) | validator 问号检查 + 去重 | allQ 批级复核 | N/A | MATCH |
| 问题字数 median (回忆压缩) | 7-14 词但 spec 判**不可信** (interview.md L25) | median 9 / mean 9.6 | INTERVIEW_WORD_RANGES 25-50 | interviewQuality 20-60 | N/A | UNVERIFIABLE |
