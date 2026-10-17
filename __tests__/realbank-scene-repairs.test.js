const { applyCrossSourceRepairs, applyOriginalSourceRepairs } = require('../scripts/realbank/scene_repairs');

function fixture() {
  const frame = { sentence_id: 'd_s1', url: 'https://example.com/image.webp', w: 800, h: 600, n: 2 };
  const bank = { items: [{ id: 'd', sentences: [{ id: 'd_s1', sentence: 'Donor.' }], sentence_frames: [frame] }, { id: 't', sentences: [{ id: 't_s1', sentence: 'Target.' }], scene_image: { url: 'keep' }, custom: 'keep' }] };
  const ledger = { cross_source: [{ donor_item_id: 'd', donor_sentence_id: 'd_s1', donor_text: 'Donor.', target_item_id: 't', target_sentence_id: 't_s1', target_text: 'Target.', donor_frame: { ...frame } }] };
  return { bank, ledger };
}
test('adds only missing frames, preserves input and other fields, and replays idempotently', () => {
  const { bank, ledger } = fixture();
  const snapshot = JSON.stringify(bank);
  const first = applyCrossSourceRepairs(bank, ledger);
  expect(first.added).toBe(1);
  expect(JSON.stringify(bank)).toBe(snapshot);
  expect(first.bank.items[1]).toEqual({ ...bank.items[1], sentence_frames: [{ ...ledger.cross_source[0].donor_frame, sentence_id: 't_s1' }] });
  expect(applyCrossSourceRepairs(first.bank, ledger)).toEqual({ bank: first.bank, added: 0, unchanged: 1 });
});
test.each(['target', 'donor'])('rejects changed %s text', side => {
  const { bank, ledger } = fixture();
  bank.items[side === 'target' ? 1 : 0].sentences[0].sentence += ' changed';
  expect(() => applyCrossSourceRepairs(bank, ledger)).toThrow(/text/);
});
test('rejects missing donor', () => {
  const { bank, ledger } = fixture(); bank.items.shift();
  expect(() => applyCrossSourceRepairs(bank, ledger)).toThrow(/Missing/);
});
test.each(['sentence_id', 'url', 'w', 'h', 'n'])('rejects changed or mispaired donor frame %s', key => {
  const { bank, ledger } = fixture(); bank.items[0].sentence_frames[0][key] = 'wrong';
  expect(() => applyCrossSourceRepairs(bank, ledger)).toThrow(/frame/);
});
test('keeps an existing target frame intact', () => {
  const { bank, ledger } = fixture(); bank.items[1].sentence_frames = [{ sentence_id: 't_s1', url: 'existing' }];
  expect(applyCrossSourceRepairs(bank, ledger)).toEqual({ bank, added: 0, unchanged: 1 });
});
function originalFixture() {
  const { bank } = fixture();
  const sha1 = 'a'.repeat(40);
  const entry = { target_item_id: 't', target_sentence_id: 't_s1', target_text: 'Target.', sha1, url: `/real-bank/speaking/recovered/${sha1}.webp`, w: 800, h: 600, n: 1, source_file: 'source.pdf', source_page: 2, crop_box: [10, 20, 810, 620], verified_by: 'agent_visual_review', also_base: true };
  return { bank, ledger: { original_source: [entry] }, entry };
}
test('original source adds a frame, preserves existing base and replays without changes', () => {
  const { bank, ledger } = originalFixture();
  const result = applyOriginalSourceRepairs(bank, ledger);
  expect(result.added).toBe(1); expect(result.addedBases).toBe(0);
  expect(result.bank.items[1].scene_image).toEqual(bank.items[1].scene_image);
  expect(applyOriginalSourceRepairs(result.bank, ledger)).toEqual({ bank: result.bank, added: 0, addedBases: 0, unchanged: 1 });
});
test('original source can also supply a missing base', () => {
  const { bank, ledger } = originalFixture(); delete bank.items[1].scene_image;
  expect(applyOriginalSourceRepairs(bank, ledger).addedBases).toBe(1);
});

test.each(['video', 'remote'])('accepts traceable %s source without inventing a page and replays idempotently', kind => {
  const { bank, ledger, entry } = originalFixture();
  delete entry.source_file; delete entry.source_page;
  Object.assign(entry, kind === 'video'
    ? { source_video: 'recording.mov', source_time_seconds: 0 }
    : { source_url: 'https://example.com/article', source_image_url: 'https://example.com/original.png', source_sha256: 'b'.repeat(64) });
  entry.source_quad = [[10, 20], [900, 10], [890, 700], [0, 690]];
  const result = applyOriginalSourceRepairs(bank, ledger);
  expect(result.added).toBe(1);
  expect(applyOriginalSourceRepairs(result.bank, ledger).added).toBe(0);
});

test.each([-1, NaN, Infinity, '0', null])('rejects invalid source video time %s even with PDF fallback', time => {
  const { bank, ledger, entry } = originalFixture();
  Object.assign(entry, { source_video: 'recording.mov', source_time_seconds: time });
  expect(() => applyOriginalSourceRepairs(bank, ledger)).toThrow(/provenance/);
});

test.each(['http://example.com/img.png', 'file:///original.png', 'https://user:pass@example.com/img.png'])('rejects unsafe remote source %s', source => {
  const { bank, ledger, entry } = originalFixture();
  Object.assign(entry, { source_url: 'https://example.com/article', source_image_url: source, source_sha256: 'b'.repeat(64) });
  expect(() => applyOriginalSourceRepairs(bank, ledger)).toThrow(/provenance/);
});

test('rejects absent provenance, incomplete remote binding, and malformed perspective coordinates', () => {
  for (const invalid of [
    { source_file: undefined },
    { source_url: 'https://example.com/article' },
    { source_quad: [[0, 0], [1, 0], [1, Infinity], [0, 1]] },
    { source_quad: [[0, 0], [1, 0], [1, 1]] },
  ]) {
    const { bank, ledger, entry } = originalFixture(); Object.assign(entry, invalid);
    expect(() => applyOriginalSourceRepairs(bank, ledger)).toThrow(/provenance/);
  }
});
test.each(['target_text', 'url', 'sha1', 'verified_by', 'w', 'source_page'])('original source rejects changed binding %s', key => {
  const { bank, ledger, entry } = originalFixture(); entry[key] = 'invalid';
  expect(() => applyOriginalSourceRepairs(bank, ledger)).toThrow();
});
test('material image mapper preserves recovered asset paths', () => {
  const { materialImageSrc } = require('../lib/reading/materialImage');
  const { entry } = originalFixture();
  expect(materialImageSrc(entry.url)).toBe(entry.url);
});
test('static shared scene is scoped to matching sentences and keeps existing frames', () => {
  const { bank, ledger, entry } = originalFixture();
  entry.frame_kind = 'unhighlighted_scene_shared_by_sentences'; entry.also_base = false;
  entry.source_page = null; entry.source_image_index = 2; entry.source_docx_media = 'media/image2.png';
  bank.items[1].sentence_frames = [{ sentence_id: 'other', url: 'keep-highlight' }];
  const result = applyOriginalSourceRepairs(bank, ledger);
  expect(result.bank.items[1].sentence_frames).toEqual([bank.items[1].sentence_frames[0], expect.objectContaining({ sentence_id: 't_s1', frame_kind: entry.frame_kind })]);
  expect(result.addedBases).toBe(0);
});
test('rejects whole-item base for mixed scene items', () => {
  const { bank, ledger } = originalFixture();
  bank.items[1].sentences.push(...Array.from({ length: 7 }, (_, i) => ({ id: `extra${i}`, sentence: 'Extra.' })));
  expect(() => applyOriginalSourceRepairs(bank, ledger)).toThrow(/Mixed scene/);
});
test('checked-in ledger fully replays its missing frames and remains idempotent against the real bank', () => {
  const bank = require('../data/realBank/speaking/repeat.json');
  const ledger = require('../data/realBank/speaking/scene-repairs.json');
  const missing = JSON.parse(JSON.stringify(bank));
  const repairedIds = new Set([...ledger.cross_source, ...ledger.original_source].map(e => e.target_sentence_id));
  for (const item of missing.items) {
    if (item.sentence_frames) item.sentence_frames = item.sentence_frames.filter(f => !repairedIds.has(f.sentence_id));
    if (ledger.original_source.some(e => e.target_item_id === item.id && e.also_base)) delete item.scene_image;
  }
  const cross = applyCrossSourceRepairs(missing, ledger);
  expect(cross.added).toBe(ledger.cross_source.length);
  const originals = applyOriginalSourceRepairs(cross.bank, ledger);
  expect(originals.added).toBe(ledger.original_source.length);
  expect(originals.bank).toEqual(bank);
  expect(applyCrossSourceRepairs(bank, ledger).added).toBe(0);
  expect(applyOriginalSourceRepairs(bank, ledger).added).toBe(0);
});
