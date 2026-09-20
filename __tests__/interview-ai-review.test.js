/**
 * 模拟面试「AI 整场分析」的纯函数层（lib/ai/prompts/interviewReview.js）。
 *
 * 锁的是：
 *   ① system prompt 在 /api/ai 的 12000 字符上限内，且含跨题诊断的关键约束
 *      （不重新打分 / 证据引原句 / 改写示范 / STT filler 不算问题 / 安全声明）；
 *   ② message 把每题的题面、转写、机器分、跑题判定都喂进去；跳过的题写「未作答」，
 *      评分失败但有转写的题写「评分不可用」，绝不假装有分；
 *   ③ 解析容忍 markdown 围栏 / 前后杂文 / 维度别名 / 字段缺失，但空报告要抛错；
 *   ④ 缓存 key 只看题 + 转写 + 分：结束页与练习记录同一场命中同一条；转写变了就换 key。
 */
import {
  getInterviewReviewSystemPrompt,
  buildInterviewReviewMessage,
  parseInterviewReview,
  interviewReviewCacheKey,
  reviewableAnswers,
  MIN_REVIEW_WORDS,
} from "../lib/ai/prompts/interviewReview";

const T1 =
  "Um, I think I would say I make decisions pretty quickly, like when I chose my history class last semester I just looked at the syllabus for five minutes and signed up.";
const T2 = "I like to eat lunch with my friends because it is fun and, uh, we talk about many things.";

const ITEMS = [
  {
    id: "q1",
    question: "Do you make decisions quickly or slowly?",
    category: "Decision-making",
    recorded: true,
    transcript: T1,
    aiScore: {
      score: 4,
      onTopic: true,
      summary: "切题且有具体例子，展开略薄。",
      dimensions: {
        fluency: { score: 4 },
        intelligibility: { score: 4.5 },
        language: { score: 3.5 },
        organization: { score: 4 },
      },
    },
  },
  {
    id: "q2",
    question: "How do you usually decide what to eat for lunch?",
    category: "Daily life",
    recorded: true,
    transcript: T2,
    aiScore: {
      score: 2.5,
      onTopic: false,
      summary: "回答偏离了问题主题。",
      dimensions: {
        fluency: { score: 3 },
        intelligibility: { score: 3 },
        language: { score: 2.5 },
        organization: { score: 2 },
      },
    },
  },
  { id: "q3", question: "Skipped one?", category: "Daily life", recorded: false, transcript: null, aiScore: null },
  {
    id: "q4",
    question: "Scored failed but spoken",
    category: "Work",
    recorded: true,
    transcript: "Well I guess I would talk to my manager first and then decide.",
    aiScore: { error: true, score: 0, summary: "评分超时" },
  },
];

describe("system prompt", () => {
  const sys = getInterviewReviewSystemPrompt();

  it("在 /api/ai 的 system 上限内", () => {
    expect(sys.length).toBeLessThan(12000);
    expect(sys.length).toBeGreaterThan(800);
  });

  it("写明了跨题诊断的关键约束", () => {
    expect(sys).toMatch(/不是重新打分/);
    expect(sys).toMatch(/evidence/);
    expect(sys).toMatch(/原句/);
    expect(sys).toMatch(/rewrite/);
    expect(sys).toMatch(/100-130 词/);
    expect(sys).toMatch(/nextSteps/);
    expect(sys).toMatch(/focus/);
    // STT filler 不算问题；不臆想发音
    expect(sys).toMatch(/um, uh/);
    expect(sys).toMatch(/不要臆想/);
    // 注入防线
    expect(sys).toMatch(/安全声明/);
  });

  it("只要 JSON、不要围栏", () => {
    expect(sys).toMatch(/严格只输出以下 JSON/);
    expect(sys).toMatch(/不要 markdown 代码围栏/);
  });
});

describe("buildInterviewReviewMessage", () => {
  const msg = buildInterviewReviewMessage({ items: ITEMS, averageScore: 3.5, totalElapsed: 200, topic: "Campus life" });

  it("头部有题数 / 有效作答数 / 平均分 / 用时 / 话题", () => {
    expect(msg).toMatch(/题目数：4/);
    expect(msg).toMatch(/有效作答：3 题/);
    expect(msg).toMatch(/平均分：3\.5\/5/);
    expect(msg).toMatch(/用时：3 分 20 秒/);
    expect(msg).toMatch(/话题：Campus life/);
  });

  it("每题带题面、类别、转写和词数", () => {
    expect(msg).toContain("===== Q1 [Decision-making] =====");
    expect(msg).toContain("面试问题：Do you make decisions quickly or slowly?");
    expect(msg).toContain(T1);
    expect(msg).toMatch(/Q1[\s\S]*考生转写（STT，\d+ 词）/);
  });

  it("机器分 + 四维 + 跑题判定一起给", () => {
    expect(msg).toMatch(/Q1[\s\S]*机器评分：4\/5（流利度 4 \/ 可理解度 4\.5 \/ 语言 3\.5 \/ 组织 4）/);
    expect(msg).toMatch(/Q2[\s\S]*机器评分：2\.5\/5[^\n]*；判定：跑题/);
    expect(msg).toContain("机器评分摘要：回答偏离了问题主题。");
  });

  it("跳过的题写「未作答」，评分失败但有转写的题写「不可用」", () => {
    const q3 = msg.slice(msg.indexOf("===== Q3"), msg.indexOf("===== Q4"));
    expect(q3).toMatch(/未作答/);
    expect(q3).not.toMatch(/机器评分：\d/);
    const q4 = msg.slice(msg.indexOf("===== Q4"));
    expect(q4).toMatch(/机器评分：不可用/);
    expect(q4).toContain("talk to my manager first");
    expect(q4).not.toMatch(/评分超时/);
  });

  it("在 /api/ai 的 message 上限内", () => {
    expect(msg.length).toBeLessThan(40000);
  });

  it("空输入不炸", () => {
    expect(() => buildInterviewReviewMessage()).not.toThrow();
    expect(buildInterviewReviewMessage({ items: [] })).toMatch(/题目数：0/);
  });
});

describe("reviewableAnswers", () => {
  it("只算有实质转写的题", () => {
    expect(reviewableAnswers(ITEMS).map((x) => x.id)).toEqual(["q1", "q2", "q4"]);
    expect(MIN_REVIEW_WORDS).toBe(3);
    expect(reviewableAnswers([{ transcript: "uh um" }, { transcript: "   " }, {}])).toEqual([]);
    expect(reviewableAnswers(null)).toEqual([]);
  });
});

describe("parseInterviewReview", () => {
  const FULL = {
    overview: "整体在 3-3.5 档，两题波动大，最拖分的是展开。",
    strengths: [{ point: "Q1 有具体例子", evidence: 'Q1: "looked at the syllabus for five minutes"' }],
    issues: [
      {
        dimension: "elaboration",
        title: "只给观点不给细节",
        evidence: 'Q2: "because it is fun"',
        why: "没有支撑的理由撑不到 3 分以上",
        fix: "把 fun 换成一个具体场景：上周和谁在哪吃、聊了什么。",
      },
      { dimension: "切题", title: "Q2 没回答『怎么决定』", evidence: 'Q2: "I like to eat lunch"', why: "答成了喜好", fix: "第一句直接说 I usually decide by ..." },
    ],
    patterns: ["理由都停在 fun / good 这一层"],
    rewrite: { question: 2, improved: "Honestly, I usually decide based on how much time I have. ...", changes: "开头直接答『怎么决定』；补了昨天的具体例子。" },
    nextSteps: ["第一句直接给答案", "每题一个带时间地点的例子", "结尾一句回扣问题"],
    focus: "下次只盯一件事：每题必须有一个具体例子。",
  };

  it("完整 JSON 逐字段落位，维度别名归一化", () => {
    const r = parseInterviewReview(JSON.stringify(FULL));
    expect(r.overview).toBe(FULL.overview);
    expect(r.strengths).toHaveLength(1);
    expect(r.strengths[0].evidence).toContain("syllabus");
    expect(r.issues).toHaveLength(2);
    expect(r.issues[0].dimension).toBe("elaboration");
    expect(r.issues[1].dimension).toBe("relevance");
    expect(r.issues[0].fix).toContain("具体场景");
    expect(r.patterns).toEqual(FULL.patterns);
    expect(r.rewrite).toEqual({ question: 2, improved: FULL.rewrite.improved, changes: FULL.rewrite.changes });
    expect(r.nextSteps).toEqual(FULL.nextSteps);
    expect(r.focus).toBe(FULL.focus);
  });

  it("容忍 markdown 围栏和前后杂文", () => {
    const wrapped = "好的，以下是分析：\n```json\n" + JSON.stringify(FULL) + "\n```\n希望有帮助。";
    expect(parseInterviewReview(wrapped).issues).toHaveLength(2);
  });

  it("字段缺失时给空数组 / null，不炸", () => {
    const r = parseInterviewReview(JSON.stringify({ overview: "只有总评。" }));
    expect(r.overview).toBe("只有总评。");
    expect(r.strengths).toEqual([]);
    expect(r.issues).toEqual([]);
    expect(r.patterns).toEqual([]);
    expect(r.rewrite).toBeNull();
    expect(r.nextSteps).toEqual([]);
    expect(r.focus).toBe("");
  });

  it("strengths / patterns 给成字符串数组也认", () => {
    const r = parseInterviewReview(JSON.stringify({ overview: "x", strengths: ["切题"], patterns: [{ text: "习惯 A" }] }));
    expect(r.strengths).toEqual([{ point: "切题", evidence: "" }]);
    expect(r.patterns).toEqual(["习惯 A"]);
  });

  it("截断条数：strengths ≤3 / issues ≤4 / patterns ≤3 / nextSteps ≤3", () => {
    const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
    const r = parseInterviewReview(
      JSON.stringify({
        overview: "x",
        strengths: many(5, (i) => ({ point: `s${i}` })),
        issues: many(6, (i) => ({ title: `i${i}`, fix: "f" })),
        patterns: many(5, (i) => `p${i}`),
        nextSteps: many(5, (i) => `n${i}`),
      }),
    );
    expect(r.strengths).toHaveLength(3);
    expect(r.issues).toHaveLength(4);
    expect(r.patterns).toHaveLength(3);
    expect(r.nextSteps).toHaveLength(3);
  });

  it("没有 JSON / 空报告要抛错，让调用方走「格式异常」文案", () => {
    expect(() => parseInterviewReview("抱歉我无法分析")).toThrow(/No JSON/);
    expect(() => parseInterviewReview("{}")).toThrow(/missing overview/);
    expect(() => parseInterviewReview("")).toThrow();
  });
});

describe("interviewReviewCacheKey", () => {
  it("同一场（题 + 转写 + 分）无论 session id / 日期都同一个 key", () => {
    const a = interviewReviewCacheKey(ITEMS);
    const b = interviewReviewCacheKey(ITEMS.map((x) => ({ ...x })));
    expect(a).toBe(b);
    expect(a).toMatch(/^iv1\|4\|[0-9a-f]+$/);
  });

  it("转写或分数变了就换 key", () => {
    const base = interviewReviewCacheKey(ITEMS);
    const t = ITEMS.map((x, i) => (i === 1 ? { ...x, transcript: x.transcript + " and pizza" } : x));
    expect(interviewReviewCacheKey(t)).not.toBe(base);
    const s = ITEMS.map((x, i) => (i === 0 ? { ...x, aiScore: { ...x.aiScore, score: 3 } } : x));
    expect(interviewReviewCacheKey(s)).not.toBe(base);
  });

  it("没有 id 的题退回题面签名", () => {
    const noId = ITEMS.map(({ id: _id, ...rest }) => rest);
    expect(interviewReviewCacheKey(noId)).toMatch(/^iv1\|4\|/);
    expect(interviewReviewCacheKey(noId)).not.toBe(interviewReviewCacheKey(ITEMS));
  });
});
