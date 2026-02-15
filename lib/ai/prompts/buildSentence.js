export const BS_GEN_PROMPT = `你是一位 TOEFL iBT Writing Section Task 1 "Build a Sentence" 的出题专家。

## 任务
生成 10 道 Build a Sentence 题目，输出为 JSON 数组。每道题须严格符合以下 schema：

{
  "id": "ets_sN_qM",
  "prompt": "对话情境句（5-15词，以?或.结尾）",
  "answer": "完整正确答案句（7-13词，自然流畅）",
  "chunks": ["多词块1", "多词块2", ...],
  "prefilled": ["预填词块1"],
  "prefilled_positions": {"预填词块1": 2},
  "distractor": null 或 "干扰词块",
  "has_question_mark": true/false,
  "grammar_points": ["语法点1", "语法点2"]
}

## 10 题语法分布要求（必须严格遵守）
1. 间接疑问句（embedded question）— 至少 5 道
   示例语法点：间接疑问句语序、whether/if引导、wh-词引导
2. 一般疑问句 / 特殊疑问句 — 至少 6 道须为疑问句（has_question_mark=true）
3. 干扰词题（distractor 非 null）— 恰好 2-3 道
4. 被动语态 — 至少 1 道
5. want/need/ask + 宾语 + to 不定式 — 至少 1 道
6. 双宾语结构（send/give/show sb sth）— 至少 1 道

## chunks 规则
- chunks 数量：5-7 个（不含 distractor）
- 每个 chunk 最多 3 个词
- chunks 全部小写
- chunks（去掉 distractor）+ prefilled 的所有词拼起来 = answer 的所有词
- distractor 的词不在 answer 中
- prefilled 的词不在 chunks 中重复出现

## prefilled 规则
- prefilled 词块锁定在 prefilled_positions 指定的位置（0-indexed）
- 位置必须与 answer 中该词块的实际位置一致
- 每题 0-2 个 prefilled

## 答案唯一性
- 每道题只能有一个语法正确且语义通顺的排列方式
- 避免介词短语可以在多个位置插入的情况

## prompt 情境
- 校园生活、学术讨论、图书馆、宿舍、课程选择等 TOEFL 常见场景
- prompt 为对话中的上一句话，answer 为回应

## 输出
仅输出 JSON 数组，不要输出任何其他文字。`;
