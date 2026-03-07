import assert from "node:assert/strict";

import {
  autoRepairWordBag,
  createCircuitBreakerState,
  getActiveCircuitBreakerTypes,
  applyCircuitBreakersToSpec,
  updateCircuitBreakers,
} from "./generateBSQuestions.mjs";

function emptyTypeStats() {
  return {
    "negation": { generated: 0, accepted: 0, rejected: 0, reasons: {} },
    "3rd-reporting": { generated: 0, accepted: 0, rejected: 0, reasons: {} },
    "1st-embedded": { generated: 0, accepted: 0, rejected: 0, reasons: {} },
    "interrogative": { generated: 0, accepted: 0, rejected: 0, reasons: {} },
    "direct": { generated: 0, accepted: 0, rejected: 0, reasons: {} },
    "relative": { generated: 0, accepted: 0, rejected: 0, reasons: {} },
  };
}

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err?.stack || String(err));
    process.exitCode = 1;
  }
}

run("autoRepairWordBag removes prefilled overlap and preserves distractor", () => {
  const repaired = autoRepairWordBag(
    "She asked whether the deadline had been extended.",
    ["the deadline"],
    ["she", "asked", "whether", "the", "deadline", "had been extended", "today"],
    "today",
  );

  assert.deepEqual(repaired, ["she", "asked", "whether", "had been extended", "today"]);
});

run("autoRepairWordBag fills the safest single-word gap", () => {
  const repaired = autoRepairWordBag(
    "I did finish the assignment on time.",
    [],
    ["I", "did finish", "the assignment", "on"],
    null,
  );

  assert.deepEqual(repaired, ["I", "did finish", "the assignment", "on", "time"]);
});

run("autoRepairWordBag does not invent multi-word repairs", () => {
  const repaired = autoRepairWordBag(
    "I did finish the assignment on time.",
    [],
    ["I", "did finish", "the assignment"],
    null,
  );

  assert.deepEqual(repaired, ["I", "did finish", "the assignment"]);
});

run("circuit breaker triggers with detailed event payload after sustained low accept rate", () => {
  const state = createCircuitBreakerState();
  const spec = [{ type: "interrogative", difficulty: "medium", count: 2 }];

  const makeResult = (reason) => {
    const typeStats = emptyTypeStats();
    typeStats.interrogative = {
      generated: 2,
      accepted: 0,
      rejected: 2,
      reasons: { [reason]: 2 },
    };
    return { typeStats };
  };

  updateCircuitBreakers(state, 1, "normal", spec, makeResult("format: bad inversion"));
  updateCircuitBreakers(state, 2, "normal", spec, makeResult("format: bad inversion"));

  const blocked = getActiveCircuitBreakerTypes(state, 2);
  assert.equal(blocked.has("interrogative"), true);
  assert.equal(state.events.length, 1);

  const event = state.events[0];
  assert.equal(event.type, "interrogative");
  assert.equal(event.round, 2);
  assert.equal(event.generated, 4);
  assert.equal(event.accepted, 0);
  assert.equal(event.rejected, 4);
  assert.equal(event.acceptRate, 0);
  assert.equal(Array.isArray(event.reasons), true);
  assert.equal(event.reasons[0][0], "format: bad inversion");
  assert.equal(event.blockedUntilRound, 5);
  assert.equal(Array.isArray(event.recentRounds), true);
  assert.equal(event.recentRounds.length, 2);
  assert.deepEqual(event.recentRounds[0].spec, spec);
});

run("applyCircuitBreakersToSpec rewrites blocked types to safer fallbacks", () => {
  const spec = [
    { type: "interrogative", difficulty: "medium", count: 2 },
    { type: "relative", difficulty: "hard", count: 1 },
  ];
  const poolState = {
    typeTotals: {
      "negation": 4,
      "3rd-reporting": 1,
      "1st-embedded": 2,
      "interrogative": 5,
      "direct": 3,
      "relative": 3,
    },
  };
  const globalTypeTargets = {
    "negation": 5,
    "3rd-reporting": 8,
    "1st-embedded": 4,
    "interrogative": 2,
    "direct": 2,
    "relative": 2,
  };

  const rewritten = applyCircuitBreakersToSpec(
    spec,
    new Set(["interrogative"]),
    poolState,
    globalTypeTargets,
  );

  assert.equal(rewritten.some((cell) => cell.type === "interrogative"), false);
  assert.equal(rewritten.some((cell) => cell.type === "3rd-reporting" && cell.difficulty === "medium" && cell.count === 2), true);
  assert.equal(rewritten.some((cell) => cell.type === "relative" && cell.difficulty === "hard" && cell.count === 1), true);
});
