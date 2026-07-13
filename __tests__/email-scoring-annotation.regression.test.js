import { parseReport } from "../lib/ai/parse";
import { calibrateScoreReport } from "../lib/ai/calibration";

const ESSAY = `Dear Mr. Harris,
I am writing to inform you about a problem about the heating system in my apartment. I moved in recently, and since last week, the heater has completely stop working. No matter how I adjust the thermostat, the radiators is still cold, and the temperature in the apartment has dropped a lot, especially at night.
This issue has starting to affect my daily life and study routine in a big way. Because my apartment is so cold, I have trouble to concentrate on my coursework, and I often need to stop studying early just for warm up under blankets. I also have difficulty to sleep well, which makes me feeling tired and less productive during the day.
Because of these effects, I would like to request that a repair technician can be sent to check and fix the heating system as soon as possible, ideally in the next two or three days. If the full repair will take more longer, I will appreciate if you can give me a temporary space heater so I can continue my daily activities comfortable.
Thank you for your attention on this matter. I look forward for your response soon.
Best regards,
Lisa`;

test("e2e: Lisa heating-system email — about/about kept, dims 0.5, score ~4.5", () => {
  const raw = [
    "===SCORE===",
    "分数: 4.5",
    "Band: High-Intermediate+",
    "维度-任务完成: 5 三个目标均完成且有细节",
    "维度-组织连贯: 4.5 结构清晰衔接自然",
    "维度-语言使用: 3.5 局部小错较多但均不影响理解",
    "总评: 语言小错偏多，介词与时态需要打磨。",
    "",
    "===GOALS===",
    "Goal1: OK 清晰描述暖气问题",
    "Goal2: OK 说明了对生活学习的影响",
    "Goal3: OK 提出了明确维修请求",
    "",
    "===ANNOTATION===",
    "Dear Mr. Harris,",
    "I am writing to inform you about a problem <r>about</r><n level=\"red\" fix=\"将 'about' 改为 'with'\">介词搭配错误，应为 a problem with。</n> the heating system in my apartment. Thank you for your attention <r>on</r><n level=\"red\" fix=\"将 'on' 改为 'to'\">介词错误。</n> this matter. I look forward for your response soon. <r>for</r><n level=\"red\" fix=\"将 'for' 改为 'to'\">介词错误。</n>",
    "Best regards,",
    "Lisa",
  ].join("\n");

  const parsed = parseReport(raw);
  expect(parsed.error).toBe(false);

  const out = calibrateScoreReport("email", parsed, ESSAY);
  // 1) weighted 5*0.4 + 4.5*0.3 + 3.5*0.3 = 4.4 → holistic 4.5 抬到 4.5,无任何
  //    guardrail cap 介入。修2后 lift 改动了分数即视为 adjusted=true,这里改为
  //    断言 reasons 里只有 holistic_lift(即没有任何 cap reason)。
  expect(out.calibration.reasons).toEqual(["holistic_lift"]);
  expect(out.calibration.adjusted).toBe(true);
  expect(out.score).toBe(4.5);

  // 2) the rendered text IS the user's submitted text, byte for byte —
  //    the AI's (partial) echo must never replace what the user wrote
  const pt = out.annotationParsed.plainText;
  expect(pt).toBe(ESSAY);
  expect(pt).toContain("about a problem about the heating system");
  const aboutMark = out.annotationParsed.annotations.find(
    (a) => pt.slice(a.start, a.end) === "about"
  );
  expect(aboutMark.start).toBeGreaterThan(pt.indexOf("about")); // not the first occurrence

  // 3) standalone "on" marked, not the tail of "attention"
  const onMark = out.annotationParsed.annotations.find(
    (a) => pt.slice(a.start, a.end) === "on"
  );
  expect(pt.slice(onMark.start - 1, onMark.end + 1)).toBe(" on ");

  // 4) trailing echo "for" anchors on the standalone preposition, not inside "forward"
  const forMark = out.annotationParsed.annotations.find(
    (a) => pt.slice(a.start, a.end) === "for"
  );
  expect(pt.slice(forMark.start - 1, forMark.end + 1)).toBe(" for ");
  expect(pt).toContain("I look forward for your response soon.");
});
