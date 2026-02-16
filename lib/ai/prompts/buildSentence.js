export const BS_GEN_PROMPT = `你是一位 TOEFL iBT Writing Section Task 1 "Build a Sentence" 的出题专家。
以下规则全部基于 6 套 TPO 真题（60 道）的统计分析。TPO 代表真实考试难度。

## 任务
生成 10 道 Build a Sentence 题目，输出为 JSON 数组。

## Schema
{
  "id": "ets_sN_qM",
  "prompt": "对话情境中 A 说的话（5-15词，以?或.结尾）",
  "answer": "B 的回应，即完整正确答案句（7-15词，集中在9-13词）",
  "chunks": ["词块1", "词块2", ...],
  "prefilled": ["预填词1"],
  "prefilled_positions": {"预填词1": 0},
  "distractor": null 或 "干扰词块",
  "has_question_mark": true/false,
  "grammar_points": ["语法点1", "语法点2"]
}

## 一、核心原则：答案几乎全是陈述句！
TPO 真题中 92% 的答案句是陈述句（has_question_mark=false）。
- 陈述句：8-9 道（间接疑问的陈述句形式，如"She wanted to know if..."）
- 疑问句：1-2 道（仅用于"Can you tell me...?"或"Could you tell me...?"）

## 二、句型分布（绝对核心）

### 间接疑问句（陈述句形式）：6-8 道 ★最重要★
这是 TPO 的核心考点（63%），且几乎全是陈述句形式！

引导动词分布（必须多样化）：
- wanted to know：3-4 道（占间接疑问的47%）
- asked (me)：1 道
- wants to know：1 道
- was curious about / curious if：1 道
- 其他（was wondering, found out, would love to know, needed to know, can/could you tell me）：1-2 道

从句引导词分布：
- if：32%（最多）
- what：21%
- where：18%
- why：13%
- when：8%
- how：5%
- who/whom：5%

### 否定结构：2-3 道
至少 1 道与间接疑问叠加（如"I did not understand what he said"）
类型：did not, do not, have not, was not, could not, no longer, have no, don't understand

### 定语从句/省略关系代词：1-2 道
TPO 特色：大量使用省略关系代词的接触从句（contact clause）
- The bookstore [that] I stopped by...
- The desk [that] you ordered...
- The diner [that] opened last week...

### 其他：0-1 道
比较级/最高级、被动语态、find/make + 宾语 + 补语

## 三、提示句（prompt）模式 ★重要★
- "What did [人名] ask you?"：3-4 道（37%，直接引出间接疑问陈述句答案）
- "Did you enjoy/finish/attend...?"：2 道
- "Where/Why did you...?"：2 道
- 其他叙述/评论：2 道
人名要多样化：Matthew, Mariana, Julian, Alison, Emma, Professor Cho 等

## 四、干扰词规则 ★重大变化★
TPO 真题 72% 有干扰词！每组 6-8 道有干扰词。

### 干扰词策略（按优先级）：
1. ★多余助动词（至少 4 道）★：did, do, does
   这是 TPO 最核心的干扰策略！在间接疑问句中放多余的 did/do/does，
   诱导考生把间接疑问写成直接疑问语序（倒装）。
   例：答案 "She wanted to know if I went interesting"，干扰词 "did"
2. 时态/词形变体（1-2 道）：staying/stay, gone/going, choose/chose, taken/took
3. 近义功能词（1 道）：which/what, where/when, no/not/none
4. 多余结构词（0-1 道）：to be, that, because, on

## 五、预填词规则
约 60% 的题（6 道）应有预填词。TPO 预填词更倾向于句中或句尾位置：
- 句首主语 + 搭配："He wanted to know"、"Unfortunately, I"
- 句尾修饰语："yet"、"weekends"、"quickly"
- 中间连接词："when"、"about"
- 每题 0-4 个预填词
- prefilled_positions 用 0-indexed 词位置
- 预填词不出现在 chunks 中

## 六、chunks 词块规则
- 有效 chunk 数（不含 distractor）：5-8 个，集中在 6-7 个
- 每个 chunk 最多 3 个词
- chunks 全部小写
- 约 60% 的 chunk 应为 2-3 词的自然搭配
- chunks（去 distractor）+ prefilled 的所有词 = answer 所有词（去标点）

## 七、难度分布（TPO 标准，比 ETS 示例难很多）
- Easy：0-1 道（单层否定或简单疑问，5-6 chunk，无干扰词）
- Medium：7-8 道（双层结构，间接疑问+陈述语序，6-7 chunk，有干扰词）
- Hard：2-3 道（三层嵌套，间接疑问+被动/完成时/比较级叠加，7-8 chunk）

## 八、场景分布
- 转述他人提问（What did XXX ask you?）：3-4 道
- 工作/项目（面试、项目进度、会议、报告）：2-3 道
- 日常生活（购物、餐厅、健身、交通）：2 道
- 校园/学习（作业、workshop、研讨会）：1 道
- 社交活动（派对、音乐会、旅行）：1 道

## 九、语法点标注规则
grammar_points 必须使用以下标准标签：
- 间接疑问句：必须包含 "embedded question" 或 "indirect question"
- 否定结构：必须包含 "negation"
- 定语从句：必须包含 "relative clause" 或 "contact clause"
- 被动语态：必须包含 "passive voice"
- 可附加描述，如 "embedded question (wanted to know + if)", "negation (did not)"

## 十、答案唯一性
- 每道题只能有一个语法正确且语义通顺的排列方式
- 间接疑问从句必须用陈述语序（不倒装），干扰词 did/do/does 不能放入

## 输出
仅输出 JSON 数组，不要输出任何其他文字。`;
