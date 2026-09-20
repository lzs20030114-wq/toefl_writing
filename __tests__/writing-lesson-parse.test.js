// 讲评(lesson)解析层。讲评是评分之后的第二次独立调用，失败必须静默降级 ——
// 所以这里最重要的一条是「乱写也不许抛错」。
import { parseLesson } from "../lib/ai/lessonParse";

const FULL = `===VERDICT===
目标: 5 分要求每个理由都写到「为什么这一点最重要」这一层
现状: 你写到 "Light bulbs are safer than candles." 就停了
下一步: 把最后一条理由往下再推一层

===FOCUS===
策略名: 理由要到「为什么最重要」这一层
证据: "Light bulbs are safer than candles." 这一句之后直接收尾了
缺的是: 缺比较 —— 没说明为什么安全性比其他发明带来的便利更关键
示范改写: Light bulbs are safer than candles because an open flame can ignite curtains overnight.
That single change let families keep working after dark without risking their homes.
迁移: 下次写作前先问自己：我的最后一条理由说清「为什么最重要」了吗

===LANGUAGE===
- 原句: "it is produce really high tempreture" | 类型: 可治 | 改法: 改成 it produces；被动语态要用 be + 过去分词
- 原句: "don't need to storage many bulbs" | 类型: 不可治 | 改法: 地道说法是 don't need to store；同类：give access to（不是 give accessing）

===COMPARE===
1. 立场与贡献 | 你的: "I think the most important invention is the light bulb." | 范文: "The light bulb reshaped how long a day could be." | 差在: 范文把立场绑在一个可展开的机制上
2. 展开方式 | 你的: "It's performance is not very stable." | 范文: "Candles burned out in an hour and had to be watched." | 差在: 范文给了具体场景
3. 语言 | 你的: "had have to use candles" | 范文: "had to rely on candles" | 差在: 基本动词形态

===NEXT===
任务: 把 "Light bulbs are safer than candles." 这一句展开成两句，补上「为什么这比其他好处更关键」
自查1: 第二句里有没有出现一个具体后果
自查2: 有没有说明它比其他发明更重要
自查3: 两句之间有没有因果连接`;

describe("parseLesson", () => {
  test("完整输出：五段全部解析出来，ok=true", () => {
    const r = parseLesson(FULL);
    expect(r.ok).toBe(true);
    expect(r.verdict.goal).toContain("5 分要求");
    expect(r.verdict.now).toContain("Light bulbs are safer than candles");
    expect(r.verdict.next).toBe("把最后一条理由往下再推一层");

    expect(r.focus.strategy).toBe("理由要到「为什么最重要」这一层");
    expect(r.focus.evidence).toContain("直接收尾了");
    expect(r.focus.missing).toContain("缺比较");
    // 示范改写跨两行，必须被合并成一段，不能只留第一行
    expect(r.focus.rewrite).toContain("ignite curtains overnight");
    expect(r.focus.rewrite).toContain("without risking their homes");
    expect(r.focus.transfer).toContain("下次写作前先问自己");

    expect(r.language).toHaveLength(2);
    expect(r.language[0]).toEqual({
      quote: "it is produce really high tempreture",
      kind: "treatable",
      fix: expect.stringContaining("it produces"),
    });
    // 「不可治」里含「可治」——必须先判不可治，否则这条会被标成 treatable
    expect(r.language[1].kind).toBe("untreatable");

    expect(r.compare).toHaveLength(3);
    expect(r.compare[0]).toMatchObject({ index: 1, dim: "立场与贡献" });
    expect(r.compare[0].yours).toContain("the light bulb");
    expect(r.compare[2].gap).toBe("基本动词形态");

    expect(r.next.task).toContain("展开成两句");
    expect(r.next.checks).toHaveLength(3);
    expect(r.next.checks[2]).toBe("两句之间有没有因果连接");
    expect(r.raw).toBe(FULL);
  });

  test("缺段：只有 VERDICT + FOCUS 时其余为空，仍算 ok", () => {
    const r = parseLesson(`===VERDICT===
现状: 你写到 "A" 就停了

===FOCUS===
策略名: 补机制
示范改写: Because the engine heats the air, the balloon rises.`);
    expect(r.ok).toBe(true);
    expect(r.verdict.goal).toBe("");
    expect(r.language).toEqual([]);
    expect(r.compare).toEqual([]);
    expect(r.next).toEqual({ task: "", checks: [] });
  });

  test("缺少「现状」或「示范改写」→ ok=false（静默降级的触发条件）", () => {
    const noNow = parseLesson(`===VERDICT===
目标: x

===FOCUS===
策略名: y
示范改写: z`);
    expect(noNow.ok).toBe(false);

    const noRewrite = parseLesson(`===VERDICT===
现状: "A" 停在这里

===FOCUS===
策略名: y`);
    expect(noRewrite.ok).toBe(false);
  });

  test("中英文冒号混用 + 缺 | 分隔符：仍按标签抓", () => {
    const r = parseLesson(`===VERDICT===
目标：上一档要求细节
现状：你写到 "A" 就停了
下一步：补一个后果

===FOCUS===
策略名：补一个具体后果
证据："A"
缺的是：缺具体场景
示范改写：Add one concrete consequence here.
迁移：下次先问后果是什么

===LANGUAGE===
- 原句："the radiators is still cold" 类型：可治 改法：主谓一致，改成 are

===COMPARE===
1. 展开方式 你的："A" 范文："B" 差在：范文给了细节

===NEXT===
任务：把 "A" 展开成两句
自查1：有没有具体后果`);
    expect(r.ok).toBe(true);
    expect(r.verdict.now).toContain("就停了");
    expect(r.language).toHaveLength(1);
    expect(r.language[0].quote).toBe("the radiators is still cold");
    expect(r.language[0].kind).toBe("treatable");
    expect(r.compare[0].dim).toBe("展开方式");
    expect(r.compare[0].model).toBe("B");
    expect(r.next.checks).toEqual(["有没有具体后果"]);
  });

  test("LANGUAGE / COMPARE 写「无」→ 空数组", () => {
    const r = parseLesson(`===VERDICT===
现状: "A" 停在这里

===FOCUS===
策略名: y
示范改写: z

===LANGUAGE===
无

===COMPARE===
无`);
    expect(r.language).toEqual([]);
    expect(r.compare).toEqual([]);
  });

  test.each([
    ["空串", ""],
    ["null", null],
    ["undefined", undefined],
    ["没有段标记的自由文本", "我觉得你写得不错，继续加油。"],
    ["半截 JSON", '{"focus": {"strategy":'],
    ["只有段标记", "===VERDICT===\n===FOCUS===\n===NEXT==="],
    ["数字", 12345],
  ])("乱写不抛错：%s → ok=false 且结构完整", (_label, input) => {
    const r = parseLesson(input);
    expect(r.ok).toBe(false);
    expect(r.verdict).toEqual({ goal: "", now: "", next: "" });
    expect(r.focus).toEqual({ strategy: "", evidence: "", missing: "", rewrite: "", transfer: "" });
    expect(Array.isArray(r.language)).toBe(true);
    expect(Array.isArray(r.compare)).toBe(true);
    expect(r.next).toEqual({ task: "", checks: [] });
  });

  test("LANGUAGE 类型把格式说明「可治 或 不可治」原样照抄 → kind 为空，而不是被判成不可治", () => {
    const raw = [
      "===VERDICT===",
      '现状: "A" 停在这里',
      "===FOCUS===",
      "策略名: y",
      "示范改写: z",
      "===LANGUAGE===",
      '- 原句: "had have to" | 类型: 可治 或 不可治 | 改法: had to',
      '- 原句: "it is produce" | 类型: 可治|不可治 | 改法: it produces',
      '- 原句: "need to storage" | 类型: 不可治 | 改法: need to store',
      '- 原句: "radiators is" | 类型: 可治 | 改法: radiators are',
    ].join("\n");
    const r = parseLesson(raw);
    expect(r.language.map((x) => x.kind)).toEqual(["", "", "untreatable", "treatable"]);
  });

  test("代码围栏包裹的输出仍能解析", () => {
    const r = parseLesson("```\n===VERDICT===\n现状: \"A\" 停在这里\n\n===FOCUS===\n策略名: y\n示范改写: z\n```");
    expect(r.ok).toBe(true);
    expect(r.focus.strategy).toBe("y");
  });
});
