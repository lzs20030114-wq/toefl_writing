const { sniffImageMime } = require("../lib/userBank/imageSniff");

describe("sniffImageMime (upload magic-byte validation)", () => {
  test("detects JPEG (FF D8 FF)", () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe("image/jpeg");
  });

  test("detects PNG (89 50 4E 47 0D 0A 1A 0A)", () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe("image/png");
  });

  test("detects WebP (RIFF....WEBP)", () => {
    const buf = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x00, 0x00, 0x00, 0x00]), Buffer.from("WEBP")]);
    expect(sniffImageMime(buf)).toBe("image/webp");
  });

  test("rejects a truncated PNG signature", () => {
    // correct 4-byte PNG start but missing the CR-LF/EOF block → not a valid PNG header
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]))).toBeNull();
  });

  test("rejects RIFF that is not WEBP (e.g. WAV)", () => {
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x00, 0x00, 0x00, 0x00]), Buffer.from("WAVE")]);
    expect(sniffImageMime(wav)).toBeNull();
  });

  test("rejects plain text / disguised payloads", () => {
    expect(sniffImageMime(Buffer.from("GIF89a not really", "ascii"))).toBeNull();
    expect(sniffImageMime(Buffer.from("<script>alert(1)</script>", "ascii"))).toBeNull();
  });

  test("rejects empty / tiny buffers", () => {
    expect(sniffImageMime(Buffer.from([]))).toBeNull();
    expect(sniffImageMime(Buffer.from([0xff]))).toBeNull();
    expect(sniffImageMime(null)).toBeNull();
  });
});
