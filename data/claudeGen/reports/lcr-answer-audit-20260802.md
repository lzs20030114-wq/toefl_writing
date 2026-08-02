# LCR 答案全量审计报告（2026-08-02）

## 起因

用户做题时发现 `lcr_mpvlbko3_4`（"You look completely wiped out today."）标准答案给错：
键答案 A "Want me to grab you a coffee?" 是**说话人一方**（观察到对方疲惫的人）才会说的话，
被关心的应答者不会反过来给对方递咖啡；自然回应是 C "I cleaned the whole kitchen last night."
（解释自己为什么累）。

## 审计方式

对 `data/listening/bank/lcr.json` 全部 413 题做盲审（只给 speaker + 四个选项，
不给键答案与解析），9 个并行 agent 独立判定每题最佳回应并给每个选项打
valid / partially_valid / invalid，随后逐题人工复核所有不一致项。

## 根因

生成 prompt 的 `context_shift` / `counter_question` 范式只要求「解决潜在需求 / 用反问推进对话」，
**没有约束正确答案必须站在应答者（被问话一方）的角色**。当 situation 设定为
「advisor/教练/关心者 问 学生/疲惫者」时，模型经常替提问方写出下一句话
（提供帮助、给建议）并把它设成键答案——即「角色反转」。auditor 提示词同样没有角色检查，
未能拦截。

## 修复清单（16 题，均不动 speaker 句 → 已配音频全部保留有效）

### A. 答案给错（角色反转）→ 改键（5 题）

| id | 旧键 | 新键 | 说明 |
|---|---|---|---|
| lcr_mpvlbko3_4 | A | C | 用户报告的题；A 改为 role_inversion 陷阱 |
| lcr_mpw0aj59_10 | B | C | "Have you decided on a major yet?" 键是顾问台词 |
| lcr_mpw0icjx_11 | A | D | "You seem pretty worn out after practice." 键是教练建议 |
| lcr_mpw1ilch_1 | A | D | "Have you signed up for classes yet?" 键是帮办者台词 |
| lcr_mqiq4y26_1 | B | C | 键仅在「应答者是 TA」设定下成立，做题人无从得知；改同学视角 + 重写 B 为干扰项 |

### B. 键选项本身写反、无正确可选 → 重写键选项文本（4 题）

| id | 键 | 新键选项文本 |
|---|---|---|
| lcr_mpw0icjx_5 | B | "I'm picking up extra shifts to cover it."（原「我可以借你钱」是关心者台词） |
| lcr_mpw14a7w_2 | B | "Honestly, barely four hours a night."（原「我帮你顶班」是关心者台词；同时收紧 C） |
| lcr_mq45ton5_130 | A | "Not yet — I'm torn between two programs."（原「一起看看你的选项」是顾问台词） |
| lcr_mrba2quq_5 | B | "Well, everyone else left early."（原「我来搬几个」是旁观者台词） |

### C. 歧义收紧 / 文本毛病 → 只调干扰项（7 题）

| id | 改动 |
|---|---|
| lcr_mpw14a7w_15 | D 语法修正："meet you home" → "meet you at home" |
| lcr_mpvr2nye_5 | D「独自学习适合我」是同样成立的拒绝 → 改为图书馆联想陷阱 |
| lcr_mpw1ilch_0 | D 去掉开头 "Yes,"（原文同时回答了 yes/no 问句，与键并列成立） |
| lcr_r1_routine-20260531-190444_8 | A「Yes, 截止日期在周五」= 合理的确认拒绝 → 改为 Friday 联想陷阱 |
| lcr_mpx0wcrw_2 | A「诗歌区在三楼」= 馆员的隐含肯定 → 改为 Persian 联想陷阱 |
| lcr_v2_1780213468917_003 | B「教授喜欢宽题」= 合理安慰 → 改为 presentation 联想陷阱 |
| lcr_mrxxvfrw_8 | B/D 原文正是「教授会说的关于论文的内容」，直接回答了提问 → 改为非应答性联想陷阱 |

以上每题的 explanation 与 answer_paradigm / distractor_types 均已同步重写。

### 复核后维持原判（未改）

盲审标记但人工复核认定符合设计意图的：`lcr_mpw0aj59_4`、`lcr_mpw0aj59_14`、
`lcr_mpw14a7w_0`（context_shift/counter_question 本就不直接报时刻，属 ETS 风格）、
`lcr_rt_008`、`lcr_mqh1b5o3_7`、`lcr_mqpnc22w_2`、`lcr_mpvr2nye_8`（键明显优于并列项）。

## 防退化加固

- `lib/listeningGen/lcrPromptBuilder.js`：CORRECT ANSWER RULES 新增 **ROLE CONSISTENCY (CRITICAL)**
  规则——键答案必须是被问话一方说得出的话；说话人侧台词只能做 role_inversion 干扰项。
- `lib/listeningGen/lcrAuditor.js`：AUDIT_PROMPT 新增 ROLE CHECK 判定项（含 wiped out 反例）。

## 验证

- `lcrValidator.validateLCR` 对 16 题全部通过（0 error / 0 warning）
- 全量 jest：128 suites / 1071 tests 全绿
- 所有改动不涉及 speaker 文本，`audio_url` 无需重配音

## Review 追补（同日复查发现）

对本次修复自身做对抗式 review，发现并修正 3 处遗留：

1. **`lcr_mqiq4y26_1` 的 situation 字段没有随键切换**——表格里写了「改同学视角」，但实际只改了
   options/explanation/paradigm，页面展示的 situation 仍是「student checking with TA」，与新键
   C（同学台词「Yes, I graphed mine over the weekend.」）自相矛盾。已改为
   "students comparing lab report requirements with each other"。
2. **两道题的 situation 残留旧键视角**——`lcr_mpvlbko3_4` / `lcr_mrba2quq_5` 的 situation
   「offering help to someone who seems stressed」是为旧的角色反转键写的；尤其前者会把考生
   引向干扰项 A（正好是 offer of help）。均改为 "expressing concern..." 视角。
3. **lcrAuditor 盲审不带 situation**——ROLE CHECK 需要知道谁是应答方，而应答方角色常由
   situation 决定（TA/顾问/同学）。AUDIT_PROMPT 现在附带 Situation 行（缺失时自动省略），
   并在 ROLE CHECK 中说明用它判定 addressee。
