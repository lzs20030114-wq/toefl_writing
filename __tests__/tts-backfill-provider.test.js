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

    test("openai listening path uses the persona render + .p1.mp3 naming", () => {
      expect(src).toMatch(/renderSingleSpeaker\(/);
      expect(src).toMatch(/renderConversation\(/);
      expect(src).toMatch(/encodeWavToMp3\(/);
      expect(src).toMatch(/\.p1\.mp3/);
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
