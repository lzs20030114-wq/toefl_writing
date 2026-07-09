# L3 决策块 B/D 逐条裁决 — 37 条疑似错键（2026-07-09）

> 范围：L1.5 复审里 lat/la/lcr/rdl-long/ap(非插句) 的「复现 + 多解」共 37 条，逐条读原文判决。
> 结论：**只有 1 条是真错键（已修），其余 36 条答案键正确或可辩护。**

## 头号发现：听力「嫌疑」绝大多数是 DeepSeek 结构化字段噪声，不是错键

读完 21 条 lat 后模式铁一般清晰：**DeepSeek 的自由文本 `reasoning` 描述的正是我们的答案键，
但它填进 `best` 字段的字母却是错的**——而且异常偏向最后一项 D（21 条里 15 条误填 D）。
典型如 lat_r1_...190444_3：AI 理由写「gains from carbon storage can be reversed by disturbances...
**Option D correctly identifies this**」——理由描述的是 B（我们的键），却盖章 D。

这不是我们代码的 bug（latAuditor 不打乱选项、`best` 直连字母），是 DeepSeek 在
predict_next / 末位 inference 题上 `best` 字段不可靠。**方法论修正：听力层的 AI 二审，
`reasoning` 比 `best` 可信；raw match-rate 系统性高报。** L1 的听力 suspect 计数应据此打折看。

## 裁决汇总

| 判决 | 条数 | 处置 |
|---|---|---|
| ✅ 键正确（AI best 字段噪声/字面陷阱） | 33 | 保留，标 audit_keep 免再报 |
| ❌ 真错键 | 1 | **已修** ap_mpzvh9ag_3（C→B） |
| ⚠ 判断题·交你拍板 | 3 | 见下，倾向已给 |

## ❌ 已修（1 条，客观错误非判断题）

**ap_mpzvh9ag_3** Q3 inference「concrete curing」：键 C「reaches full chemical completion within a few hours」被原文
「never fully completes the underlying chemistry」直接打脸。**该题 explanation 字段本身就写着**
「Wait — that is incorrect... the strongest inference is B... 假定答案 C 是 per the plan 保留的」
——即一个自知错误还被合库放行的键。已改 correct_answer C→B 并重写解析。

> 连带线索：全库确定性扫「解释自我否定」措辞，另有 2 条 insert_text（ap_mpzvh9ag_0 / ap_rt_20260608_2）
> 解释是「Hmm—actually... / Wait — the assigned answer is slot 3」的糊涂话，但键未被自我否定（绕一圈仍落在keyed slot）。
> 归到任务 1 的选句插入族一起看——它们的解析质量本身就烂，是生成器问题。

## ⚠ 交你拍板（3 条判断题，我给倾向）

| id | 题 | 键 | 我的倾向 | 理由 |
|---|---|---|---|---|
| **ap_mpx0lfar_2** | Q3 quolls 推断 | D | **偏 B / 或判本题作废** | 键 D「primary predators of cane toads in Daly River」无依据（Daly River 原文指鳄鱼，且没说 quoll 是 primary predator）；但 B「lacked exposure to predators with similar chemical defenses」把有毒的猎物 toad 说成 predator，措辞也瑕疵。**两项都不干净→本题可能作废重出。** |
| **rdl_long_rt_001** | Q3 邮件推断 | C | **偏 D** | 键 C「Jordan 是可靠同事」是软推断；D「还没告诉经理」被「update Ms. Tanaka **if neither of us is available**」直接支撑（若已告知就无需"仅在没人时才通知"）。D 更有文本依据。 |
| **lcr_mpw1ilch_1** | 顾问问「选课了吗」 | A | **偏 D** | 应答者是学生；D「No, I haven't seen the new schedule」是学生对「你选课了吗」的自然直答；键 A「别担心我带你过一遍」是顾问的话（说话人角色），放错口。 |

## 低置信·保留但记录（3 条，不改）

- **lcr_mpw0aj59_4**（诊所几点关门→键 A"下午给你加个号"）：4 个选项没一个给出关门时间，本题干扰项弱；A 是"最像诊所的有用回应"，勉强最优。**弱题，留观。**
- **lcr_mpx0wcrw_4**（担心上高统计→键 A"入门课覆盖你所需"）：A 给实质建议、AI 的 D"很多人一开始都怕"给共情，都算得体应答，A 略优。留。
- **ap_gen_routine-20260528-190440_003** Q1 vocab：interrupt→键 B"stop"，AI"delay"。interrupt≈halt/stop 是 ETS 常见义，键可辩护；delay 也有道理。留，记档。

## 33 条「键正确」明细（AI best 噪声）

全部 lat（21）+ la（2）+ lcr（5：mpw0aj59_2 / mpw1ilch_7 / rt_001 / rt_005 / mrckqvxq_7）：
读原文后我方键均为最佳答案，AI 或误填 best 字段、或选了只答字面的陷阱项（如"Yes, I check my inbox daily"
答"你收到邮件没"）。逐条原文与理由见 `task3-dossier`（scratchpad）与 L1-suspect-details.md。

## 给管线的两条改进建议（非本轮拍板项）

1. **听力/阅读答案二审改判逻辑**：别只信 AI 的 `best` 字段；当 `best` 与 `reasoning` 指向不一致时，
   以 reasoning 复核，能砍掉这批假阳性，让 suspect 清单变短变准。
2. **合库前加"解释↔答案一致性"确定性门**：解释里出现 "incorrect / Wait — / retained per the plan /
   may differ at scoring / actually the best" 等自我否定措辞即拒合。本轮就是靠这个 grep 独立逮到 ap_mpzvh9ag_3，
   比整轮 DeepSeek 二审还快还准。
