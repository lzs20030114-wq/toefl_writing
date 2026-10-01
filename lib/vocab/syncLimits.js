/** Shared with the existing cloud card contract; imports must fit these limits. */
export const VOCAB_WORD_MAX_LENGTH = 60;
export const VOCAB_CARD_MAX_BYTES = 8 * 1024;

export function vocabularyCardBytes(card) {
  // JSON.stringify escapes lone surrogates; iterate code points for UTF-8 size.
  let bytes = 0;
  for (const char of JSON.stringify(card)) {
    const code = char.codePointAt(0);
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
