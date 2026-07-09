# R1 — 评价标准逐份结构审查报告（2026-07-09）

> 任务：在「全库质量监测 L2 拟真度抽样评审」把 `docs/eval-spec/*.md` 当评分 rubric 之前，先审这些标准本身。
> 方法：逐份过同一张 6 项检查单（锚可信度/样本量、时效、维度覆盖、内部一致性、L2 可执行性、与产线口径一致性），
> 每项配可核查证据（spec 行号/维度号/字段名，或锚数据实况）。对照物：`QUESTION-PIPELINE-REVIEW-2026-07-07.md` §6 盲区清单。
> 只读审查，无任何现有文件改动。裁决口径：**可用** = L2 可直接当 rubric；**修后可用** = 附具体修订点；**仅 monitor** = 锚或判据不足以下硬结论。
> 注意：本报告不做精确数字复算（那是 R0 的活）；只抓方向性问题与结构性缺口。凡涉及具体常量对不上，一律标「待 R0 确认」。

审查范围实况：`docs/eval-spec/` 下实际有 **9 个文件**（ad/ap/bs/ctw/email/listening/rdl/speaking_repeat/speaking_interview），
`listening.md` 一份罩 LC/LA/LAT/LCR 四型，合计覆盖 13 题型。下文逐份审 9 份。

---

## 0. 锚可信度与样本量：先把每份 spec 的「尺子的尺子」核实一遍

所有 spec 声称的锚样本量，我逐一对着 `data/realExam2026/` 与 `data/reading/samples/` 实测核对，结论如下（✓=spec 声称与文件实况一致）：

| spec | 锚文件 | 实测 n | spec 声称 | 锚 tier | 核验 |
|---|---|---|---|---|---|
| bs | `writing/buildSentence-targets.json` | 504 条（全 tier=recalled） | 504 | 考场回忆 | ✓ 文本层锚；但**渲染层 distractor 锚仅 14 屏/6 卷** |
| bs（joined） | `writing/buildSentence.json` | 363 | 363 | 回忆 | ✓ prompt 层锚 |
| ad | `writing/academicDiscussion.json` | 50 | 50 | 回忆 | ✓；但**最高价值的教授全帖仅 n=36 手抄** |
| email | `writing/email.json` | 51 | 51 | 回忆 | ✓ bullets OCR 逐字对齐 |
| ap | `reading/academicPassage.json` | 64 → 39 clean | 64/42/39 | 回忆 | ✓ 文本层；**题目层仅 n=70 手编码(14 簇)** |
| ctw | `reading/completeTheWords.json` | 75 → 48 clean 答案键 | 75/48/481 blanks | 回忆 | ✓ |
| listening | conv 155 / ann 78 / lec 113 / shortResp 44 组·178 prompt | 全部一致 | 同 | 回忆 | ✓ 文本层；**题干/选项/干扰在图片 PDF，无锚** |
| rdl | `reading/samples/readInDailyLife/` ETS 6 组/16 题 + goarno 44/132 + third_party 7/18 = 57 组/166 题 | 全部一致 | 同 | **银锚（备考商）+ 官方定性** | ✓；`realExam2026` 下**零 RDL 回忆卷** |
| repeat | `speaking/repeat.json` 51 组/351 句 + `repeat-from-audio.json` 13 组/91 句 | 全部一致 | 同 | 回忆 | ✓ |
| interview | `speaking/interview.json` 14 组 | 14 | 14 | 回忆（**最弱**） | ✓ |

**锚等级分层结论**（从强到弱）：
- **强（考场回忆 + 文本层可直接量）**：bs（文本维度）、email、ctw、repeat（文本维度）、listening（文本维度）。
- **中（回忆但关键维度靠手抄/小样本）**：ad（教授帖 n=36）、ap（题目层 n=70）。
- **弱（自声明）**：rdl（**银锚**，备考商为主，无考场回忆）、interview（**14 组 + 问句文本自认不可信**）。

关键锚缺口（三份 spec 有、其余六份沉默）：**bs / ap / listening 的「题目怎么出、选项怎么设、干扰项怎么埋」这一半，全部无回忆锚**——
bs.md D12 明写 distractor 只有 14 屏渲染证据、ap.md「Deferred」写明 distractor trap-logic「no answer key…deferred」、listening.md「Deferred」写明题干/选项在图片 PDF。
这正是 §6 盲区 #4「题目层拟真大面积无锚」在 spec 层的体现，且 spec 大多**如实声明了**（诚实度加分），但也因此这一层**不能下硬 verdict**。

---

## 1. 跨 spec 系统性发现（五条通病，先讲通再逐份审，避免重复）

### S1 — 锚同源单批 + 时效声明普遍缺失（检查单第 2 项，系统级）
实测所有 `realExam2026` 锚的日期跨度：**AP 与 BS 均为 2026-01-21 .. 2026-05-10**（45 个考试日），与审查报告 §3.2「13 个文件全部来自同一批采集（2026-01~05 的 52 套回忆卷，一次性入库后未再增补）」吻合。
- **时效正面**：spec 都写于 2026-07-07/09，锚是 2026改后当季题，标准与题型**同代**，不存在「老锚定新题」的代际错配（bs.md 反而是唯一主动清算老 TPO 锚的——D17 明写「this TPO-era target is wrong for 2026改后」）。
- **时效缺口**：锚**冻结在 ≤2026-05**，而 2026改后题型仍在演化。9 份里**只有 rdl.md 与 speaking_interview.md 显式声明了「锚会过期/需 P2-16 补锚」**；其余 7 份（bs/ad/email/ap/ctw/listening/repeat）**没有一句「本标准锚定于 2026 上半年、下半年题型漂移后需复采」的时效声明**。L2 若把这些标准当长期冻结带，半年后可能拿过期尺子判新题却毫无预警。**修订建议**：7 份加统一时效脚注（锚采集窗口 + 复采触发条件）。

### S2 — 所有 spec 的「Current/gen 侧」快照已普遍失效（检查单第 6 项 + 内部一致性）
每份 spec 的结构是「Real 目标（锚）+ Current（生成快照）+ Gap」。我把 9 份的「Current bank n=」与**当前 live 库**逐一对账，**无一对得上**：

| spec 声称 Current | live 实测（07-09） | 偏差 |
|---|---|---|
| bs 860（86 套×10） | `questions.json` **634**（64 套，generated_at 2026-07-07） | 快照已被 07-07 dedup/重生成取代 |
| ad 144 | `prompts.json` **193** | +49 |
| email 139 | `prompts.json` **196** | +57 |
| ap 156 | `ap.json` **172** | +16 |
| ctw 191 | `ctw.json` **349** | **+158** |
| listening LC n=23 / LA 31 / LAT 14 / LCR 113 | lc **180** / la **159** / lat **133** / lcr **302** | LC/LAT 侧快照小到无法对应任何已知库态 |
| repeat 11 套/77 句 | `repeat.json` **96** | 快照仅为早期小样本 |

含义：**Real（锚）侧稳定、可继续用；但 Gap 诊断与「BIGGEST GAP / TOP-3」的优先级排序是对着已不存在的旧库算的**。L2 若照搬 spec 的「哪个维度最漂」结论，可能指错方向（那些漂移可能已被 07-07 重生成部分修掉，也可能新库引入了新漂移）。**修订建议**：L2 评审只信 Real 目标值，**忽略 Current/Gap 列**，或在开跑前用 R0 脚本对 live 库重算一遍 gen 侧。listening 的 LC n=23 / LAT n=14 尤其可疑——生成侧诊断建立在**来源不明的极小快照**上（live 库是它的 8～10 倍），置信度最低。

### S3 — 用户可感知、但 9 份 spec 全部没罩住的质量面（检查单第 3 项，补 §6 盲区）
对照 §6 盲区清单 + 独立判断，以下「用户能直接感觉到、L2 rubric 却无判据」的面，**没有任何一份 spec 覆盖**：
1. **解析/explanation 的质量与语言**：审查报告 §3.6 指出线上库解析中英文不统一、LAT 把内部干扰标签（`too_narrow`/`surface_word_trap`）直接泄给用户。9 份 spec **无一**含「解析」维度——ap/ctw/rdl/listening 的题都有解析要展示给用户，但 rubric 完全不判解析对不对、语言统不统一、有没有泄露工程标签。**这是最大的一块共同盲区。**
2. **干扰项合理性下限（「干扰项不能明显也对」）**：只有 rdl.md D5（银锚、partial）和 listening.md D4（partial）碰了干扰项逻辑，且都无法给频率。bs/ap/ctw/email 无「干扰项不能是第二正确答案」这类下限判据。
3. **听力 transcript ↔ 音频一致性**：listening.md 全篇只审 transcript 文本，**零维度**覆盖「配的 TTS 音频和文本对不对得上、有没有读错/漏读/静音」（审查报告 §5.4 亦指出 backfill-TTS 无内容校验）。
4. **题干歧义性 / 唯一可解性**：bs.md 把「unique_arrangement / grammatical_and_reads_real」明标 `deferred-to-word-audit`（见 bs-difficulty-standard.json `correctness`）；ap/rdl 无题干歧义维度。
5. **文化/地域偏置**：9 份均无。（2026改后本身是校园生活语域，偏置风险相对低，但完全无声明。）

L2 rubric 若只照这 9 份，会系统性漏掉「解析烂 / 干扰项也对 / 音频串了 / 题干有歧义」这四类**用户一眼能看出、评审却打不出分**的病。**修订建议**：L2 执行方案里为「解析质量」「音频一致性」单列人工/DeepSeek 兜底通道（不指望现有 spec）。

### S4 — 小样本精确点值：多份 spec 印着 n<40 却写成小数点后一位的目标（检查单第 1/4 项）
高危案例（这些点值 L2 评审容易过度当真）：
- **ad.md D2** 教授 opener「61%/14%/11%」来自 **n=36**（spec 在 Deferred 诚实标了「±a few points」，但维度表正文仍是精确 61/14/11）。
- **ap.md D5** 10 路题型分布来自 **n=70**，其中 `main_idea 1.4%`、`sentence_select 1.4%` = **1/70 单例**却写成百分比；**ap.md D6** insert_text「57%」来自 **8/14 簇**（spec 自认「true rate plausibly higher」）。
- **bs.md D12** distractor「0%」来自 **14 屏渲染**——却被 spec 自己标为「#1 GAP / the single largest structural gap」，用 14 个样本支撑整库最大杠杆。
- **repeat.md D15** 框架/角色来自 **13 组 ASR**；**interview** 全维度锚 = **14 组**。

这些多数在 Deferred 里诚实声明了（合格），问题是**维度表正文仍以精确点值呈现**，L2 读表不读 Deferred 就会把 1/70 当成稳定分布。**修订建议**：小 n 维度的正文点值改为「带宽 + n 标注」（例：`insert_text ~55-70%，n=14，宽容差`），像 rdl.md/interview 那样把弱锚写进正文而非脚注。

### S5 — spec ↔ live gate 同名维度定义分歧（BS 实证，检查单第 4/6 项）
以 BS 为例实测 `docs/eval-spec/bs.md` 与线上冻结门 `data/eval-profiles/bs-difficulty-standard.json`（两者都自称 derive 自同一 504-recalled 锚）：

| 维度 | bs.md 正文 | 线上 gate | 分歧 |
|---|---|---|---|
| first_person | D11 **40.3%**（`isFirstPerson`=句首 I/I'm/My/No,I） | `register.first_person.target=0.623` | **相差 22pp** |
| addresses_you | D16 **75.8%**（n=298） | `prompt_register.addresses_you.target=0.628`（n=234） | 值与 n 双不一致 |
| casual_opener | D10 10.1% | `register.casual_opener.target=0.101` | ✓ 一致 |
| negation | D6 24.0% | `structure_direction_only.negation=0.284` | +4.4pp |

同名维度 `first_person` 在 spec 里是「句首第一人称」、在 gate 里疑似「含第一人称」——**同名不同义**。L2 评审若读 bs.md 拿 40.3% 当线、而线上门用 62.3%，会「同题不同判」。这正是任务里「bs.md 最老、与多轮 calibration-fix 是否脱节」的实证：**bs.md 与线上门是两次独立 derive 的产物，数字在 first_person/addresses_you 上明显对不齐**（具体谁对交 R0，但方向性冲突确凿）。**修订建议**：bs.md 与 bs-difficulty-standard.json 的维度**命名+口径**做一次对齐，标清每个 detector 的精确定义。

> 注：git 层面 `docs/eval-spec/bs.md` 与 `data/eval-profiles/bs.json` 只能看到单个 commit（`f6c1f38` 2026-06-28，浅克隆 + squash 边界，历史不可考），无法用 git 时间线证明脱节；上表的数字对账是更硬的证据。

---

## 2. 逐份审查

### 2.1 `bs.md` — Build a Sentence（写作·拖拽造句）

1. **锚可信度/样本量**：文本层维度（D1-D11 长度/句型/否定/关系从句/被动/语域）锚在 504 recalled targets（实测 ✓，tier 全 recalled），detector 逐一手验（spec §Measurer 记录了 direct-question detector 的拆分修正）——**扎实**。但**最高杠杆的 D12 distractor 只有 14 屏渲染/6 卷**，且 spec 自己承认与 `etsProfile.js` 的 82%、`tpo_official.json` 的 10% 三方矛盾（D12 + Deferred「0%/82%/10% cannot all be right」）。过拟合：D12 用 n=14 支撑「整库最大结构杠杆」（见 S4）。
2. **时效**：**唯一主动清算老锚的 spec**——D17 明写 TPO-era opener 目标对 2026改后是错的，D5/D3 把老 TPO 数字标 stale。正面。但仍缺「504 锚采于 2026 上半年」的时效脚注（S1）。
3. **维度覆盖**：18 维覆盖长度/难度/句型/语域/prefilled/prompt-stem/topic，相当全。**未罩**：题目「唯一可解性/语法性」被明标 `deferred-to-word-audit`（gate `correctness`）；解析——BS 无解析，N/A。distractor 合理性下限即 D12 本身（未定案）。
4. **内部一致性**：与线上门 first_person/addresses_you 数字对不齐（S5，实证）。spec 内部 D3/D4/D5 的 question-form 口径自洽（D4 自注「D4 的 14.5% undercounts；D3 的 35% 才是真」）——**这条处理得好**。
5. **L2 可执行性**：D1/D2/D6/D7/D9/D16/D17 有硬 detector + 明确带 = **可直判**；D12 distractor（0% vs 89%）判据清晰但**锚未定案** → **仅 monitor**（线上门 `distractor_presence.gate=false` 与此一致）；D13 chunk 单词比、D14/D15 prefilled 细分标 partial → **需补判据**。
6. **产线口径**：bs.md D12 指出生成侧锚 `etsProfile.js distractorRatio 0.88` 违反「真题唯一锚」（CLAUDE.md），线上门已把 distractor 降为 monitor——**方向一致但未闭环**。gen 侧 Current 快照 860 已失效（live 634，S2）。

**裁决：修后可用。** 修订点：(a) distractor（D12）在 0/82/10 定案前**保持 monitor-only，L2 不下硬 verdict**；(b) 对齐 bs.md 与 bs-difficulty-standard.json 的 first_person/addresses_you 命名口径（S5）；(c) 加时效脚注。其余文本层维度可直接当 rubric。

### 2.2 `ad.md` — Academic Discussion（写作·学术讨论）

1. **锚可信度/样本量**：学生文本/长度锚 n=96（structured，✓）扎实；**教授帖的高价值维度（D2 opener、D3 两面框架、D6 Why 标、D8 长度）全部 n=36 手抄 OCR**（D1 头部声明）。50 组结构锚 ✓ 实测。过拟合：D2 的 61/14/11 来自 n=36（S4）；D1「100% Dr.」、D15「0% s2 named s1」来自 n=50，spec 在 Deferred 诚实写「0% can't be proven from a 50-item sample」。
2. **时效**：D1/D2/D15/D19 反复标「94% 是 old TPO、对 2026改后错」，主动纠代际漂移。正面。缺统一时效脚注。
3. **维度覆盖**：21 维（教授帖 9 + 学生 9 + 池 3），模板类维度覆盖极全。**未罩**：D 无解析（essay 任务，N/A）；per-item 难度 spec 明标 deferred（无标签、人评作文）——合理弃权。
4. **内部一致性**：好。D16 明确区分「intra-argument hedge（允许）vs peer-directed（禁止）」，并说明 D15 与 D16 的关系；未见自相矛盾。
5. **L2 可执行性**：D1（Dr. 正则）、D14（S1「I believe」+S2「In my opinion」配对）、D15（S2 是否点名 S1）、D19（名字 ∈ 四人池）= **可直判、判据带正反例**；D5 question-stem 类型、D2 opener 类分 = 需分类器但 spec 给了 detector；D17「concrete example 9.4%」可判。整体 L2 友好度 9 份里最高之一。
6. **产线口径**：D1「gen 144/144 = 'Professor'，0% Dr.」「D15 gen 36% 点名 vs real 0%」明确指出 prompt builder（`s2ReferencesS1` 分支、`DISC_STUDENT_NAMES` 50 名池）没执行 2026改后口径——**方向性矛盾抓得准**。live 库 193（spec 144 失效，S2）。

**裁决：可用。** 微修：D2/D6 等 n=36 点值在正文补「n=36，±few pts」标注（把 Deferred 的诚实声明提到正文）；L2 忽略 Current 列。

### 2.3 `email.md` — Write an Email（写作·邮件）

1. **锚可信度/样本量**：51 组，**bullets/recipient/subject 经 OCR 与 email.json 逐字对齐**（D1 头部，实测 51 ✓）——结构层锚是 9 份里最硬的之一。scenario 散文被 DeepSeek 扩写 → D9/D10 长度/句数标 partial（诚实）。macro 功能 D5、topic D14 手分类，~2-3/51 边界模糊标 partial。
2. **时效**：D8 明写「prompt 的 8%/8% 来自旧 13 题 TPO 样本，被这 51 题 recalled 取代」；D14 用 51 题重定权重。主动纠偏。缺时效脚注。
3. **维度覆盖**：17 维覆盖 bullet 弧/动词/recipient 形态/场景/主题/相干性。**亮点**：D15（recipient↔topic 相干）、D16（bullet 悬空指代）是**可自动判的硬缺陷维度**，直接对应审查报告 §2.4 的 em224-227 类占位符病。**未罩**：register/tone 明标 deferred（prompt 无邮件正文，属评分侧）——合理弃权。
4. **内部一致性**：好。Correlation 1-3 把 recipient-role ⇄ macro-function ⇄ topic 的联动讲清，无冲突。
5. **L2 可执行性**：D1/D6/D12/D15/D16 = **可直判**（3 bullet、recipient 形态白名单、subject 词数、相干性、悬空名）；D5 macro、D14 topic = 需分类器但 spec 给了 `classifyMacro/topicDomain` + 逐条 verbatim 例，可判；D9/D10 partial 定性。
6. **产线口径**：D6「gen 32% 用真题从不用的 recipient 形态（First Last / 部门名）」、D14「gen services/leisure 仅 6.5% vs real 65%」、D5「EMAIL_CATEGORIES 权重整体错形」——明确指到 `EMAIL_CATEGORIES` 该加「Services & Events」大类。方向清楚。live 196（spec 139 失效，S2）。

**裁决：可用。** L2 直接可用；忽略 Current 列即可。

### 2.4 `ap.md` — Academic Passage（阅读·学术段落）

1. **锚可信度/样本量**：passage 文本/长度/词汇/段一风格锚在 64→39 clean（实测 64 ✓），扎实。**但题目层全靠 n=70 手编码（14 簇）**——10 路题型分布里 main_idea/sentence_select 是 1/70 单例（S4）。distractor trap-logic + 真题答案位 **明标 deferred（无 answer key）**。
2. **时效**：§「最重要 context」明写 2 个 live code 数字（passage 长度 280-360、received_wisdom 0.46）是「inherited from OLD classic-TOEFL、对 2026改后错」——主动纠。缺时效脚注。
3. **维度覆盖**：20 维覆盖长度/段落/句长/题型/insert_text/词汇/选项/开篇/hedge/对比/被动/词域/topic。**未罩**：解析质量（§6 盲区，AP 题有解析要展示，rubric 不判）；distractor「不能明显也对」的下限（deferred）；D11/D12 答案位/最长项对真题 deferred（只有 gen 侧数）。
4. **内部一致性**：好。C1（难度=抽象度非长度）、C2（insert_text 与段落设计是一维）、C4（over-regularity 是合成味）逻辑自洽。
5. **L2 可执行性**：D1/D2/D7/D8/D9 = 可直判（题数、词数、选项词数）；D5 题型分布、D6 insert_text = 可判但**锚薄（n=70/14）→ 建议 monitor 而非硬 gate**；D13 开篇策略、D18/D19 词域/topic = 可判；distractor 层 = **仅 monitor**（deferred）。
6. **产线口径**：D5「gen insert_text 0% vs 11.4%、paragraph_relationship 4.7× 过产」、D2「gen 27% 超真题整个长度范围」——明确指到 `QUESTION_PLANS` 缺 insert_text、`AP_PROFILE.passageWordCount` 是旧值。方向准。live 172（spec 156 失效，S2）。

**裁决：修后可用。** 修订点：(a) 题型分布 D5、insert_text D6 因锚薄，L2 用**宽带 monitor**，正文补 n 标注；(b) distractor 层维持 deferred，L2 不判；(c) passage 文本层维度（D2/D13/D14/D15/D16/D18）可直判。

### 2.5 `ctw.md` — Complete the Words（阅读·首字母填空）

1. **锚可信度/样本量**：75→48 clean 答案键（**481 blanks**，实测 75 ✓），blank 级统计样本充足。**blank 机制被硬验证**（D5：`floor(len/2)` 规则对 17/19 手配 OCR 命中）——这是 9 份里少见的「detector 本身被真题验过」。passage 词数因 OCR 粘连**低估**，用 glue-repair 估计（~71.8）而非精确值（D2 标注，诚实）。D8「43% rare」spec 自认被不完整词表**夸大**（partial）。
2. **时效**：D7/D8 明写 prompt 的「平均词长 4.5-5.5」「CEFR A2-B1」校准得比真题**简单**，validator 反而会拒 19% 的真题——指出标准把生成器调易了。缺时效脚注。
3. **维度覆盖**：11 维覆盖 blank 数/长度/词性/形态/难度/passage 形状/首句/topic/完整性。**亮点**：D11（bank 完整性，25/191 无 blanks 数组）是可自动判的数据完整性维度。**未罩**：解析质量（CTW 无独立解析，弱相关，N/A 偏多）；per-blank 可猜性/歧义 明标 deferred。
4. **内部一致性**：好。Correlation 1-3 把「passage 太短太平 → 无 intact tail → blank 太易」的因果链讲成一个根因，且明确 D8 的 43% 是词表假象、D4 长度信号才可信——**主动排雷内部矛盾**。
5. **L2 可执行性**：D1/D2/D4/D11 = 可直判（数值/完整性）；D3/D9 = 可判；D6 passage 形状 = 结构式可判（spec 给了公式）；D8 vocab ceiling 绝对% = **仅 monitor**（词表不全，方向可信、绝对值不可信，spec 自标）。
6. **产线口径**：D2「gen 56 词 vs real 70-72」「validator `wc<45` 不真正 enforce 62 floor」、D8「validator 用不全词表会拒 9/48 真题」——**指出 validator 判得比真题严**（罕见的「产线更严」而非更松）。方向准。live 349（spec 191 失效，+158 是全库偏差最大者，S2）。

**裁决：可用。** L2 可直接用文本/blank 维度；D8 绝对难度%走 monitor。ctw 是 9 份里锚验证最扎实的（唯一接了 gate-registry 的题型，报告 §5.1）。

### 2.6 `listening.md` — 一份罩 LC/LA/LAT/LCR 四型

1. **锚可信度/样本量**：文本层锚 n 大（conv 155/ann 78/lec 113/shortResp 178 prompt，实测 ✓），但**两大数据污染**头部即声明：多数 JSON 是无题、无 speaker label 的 ASR 单块；ASR 会把相邻音频**粘成一条**（长度离群），所有长度目标用 clean filter 剔除。自评「18 solid / 1 partial / 1 deferred」。**题干类型 + 选项/干扰逻辑 = deferred**（在图片 PDF）。
2. **时效**：B2 明写「prompt 的『64% Attention』claim is FALSE against real 2026」、C1「header 已 05-31 修但 5-14 库 stale」。主动纠。缺时效脚注。
3. **维度覆盖（重点查 LCR/LAT 是否被同一套硬套）**：**结构上四型各有独立维度块**——A（LC 6 维）/B（LA 4 维）/C（LAT 5 维）/D（short-response/LCR 4 维）/E（跨型 3 维）。**LCR（选答句）和 LAT（讲座）形态差异最大的两型没有被硬套同一套**：LCR 走 D1-D4（prompt 长度/句型/campus/干扰陷阱），LAT 走 C1-C5（讲座长度/学科/语域/第二人称/题数），各自锚各自的真题子集。**这条通过。** 跨型 E1（答案位 A24/B28/C28/D20，n=658）、E2（题数）合并四型是合理的（答案键字母分布是全卷属性）。**未罩**：解析质量（§6，LA/LAT 线上库中文解析、泄露内部标签——rubric 不判）；**transcript↔音频一致性零维度**（S3-3）；干扰项合理性下限只有 D4 partial。
4. **内部一致性**：好。Correlation 1（register 阶梯 conv 4.5>ann 1.9>lec 1.2，bank 反转）清晰；E1 note 明确「真题本身 B/C 偏，别强推 25/25/25/25」——避免了「强制均匀」的错判据。
5. **L2 可执行性**：A1/A2/B1/C1/D1（长度/turn/词数）、A5/B4/C3（contraction 密度）、C2/B3（学科/context 分布）、D2（wh vs y/n）= **可直判**；A3/A4 relationship/topic = 可判但 A4 标 partial；**题干类型分布 E3 = deferred / 选项·干扰 trap 频率 = deferred → 仅 monitor**（无锚，S3）。
6. **产线口径**：A3「gen 52% service vs real 78-97% peer」、B2「gen Attention 48% vs 21%」、C1「每条 gen 讲座 max 189 < 真题 min 192」、D2「gen wh 7% vs real 49%」——**逐型指到具体 builder 行号**（`lcPromptBuilder.js:20-71` 等）。方向极准。gen 侧 Current 快照（LC n=23 等）失效且来源不明（S2，本型最严重）。

**裁决：修后可用。** 修订点：(a) **文本层维度（A/B/C 的长度/register/domain/opener + D1/D2/D3）可直判**；(b) **题干类型/选项/干扰层（D4/E3）无锚 → 仅 monitor，L2 不下硬 verdict**；(c) 补 transcript↔音频一致性的兜底通道（不靠本 spec）；(d) gen 侧诊断在 live 库（LC 180/LAT 133）上重算，别信 n=23 快照。

### 2.7 `rdl.md` — Read in Daily Life（阅读，07-09 新写，**自声明银锚**）

1. **锚可信度/样本量**：**银锚**——实测 goarno 44 组/132 题（备考商）+ third_party 7/18 + ETS official 6 组/16 题；`realExam2026` 下**零 RDL 回忆卷**（头部实测 ✓）。定量以银层 52 组/152 题为主体。spec **头部即自声明**「置信级 = 官方样本定性 + 备考商语料定量……弱于其他题型的考场回忆锚」「全维度默认 monitor-only，不设冻结 hard-gate」。**诚实度满分，但作者自声明弱锚 ≠ 豁免**（任务明确要求同样严格审）：
   - **银锚的真实风险**：备考商（goarno）是**模仿 ETS**的题，定量目标（D4 改写深度 synthesis 66>synonym 42、D5 陷阱类型分布、D3 题型 55/28/12/5）**全部 derive 自模仿品**。若 goarno 系统性偏离真题（例如备考商偏爱某种干扰构造），标准会把「像 goarno」当「像 ETS」。spec 的 D0 下一步①「确认备考商银锚没把标准带偏」正是承认了这点——**但在补金锚之前，D3-D9 的定量点值都带着未验证的银锚偏置**。
2. **时效**：分析文件 2026-04-09 实测，spec 07-09 沉淀；官方 6 组标注 2026。相对新。P2-16 补金锚挂起（诚实）。
3. **维度覆盖**：11 维覆盖字数/题数/题型/改写深度/干扰构造/选项独立/答案位/题干/质感/可猜性/时间条件。**亮点**：D5「干扰项也必须像原文说的（重叠 0.50 vs 正确项 0.60）」「反直觉：干扰项比正确项更具体 40 vs 23」——这是**唯一一份认真处理「干扰项合理性下限」的 spec**。D10「可猜性 ≤18%」是可测的选项泄底维度。**未罩**：解析质量（§6）。
4. **内部一致性**：好，无冲突；每维标了 detector 现成度（已有/易加/L2 抽样）。
5. **L2 可执行性**：D1/D2/D6/D8/D11 = detector 已有/易加，可判；D3/D4/D5/D7/D9 = 「L2 抽样核对」**偏定性**（改写深度、陷阱类型需人判）→ **需补判据或走 monitor**；D10 可猜性 = answerAuditor 可测。整体**判据成熟度低于回忆锚题型**（多为「抽样核对」而非硬 detector），与其 monitor-only 定位一致。
6. **产线口径**：spec 明确现行硬门只有 validateRDLItem（结构）+ 字数带 + answerAuditor（答案对错），维度先服务 L2 抽样。升级 hard-gate 前置（precision≥0.95 + 补金锚）写清。口径诚实。live rdl-short 221/long 134（spec 225/136，接近，S2 偏差最小者）。

**裁决：仅 monitor（与其自声明一致）。** 可作 L2 软 rubric（结构化 verdict 参考），但**不下硬 verdict**，理由：锚是备考商银层、无考场回忆金锚、多数维度 detector precision 未验。修订建议：D3-D5/D9 的定量点值加「银锚、未对考场回忆验证」显式警示到**每个维度正文**（现在只在头部一句）；优先推进 P2-16 补 3-5 组考场回忆做银锚校验。

### 2.8 `speaking_repeat.md` — Listen-and-Repeat（口语·跟读）

1. **锚可信度/样本量**：文本/长度锚 n=351 句（51 组，实测 ✓，tier=recalled）扎实；**框架/角色 D15 仅 13 组 ASR**（partial）；per-set difficulty 是**按词数自动派生**的长度桶（非句法难度，D1 头部诚实声明——这点很重要，避免了把长度当难度的误判）。timing **deferred**。
2. **时效**：D3 明写 prompt 硬编码的 2/3/2 阶梯真题只占 6.4%；D5/D7/D12 指出 prompt 的两个 worked example 直接种下了「Welcome/yes-no 问句/惩罚性警告」合成味。主动纠。缺时效脚注。
3. **维度覆盖**：15 维覆盖句数/长度/难度混合/进程/opener/语气/问句/contraction/直接称呼/从句/条件句/惩罚 trope/收尾 wayfinding/场景/框架文本。**亮点**：D7（0% 问句）、D12（0% 惩罚警告）是**0%/明确的合成味指纹**，极易判。**未罩**：口语无解析（评分走 STT，N/A）；D15 框架文本缺失是结构缺陷维度。
4. **内部一致性**：好。Correlation 1（难度≈词数）、2（长收尾扛从句）、3（合成味=greeting+question+threat 共现）自洽，且明确「validator `natural_spoken_register` 奖励 contraction/直接称呼是 mis-calibrated」——**主动指出 validator 自身的判据错向**。
5. **L2 可执行性**：D1/D2/D6/D7/D9/D12/D13 = **可直判**（数值/0%/关键词扫描，判据带正反例）；D3 难度混合 = 可判（set 级签名直方图）；D10 partial（hard 从句率）、D14/D15 partial（场景/框架，13 组锚）→ 需补判据。
6. **产线口径**：D3「gen 100% 是 2/3/2，validator 也在 warn 非 2/3/2」「D12 惩罚 trope 被 prompt S7 example 逐字种下」「D5 OUTPUT FORMAT 样句 'Welcome to...' 锚死模型」——**精确指到 prompt example 与 validator 规则**。方向准。live 96（spec 11 套/77 句，早期小样本失效，S2）。

**裁决：可用。** 文本/语气/opener/合成味维度（D1-D9/D11-D13）可直接当 rubric；D10/D14/D15 因 13 组小锚走 monitor。

### 2.9 `speaking_interview.md` — Interview（口语·采访，07-09 新写，**自声明锚弱**）

1. **锚可信度/样本量**：**最弱锚**——`interview.json` 14 组（实测 ✓，全 recalled）。spec **头部即列「输入可靠性（先说丑话）」**：问题条数中等可信（漏记只少不多，取下界）；**问题文本「不可信」**（回忆者写压缩转述、非考场完整口语，不能当字数锚）；setting/transcript 部分组可用于定性。**诚实度满分，但严格审仍要指出**：14 组 + 关键的「字数/问数」两个定量锚都被作者自己判为不可用，意味着 **D2 字数递进、每套问数这两个核心维度实质无真题锚**，现行 validator 的 25-50 词带是「产品标准」而非真题 derive（spec D2 明标「产品标准，非真题 derive」）。
2. **时效**：07-09 新写，锚同季。P2-16 补带完整问句的回忆/录音挂起（诚实）。
3. **维度覆盖**：5 维（4 问 schema/字数递进/全疑问不重复/递进结构/话题多样）。维度数最少。**未罩**：解析（评分走 STT+speakingEval，出题侧无解析，N/A）；话题域偏置只有 D5 monitor。**「已知锚点差距」表**明确列了「每套问题数 4 vs 真题 3-9 中位 6-7」是**App 任务设计（4×45s 时长上限）而非校准错误**——这条把「产品约束 vs 拟真」分得很清，是好处理。
4. **内部一致性**：好，无冲突；每维标了 detector 与 gate 状态。
5. **L2 可执行性**：D1（4 问 schema）、D3（全疑问句+去重）= validator 可直判（结构性，precision 高）；**D2 字数递进 = 锚不可用 → monitor-only（spec 已标）；D4 递进结构 = 定性，无 detector（spec 明写「暂无自动 detector」）→ 太定性；D5 话题 = monitor**。**拟真度维度实质只有结构层可判**。
6. **产线口径**：spec 详列接线状态（print-bank-prompt→staging→merge validateInterviewSet fail-closed→scoreBatch→check-quality-gates），并标「R1 trigger 配置尚需加行」——口径透明。live interview 11 组（spec 11 ✓，唯一对得上的，因是人工放置初始库未自动生成）。
7. **补充风险**：interview 是审查报告 §5.1「五处全缺席 + staging 免检直通」的题型；spec 声称 07-09 已接线（方案A），但「R1 trigger 加行」在 repo 外未完成——**产线尚未真正自动产出，spec 描述的接线是「计划完成态」而非「已验证运行态」**。L2 若抽样 interview，样本来自人工初始库而非产线。

**裁决：仅 monitor（与其自声明一致）。** 结构维度（D1/D3）可 validator 硬判；**拟真度维度（D2/D4/D5）锚不足，L2 不下硬 verdict**。修订建议：把「D2/D4 无真题锚」从头部提示强化到维度正文；P2-16 补带完整问句的回忆后再考虑升级；接线完成前，L2 抽样需注明样本来自人工库。

---

## 3. 汇总裁决表

| spec | 锚等级 | 主要问题（≤3） | 初步裁决 |
|---|---|---|---|
| **bs** | 考场回忆（文本层强 / distractor 层弱：14 屏渲染） | ①distractor 0/82/10 三方矛盾未定案（gate 已 monitor）②与线上门 first_person/addresses_you 同名不同义（S5）③Current 860 快照失效(live 634) | **修后可用**（distractor 仅 monitor；对齐 spec↔gate 命名） |
| **ad** | 考场回忆（学生强 / 教授帖 n=36） | ①教授高价值维度 n=36，61/14/11 精确点值有过拟合味②0% 类结论无法从 n=50 证死（spec 已认）③Current 144 失效(live 193) | **可用**（微修：小 n 点值补带宽标注） |
| **email** | 考场回忆（bullets OCR 逐字对齐，强） | ①macro/topic 手分类 partial②register 无正文可测(deferred)③Current 139 失效(live 196) | **可用** |
| **ap** | 考场回忆（文本层强 / 题目层 n=70 薄） | ①题型 10 路分布含 1/70 单例、insert_text 57%(n=14) 过拟合②distractor trap-logic 无 answer key(deferred)③解析质量无维度(§6) | **修后可用**（题型/insert_text 走宽带 monitor；distractor 不判） |
| **ctw** | 考场回忆（481 blanks，机制被硬验证，强） | ①passage 词数 OCR 低估、用估计值②D8「43% rare」被不全词表夸大(spec 已认)③Current 191 失效(live 349,偏差最大) | **可用**（D8 绝对难度% 走 monitor） |
| **listening** | 考场回忆（文本层强 / 题干·选项·干扰在图片 PDF：deferred） | ①题干类型/选项/干扰频率无锚(deferred)②transcript↔音频一致性零维度(§6/S3)③gen 侧快照 LC n=23/LAT n=14 来源不明、live 是其 8-10 倍 | **修后可用**（文本层可直判；题目/选项/干扰层仅 monitor；LCR/LAT 分型处理已通过） |
| **rdl** | **银锚**（备考商 goarno 为主 + 官方 6 组，无考场回忆） | ①定量全 derive 自模仿品(goarno)，补金锚前带未验证偏置②D3-D5/D9 多为「L2 抽样核对」定性判据③解析质量无维度 | **仅 monitor**（自声明，一致；D5 干扰项下限维度是亮点，可参考） |
| **speaking_repeat** | 考场回忆（351 句文本层强 / 框架 13 组 ASR） | ①D15 框架文本、D14 场景锚仅 13 组(partial)②timing deferred③Current 11 套快照失效(live 96) | **可用**（文本/合成味维度直判；D10/D14/D15 走 monitor） |
| **speaking_interview** | **考场回忆最弱**（14 组，问句文本自认不可用） | ①字数/问数两个核心定量锚被作者判不可用→D2/D4 拟真维度实质无锚②D4 递进无 detector(太定性)③接线为计划态、产线未验证运行 | **仅 monitor**（自声明，一致；结构维度 D1/D3 可 validator 硬判） |

**给 L2 执行的三条总原则**：
1. **只信 Real/锚目标值，弃用每份 spec 的 Current/Gap 列**（全部对着已失效的旧库算，S2）——或先用 R0 脚本对 live 库重算 gen 侧。
2. **「题目怎么出/选项怎么设/干扰怎么埋/解析写得好不好/音频对不对得上」这五个面，9 份 spec 系统性无锚或无维度**（S3）——L2 对 bs-distractor、ap-distractor、listening-题目层、全库解析质量、听力音频一致性**一律走 monitor 或人工/DeepSeek 兜底，不下硬 verdict**。
3. **三档裁决落到抽样**：可用（bs 文本层/ad/email/ctw/repeat 文本层/listening 文本层）→ 结构化 verdict 可硬判；修后可用（ap/bs distractor/listening 题目层）→ 先补修订点或降级 monitor；仅 monitor（rdl/interview）→ 只出「像/不像 + 病因」软信号，不进硬 gate。这与审查报告 §5.1「hard-gate 要求 detector_precision≥0.95」和 rdl/interview 的自声明一致。
