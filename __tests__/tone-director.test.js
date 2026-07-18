const fs = require("fs");
const path = require("path");
const { VOICE_PRESETS, ALL_SAFE_VOICES } = require("../lib/tts/openaiTts");
const {
  derivePersona,
  renderInstructions,
  voiceFor,
  temperamentFor,
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

describe("temperamentFor — la announcer temperament (2026-07-18)", () => {
  test("la defaults to bright-announcer (authoritative-formal is retired)", () => {
    expect(temperamentFor("registrar", "AUTHORITY", "la")).toBe("bright-announcer");
    expect(TEMPERAMENT_BASELINE["bright-announcer"]).toMatch(/bright, energetic, welcoming/);
    expect(TEMPERAMENT_BASELINE["authoritative-formal"]).toBeUndefined();
  });

  test("la club/society/leader roles stay relaxed-campus", () => {
    expect(temperamentFor("chess club president", "AUTHORITY", "la")).toBe("relaxed-campus");
    expect(temperamentFor("student society", "STUDENT_PEER", "la")).toBe("relaxed-campus");
  });

  test("lat stays engaged-measured; lc authority stays measured-helpful", () => {
    expect(temperamentFor("professor", "AUTHORITY", "lat")).toBe("engaged-measured");
    expect(temperamentFor("advisor", "AUTHORITY", "lc")).toBe("measured-helpful");
  });
});

describe("voiceFor — no onyx PA special case (2026-07-18)", () => {
  test("authority male resolves to the primary authority voice (echo), never onyx", () => {
    expect(voiceFor("male", "AUTHORITY")).toBe("echo");
    expect(voiceFor("male", "AUTHORITY")).not.toBe("onyx");
  });

  test("authority female = nova; peers = coral / ash", () => {
    expect(voiceFor("female", "AUTHORITY")).toBe("nova");
    expect(voiceFor("female", "STUDENT_PEER")).toBe("coral");
    expect(voiceFor("male", "STUDENT_PEER")).toBe("ash");
  });

  test("la male announcement persona no longer picks onyx", () => {
    const [p] = derivePersona({ _speaker: { gender: "male", role: "advisor" } }, "la");
    expect(p.voice).toBe("echo");
    expect(p.voice).not.toBe("onyx");
  });
});
