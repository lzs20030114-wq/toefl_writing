# 各题型评价维度体系 (Type-specific evaluation dimensions)

每个题型有**特有的评价维度**——决定一道题"像不像真题、好不好"的那些可测属性。
校准前必须先把维度拆全,再逐维度对比「当前生成库 vs realExam2026 真题」。

标注:
- `M` 可从 realExam2026 直接测;`M~` 部分可测(OCR有噪声);`M✗` 真题数据不支持(需另想办法)
- `src` 当前校准来源(prompt/profile 文件)

---

## BS — Build a Sentence
机制:给一句对话提示 + 打乱词块 + 部分预填,考生重组出 answer 句。

| 维度 | 含义 | 测? | src |
|---|---|---|---|
| **长度** length | answer 词数、有效 chunk 数 | M (词数) / M~ (chunk) | etsProfile.avgAnswerWords/avgEffectiveChunks |
| **句型/问法** sentence type | 直接疑问/wh疑问/间接embedded/陈述/否定/被动/关系/比较 各占比;answer 是否疑问句 | M | bsGen prompt 句型分布 |
| **prompt 问法** prompt style | 提示句(speaker A)是否第二人称对考生说话(you)、疑问 vs 陈述、长度 | M~ (OCR prompt) | bsGen prompt #1 RULE |
| **prefilled 预填** | 有预填占比、片段数、词类分布(主语代词/NP/副词/介词短语/动词短语/中位名词/连词wh)、人名占比、位置 | M~ (OCR) | PREFILLED_PROFILE |
| **distractor 干扰词** | 有干扰占比、每套不同干扰词数、类型(助动词/形态孪生/否定孪生/内容词)、坍缩 | M~ (OCR scrambled, 噪声大) | ETS_STYLE_TARGETS/bsGen |
| **chunk 词块** | 单词块 vs 多词块占比、每题块数、块长 | M~ (OCR) | bsGen chunk rules |
| **话题** topic | 域分布(校园事务/学术/日常社交)、多样性 | M (target句) | (无显式) |
| **难度** difficulty | easy/medium/hard 分布 | M~ (由长度+结构推断) | ETS_DIFFICULTY_COUNTS_10 |

## AD — Academic Discussion
机制:教授发帖提问 + 2学生表态,考生写回应。

| 维度 | 含义 | 测? | src |
|---|---|---|---|
| **教授帖** professor post | 长度、开头风格、是否含问题、问法类型、缩写 | M~ (只存了问题,没存全帖) | academicWriting.js |
| **教授问题** prof question | 问题词数、问法(观点/利弊/是否/为何) | M | academicWriting.js |
| **学生帖** student posts | 数量(2)、每帖词数、立场对立度、是否引用S1、口语化标记 | M (词数/数量) / M~ (立场/引用) | academicWriting.js |
| **课程/话题** course/topic | 学科域分布、话题具体度、多样性 | M | DISC_COURSE_LIST |
| **难度** | 话题抽象度/词汇级别 | M✗ | — |

## Email
机制:给情境 + 收件人 + 3任务点,考生写邮件。

| 维度 | 含义 | 测? | src |
|---|---|---|---|
| **场景** scenario | 词数、"我是谁+发生了什么"结构、话题域 | M (词数) | emailWriting.js |
| **收件人** recipient | 角色(教授/经理/职员/房东) | M | emailWriting.js |
| **任务点** bullets/goals | 数量(3)、动作类型(describe/ask/explain/suggest)、祈使措辞 | M (数量) / M~ (动作类型) | emailWriting.js |
| **主题** subject | 是否有、风格 | M | — |
| **语域** register | 正式度 | M✗ | — |

## Reading · AP — Academic Passage
| 维度 | 含义 | 测? | src |
|---|---|---|---|
| **文章** passage | 词数、段数、句长、可读性(FK年级)、TTR | M (词数/段) | readingEtsProfile AP |
| **题目** questions | 每篇题数、题型(词义/细节/推断/主旨/目的/句子简化)、选项数、选项长 | M (题数) / M~ (题型) | readingEtsProfile questionTypeTargets |
| **话题** topic | 学科域分布、多样性 | M | — |
| **难度** | 词汇/句法复杂度 | M~ | — |

## Reading · CTW — Complete the Words (C-test)
| 维度 | 含义 | 测? | src |
|---|---|---|---|
| **段落** passage | 词数、句数、句长、可读性、话题 | M (词数) / M~ | readingEtsProfile CTW |
| **空** blanks | 空数、片段比(露词首百分比)、被挖词POS(实词/虚词)、词频(易/中/难)、空间距 | M✗ (真题只有露词残形, 答案在答案卷) | readingEtsProfile blank* |

## Reading · RDL — Read in Daily Life
| 维度 | 含义 | 测? | src |
|---|---|---|---|
| **文本类型** text type | 广告/邮件/日程/通知/告示 分布 | M~ | readingEtsProfile RDL |
| **长度** | 短文/长文词数 | M~ | shortText/longTextWordCount |
| **题目** | 题数、题型 | M~ | — |

## Listening (lc/la/lat + 短应答)
| 维度 | 含义 | 测? | src |
|---|---|---|---|
| **篇章类型** passage type | 对话/通知/讲座/短应答 占比 | M | listeningGen 各 builder |
| **长度** length | 每篇词数(按类型) | M | — |
| **对话** conversation | 轮数、场景(服务/社交/学术)、说话人关系 | M~ (ASR无说话人标) | lcPromptBuilder |
| **讲座** lecture | 学科域、独白结构 | M (学科域) | latPromptBuilder |
| **话题** topic | 域分布 | M | — |
| **题目** questions | 每篇题数、题型 | M✗ (音频无题干, 题在图片PDF) | 各 auditor |

## Speaking · repeat (Listen & Repeat)
| 维度 | 含义 | 测? | src |
|---|---|---|---|
| **句数/套** | 每套句数(7) | M | speaking.js |
| **难度梯度** | 2易+3中+2难, 按词数/结构递进 | M (词数梯度) | speaking.js |
| **说话人角色** | staff/权威(技术/图书管理/向导) | M~ | speaking.js |
| **场景** setting | 校园/社区具体地点 | M~ | speaking.js |
| **句子结构** | 祈使/陈述/复杂度 | M~ | — |

## Speaking · interview
| 维度 | 含义 | 测? | src |
|---|---|---|---|
| **设定** setting | 研究/访谈情境 | M | speaking.js |
| **问题数** | 每任务问题数 | M | — |
| **问题递进** | 暖场→偏好→观点→论证 | M~ | — |
| **话题** | 域分布 | M | — |

---

## 校准流程(每题型)
1. 按上表逐维度,用**同一检测器**测「当前库」与「realExam2026」。
2. 记录偏差到 `docs/realexam2026-calibration.md`(BEFORE 基线)。
3. 偏差显著的维度 → 改 prompt/profile;真题数据不支持的维度(M✗)→ 保持现有或另找来源。
4. 下一批次重测看收敛。
