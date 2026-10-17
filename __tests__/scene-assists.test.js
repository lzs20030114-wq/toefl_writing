import { render, screen } from "@testing-library/react";
import { mapSceneAssists, validSceneOverlay, validSceneAssistUrl } from "../lib/speakingGen/sceneAssists";
import { pickSceneFrame, sceneImagePreloadUrls } from "../components/speaking/RepeatTask";
import { SceneImage } from "../components/speaking/SceneImage";
import assistCatalog from "../data/realBank/speaking/scene-assists.json";
import repeatBank from "../data/realBank/speaking/repeat.json";
import { mapRealRepeatSet } from "../lib/realBank";
import { loadRealMockPool } from "../lib/realMockExam/planner";

const raw = { id: "test", sentences: [{ id: "test_s4", sentence: "Use the library." }] };
const entry = { item_id: "test", sentence_id: "test_s4", sentence_text: "Use the library.",
  url: "/assist.webp", w: 400, h: 300, kind: "highlight",
  overlay: [{ type: "rect", x: .1, y: .2, width: .3, height: .4 }], references: [{ url: "https://example.org/source" }] };
const catalog = (entries) => ({ version: 1, entries });

test("exact ID and text binding fails closed for edits and ambiguous entries", () => {
  expect(mapSceneAssists(raw, catalog([entry]))).toHaveLength(1);
  for (const patch of [{ sentence_id: "test_s1" }, { sentence_text: "Use library." }, { item_id: "other" }, { w: 0 }, { references: [] }, { overlay: [] }, { url: "javascript:alert(1)" }]) {
    expect(mapSceneAssists(raw, catalog([{ ...entry, ...patch }]))).toEqual([]);
  }
  expect(mapSceneAssists(raw, catalog([entry, entry]))).toEqual([]);
  expect(validSceneOverlay({ ...entry.overlay[0], x: .9 })).toBe(false);
  for (const url of ["https://", "https://user:pass@example.org/a.webp", "//example.org/a", "/\\example.org/a", "https://a b/a"]) expect(validSceneAssistUrl(url)).toBe(false);
});

test("original sentence frame wins, missing frame uses assist before base; exams exclude assist", () => {
  const assist = mapSceneAssists(raw, catalog([entry]))[0];
  const original = { sentence_id: "test_s4", url: "/original.webp" };
  const base = { url: "/base.webp" };
  const set = { scene_image: base, assist_frames: [assist] };
  expect(pickSceneFrame(set, "test_s4")).toBe(assist);
  expect(pickSceneFrame({ ...set, sentence_frames: [original] }, "test_s4")).toBe(original);
  expect(pickSceneFrame({ ...set, sentence_frames: [{ ...original, frame_kind: "unhighlighted_scene" }] }, "test_s4")).toBe(assist);
  expect(pickSceneFrame(set, "missing")).toBe(base);
  for (const options of [{ realMock: true }, { etsNumbering: { offset: 0, total: 11 } }]) {
    expect(pickSceneFrame(set, "test_s4", options)).toBe(base);
    expect(sceneImagePreloadUrls(set, options)).toEqual([base.url]);
  }
  expect(sceneImagePreloadUrls(set)).toContain(assist.url);
  expect(sceneImagePreloadUrls(set, { items: [{ id: "other" }] })).not.toContain(assist.url);
  expect(sceneImagePreloadUrls({ ...set, sentence_frames: [original] })).not.toContain(assist.url);
});

test("mapped assists stay in practice and never enter the serialized real mock pool", () => {
  const occupied = new Set(assistCatalog.entries.map((e) => e.sentence_id));
  const source = repeatBank.items.find((item) => item.sentences?.length === 7 && item.sentences.every((s) => /^https:/.test(s.audio_url || "")) && item.sentences.some((s) => !occupied.has(s.id)));
  const target = source.sentences.find((s) => !occupied.has(s.id));
  const binding = { ...entry, item_id: source.id, sentence_id: target.id, sentence_text: target.sentence };
  assistCatalog.entries.push(binding);
  try {
    expect(mapRealRepeatSet(source).assist_frames.some((f) => f.sentence_id === binding.sentence_id)).toBe(true);
    const pool = loadRealMockPool("speaking");
    expect(pool.repeat.find((item) => item.id === source.id)).toBeTruthy();
    expect(JSON.stringify(pool)).not.toContain("assist_frames");
    expect(JSON.stringify(pool)).not.toContain(entry.url);
  } finally { assistCatalog.entries.pop(); }
});

test("every production catalog binding maps successfully and no auxiliary frame reaches mock selection or preload", () => {
  expect(assistCatalog.entries.length).toBeGreaterThan(0);
  const mapped = repeatBank.items.map(mapRealRepeatSet).filter(Boolean);
  const frames = mapped.flatMap((set) => set.assist_frames || []);
  expect(frames).toHaveLength(assistCatalog.entries.length);
  expect(new Set(assistCatalog.entries.map((e) => `${e.item_id}:${e.sentence_id}`)).size).toBe(assistCatalog.entries.length);
  for (const set of mapped) {
    for (const sentence of set.sentences) {
      for (const options of [{ realMock: true }, { etsNumbering: { offset: 0, total: 11 } }]) {
        expect(pickSceneFrame(set, sentence.id, options)?.auxiliary).not.toBe(true);
        const originalUrls = [set.scene_image?.url, ...(set.sentence_frames || []).map((f) => f.url)].filter(Boolean);
        expect(sceneImagePreloadUrls(set, { ...options, items: [sentence] }).every((url) => originalUrls.includes(url))).toBe(true);
      }
    }
  }
  expect(JSON.stringify(loadRealMockPool("speaking"))).not.toContain("assist_frames");
  expect(JSON.stringify(loadRealMockPool("speaking"))).not.toContain('"auxiliary":true');
});

test("native SVG overlay and honest labels preserve the original image URL; ETS renders none", () => {
  const assist = mapSceneAssists(raw, catalog([entry]))[0];
  const { rerender, container } = render(<SceneImage frame={assist} />);
  expect(screen.getByTestId("repeat-scene-image").getAttribute("src")).toBe(entry.url);
  expect(screen.getByText("辅助高亮")).toBeTruthy();
  expect(container.querySelector("svg rect").getAttribute("x")).toBe("100");
  rerender(<SceneImage frame={{ ...assist, kind: "redraw", overlay: [] }} />);
  expect(screen.getByText("辅助重绘图")).toBeTruthy();
  rerender(<SceneImage frame={assist} ets />);
  expect(container.querySelector("img")).toBeNull();
});
