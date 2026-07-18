const { deriveSpeakerMeta, genderFor, stableHash } = require("../lib/tts/speakerMeta");

// deriveSpeakerMeta mints the { gender, role } that the single-speaker listening types
// (lat/la/lcr) never persist, so the persona layer can gender-lock a voice + pick a
// temperament. Gender MUST be a stable hash of item.id (no Math.random) so a re-render of
// the same id never flips voice family.
describe("deriveSpeakerMeta — determinism", () => {
  test("same id → same gender across many calls", () => {
    const item = { id: "lat_abc_1", transcript: "x" };
    const first = deriveSpeakerMeta(item, "lat").gender;
    for (let i = 0; i < 20; i++) {
      expect(deriveSpeakerMeta({ id: "lat_abc_1" }, "lat").gender).toBe(first);
    }
  });

  test("stableHash is deterministic and unsigned", () => {
    expect(stableHash("lat_abc_1")).toBe(stableHash("lat_abc_1"));
    expect(stableHash("lat_abc_1")).toBeGreaterThanOrEqual(0);
    expect(stableHash("")).toBe(0);
  });

  test("no randomness: genderFor never varies for a fixed id", () => {
    const g = genderFor("lcr_xyz_42");
    for (let i = 0; i < 50; i++) expect(genderFor("lcr_xyz_42")).toBe(g);
  });
});

describe("deriveSpeakerMeta — both genders appear across a realistic id set", () => {
  test("a spread of ids yields BOTH male and female", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `lat_mpv_${i}`);
    const genders = new Set(ids.map((id) => deriveSpeakerMeta({ id }, "lat").gender));
    expect(genders.has("male")).toBe(true);
    expect(genders.has("female")).toBe(true);
  });

  test("gender is always exactly 'male' or 'female'", () => {
    for (let i = 0; i < 30; i++) {
      const g = deriveSpeakerMeta({ id: `x_${i}` }, "lcr").gender;
      expect(["male", "female"]).toContain(g);
    }
  });
});

describe("deriveSpeakerMeta — role mapping per type", () => {
  test("lat is always a professor (single-lecturer academic talk)", () => {
    expect(deriveSpeakerMeta({ id: "lat_1", transcript: "t" }, "lat").role).toBe("professor");
  });

  test("la prefers speaker_role, falls back to context", () => {
    expect(deriveSpeakerMeta({ id: "la_1", speaker_role: "advisor", context: "info_session" }, "la").role).toBe("advisor");
    expect(deriveSpeakerMeta({ id: "la_2", context: "info_session" }, "la").role).toBe("info_session");
    expect(deriveSpeakerMeta({ id: "la_3" }, "la").role).toBe(null);
  });

  test("lcr passes context through verbatim (AUTHORITY_RE self-buckets it)", () => {
    expect(deriveSpeakerMeta({ id: "lcr_1", context: "campus_academic" }, "lcr").role).toBe("campus_academic");
    // lcr's `speaker` field is the utterance text — it must NOT be used as a role.
    expect(deriveSpeakerMeta({ id: "lcr_2", speaker: "Where is the library?" }, "lcr").role).toBe(null);
  });
});
