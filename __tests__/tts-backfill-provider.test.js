const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO, "scripts", "backfill-tts.mjs");

// backfill-tts.mjs runs immediately (IIFE), so provider routing is exercised behaviorally
// via a child process for the fail-fast preflight, and via source-structure assertions for
// the guarantees that can't be observed without spending real TTS money.
describe("backfill-tts provider routing", () => {
  test("openai mode with NO OPENAI_API_KEY exits 1 (never silently falls back to edge)", () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY; // force the missing-key branch
    const res = spawnSync(process.execPath, [SCRIPT, "--tts-provider=openai"], {
      cwd: REPO,
      env,
      encoding: "utf8",
      timeout: 30000,
    });
    expect(res.status).toBe(1);
    expect(`${res.stderr}${res.stdout}`).toMatch(/OPENAI_API_KEY/);
  });

  describe("source structure", () => {
    const src = fs.readFileSync(SCRIPT, "utf8");

    test("parses --tts-provider and has a provider branch", () => {
      expect(src).toMatch(/--tts-provider=/);
      expect(src).toMatch(/const OPENAI = PROVIDER === 'openai'/);
      expect(src).toMatch(/if \(OPENAI\)/);
    });

    test("openai listening path uses the TIMED persona render + .p1.mp3 naming", () => {
      expect(src).toMatch(/renderSingleSpeakerTimed\(/);
      expect(src).toMatch(/renderConversationTimed\(/);
      expect(src).toMatch(/encodeWavToMp3\(/);
      expect(src).toMatch(/\.p1\.mp3/);
    });

    // 句级时间戳与 audio_url 同生同灭：persona 渲染写入，edge 渲染（整条不可分）删掉旧的。
    test("sentence_timings is written next to audio_url in both listening paths, and cleared on edge", () => {
      const single = src.slice(src.indexOf("async function backfillSingle"), src.indexOf("async function backfillConversation"));
      const conv = src.slice(src.indexOf("async function backfillConversation"), src.indexOf("async function backfillRepeat"));
      for (const block of [single, conv]) {
        expect(block).toMatch(/const \{ wav, sentences \} = await render(SingleSpeaker|Conversation)Timed\(/);
        expect(block).toMatch(/it\.audio_url = versionedAudioUrl\(url\)/);
        expect(block).toMatch(/if \(timings\) it\.sentence_timings = timings; else delete it\.sentence_timings;/);
      }
    });

    test("speaking (repeat/interview) stays edge — those functions never touch the persona path", () => {
      const repeatStart = src.indexOf("async function backfillRepeat");
      const afterInterview = src.indexOf("const want =");
      expect(repeatStart).toBeGreaterThan(-1);
      expect(afterInterview).toBeGreaterThan(repeatStart);
      const speakingBlock = src.slice(repeatStart, afterInterview);
      expect(speakingBlock).not.toMatch(/OPENAI/);
      expect(speakingBlock).not.toMatch(/renderSingleSpeaker|renderConversation|encodeWavToMp3/);
      expect(speakingBlock).toMatch(/generateSpeech\(/); // edge-tts path
    });
  });
});
