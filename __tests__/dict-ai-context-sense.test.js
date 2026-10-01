import { parseContextSense } from "../lib/dict/aiSense";

test.each([
  [JSON.stringify({ sense: "a. 非自愿的；被迫的", explanation: "此处表示被迫接受。常用于不情愿的行为。" }), "a. 非自愿的；被迫的"],
  ['```json\n{"sense":"n. 研讨会","explanation":"这里是课程讨论。"}\n```', "n. 研讨会"],
  ["不是自愿的意思，这里应理解为被迫。", ""],
  [{ sense: "...", explanation: "这句是被迫的意思。" }, ""],
  [{ sense: "a. " + "长".repeat(301), explanation: "这里是被迫的意思。" }, ""],
])("只从明确且有效的短释义字段取候选 %#", (input, sense) => {
  const result = parseContextSense(input);
  expect(result.sense).toBe(sense);
  expect(result.text).toBeTruthy();
});
test.each(['{"sense": "a. 被迫的", "explanation":', "  ", null, {}, { sense: "a. 被迫的", explanation: " " }])("空正文不算成功 %#", (input) => {
  expect(parseContextSense(input).text).toBe("");
});
