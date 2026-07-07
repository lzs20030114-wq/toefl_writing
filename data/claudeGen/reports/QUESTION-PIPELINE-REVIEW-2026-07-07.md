# 出题管线全面审查报告 — 2026-07-07

> 范围：全部 12+ 题型的生成→校验→审核→门禁→合库→监控全链路，重点评估拟真度、多样性、质量稳定性与体系盲区。
> 方法：4 路并行代码盘点（生成器机制 / 门禁校准体系 / 产线链路旁路 / 数据面）+ 主线程对 13 个题库的独立量化统计（重复度、答案位、正确项长度、范式分布、与 `data/realExam2026/` 真题锚逐维对比）。
> 所有关键结论均带文件路径或可复现统计口径；日期口径为 2026-07-07。

---

## 0. 总评（TL;DR）

**研究底子是好的，产线是漏的。** 真题锚点体系、三级校验设计、味道模型（`question-pipeline-methodology`）、BS 冻结难度门这些「设计资产」质量很高，文本层拟真度已实测达标（各库词数/语域与真题锚差距在个位数百分比内，且零照抄）。但「设计上的管线」和「实际在跑的管线」之间存在系统性脱节，造成了三件用户已经在承受、而系统自己毫无感知的事：

| # | 问题 | 等级 | 一句话 |
|---|------|------|--------|
| 1 | **阅读/听力/口语 9 个库合库停摆 7–8 天，388 条新题积压 staging**，监控每晚报「✅ 一切正常」；根因=盲审 routine 的 trigger 已从台账消失 | **P0 活事故** | 生成的手还在动，合库的手断了，没人知道 |
| 2 | **6 个阅读/听力库 37–59% 内容重复**（同内容换 id 多次入库），860 条重复听力条目各自烧了一份 TTS，复发机制至今仍在 | **P0 存量+复发** | 名义 2600+ 题的阅读听力库，实际唯一内容约 1600 |
| 3 | **精工质量机制大多躺在「不跑的那条路径」里**：听力 AI 二审从未在主链路运行、Discussion/Email 全链路零 AI 审核、BS 熔断/模糊去重/位置重分配只在 DeepSeek 后备脚本里 | **P0 体系性** | 「validator/auditor 齐全」只对后备路径成立 |
| 4 | admin「部署到正式题库」按钮不过任何校验/门禁；email 库 4 条 `[recipient]` 占位符泄漏；BS 干扰词密度建立在与真题矛盾的旧锚上（0% vs 82% vs 10% 未定案） | P1 | 各自独立成条，见正文 |

---

## 1. 实际在跑的产线架构（审查后修正版）

CLAUDE.md 描述的是设计意图；下面是代码与提交历史证实的**现实**：

```
【路径 A · 主链路】Claude routine R1 (trig_01SmJe…, 每晚) + R2 补录 (trig_016m6u…)
  Claude 直接按 lib/*Gen 校准 prompt「脑内生成」→ 写 staging
  ├─ BS/Discussion/Email → scripts/mergeClaude.mjs 当晚直接合库
  │    BS: schema 硬校验 + bs-difficulty-scorer --gate (BS_GATE_ENFORCE 默认强制) ✅
  │    Disc/Email: 仅字段非空/条数检查 + 精确字符串去重，无字数/禁用词校验，无 AI 审核 ⚠️
  └─ 阅读×4 / 听力×4 / 口语 repeat → 只写 staging，等「专用盲审 routine」
       (scripts/routine-audit.mjs extract/apply: 去答案盲做→比对→剔除不一致→merge-staging 合库)
       ★ 该盲审 routine 无 trigger、无文档，6-21~6-25 自动跑过、6-27/6-30 人工补跑过，
         7-01 起彻底停止 → 9 个库停止更新 ← 当前活事故
【路径 B · 后备】scripts/generate-*.mjs (DeepSeek) + nightly-generate-*.yml (已摘除 cron，仅手动)
  各型完整三级校验 + AI Auditor + (BS) 熔断/模糊去重 —— 但日常不跑
【旁路】app/api/admin/staging/[runId]/deploy —— 零校验直写 live 库
【监控】nightly-quality-monitor.yml (唯一自动 cron)：只看 routine 完成时间戳 + BS 指标
```

关键事实（证据）：
- R1 commit message 自述：*"reading/listening/speaking … staged for the dedicated audit routine's blind answer-audit and merge"*（`09ce7e3`, 2026-07-05）。
- **R1 trigger 的 prompt 原文**（本次审查直接读取了 trigger 注册表）明确规定：*"Reading/listening/speaking are NOT merged by R1... they stay in staging for the dedicated audit routine... (Do NOT run merge-staging.mjs anywhere in R1.)"*，且 *"R1 must NOT write data/.last-nightly-summary.md — the audit routine sends the single nightly email"*——即整个设计把「合库+发邮件」都押在盲审 routine 上。
- **触发器台账实况（2026-07-07 实查）**：账号下只剩 **1 个 trigger**（name=R1，`trig_018dkRxEB6fcdthVYPV1rQg7`，每日 17:00 UTC，**2026-07-03 才创建**）。盲审 routine 与 R2 的 trigger 均不存在；CLAUDE.md 里记载的 R1 id（`trig_01SmJeXr8ySEZRo2dEoohzTP`）已是旧台账。时间线吻合「7-01~7-03 发生过一次 trigger 重建，盲审 routine 没被建回来」。R2 虽无 trigger 却仍在产出 commit（至 07-06），运行来源不明（可能挂在别的账号/机制下），本身也是台账外运行的风险点。
- `bot(audit)` 提交序列：6-21/6-22/6-25 自动 → 6-27(`66f79c5`)/6-30(`cd4034f`) 人工身份补跑 → **此后为零**。
- 听力 auditor 在合库脚本中被有意跳过：`scripts/merge-staging.mjs:89-90` 原话 *"the listening auditors exist but have never run in [merge] pipeline … intentionally not enabled yet"*。

---

## 2. P0 即时问题

### 2.1 阅读/听力/口语合库停摆（进行中的活事故）

| 证据 | 数值 |
|---|---|
| `data/reading/bank/*.json` 最后更新 | 2026-06-30 04:14（`cd4034f`，人工补跑的盲审+合库） |
| `data/listening/bank/*.json`、`data/speaking/bank/repeat.json` 最后更新 | 2026-06-29（内容），6-29 20:15 配音回填 |
| staging 堆积（06-30 后生成未合库，按文件名日期切片并经 id 反查 live 库 0 命中验证） | **388 条**：ap 45 / ctw 54 / rdl-long 22 / rdl-short 42 / la 45 / lat 36 / lc 45 / lcr 72 / repeat 27（阅读 39 文件、听力 32、口语 8，每天在涨） |
| BS/Disc/Email | 正常，最后合库 2026-07-06 |
| 每日摘要邮件 | `data/.last-nightly-summary.md` 停更于 6-30 → `send-nightly-email.yml`（按该文件 push 触发）**一周没发过邮件** |
| 监控 | `data/.quality-monitor-report.md` 2026-07-06 仍为「✅ 一切正常 … 无需操作」 |

为什么监控瞎了（`scripts/quality-monitor.mjs`）：
1. STALE 判定只看 `data/.routine-meta.json` 的 `completed_at`——R1 只要跑完（哪怕只合了 3 个写作库）就算「完成」；
2. 其余检查全部是 BS 单库指标（person-prefilled/干扰词/多样性趋势）；
3. **没有任何一行代码检查「9 个 bank 文件多久没变了」或「staging 是否堆积」**；
4. `data/.quality-history.jsonl` 里 07-01、07-06 两行全字段 `null`（scoreBatch 失败），但 null 走 `INFO:` 前缀被 `hardReasons` 过滤（`quality-monitor.mjs:216`），不算回归、不发告警。
5. `routine-meta` 的 `accepted` 字段语义误导：只代表「生成校验通过」，不代表「已进入 live 库」。

### 2.2 六库大规模重复入库（存量未清 + 复发机制仍在）

**存量**（按内容词集合哈希去重，可复现口径）：

| 库 | 名义条数 | 唯一内容 | 重复条目 | 重复率 |
|---|---|---|---|---|
| CTW | 558 | 343 | 215 | 38.5% |
| AP | 318 | 167 | 151 | **47.5%** |
| RDL-short | 385 | 217 | 168 | 43.6% |
| RDL-long | 210 | 132 | 78 | 37.1% |
| LCR | 612 | 294 | 318 | **52.0%** |
| LC | 429 | 175 | 254 | **59.2%**（同一会话最多 4 份） |
| LA | 314 | 154 | 160 | 51.0% |
| LAT | 257 | 129 | 128 | 49.8% |
| （对照）Disc / Email / BS / repeat | 189 / 192 / 614 / 96 | — | 0 / 0 / 4 / 3 | ≈0 ✅ |

逐字比对确认：重复条目的 passage、题目、选项、答案**一字不差**，仅 id 不同（例 `ap_mpveuehi_0` ≡ `ap_mq45tobz_23` ≡ `ap_mq45u24u_23`）。

**时间线**（run id 是 `Date.now().toString(36)`，可解码）：内容 6-01/6-02 首次生成入库 → **6-07 19:13:18 与 19:13:36 两次合并（相隔 18 秒）**各复制一份 → 6-08 19:31 再复制一份（LC 出现第 4 份）。CTW 的重复是同签名的另一事件（两 run id 相隔 18 秒）。

**复发机制至今存在（两条）**：
1. `scripts/merge-staging.mjs:307-325` 只按 **id** 去重；无 id 的 staging 条目在合库时现场铸造新 id（`:319`）→ 同一份 staging 内容被合两次 = 必然产生不同 id 的重复。**没有任何内容级去重。**
2. **staging 从不清理**：已合入的 staging 文件原地留存（bank↔staging 同 id 双份留痕：ap 66 / ctw 187 / rdl-long 80 / rdl-short 106 / la 34 / lat 29 / lc 48 / lcr 62 / repeat 85 条），`reading/staging/.done/` 归档目录只被用过 2 次——绝大多数 staging 文件自 6-26 快照后从未被移动。堆积的旧文件与新文件混在同一目录，盲审 routine 恢复后一旦全目录重放，事故立即重演。

**连带损失**：
- **860 条重复听力条目（318 LCR + 254 LC + 160 LA + 128 LAT）每条都有独立 `audio_url`**——TTS 配音（本项目唯一按量付费成本）被白烧了一份，Supabase 存储同样翻倍；
- 前端选题是纯 `Math.random()`（`app/listening/page.js:22`、`app/speaking/page.js:23`），无已见记录 → 重复条目直接放大「怎么又是这题」的体感；LC 用户抽两次有约 59% 的库内概率抽到有分身的内容；
- 题库规模指标（对外宣传/内部决策用）虚高近一倍。

**为什么没被发现**：`lib/quality/scoreBatch.mjs` 的 diversity 只测「开头词分散度」这类批内指标，不做跨 run 内容哈希比对；监控只看 BS；盲审 routine 只审答案一致性不查重。三层全部漏。

### 2.3 admin「部署到正式题库」零校验旁路

`app/api/admin/staging/[runId]/deploy/route.js`（被 `admin-generate` / `admin-generate-bs` / `admin-staging` 三个页面共用）：不 import 任何 validator / auditor / gate，直接重新编号写回 live 库。同一批 BS 题走夜间自动管线会被难度冻结门拒绝，走这个按钮则无条件入库（「同题不同判」）。BS 页面的「规则复查」是纯展示、与部署按钮无联动；Disc/Email 页面连这个可选复查都没有。授权是单一共享 token，无操作留痕。

### 2.4 立即可修的小问题

- **email 库 4 条 `[recipient]` 占位符泄漏**（em224–227）：`direction` 字段显示「Write an email to [recipient].」而收件人实名在 `to` 字段里——用户可见的半成品。
- `data/buildSentence/answer_hashes.json` 跨批次去重台账停更于 5-14（590 hash vs 现库 614 题），BACKLOG 已知未修。

---

## 3. 拟真度评估

### 3.1 达标面：文本层拟真已经很好

与 `data/realExam2026/` 真题锚逐维对比（bank vs 真题）：

| 维度 | bank | 真题锚 | 判定 |
|---|---|---|---|
| LAT 讲座词数 | mean 251 | 258 (n=113) | ✅ |
| LA 公告词数 | mean 103 | 98 (n=78) | ✅ |
| AP 文章词数 | mean 190 | 181 (n=64) | ✅ |
| LC 对话词数 | mean 105 | ~90 (n=155，回忆稿偏短) | ✅ 可接受 |
| LCR speaker 词数 / 疑问句率 | 8.4 / 72.4% | 7.9 / 73.6% (n=178) | ✅ |
| BS 句长 | mean 8.7 | 9.3 (n=355) | ✅ 略短 |
| repeat 句长 | mean 9.8 | 9.6 (n=351) | ✅ |
| 与真题文本 Jaccard≥0.6（照抄检测） | 全库 0 条 | — | ✅ 无泄题/照抄 |

### 3.2 锚点结构性缺口：题目层大面积无真题锚

真题锚覆盖矩阵（`data/realExam2026/`）：

| 题型 | 文本层锚 | 题目/选项层锚 | 备注 |
|---|---|---|---|
| AP | ✅ 64 篇 | 部分（回忆均 3.2 题/篇，bank 出 5 题/篇——差异是「回忆不全」还是「设计超发」未定案） | |
| CTW | ✅ 75 篇 | ✅（挖空机械可逆推） | 唯一接了 gate-registry 的题型 |
| RDL short/long | **❌ 零真题锚** | ❌ | 位置分配自称「校准自 152 道真题」但 realExam2026 无 RDL 语料，锚源不可考 |
| LCR | ✅ 178 句 speaker | **❌ 真题只有题干句，无选项** | 选项/答案设计锚在第三方样题 profile 上 |
| LC / LA | ✅ 155 / 78 篇 | **❌ 回忆稿平均每篇仅 0.2 题** | 同上，题目层靠第三方样题 |
| LAT | ✅ 113 篇 | ❌ 同上 | |
| BS | ✅ 363 题(504 targets) | ⚠️ 干扰词维度锚源矛盾（见 3.3） | |
| Discussion / Email | ✅ 50 / 51 | ✅ | **另有 44 条真实回忆 Discussion 题（`data/academicWriting/recalled_supplement.json`，tier=recalled）从未合入生产库**——白拿的真题级内容在仓库里闲置 |
| repeat | ✅ 351 句 + 13 组音频转写 | ✅ | |
| interview | ✅ 14 组 | **但没进任何校准文档/门禁/监控** | |

另注：真题锚 13 个文件全部来自同一批采集（2026-01~05 的 52 套回忆卷，一次性入库后未再增补）；部分 eval-profile 的 `ground_truth` 字段指向 `.codex-tmp/ocr/*.txt`（已被 .gitignore），**推导依据无法从仓库复现**。

含义：**「拟真度」目前只在文本层可证；听力全线与 RDL 的「题目怎么出、选项怎么设」这一半，锚定的是第三方备考站样题而非真题**。这是最大的一类「不知道自己不知道」——看板上的「校准过」并不覆盖题目层。

### 3.3 BS 干扰词：整库建立在有争议的锚上（最大单一拟真杠杆）

- `docs/eval-spec/bs.md` 渲染 6 场真题 14 题：**0 个干扰词块**，并直言 *"These three numbers (0%, 82%, 10%) cannot all be right"*、称此为 *"the single largest structural gap / the strongest single lever on authenticity"*；
- 驱动生成的 `lib/questionBank/etsProfile.js` 用的是**旧 TPO 语料**（自称 "derived from 6 TPO real exam sets"）的 `distractorRatio 0.88`——**不是** `data/realExam2026/`，违反「真题唯一锚点」约定（CLAUDE.md:145）；
- 现库实测：**96.6%（593/614）带干扰词**。「did 塌陷」已修好（top 干扰词 did×95=15.5%，114 种，对比历史 did×160/253 种），但**存在率这个更根本的维度被主动降级为 monitor**（`bs-difficulty-standard.json` `distractor_presence: gate:false`），无人拦截；
- 复测工具已备好未跑：`scripts/ops/measure-bs-distractor-bysource.mjs` + 再渲染 20 屏回忆卷。

### 3.4 LCR 范式漂移与题干形态偏移

| answer_paradigm | 真题目标 | bank 实际 (n=612) | 偏差 |
|---|---|---|---|
| context_shift | 31% | 16.0% | **-15pp（最难最有味道的范式欠产）** |
| idiomatic | 25% | 21.6% | -3pp |
| counter_question | 19% | 18.6% | ✅ |
| marker_led_indirect | 19% | **35.9%** | **+17pp（模型偏爱产「Actually,/Well,…」句式）** |
| direct_topical | 6% | 7.7% | ✅ |

另：speaker wh-开头率 45.3% vs 真题 35.4%（偏多）。注意范式标签是**生成时自标注**，无外部检验器复核标签本身的正确性。

### 3.5 应试可利用信号（拟真度 × 测量效度双输）

| 库 | 答案位分布 | 最大偏离均匀 | 正确项为四项中最长的比率 |
|---|---|---|---|
| RDL-long | B=39.2%，D=13.0% | **14.2pp** | 30.3% ✅ |
| LA | A=36.3%，D=13.5% | **11.5pp** | **55.3%** ⚠️ |
| LC | A=33.0%，D=15.6% | 9.4pp | **48.7%** ⚠️ |
| LCR | A=32.8% | 7.8pp | 38.7% |
| LAT | A=30.3% | 5.3pp | **58.9%** ⚠️ |
| RDL-short | A=30.9% | 5.9pp | 30.1% ✅ |
| AP | 均匀 | 3.7pp ✅ | 40.4% |

（真题画像的「正确项最长」参照约 34%。）「永远选最长」在 LAT 上命中率近 59%——这既是机器味，也直接破坏练习的测量效度。听力四型的位置是 `i % 4` 轮询设计（`laPromptBuilder.js:365` 等），偏斜说明 prompt 指令没被遵守且**没有批级校验兜底**；RDL 的「校准自 152 真题」分布需核实是有意为之还是失控。

### 3.6 解析层不一致

- **解析语言不统一**：AP/RDL 英文解析，LA/LAT 中文解析（同为听力，LCR 又是英文）——需要一次产品决策统一；
- **LAT 解析把内部干扰项分类标签直接泄漏给用户**（「b项（too_narrow）…d项（surface_word_trap）」）——内部工程词汇出现在学习者界面，是机器味的直接来源。

---

## 4. 多样性评估

### 4.1 有效规模 = 名义规模 × (1 - 重复率)

见 2.2 表。补充多样性专项实测：
- **LCR speaker 完全重复 322 条**（612 条中仅 290 个唯一 speaker 句；主要由重复入库贡献，但也有同 speaker 不同选项的真重复组）；正确答案文本也在跨题复用（"What time works best for you?"×4 等）；
- **LC situation 集中**：121 种情境里 top1「two students arranging to study together before an exam」×16；
- AP topic 30 种/subtopic 134 种、LAT 学科 17 桶/topic 82 种、CTW 学科 21 种——去重后分散度尚可；
- Discussion 14 课程完美均衡（round-robin 生效）；Email 12 主题类目、scenario 近重复仅 3 对；
- repeat 26 场景池、96 条 items 句子级重复仅 3 句 ✅；
- **interview 全库仅 11 题**——多样性无从谈起，且（见 5.1）全体系缺席。

### 4.2 去重机制缺口（按题型）

| 题型 | 生成时去重 | 缺口 |
|---|---|---|
| RDL | **完全没有**：`buildRDLPrompt/buildShortRDLPrompt` 函数签名无 exclude 参数（`rdlPromptBuilder.js:237,349`） | 阅读三型中唯一裸奔 |
| Discussion | 仅 prompt 软提示（把已用主题塞进 prompt），代码不拒绝 | 依赖模型自觉 |
| Email | 精确字符串匹配拒绝（比 Disc 强），无模糊 | 换个词就能绕过 |
| BS 主链路 | 精确 hash；**模糊 Jaccard 0.75 去重只在后备脚本里** | 主链路无近重复防御 |
| CTW | 正则启发式提取首句主语作 exclude | 脆弱但有 |
| 听力四型 / repeat / AP | ✅ excludeXxx 硬排除 | — |
| **合库层（所有题型）** | **仅按 id** | 内容级去重缺失（2.2 复发根因） |

### 4.3 难度与 schema 漂移

- 难度失衡：RDL-short easy 85%、CTW medium 86%、LA hard 仅 18%——且**没有任何真题难度锚**约束这些分布（难度是生成后估算或自标注的自由参数）；
- **难度字段整段缺失**：BS 420/614（68%）缺 `difficulty`，且 100% 集中在 `ets_` 老前缀批次（新 `cg_` 批次 100% 有）；**speaking 两库从未有过 difficulty 字段（repeat 0/96、interview 0/11）**——若模考/自适应选题依赖难度，这两库是空转的；
- schema 漂移：BS 420 题缺 `prompt_task_kind`；BS 21 题无干扰词（与 3.3 的 0% 之争纠缠）；email `topic` 值中英文混用（「校园学业」与 "academic" 并存）；RDL genre `ad`/`advertisement` 混用；LCR context 值碎片（campus_facility×2、campus_dining×1）；AP 的 word_count/paragraph_count 等字段只回填了 44/318；RDL 存在 `_audit`/`passage_type`/`subtype` 等多轮脚本留下的碎片字段；LCR 有 1 条 item 混入游离顶层键 `"B"`（生成脚本拼接 bug 遗留）；
- **遗留死数据**：`data/buildSentence/{easy,medium,hard}.json`（32 条、旧 schema、与主库 0 交集，运行时零引用）；`data/reading/bank/rdl.json`（8 条 legacy，页面已注释弃用但 `lib/admin/contentRegistry.js:132` 仍注册）；`data/newBank/` 平行库目录（含时间戳备份子目录，疑为废弃迁移产物）——建议统一归档清理。

---

## 5. 质量稳定性评估

### 5.1 门禁真实覆盖：宣称 vs 现实

**真正有硬门禁的只有 BS 一个题型**（`bs-difficulty-scorer.mjs --gate`，`BS_GATE_ENFORCE` 默认强制，FAIL 时 `mergeClaude.mjs` 整库拒合，机制真实有效）。其余：

| 层 | 覆盖 | 缺席 |
|---|---|---|
| `lib/gate/` gate-registry（新一代冻结门） | **仅 CTW**（6 维：4 hard + 2 monitor，从真题 derive） | 其余 11 型零记录；且 `scripts/cli/enforce-gates.mjs` 自述 **"REPORT-only, NOT wired into any production merge path"** → 对生产**零阻断力** |
| AI 二审（主链路实际执行） | 阅读 ap/rdl/ctw 在 merge-staging fail-closed；6-21 起改由盲审 routine 统一做（现已停摆） | **听力四型 auditor 从未在主链路跑过**（`merge-staging.mjs:89-90` 自述）；Disc/Email/repeat/interview 无 auditor |
| scoreBatch 通用监控（0-100 分） | 11 个 bank | **interview 唯一全缺席** |
| eval-profile / eval-spec | 7 型有 | **RDL、interview 双缺**（RDL 反而拥有最多的 3 个深挖分析文件，研究做了、没沉淀成标准） |
| interview 合库 | — | `merge-staging.mjs` `VALIDATORS` 映射无 interview 键 → **staging 里塞 interview 文件会「pass through」免检合库**（代码注释自认） |

**文档失实**：CLAUDE.md:131「lib/gate 冻结防退化门 (BS_GATE_ENFORCE 默认=1, FAIL 即拒合)」把两套独立系统混为一谈——`BS_GATE_ENFORCE` 属于 `scripts/bs-difficulty-scorer.mjs`（老门，活的），`lib/gate/`（新门）只覆盖 CTW 且未接线。多个 bs-* skill 文档复制了同样的错误措辞。

### 5.2 A/B 双路径的机制覆盖差（体系性根因）

主链路（Claude routine）vs 后备（DeepSeek 脚本）关键机制对照：

| 机制 | 主链路 A | 后备 B |
|---|---|---|
| BS AI review/consistency 二审 | ❌（mergeClaude 零 AI 调用） | ✅ 跨模型（DeepSeek 生成 + Sonnet 审） |
| BS 熔断 circuitBreaker | ❌ | ✅ |
| BS prefilled 位置代码级重分配 (53/31/16%) | ❌（仅 prompt 文字） | ✅ |
| BS Jaccard 模糊去重 | ❌ | ✅ |
| 听力 AI auditor | ❌（有意未接线） | ✅ |
| 阅读 AI auditor | ✅（merge 时机） | ✅（生成+merge 双审） |

`lib/bsGen/promptBuilders.js`（57KB，含场景/人设池与三个审核 prompt）实质上只服务于基本不跑的 B 路径——**两份平行实现只有一份在生产，改校准参数改错文件不会有任何报警**。另有死代码：`generateBSQuestions.mjs:29` 的 `hardFailReasons` 导入从未使用；`lcr-deep-analysis.json`(v1)/`lcr-ets-profile.json` 无任何代码引用。

### 5.3 事后门不可逆 + 校准资产腐化

- **Disc/Email 的 diversity/quality gate 在合库之后才跑**（`check-quality-gates.mjs` 只决定 R2 是否补生成），低分批次已入库、无撤回机制；
- `data/eval-profiles/` 11 个文件里 **9 个 `generated_at` 为 null**，全部是「一次性研究快照」：记录的库规模与现实全对不上（CTW 191→实际 558、AP 156→318、Disc 144→189、Email 139→192、BS 860→614）；
- `lib/quality/scoreBatch.mjs` 的阈值是**硬编码字面量**（注释 "RECALIBRATED 2026-05-31"），与 `realExam2026`/eval-profiles 无代码关联——真题更新它不会跟；
- `data/*/profile/` 全部 flavor-model/deep-analysis JSON **不被运行时读取**，生效数值是手抄进 `.js` 的常量，两边无一致性保障；
- CTW 冻结值口径瑕疵：registry 冻结的 `passage_word_count=69.32` 是 spec 自己承认的 OCR 欠计数值（真值 ~71.8）；`first_sentence_*` 用未去重语料（75 条含 ~20 重复）derive，与 spec 的 55 条去重口径存在未文档化分歧（目前都在容差内）。

### 5.4 监控与可观测性

- 唯一自动 cron 是 `nightly-quality-monitor.yml`；其检测范围 = routine 时间戳 + BS 指标（2.1 已述五个盲点）；
- 摘要邮件依赖「精确文件 push」触发，上游一断即静默断流，无自检；
- backfill-TTS 只验「是否传到了 Supabase」，**无时长/静音/内容校验**；单条失败被吞掉不告警，靠下次 push 撞运气重试；
- `merge-staging.mjs::vet()` 把 validator 自身抛异常当「内容差」静默丢弃条目，无法区分「题不行」和「校验器炸了」；
- 仓库是浅克隆 + 两个 squash 边界（`f3d3d99`/`e3ab958`），6-21 之前的入库审计线索已不可考——历史可审计性本身也是一种质量资产。

---

## 6. 盲区清单（「你不知道你不知道的」）

1. **合库停摆事故**：9 库 7–8 天无新题、邮件断流，监控报正常（2.1）。
2. **重复入库存量与复发机制**：37–59% 重复、860 份重复音频、merge 层至今无内容去重（2.2）。
3. **已上线听力题的绝大多数从未经过任何 AI 二审**：auditor 有意未接线（6-21 前入库的主体批次），盲审 routine 只覆盖 6-21~6-30 窗口。
4. **「题目层拟真」大面积无锚**：听力/RDL 的选项与出题方式锚在第三方样题，不是真题（3.2）——看板上的「已校准」不含这一半。
5. **interview 五处全缺席** + staging 免检直通合库的暗门（5.1）。
6. **admin deploy 零校验旁路**，与自动管线「同题不同判」（2.3）。
7. **BS 干扰词 0%/82%/10% 三方矛盾**：当前 96.6% 的干扰词存在率可能整体偏离真题形态，且该维度被主动降为 monitor、锚源违反唯一锚原则（3.3）。
8. **监控的「正常」不可信**：null 指标→INFO→不告警；`accepted` ≠ 已入库（2.1）。
9. **两套平行生成实现只有一份在生产**：校准参数改错文件无报警（5.2）。
10. **校准资产与运行时无绑定**：profile JSON 是装饰品，真实常量手抄在代码里；eval-profiles 全过期（5.3）。
11. **触发器台账与文档双重漂移**：CLAUDE.md 记载的 trigger id 已过期；实际台账只剩 R1 一个 trigger（07-03 新建），盲审 routine 的 trigger 消失即本次停摆的直接根因，R2 在台账外运行来源不明——**产线的「开关」本身没有任何清单化管理与监控**。
12. **44 条真实回忆 Discussion 题（recalled_supplement.json）静静躺在仓库里从未入库**——补多样性最便宜的一手真材料被遗忘。

---

## 7. 改进路线图

### P0（本周，先止血）
1. **恢复合库**：重建「盲审 routine」trigger（07-03 台账重建时丢失；或将盲审并回 R1 末尾以消灭单点）；把三个 routine（R1/R2/盲审）的 trigger id、职责、依赖顺序写成台账进 `docs/quality-pipeline.md` 并更新 CLAUDE.md 过期 id；补跑 06-30 后堆积的 388 条 staging（先盲审后合库）；恢复摘要邮件。
2. **清重**：一次性内容哈希去重脚本清 6 库（保留最老 id，迁移/删除重复音频文件）；`merge-staging.mjs` 加内容指纹去重（对 staging 条目和 bank 现存内容双向查）+ 回归测试；顺带把 `answer_hashes.json` 重建纳入。
3. **监控加固**（quality-monitor 增 4 条检查）：各 bank 文件 >48h 未更新告警；staging 积压条数告警；跨 run 内容重复率纳入 diversity 分；null 指标 = 告警而非 INFO。
4. **封旁路**：admin deploy 接入各型 validator + BS 难度门（至少做到与夜间管线同判）；`merge-staging.mjs` 对无 validator 映射的题型（interview）由 pass-through 改为拒绝。
5. **修 email em224–227 占位符**（一分钟级）。

### P1（两周内，把「设计」接上「产线」）
6. **BS 干扰词定案**：跑 `measure-bs-distractor-bysource.mjs` + 加渲染 20 屏回忆卷，三选一定锚；定案前先把新生成的干扰词存在率往中间值收。
7. **批级形态校验**：validator 层加「正确项最长率 ≤40%」「答案位偏离 ≤10pp/批」硬检查（听力四型+RDL）；对存量做一次答案位再平衡（打乱选项顺序即可，不必重生成）。
8. **去重补齐**：RDL prompt builder 加 excludeSubjects；Discussion 由软提示改为代码级拒绝；BS 主链路补 Jaccard 模糊去重。
9. **听力 auditor 接线**：统一 auditor 接口接入 merge-staging（或正式确认盲审 routine 为唯一二审并为它建监控）；对 6-21 前入库的存量听力题跑一次离线盲审，剔除答案不一致项。
10. **LCR 范式配比**：prompt 按目标分布预分配 paradigm（如答案位那样），validator 批检 context_shift 占比。
11. **interview 决策**：要么纳入自动化（routine 清单 + scoreBatch BANKS + merge validator 映射 + eval-spec），要么明确为人工题型并在文档标注。
12. **白捡的真题**：把 `recalled_supplement.json` 44 条回忆 Discussion 题查重后合入 `prompts.json`（近零成本，直接提升拟真与多样性）。
13. **staging 消费规范**：合库后把已消费文件移入 `.done/`（机制已有、没人用），并给 staging 目录设「滞留 >7 天告警」。

### P2（一个月，体系升级）
14. **gate-registry 推广**（BACKLOG 已列）：按「听力选项形态（最长率/位置）→ RDL → Disc/Email 字数语域」顺序逐型接入，`enforce-gates.mjs` 接进 merge 流程，替换 CLAUDE.md 失实描述。
15. **校准资产活化**：eval-profiles 由 routine 每晚重算 generated 侧并填 `generated_at`；scoreBatch 阈值改为从 profile 文件读取；写一个「profile JSON vs 代码常量」一致性 diff 脚本进 CI。
16. **锚点扩充**：采集 RDL 真题样例（当前零锚）；持续收集带题目的听力回忆卷补题目层锚；AP 每篇题数 5 vs 3.2 定案。
17. **解析统一**：解析语言（中/英）一次性拍板；LAT 解析剥离内部标签（渲染层过滤或 prompt 禁用）。
18. **数据卫生**：TTS 内容级抽检（时长/静音阈值）+ 失败告警；难度字段补齐决策（BS ets_ 批次回填、speaking 两库是否引入）；legacy 死文件归档（easy/medium/hard.json、rdl.json + contentRegistry 解注册、newBank/）。

---

## 附录 A：本次审查的统计口径

- 重复度：小写化去标点后取内容词集合（len>2，去停用词），集合完全一致视为重复（另以 Jaccard≥0.5 做近重复扫描）；已抽样逐字验证。
- 答案位/最长项：MCQ 题目级统计（AP n=1590、LAT n=1028、LC n=858、RDL-long n=633、RDL-short n=770、LA n=628、LCR n=612）。
- 真题对比：`data/realExam2026/` 各文件 items 直接计算，tier 均为 recalled。

## 附录 B：关键证据文件索引

- 停摆：`data/.routine-meta.json`、`data/.last-nightly-summary.md`、`data/.quality-monitor-report.md`、`data/.quality-history.jsonl`、`git log --grep="bot(audit)"`
- 合库：`scripts/mergeClaude.mjs`、`scripts/merge-staging.mjs`（:34,:89-90,:307-325）、`scripts/appendBSSets.mjs`、`scripts/routine-audit.mjs`、`scripts/routine-prompts/r2-retry.md`
- 门禁：`lib/gate/gate-registry.js`（REGISTRY 仅 ctw）、`scripts/cli/enforce-gates.mjs`（REPORT-only 自述）、`scripts/bs-difficulty-scorer.mjs`、`data/eval-profiles/bs-difficulty-standard.json`
- 生成器：`lib/readingGen/rdlPromptBuilder.js:237,349`（无 exclude）、`lib/listeningGen/*Auditor.js`（未接线）、`lib/bsGen/promptBuilders.js` vs `lib/bsGen/prompts.mjs`（双实现）
- 旁路：`app/api/admin/staging/[runId]/deploy/route.js`
- 干扰词矛盾：`docs/eval-spec/bs.md:20,122-126,191`、`lib/questionBank/etsProfile.js:7,24-35`
- 监控：`scripts/quality-monitor.mjs`（:61-106,:216）、`.github/workflows/nightly-quality-monitor.yml`、`scripts/backfill-tts.mjs`
