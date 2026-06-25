const fs = require("fs");
const path = require("path");
const { VOICE_PRESETS, ALL_SAFE_VOICES } = require("../lib/tts/openaiTts");
const {
  derivePersona,
  renderInstructions,
  PACE_CLAUSE,
  TEMPERAMENT_BASELINE,
} = require("../lib/tts/toneDirector");

describe("openaiTts safe voices", () => {
  test("every VOICE_PRESETS voice is a safe voice (no marin/cedar)", () => {
    for (const [key, p] of Object.entries(VOICE_PRESETS)) {
      expect({ key, voice: p.voice }).not.toEqual({ key, voice: "marin" });
      expect({ key, voice: p.voice }).not.toEqual({ key, voice: "cedar" });
      expect(ALL_SAFE_VOICES).toContain(p.voice);
    }
  });

  test("openaiTts source never assigns marin/cedar as a voice (incl. defaults)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../lib/tts/openaiTts.js"), "utf8");
    // matches `voice: "marin"`, `voice = ... "cedar"`, `voice="marin"` — but not prose mentions
    expect(src).not.toMatch(/voice\s*[:=][^;\n]*["'](marin|cedar)["']/);
  });
});

describe("derivePersona", () => {
  const lcItem = {
    speakers: [
      { name: "Woman", role: "student", gender: "female" },
      { name: "Man", role: "advising_staff", gender: "male" },
    ],
  };

  test("LC: gender is locked to metadata", () => {
    const [a, b] = derivePersona(lcItem, "lc");
    expect(a.gender).toBe("female");
    expect(b.gender).toBe("male");
  });

  test("LC: two speakers get distinct safe voices", () => {
    const [a, b] = derivePersona(lcItem, "lc");
    expect(a.voice).not.toBe(b.voice);
    expect(ALL_SAFE_VOICES).toContain(a.voice);
    expect(ALL_SAFE_VOICES).toContain(b.voice);
  });

  test("same-gender pair: distinct voices, NO gender flip", () => {
    const item = {
      speakers: [
        { name: "A", role: "librarian", gender: "female" },
        { name: "B", role: "advisor", gender: "female" },
      ],
    };
    const [a, b] = derivePersona(item, "lc");
    expect(a.gender).toBe("female");
    expect(b.gender).toBe("female"); // must NOT be flipped to male
    expect(a.voice).not.toBe(b.voice);
  });

  test("single-speaker reads _speaker meta, never lcr's utterance text", () => {
    const [p] = derivePersona({ _speaker: { gender: "male", role: "professor" } }, "lat");
    expect(p.gender).toBe("male");
    expect(ALL_SAFE_VOICES).toContain(p.voice);
  });
});

describe("renderInstructions (persona-only)", () => {
  const persona = { temperament: "measured-helpful" };

  test("renders exactly the persona baseline + frozen pace clause", () => {
    expect(renderInstructions(persona)).toBe(`${TEMPERAMENT_BASELINE["measured-helpful"]} ${PACE_CLAUSE}`);
  });

  test("always ends with the frozen never-slow pace clause", () => {
    expect(renderInstructions(persona).endsWith(PACE_CLAUSE)).toBe(true);
  });

  test("falls back to a neutral baseline (never empty) for an unknown/empty persona", () => {
    expect(renderInstructions({}).endsWith(PACE_CLAUSE)).toBe(true);
    expect(renderInstructions(undefined).length).toBeGreaterThan(0);
  });
});
