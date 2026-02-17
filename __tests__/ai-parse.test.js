import { parseReport, parseScoreReport } from "../lib/ai/parse";

describe("parseReport", () => {
  test("parses legacy JSON response", () => {
    const out = parseReport(
      JSON.stringify({
        score: 4,
        band: 4,
        summary: "ok",
        goals_met: [true, false, true],
      })
    );
    expect(out.error).toBeUndefined();
    expect(out.score).toBe(4);
    expect(out.band).toBe(4);
  });

  test("parses sectioned report", () => {
    const raw = `
===SCORE===
Score: 4
Band: 4.0
Summary: Goals are mostly covered, but tone is somewhat informal.
===GOALS===
Goal1: OK situation explained clearly
Goal2: PARTIAL resubmission request lacks detail
Goal3: MISSING impact on grade is unclear
===ANNOTATION===
Dear Professor,
<r>I am a subscriber of your magazine.</r><n level="red" fix="I am a subscriber to your magazine.">Wrong collocation.</n>
Thanks.

===PATTERNS===
{"patterns":[{"tag":"collocation","count":1,"summary":"fixed phrase misuse"},{"tag":"goal coverage","count":1,"summary":"third goal missing"}]}

===COMPARISON===
[Model]
Dear Professor, I would appreciate it if...

[Comparison]
1. Opening tone
   Yours: I am a subscriber of your magazine.
   Model: I am a subscriber to your magazine.
   Difference: Fixed collocation improves accuracy.
===ACTION===
Action1: Collocation accuracy
Importance: Directly impacts language accuracy score.
Action: Memorize and apply "subscribe to", "apply for", and "depend on".
`;

    const out = parseReport(raw);
    expect(out.error).toBe(false);
    expect(out.score).toBe(4);
    expect(out.summary).toContain("Goals are mostly covered");
    expect(out.goals).toHaveLength(3);
    expect(out.goals_met).toEqual([true, false, false]);
    expect(out.annotationCounts.red).toBe(1);
    expect(out.patterns[0].tag).toBe("collocation");
    expect(out.actions).toHaveLength(1);
    expect(out.next_steps[0]).toContain("subscribe to");
  });

  test("parseScoreReport returns board-friendly shape", () => {
    const raw = `
===SCORE===
Score: 3
Band: 3.5
Summary: Development is limited.
===ACTION===
Action1: Add support
Importance: Weak support lowers persuasiveness.
Action: Use "for example" to add concrete detail.
`;
    const out = parseScoreReport(raw, "discussion");
    expect(out.score).toBe(3);
    expect(out.actions).toHaveLength(1);
    expect(out.goals).toBeNull();
  });

  test("returns fallback when section markers are missing", () => {
    const out = parseReport("plain text");
    expect(out.error).toBe(true);
    expect(out.summary).toContain("Scoring parse failed");
  });
});
