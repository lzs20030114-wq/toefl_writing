/**
 * CSP ↔ 考试音频解锁的耦合锁 (2026-07-22)。
 *
 * iOS 自动播放修复（lib/audio/examAudioController.js）靠在「开始」手势内播放
 * 一段 data:audio/wav 静音音频来解锁共享 <audio> 元素。CSP 的 'self' 并不覆盖
 * data: —— 一旦 middleware.js 的 media-src 丢掉 data:，解锁在每次页面加载都会
 * 被拒（"Refused to load media …"），整套 iOS 修复静默失效。这个回归真实发生
 * 过一次（CSP 白名单早于修复存在，没人对过表），所以用源码断言把它锁死。
 */
const fs = require("fs");
const path = require("path");

function readSource(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

test("middleware CSP media-src 必须包含 data:（考试音频静音 WAV 解锁依赖它）", () => {
  const src = readSource("middleware.js");
  const m = src.match(/"media-src ([^"]+)"/);
  expect(m).not.toBeNull();
  const sources = m[1].split(/\s+/);
  expect(sources).toContain("data:");
  // 原有来源不许被顺手删掉。
  expect(sources).toContain("'self'");
  expect(sources).toContain("blob:");
  expect(sources).toContain("https://*.supabase.co");
});

test("解锁音频确实是 data: URI（media-src 需要 data: 的原因）", () => {
  const src = readSource("lib/audio/examAudioController.js");
  expect(src).toMatch(/SILENT_WAV\s*=\s*\n?\s*"data:audio\/wav;base64,/);
});
