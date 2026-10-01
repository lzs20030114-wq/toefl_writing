import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createVocabularyPdf, vocabularyPdfFilename } from '../../lib/vocab/exportVocabularyPdf.js';
import { PDFDocument } from 'pdf-lib';
const root = process.cwd();
globalThis.fetch = async (url) => ({ ok: true, arrayBuffer: async () => {
  const data = await fs.readFile(path.join(root, 'public', url));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
} });
const out = process.argv[2] || path.join(root, 'tmp/pdfs/vocab-template.pdf');
const date = new Date('2026-10-01T12:00:00+08:00');
const cards = [
  { word: 'sustainability', phonetic: 'səˌsteɪnəˈbɪləti', def: '名词 可持续性；保持生态与资源长期平衡的能力。', sentence: 'Sustainability requires us to consider the long-term effects of everyday choices.' },
  { word: 'resilient', phonetic: 'rɪˈzɪliənt', def: '形容词 有韧性的；受挫后能迅速恢复的。', sentence: 'A resilient ecosystem can recover after a period of drought.' },
  { word: 'phenomenon', phonetic: 'fəˈnɒmɪnən', def: '名词 现象；能通过观察或研究获知的事实与事件。', sentence: 'Researchers observed a phenomenon that earlier models had failed to predict.' },
  { word: 'coherent', phonetic: 'kəʊˈhɪərənt', def: '形容词 连贯的；条理清楚的；前后联系一致的。' },
  { word: 'interdisciplinary', phonetic: 'ˌɪntədɪsəˈplɪnəri', def: '形容词 跨学科的。涉及两门或更多学科，将不同领域的知识、方法和视角结合起来，用以解释单一学科难以回答的复杂问题。例如环境变化研究需要同时考虑生态学、经济学、社会行为与城市规划。', sentence: 'The interdisciplinary research team combined interviews, field observations, and computer simulations to understand how residents adapt to changing urban environments without losing the social connections that make their neighbourhoods meaningful.' },
  { word: 'pneumonoultramicroscopicsilicovolcanoconiosis', phonetic: 'ˌnjuːmənoʊˌʌltrəmaɪkrəˌskɒpɪkˌsɪlɪkoʊvɒlˌkeɪnoʊˈkoʊniəsɪs', def: '名词 一种由吸入极细硅尘所引起的肺病；这是一条用于验证超长单词与音标换行的样例。', sentence: 'An unusually long term should remain readable rather than disappear beyond the edge of the printed page.' },
  { word: 'café', phonetic: 'ˈkæfeɪ', def: '名词 咖啡馆。“中文标点”、破折号—和音标 /θ ð ŋ ɜː ʃ ʒ/ 均保留。' },
];
const bytes = await createVocabularyPdf(cards, { title: '我的单词表', date });
await fs.writeFile(out, bytes);
assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
assert.equal(vocabularyPdfFilename('../我的:词表?', date), '..-我的-词表--2026-10-01.pdf');
await assert.rejects(createVocabularyPdf([]), /选择/);
await assert.rejects(createVocabularyPdf(Array.from({ length: 1001 }, () => cards[0])), /1000/);
const bulk = Array.from({ length: 500 }, (_, i) => ({ ...cards[i % cards.length], word: `word-${i + 1}`, display: `word-${i + 1}` }));
const bulkBytes = await createVocabularyPdf(bulk, { date });
await fs.writeFile(path.join(root, 'tmp/pdfs/vocab-500.pdf'), bulkBytes);
const bulkPages = (await PDFDocument.load(bulkBytes)).getPageCount();
assert.ok(bulkPages > 20 && bulkPages < 100);
const huge = [{ word: 'verylong'.repeat(60), phonetic: 'ˌrɪˈzɪliənt', def: '连续的中文释义可以完整换行，而不会丢失内容。'.repeat(100), sentence: 'A long original sentence must continue across pages without clipping any text. '.repeat(100) }];
await fs.writeFile(path.join(root, 'tmp/pdfs/vocab-long.pdf'), await createVocabularyPdf(huge, { date }));
const titleBytes = await createVocabularyPdf(cards, { date, includeSentences: false, title: '阅读复习与学术写作：可持续发展、生态适应、跨学科研究中的重点单词与完整中文释义' });
await fs.writeFile(path.join(root, 'tmp/pdfs/vocab-title.pdf'), titleBytes);
console.log(JSON.stringify({ sample: out, sampleBytes: bytes.length, bulkWords: bulk.length, bulkPages, bulkBytes: bulkBytes.length }));
