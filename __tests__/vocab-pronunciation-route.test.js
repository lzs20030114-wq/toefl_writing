/** @jest-environment node */
jest.mock("../lib/tts/edgeTts", () => ({ generateSpeech: jest.fn() }));
jest.mock("../lib/ai/routeGuards", () => ({ isOriginAllowed: jest.fn(() => true) }));
import { GET } from "../app/api/vocab/pronunciation/route";
const { generateSpeech } = require("../lib/tts/edgeTts");
const request = (word, site = "same-origin") => new Request(`http://localhost/api/vocab/pronunciation?word=${encodeURIComponent(word)}`, { headers: { "sec-fetch-site": site, "x-forwarded-for": "pronunciation-test" } });
beforeEach(() => { generateSpeech.mockReset(); generateSpeech.mockResolvedValue(Buffer.from("mp3")); });

test.each(["", "http://evil.test", "hello. this is text", "你好", "one two three four five six seven", "a".repeat(61)])("rejects invalid headword %s before upstream", async (word) => {
  const response = await GET(request(word));
  expect(response.status).toBe(400);
  expect((await response.json()).ok).toBe(false);
  expect(generateSpeech).not.toHaveBeenCalled();
});
test("same-origin GET without Origin returns cached MP3 and coalesces concurrent work", async () => {
  const [first, second] = await Promise.all([GET(request("take care")), GET(request(" Take  Care "))]);
  expect(first.status).toBe(200); expect(second.status).toBe(200);
  expect(first.headers.get("content-type")).toBe("audio/mpeg");
  expect(first.headers.get("cache-control")).toContain("s-maxage");
  expect(generateSpeech).toHaveBeenCalledTimes(1);
  expect(generateSpeech).toHaveBeenCalledWith("take care", { voice: "en-US-AriaNeural", rate: "-10%", format: "mp3" });
});
test("cross-site requests cannot trigger synthesis", async () => {
  expect((await GET(request("remote", "cross-site"))).status).toBe(403);
  expect(generateSpeech).not.toHaveBeenCalled();
});
test("upstream failure is fail-open JSON and permits retry", async () => {
  generateSpeech.mockRejectedValueOnce(new Error("offline"));
  const response = await GET(request("retry"));
  expect(response.status).toBe(503);
  expect((await response.json()).ok).toBe(false);
  expect((await GET(request("retry"))).status).toBe(200);
});

test("four upstream jobs max; overload fails open instead of queuing unbounded work", async () => {
  const resolves = [];
  generateSpeech.mockImplementation(() => new Promise((resolve) => resolves.push(resolve)));
  const jobs = ["first", "second", "third", "fourth"].map((word) => GET(request(word)));
  await Promise.resolve();
  expect((await GET(request("fifth"))).status).toBe(503);
  expect(generateSpeech).toHaveBeenCalledTimes(4);
  resolves.forEach((resolve) => resolve(Buffer.from("mp3")));
  expect((await Promise.all(jobs)).every((response) => response.status === 200)).toBe(true);
});
