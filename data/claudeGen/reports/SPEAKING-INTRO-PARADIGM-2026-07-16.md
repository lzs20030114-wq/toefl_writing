# Speaking 引入语范式（跟读 + 采访 + 任务级旁白）

生成时间：2026-07-16
数据源：
- `data/realExam2026/speaking/repeat-from-audio.json`（13 套跟读，`source_kind=audio-asr`，含 `setting` 场景句）
- `data/realExam2026/speaking/interview.json`（14 套采访，含 `setting` 场景句 + 完整 `transcript`）
- `.codex-tmp/asr/*Speaking*.txt`（13 份逐字 ASR 转写，含任务级旁白 + 指代句 + 物流句 + 考官开场白/过渡语）

本文件是 App 内「口语引入屏」与「模考任务级旁白屏」的范式依据，也是出题管线下期校准的 backlog。
**一切照真题逐字归纳，不许自由发挥。**

---

## 1. 跟读（Listen & Repeat）引入语

### 结构（3 拍，13 套 100% 一致）
```
场景句（现在进行时 / 现在完成时被动）
指令句（Listen to <角色> and repeat what <指代> says.）
Repeat only once.   ← 零变体收尾
```

### 场景句真题样本（逐字）
- "You're being trained to show students how to use the campus library's printing services."
- "You are learning to guide new students on how to use tools in a woodworking class."
- "You're learning to assist visitors at a university open house."
- "You are being trained to help new students register for classes."
- "You are working a part-time job at a grocery store near campus. You are being trained to assist customers."
- "You are working at a university. Your manager is teaching you how to assist people at a university sporting event."
- "You are learning how to give the weather report for the University radio station."

场景句两种起手：`You are being trained to …` / `You are learning to …`（约 1:1）；点名 manager 时用
`You are working at … Your manager is training/teaching you …`。

### 指代强规则（★核心，不可违反）
指令句里「听谁 / 复述谁」的指代，由场景句是否点名角色决定：

| 场景点名 | 指令句指代 | 观测频次（ASR） |
|---|---|---|
| **manager** | 名词重复：`Listen to the manager and repeat what the manager says.`（**绝不用代词**） | 5 |
| 未点名（trainer 版） | `Listen to your trainer and repeat what he/she says.` | 3（he 1 / she 2） |
| 未点名（speaker 版） | `Listen to the speaker and repeat what he/she says.` | 3（he 1 / she 2） |

- 未点名时 trainer 版 vs speaker 版 ≈ **1:1**；he vs she ≈ **1:1**。
- 收尾恒为 `Repeat only once.`（无任何变体）。

### 本仓实现
`lib/speakingGen/introTemplates.js` → `buildRepeatIntro({ id, scenario, speaker_role })`：
- `speaker_role` 含 "manager"（大小写不敏感、子串匹配，覆盖 bank 里的 "dining services manager" / "station manager"）→ manager 模板，名词重复。
- 否则按 **set id 确定性哈希**在 trainer/speaker 两版、he/she 两代词间分流（同一套题永远同一版，跨进程稳定）。
- `place` 由 scenario 标签转小写自然语序（`normalizePlace`：`IT Help Desk → IT help desk`；保留 IT/TV/ID/AI 等缩写；剥离 `(how-to)` 尾巴）。
- `scenario`/`speaker_role` 缺失（个人题库）→ 兜底
  `"You are being trained to assist visitors. Listen to your trainer and repeat what he says. Repeat only once."`

---

## 2. 采访（Take an Interview）引入语

### 结构（2 拍）
```
场景句（现在完成时，= bank 的 intro 字段，11/11 现成）
物流句（固定主模板）
（考官开场白已在 bank Q1 文本里，不在引入屏重复）
```

### 场景句真题样本（= bank `intro`，现在完成时）
- "You have agreed to participate in a survey about artificial intelligence in daily life."
- "You have agreed to participate in a research project about study habits and productivity."
- "You have agreed to participate in a study about news consumption and media literacy."

### 物流句变体权重（ASR 观测）
| 物流句 | 权重 |
|---|---|
| **"You will have a short online interview with a researcher. The researcher will ask you some questions."** | **主模板 ≈ 57%** |
| "You have scheduled a short online interview with a researcher to answer a few questions." | 次要 |
| "You will meet online with a researcher who will ask you some questions." | 少数 |

### 考官开场白变体（已内嵌在 bank Q1，引入屏不重复；此处仅存档供出题管线校准）
`Thank you for agreeing to participate` 家族 ≈ **64%**，共 **5+1** 变体：
- "Thank you for agreeing to participate." （+ 常接 "I'd like to ask you some questions about <topic>."）
- "Thank you for your willingness to participate today."
- "Thank you for signing up for the study."
- "Thank you for joining the study."
- "Thank you for being part of the study."
- （+1）"Thank you for participating in our survey."（bank 现用款）

### 题间过渡语池（考官在两问之间的短反馈，ASR 观测）
`"Thank you."` / `"Interesting."` / `"Great, …"` / `"Give details to explain your answer."`

### 本仓实现
`lib/speakingGen/introTemplates.js` → `buildInterviewIntro({ intro })`：intro（bank 场景句）+ 固定物流句主模板。
intro 缺失（个人题库）→ 兜底场景句 `"You have agreed to participate in a short research interview."` + 物流句。

---

## 3. 模考任务级旁白（逐字，14/14 一致）

引入屏之前，模考壳（`components/mockExam/SpeakingExamShell.js`）在每个任务前插入任务级旁白屏
（`NarrationCard`，浏览器 TTS 朗读 + 文本显示 + 继续按钮，不计入答题计时）。常量在 `introTemplates.js`：

**口语部分开头（Task 1 前）— `SPEAKING_SECTION_NARRATION`：**
> Speaking section. In the speaking section, you will answer 11 questions to demonstrate how well you can speak English. There are two types of tasks. Listen and repeat. You will listen as someone speaks to you. Listen carefully and then repeat what you have heard. In an actual test, the clock will indicate how much time you have to speak. No time for preparation will be provided.

**采访任务前（Task 2 前）— `INTERVIEW_TASK_NARRATION`：**
> Take an interview. An interviewer will ask you questions. Answer the questions and be sure to say as much as you can in the time allowed. No time for preparation will be provided.

真考完整旁白顺序（ASR 01 卷逐字）：任务级 L&R 旁白 → 该套场景句 + 指代句 + `Repeat only once.` → 7 句 →
任务级采访旁白 → 该套场景句 + 物流句 → 考官开场白（含在 Q1）+ 4 问（问间夹过渡语）。
本仓把「任务级旁白」放在模考壳，「场景句 + 指代/物流句」放在各任务的引入屏，两段分离但顺序一致。

---

## 4. 出题管线下期校准项（backlog）

当前实现只做了**运行时引入屏**；出题管线（`lib/speakingGen/`）尚未把这些范式写进题库字段，下期校准：

1. **采访开场白写死一种 → 按真实频率采样**
   `interviewPromptBuilder` 目前让模型固定生成一种开场白（bank 现状 Q1 多为 "Thank you for participating in our survey."）。
   应改为按上文 5+1 变体的真实频率（"agreeing to participate" 家族 ≈64%）采样。

2. **新增结构化字段**（让引入屏读题库而非运行时合成，消除机器味）
   - 跟读 set：`setting_sentence`（真题风格场景句）、`speaker_referent`（manager/trainer/speaker）+ `pronoun`（he/she），
     由出题时确定并落库，替代当前的 id 哈希合成。
   - 采访 set：`logistics_sentence`（按 57/次要 频率采样）、`opener_variant`（开场白变体标签）。

3. **题间过渡语池**
   采访 set 落库 `transition_phrases`（`"Thank you." / "Interesting." / "Great, …"`），供模考在问间播放，逼近真考节奏。

4. **场景句-指代一致性校验器**
   在 `speakingValidator` 增加断言：场景点名 manager 的 set，指令句必须名词重复、禁止 he/she；未点名 set 的 trainer/speaker
   与 he/she 分布不塌成单一值（对齐 BS 干扰项防塌方的思路）。

---

## 5. 实现文件索引

| 文件 | 职责 |
|---|---|
| `lib/speakingGen/introTemplates.js` | 引入语纯函数 + 任务级旁白常量（可单测） |
| `components/speaking/SpeakingIntroScreen.js` | 通用引入屏 + `useNarration`（浏览器 TTS 朗读）|
| `components/speaking/RepeatTask.js` | 跟读：引入屏（`started` 门）+ 开始时显式 `examController.unlock()` |
| `components/speaking/InterviewTask.js` | 采访：引入屏 + 答题阶段隐藏题面 + 音频失败链（TTS 朗读→重试/跳过）|
| `components/mockExam/SpeakingExamShell.js` | 模考：`repeatNarration` / `interviewNarration` 两段任务级旁白屏 |
| `__tests__/speaking-intro-templates.test.js` | 纯函数回归锁 |
| `__tests__/speaking-intro-screen.component.test.js` | 引入屏 + 题面隐藏 + 失败链回归锁 |
