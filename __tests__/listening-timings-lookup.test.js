/**
 * 老练习记录补句级时间戳（lib/listening/timingsLookup.js）。
 * 记录快照里没有 sentence_timings（功能上线前做的）但有 audio_url → 按音频到题库里现查。
 */
import { render, screen, act } from "@testing-library/react";
import { buildTimingsIndex, findSentenceTimingsByAudioUrl } from "../lib/listening/timingsLookup";
import { LADetail } from "../components/listening/ListeningProgressView";
import realLat from "../data/realBank/listening/lat.json";

const GOOD = [{ text: "Hello there.", start: 0, end: 1 }, { text: "Bye.", start: 1.2, end: 2 }];

describe("buildTimingsIndex", () => {
  test("只收有 audio_url 且时间戳过体检的条目", () => {
    const index = buildTimingsIndex([
      { items: [
        { id: "a", audio_url: "https://x/a.mp3", sentence_timings: GOOD },
        { id: "b", audio_url: "https://x/b.mp3" },
        { id: "c", audio_url: "https://x/c.mp3", sentence_timings: [{ text: "bad", start: 3, end: 1 }] },
        { id: "d", sentence_timings: GOOD },
      ] },
      null,
      { default: { items: [{ id: "e", audio_url: "https://x/e.mp3", sentence_timings: GOOD }] } },
    ]);
    expect([...index.keys()].sort()).toEqual(["https://x/a.mp3", "https://x/e.mp3"]);
  });
});

describe("findSentenceTimingsByAudioUrl", () => {
  test("真题库里的音频查得到同一份时间戳；不认识的 / 空 url → null", async () => {
    const item = realLat.items.find((i) => i.audio_url && Array.isArray(i.sentence_timings));
    expect(await findSentenceTimingsByAudioUrl(item.audio_url)).toEqual(item.sentence_timings);
    expect(await findSentenceTimingsByAudioUrl("https://nowhere.example/none.mp3")).toBeNull();
    expect(await findSentenceTimingsByAudioUrl("")).toBeNull();
    expect(await findSentenceTimingsByAudioUrl(null)).toBeNull();
  });
});

describe("LADetail 老记录", () => {
  test("details 里没有 sentence_timings 但有题库里的 audio_url → 异步补上，逐句播放键出现", async () => {
    const item = realLat.items.find((i) => i.audio_url && Array.isArray(i.sentence_timings));
    const session = { details: { results: [], questions: [], transcript: item.transcript, audio_url: item.audio_url } };
    const { container } = render(<LADetail session={session} />);
    expect(container.querySelectorAll('button[data-sentence-play="1"]')).toHaveLength(0);
    await act(async () => { await findSentenceTimingsByAudioUrl(item.audio_url); });
    const playable = item.sentence_timings.filter((s) => s.start != null).length;
    expect(container.querySelectorAll('button[data-sentence-play="1"]')).toHaveLength(playable);
    expect(screen.getByText(/点 ▶ 播放该句/)).toBeInTheDocument();
  });

  test("audio_url 不在题库里（题被下架 / 音频重配过）→ 照旧整段原文，没有播放键", async () => {
    const session = { details: { results: [], questions: [], transcript: "Plain old transcript.", audio_url: "https://nowhere.example/gone.mp3" } };
    const { container } = render(<LADetail session={session} />);
    await act(async () => { await findSentenceTimingsByAudioUrl("https://nowhere.example/gone.mp3"); });
    expect(container.querySelectorAll('button[data-sentence-play="1"]')).toHaveLength(0);
    expect(screen.getByText("Plain old transcript.")).toBeInTheDocument();
  });
});
