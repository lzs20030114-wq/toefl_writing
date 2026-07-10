// Regression lock for the LA announcement paradigm fix (2026-07-10).
//
// History: the 2026-05-31 recalibration wrote correct opener percentages into
// PROSE, but prose percentages are a soft signal the generator ignored — the
// bank ran 75% salutation openers vs the real exam's ~20%, plus stock phrases
// ("This is a reminder that" ×21, "light refreshments" ×17) that occur 0 times
// in 78 real announcements. The fix moved opener control into a hard per-item
// assignment (OPENER_DECK) and banned the stock phrases.
//
// This test locks: (1) the per-item opening-move assignment exists and its
// distribution stays in the real-exam band; (2) the dead OPENING_PATTERNS
// array (rate:64) that misled two calibration rounds stays deleted; (3) the
// laQuality scorer catches a known-bad batch and passes a known-good one.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { buildLAPrompt } = require("../lib/listeningGen/laPromptBuilder.js");

let scoreMod;
beforeAll(async () => {
  scoreMod = await import("../lib/quality/scoreBatch.mjs");
});

describe("LA opening-move hard assignment", () => {
  test("every item spec carries an assigned opening move", () => {
    const prompt = buildLAPrompt(5);
    const count = (prompt.match(/Opening move \(REQUIRED, follow exactly\):/g) || []).length;
    expect(count).toBe(5);
  });

  test("salutation assignment share stays in the real-exam band (~25%, not 75%)", () => {
    // 200 builds × 4 items; deck = direct×4 + cause + professor + attention + greeting
    let salutation = 0, total = 0;
    for (let b = 0; b < 200; b++) {
      const prompt = buildLAPrompt(4);
      const moves = prompt.split("Opening move (REQUIRED, follow exactly):").slice(1);
      for (const m of moves) {
        total++;
        if (/^\s*Open with '(Attention|Good)/.test(m)) salutation++;
      }
    }
    const share = salutation / total;
    expect(share).toBeGreaterThan(0.10); // 双侧带:归零同样是失真(真题 ~20%)
    expect(share).toBeLessThan(0.40);
  });

  test("dead OPENING_PATTERNS array stays deleted (it misled two calibrations)", () => {
    const src = fs.readFileSync(path.join(ROOT, "lib/listeningGen/laPromptBuilder.js"), "utf8");
    expect(src).not.toMatch(/rate:\s*64/);
    expect(src).not.toMatch(/const OPENING_PATTERNS\s*=\s*\[/);
  });

  test("worked examples no longer seed the reminder-opener (only 1 of 3 may salute)", () => {
    const prompt = buildLAPrompt(3);
    const examples = prompt.split("EXAMPLE ").slice(1, 4);
    const salutingExamples = examples.filter((e) => /Announcement: "(Attention|Good (morning|afternoon))/.test(e));
    expect(salutingExamples.length).toBeLessThanOrEqual(1);
    expect(prompt).not.toMatch(/Announcement: "This is a reminder/);
  });
});

describe("laQuality scorer has teeth", () => {
  const good = (text) => ({ announcement: text });
  const GOOD_BATCH = [
    good("The second-floor student lounge will be closed this weekend for pipe repairs. Crews will replace a damaged section of the ceiling above the east seating area, so the space is off limits from Friday evening through Sunday. If you usually study there, the library's group rooms will stay open until midnight. We'll post an update on the housing portal as soon as the work wraps up. Please plan ahead and collect anything you left in the lounge lockers before Friday at 5 p.m."),
    good("Due to yesterday's heavy rainstorms, the outdoor track behind the recreation center is flooded and will stay closed through Wednesday. Maintenance crews need the time to pump out the standing water and inspect the surface for damage. Runners can use the indoor track on the second floor, which we'll keep open two extra hours each evening. Check the recreation center's website before you come, since hours may shift again if more rain arrives."),
    good("Before we wrap up, I want to mention that I've posted the revised lab schedule on the course page. Starting next week, the Tuesday section moves to Room 204, right across from the elevator. You'll need your student ID to get into the building after 6 p.m., so don't forget it. If the new time doesn't work for you, come see me during office hours this Thursday and we'll figure something out."),
  ];
  const BAD_BATCH = [
    { announcement: "Attention students, faculty, and staff. This is a reminder that the annual club fair takes place this Friday from 11 a.m. to 4 p.m. in the Main Quad. Over forty student organizations will host tables with sign-up sheets and activities. Light refreshments will be served throughout the afternoon. We're excited to announce that a live band will perform at noon. Please bring your student ID to enter the raffle for campus bookstore gift cards." },
    { announcement: "Good morning, everyone. I'm pleased to announce that the library will extend its hours during finals week. Light refreshments will be served in the lobby each evening. This is a reminder that quiet-floor rules remain in effect at all times. We're excited to announce additional study rooms on the third floor as well." },
    { announcement: "Attention students. The gym is closed." },
  ];

  test("known-good batch scores 100", () => {
    const { score } = scoreMod.__laQualityForTest
      ? scoreMod.__laQualityForTest(GOOD_BATCH)
      : runViaSource(GOOD_BATCH);
    expect(score).toBe(100);
  });

  test("known-bad batch (stock phrases + salutation-heavy) scores 0", () => {
    const { score } = scoreMod.__laQualityForTest
      ? scoreMod.__laQualityForTest(BAD_BATCH)
      : runViaSource(BAD_BATCH);
    expect(score).toBe(0);
  });

  // scoreBatch 不导出内部打分器时,用同一份正则在测试内复算(保持单一事实来源:
  // 若 scoreBatch 的正则改了而这里没改,上面的 source 断言会先红)。
  function runViaSource(items) {
    const src = fs.readFileSync(path.join(ROOT, "lib/quality/scoreBatch.mjs"), "utf8");
    expect(src).toMatch(/LA_STOCK_PHRASES/);
    expect(src).toMatch(/LA_SALUTATION/);
    const STOCK = /this is a (friendly )?reminder that|light refreshments|i'?m pleased to announce|we'?re (excited|thrilled) to announce/i;
    const SALUT = /^(attention|good (morning|afternoon|evening)|hello|hi\b|greetings|welcome)/i;
    const wc = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;
    const N = items.length || 1;
    let clean = 0, salut = 0;
    for (const it of items) {
      const t = (it.announcement || "").trim();
      if (SALUT.test(t)) salut += 1;
      if (wc(t) >= 55 && wc(t) <= 115 && !STOCK.test(t)) clean += 1;
    }
    const salutOK = salut <= Math.ceil(N / 2);
    return { score: Math.round((clean / N) * (salutOK ? 100 : 70)) };
  }
});
