# L3 人审拍板包 — 全库质量审计收尾（2026-07-09）

> 本文件是 L0/L1/L1.5 三层机器审计的最终汇总，按「人需要做什么决策」组织。
> 明细索引见文末；fail-closed 原则贯穿全程：机器只出嫌疑，删/修/留全部由人拍板。

## 审计漏斗总览

| 层 | 范围 | 结果 |
|---|---|---|
| L0 确定性全扫 | 全库 2855 题 13 库 | validator/形态/难度/音频全干净；唯一嫌疑 = **BS 题级重复 11 条** |
| L1 答案二审（DeepSeek 独立作答） | 客观题 1689 条 8 库 | **177 suspect + 5 ambiguous**（lc、rdl-short 零嫌疑） |
| L1.5 嫌疑复审（同款 auditor 二轮 + 完整明细） | 上述 182 条 | **164 复现 / 14 未复现 / 4 多解** — 复现率 90%，嫌疑是真分歧不是模型噪声 |

需要人处理的全部集中在下面 4 个决策块；预计总人工时间 **1.5~2.5 小时**。

---

## 决策块 A — BS 题级重复 11 条 ✅ 已拍板并执行（2026-07-09）

**拍板**：第 3 对（ets_s44_q8 / ets_s42_q6）两条都保留，其余 10 对删左列。
**执行**：删 10 条（654→644）。因 4 个组删后跌破组级风格窗口（负句/嵌入句下限），做了组间再平衡：
解散 s61（删 3 后仅剩 7 条且负句归零），其嵌入句补 s44/s62、普通句回填捐赠组与缺员组；
负句缺口从富余组借（s15→s43、s20→s62）。移动 9 条，全部 65 组重新过 validateQuestionSet，
合库同款 contentDedup 复核剩余题级重复 = 0（保留对在默认阈值下不触发）。

原始清单存档（4 exact + 7 near）：

| # | 判定 | 待决 id | 撞 id | 待决题 | 被撞题 |
|---|---|---|---|---|---|
| 1 | near | ets_s37_q6 | ets_s25_q8 | Are you ready for your big presentation? → I have not rehearsed the closing slides yet. | Are you ready for tomorrow's class presentation? → No, I have not rehearsed my slides yet. |
| 2 | near | ets_s43_q4 | cg_bs_s1_q3 | Are you ready to hand in the assignment? → I haven't finished the final lab report yet. | Why do you look so stressed today? → I haven't finished my lab report yet. |
| 3 | near | ets_s44_q8 | ets_s42_q6 | Did you find out the gym schedule? → I asked whether the new gym opens before eight. | Did Emma tell you the gym hours? → I asked if the new gym opens before eight. |
| 4 | exact | ets_s44_q9 | ets_s34_q5 | I can't find the textbook on the shelves. → I wonder if the bookstore still has the textbook. | Have you bought all your course books? → I wonder if the bookstore still has my textbook. |
| 5 | exact | ets_s46_q5 | ets_s40_q6 | Did you figure out the lab hours? → He asked if the lab opens before nine. | Did Emma tell you when the lab opens? → I asked if the lab opens before nine. |
| 6 | exact | ets_s60_q1 | cg_bs_s1_q3 | Have you finished writing up the experiment? → I haven't finished my lab report yet. | Why do you look so stressed today? → I haven't finished my lab report yet. |
| 7 | near | ets_s61_q4 | ets_s34_q4 | The librarian says your account has a hold. → I haven't returned the overdue library books yet. | Have you taken those books back? → I haven't returned the library books yet. |
| 8 | near | ets_s61_q7 | ets_s57_q9 | You told me you got feedback on your paper. → My economics professor praised the detailed research paper that I submitted. | Did Julian mention how the paper went? → …that I submitted last week. |
| 9 | near | ets_s61_q9 | ets_s58_q10 | You noticed the second floor is open again. → The reading room on the second floor was finally reopened to students. | Did you hear about the library renovation? → …reopened to students this week. |
| 10 | exact | ets_s62_q2 | ets_s57_q5 | You wanted to check something with the registrar. → I asked if the deadline had already passed. | Does Mariana know the exact deadline? → I asked if the deadline had already passed. |
| 11 | near | ets_s62_q4 | ets_s59_q4 | You mentioned the trip sign-up is filling up. → I have not paid the field trip deposit yet. | Did you sign up for the ski trip? → I have not paid the trip deposit yet. |

---

## 决策块 B — 选择题疑似错键

分两支：**插句题（ap insert_text 23 条）→ 走盲解定调（任务 1，进行中，等你的 5 题答案）**；
**非插句 37 条 → 已逐条审完（任务 3）**，详见 `L3-TASK3-VERDICTS.md`。

### 任务 3 结论（37 条已判）：只有 1 条真错键

| 判决 | 条数 | 处置 |
|---|---|---|
| ✅ 键正确 | 33 | 保留 |
| ❌ 真错键 | 1 | **已修** ap_mpzvh9ag_3 C→B（其 explanation 自认错、原文直接打脸） |
| ⚠ 判断题交你拍板 | 3 | ap_mpx0lfar_2 / rdl_long_rt_001 / lcr_mpw1ilch_1（倾向已给） |

**头号发现**：听力「嫌疑」绝大多数是 DeepSeek `best` 字段噪声——它的 `reasoning` 描述的正是我们的键，
`best` 却误填（21 条 lat 里 15 条误填末位 D）。这不是错键，是 AI 结构化输出不可靠。
方法论修正见 verdicts 文档：听力二审信 `reasoning` 不信 `best`；L1 听力 suspect 计数应打折。

### 插句题（任务 1，待你 5 题盲解）

ap 的 insert_text 高度集中（23 条）说明「生成器插句键」和「AI 判插句」至少一方系统性偏弱。
盲解卷已发（`ap-blind-test.md`）：你解 5 题→与键一致 ≥4/5 判 auditor 弱、其余降级抽查；≤2/5 判生成器插句规则弱、立项全修。
另注：ap_mpzvh9ag_0 / ap_rt_20260608_2 两条插句题的 explanation 是糊涂话（生成器解析质量问题），一并归此族。

**逐条处理规约**：AI 对 → 改键（或直接删题）；键对 → 在题上标 `audit_keep`（进 auditor 已知误报清单，后续跑批不再报）。

---

## 决策块 C — ctw 多解空（**族群决策，勿逐题人审**：109 题 / 129 个 critical 空）

C-test 空的「AI 填词吻合词首碎片但≠原词」= 该空可能多解。129 个空聚类后**根因是规则问题，不是 109 道题各自的问题**：

| 类 | 空数 | 例 | 性质 |
|---|---|---|---|
| 碎片 ≤2 字母的功能词 | **76** | `o:on/of`、`th:this/the`、`Th:This/The`、`ha:hard/have`、`f:far/from` | 碎片太短根本锁不住唯一解——**生成规则缺陷** |
| 屈折变体 | **40** | `swells/swell`、`sugars/sugar`、`provides/provide`、`fungal/fungi` | 语法多数能锁定，但若判分只认原词则边缘用户吃亏——**判分宽容度问题** |
| 内容词近义 | **13** | `fertile/ferrous`、`quietly/quickly`、`harmful/hardy` | 真·逐空人审（只 13 个，10 分钟） |

**⚠ 建议修正（2026-07-09 复核真题锚后）**：最初想「禁功能词挖空/碎片最短 3 字母」，
但真题（data/realExam2026/reading/completeTheWords.json，如 2026-01-21 卷
"Th_ can cha_ landscapes thr_ processes li_ erosion a_ deposition"）**本身就挖功能词、给 1-2 字母碎片**
——一刀切禁掉会偏离真题风格。多解不是风格问题，是「上下文没锁住唯一解」的生成质量问题
（真题的短碎片空基本都被语法/指代锁定）。且我们判分是严格匹配原词
（components/reading/CTWTask.js:90 `userFull === expected`），锁不住 = 用户真吃亏。

**修正后的立项建议**：
1. 生成/校验环节加**唯一解校验器**：对每个空枚举吻合碎片的常见候选词（确定性词表 + AI 双通道），
   凡存在第二个「语法+语义都通」的候选即判多解，换词重挖——保住真题风格，掐掉多解；
2. 屈折变体类（40 空）：判分端接受语法等价形式，或重挖空——二选一；
3. 13 个内容词近义空逐个看语境是否锁定，锁不住的重挖空（10 分钟人审）；
4. 修复后重跑 `full-audit-l1`（banks=ctw）验证归零。

---

## 决策块 D — 复审未复现 14 条：降级观察，不动

两轮结论不一致（L1 报嫌疑、L1.5 干净）= 模型边缘噪声。**建议不处理**，留观后续夜间 quality-monitor：
ap_rt_20260608_1 · rdl-long_mpvr2ny1_0 · ctw×5（见明细 JSON）· lat×5 · la×2。

---

## 产物索引与续跑

| 文件 | 内容 |
|---|---|
| `../L1-report.md` / `../L1-suspects.json` / `../L1-state.json` | L1 全量二审（在 `claude/recent-work-visibility-yg5ma4` 分支，1689/1689 全部审完） |
| `suspect-input.json` | L1 嫌疑快照（本包输入，182 条） |
| `L1-suspect-details.md` / `.json` | L1.5 复审逐条明细（人审 B/C 块对着它看） |
| `L1-detail-state.json` | L1.5 断点状态 |
| `../L0-report.md` / `../L0-suspects.json` | L0 全扫（工作分支） |

**续跑/复跑**：Actions → `full-audit-l1` → Run workflow → Branch 选本分支，`script` 填 `detail`（复审明细）或留 `full`（全量二审）。断点续跑不重复计费；要全新一轮先删对应 state 文件。

**审计脚本**：`scripts/audit/run-l1.mjs`（L1 全量）· `scripts/audit/run-l1-detail.mjs`（L1.5 复审）· `scripts/audit/run-l0.mjs` + `measure-anchors.mjs`（工作分支，L0/量尺）。

**分支说明**：本包与 L1.5 产物在 `claude/l1-audit-handoff-p7h3e0`（基于 main）；L0/L1 报告与本轮其余代码工作在 `claude/recent-work-visibility-yg5ma4`（未合 main，合并走 /ship）。两分支文件路径无冲突，可先后合并。
