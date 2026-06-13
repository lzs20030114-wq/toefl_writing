import { listeningAudioUrlFromId } from "../lib/listening/bankAudio";

// These match the live bank's audio_url scheme (data/listening/bank/*.json):
//   {SUPABASE_URL}/storage/v1/object/public/listening_audio/{folder}/{id}.mp3
// so history records saved before audio_url was persisted can replay the real
// recording instead of falling back to robotic browser TTS.
describe("listeningAudioUrlFromId", () => {
  const ROOT = "https://example.supabase.co";
  const prev = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeAll(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = ROOT; });
  afterAll(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = prev; });

  const base = `${ROOT}/storage/v1/object/public/listening_audio`;

  test("maps each task type to its storage folder", () => {
    expect(listeningAudioUrlFromId("lcr_abc_0")).toBe(`${base}/choose-response/lcr_abc_0.mp3`);
    expect(listeningAudioUrlFromId("la_abc_1")).toBe(`${base}/announcement/la_abc_1.mp3`);
    expect(listeningAudioUrlFromId("lc_abc_2")).toBe(`${base}/conversation/lc_abc_2.mp3`);
    expect(listeningAudioUrlFromId("lat_abc_3")).toBe(`${base}/lecture/lat_abc_3.mp3`);
  });

  test("returns null for unknown / empty ids", () => {
    expect(listeningAudioUrlFromId("bogus_1")).toBeNull();
    expect(listeningAudioUrlFromId("")).toBeNull();
    expect(listeningAudioUrlFromId(null)).toBeNull();
    expect(listeningAudioUrlFromId(undefined)).toBeNull();
  });

  test("returns null when Supabase URL is not configured", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(listeningAudioUrlFromId("lcr_abc_0")).toBeNull();
    process.env.NEXT_PUBLIC_SUPABASE_URL = ROOT;
  });
});
