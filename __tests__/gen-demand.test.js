/**
 * @jest-environment node
 */
import { computeDemand } from "../lib/genDemand/computeDemand";

// Fixed "now" so the 7-day window and BS swap-date filter are deterministic.
const NOW = "2026-07-15T12:00:00.000Z";
const IN_WINDOW = "2026-07-14T00:00:00.000Z"; // within 7 days of NOW
const OUT_WINDOW = "2026-07-01T00:00:00.000Z"; // older than 7 days
const opts = { now: NOW };

// Minimal bank-config builder. `ids` is any iterable of id strings.
function bank(size, ids = [], extra = {}) {
  return { size, ids: new Set(ids.map(String)), kind: "text", ...extra };
}
function audioBank(size, ids = [], extra = {}) {
  return bank(size, ids, { kind: "audio", ...extra });
}

describe("computeDemand — id extraction & intersection", () => {
  test("consumption counts only ids that fall inside the live bank (retired / personal excluded)", () => {
    const configs = { ctw: bank(100, ["c1", "c2", "c3"]) };
    const sessions = [
      { user_code: "u1", type: "reading", date: IN_WINDOW, details: { subtype: "ctw", itemId: "c1" } },
      { user_code: "u1", type: "reading", date: IN_WINDOW, details: { subtype: "ctw", itemId: "retired_x" } },
      { user_code: "u1", type: "reading", date: IN_WINDOW, details: { subtype: "ctw", itemId: "pb_personal" } },
      { user_code: "u1", type: "reading", date: IN_WINDOW, details: { subtype: "ctw", itemId: "c2" } },
    ];
    const out = computeDemand(sessions, configs, opts);
    // Only c1 + c2 are in the live bank → consumed = 2, not 4.
    expect(out.banks.ctw.top_user_consumed).toBe(2);
    expect(out.active_users).toBe(1);
  });

  test("listening practice itemIds arrays are flattened", () => {
    const configs = { lcr: audioBank(100, ["l1", "l2", "l3", "l4"]) };
    const sessions = [
      { user_code: "u1", type: "listening", date: IN_WINDOW, details: { subtype: "lcr", itemIds: ["l1", "l2", "l3"] } },
    ];
    const out = computeDemand(sessions, configs, opts);
    expect(out.banks.lcr.top_user_consumed).toBe(3);
    expect(out.banks.lcr.burn_7d).toBe(3);
  });

  test("adaptive mock snapshot ids (m1+m2 tasks) are counted", () => {
    const configs = { ctw: bank(100, ["c1", "c2", "c3", "c4"]) };
    const sessions = [
      {
        user_code: "u1",
        type: "reading",
        date: IN_WINDOW,
        details: {
          subtype: "mock",
          m1: { tasks: [{ itemId: "c1" }, { itemId: "c2" }] },
          m2: { tasks: [{ itemId: "c3" }] },
        },
      },
    ];
    const out = computeDemand(sessions, configs, opts);
    expect(out.banks.ctw.top_user_consumed).toBe(3);
  });

  test("speaking mock uses repeatSetId / interviewSetId (no m1/m2 tasks)", () => {
    const configs = {
      "speaking-repeat": audioBank(90, ["rpt_1", "rpt_2"]),
      interview: audioBank(11, ["intv_1"], { notInRoutine: true }),
    };
    const sessions = [
      {
        user_code: "u1",
        type: "speaking",
        date: IN_WINDOW,
        details: { subtype: "mock", repeatSetId: "rpt_1", interviewSetId: "intv_1" },
      },
    ];
    const out = computeDemand(sessions, configs, opts);
    expect(out.banks["speaking-repeat"].top_user_consumed).toBe(1);
    expect(out.banks.interview.top_user_consumed).toBe(1);
  });

  test("rdl short vs long are attributed purely by which bank the id lands in", () => {
    const configs = {
      "rdl-short": bank(100, ["rs1", "rs2"]),
      "rdl-long": bank(100, ["rl1"]),
    };
    const sessions = [
      // subtype "rdl" for both; attribution comes from id ∩ bank, not subtype.
      { user_code: "u1", type: "reading", date: IN_WINDOW, details: { subtype: "rdl", itemId: "rs1" } },
      { user_code: "u1", type: "reading", date: IN_WINDOW, details: { subtype: "rdl", itemId: "rs2" } },
      { user_code: "u1", type: "reading", date: IN_WINDOW, details: { subtype: "rdl", itemId: "rl1" } },
    ];
    const out = computeDemand(sessions, configs, opts);
    expect(out.banks["rdl-short"].top_user_consumed).toBe(2);
    expect(out.banks["rdl-long"].top_user_consumed).toBe(1);
  });
});

describe("computeDemand — BS special case", () => {
  test("BS consumed = post-swap session count; pre-swap sessions excluded", () => {
    const configs = { bs: bank(70, [], { special: "bs" }) };
    const sessions = [
      { user_code: "u1", type: "bs", date: OUT_WINDOW, details: [{ id: "x" }] }, // 2026-07-01, post-swap, counts to consumed but not window burn
      { user_code: "u1", type: "bs", date: IN_WINDOW, details: [{ id: "y" }] },
      { user_code: "u1", type: "bs", date: IN_WINDOW, details: [{ id: "z" }] },
      { user_code: "u1", type: "bs", date: "2026-06-01T00:00:00.000Z", details: [] }, // pre-swap → excluded
      { user_code: "u1", type: "bs", date: "2026-06-10T00:00:00.000Z", details: [] }, // pre-swap → excluded
    ];
    const out = computeDemand(sessions, configs, opts);
    // 3 post-swap sessions (07-01, 07-14, 07-14) → consumed 3; 2 pre-swap excluded.
    expect(out.banks.bs.top_user_consumed).toBe(3);
    // burn_7d = bs sessions within the 7-day window = the two 07-14 rows.
    expect(out.banks.bs.burn_7d).toBe(2);
  });
});

describe("computeDemand — triggers", () => {
  test("T1 fires when a top user has consumed >=70% of the bank", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const configs = { ctw: bank(10, ids) };
    const sessions = ids.slice(0, 7).map((id) => ({
      user_code: "u1",
      type: "reading",
      date: IN_WINDOW,
      details: { subtype: "ctw", itemId: id },
    }));
    const out = computeDemand(sessions, configs, opts);
    expect(out.banks.ctw.top_user_pct).toBe(0.7);
    expect(out.banks.ctw.triggers).toContain("T1");
    expect(out.banks.ctw.generate).toBe(true);
  });

  test("T2 fires when a user's OWN runway is short (their burn vs their remaining)", () => {
    // size 100; one user touches 60 distinct ids in-window → their remaining 40,
    // their dailyBurn 60/7 ≈ 8.57 → runway ≈ 4.67 days < 14 → T2.
    // pct 0.6 (< 0.7) → no T1.
    const ids = Array.from({ length: 100 }, (_, i) => `d${i}`);
    const consumed = ids.slice(0, 60);
    const configs = { lcr: audioBank(100, ids) };
    const sessions = [
      { user_code: "u1", type: "listening", date: IN_WINDOW, details: { subtype: "lcr", itemIds: consumed } },
    ];
    const out = computeDemand(sessions, configs, opts);
    expect(out.banks.lcr.top_user_pct).toBe(0.6);
    expect(out.banks.lcr.triggers).toContain("T2");
    expect(out.banks.lcr.triggers).not.toContain("T1");
    // runway = 40 / (60/7) = 4.666… → rounded to 1 decimal
    expect(out.banks.lcr.min_user_runway_days).toBeCloseTo(4.7, 1);
  });

  test("REGRESSION: high site-wide burn does NOT trigger T2 when every user's own runway is ample", () => {
    // The original design compared the TOP user's remaining against the
    // SITE-WIDE burn rate — semantically wrong, since banks are per-user pools
    // (A doing an item doesn't consume it for B). This anchors the fix.
    //
    // size 100; 10 users each consume 5 DISTINCT ids in-window:
    //   - global burn_7d = 50 → old (buggy) T2: remaining(top)=95 < (50/7)*14=100 → would fire.
    //   - per-user: each remaining 95, each dailyBurn 5/7 → runway = 133 days → must NOT fire.
    const ids = Array.from({ length: 100 }, (_, i) => `g${i}`);
    const configs = { lcr: audioBank(100, ids) };
    const sessions = [];
    for (let u = 0; u < 10; u++) {
      sessions.push({
        user_code: `user${u}`,
        type: "listening",
        date: IN_WINDOW,
        details: { subtype: "lcr", itemIds: ids.slice(u * 5, u * 5 + 5) },
      });
    }
    const out = computeDemand(sessions, configs, opts);
    expect(out.banks.lcr.burn_7d).toBe(50); // informational field keeps site-wide meaning
    expect(out.banks.lcr.triggers).not.toContain("T2");
    expect(out.banks.lcr.generate).toBe(false);
    expect(out.banks.lcr.min_user_runway_days).toBe(133);
  });

  test("min_user_runway_days is null when no active user touched the bank in-window", () => {
    const configs = { ctw: bank(100, ["c1"]) };
    // Consumption exists but only OUTSIDE the window (and another session keeps the user active).
    const sessions = [
      { user_code: "u1", type: "reading", date: OUT_WINDOW, details: { subtype: "ctw", itemId: "c1" } },
      { user_code: "u1", type: "email", date: IN_WINDOW, details: { promptId: "em_x" } },
    ];
    const out = computeDemand(sessions, configs, opts);
    expect(out.active_users).toBe(1);
    expect(out.banks.ctw.top_user_consumed).toBe(1); // all-history consumption still counted
    expect(out.banks.ctw.min_user_runway_days).toBeNull();
    expect(out.banks.ctw.triggers).not.toContain("T2");
  });

  test("T3 fires when bank_size is below the hard floor (text 40 / audio 30); works with zero active users", () => {
    const configs = {
      ctw: bank(30), // text floor 40 → below
      lcr: audioBank(20), // audio floor 30 → below
      big: bank(200), // above floor → no T3
    };
    const out = computeDemand([], configs, opts); // no sessions at all
    expect(out.active_users).toBe(0);
    expect(out.banks.ctw.triggers).toEqual(["T3"]);
    expect(out.banks.lcr.triggers).toEqual(["T3"]);
    expect(out.banks.big.triggers).toEqual([]);
    expect(out.banks.big.generate).toBe(false);
  });
});

describe("computeDemand — suggested n (clamp + audio budget)", () => {
  test("n is clamped up to the MIN (4) when the raw term is tiny", () => {
    // Isolate a tiny T2 term with no T3 (size >> floor) and no T1 (low pct).
    // size 151, one user consumes 51 distinct in-window → remaining 100,
    // dailyBurn 51/7 ≈ 7.286, *14 = 102 → T2 term = ceil(102 - 100) = 2 → clamp to 4.
    const ids = Array.from({ length: 151 }, (_, i) => `t${i}`);
    const consumed = ids.slice(0, 51);
    const configs = { lcr: audioBank(151, ids) };
    const sessions = [
      { user_code: "u1", type: "listening", date: IN_WINDOW, details: { subtype: "lcr", itemIds: consumed } },
    ];
    const out = computeDemand(sessions, configs, opts);
    expect(out.banks.lcr.triggers).toEqual(["T2"]);
    expect(out.banks.lcr.n).toBe(4);
  });

  test("n is clamped down to the text cap (20)", () => {
    // size 1, text floor 40 → T3 term = 40 + 10 - 1 = 49 → cap 20.
    const configs = { ctw: bank(1) };
    const out = computeDemand([], configs, opts);
    expect(out.banks.ctw.triggers).toEqual(["T3"]);
    expect(out.banks.ctw.n).toBe(20);
  });

  test("total audio n across all audio banks never exceeds 25 (least severe trimmed / deferred)", () => {
    // Four audio banks size 5 (all below floor 30 → T3, want n = cap 10 each = 40).
    // Budget 25: first two keep 10, third trimmed to 5, fourth deferred.
    const configs = {
      lcr: audioBank(5),
      lc: audioBank(5),
      la: audioBank(5),
      "listening-lat": audioBank(5),
    };
    const out = computeDemand([], configs, opts);
    const audioSum = ["lcr", "lc", "la", "listening-lat"].reduce((s, k) => s + out.banks[k].n, 0);
    expect(audioSum).toBeLessThanOrEqual(25);
    expect(audioSum).toBe(25);
    // Deterministic (all equal severity → stable insertion order).
    expect(out.banks.lcr.n).toBe(10);
    expect(out.banks.lc.n).toBe(10);
    expect(out.banks.la.n).toBe(5);
    expect(out.banks["listening-lat"].generate).toBe(false);
    expect(out.banks["listening-lat"].n).toBe(0);
  });

  test("text banks are not subject to the audio budget", () => {
    const configs = {
      ctw: bank(1),
      ap: bank(1),
      "rdl-short": bank(1),
    };
    const out = computeDemand([], configs, opts);
    // 3 text banks × 20 = 60, all kept (no audio-style budget).
    const textSum = ["ctw", "ap", "rdl-short"].reduce((s, k) => s + out.banks[k].n, 0);
    expect(textSum).toBe(60);
  });
});

describe("computeDemand — routine wiring & privacy", () => {
  test("interview is flagged not_in_routine and excluded from routine_instructions", () => {
    const configs = {
      "speaking-repeat": audioBank(5),
      interview: audioBank(5, [], { notInRoutine: true }),
    };
    const out = computeDemand([], configs, opts);
    expect(out.banks.interview.not_in_routine).toBe(true);
    expect(out.banks["speaking-repeat"].not_in_routine).toBeUndefined();
    // interview may generate:true, but must NOT appear as a routine instruction.
    const joined = out.routine_instructions.join("\n");
    expect(joined).not.toMatch(/interview/);
    expect(joined).toMatch(/speaking-repeat/);
  });

  test("routine_instructions lists only generating, in-routine banks", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const configs = {
      ctw: bank(10, ids), // will generate (T1)
      big: bank(500), // will not generate
    };
    const sessions = ids.slice(0, 8).map((id) => ({
      user_code: "u1", type: "reading", date: IN_WINDOW, details: { subtype: "ctw", itemId: id },
    }));
    const out = computeDemand(sessions, configs, opts);
    expect(out.routine_instructions.some((s) => s.includes("ctw"))).toBe(true);
    expect(out.routine_instructions.some((s) => s.includes("big"))).toBe(false);
  });

  test("output never contains a user_code anywhere", () => {
    const SECRET = "SECRET_USER_ABC123";
    const configs = { ctw: bank(100, ["c1", "c2"]) };
    const sessions = [
      { user_code: SECRET, type: "reading", date: IN_WINDOW, details: { subtype: "ctw", itemId: "c1" } },
      { user_code: SECRET, type: "bs", date: IN_WINDOW, details: [] },
    ];
    const out = computeDemand(sessions, configs, opts);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(SECRET);
    // Structural sanity.
    expect(out.window_days).toBe(7);
    expect(typeof out.generated_at).toBe("string");
    expect(out.active_users).toBe(1);
  });
});

describe("computeDemand — robustness", () => {
  test("malformed / partial session rows are skipped, never throw", () => {
    const configs = { ctw: bank(100, ["c1"]), bs: bank(70, [], { special: "bs" }) };
    const sessions = [
      null,
      undefined,
      {},
      { user_code: "u1" }, // no type
      { user_code: "u1", type: "reading" }, // no details
      { user_code: "u1", type: "reading", date: IN_WINDOW, details: null },
      { user_code: "u1", type: "reading", date: IN_WINDOW, details: "not-an-object" },
      { user_code: "u1", type: "listening", date: IN_WINDOW, details: { itemIds: "not-array" } },
      { user_code: "u1", type: "reading", date: "not-a-date", details: { itemId: "c1" } },
      { user_code: "u1", type: "reading", date: IN_WINDOW, details: { subtype: "mock", m1: null, m2: 5 } },
      { user_code: "u1", type: "mock", date: IN_WINDOW, details: { m1: { tasks: [{ itemId: "c1" }] } } }, // writing mock → ignored
      { user_code: "u1", type: "reading", date: IN_WINDOW, details: { itemId: "c1" } }, // the one valid consume
    ];
    let out;
    expect(() => { out = computeDemand(sessions, configs, opts); }).not.toThrow();
    // Only the final valid row consumed c1; the writing-mock row was ignored.
    expect(out.banks.ctw.top_user_consumed).toBe(1);
  });

  test("empty inputs produce a well-formed object", () => {
    const out = computeDemand([], {}, opts);
    expect(out.active_users).toBe(0);
    expect(out.banks).toEqual({});
    expect(out.routine_instructions).toEqual([]);
    expect(out.window_days).toBe(7);
  });
});
