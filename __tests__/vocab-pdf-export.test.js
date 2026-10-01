/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import fontkit from '@pdf-lib/fontkit';
import { createVocabularyPdf, vocabularyPdfFilename } from '../lib/vocab/exportVocabularyPdf';

const root = path.join(process.cwd(), 'public/fonts/pdf');

test('bundled PDF fonts cover basic Chinese and IPA and keep short-loca offsets aligned', () => {
  const chinese = fontkit.create(fs.readFileSync(path.join(root, 'NotoSansSC-Regular.ttf')));
  const latin = fontkit.create(fs.readFileSync(path.join(root, 'NotoSans-Regular.ttf')));
  for (const char of '我的单词表自测中文释义原句复习可持续性复杂现象韧性，。“”；—') {
    expect(chinese.hasGlyphForCodePoint(char.codePointAt(0))).toBe(true);
  }
  for (const char of 'əˌˈɪæŋθðɜːʃʒɒʊʌɛɹɑɔɚɝ') {
    expect(latin.hasGlyphForCodePoint(char.codePointAt(0))).toBe(true);
  }
  // Fontkit emits short loca tables for small PDF subsets. Odd source glyph offsets
  // would be rounded down there and silently erase Chinese glyphs while text remains extractable.
  expect(chinese.loca.offsets.every((offset) => offset % 2 === 0)).toBe(true);
});

test('rejects empty selection, too many cards, or oversized fields before loading fonts', async () => {
  await expect(createVocabularyPdf([])).rejects.toThrow('选择');
  await expect(createVocabularyPdf(Array.from({ length: 1001 }, () => ({ word: 'test' })))).rejects.toThrow('1000');
  await expect(createVocabularyPdf([{ word: 'test', def: 'a'.repeat(20001) }])).rejects.toThrow('过长');
});

test('produces usable download filenames with a deterministic local date', () => {
  expect(vocabularyPdfFilename('我的/词表:复习?', new Date('2026-10-01T12:00:00+08:00'))).toBe('我的-词表-复习--2026-10-01.pdf');
});
