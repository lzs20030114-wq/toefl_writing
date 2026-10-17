/** Explicit, text-bound scene repairs. Pure and transactional: input is never mutated. */
function applyCrossSourceRepairs(bank, ledger) {
  if (!Array.isArray(bank?.items) || !Array.isArray(ledger?.cross_source)) throw new Error('Invalid bank or repair ledger');
  const items = new Map(bank.items.map(item => [item.id, item]));
  const plans = [];
  const seen = new Set();
  for (const entry of ledger.cross_source) {
    const target = items.get(entry.target_item_id);
    const donor = items.get(entry.donor_item_id);
    if (!target || !donor) throw new Error(`Missing target/donor: ${entry.target_sentence_id}`);
    const targetSentence = target.sentences?.find(s => s.id === entry.target_sentence_id);
    const donorSentence = donor.sentences?.find(s => s.id === entry.donor_sentence_id);
    if (!targetSentence || !donorSentence || targetSentence.sentence !== entry.target_text || donorSentence.sentence !== entry.donor_text) throw new Error(`Sentence text or ID changed: ${entry.target_sentence_id}`);
    if (seen.has(entry.target_sentence_id)) throw new Error(`Duplicate repair: ${entry.target_sentence_id}`);
    seen.add(entry.target_sentence_id);
    const binding = entry.donor_frame;
    const frame = donor.sentence_frames?.find(f => f.sentence_id === entry.donor_sentence_id);
    if (!binding || !frame || binding.sentence_id !== entry.donor_sentence_id || ['sentence_id', 'url', 'w', 'h', 'n'].some(key => frame[key] !== binding[key])) throw new Error(`Donor frame changed or mispaired: ${entry.target_sentence_id}`);
    let url;
    try { url = new URL(frame.url); } catch { throw new Error('Invalid frame URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || !/\.(webp|png|jpe?g)$/i.test(url.pathname) || !Number.isInteger(frame.w) || !Number.isInteger(frame.h) || frame.w <= 0 || frame.h <= 0) throw new Error(`Invalid frame URL/dimensions: ${entry.target_sentence_id}`);
    if (!target.sentence_frames?.some(f => f.sentence_id === entry.target_sentence_id)) plans.push({ target: target.id, frame: { ...frame, sentence_id: entry.target_sentence_id } });
  }
  const result = JSON.parse(JSON.stringify(bank));
  const resultItems = new Map(result.items.map(item => [item.id, item]));
  for (const plan of plans) {
    const item = resultItems.get(plan.target);
    (item.sentence_frames ||= []).push(plan.frame);
  }
  return { bank: result, added: plans.length, unchanged: ledger.cross_source.length - plans.length };
}
function applyOriginalSourceRepairs(bank, ledger) {
  const result = JSON.parse(JSON.stringify(bank));
  const items = new Map(result.items.map(item => [item.id, item]));
  let added = 0;
  let addedBases = 0;
  const seen = new Set();
  for (const entry of ledger.original_source || []) {
    const item = items.get(entry.target_item_id);
    const sentence = item?.sentences?.find(s => s.id === entry.target_sentence_id);
    if (!sentence || sentence.sentence !== entry.target_text) throw new Error(`Original source target text or ID changed: ${entry.target_sentence_id}`);
    if (seen.has(entry.target_sentence_id)) throw new Error('Duplicate original source repair');
    seen.add(entry.target_sentence_id);
    if (!/^[a-f0-9]{40}$/.test(entry.sha1) || entry.url !== `/real-bank/speaking/recovered/${entry.sha1}.webp` || entry.verified_by !== 'agent_visual_review') throw new Error('Invalid original source hash, URL or review');
    const hasSourceLocation = Number.isInteger(entry.source_page) && entry.source_page > 0 || entry.source_page === null && Number.isInteger(entry.source_image_index) && entry.source_image_index > 0 && typeof entry.source_docx_media === 'string';
    if (![entry.w, entry.h, entry.n].every(n => Number.isInteger(n) && n > 0) || !hasSourceLocation || !entry.source_file || !Array.isArray(entry.crop_box) || entry.crop_box.length !== 4 || !entry.crop_box.every(Number.isInteger) || entry.crop_box[2] - entry.crop_box[0] !== entry.w || entry.crop_box[3] - entry.crop_box[1] !== entry.h) throw new Error('Invalid original source dimensions or provenance');
    if (entry.also_base && item.sentences.length > 7) throw new Error('Mixed scene item cannot receive a whole-item base');
    if (!item.sentence_frames?.some(f => f.sentence_id === entry.target_sentence_id)) {
      (item.sentence_frames ||= []).push({ sentence_id: entry.target_sentence_id, n: entry.n, url: entry.url, w: entry.w, h: entry.h, ...(entry.frame_kind ? { frame_kind: entry.frame_kind } : {}) });
      added++;
    }
    if (entry.also_base && !item.scene_image) {
      item.scene_image = { url: entry.url, w: entry.w, h: entry.h, source_page: entry.source_page };
      addedBases++;
    }
  }
  return { bank: result, added, addedBases, unchanged: (ledger.original_source || []).length - added };
}
module.exports = { applyCrossSourceRepairs, applyOriginalSourceRepairs };
